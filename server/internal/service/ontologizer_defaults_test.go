package service

import (
	"slices"
	"strings"
	"testing"

	"github.com/enact-ai/enact/server/internal/ontologizer"
)

// The vendored bundle and the portfolio are authored in two different places —
// the skills upstream in the Ontologizer repository, the roles here in the CLI
// package — and the provisioner is what binds one to the other. A skill renamed
// upstream and re-synced would otherwise reach the catalog as an agent bound to
// a skill that no longer exists, which fails at boot in production and here at
// test time instead.
func TestOntologizerBundleMatchesThePortfolio(t *testing.T) {
	t.Parallel()

	skills, err := LoadOntologizerDefaultSkills()
	if err != nil {
		t.Fatalf("LoadOntologizerDefaultSkills() error = %v", err)
	}

	gotNames := make([]string, 0, len(skills))
	for _, skill := range skills {
		gotNames = append(gotNames, skill.Name)
		if strings.TrimSpace(skill.Description) == "" || strings.TrimSpace(skill.Content) == "" {
			t.Errorf("skill %q has empty description or content", skill.Name)
		}
		if !strings.HasPrefix(skill.Name, ontologizer.SkillPrefix) {
			t.Errorf("skill %q is outside the plugin's invocation-key namespace", skill.Name)
		}
	}

	wantNames := slices.Clone(ontologizer.RuntimeSkillNames)
	slices.Sort(wantNames)
	slices.Sort(gotNames)
	if !slices.Equal(gotNames, wantNames) {
		t.Fatalf("vendored skills = %v, want the plugin's own list %v\n"+
			"re-run scripts/sync-ontologizer-skills.sh, or update ontologizer.RuntimeSkillNames", gotNames, wantNames)
	}
}

// Every role has to have an identity that survives a display-name change, and
// every skill a role binds has to exist in the bundle. Both are checked without
// a database because both are decided entirely by what ships in the binary.
func TestOntologizerPortfolioIsInternallyConsistent(t *testing.T) {
	t.Parallel()

	skills, err := LoadOntologizerDefaultSkills()
	if err != nil {
		t.Fatalf("LoadOntologizerDefaultSkills() error = %v", err)
	}
	available := make(map[string]bool, len(skills))
	for _, skill := range skills {
		available[skill.Name] = true
	}

	manifest := ontologizer.DefaultAgentManifest()
	systemKeys := make(map[string]string, len(manifest.Agents))
	for _, spec := range manifest.Agents {
		identity, ok := ontologizerAgentIdentities[spec.Name]
		if !ok {
			t.Errorf("portfolio agent %q has no system key; add it to ontologizerAgentIdentities", spec.Name)
			continue
		}
		if !strings.HasPrefix(identity.SystemKey, OntologizerSystemKeyPrefix) {
			t.Errorf("agent %q has system key %q, which the catalog publisher will group as SDLC",
				spec.Name, identity.SystemKey)
		}
		if previous, clash := systemKeys[identity.SystemKey]; clash {
			t.Errorf("agents %q and %q share system key %q", previous, spec.Name, identity.SystemKey)
		}
		systemKeys[identity.SystemKey] = spec.Name

		if strings.TrimSpace(spec.Instructions) == "" {
			t.Errorf("agent %q has no instructions; a published copy would do nothing", spec.Name)
		}
		if spec.MaxConcurrentTasks <= 0 {
			t.Errorf("agent %q has max_concurrent_tasks %d", spec.Name, spec.MaxConcurrentTasks)
		}
		for _, skillName := range spec.SkillNames {
			if !available[skillName] {
				t.Errorf("agent %q binds skill %q, which the vendored bundle does not contain", spec.Name, skillName)
			}
		}
	}

	if _, ok := ontologizerAgentIdentities[manifest.Squad.LeaderName]; !ok {
		t.Errorf("family leader %q is not a portfolio agent", manifest.Squad.LeaderName)
	}
	for _, name := range manifest.Squad.MemberNames {
		if _, ok := ontologizerAgentIdentities[name]; !ok {
			t.Errorf("family member %q is not a portfolio agent", name)
		}
	}
	if role := ontologizerAgentIdentities[manifest.Squad.LeaderName].SquadRole; role != "leader" {
		t.Errorf("leader %q carries squad role %q, want \"leader\"", manifest.Squad.LeaderName, role)
	}
}
