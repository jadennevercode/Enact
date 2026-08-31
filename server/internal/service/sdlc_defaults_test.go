package service

import (
	"slices"
	"strings"
	"testing"
)

func TestLoadSDLCDefaultSkills(t *testing.T) {
	t.Parallel()

	skills, err := LoadSDLCDefaultSkills()
	if err != nil {
		t.Fatalf("LoadSDLCDefaultSkills() error = %v", err)
	}
	wantNames := []string{
		"sdlc-build",
		"sdlc-contract",
		"sdlc-core",
		"sdlc-explore",
		"sdlc-intake",
		"sdlc-learn",
		"sdlc-operate",
		"sdlc-orchestrator",
		"sdlc-qa",
		"sdlc-release",
	}
	gotNames := make([]string, 0, len(skills))
	fileCount := 0
	for _, skill := range skills {
		gotNames = append(gotNames, skill.Name)
		fileCount += len(skill.Files)
		if strings.TrimSpace(skill.Description) == "" || strings.TrimSpace(skill.Content) == "" {
			t.Errorf("skill %q has empty description or content", skill.Name)
		}
		for _, file := range skill.Files {
			if strings.TrimSpace(file.Path) == "" {
				t.Errorf("skill %q has a bundled file with an empty path", skill.Name)
			}
		}
	}
	if !slices.Equal(gotNames, wantNames) {
		t.Fatalf("skill names = %v, want %v", gotNames, wantNames)
	}
	if fileCount != 52 {
		t.Fatalf("support file count = %d, want 52", fileCount)
	}
}

func TestSDLCDefaultPortfolioIsInternallyConsistent(t *testing.T) {
	t.Parallel()

	agents := SDLCDefaultAgentSpecs()
	if len(agents) != 9 {
		t.Fatalf("agent count = %d, want 9", len(agents))
	}
	keys := make(map[string]struct{}, len(agents))
	leaders := 0
	for _, agent := range agents {
		if !strings.HasPrefix(agent.Name, "SDLC ") || strings.Contains(agent.Name, "VOMS") {
			t.Errorf("agent name %q still carries the legacy product prefix", agent.Name)
		}
		if _, exists := keys[agent.SystemKey]; exists {
			t.Fatalf("duplicate system key %q", agent.SystemKey)
		}
		keys[agent.SystemKey] = struct{}{}
		if len(agent.SkillNames) != 2 || agent.SkillNames[0] != "sdlc-core" {
			t.Errorf("agent %q skills = %v, want core plus one phase skill", agent.Name, agent.SkillNames)
		}
		if agent.SquadRole == "leader" {
			leaders++
		}
	}
	squad := SDLCDefaultSquadSpec()
	if strings.Contains(squad.Description, "VOMS") {
		t.Errorf("squad description still carries the legacy product name: %q", squad.Description)
	}
	if _, ok := keys[squad.LeaderKey]; !ok {
		t.Fatalf("squad leader key %q does not resolve to an agent", squad.LeaderKey)
	}
	if leaders != 1 {
		t.Fatalf("leader role count = %d, want 1", leaders)
	}
}

func TestComposeSystemAgentInstructionsLayersWorkspaceNotes(t *testing.T) {
	t.Parallel()

	got, ok := ComposeSystemAgentInstructions("sdlc:qa", "QA", "Run the mobile suite too.")
	if !ok {
		t.Fatal("sdlc:qa was not recognized as a system agent")
	}
	for _, fragment := range []string{"sdlc-qa", "## Workspace notes", "Run the mobile suite too."} {
		if !strings.Contains(got, fragment) {
			t.Errorf("composed instructions do not contain %q", fragment)
		}
	}
	if _, ok := ComposeSystemAgentInstructions("custom", "Custom", "notes"); ok {
		t.Fatal("unknown system key was treated as product-owned")
	}
}
