package mmm

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestDefaultAgentManifestCoversEveryRuntimeSkillOnce(t *testing.T) {
	manifest := DefaultAgentManifest()

	assigned := map[string]string{}
	for _, agent := range manifest.Agents {
		for _, skill := range agent.SkillNames {
			if owner, ok := assigned[skill]; ok {
				t.Errorf("skill %s assigned to both %s and %s", skill, owner, agent.Name)
			}
			assigned[skill] = agent.Name
		}
	}

	known := map[string]bool{}
	for _, name := range RuntimeSkillNames {
		known[name] = true
		if _, ok := assigned[name]; !ok {
			t.Errorf("runtime skill %s not assigned to any agent", name)
		}
	}
	for skill, owner := range assigned {
		if !known[skill] {
			t.Errorf("agent %s binds unknown skill %s", owner, skill)
		}
	}
}

func TestDefaultAgentManifestShape(t *testing.T) {
	manifest := DefaultAgentManifest()

	if len(manifest.Agents) != 4 {
		t.Fatalf("expected 4 agents, got %d", len(manifest.Agents))
	}

	names := map[string]bool{}
	for _, agent := range manifest.Agents {
		if agent.Name == "" {
			t.Error("agent with empty name")
		}
		if names[agent.Name] {
			t.Errorf("duplicate agent name %s", agent.Name)
		}
		names[agent.Name] = true

		if agent.Description == "" {
			t.Errorf("agent %s has empty description", agent.Name)
		}
		// The server caps description at 255 Unicode code points.
		if n := utf8.RuneCountInString(agent.Description); n > 255 {
			t.Errorf("agent %s description is %d code points (max 255)", agent.Name, n)
		}
		if agent.Instructions == "" {
			t.Errorf("agent %s has empty instructions", agent.Name)
		}
		if len(agent.SkillNames) == 0 {
			t.Errorf("agent %s binds no skills", agent.Name)
		}
		if agent.MaxConcurrentTasks < 1 || agent.MaxConcurrentTasks > 50 {
			t.Errorf("agent %s max_concurrent_tasks %d outside 1..50", agent.Name, agent.MaxConcurrentTasks)
		}
		// Every role must know the runtime directory is read-only.
		if !strings.Contains(agent.Instructions, "mmm-runtime 目录只读") {
			t.Errorf("agent %s instructions missing the runtime read-only rule", agent.Name)
		}
	}

	if !names[manifest.Squad.LeaderName] {
		t.Errorf("squad leader %s is not a manifest agent", manifest.Squad.LeaderName)
	}
	for _, member := range manifest.Squad.MemberNames {
		if !names[member] {
			t.Errorf("squad member %s is not a manifest agent", member)
		}
	}
	if !names[manifest.Autopilot.AssigneeName] {
		t.Errorf("autopilot assignee %s is not a manifest agent", manifest.Autopilot.AssigneeName)
	}
	if manifest.Autopilot.DefaultCron == "" || manifest.Autopilot.DefaultTimezone == "" {
		t.Error("autopilot must define a default cron and timezone")
	}
	if !strings.Contains(manifest.Autopilot.IssueTitleTemplate, "{{date}}") {
		t.Error("autopilot issue title template should interpolate {{date}}")
	}
}
