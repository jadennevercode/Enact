package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/enact-ai/enact/server/internal/service"
)

func createRetrospectAgent(t *testing.T, body any) *httptest.ResponseRecorder {
	t.Helper()
	req := withChatTestWorkspaceCtx(t, newRequest("POST", "/api/agents/retrospect", body))
	w := httptest.NewRecorder()
	testHandler.CreateRetrospectAgent(w, req)
	return w
}

func cleanupRetrospectAgent(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		testPool.Exec(context.Background(),
			`DELETE FROM agent WHERE workspace_id = $1 AND system_key = $2`,
			testWorkspaceID, service.RetrospectSystemKey)
	})
}

// Configuring the agent is the whole opt-in, so the server owns what it is:
// the caller sends a runtime and a language and nothing else decides identity.
func TestCreateRetrospectAgentServerOwnsTheDefinition(t *testing.T) {
	cleanupRetrospectAgent(t)

	w := createRetrospectAgent(t, map[string]any{
		"runtime_id": handlerTestRuntimeID(t),
		"language":   "en",
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeAgent(t, w)

	if resp.SystemKey != service.RetrospectSystemKey {
		t.Errorf("system_key = %q, want %q — the listener finds the agent by this key", resp.SystemKey, service.RetrospectSystemKey)
	}
	if resp.Name != service.RetrospectDefaultName {
		t.Errorf("name = %q, want %q", resp.Name, service.RetrospectDefaultName)
	}
	// The workspace half starts empty: the product instructions are never
	// written to the row, so a release can update them without overwriting
	// whatever a workspace has added.
	if resp.Instructions != "" {
		t.Errorf("instructions must start empty, got %q", resp.Instructions)
	}
	if !strings.Contains(resp.SystemInstructions, "Retrospect Agent") {
		t.Errorf("system_instructions should carry the product prompt, got %q", resp.SystemInstructions)
	}

	// kind stays 'user' so the agent keeps appearing in agent lists and
	// assignment surfaces — assigning an issue to it by hand is one of the
	// three ways to ask for a retrospect — and survives runtime teardown.
	var kind string
	if err := testPool.QueryRow(context.Background(),
		`SELECT kind FROM agent WHERE id = $1`, resp.ID).Scan(&kind); err != nil {
		t.Fatalf("load agent kind: %v", err)
	}
	if kind != "user" {
		t.Errorf("kind = %q, want \"user\" — 'system' hides the row and deletes it with its runtime", kind)
	}
}

// Two people configuring at once, or one person retrying, must not leave the
// workspace with two Retrospect Agents: each would file its own sub-issue under
// every finished issue.
func TestCreateRetrospectAgentIsIdempotentPerWorkspace(t *testing.T) {
	cleanupRetrospectAgent(t)
	runtimeID := handlerTestRuntimeID(t)

	first := createRetrospectAgent(t, map[string]any{"runtime_id": runtimeID, "language": "en"})
	if first.Code != http.StatusCreated {
		t.Fatalf("first call: expected 201, got %d: %s", first.Code, first.Body.String())
	}
	second := createRetrospectAgent(t, map[string]any{"runtime_id": runtimeID, "language": "zh"})
	if second.Code != http.StatusOK {
		t.Fatalf("second call: expected 200, got %d: %s", second.Code, second.Body.String())
	}
	if a, b := decodeAgent(t, first).ID, decodeAgent(t, second).ID; a != b {
		t.Fatalf("expected the same agent back, got %s then %s", a, b)
	}

	var count int
	if err := testPool.QueryRow(context.Background(),
		`SELECT count(*) FROM agent WHERE workspace_id = $1 AND system_key = $2`,
		testWorkspaceID, service.RetrospectSystemKey).Scan(&count); err != nil {
		t.Fatalf("count retrospect agents: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 Retrospect Agent in the workspace, got %d", count)
	}
}

func TestCreateRetrospectAgentRejectsUnsupportedLanguage(t *testing.T) {
	cleanupRetrospectAgent(t)
	w := createRetrospectAgent(t, map[string]any{"runtime_id": handlerTestRuntimeID(t), "language": "fr"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// A workspace turns the loop off by archiving the agent. Configuring again must
// hand back the archived row rather than minting a second one, or "turn it off"
// becomes a button that stops working.
func TestCreateRetrospectAgentReturnsAnArchivedAgentRatherThanASecond(t *testing.T) {
	cleanupRetrospectAgent(t)
	runtimeID := handlerTestRuntimeID(t)

	first := createRetrospectAgent(t, map[string]any{"runtime_id": runtimeID, "language": "en"})
	if first.Code != http.StatusCreated {
		t.Fatalf("first call: expected 201, got %d: %s", first.Code, first.Body.String())
	}
	agentID := decodeAgent(t, first).ID

	if _, err := testPool.Exec(context.Background(),
		`UPDATE agent SET archived_at = now() WHERE id = $1`, agentID); err != nil {
		t.Fatalf("archive agent: %v", err)
	}

	second := createRetrospectAgent(t, map[string]any{"runtime_id": runtimeID, "language": "en"})
	if second.Code != http.StatusOK {
		t.Fatalf("second call: expected 200, got %d: %s", second.Code, second.Body.String())
	}
	if got := decodeAgent(t, second).ID; got != agentID {
		t.Fatalf("expected the archived agent back, got %s (was %s)", got, agentID)
	}

	var count int
	if err := testPool.QueryRow(context.Background(),
		`SELECT count(*) FROM agent WHERE workspace_id = $1 AND system_key = $2`,
		testWorkspaceID, service.RetrospectSystemKey).Scan(&count); err != nil {
		t.Fatalf("count retrospect agents: %v", err)
	}
	if count != 1 {
		t.Fatalf("archiving then re-configuring produced %d agents, want 1", count)
	}
}

// Nothing seeds the agent. A workspace that has never asked for one must not
// have one, because having one is what turns the retrospect loop on.
func TestNewWorkspaceHasNoRetrospectAgent(t *testing.T) {
	var count int
	if err := testPool.QueryRow(context.Background(),
		`SELECT count(*) FROM agent WHERE workspace_id = $1 AND system_key = $2`,
		testWorkspaceID, service.RetrospectSystemKey).Scan(&count); err != nil {
		t.Fatalf("count retrospect agents: %v", err)
	}
	if count != 0 {
		t.Fatalf("workspace was seeded with %d Retrospect Agents, want 0 — the feature is opt-in", count)
	}
}
