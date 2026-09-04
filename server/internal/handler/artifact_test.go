package handler

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/testutil"
)

// artifactsFor lists the workspace's artifacts and returns only the rows whose
// filename carries this test's tag, so the assertion is about the files the
// test seeded rather than everything the shared fixture workspace has ever
// produced.
func artifactsFor(t *testing.T, tag string) map[string]ArtifactResponse {
	t.Helper()
	var out struct {
		Artifacts []ArtifactResponse `json:"artifacts"`
		Total     int                `json:"total"`
		Truncated bool               `json:"truncated"`
	}
	testutil.Call(t, testHandler.ListArtifacts, newRequest("GET", "/api/artifacts?limit=2000", nil)).
		Want(http.StatusOK).JSON(&out)
	if out.Total != len(out.Artifacts) {
		t.Fatalf("total = %d but %d artifacts came back", out.Total, len(out.Artifacts))
	}
	mine := make(map[string]ArtifactResponse)
	for _, a := range out.Artifacts {
		if len(a.Filename) >= len(tag) && a.Filename[:len(tag)] == tag {
			mine[a.Filename] = a
		}
	}
	return mine
}

// TestListArtifactsCarriesOwnerIssueOnlyWhenThereIsOne is the whole contract of
// GET /api/artifacts: one flat, workspace-wide list in which a file uploaded
// against an issue — directly, or through a comment on it — carries that
// issue, and a chat upload comes back with no owner at all.
//
// The chat case is the one the endpoint exists to fix. While this listing was
// scoped to a project, a chat-origin attachment could not appear in it at all,
// because a chat session belonged to no project. The handler must NOT
// synthesise an identifier for those rows: `ENA-0` addresses nothing.
func TestListArtifactsCarriesOwnerIssueOnlyWhenThereIsOne(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	tag := fmt.Sprintf("artifact-%d", time.Now().UnixNano())

	issueID := dbfx.Issue(t, tag+" owner issue")
	commentID := dbfx.Comment(t, issueID, tag+" comment")

	var agentID string
	dbfx.QueryRow(t, `SELECT id FROM agent WHERE workspace_id = $1 LIMIT 1`, testWorkspaceID).Scan(&agentID)
	sessionID := dbfx.ChatSession(t, agentID)

	attach := func(name string, over testutil.Cols) {
		t.Helper()
		dbfx.Insert(t, "attachment", testutil.Cols{
			"workspace_id":    testWorkspaceID,
			"uploader_type":   "member",
			"uploader_id":     testUserID,
			"filename":        name,
			"url":             "https://example.com/" + name,
			"content_type":    "text/plain",
			"size_bytes":      12,
			"issue_id":        over["issue_id"],
			"comment_id":      over["comment_id"],
			"chat_session_id": over["chat_session_id"],
		})
	}
	attach(tag+"-direct.txt", testutil.Cols{"issue_id": issueID})
	attach(tag+"-via-comment.txt", testutil.Cols{"comment_id": commentID})
	attach(tag+"-from-chat.txt", testutil.Cols{"chat_session_id": sessionID})

	var issueNumber int32
	dbfx.QueryRow(t, `SELECT number FROM issue WHERE id = $1`, issueID).Scan(&issueNumber)
	prefix := testHandler.getIssuePrefix(t.Context(), parseUUID(testWorkspaceID))
	wantIdentifier := fmt.Sprintf("%s-%d", prefix, issueNumber)

	artifacts := artifactsFor(t, tag)
	if len(artifacts) != 3 {
		t.Fatalf("listing returned %d of this test's artifacts, want 3: %+v", len(artifacts), artifacts)
	}

	for _, name := range []string{tag + "-direct.txt", tag + "-via-comment.txt"} {
		got := artifacts[name]
		if got.OwnerIssueID != issueID {
			t.Errorf("%s owner_issue_id = %q, want %q", name, got.OwnerIssueID, issueID)
		}
		if got.OwnerIssueNumber != issueNumber {
			t.Errorf("%s owner_issue_number = %d, want %d", name, got.OwnerIssueNumber, issueNumber)
		}
		if got.OwnerIssueIdentifier != wantIdentifier {
			t.Errorf("%s owner_issue_identifier = %q, want %q", name, got.OwnerIssueIdentifier, wantIdentifier)
		}
		if got.OwnerIssueTitle != tag+" owner issue" {
			t.Errorf("%s owner_issue_title = %q", name, got.OwnerIssueTitle)
		}
	}

	// A chat upload has no owning issue. All four owner fields must be absent
	// — in particular the identifier, which would otherwise read `PREFIX-0`.
	chat := artifacts[tag+"-from-chat.txt"]
	if chat.ID == "" {
		t.Fatal("the chat-origin attachment is missing from the workspace artifact listing")
	}
	if chat.OwnerIssueID != "" || chat.OwnerIssueNumber != 0 ||
		chat.OwnerIssueIdentifier != "" || chat.OwnerIssueTitle != "" {
		t.Errorf("chat-origin artifact carries an owner issue: %+v", chat)
	}
}

// The row cap is a UI affordance, so an unusable ?limit takes the default
// rather than erroring, and the response says when the cap was hit — the tree
// the client builds from a truncated listing is only a prefix of the truth.
func TestListArtifactsClampsLimitAndReportsTruncation(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	tag := fmt.Sprintf("artifact-cap-%d", time.Now().UnixNano())
	issueID := dbfx.Issue(t, tag+" issue")
	for i := 0; i < 2; i++ {
		name := fmt.Sprintf("%s-%d.txt", tag, i)
		dbfx.Insert(t, "attachment", testutil.Cols{
			"workspace_id":  testWorkspaceID,
			"issue_id":      issueID,
			"uploader_type": "member",
			"uploader_id":   testUserID,
			"filename":      name,
			"url":           "https://example.com/" + name,
			"content_type":  "text/plain",
			"size_bytes":    12,
		})
	}

	var capped struct {
		Artifacts []ArtifactResponse `json:"artifacts"`
		Truncated bool               `json:"truncated"`
	}
	testutil.Call(t, testHandler.ListArtifacts, newRequest("GET", "/api/artifacts?limit=1", nil)).
		Want(http.StatusOK).JSON(&capped)
	if len(capped.Artifacts) != 1 {
		t.Fatalf("limit=1 returned %d artifacts", len(capped.Artifacts))
	}
	if !capped.Truncated {
		t.Error("a listing that hit its cap must report truncated=true")
	}

	// Unparseable and non-positive limits fall back to the default rather
	// than 400 — and the default is far above two rows, so nothing truncates.
	for _, q := range []string{"?limit=not-a-number", "?limit=0", "?limit=-5", ""} {
		var resp struct {
			Truncated bool `json:"truncated"`
		}
		testutil.Call(t, testHandler.ListArtifacts, newRequest("GET", "/api/artifacts"+q, nil)).
			Want(http.StatusOK).JSON(&resp)
		if resp.Truncated {
			t.Errorf("limit%q should fall back to the default, but the listing truncated", q)
		}
	}
}

func TestArtifactLimit(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want int32
	}{
		{"", defaultArtifactLimit},
		{"not-a-number", defaultArtifactLimit},
		{"0", defaultArtifactLimit},
		{"-5", defaultArtifactLimit},
		{"1", 1},
		{"250", 250},
		{"999999", maxArtifactLimit},
	} {
		t.Run("limit="+tc.raw, func(t *testing.T) {
			if got := artifactLimit(tc.raw); got != tc.want {
				t.Errorf("artifactLimit(%q) = %d, want %d", tc.raw, got, tc.want)
			}
		})
	}
}
