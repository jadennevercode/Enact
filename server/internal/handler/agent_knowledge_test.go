package handler

import (
	"net/http"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
)

// A knowledge base is a workspace resource that reaches a run only through the
// agent that claimed it. These tests hold the two halves of that sentence: the
// validation that keeps a knowledge_repo ref well-formed, and the routing that
// keeps it out of every brief but the bound agent's.

func newKnowledgeResource(t *testing.T, ref map[string]any, over ...testutil.Cols) string {
	t.Helper()
	body := map[string]any{"resource_type": "knowledge_repo", "resource_ref": ref}
	for _, o := range over {
		for k, v := range o {
			body[k] = v
		}
	}
	var resp struct {
		ID string `json:"id"`
	}
	testutil.Call(t, testHandler.CreateWorkspaceResource,
		newRequest(http.MethodPost, "/api/resources", body)).
		Want(http.StatusCreated).JSON(&resp)
	t.Cleanup(func() {
		dbfx.Exec(t, `DELETE FROM agent_resource WHERE resource_id = $1`, resp.ID)
		dbfx.Exec(t, `DELETE FROM workspace_resource WHERE id = $1`, resp.ID)
	})
	return resp.ID
}

func TestKnowledgeRepoRefValidation(t *testing.T) {
	cases := []struct {
		name string
		ref  map[string]any
		want int
	}{
		{"url required", map[string]any{"path": "docs"}, http.StatusBadRequest},
		{"url must be a git url", map[string]any{"url": "not-a-url"}, http.StatusBadRequest},
		{"absolute path rejected", map[string]any{
			"url": "https://github.com/acme/kb.git", "path": "/etc",
		}, http.StatusBadRequest},
		{"parent traversal rejected", map[string]any{
			"url": "https://github.com/acme/kb.git", "path": "docs/../../etc",
		}, http.StatusBadRequest},
		{"dot segment rejected", map[string]any{
			"url": "https://github.com/acme/kb.git", "path": "./docs",
		}, http.StatusBadRequest},
		{"unknown delivery rejected", map[string]any{
			"url": "https://github.com/acme/kb.git", "delivery": "force-push",
		}, http.StatusBadRequest},
		{"minimal ref accepted", map[string]any{
			"url": "https://github.com/acme/kb-minimal.git",
		}, http.StatusCreated},
		{"full ref accepted", map[string]any{
			"url": "https://github.com/acme/kb-full.git", "ref": "main",
			"path": "docs/knowledge", "delivery": "commit",
		}, http.StatusCreated},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var created struct {
				ID string `json:"id"`
			}
			resp := testutil.Call(t, testHandler.CreateWorkspaceResource,
				newRequest(http.MethodPost, "/api/resources", map[string]any{
					"resource_type": "knowledge_repo",
					"resource_ref":  tc.ref,
				})).Want(tc.want)
			if tc.want == http.StatusCreated {
				resp.JSON(&created)
				dbfx.Exec(t, `DELETE FROM workspace_resource WHERE id = $1`, created.ID)
			}
		})
	}
}

// A path is stored in the one shape the daemon will join onto a checkout root.
// Anything else and the sparse checkout and the index scan disagree about
// where the documents are.
func TestKnowledgeRepoPathNormalized(t *testing.T) {
	id := newKnowledgeResource(t, map[string]any{
		"url":  "https://github.com/acme/kb-normalize.git",
		"path": "  docs/knowledge/  ",
	})
	var path string
	dbfx.QueryRow(t, `SELECT resource_ref->>'path' FROM workspace_resource WHERE id = $1`, id).Scan(&path)
	if path != "docs/knowledge" {
		t.Fatalf("path = %q, want %q", path, "docs/knowledge")
	}
}

func TestAttachAndListAgentKnowledge(t *testing.T) {
	runtimeID := dbfx.Runtime(t, "kb-runtime")
	agentID := dbfx.Agent(t, "kb-agent", runtimeID)
	resourceID := newKnowledgeResource(t, map[string]any{
		"url": "https://github.com/acme/kb-attach.git", "path": "docs",
	}, testutil.Cols{"label": "Domain handbook"})

	var attached struct {
		Sources []struct {
			ResourceID string `json:"resource_id"`
			URL        string `json:"url"`
			Path       string `json:"path"`
			Delivery   string `json:"delivery"`
			Label      string `json:"label"`
		} `json:"knowledge_sources"`
	}
	testutil.Call(t, testHandler.AttachAgentKnowledge, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/agents/"+agentID+"/knowledge",
			map[string]any{"resource_id": resourceID}),
		"id", agentID)).Want(http.StatusOK).JSON(&attached)

	if len(attached.Sources) != 1 {
		t.Fatalf("knowledge_sources = %d, want 1", len(attached.Sources))
	}
	got := attached.Sources[0]
	if got.ResourceID != resourceID || got.Path != "docs" || got.Label != "Domain handbook" {
		t.Fatalf("unexpected binding: %+v", got)
	}
	// The default is not stored on the row; it is applied on the way out, so
	// a resource created before delivery existed still reads as reviewed.
	if got.Delivery != "pull_request" {
		t.Fatalf("delivery = %q, want pull_request", got.Delivery)
	}

	// Attaching twice is the same state, not an error: the settings UI can
	// re-send a selection without the client tracking what it already sent.
	testutil.Call(t, testHandler.AttachAgentKnowledge, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/agents/"+agentID+"/knowledge",
			map[string]any{"resource_id": resourceID}),
		"id", agentID)).Want(http.StatusOK)
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_resource WHERE agent_id = $1`, agentID); n != 1 {
		t.Fatalf("bindings after re-attach = %d, want 1", n)
	}

	var listed struct {
		Total int `json:"total"`
	}
	testutil.Call(t, testHandler.ListAgentKnowledge, testutil.WithURLParams(
		newRequest(http.MethodGet, "/api/agents/"+agentID+"/knowledge", nil),
		"id", agentID)).Want(http.StatusOK).JSON(&listed)
	if listed.Total != 1 {
		t.Fatalf("listed total = %d, want 1", listed.Total)
	}

	testutil.Call(t, testHandler.RemoveAgentKnowledge, testutil.WithURLParams(
		newRequest(http.MethodDelete, "/api/agents/"+agentID+"/knowledge/"+resourceID, nil),
		"id", agentID, "resourceId", resourceID)).Want(http.StatusOK)
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_resource WHERE agent_id = $1`, agentID); n != 0 {
		t.Fatalf("bindings after remove = %d, want 0", n)
	}
}

// Only a knowledge base binds to an agent. A github_repo bound here would be
// code that reaches some agents and not others, which is the split migration
// 438 removed.
func TestAttachAgentKnowledgeRejectsNonKnowledgeResource(t *testing.T) {
	runtimeID := dbfx.Runtime(t, "kb-runtime-reject")
	agentID := dbfx.Agent(t, "kb-agent-reject", runtimeID)

	var repo struct {
		ID string `json:"id"`
	}
	testutil.Call(t, testHandler.CreateWorkspaceResource,
		newRequest(http.MethodPost, "/api/resources", map[string]any{
			"resource_type": "github_repo",
			"resource_ref":  map[string]any{"url": "https://github.com/acme/code.git"},
		})).Want(http.StatusCreated).JSON(&repo)
	t.Cleanup(func() { dbfx.Exec(t, `DELETE FROM workspace_resource WHERE id = $1`, repo.ID) })

	testutil.Call(t, testHandler.AttachAgentKnowledge, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/agents/"+agentID+"/knowledge",
			map[string]any{"resource_id": repo.ID}),
		"id", agentID)).Want(http.StatusBadRequest)
}

// Deleting the resource takes its bindings with it, in one transaction. A
// binding whose resource is gone would be joined on every future claim.
func TestDeleteKnowledgeResourceClearsBindings(t *testing.T) {
	runtimeID := dbfx.Runtime(t, "kb-runtime-delete")
	agentID := dbfx.Agent(t, "kb-agent-delete", runtimeID)
	resourceID := newKnowledgeResource(t, map[string]any{
		"url": "https://github.com/acme/kb-delete.git",
	})
	testutil.Call(t, testHandler.AttachAgentKnowledge, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/agents/"+agentID+"/knowledge",
			map[string]any{"resource_id": resourceID}),
		"id", agentID)).Want(http.StatusOK)

	testutil.Call(t, testHandler.DeleteWorkspaceResource, testutil.WithURLParams(
		newRequest(http.MethodDelete, "/api/resources/"+resourceID, nil),
		"resourceId", resourceID)).Want(http.StatusNoContent)

	if n := dbfx.Count(t, `SELECT count(*) FROM agent_resource WHERE resource_id = $1`, resourceID); n != 0 {
		t.Fatalf("bindings after resource delete = %d, want 0", n)
	}
}

// The claim path is where the design either holds or leaks. A knowledge base
// must be absent from the workspace-wide resource list every agent sees, and
// present for the agent that bound it — including in the repo list, which is
// what the daemon derives its checkout allowlist from.
func TestClaimInjectsKnowledgeOnlyForBoundAgent(t *testing.T) {
	runtimeID := dbfx.Runtime(t, "kb-runtime-claim")
	boundID := dbfx.Agent(t, "kb-agent-bound", runtimeID)
	unboundID := dbfx.Agent(t, "kb-agent-unbound", runtimeID)
	resourceID := newKnowledgeResource(t, map[string]any{
		"url": "https://github.com/acme/kb-claim.git", "path": "docs", "ref": "main",
	}, testutil.Cols{"label": "Handbook"})
	testutil.Call(t, testHandler.AttachAgentKnowledge, testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/agents/"+boundID+"/knowledge",
			map[string]any{"resource_id": resourceID}),
		"id", boundID)).Want(http.StatusOK)

	// A code repo alongside it, to prove the two lists stay separate.
	var repo struct {
		ID string `json:"id"`
	}
	testutil.Call(t, testHandler.CreateWorkspaceResource,
		newRequest(http.MethodPost, "/api/resources", map[string]any{
			"resource_type": "github_repo",
			"resource_ref":  map[string]any{"url": "https://github.com/acme/claim-code.git"},
		})).Want(http.StatusCreated).JSON(&repo)
	t.Cleanup(func() { dbfx.Exec(t, `DELETE FROM workspace_resource WHERE id = $1`, repo.ID) })

	ctx := newRequest(http.MethodGet, "/", nil).Context()

	// The workspace-wide list never carries a knowledge base, whoever asks.
	var wsResp AgentTaskResponse
	testHandler.applyWorkspaceResourcesToClaim(ctx, &wsResp, parseUUID(testWorkspaceID))
	for _, res := range wsResp.WorkspaceResources {
		if res.ResourceType == knowledgeRepoResourceType {
			t.Fatalf("knowledge base leaked into the workspace resource list: %+v", res)
		}
	}
	if len(wsResp.Repos) != 1 || wsResp.Repos[0].Kind != "" {
		t.Fatalf("workspace repos = %+v, want exactly one code repo with no kind", wsResp.Repos)
	}

	// The bound agent gets it, as a knowledge source and as an allowlisted repo.
	boundResp := wsResp
	testHandler.applyAgentKnowledgeToClaim(ctx, &boundResp, parseUUID(boundID))
	if len(boundResp.KnowledgeSources) != 1 {
		t.Fatalf("bound agent knowledge_sources = %d, want 1", len(boundResp.KnowledgeSources))
	}
	src := boundResp.KnowledgeSources[0]
	if src.URL != "https://github.com/acme/kb-claim.git" || src.Path != "docs" ||
		src.Ref != "main" || src.Delivery != "pull_request" || src.Label != "Handbook" {
		t.Fatalf("unexpected knowledge source: %+v", src)
	}
	var knowledgeRepos int
	for _, repo := range boundResp.Repos {
		if repo.Kind == RepoKindKnowledge {
			knowledgeRepos++
			if repo.URL != src.URL {
				t.Fatalf("knowledge repo url = %q, want %q", repo.URL, src.URL)
			}
		}
	}
	if knowledgeRepos != 1 {
		t.Fatalf("knowledge repos in the allowlist = %d, want 1", knowledgeRepos)
	}

	// The unbound agent, in the same workspace, sees none of it.
	unboundResp := wsResp
	testHandler.applyAgentKnowledgeToClaim(ctx, &unboundResp, parseUUID(unboundID))
	if len(unboundResp.KnowledgeSources) != 0 {
		t.Fatalf("unbound agent knowledge_sources = %d, want 0", len(unboundResp.KnowledgeSources))
	}
	for _, repo := range unboundResp.Repos {
		if repo.Kind == RepoKindKnowledge {
			t.Fatalf("unbound agent got a knowledge repo in its allowlist: %+v", repo)
		}
	}
}

// workspaceRepos feeds the autopilot claim path and GetWorkspaceRepos. Neither
// is agent-scoped, so a knowledge base must never appear there.
func TestWorkspaceReposExcludesKnowledge(t *testing.T) {
	newKnowledgeResource(t, map[string]any{"url": "https://github.com/acme/kb-wsrepos.git"})
	ctx := newRequest(http.MethodGet, "/", nil).Context()
	for _, repo := range testHandler.workspaceRepos(ctx, parseUUID(testWorkspaceID)) {
		if repo.URL == "https://github.com/acme/kb-wsrepos.git" {
			t.Fatalf("knowledge base leaked into workspaceRepos: %+v", repo)
		}
	}
}
