package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/mmm"
)

func TestMMMAgentCommandsRegistered(t *testing.T) {
	bootstrap, _, err := mmmCmd.Find([]string{"agent", "bootstrap"})
	if err != nil || bootstrap.Name() != "bootstrap" {
		t.Fatalf("mmm agent bootstrap subcommand not found: %v", err)
	}
	for _, flag := range []string{"runtime-id", "force", "skip-import", "skip-autopilot", "cron", "timezone"} {
		if bootstrap.Flags().Lookup(flag) == nil {
			t.Errorf("mmm agent bootstrap missing --%s flag", flag)
		}
	}

	verify, _, err := mmmCmd.Find([]string{"verify"})
	if err != nil || verify.Name() != "verify" {
		t.Fatalf("mmm verify subcommand not found: %v", err)
	}
	if verify.Flags().Lookup("runtime-id") == nil {
		t.Error("mmm verify missing --runtime-id flag")
	}
}

// newBootstrapTestCmd builds a standalone command carrying the bootstrap flags
// plus the persistent --profile flag the API-client resolver needs.
func newBootstrapTestCmd() *cobra.Command {
	c := &cobra.Command{Use: "bootstrap"}
	registerMMMAgentBootstrapFlags(c)
	c.Flags().String("profile", "", "")
	return c
}

// bootstrapEnv points the CLI at the mock server and neutralizes any ambient
// daemon-task or MMM config state on the developer machine.
func bootstrapEnv(t *testing.T, serverURL string) {
	t.Helper()
	t.Setenv("ENACT_SERVER_URL", serverURL)
	t.Setenv("ENACT_WORKSPACE_ID", "ws-1")
	t.Setenv("ENACT_TOKEN", "test-token")
	t.Setenv("ENACT_AGENT_ID", "")
	t.Setenv("ENACT_TASK_ID", "")
	t.Setenv("ENACT_DAEMON_PORT", "")
	// detectEngineEnv reads ~/.enact/mmm.yaml; isolate from the real home.
	t.Setenv("HOME", t.TempDir())
}

// bootstrapRecorder captures the mutating requests the bootstrap performs.
type bootstrapRecorder struct {
	agentCreates  []map[string]any
	skillBindings map[string][]string // agent ID -> skill IDs
	squadCreates  []map[string]any
	memberAdds    []map[string]any
	apCreates     []map[string]any
	triggerAdds   []map[string]any
}

// bootstrapWorkspace is the starting state a mock server serves.
type bootstrapWorkspace struct {
	agents       []map[string]any
	squads       []map[string]any
	squadMembers []map[string]any
	autopilots   []map[string]any
	triggers     []any
}

// populatedWorkspace returns the state a completed bootstrap leaves behind:
// every portfolio agent bound to rt-1, the squad with all members, and an
// active autopilot carrying a schedule trigger.
func populatedWorkspace() bootstrapWorkspace {
	manifest := mmm.DefaultAgentManifest()
	ws := bootstrapWorkspace{
		squads:     []map[string]any{{"id": "squad-1", "name": manifest.Squad.Name, "leader_id": "agent-" + manifest.Squad.LeaderName}},
		autopilots: []map[string]any{{"id": "ap-1", "title": manifest.Autopilot.Title, "status": "active"}},
		triggers: []any{map[string]any{
			"id": "tr-1", "kind": "schedule",
			"cron_expression": manifest.Autopilot.DefaultCron,
			"timezone":        manifest.Autopilot.DefaultTimezone,
		}},
	}
	for _, spec := range manifest.Agents {
		ws.agents = append(ws.agents, map[string]any{
			"id":                   "agent-" + spec.Name,
			"name":                 spec.Name,
			"runtime_id":           "rt-1",
			"max_concurrent_tasks": spec.MaxConcurrentTasks,
		})
	}
	for _, name := range manifest.Squad.MemberNames {
		ws.squadMembers = append(ws.squadMembers, map[string]any{
			"member_type": "agent",
			"member_id":   "agent-" + name,
			"role":        "member",
		})
	}
	return ws
}

// bootstrapMockServer serves a workspace in the given starting state and
// records every mutation. Created agents get the ID "agent-<name>".
func bootstrapMockServer(t *testing.T, ws bootstrapWorkspace, rec *bootstrapRecorder) *httptest.Server {
	t.Helper()
	rec.skillBindings = map[string][]string{}

	skills := make([]map[string]any, 0, len(mmm.RuntimeSkillNames))
	for _, name := range mmm.RuntimeSkillNames {
		skills = append(skills, map[string]any{"id": "sk-" + name, "name": name})
	}

	decode := func(r *http.Request) map[string]any {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode %s %s body: %v", r.Method, r.URL.Path, err)
		}
		return body
	}

	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/skills":
			_ = json.NewEncoder(w).Encode(skills)
		case r.Method == http.MethodGet && r.URL.Path == "/api/agents":
			_ = json.NewEncoder(w).Encode(ws.agents)
		case r.Method == http.MethodPost && r.URL.Path == "/api/agents":
			body := decode(r)
			rec.agentCreates = append(rec.agentCreates, body)
			name, _ := body["name"].(string)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "agent-" + name, "name": name})
		case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/agents/") && strings.HasSuffix(r.URL.Path, "/skills"):
			body := decode(r)
			agentID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/agents/"), "/skills")
			ids := make([]string, 0)
			if raw, ok := body["skill_ids"].([]any); ok {
				for _, v := range raw {
					ids = append(ids, v.(string))
				}
			}
			rec.skillBindings[agentID] = ids
			_ = json.NewEncoder(w).Encode(map[string]any{"skills": []any{}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/squads":
			_ = json.NewEncoder(w).Encode(ws.squads)
		case r.Method == http.MethodPost && r.URL.Path == "/api/squads":
			body := decode(r)
			rec.squadCreates = append(rec.squadCreates, body)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "squad-1", "name": body["name"]})
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/squads/") && strings.HasSuffix(r.URL.Path, "/members"):
			members := ws.squadMembers
			if members == nil {
				members = []map[string]any{}
			}
			_ = json.NewEncoder(w).Encode(members)
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/api/squads/") && strings.HasSuffix(r.URL.Path, "/members"):
			rec.memberAdds = append(rec.memberAdds, decode(r))
			_ = json.NewEncoder(w).Encode(map[string]any{})
		case r.Method == http.MethodGet && r.URL.Path == "/api/autopilots":
			_ = json.NewEncoder(w).Encode(map[string]any{"autopilots": ws.autopilots, "total": len(ws.autopilots)})
		case r.Method == http.MethodPost && r.URL.Path == "/api/autopilots":
			body := decode(r)
			rec.apCreates = append(rec.apCreates, body)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "ap-1", "title": body["title"]})
		case r.Method == http.MethodGet && r.URL.Path == "/api/autopilots/ap-1":
			_ = json.NewEncoder(w).Encode(map[string]any{"autopilot": map[string]any{"id": "ap-1"}, "triggers": ws.triggers})
		case r.Method == http.MethodPost && r.URL.Path == "/api/autopilots/ap-1/triggers":
			body := decode(r)
			rec.triggerAdds = append(rec.triggerAdds, body)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "tr-1", "kind": body["kind"]})
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func TestMMMAgentBootstrapCreatesFullPortfolio(t *testing.T) {
	rec := &bootstrapRecorder{}
	srv := bootstrapMockServer(t, bootstrapWorkspace{}, rec)
	defer srv.Close()
	bootstrapEnv(t, srv.URL)

	cmd := newBootstrapTestCmd()
	if err := cmd.Flags().Set("runtime-id", "rt-1"); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Flags().Set("skip-import", "true"); err != nil {
		t.Fatal(err)
	}

	if err := runMMMAgentBootstrap(cmd, nil); err != nil {
		t.Fatalf("bootstrap failed: %v", err)
	}

	manifest := mmm.DefaultAgentManifest()

	if len(rec.agentCreates) != len(manifest.Agents) {
		t.Fatalf("expected %d agent creates, got %d", len(manifest.Agents), len(rec.agentCreates))
	}
	specByName := map[string]mmm.AgentSpec{}
	for _, spec := range manifest.Agents {
		specByName[spec.Name] = spec
	}
	for _, body := range rec.agentCreates {
		name, _ := body["name"].(string)
		spec, ok := specByName[name]
		if !ok {
			t.Errorf("created agent %q not in manifest", name)
			continue
		}
		if body["runtime_id"] != "rt-1" {
			t.Errorf("agent %s runtime_id = %v, want rt-1", name, body["runtime_id"])
		}
		if body["permission_mode"] != "public_to" {
			t.Errorf("agent %s permission_mode = %v, want public_to", name, body["permission_mode"])
		}
		targets, _ := body["invocation_targets"].([]any)
		if len(targets) != 1 {
			t.Errorf("agent %s invocation_targets = %v, want single workspace target", name, body["invocation_targets"])
		} else if m, _ := targets[0].(map[string]any); m["target_type"] != "workspace" {
			t.Errorf("agent %s invocation target = %v, want workspace", name, targets[0])
		}
		if body["instructions"] != spec.Instructions {
			t.Errorf("agent %s instructions do not match the manifest", name)
		}
		if _, hasModel := body["model"]; hasModel {
			t.Errorf("agent %s create body sets model; portfolio must inherit runtime defaults", name)
		}
		if _, hasThinking := body["thinking_level"]; hasThinking {
			t.Errorf("agent %s create body sets thinking_level; portfolio must inherit runtime defaults", name)
		}

		// Skills must ride along on the create so the agent is never visible
		// in a half-configured state; a separate binding call would not be
		// atomic with the create.
		bound, _ := body["skill_ids"].([]any)
		if len(bound) != len(spec.SkillNames) {
			t.Errorf("agent %s create body carries %d skill_ids, want %d", name, len(bound), len(spec.SkillNames))
		}
	}
	if len(rec.skillBindings) != 0 {
		t.Errorf("create path issued %d separate skill-binding calls; skills belong in the create body", len(rec.skillBindings))
	}

	if len(rec.squadCreates) != 1 {
		t.Fatalf("expected 1 squad create, got %d", len(rec.squadCreates))
	}
	if got := rec.squadCreates[0]["leader_id"]; got != "agent-"+manifest.Squad.LeaderName {
		t.Errorf("squad leader_id = %v, want agent-%s", got, manifest.Squad.LeaderName)
	}
	if len(rec.memberAdds) != len(manifest.Squad.MemberNames) {
		t.Errorf("expected %d member adds, got %d", len(manifest.Squad.MemberNames), len(rec.memberAdds))
	}

	if len(rec.apCreates) != 1 {
		t.Fatalf("expected 1 autopilot create, got %d", len(rec.apCreates))
	}
	ap := rec.apCreates[0]
	if ap["assignee_id"] != "agent-"+manifest.Autopilot.AssigneeName {
		t.Errorf("autopilot assignee_id = %v, want agent-%s", ap["assignee_id"], manifest.Autopilot.AssigneeName)
	}
	if ap["execution_mode"] != "create_issue" {
		t.Errorf("autopilot execution_mode = %v, want create_issue", ap["execution_mode"])
	}
	if tpl, _ := ap["issue_title_template"].(string); !strings.Contains(tpl, "{{date}}") {
		t.Errorf("autopilot issue_title_template = %q, want a {{date}} template", tpl)
	}

	if len(rec.triggerAdds) != 1 {
		t.Fatalf("expected 1 trigger add, got %d", len(rec.triggerAdds))
	}
	trig := rec.triggerAdds[0]
	if trig["cron_expression"] != manifest.Autopilot.DefaultCron {
		t.Errorf("trigger cron = %v, want %s", trig["cron_expression"], manifest.Autopilot.DefaultCron)
	}
	if trig["timezone"] != manifest.Autopilot.DefaultTimezone {
		t.Errorf("trigger timezone = %v, want %s", trig["timezone"], manifest.Autopilot.DefaultTimezone)
	}
}

func TestMMMAgentBootstrapIsIdempotent(t *testing.T) {
	rec := &bootstrapRecorder{}
	srv := bootstrapMockServer(t, populatedWorkspace(), rec)
	defer srv.Close()
	bootstrapEnv(t, srv.URL)

	cmd := newBootstrapTestCmd()
	if err := cmd.Flags().Set("runtime-id", "rt-1"); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Flags().Set("skip-import", "true"); err != nil {
		t.Fatal(err)
	}

	if err := runMMMAgentBootstrap(cmd, nil); err != nil {
		t.Fatalf("re-run bootstrap failed: %v", err)
	}

	if len(rec.agentCreates) != 0 {
		t.Errorf("re-run created %d agents, want 0", len(rec.agentCreates))
	}
	if len(rec.skillBindings) != 0 {
		t.Errorf("re-run rebound skills for %d agents without --force, want 0", len(rec.skillBindings))
	}
	if len(rec.squadCreates) != 0 {
		t.Errorf("re-run created %d squads, want 0", len(rec.squadCreates))
	}
	if len(rec.memberAdds) != 0 {
		t.Errorf("re-run re-added %d squad members, want 0", len(rec.memberAdds))
	}
	if len(rec.apCreates) != 0 {
		t.Errorf("re-run created %d autopilots, want 0", len(rec.apCreates))
	}
	if len(rec.triggerAdds) != 0 {
		t.Errorf("re-run created %d triggers, want 0", len(rec.triggerAdds))
	}
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

// verifyMockServer serves a workspace state for runMMMVerify. skillNames
// controls which mmm:* skills exist; boundSkills maps agent ID to the skills
// reported as bound.
func verifyMockServer(t *testing.T, ws bootstrapWorkspace, runtimes []map[string]any, skillNames []string, boundSkills map[string][]string) *httptest.Server {
	t.Helper()

	skills := make([]map[string]any, 0, len(skillNames))
	for _, name := range skillNames {
		skills = append(skills, map[string]any{"id": "sk-" + name, "name": name})
	}

	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/runtimes":
			_ = json.NewEncoder(w).Encode(runtimes)
		case r.Method == http.MethodGet && r.URL.Path == "/api/skills":
			_ = json.NewEncoder(w).Encode(skills)
		case r.Method == http.MethodGet && r.URL.Path == "/api/agents":
			_ = json.NewEncoder(w).Encode(ws.agents)
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/agents/") && strings.HasSuffix(r.URL.Path, "/skills"):
			agentID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/agents/"), "/skills")
			bound := make([]map[string]any, 0)
			for _, name := range boundSkills[agentID] {
				bound = append(bound, map[string]any{"id": "sk-" + name, "name": name})
			}
			_ = json.NewEncoder(w).Encode(bound)
		case r.Method == http.MethodGet && r.URL.Path == "/api/squads":
			_ = json.NewEncoder(w).Encode(ws.squads)
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/squads/") && strings.HasSuffix(r.URL.Path, "/members"):
			_ = json.NewEncoder(w).Encode(ws.squadMembers)
		case r.Method == http.MethodGet && r.URL.Path == "/api/autopilots":
			_ = json.NewEncoder(w).Encode(map[string]any{"autopilots": ws.autopilots, "total": len(ws.autopilots)})
		case r.Method == http.MethodGet && r.URL.Path == "/api/autopilots/ap-1":
			_ = json.NewEncoder(w).Encode(map[string]any{"autopilot": map[string]any{"id": "ap-1"}, "triggers": ws.triggers})
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

// fullyBoundSkills reports every portfolio agent as bound to its manifest
// skills, so verify has nothing to warn about.
func fullyBoundSkills() map[string][]string {
	bound := map[string][]string{}
	for _, spec := range mmm.DefaultAgentManifest().Agents {
		bound["agent-"+spec.Name] = spec.SkillNames
	}
	return bound
}

func onlineRuntimes() []map[string]any {
	return []map[string]any{{"id": "rt-1", "status": "online"}}
}

func newVerifyTestCmd() *cobra.Command {
	c := &cobra.Command{Use: "verify"}
	c.Flags().String("profile", "", "")
	c.Flags().String("runtime-id", "rt-1", "")
	return c
}

func TestMMMVerifyPassesOnFullyWiredWorkspace(t *testing.T) {
	srv := verifyMockServer(t, populatedWorkspace(), onlineRuntimes(), mmm.RuntimeSkillNames, fullyBoundSkills())
	defer srv.Close()
	bootstrapEnv(t, srv.URL)

	if err := runMMMVerify(newVerifyTestCmd(), nil); err != nil {
		t.Fatalf("verify on a fully wired workspace failed: %v", err)
	}
}

func TestMMMVerifyFailsOnRequiredGaps(t *testing.T) {
	tests := []struct {
		name     string
		mutate   func(*bootstrapWorkspace)
		runtimes []map[string]any
		skills   []string
	}{
		{
			name:     "no online runtime",
			mutate:   func(*bootstrapWorkspace) {},
			runtimes: []map[string]any{{"id": "rt-1", "status": "offline"}},
			skills:   mmm.RuntimeSkillNames,
		},
		{
			name:     "skills not imported",
			mutate:   func(*bootstrapWorkspace) {},
			runtimes: onlineRuntimes(),
			skills:   mmm.RuntimeSkillNames[:len(mmm.RuntimeSkillNames)-1],
		},
		{
			name:     "an agent is missing",
			mutate:   func(ws *bootstrapWorkspace) { ws.agents = ws.agents[1:] },
			runtimes: onlineRuntimes(),
			skills:   mmm.RuntimeSkillNames,
		},
		{
			name: "an agent is unbound from its runtime",
			mutate: func(ws *bootstrapWorkspace) {
				ws.agents[0]["runtime_id"] = ""
			},
			runtimes: onlineRuntimes(),
			skills:   mmm.RuntimeSkillNames,
		},
		{
			name:     "squad is missing",
			mutate:   func(ws *bootstrapWorkspace) { ws.squads = nil },
			runtimes: onlineRuntimes(),
			skills:   mmm.RuntimeSkillNames,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ws := populatedWorkspace()
			tc.mutate(&ws)

			srv := verifyMockServer(t, ws, tc.runtimes, tc.skills, fullyBoundSkills())
			defer srv.Close()
			bootstrapEnv(t, srv.URL)

			err := runMMMVerify(newVerifyTestCmd(), nil)
			if err == nil {
				t.Fatal("expected verify to fail, got nil")
			}
			if !strings.Contains(err.Error(), "required check") {
				t.Errorf("error = %q, want it to name the failed required checks", err)
			}
		})
	}
}

func TestMMMVerifyRequiresAutopilotAndBindings(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*bootstrapWorkspace)
		bound  map[string][]string
	}{
		{
			name:   "autopilot missing",
			mutate: func(ws *bootstrapWorkspace) { ws.autopilots = nil },
			bound:  fullyBoundSkills(),
		},
		{
			name: "autopilot paused",
			mutate: func(ws *bootstrapWorkspace) {
				ws.autopilots[0]["status"] = "paused"
			},
			bound: fullyBoundSkills(),
		},
		{
			name:   "autopilot has no schedule trigger",
			mutate: func(ws *bootstrapWorkspace) { ws.triggers = nil },
			bound:  fullyBoundSkills(),
		},
		{
			name:   "skills not bound to agents",
			mutate: func(*bootstrapWorkspace) {},
			bound:  map[string][]string{},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ws := populatedWorkspace()
			tc.mutate(&ws)

			srv := verifyMockServer(t, ws, onlineRuntimes(), mmm.RuntimeSkillNames, tc.bound)
			defer srv.Close()
			bootstrapEnv(t, srv.URL)

			if err := runMMMVerify(newVerifyTestCmd(), nil); err == nil {
				t.Fatal("expected required finding to fail verification")
			}
		})
	}
}
