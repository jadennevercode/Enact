package daemon

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/enact-ai/enact/server/pkg/contextstate"
)

func TestContextMaintenanceNeverReleasesWithoutProcessExitProof(t *testing.T) {
	received := make(chan contextstate.Update, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var update contextstate.Update
		if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
			t.Error(err)
		}
		received <- update
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()
	d := &Daemon{cfg: Config{WorkspacesRoot: t.TempDir()}, client: NewClient(server.URL), logger: slog.Default()}
	session := contextstate.Session{ID: "session", Operation: &contextstate.Operation{ID: "operation"}}
	launch := &contextLaunch{ProcessStarting: true}
	d.reportContextMaintenance(session, contextstate.Update{Status: "failed", LeaseToken: "lease", Epoch: 1}, launch)
	first := <-received
	if first.Release || first.Status != "reconciliation_required" {
		t.Fatalf("released uncertain native writer: %+v", first)
	}
	launch.ProcessStarting = false
	launch.CleanupConfirmed = true
	d.reportContextMaintenance(session, contextstate.Update{Status: "closed_unknown", LeaseToken: "lease", Epoch: 1}, launch)
	last := <-received
	if !last.Release || last.Status != "closed_unknown" {
		t.Fatalf("confirmed safe recovery stayed occupied: %+v", last)
	}
	if launch.Receipt == nil || launch.Receipt.OperationID != "operation" {
		t.Fatal("recovery did not retain the exact operation receipt")
	}
}

func TestContextCapabilityVersionIgnoresCustomProfileProbeCache(t *testing.T) {
	d := &Daemon{
		runtimeIndex:  map[string]Runtime{"builtin": {ID: "builtin", Provider: "codex"}, "custom": {ID: "custom", Provider: "codex", ProfileID: "profile"}},
		agentVersions: map[string]string{"codex": "99.0.0"},
		workspaces:    map[string]*workspaceState{"workspace": {runtimeIDs: []string{"builtin", "custom"}, builtinVersions: map[string]string{"codex": "0.100.0"}}},
	}
	if got := d.contextRuntimeVersion("builtin"); got != "0.100.0" {
		t.Fatalf("custom probe contaminated built-in gate: %s", got)
	}
	if got := d.contextRuntimeVersion("custom"); got != "" {
		t.Fatalf("custom profile inherited native control: %s", got)
	}
}
