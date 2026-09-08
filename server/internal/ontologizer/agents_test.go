package ontologizer

import (
	"strings"
	"testing"
)

func TestManifestBindsEveryRuntimeSkill(t *testing.T) {
	manifest := DefaultAgentManifest()

	bound := map[string][]string{}
	for _, spec := range manifest.Agents {
		for _, name := range spec.SkillNames {
			bound[name] = append(bound[name], spec.Name)
		}
	}

	// Every skill the plugin ships must have an owner. An unbound skill is one
	// nobody in the portfolio is responsible for running.
	for _, name := range RuntimeSkillNames {
		if len(bound[name]) == 0 {
			t.Errorf("runtime skill %s is not bound to any agent", name)
		}
	}

	known := map[string]bool{}
	for _, name := range RuntimeSkillNames {
		known[name] = true
	}
	for name, owners := range bound {
		if !known[name] {
			t.Errorf("agent(s) %v bind %s, which the plugin does not ship", owners, name)
		}
		if !strings.HasPrefix(name, SkillPrefix) {
			t.Errorf("skill %s does not carry the plugin prefix %q", name, SkillPrefix)
		}
	}

	// trace answers "where did this come from", which both the router and the
	// reviewer need; everything else belongs to exactly one role, because two
	// agents owning one deliverable is how a deliverable gets written twice.
	for name, owners := range bound {
		if name == "ontologizer:trace" {
			continue
		}
		if len(owners) > 1 {
			t.Errorf("skill %s is bound to %d agents (%v); only trace is shared", name, len(owners), owners)
		}
	}
}

func TestManifestShape(t *testing.T) {
	manifest := DefaultAgentManifest()

	if len(manifest.Agents) != 5 {
		t.Fatalf("portfolio should have 5 roles, got %d", len(manifest.Agents))
	}
	if manifest.SkillPrefix != SkillPrefix {
		t.Errorf("manifest prefix %q, want %q", manifest.SkillPrefix, SkillPrefix)
	}
	if manifest.BootstrapCommand == "" || manifest.SetupCommand == "" {
		t.Error("manifest must name its setup and bootstrap commands for remediation text")
	}

	seen := map[string]bool{}
	for _, spec := range manifest.Agents {
		if seen[spec.Name] {
			t.Errorf("duplicate agent name %s", spec.Name)
		}
		seen[spec.Name] = true
		if strings.TrimSpace(spec.Description) == "" {
			t.Errorf("%s has no description", spec.Name)
		}
		if strings.TrimSpace(spec.Instructions) == "" {
			t.Errorf("%s has no instructions", spec.Name)
		}
		if spec.MaxConcurrentTasks < 1 {
			t.Errorf("%s concurrency %d must be at least 1", spec.Name, spec.MaxConcurrentTasks)
		}
		if spec.NeedsRuntimeEnv {
			t.Errorf("%s must run without a local Ontologizer checkout", spec.Name)
		}

	}
}

func TestGeneratorDoesNotReviewItsOwnWork(t *testing.T) {
	manifest := DefaultAgentManifest()

	engineer, ok := manifest.AgentByName(AgentNameEngineer)
	if !ok {
		t.Fatalf("%s missing from the portfolio", AgentNameEngineer)
	}
	reviewer, ok := manifest.AgentByName(AgentNameReviewer)
	if !ok {
		t.Fatalf("%s missing from the portfolio", AgentNameReviewer)
	}

	// This separation is the whole reason the portfolio has five roles rather
	// than three. An agent that both generates and reviews is grading its own
	// homework, which is precisely what the four-pass review exists to stop.
	for _, skill := range []string{"ontologizer:review", "ontologizer:evaluate"} {
		if contains(engineer.SkillNames, skill) {
			t.Errorf("%s must not carry %s", AgentNameEngineer, skill)
		}
	}
	for _, skill := range []string{"ontologizer:generate", "ontologizer:revise"} {
		if contains(reviewer.SkillNames, skill) {
			t.Errorf("%s must not carry %s", AgentNameReviewer, skill)
		}
	}
}

func TestSquadRoutesAndNamesEveryDecisionPoint(t *testing.T) {
	manifest := DefaultAgentManifest()
	squad := manifest.Squad

	if squad.LeaderName != AgentNameOrchestrator {
		t.Errorf("leader is %s, want %s", squad.LeaderName, AgentNameOrchestrator)
	}
	if !contains(squad.MemberNames, squad.LeaderName) {
		t.Error("the leader must also be a member")
	}
	for _, spec := range manifest.Agents {
		if !contains(squad.MemberNames, spec.Name) {
			t.Errorf("%s is in the portfolio but not in the family", spec.Name)
		}
	}

	// The leader reads these instructions on every turn; a decision point it
	// cannot name is one it will quietly decide by itself.
	for _, point := range []string{
		"scope_and_boundary", "evidence_sufficiency", "semantic_review",
		"competency_questions", "candidate_selection", "access_scope_review",
		"patch_or_version", "release_authorization",
	} {
		if !strings.Contains(squad.Instructions, point) {
			t.Errorf("family instructions never mention decision point %s", point)
		}
	}
	// Routing is by derived stage, not by the words in the request.
	if !strings.Contains(squad.Instructions, "/api/semantic/constructions/{id}") {
		t.Error("family instructions must route from the derived stage")
	}
	for _, spec := range manifest.Agents {
		if spec.Name == AgentNameOrchestrator {
			continue
		}
		if !strings.Contains(squad.Instructions, spec.Name) {
			t.Errorf("routing table never names %s", spec.Name)
		}
	}
}

func TestAutopilotReportsRatherThanProduces(t *testing.T) {
	manifest := DefaultAgentManifest()
	if !manifest.HasAutopilot() {
		t.Fatal("portfolio should ship the daily standing-decisions autopilot")
	}
	auto := manifest.Autopilot
	if _, ok := manifest.AgentByName(auto.AssigneeName); !ok {
		t.Errorf("autopilot assignee %s is not in the portfolio", auto.AssigneeName)
	}
	if auto.DefaultCron == "" || auto.DefaultTimezone == "" {
		t.Error("autopilot needs a default schedule")
	}
	// A scheduled run that can produce or edit would change a workspace with
	// nobody watching, on a cadence nobody chose per-project.
	if !strings.Contains(auto.Description, "只报告") {
		t.Error("the autopilot must state that it reports and does not produce")
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
