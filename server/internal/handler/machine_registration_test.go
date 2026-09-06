package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Cross-workspace machines (migration 412). The property under test is the one
// the feature exists for: a single computer registered in several workspaces is
// ONE machine, and the facts that belong to the host — its name, its identity —
// are stored once rather than copied per workspace and left to drift.
//
// Before this, the same host produced an independent agent_runtime row per
// workspace per provider, and a rename had to be fanned out by daemon_id with
// no guarantee the copies agreed. `ListDaemonCustomNames` and
// `sharedDaemonCustomName` exist only to paper over that; these tests pin the
// behaviour that replaces them.

// registerDaemonInto runs a daemon registration against one workspace and
// returns the decoded runtime rows.
func registerDaemonInto(t *testing.T, workspaceID, daemonID, deviceName string, providers []string) []AgentRuntimeResponse {
	t.Helper()
	runtimes := make([]map[string]any, 0, len(providers))
	for _, p := range providers {
		runtimes = append(runtimes, map[string]any{
			"type":    p,
			"name":    p,
			"version": "1.2.3",
			"status":  "online",
		})
	}
	w := httptest.NewRecorder()
	req := newRequest("POST", "/api/daemon/register", map[string]any{
		"workspace_id": workspaceID,
		"daemon_id":    daemonID,
		"device_name":  deviceName,
		"runtimes":     runtimes,
	})
	testHandler.DaemonRegister(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("daemon register into %s: %d: %s", workspaceID, w.Code, w.Body.String())
	}
	// The register response is an envelope: runtimes plus the workspace repo
	// snapshot the daemon needs on the same round trip.
	var resp struct {
		Runtimes []AgentRuntimeResponse `json:"runtimes"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode register response: %v (body %s)", err, w.Body.String())
	}
	return resp.Runtimes
}

func cleanupDaemonRegistration(t *testing.T, daemonID string) {
	t.Helper()
	t.Cleanup(func() {
		bg := context.Background()
		testPool.Exec(bg, `DELETE FROM agent WHERE runtime_id IN (SELECT id FROM agent_runtime WHERE daemon_id = $1)`, daemonID)
		testPool.Exec(bg, `DELETE FROM agent_runtime WHERE daemon_id = $1`, daemonID)
		testPool.Exec(bg, `DELETE FROM machine WHERE daemon_id = $1`, daemonID)
	})
}

// TestDaemonRegister_OneMachineAcrossWorkspaces is the core claim. Registering
// the same daemon_id into two workspaces must produce runtime rows in both that
// report the SAME machine_id — that shared id is what lets a client show one
// computer once instead of re-deriving machine identity from daemon_id and
// device-name string parsing.
func TestDaemonRegister_OneMachineAcrossWorkspaces(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	daemonID := "01a0334a-59c9-7dd3-967d-aaaaaaaaaaaa"
	cleanupDaemonRegistration(t, daemonID)
	otherWS := secondWorkspaceFixture(t, ctx, "machine-cross-ws")

	first := registerDaemonInto(t, testWorkspaceID, daemonID, "Shared Laptop", []string{"codex", "claude"})
	second := registerDaemonInto(t, otherWS, daemonID, "Shared Laptop", []string{"codex"})

	machineIDs := map[string]struct{}{}
	for _, rt := range append(append([]AgentRuntimeResponse{}, first...), second...) {
		if rt.MachineID == nil {
			t.Fatalf("runtime %s (%s) has no machine_id", rt.ID, rt.Provider)
		}
		machineIDs[*rt.MachineID] = struct{}{}
	}
	if len(machineIDs) != 1 {
		t.Fatalf("expected one machine across both workspaces, got %d: %v", len(machineIDs), machineIDs)
	}

	// And exactly one row backs it, however many workspaces and providers it
	// was registered with.
	var machineRows int
	testPool.QueryRow(ctx, `SELECT count(*) FROM machine WHERE daemon_id = $1`, daemonID).Scan(&machineRows)
	if machineRows != 1 {
		t.Fatalf("expected 1 machine row for daemon %s, got %d", daemonID, machineRows)
	}

	var workspaces int
	testPool.QueryRow(ctx,
		`SELECT count(DISTINCT workspace_id) FROM agent_runtime WHERE daemon_id = $1`,
		daemonID).Scan(&workspaces)
	if workspaces != 2 {
		t.Fatalf("expected the machine to be projected into 2 workspaces, got %d", workspaces)
	}
}

// TestUpdateMachine_RenameReachesEveryWorkspace pins the write that motivated
// the whole change. One rename must be visible in every workspace the host
// serves. The old per-workspace rename could only ever reach the workspace the
// request arrived through, so the same computer could legitimately carry two
// different names to two teams.
func TestUpdateMachine_RenameReachesEveryWorkspace(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	daemonID := "01a0334a-59c9-7dd3-967d-bbbbbbbbbbbb"
	cleanupDaemonRegistration(t, daemonID)
	otherWS := secondWorkspaceFixture(t, ctx, "machine-rename-ws")

	first := registerDaemonInto(t, testWorkspaceID, daemonID, "Rename Me", []string{"codex"})
	registerDaemonInto(t, otherWS, daemonID, "Rename Me", []string{"codex"})
	machineID := *first[0].MachineID

	w := httptest.NewRecorder()
	req := newRequest("PATCH", "/api/machines/"+machineID, map[string]any{
		"custom_name": "Build Box",
	})
	req = withURLParams(req, "machineId", machineID)
	testHandler.UpdateMachine(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("rename machine: %d: %s", w.Code, w.Body.String())
	}

	var stored string
	testPool.QueryRow(ctx, `SELECT custom_name FROM machine WHERE id = $1`, machineID).Scan(&stored)
	if stored != "Build Box" {
		t.Fatalf("machine custom_name = %q, want %q", stored, "Build Box")
	}

	// The name lives on the machine, so every workspace reads the same value
	// from the same row. Assert through the API surface a client actually uses.
	getMachine := httptest.NewRecorder()
	getReq := withURLParams(newRequest("GET", "/api/machines/"+machineID, nil), "machineId", machineID)
	testHandler.GetMachine(getMachine, getReq)
	if getMachine.Code != http.StatusOK {
		t.Fatalf("get machine: %d: %s", getMachine.Code, getMachine.Body.String())
	}
	var resp MachineResponse
	if err := json.Unmarshal(getMachine.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode machine: %v", err)
	}
	if resp.CustomName == nil || *resp.CustomName != "Build Box" {
		t.Fatalf("machine response custom_name = %v, want Build Box", resp.CustomName)
	}
	if resp.WorkspaceCount != 2 {
		t.Fatalf("machine workspace_count = %d, want 2", resp.WorkspaceCount)
	}
	if len(resp.Workspaces) != 2 {
		t.Fatalf("expected both workspaces listed for a member of both, got %d", len(resp.Workspaces))
	}
}

// TestGetMachine_NonOwnerGets404 keeps a machine from becoming a way to learn
// about someone else's computer — or, through its workspace list, which
// workspaces they belong to. Not-found rather than forbidden, so machine ids
// stay non-enumerable.
func TestGetMachine_NonOwnerGets404(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}
	ctx := context.Background()
	daemonID := "01a0334a-59c9-7dd3-967d-cccccccccccc"
	cleanupDaemonRegistration(t, daemonID)

	registered := registerDaemonInto(t, testWorkspaceID, daemonID, "Someone Elses Box", []string{"codex"})
	machineID := *registered[0].MachineID

	// Hand the machine to another user, then read it as the test user.
	strangerID := "44444444-4444-4444-8444-444444444444"
	if _, err := testPool.Exec(ctx, `UPDATE machine SET owner_id = $1 WHERE id = $2`, strangerID, machineID); err != nil {
		t.Fatalf("reassign machine owner: %v", err)
	}

	w := httptest.NewRecorder()
	req := withURLParams(newRequest("GET", "/api/machines/"+machineID, nil), "machineId", machineID)
	testHandler.GetMachine(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 reading a machine owned by someone else, got %d: %s", w.Code, w.Body.String())
	}

	rename := httptest.NewRecorder()
	renameReq := newRequest("PATCH", "/api/machines/"+machineID, map[string]any{"custom_name": "Mine Now"})
	renameReq = withURLParams(renameReq, "machineId", machineID)
	testHandler.UpdateMachine(rename, renameReq)
	if rename.Code != http.StatusNotFound {
		t.Fatalf("expected 404 renaming a machine owned by someone else, got %d: %s", rename.Code, rename.Body.String())
	}
}
