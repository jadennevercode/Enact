package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/ontologizer"
)

func TestOntologizerCommandsRegistered(t *testing.T) {
	setup, _, err := ontologizerCmd.Find([]string{"setup"})
	if err != nil || setup.Name() != "setup" {
		t.Fatalf("ontologizer setup subcommand not found: %v", err)
	}
	for _, flag := range []string{"runtime-dir", "ref", "repo", "skip-checks", "import-skills"} {
		if setup.Flags().Lookup(flag) == nil {
			t.Errorf("ontologizer setup missing --%s flag", flag)
		}
	}

	bootstrap, _, err := ontologizerCmd.Find([]string{"agent", "bootstrap"})
	if err != nil || bootstrap.Name() != "bootstrap" {
		t.Fatalf("ontologizer agent bootstrap subcommand not found: %v", err)
	}
	for _, flag := range []string{"runtime-id", "force", "skip-import", "skip-autopilot", "cron", "timezone"} {
		if bootstrap.Flags().Lookup(flag) == nil {
			t.Errorf("ontologizer agent bootstrap missing --%s flag", flag)
		}
	}

	verify, _, err := ontologizerCmd.Find([]string{"verify"})
	if err != nil || verify.Name() != "verify" {
		t.Fatalf("ontologizer verify subcommand not found: %v", err)
	}
	if verify.Flags().Lookup("runtime-id") == nil {
		t.Error("ontologizer verify missing --runtime-id flag")
	}
}

// ontoRecorder captures the mutating requests a bootstrap performs.
type ontoRecorder struct {
	agentCreates    []map[string]any
	skillBindings   map[string][]string
	squadCreates    []map[string]any
	squadUpdates    []map[string]any
	memberAdds      []map[string]any
	autopilotAdds   []map[string]any
	triggerAdds     []map[string]any
	agentUpdates    []map[string]any
	localSkillCalls int
}

// ontoWorkspace is the starting state the mock server serves.
type ontoWorkspace struct {
	agents       []map[string]any
	squads       []map[string]any
	squadMembers []map[string]any
	autopilots   []map[string]any
	triggers     []any
	skills       []map[string]any
}

// wiredWorkspace is the state a completed bootstrap leaves behind.
func wiredWorkspace() ontoWorkspace {
	manifest := ontologizer.DefaultAgentManifest()
	ws := ontoWorkspace{
		squads: []map[string]any{{
			"id": "squad-1", "name": manifest.Squad.Name,
			"leader_id": "agent-" + manifest.Squad.LeaderName,
		}},
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
			"member_type": "agent", "member_id": "agent-" + name, "role": "member",
		})
	}
	for i, name := range ontologizer.RuntimeSkillNames {
		ws.skills = append(ws.skills, map[string]any{"id": skillIDFor(i), "name": name})
	}
	return ws
}

func skillIDFor(i int) string { return "skill-" + string(rune('a'+i)) }

// ontoMockServer serves a workspace and records every mutation. Created agents
// get the id "agent-<name>", which is what lets assertions name them.
func ontoMockServer(t *testing.T, ws ontoWorkspace, rec *ontoRecorder) *httptest.Server {
	t.Helper()
	rec.skillBindings = map[string][]string{}

	write := func(w http.ResponseWriter, body any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(body)
	}
	decode := func(r *http.Request) map[string]any {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		return body
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/api/skills", func(w http.ResponseWriter, _ *http.Request) {
		write(w, ws.skills)
	})

	mux.HandleFunc("/api/runtimes", func(w http.ResponseWriter, _ *http.Request) {
		write(w, []map[string]any{{"id": "rt-1", "status": "online", "daemon_id": "d-1"}})
	})

	mux.HandleFunc("/api/agents", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			body := decode(r)
			rec.agentCreates = append(rec.agentCreates, body)
			id := "agent-" + strVal(body, "name")
			if raw, ok := body["skill_ids"].([]any); ok {
				for _, s := range raw {
					rec.skillBindings[id] = append(rec.skillBindings[id], s.(string))
				}
			}
			write(w, map[string]any{"id": id})
			return
		}
		write(w, ws.agents)
	})

	mux.HandleFunc("/api/agents/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/agents/")
		id, rest, _ := strings.Cut(path, "/")
		switch {
		case rest == "skills" && r.Method == http.MethodPut:
			body := decode(r)
			rec.skillBindings[id] = nil
			if raw, ok := body["skill_ids"].([]any); ok {
				for _, s := range raw {
					rec.skillBindings[id] = append(rec.skillBindings[id], s.(string))
				}
			}
			write(w, map[string]any{})
		case rest == "skills":
			bound := []map[string]any{}
			name := strings.TrimPrefix(id, "agent-")
			if spec, ok := ontologizer.DefaultAgentManifest().AgentByName(name); ok {
				for _, skillName := range spec.SkillNames {
					bound = append(bound, map[string]any{"name": skillName})
				}
			}
			write(w, bound)
		case r.Method == http.MethodPut:
			body := decode(r)
			body["id"] = id
			rec.agentUpdates = append(rec.agentUpdates, body)
			write(w, body)
		default:
			write(w, map[string]any{"id": id})
		}
	})

	mux.HandleFunc("/api/squads", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			body := decode(r)
			rec.squadCreates = append(rec.squadCreates, body)
			write(w, map[string]any{"id": "squad-1"})
			return
		}
		write(w, ws.squads)
	})

	mux.HandleFunc("/api/squads/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/squads/")
		id, rest, _ := strings.Cut(path, "/")
		switch {
		case rest == "members" && r.Method == http.MethodPost:
			rec.memberAdds = append(rec.memberAdds, decode(r))
			write(w, map[string]any{})
		case rest == "members":
			write(w, ws.squadMembers)
		case r.Method == http.MethodPut:
			body := decode(r)
			body["id"] = id
			rec.squadUpdates = append(rec.squadUpdates, body)
			write(w, body)
		default:
			write(w, map[string]any{"id": id})
		}
	})

	mux.HandleFunc("/api/autopilots", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			rec.autopilotAdds = append(rec.autopilotAdds, decode(r))
			write(w, map[string]any{"id": "ap-1"})
			return
		}
		write(w, map[string]any{"autopilots": ws.autopilots})
	})

	mux.HandleFunc("/api/autopilots/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/triggers") && r.Method == http.MethodPost {
			rec.triggerAdds = append(rec.triggerAdds, decode(r))
			write(w, map[string]any{"id": "tr-1"})
			return
		}
		write(w, map[string]any{"id": "ap-1", "triggers": ws.triggers})
	})

	mux.HandleFunc("/api/runtimes/rt-1/local-skills", func(w http.ResponseWriter, r *http.Request) {
		rec.localSkillCalls++
		if r.Method == http.MethodPost {
			write(w, map[string]any{"id": "req-1"})
			return
		}
		write(w, map[string]any{"status": "completed"})
	})

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func newOntoBootstrapCmd() *cobra.Command {
	c := &cobra.Command{Use: "bootstrap"}
	registerOntologizerBootstrapFlags(c)
	c.Flags().String("profile", "", "")
	return c
}

func ontoEnv(t *testing.T, serverURL string) {
	t.Helper()
	t.Setenv("ENACT_SERVER_URL", serverURL)
	t.Setenv("ENACT_WORKSPACE_ID", "ws-1")
	t.Setenv("ENACT_TOKEN", "test-token")
	t.Setenv("ENACT_AGENT_ID", "")
	t.Setenv("ENACT_TASK_ID", "")
	t.Setenv("ENACT_DAEMON_PORT", "")
	// detectOntologizerEnv reads ~/.enact/ontologizer.yaml; isolate from the
	// developer's real home so the test never picks up a local checkout.
	t.Setenv("HOME", t.TempDir())
}

func TestOntologizerBootstrapCreatesFullPortfolio(t *testing.T) {
	manifest := ontologizer.DefaultAgentManifest()
	ws := ontoWorkspace{}
	for i, name := range ontologizer.RuntimeSkillNames {
		ws.skills = append(ws.skills, map[string]any{"id": skillIDFor(i), "name": name})
	}
	rec := &ontoRecorder{}
	srv := ontoMockServer(t, ws, rec)
	ontoEnv(t, srv.URL)

	cmd := newOntoBootstrapCmd()
	_ = cmd.Flags().Set("runtime-id", "rt-1")
	_ = cmd.Flags().Set("skip-import", "true")
	if err := runOntologizerAgentBootstrap(cmd, nil); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}

	if len(rec.agentCreates) != len(manifest.Agents) {
		t.Fatalf("created %d agents, want %d", len(rec.agentCreates), len(manifest.Agents))
	}
	created := map[string]map[string]any{}
	for _, body := range rec.agentCreates {
		created[strVal(body, "name")] = body
	}
	for _, spec := range manifest.Agents {
		body, ok := created[spec.Name]
		if !ok {
			t.Errorf("%s was not created", spec.Name)
			continue
		}
		// A private agent cannot be assigned by anyone but its creator, which
		// would make the family unusable for the team that installed it.
		if strVal(body, "permission_mode") != "public_to" {
			t.Errorf("%s should be public to the workspace", spec.Name)
		}
		if strVal(body, "runtime_id") != "rt-1" {
			t.Errorf("%s bound to %q, want rt-1", spec.Name, strVal(body, "runtime_id"))
		}
		if got := intVal(body, "max_concurrent_tasks"); got != spec.MaxConcurrentTasks {
			t.Errorf("%s concurrency %d, want %d", spec.Name, got, spec.MaxConcurrentTasks)
		}
		if bound := rec.skillBindings["agent-"+spec.Name]; len(bound) != len(spec.SkillNames) {
			t.Errorf("%s bound %d skills, want %d", spec.Name, len(bound), len(spec.SkillNames))
		}
	}

	if len(rec.squadCreates) != 1 || strVal(rec.squadCreates[0], "name") != manifest.Squad.Name {
		t.Fatalf("family not created as expected: %+v", rec.squadCreates)
	}
	if strVal(rec.squadCreates[0], "leader_id") != "agent-"+manifest.Squad.LeaderName {
		t.Errorf("family leader is %q", strVal(rec.squadCreates[0], "leader_id"))
	}
	// The leader reads these on every turn; a family created without them
	// routes by guesswork.
	if len(rec.squadUpdates) != 1 || !strings.Contains(strVal(rec.squadUpdates[0], "instructions"), "create_pull_request") {
		t.Errorf("family instructions were not written: %+v", rec.squadUpdates)
	}
	if len(rec.memberAdds) != len(manifest.Squad.MemberNames) {
		t.Errorf("added %d members, want %d", len(rec.memberAdds), len(manifest.Squad.MemberNames))
	}
	if len(rec.autopilotAdds) != 1 || len(rec.triggerAdds) != 1 {
		t.Errorf("autopilot/trigger not created: %+v %+v", rec.autopilotAdds, rec.triggerAdds)
	}
}

func TestOntologizerBootstrapIsIdempotent(t *testing.T) {
	rec := &ontoRecorder{}
	srv := ontoMockServer(t, wiredWorkspace(), rec)
	ontoEnv(t, srv.URL)

	cmd := newOntoBootstrapCmd()
	_ = cmd.Flags().Set("runtime-id", "rt-1")
	_ = cmd.Flags().Set("skip-import", "true")
	if err := runOntologizerAgentBootstrap(cmd, nil); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}

	// Re-running is the supported update path, so it must not duplicate
	// anything or overwrite what someone edited in the UI.
	if len(rec.agentCreates) != 0 {
		t.Errorf("re-run created agents: %+v", rec.agentCreates)
	}
	if len(rec.agentUpdates) != 0 {
		t.Errorf("re-run overwrote agents without --force: %+v", rec.agentUpdates)
	}
	if len(rec.squadCreates) != 0 || len(rec.memberAdds) != 0 {
		t.Errorf("re-run touched the family: %+v %+v", rec.squadCreates, rec.memberAdds)
	}
	if len(rec.squadUpdates) != 0 {
		t.Errorf("re-run rewrote family instructions without --force: %+v", rec.squadUpdates)
	}
	if len(rec.autopilotAdds) != 0 || len(rec.triggerAdds) != 0 {
		t.Errorf("re-run touched the autopilot: %+v %+v", rec.autopilotAdds, rec.triggerAdds)
	}
}

func TestOntologizerBootstrapForceRewritesAgentsAndFamily(t *testing.T) {
	manifest := ontologizer.DefaultAgentManifest()
	rec := &ontoRecorder{}
	srv := ontoMockServer(t, wiredWorkspace(), rec)
	ontoEnv(t, srv.URL)

	cmd := newOntoBootstrapCmd()
	_ = cmd.Flags().Set("runtime-id", "rt-1")
	_ = cmd.Flags().Set("skip-import", "true")
	_ = cmd.Flags().Set("force", "true")
	if err := runOntologizerAgentBootstrap(cmd, nil); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}

	if len(rec.agentUpdates) != len(manifest.Agents) {
		t.Errorf("--force updated %d agents, want %d", len(rec.agentUpdates), len(manifest.Agents))
	}
	// Routing rules go stale the same way instructions do, so --force has to
	// reach them too.
	if len(rec.squadUpdates) != 1 {
		t.Errorf("--force should rewrite family instructions: %+v", rec.squadUpdates)
	}
}

func newOntoVerifyCmd() *cobra.Command {
	c := &cobra.Command{Use: "verify"}
	c.Flags().String("runtime-id", "", "")
	c.Flags().String("profile", "", "")
	return c
}

func TestOntologizerVerifyPassesOnWiredWorkspace(t *testing.T) {
	srv := ontoMockServer(t, wiredWorkspace(), &ontoRecorder{})
	ontoEnv(t, srv.URL)

	cmd := newOntoVerifyCmd()
	_ = cmd.Flags().Set("runtime-id", "rt-1")
	if err := runOntologizerVerify(cmd, nil); err != nil {
		t.Fatalf("verify should pass on a fully wired workspace: %v", err)
	}
}

func TestOntologizerVerifyFailsOnRequiredGaps(t *testing.T) {
	manifest := ontologizer.DefaultAgentManifest()

	cases := []struct {
		name    string
		mutate  func(*ontoWorkspace)
		wantErr string
	}{
		{
			name:    "a missing agent",
			mutate:  func(ws *ontoWorkspace) { ws.agents = ws.agents[:len(ws.agents)-1] },
			wantErr: "1 required check(s) failed",
		},
		{
			name:    "a missing skill import",
			mutate:  func(ws *ontoWorkspace) { ws.skills = ws.skills[:len(ws.skills)-1] },
			wantErr: "required check(s) failed",
		},
		{
			name:    "no family",
			mutate:  func(ws *ontoWorkspace) { ws.squads = nil },
			wantErr: "1 required check(s) failed",
		},
		{
			name:    "a paused autopilot",
			mutate:  func(ws *ontoWorkspace) { ws.autopilots[0]["status"] = "paused" },
			wantErr: "1 required check(s) failed",
		},
		{
			name: "an agent bound to the wrong runtime",
			mutate: func(ws *ontoWorkspace) {
				ws.agents[0]["runtime_id"] = "rt-other"
			},
			wantErr: "1 required check(s) failed",
		},
		{
			name: "a concurrency someone widened by hand",
			mutate: func(ws *ontoWorkspace) {
				ws.agents[0]["max_concurrent_tasks"] = manifest.Agents[0].MaxConcurrentTasks + 3
			},
			wantErr: "1 required check(s) failed",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ws := wiredWorkspace()
			tc.mutate(&ws)
			srv := ontoMockServer(t, ws, &ontoRecorder{})
			ontoEnv(t, srv.URL)

			cmd := newOntoVerifyCmd()
			_ = cmd.Flags().Set("runtime-id", "rt-1")
			err := runOntologizerVerify(cmd, nil)
			if err == nil {
				t.Fatalf("verify should fail on %s", tc.name)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("error %q does not contain %q", err.Error(), tc.wantErr)
			}
		})
	}
}

func TestDetectOntologizerEnvNeedsARealCheckout(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	// No persisted config: bootstrap must not invent a path, because an agent
	// told the wrong ONTOLOGIZER_HOME fails on its first command with a
	// file-not-found rather than a readable error.
	if env := detectOntologizerEnv(); env != nil {
		t.Errorf("no config should yield no env, got %v", env)
	}
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

func TestMarketplaceSlugKeepsPluginPrefixReadable(t *testing.T) {
	// The server's own slugify drops a colon rather than separating on it,
	// which would turn ontologizer:trace into "ontologizertrace".
	cases := map[string]string{
		"ontologizer:trace":       "ontologizer-trace",
		"ontologizer:package":     "ontologizer-package",
		"Ontology Domain Analyst": "ontology-domain-analyst",
		"Ontology Construction":   "ontology-construction",
		"  Spaced  //  Name  ":    "spaced-name",
	}
	for in, want := range cases {
		if got := marketplaceSlug(in); got != want {
			t.Errorf("marketplaceSlug(%q) = %q, want %q", in, got, want)
		}
	}
}

// publishRecorder captures what a publish sends.
type publishRecorder struct {
	posts []map[string]any
	// duplicate marks slugs the server answers as already published.
	duplicate map[string]bool
}

func publishMockServer(t *testing.T, ws ontoWorkspace, rec *publishRecorder) *httptest.Server {
	t.Helper()
	write := func(w http.ResponseWriter, body any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(body)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/skills", func(w http.ResponseWriter, _ *http.Request) { write(w, ws.skills) })
	mux.HandleFunc("/api/agents", func(w http.ResponseWriter, _ *http.Request) { write(w, ws.agents) })
	mux.HandleFunc("/api/squads", func(w http.ResponseWriter, _ *http.Request) { write(w, ws.squads) })
	mux.HandleFunc("/api/marketplace/listings", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		rec.posts = append(rec.posts, body)
		if rec.duplicate[strVal(body, "slug")] {
			w.WriteHeader(http.StatusConflict)
			write(w, map[string]any{"error": "version 0.1.0 has already been published; a published version is never overwritten"})
			return
		}
		w.WriteHeader(http.StatusCreated)
		write(w, map[string]any{"listing": map[string]any{"id": "listing-1"}})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func newOntoPublishCmd() *cobra.Command {
	c := &cobra.Command{Use: "publish"}
	c.Flags().String("version", "", "")
	c.Flags().String("visibility", "workspace", "")
	c.Flags().String("changelog", "", "")
	c.Flags().String("category", "ontology", "")
	c.Flags().StringSlice("tags", nil, "")
	c.Flags().StringSlice("kinds", nil, "")
	c.Flags().Bool("dry-run", false, "")
	c.Flags().String("profile", "", "")
	return c
}

func TestOntologizerPublishCoversAllThreeKinds(t *testing.T) {
	manifest := ontologizer.DefaultAgentManifest()
	rec := &publishRecorder{duplicate: map[string]bool{}}
	srv := publishMockServer(t, wiredWorkspace(), rec)
	ontoEnv(t, srv.URL)

	cmd := newOntoPublishCmd()
	_ = cmd.Flags().Set("version", "0.1.0")
	if err := runOntologizerPublish(cmd, nil); err != nil {
		t.Fatalf("publish: %v", err)
	}

	want := len(manifest.RuntimeSkillNames) + len(manifest.Agents) + 1
	if len(rec.posts) != want {
		t.Fatalf("published %d listings, want %d", len(rec.posts), want)
	}

	byKind := map[string]int{}
	slugs := map[string]bool{}
	for _, post := range rec.posts {
		byKind[strVal(post, "kind")]++
		slugs[strVal(post, "slug")] = true
		if strVal(post, "version") != "0.1.0" {
			t.Errorf("listing %q published at version %q", strVal(post, "slug"), strVal(post, "version"))
		}
		// Workspace-only by default: making something visible to the whole
		// deployment should be a thing someone chose, not a default.
		if strVal(post, "visibility") != "workspace" {
			t.Errorf("listing %q defaulted to visibility %q", strVal(post, "slug"), strVal(post, "visibility"))
		}
		if strVal(post, "source_id") == "" {
			t.Errorf("listing %q has no source entity", strVal(post, "slug"))
		}
	}
	if byKind["skill"] != len(manifest.RuntimeSkillNames) || byKind["agent"] != len(manifest.Agents) || byKind["squad"] != 1 {
		t.Errorf("kind spread %v", byKind)
	}
	// The family is the headline listing; a publish that dropped it would ship
	// five roles nobody can assemble.
	if !slugs["ontology-construction"] {
		t.Error("the Agent Family was not published")
	}
	if !slugs["ontologizer-trace"] {
		t.Error("skill slugs should keep the plugin prefix readable")
	}
}

func TestOntologizerPublishTreatsAPublishedVersionAsDone(t *testing.T) {
	rec := &publishRecorder{duplicate: map[string]bool{"ontology-construction": true}}
	srv := publishMockServer(t, wiredWorkspace(), rec)
	ontoEnv(t, srv.URL)

	cmd := newOntoPublishCmd()
	_ = cmd.Flags().Set("version", "0.1.0")
	// Re-running the same version is the idempotent case: the listing already
	// carries exactly what this run would send, so it is not a failure.
	if err := runOntologizerPublish(cmd, nil); err != nil {
		t.Fatalf("a republished version should not fail the run: %v", err)
	}
}

func TestOntologizerPublishKindsAndDryRun(t *testing.T) {
	rec := &publishRecorder{duplicate: map[string]bool{}}
	srv := publishMockServer(t, wiredWorkspace(), rec)
	ontoEnv(t, srv.URL)

	cmd := newOntoPublishCmd()
	_ = cmd.Flags().Set("version", "0.1.0")
	_ = cmd.Flags().Set("kinds", "squad")
	if err := runOntologizerPublish(cmd, nil); err != nil {
		t.Fatalf("publish: %v", err)
	}
	if len(rec.posts) != 1 || strVal(rec.posts[0], "kind") != "squad" {
		t.Fatalf("--kinds squad should publish only the family, got %+v", rec.posts)
	}

	rec.posts = nil
	dry := newOntoPublishCmd()
	_ = dry.Flags().Set("version", "0.1.0")
	_ = dry.Flags().Set("dry-run", "true")
	if err := runOntologizerPublish(dry, nil); err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if len(rec.posts) != 0 {
		t.Errorf("--dry-run must not publish anything, got %d", len(rec.posts))
	}
}

func TestOntologizerPublishRejectsBadFlags(t *testing.T) {
	srv := publishMockServer(t, wiredWorkspace(), &publishRecorder{duplicate: map[string]bool{}})
	ontoEnv(t, srv.URL)

	noVersion := newOntoPublishCmd()
	if err := runOntologizerPublish(noVersion, nil); err == nil || !strings.Contains(err.Error(), "--version is required") {
		t.Errorf("an empty version should be refused before any request, got %v", err)
	}

	badVisibility := newOntoPublishCmd()
	_ = badVisibility.Flags().Set("version", "0.1.0")
	_ = badVisibility.Flags().Set("visibility", "everyone")
	if err := runOntologizerPublish(badVisibility, nil); err == nil || !strings.Contains(err.Error(), "--visibility") {
		t.Errorf("an unknown visibility should be refused, got %v", err)
	}

	badKind := newOntoPublishCmd()
	_ = badKind.Flags().Set("version", "0.1.0")
	_ = badKind.Flags().Set("kinds", "mcp")
	if err := runOntologizerPublish(badKind, nil); err == nil || !strings.Contains(err.Error(), "--kinds") {
		t.Errorf("a kind outside the portfolio should be refused, got %v", err)
	}
}

func TestOntologizerPublishSaysWhatToRunWhenNothingExists(t *testing.T) {
	rec := &publishRecorder{duplicate: map[string]bool{}}
	srv := publishMockServer(t, ontoWorkspace{}, rec)
	ontoEnv(t, srv.URL)

	cmd := newOntoPublishCmd()
	_ = cmd.Flags().Set("version", "0.1.0")
	err := runOntologizerPublish(cmd, nil)
	if err == nil {
		t.Fatal("publishing an empty workspace should fail")
	}
	// The fix belongs in the message: a publish snapshots entities, so an empty
	// workspace means bootstrap has not run.
	if !strings.Contains(err.Error(), "agent bootstrap") {
		t.Errorf("error should point at bootstrap, got: %v", err)
	}
}
