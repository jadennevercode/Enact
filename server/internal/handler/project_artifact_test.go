package handler

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
)

// artifactFile inserts an attachment row. Ownership is whatever the caller
// names: `issue_id` for a file on the issue body, `comment_id` for one on a
// comment, neither for a chat-only upload.
func artifactFile(t *testing.T, filename string, over testutil.Cols) string {
	t.Helper()
	cols := testutil.Cols{
		"workspace_id":  testWorkspaceID,
		"uploader_type": "member",
		"uploader_id":   testUserID,
		"filename":      filename,
		"url":           "https://storage.test/" + filename,
		"content_type":  "application/pdf",
		"size_bytes":    1024,
	}
	for k, v := range over {
		cols[k] = v
	}
	return dbfx.Insert(t, "attachment", cols)
}

func listProjectArtifacts(t *testing.T, projectID string) []ProjectArtifactResponse {
	t.Helper()
	var out struct {
		Artifacts []ProjectArtifactResponse `json:"artifacts"`
		Total     int                       `json:"total"`
		Truncated bool                      `json:"truncated"`
	}
	req := withURLParam(newRequest("GET", "/api/projects/"+projectID+"/artifacts", nil), "id", projectID)
	testutil.Call(t, testHandler.ListProjectArtifacts, req).Want(http.StatusOK).JSON(&out)
	if out.Total != len(out.Artifacts) {
		t.Errorf("total = %d but artifacts has %d entries", out.Total, len(out.Artifacts))
	}
	return out.Artifacts
}

func artifactByFilename(t *testing.T, list []ProjectArtifactResponse, filename string) ProjectArtifactResponse {
	t.Helper()
	for _, a := range list {
		if a.Filename == filename {
			return a
		}
	}
	names := make([]string, len(list))
	for i, a := range list {
		names[i] = a.Filename
	}
	t.Fatalf("no artifact named %q in listing %v", filename, names)
	return ProjectArtifactResponse{}
}

// A project's artifact listing reaches files through BOTH edges an attachment
// can take into an issue — the issue body and a comment on it — and stops at
// the project boundary in every direction it could leak across.
func TestListProjectArtifacts_ResolvesOwnerIssueAndScopesToProject(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	setWorkspaceIssuePrefixForTest(t, "ART")

	projectID := dbfx.Project(t, "Artifacts project")
	otherProjectID := dbfx.Project(t, "Other project")

	issueID := dbfx.Issue(t, "Issue in project", testutil.Cols{"project_id": projectID})
	commentID := dbfx.Comment(t, issueID, "here is the report")

	artifactFile(t, "body-report.pdf", testutil.Cols{"issue_id": issueID})
	artifactFile(t, "comment-report.pdf", testutil.Cols{"comment_id": commentID})

	// Everything below must be absent from the listing.
	otherIssueID := dbfx.Issue(t, "Issue in other project", testutil.Cols{"project_id": otherProjectID})
	artifactFile(t, "other-project.pdf", testutil.Cols{"issue_id": otherIssueID})

	looseIssueID := dbfx.Issue(t, "Issue with no project")
	artifactFile(t, "no-project.pdf", testutil.Cols{"issue_id": looseIssueID})

	// A chat-only upload: no issue, no comment, so no edge into any project.
	artifactFile(t, "chat-only.pdf", nil)

	got := listProjectArtifacts(t, projectID)
	if len(got) != 2 {
		names := make([]string, len(got))
		for i, a := range got {
			names[i] = a.Filename
		}
		t.Fatalf("listing = %v, want exactly the two files under the project", names)
	}

	body := artifactByFilename(t, got, "body-report.pdf")
	if body.OwnerIssueID != issueID {
		t.Errorf("body-report.pdf owner_issue_id = %q, want %q", body.OwnerIssueID, issueID)
	}
	if body.IssueID == nil || *body.IssueID != issueID {
		t.Errorf("body-report.pdf issue_id = %v, want %q", body.IssueID, issueID)
	}

	// The comment case is the one a naive `attachment.issue_id` filter drops:
	// the row's own issue_id is null and the owner is only reachable through
	// the comment.
	comment := artifactByFilename(t, got, "comment-report.pdf")
	if comment.OwnerIssueID != issueID {
		t.Errorf("comment-report.pdf owner_issue_id = %q, want %q", comment.OwnerIssueID, issueID)
	}
	if comment.IssueID != nil {
		t.Errorf("comment-report.pdf issue_id = %v, want null", *comment.IssueID)
	}
	if comment.CommentID == nil || *comment.CommentID != commentID {
		t.Errorf("comment-report.pdf comment_id = %v, want %q", comment.CommentID, commentID)
	}

	// Both resolve to the same owner issue, so both carry its identifier —
	// which is what the browser labels the folder with.
	for _, a := range got {
		if a.OwnerIssueTitle != "Issue in project" {
			t.Errorf("%s owner_issue_title = %q", a.Filename, a.OwnerIssueTitle)
		}
		wantIdentifier := "ART-" + strconv.Itoa(int(a.OwnerIssueNumber))
		if a.OwnerIssueIdentifier != wantIdentifier {
			t.Errorf("%s owner_issue_identifier = %q, want %q", a.Filename, a.OwnerIssueIdentifier, wantIdentifier)
		}
		if a.DownloadURL == "" {
			t.Errorf("%s has no download_url", a.Filename)
		}
	}
}

// Membership is checked before the project is read, so a project in a
// workspace the caller is not in is a 404 rather than a listing.
func TestListProjectArtifacts_RefusesProjectOutsideRequestWorkspace(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	otherWorkspaceID := dbfx.Workspace(t, "Artifacts Foreign WS", "artifacts-foreign-ws")
	foreignProjectID := dbfx.Insert(t, "project", testutil.Cols{
		"workspace_id": otherWorkspaceID,
		"title":        "Foreign project",
		"status":       "planned",
		"priority":     "none",
	})

	// The request carries the test workspace in X-Workspace-ID; the project
	// belongs to another one.
	req := withURLParam(
		newRequest("GET", "/api/projects/"+foreignProjectID+"/artifacts", nil),
		"id", foreignProjectID,
	)
	testutil.Call(t, testHandler.ListProjectArtifacts, req).Want(http.StatusNotFound)
}

func TestListProjectArtifacts_RejectsMalformedProjectID(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	req := withURLParam(newRequest("GET", "/api/projects/not-a-uuid/artifacts", nil), "id", "not-a-uuid")
	testutil.Call(t, testHandler.ListProjectArtifacts, req).Want(http.StatusBadRequest)
}

// A project past the row cap reports itself as truncated, so the client can
// say the tree is partial instead of presenting a prefix as the whole truth.
func TestListProjectArtifacts_ReportsTruncationAtTheRowCap(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	projectID := dbfx.Project(t, "Truncation project")
	issueID := dbfx.Issue(t, "Truncation issue", testutil.Cols{"project_id": projectID})
	artifactFile(t, "one.pdf", testutil.Cols{"issue_id": issueID})
	artifactFile(t, "two.pdf", testutil.Cols{"issue_id": issueID})

	var out struct {
		Artifacts []ProjectArtifactResponse `json:"artifacts"`
		Truncated bool                      `json:"truncated"`
	}
	req := withURLParam(
		newRequest("GET", "/api/projects/"+projectID+"/artifacts?limit=1", nil),
		"id", projectID,
	)
	testutil.Call(t, testHandler.ListProjectArtifacts, req).Want(http.StatusOK).JSON(&out)

	if len(out.Artifacts) != 1 {
		t.Fatalf("limit=1 returned %d artifacts", len(out.Artifacts))
	}
	if !out.Truncated {
		t.Error("truncated = false, want true when the listing filled the cap")
	}

	// Below the cap the flag must stay off, or every listing would claim to be
	// partial.
	out.Truncated = true
	req = withURLParam(
		newRequest("GET", "/api/projects/"+projectID+"/artifacts?limit=50", nil),
		"id", projectID,
	)
	testutil.Call(t, testHandler.ListProjectArtifacts, req).Want(http.StatusOK).JSON(&out)
	if out.Truncated {
		t.Error("truncated = true for a listing that did not fill the cap")
	}
}

func TestProjectArtifactLimit(t *testing.T) {
	cases := []struct {
		raw  string
		want int32
	}{
		{"", defaultProjectArtifactLimit},
		{"garbage", defaultProjectArtifactLimit},
		{"0", defaultProjectArtifactLimit},
		{"-5", defaultProjectArtifactLimit},
		{"25", 25},
		{"999999", maxProjectArtifactLimit},
	}
	for _, tc := range cases {
		if got := projectArtifactLimit(tc.raw); got != tc.want {
			t.Errorf("projectArtifactLimit(%q) = %d, want %d", tc.raw, got, tc.want)
		}
	}
}
