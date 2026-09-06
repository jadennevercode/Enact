package handler

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/testutil"
)

type artifactListing struct {
	Artifacts    []ArtifactResponse `json:"artifacts"`
	Total        int                `json:"total"`
	Truncated    bool               `json:"truncated"`
	ScopeIssueID string             `json:"scope_issue_id"`
}

func (l artifactListing) byName() map[string]ArtifactResponse {
	out := make(map[string]ArtifactResponse, len(l.Artifacts))
	for _, a := range l.Artifacts {
		out[a.Filename] = a
	}
	return out
}

// listIssueArtifacts calls the issue-scoped endpoint. Unlike the workspace
// listing this replaced, the scope is the filter, so nothing here has to sift
// the shared fixture workspace's other files back out.
func listIssueArtifacts(t *testing.T, issueID, query string) artifactListing {
	t.Helper()
	var out artifactListing
	testutil.Call(t, testHandler.ListIssueArtifacts,
		withURLParam(newRequest("GET", "/api/issues/"+issueID+"/artifacts"+query, nil), "id", issueID)).
		Want(http.StatusOK).JSON(&out)
	if out.Total != len(out.Artifacts) {
		t.Fatalf("total = %d but %d artifacts came back", out.Total, len(out.Artifacts))
	}
	return out
}

func listChatArtifacts(t *testing.T, sessionID, query string) artifactListing {
	t.Helper()
	var out artifactListing
	testutil.Call(t, testHandler.ListChatSessionArtifacts,
		withChatTestWorkspaceCtx(t, withURLParam(
			newRequest("GET", "/api/chat/sessions/"+sessionID+"/artifacts"+query, nil), "sessionId", sessionID))).
		Want(http.StatusOK).JSON(&out)
	if out.Total != len(out.Artifacts) {
		t.Fatalf("total = %d but %d artifacts came back", out.Total, len(out.Artifacts))
	}
	return out
}

func attachFile(t *testing.T, name string, over testutil.Cols) {
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

func anyWorkspaceAgent(t *testing.T) string {
	t.Helper()
	var agentID string
	dbfx.QueryRow(t, `SELECT id FROM agent WHERE workspace_id = $1 LIMIT 1`, testWorkspaceID).Scan(&agentID)
	return agentID
}

// TestListIssueArtifactsCollectsCommentsAndChildren is the contract of
// GET /api/issues/{id}/artifacts: the issue's own files, the files attached
// through a comment on it, and the files its direct children produced — each
// row tagged with the issue that actually produced it, so the client can put
// delegated work in its own folder.
//
// Chat uploads must not leak in. The workspace-wide listing this replaced
// showed them under an "unfiled" group; scoped to an issue there is no such
// group, and a file with no issue edge belongs to no issue.
func TestListIssueArtifactsCollectsCommentsAndChildren(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	tag := fmt.Sprintf("artifact-%d", time.Now().UnixNano())

	parentID := dbfx.Issue(t, tag+" parent issue")
	commentID := dbfx.Comment(t, parentID, tag+" comment")
	childID := dbfx.Issue(t, tag+" child issue", testutil.Cols{"parent_issue_id": parentID})
	strangerID := dbfx.Issue(t, tag+" unrelated issue")
	sessionID := dbfx.ChatSession(t, anyWorkspaceAgent(t))

	attachFile(t, tag+"-direct.txt", testutil.Cols{"issue_id": parentID})
	attachFile(t, tag+"-via-comment.txt", testutil.Cols{"comment_id": commentID})
	attachFile(t, tag+"-from-child.txt", testutil.Cols{"issue_id": childID})
	attachFile(t, tag+"-from-stranger.txt", testutil.Cols{"issue_id": strangerID})
	attachFile(t, tag+"-from-chat.txt", testutil.Cols{"chat_session_id": sessionID})

	var parentNumber, childNumber int32
	dbfx.QueryRow(t, `SELECT number FROM issue WHERE id = $1`, parentID).Scan(&parentNumber)
	dbfx.QueryRow(t, `SELECT number FROM issue WHERE id = $1`, childID).Scan(&childNumber)
	prefix := testHandler.getIssuePrefix(t.Context(), parseUUID(testWorkspaceID))

	listing := listIssueArtifacts(t, parentID, "")
	got := listing.byName()

	if len(got) != 3 {
		t.Fatalf("issue listing returned %d artifacts, want 3 (own, via comment, child): %v", len(got), got)
	}
	if listing.ScopeIssueID != parentID {
		t.Errorf("scope_issue_id = %q, want the requested issue %q", listing.ScopeIssueID, parentID)
	}

	// Own files and comment-borne files both carry the issue itself.
	for _, name := range []string{tag + "-direct.txt", tag + "-via-comment.txt"} {
		a := got[name]
		if a.OwnerIssueID != parentID {
			t.Errorf("%s owner_issue_id = %q, want the parent %q", name, a.OwnerIssueID, parentID)
		}
		if a.OwnerIssueNumber != parentNumber {
			t.Errorf("%s owner_issue_number = %d, want %d", name, a.OwnerIssueNumber, parentNumber)
		}
		if want := fmt.Sprintf("%s-%d", prefix, parentNumber); a.OwnerIssueIdentifier != want {
			t.Errorf("%s owner_issue_identifier = %q, want %q", name, a.OwnerIssueIdentifier, want)
		}
		if a.OwnerIssueTitle != tag+" parent issue" {
			t.Errorf("%s owner_issue_title = %q", name, a.OwnerIssueTitle)
		}
	}

	// A child's file is listed, but tagged with the child — that tag is the
	// only thing separating delegated work from the issue's own in the UI.
	child := got[tag+"-from-child.txt"]
	if child.OwnerIssueID != childID {
		t.Errorf("child artifact owner_issue_id = %q, want the child %q", child.OwnerIssueID, childID)
	}
	if child.OwnerIssueNumber != childNumber {
		t.Errorf("child artifact owner_issue_number = %d, want %d", child.OwnerIssueNumber, childNumber)
	}

	if _, leaked := got[tag+"-from-stranger.txt"]; leaked {
		t.Error("an unrelated issue's artifact appeared in this issue's listing")
	}
	if _, leaked := got[tag+"-from-chat.txt"]; leaked {
		t.Error("a chat upload appeared in an issue listing; it owns no issue edge")
	}
}

// A grandchild's files stay out. The listing walks one level on purpose, so
// the folder list stays readable; this pins that depth rather than letting it
// drift into a recursive walk unnoticed.
func TestListIssueArtifactsStopsAtDirectChildren(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	tag := fmt.Sprintf("artifact-depth-%d", time.Now().UnixNano())

	parentID := dbfx.Issue(t, tag+" parent")
	childID := dbfx.Issue(t, tag+" child", testutil.Cols{"parent_issue_id": parentID})
	grandchildID := dbfx.Issue(t, tag+" grandchild", testutil.Cols{"parent_issue_id": childID})

	attachFile(t, tag+"-child.txt", testutil.Cols{"issue_id": childID})
	attachFile(t, tag+"-grandchild.txt", testutil.Cols{"issue_id": grandchildID})

	got := listIssueArtifacts(t, parentID, "").byName()
	if _, ok := got[tag+"-child.txt"]; !ok {
		t.Error("a direct child's artifact is missing from the parent's listing")
	}
	if _, ok := got[tag+"-grandchild.txt"]; ok {
		t.Error("a grandchild's artifact reached the parent's listing; the walk is one level deep")
	}
}

// The issue scope is resolved through loadIssueForUser, so an issue in another
// workspace is a 404 rather than a listing of someone else's files.
func TestListIssueArtifactsRejectsForeignIssue(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	tag := fmt.Sprintf("artifact-foreign-%d", time.Now().UnixNano())

	otherWorkspaceID := dbfx.Workspace(t, tag+" workspace", tag)
	foreignIssueID := dbfx.Issue(t, tag+" foreign issue", testutil.Cols{"workspace_id": otherWorkspaceID})

	testutil.Call(t, testHandler.ListIssueArtifacts,
		withURLParam(newRequest("GET", "/api/issues/"+foreignIssueID+"/artifacts", nil), "id", foreignIssueID)).
		Want(http.StatusNotFound)
}

// TestListChatSessionArtifactsIsScopedToTheSession is the contract of
// GET /api/chat/sessions/{sessionId}/artifacts: the session's own uploads and
// nothing else. Chat files have no owning issue, so the owner fields must stay
// absent — in particular the identifier, which would otherwise read `PREFIX-0`.
func TestListChatSessionArtifactsIsScopedToTheSession(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	tag := fmt.Sprintf("artifact-chat-%d", time.Now().UnixNano())

	agentID := anyWorkspaceAgent(t)
	sessionID := dbfx.ChatSession(t, agentID)
	otherSessionID := dbfx.ChatSession(t, agentID)
	issueID := dbfx.Issue(t, tag+" issue")

	attachFile(t, tag+"-mine.txt", testutil.Cols{"chat_session_id": sessionID})
	attachFile(t, tag+"-other-session.txt", testutil.Cols{"chat_session_id": otherSessionID})
	attachFile(t, tag+"-from-issue.txt", testutil.Cols{"issue_id": issueID})

	listing := listChatArtifacts(t, sessionID, "")
	got := listing.byName()

	if len(got) != 1 {
		t.Fatalf("chat listing returned %d artifacts, want just this session's: %v", len(got), got)
	}
	mine := got[tag+"-mine.txt"]
	if mine.ID == "" {
		t.Fatal("the session's own upload is missing from its artifact listing")
	}
	if mine.OwnerIssueID != "" || mine.OwnerIssueNumber != 0 ||
		mine.OwnerIssueIdentifier != "" || mine.OwnerIssueTitle != "" {
		t.Errorf("a chat artifact carries an owner issue: %+v", mine)
	}
	if listing.ScopeIssueID != "" {
		t.Errorf("chat listing carries scope_issue_id = %q; the chat scope has no issue", listing.ScopeIssueID)
	}
}

// The chat scope is gated exactly like the transcript, so another member's
// session is not readable through its files.
func TestListChatSessionArtifactsRejectsAnotherMembersSession(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	tag := fmt.Sprintf("artifact-chat-acl-%d", time.Now().UnixNano())

	strangerID := dbfx.User(t, tag+" stranger", tag+"@example.com")
	sessionID := dbfx.ChatSession(t, anyWorkspaceAgent(t), testutil.Cols{"creator_id": strangerID})
	attachFile(t, tag+"-secret.txt", testutil.Cols{"chat_session_id": sessionID})

	testutil.Call(t, testHandler.ListChatSessionArtifacts,
		withChatTestWorkspaceCtx(t, withURLParam(
			newRequest("GET", "/api/chat/sessions/"+sessionID+"/artifacts", nil), "sessionId", sessionID))).
		Want(http.StatusForbidden)
}

// The row cap is a UI affordance, so an unusable ?limit takes the default
// rather than erroring, and the response says when the cap was hit — the tree
// the client builds from a truncated listing is only a prefix of the truth.
func TestListIssueArtifactsClampsLimitAndReportsTruncation(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	tag := fmt.Sprintf("artifact-cap-%d", time.Now().UnixNano())
	issueID := dbfx.Issue(t, tag+" issue")
	for i := 0; i < 2; i++ {
		attachFile(t, fmt.Sprintf("%s-%d.txt", tag, i), testutil.Cols{"issue_id": issueID})
	}

	capped := listIssueArtifacts(t, issueID, "?limit=1")
	if len(capped.Artifacts) != 1 {
		t.Fatalf("limit=1 returned %d artifacts", len(capped.Artifacts))
	}
	if !capped.Truncated {
		t.Error("a listing that hit its cap must report truncated=true")
	}

	// Unparseable and non-positive limits fall back to the default rather
	// than 400 — and the default is far above two rows, so nothing truncates.
	for _, q := range []string{"?limit=not-a-number", "?limit=0", "?limit=-5", ""} {
		if listIssueArtifacts(t, issueID, q).Truncated {
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
