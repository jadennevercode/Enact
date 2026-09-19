package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// Team roles on the CLI are the routing lookup an agent uses: "who reviews this
// kind of work". These tests pin the two things that makes true — the filter
// reaches the server, and a retired role routes nobody.

func newMemberListTestCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "list"}
	cmd.Flags().String("output", "table", "")
	cmd.Flags().StringSlice("team-role", nil, "")
	return cmd
}

func newTeamRoleListTestCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "list"}
	cmd.Flags().String("output", "table", "")
	cmd.Flags().Bool("include-archived", false, "")
	return cmd
}

func TestMemberListSendsTeamRoleFilter(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		_ = json.NewEncoder(w).Encode([]map[string]any{})
	}))
	defer srv.Close()
	setCLITestServerEnv(t, srv.URL)

	cmd := newMemberListTestCmd()
	// Comma-separated and repeated flags have to mean the same thing, or an
	// agent that guesses wrong silently filters on one role.
	_ = cmd.Flags().Set("team-role", "qa,ops")

	if _, err := captureStdout(t, func() error { return runWorkspaceMembers(cmd, nil) }); err != nil {
		t.Fatalf("runWorkspaceMembers: %v", err)
	}
	if gotQuery != "team_role=qa&team_role=ops" {
		t.Fatalf("query = %q, want both role keys sent as repeated parameters", gotQuery)
	}
}

func TestMemberListPrintsPermissionAndTeamRolesSeparately(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode([]map[string]any{{
			"user_id": "u-1",
			"name":    "Ada",
			"email":   "ada@example.com",
			"role":    "admin",
			"team_roles": []map[string]any{
				{"id": "r-1", "key": "qa", "name": "QA", "archived": false},
				{"id": "r-2", "key": "ops", "name": "Ops", "archived": true},
			},
		}})
	}))
	defer srv.Close()
	setCLITestServerEnv(t, srv.URL)

	out, err := captureStdout(t, func() error { return runWorkspaceMembers(newMemberListTestCmd(), nil) })
	if err != nil {
		t.Fatalf("runWorkspaceMembers: %v", err)
	}
	if !strings.Contains(out, "PERMISSION") || !strings.Contains(out, "TEAM ROLES") {
		t.Fatalf("table headers do not separate permission from team roles:\n%s", out)
	}
	if !strings.Contains(out, "qa") {
		t.Fatalf("active role missing from output:\n%s", out)
	}
	// An archived role routes nobody, so printing it in the column an agent
	// reads would invite exactly the routing it can no longer support.
	if strings.Contains(out, "ops") {
		t.Fatalf("archived role leaked into the routing column:\n%s", out)
	}
}

func TestTeamRoleListReportsHoldersIncludingEmptyOnes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/team-roles":
			if r.Header.Get("X-Workspace-ID") != "ws-1" {
				t.Errorf("X-Workspace-ID = %q, want ws-1", r.Header.Get("X-Workspace-ID"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"team_roles": []map[string]any{
				{"id": "r-1", "key": "qa", "name": "QA", "archived_at": nil},
				{"id": "r-2", "key": "ops", "name": "Ops", "archived_at": nil},
			}})
		case strings.HasSuffix(r.URL.Path, "/members"):
			_ = json.NewEncoder(w).Encode([]map[string]any{{
				"user_id":    "u-1",
				"name":       "Ada",
				"email":      "ada@example.com",
				"role":       "admin",
				"team_roles": []map[string]any{{"id": "r-1", "key": "qa", "name": "QA", "archived": false}},
			}})
		default:
			t.Errorf("unexpected path %q", r.URL.Path)
		}
	}))
	defer srv.Close()
	setCLITestServerEnv(t, srv.URL)

	cmd := newTeamRoleListTestCmd()
	_ = cmd.Flags().Set("output", "json")
	out, err := captureStdout(t, func() error { return runWorkspaceTeamRoles(cmd, nil) })
	if err != nil {
		t.Fatalf("runWorkspaceTeamRoles: %v", err)
	}

	var views []struct {
		Key     string `json:"key"`
		Holders []struct {
			UserID string `json:"user_id"`
		} `json:"holders"`
	}
	if err := json.Unmarshal([]byte(out), &views); err != nil {
		t.Fatalf("decode output %q: %v", out, err)
	}
	byKey := map[string]int{}
	for _, view := range views {
		byKey[view.Key] = len(view.Holders)
	}
	if byKey["qa"] != 1 {
		t.Errorf("qa has %d holders, want 1", byKey["qa"])
	}
	// A role nobody holds is the answer to "why did nobody review this", so it
	// is reported with an empty list rather than dropped.
	if count, ok := byKey["ops"]; !ok || count != 0 {
		t.Errorf("unstaffed role missing from output: %v", byKey)
	}
}
