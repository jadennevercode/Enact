package service

import (
	"strings"
	"testing"
)

// The Lesson Learner is the only way a lesson gets filed, so a bundle that does
// not load, or an agent whose skill reference does not resolve, silently makes
// the whole feature unreachable — the retrospective endpoint would just report
// "this workspace has no Lesson Learner" forever.

func TestLoadLessonsDefaultSkills(t *testing.T) {
	t.Parallel()

	skills, err := LoadLessonsDefaultSkills()
	if err != nil {
		t.Fatalf("LoadLessonsDefaultSkills() error = %v", err)
	}
	if len(skills) != 1 {
		t.Fatalf("skill count = %d, want 1", len(skills))
	}

	skill := skills[0]
	if skill.Name != "enact-lessons" {
		t.Fatalf("skill name = %q, want enact-lessons", skill.Name)
	}
	if strings.TrimSpace(skill.Description) == "" || strings.TrimSpace(skill.Content) == "" {
		t.Fatal("skill has an empty description or content")
	}

	// The source map is what keeps the skill's claims about product behaviour
	// checkable. A bundle that ships the skill without it ships assertions
	// nobody can trace.
	var hasSourceMap bool
	for _, file := range skill.Files {
		if strings.TrimSpace(file.Path) == "" {
			t.Error("bundled file has an empty path")
		}
		if file.Path == "references/lessons-source-map.md" {
			hasSourceMap = true
		}
	}
	if !hasSourceMap {
		t.Error("bundle is missing references/lessons-source-map.md")
	}
}

func TestLessonLearnerSpecResolves(t *testing.T) {
	t.Parallel()

	spec := LessonsLearnerAgentSpec()
	if spec.SystemKey != LessonsLearnerSystemKey {
		t.Fatalf("system key = %q, want %q", spec.SystemKey, LessonsLearnerSystemKey)
	}
	if strings.TrimSpace(spec.Name) == "" || strings.TrimSpace(spec.Instructions) == "" {
		t.Fatal("spec has an empty name or instructions")
	}

	// Every skill the spec names must exist in the bundle, or provisioning
	// fails at the point of binding — after the skills and the agent have
	// already been written.
	skills, err := LoadLessonsDefaultSkills()
	if err != nil {
		t.Fatalf("LoadLessonsDefaultSkills() error = %v", err)
	}
	available := make(map[string]struct{}, len(skills))
	for _, skill := range skills {
		available[skill.Name] = struct{}{}
	}
	if len(spec.SkillNames) == 0 {
		t.Fatal("spec mounts no skills")
	}
	for _, name := range spec.SkillNames {
		if _, ok := available[name]; !ok {
			t.Errorf("spec references skill %q, which the bundle does not contain", name)
		}
	}
}

func TestLessonLearnerInstructionsRefuseSelfApproval(t *testing.T) {
	t.Parallel()

	// The server refuses agent credentials on the decision endpoints, so this
	// is belt and braces. It is here because the instructions are the only
	// thing that stops the Learner from *trying*, and a run that spends its
	// turns getting 403s is a run that reports nothing useful.
	instructions := strings.ToLower(LessonsLearnerAgentSpec().Instructions)
	for _, phrase := range []string{"never approve", "only a person"} {
		if !strings.Contains(instructions, phrase) {
			t.Errorf("instructions no longer say %q; the Learner may try to decide its own proposals", phrase)
		}
	}
}

func TestLessonsBundleIsSeparatelyVersioned(t *testing.T) {
	t.Parallel()

	// Sharing a counter with the SDLC bundle would mean every change to either
	// re-provisions both, and a workspace blocked on one could not receive the
	// other. See the migration note on workspace.lessons_defaults_version.
	if LessonsDefaultsVersion < 1 {
		t.Fatalf("LessonsDefaultsVersion = %d, want at least 1", LessonsDefaultsVersion)
	}
}
