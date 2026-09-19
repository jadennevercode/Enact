package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/go-chi/chi/v5"
)

func vcsHandlerRequest(method, path string, body any, connectionID string) *http.Request {
	req := newRequest(method, path, body)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", testWorkspaceID)
	if connectionID != "" {
		rctx.URLParams.Add("connectionId", connectionID)
	}
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func TestListVCSConnectionsReportsEncryptionKeyState(t *testing.T) {
	ctx := context.Background()
	box := withVCSBox(t)
	connID := seedVCSConnection(t, ctx, box, "forgejo", "https://forgejo-list.test")
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })

	fetch := func() struct {
		Connections []VCSConnectionResponse `json:"connections"`
		Configured  bool                    `json:"configured"`
	} {
		t.Helper()
		req := vcsHandlerRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/vcs/connections", nil, "")
		w := httptest.NewRecorder()
		testHandler.ListVCSConnections(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("ListVCSConnections: expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var resp struct {
			Connections []VCSConnectionResponse `json:"connections"`
			Configured  bool                    `json:"configured"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode ListVCSConnections: %v", err)
		}
		return resp
	}

	// Without a key the section still lists what is stored — an operator needs
	// to see the connections that exist in order to understand why they stopped
	// working — but reports configured=false so the UI shows setup guidance
	// instead of a connect form that would fail.
	testHandler.VCSSecretBox = nil
	unconfigured := fetch()
	if unconfigured.Configured {
		t.Fatalf("response must report configured=false without an encryption key, got %+v", unconfigured)
	}
	testHandler.VCSSecretBox = box

	configured := fetch()
	if !configured.Configured {
		t.Fatalf("response must report configured=true with an encryption key, got %+v", configured)
	}
	if len(configured.Connections) != 1 || configured.Connections[0].ID != connID {
		t.Fatalf("response must include seeded connection %s, got %+v", connID, configured.Connections)
	}
}

func TestConnectVCSRequiresEncryptionKey(t *testing.T) {
	var validationCalls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		validationCalls.Add(1)
		if r.URL.Path != "/api/v1/user" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"login":"vcs-test-user"}`))
	}))
	defer provider.Close()

	withVCSBox(t)
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })
	body := map[string]any{
		"provider":     "forgejo",
		"instance_url": provider.URL,
		"access_token": "test-token",
	}
	connect := func() *httptest.ResponseRecorder {
		t.Helper()
		req := vcsHandlerRequest(http.MethodPost, "/api/workspaces/"+testWorkspaceID+"/vcs/connections", body, "")
		w := httptest.NewRecorder()
		testHandler.ConnectVCS(w, req)
		return w
	}
	countConnections := func() int {
		t.Helper()
		var count int
		if err := testPool.QueryRow(context.Background(),
			`SELECT count(*) FROM vcs_connection WHERE workspace_id = $1 AND instance_url = $2`,
			testWorkspaceID, provider.URL,
		).Scan(&count); err != nil {
			t.Fatalf("count VCS connections: %v", err)
		}
		return count
	}

	// The gate must short-circuit before the token reaches the network: a
	// deployment with no key has nowhere to seal the credential, so reaching
	// the provider at all would send a secret it could never store.
	box := testHandler.VCSSecretBox
	testHandler.VCSSecretBox = nil
	if w := connect(); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured ConnectVCS: expected 503, got %d: %s", w.Code, w.Body.String())
	}
	if got := validationCalls.Load(); got != 0 {
		t.Fatalf("unconfigured ConnectVCS must not call provider, got %d requests", got)
	}
	if got := countConnections(); got != 0 {
		t.Fatalf("unconfigured ConnectVCS must not write a connection, got %d rows", got)
	}
	testHandler.VCSSecretBox = box

	if w := connect(); w.Code != http.StatusOK {
		t.Fatalf("configured ConnectVCS: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if got := validationCalls.Load(); got != 1 {
		t.Fatalf("configured ConnectVCS: expected one provider validation, got %d", got)
	}
	if got := countConnections(); got != 1 {
		t.Fatalf("configured ConnectVCS: expected one stored connection, got %d", got)
	}
}

func TestRotateVCSConnectionWebhookRequiresEncryptionKey(t *testing.T) {
	ctx := context.Background()
	box := withVCSBox(t)
	connID := seedVCSConnection(t, ctx, box, "forgejo", "https://forgejo-rotate.test")
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })
	connUUID := parseUUID(connID)

	loadSecret := func() string {
		t.Helper()
		conn, err := testHandler.Queries.GetVCSConnectionByID(context.Background(), connUUID)
		if err != nil {
			t.Fatalf("GetVCSConnectionByID: %v", err)
		}
		return conn.WebhookSecretEncrypted
	}
	rotate := func() *httptest.ResponseRecorder {
		t.Helper()
		req := vcsHandlerRequest(
			http.MethodPost,
			"/api/workspaces/"+testWorkspaceID+"/vcs/connections/"+connID+"/rotate-webhook",
			nil,
			connID,
		)
		w := httptest.NewRecorder()
		testHandler.RotateVCSConnectionWebhook(w, req)
		return w
	}

	originalSecret := loadSecret()
	testHandler.VCSSecretBox = nil
	if w := rotate(); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured RotateVCSConnectionWebhook: expected 503, got %d: %s", w.Code, w.Body.String())
	}
	if got := loadSecret(); got != originalSecret {
		t.Fatal("unconfigured RotateVCSConnectionWebhook must not modify the stored secret")
	}
	testHandler.VCSSecretBox = box

	if w := rotate(); w.Code != http.StatusOK {
		t.Fatalf("configured RotateVCSConnectionWebhook: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if got := loadSecret(); got == originalSecret {
		t.Fatal("configured RotateVCSConnectionWebhook must replace the stored secret")
	}
}
