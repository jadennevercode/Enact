package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/modeloperation"
)

func TestModelOperationRetriesOnlyResultDelivery(t *testing.T) {
	if os.PathSeparator == '\\' {
		t.Skip("shell fixture")
	}
	for _, tc := range []struct {
		name      string
		permanent bool
		attempts  int32
	}{
		{name: "lost response then temporary outage", attempts: 3},
		{name: "authorization rejection", permanent: true, attempts: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			counter := filepath.Join(dir, "invocations")
			path := filepath.Join(dir, "fake-claude")
			// This counts model invocations, independently of HTTP retries.
			script := "#!/bin/sh\nread request || exit 1\nprintf x >> '" + counter + "'\nprintf '%s\\n' '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"structured_output\":{\"answer\":42}}'\n"
			if err := os.WriteFile(path, []byte(script), 0700); err != nil {
				t.Fatal(err)
			}
			var attempts atomic.Int32
			var first []byte
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/status") {
					_, _ = io.WriteString(w, `{"status":"running"}`)
					return
				}
				if !strings.HasSuffix(r.URL.Path, "/model-operations/operation/result") {
					t.Errorf("unexpected request %s", r.URL.Path)
					http.NotFound(w, r)
					return
				}
				body, _ := io.ReadAll(r.Body)
				attempt := attempts.Add(1)
				if attempt == 1 {
					first = body
				} else if !bytes.Equal(first, body) {
					t.Error("delivery retry changed the leased result")
				}
				var result map[string]any
				_ = json.Unmarshal(body, &result)
				if result["lease_token"] != "lease" || result["status"] != "completed" {
					t.Errorf("unexpected result %s", body)
				}
				if tc.permanent {
					http.Error(w, "unauthorized", http.StatusUnauthorized)
					return
				}
				if attempt == 1 {
					// The server may have accepted the result before losing its
					// response. Replaying this lease must not invoke the model.
					conn, _, err := w.(http.Hijacker).Hijack()
					if err != nil {
						t.Error(err)
						return
					}
					_ = conn.Close()
					return
				}
				if attempt == 2 {
					http.Error(w, "restarting", http.StatusServiceUnavailable)
					return
				}
				_, _ = io.WriteString(w, `{}`)
			}))
			defer server.Close()
			d := New(Config{ServerBaseURL: server.URL, Agents: map[string]AgentEntry{"claude": {Path: path}}}, slog.New(slog.NewTextHandler(io.Discard, nil)))
			d.client = NewClient(server.URL)
			d.client.SetToken("test-token")
			d.runModelOperation(context.Background(), Runtime{ID: "runtime", Provider: "claude"}, modeloperation.Operation{ID: "operation", TaskID: "parent", RuntimeID: "runtime", Prompt: "count", ResponseSchema: json.RawMessage(`{"type":"object"}`), TimeoutSeconds: 10, LeaseToken: "lease"})
			if got := attempts.Load(); got != tc.attempts {
				t.Fatalf("result delivery attempts=%d, want %d", got, tc.attempts)
			}
			if count, err := os.ReadFile(counter); err != nil || string(count) != "x" {
				t.Fatalf("model must execute exactly once: count=%q error=%v", count, err)
			}
		})
	}
}

func TestModelOperationIndependentLaneRunsWhileParentOccupiesOnlyTaskSlot(t *testing.T) {
	if os.PathSeparator == '\\' {
		t.Skip("shell fixture")
	}
	path := filepath.Join(t.TempDir(), "fake-claude")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nread request\nprintf '%s\\n' '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"structured_output\":{\"answer\":42}}'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	reported := make(chan map[string]any, 1)
	var claimed atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/claim"):
			if claimed.Swap(true) {
				_, _ = io.WriteString(w, `{"operation":null}`)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"operation": modeloperation.Operation{ID: "operation", TaskID: "parent", RuntimeID: "runtime", Provider: "claude", Prompt: "count", ResponseSchema: json.RawMessage(`{"type":"object"}`), TimeoutSeconds: 10, LeaseToken: "lease"}})
		case strings.HasSuffix(r.URL.Path, "/result"):
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			reported <- body
			_, _ = io.WriteString(w, `{}`)
		case strings.HasSuffix(r.URL.Path, "/status"):
			_, _ = io.WriteString(w, `{"status":"running"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	d := New(Config{ServerBaseURL: server.URL, MaxConcurrentTasks: 1, Agents: map[string]AgentEntry{"claude": {Path: path}}}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	d.client = NewClient(server.URL)
	d.client.SetToken("test-token")
	d.workspaces = map[string]*workspaceState{"workspace": {workspaceID: "workspace", runtimeIDs: []string{"runtime"}}}
	d.runtimeIndex = map[string]Runtime{"runtime": {ID: "runtime", Provider: "claude"}}
	d.activeTasks.Store(1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go d.modelOperationLoop(ctx)
	select {
	case result := <-reported:
		if result["status"] != "completed" {
			t.Fatalf("result=%v", result)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("model operation blocked behind its waiting parent")
	}
}
