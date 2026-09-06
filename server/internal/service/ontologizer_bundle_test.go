// The Ontologizer skills are prose that shells out to a Python package. Before
// that package travelled with them, installing one from the Marketplace gave a
// reader instructions naming scripts their machine did not have. These tests
// hold the two halves together: every skill ships the package, and neither the
// prose nor the agent prompts name a file the listing leaves behind.
//
// The size half of the contract lives in internal/handler, where the skill
// importer's caps are defined.
package service

import (
	"regexp"
	"strings"
	"testing"

	"github.com/enact-ai/enact/server/internal/ontologizer"
)

// ontologizerEntryPoints are the scripts and manifests the skills drive. A
// skill missing one of them installs as prose again.
var ontologizerEntryPoints = []string{
	"scripts/state.py",
	"scripts/validate.py",
	"scripts/revision.py",
	"scripts/package.py",
	"tools/cypher/run.py",
	"tools/extract/run.py",
	"shared/manifests/stages.yaml",
	"shared/manifests/decision-points.yaml",
	"shared/manifests/checks.yaml",
}

func ontologizerSkillFiles(t *testing.T) []AgentSkillData {
	t.Helper()
	skills, err := LoadOntologizerDefaultSkills()
	if err != nil {
		t.Fatalf("load bundle: %v", err)
	}
	if len(skills) == 0 {
		t.Fatal("bundle is empty")
	}
	return skills
}

func TestOntologizerSkillsEachShipTheWholePackage(t *testing.T) {
	for _, skill := range ontologizerSkillFiles(t) {
		paths := make(map[string]bool, len(skill.Files))
		for _, f := range skill.Files {
			if paths[f.Path] {
				t.Errorf("%s ships %s twice", skill.Name, f.Path)
			}
			paths[f.Path] = true
			// Caches and the upstream test suite are bytes every install pays
			// for and nothing reads. The sync script excludes them; this is
			// what notices when it stops.
			if strings.Contains(f.Path, "__pycache__") ||
				strings.HasSuffix(f.Path, ".pyc") ||
				strings.HasPrefix(f.Path, "evals/") {
				t.Errorf("%s ships build noise or the upstream test suite: %s", skill.Name, f.Path)
			}
		}
		for _, want := range ontologizerEntryPoints {
			if !paths[want] {
				t.Errorf("%s does not ship %s", skill.Name, want)
			}
		}
	}
}

// A package file gets named two ways, and both have to be checked: rooted at
// the package variable inside a command, and bare in backticks in prose.
var packageFileRefs = []*regexp.Regexp{
	regexp.MustCompile(`(?:\$PKG|<pkg>|\$ONTOLOGIZER_HOME)/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)`),
	regexp.MustCompile("`((?:scripts|shared|knowledge|tools)/[A-Za-z0-9_./-]+\\.[A-Za-z0-9]+)`"),
}

// namedPackageFiles returns every package-relative path the text points at.
func namedPackageFiles(text string) []string {
	var found []string
	for _, re := range packageFileRefs {
		for _, m := range re.FindAllStringSubmatch(text, -1) {
			found = append(found, m[1])
		}
	}
	return found
}

func TestOntologizerSkillProseOnlyNamesShippedFiles(t *testing.T) {
	for _, skill := range ontologizerSkillFiles(t) {
		paths := make(map[string]bool, len(skill.Files))
		for _, f := range skill.Files {
			paths[f.Path] = true
		}
		named := namedPackageFiles(skill.Content)
		if len(named) == 0 {
			t.Errorf("%s/SKILL.md names no package file; the check has stopped checking", skill.Name)
		}
		for _, ref := range named {
			if !paths[ref] {
				t.Errorf("%s/SKILL.md names %s, which the listing does not ship", skill.Name, ref)
			}
		}
	}
}

// The five role prompts are published with the agent listings, and a
// Marketplace install sets no environment variables. A prompt that named a
// path only the CLI-provisioned checkout has would strand exactly the reader
// this bundle exists to serve.
func TestOntologizerAgentPromptsOnlyNameShippedFiles(t *testing.T) {
	shipped := make(map[string]bool)
	for _, f := range ontologizerSkillFiles(t)[0].Files {
		shipped[f.Path] = true
	}

	checked := 0
	for _, agent := range ontologizer.DefaultAgentManifest().Agents {
		named := namedPackageFiles(agent.Instructions)
		checked += len(named)
		for _, ref := range named {
			if !shipped[ref] {
				t.Errorf("%s's instructions name %s, which no skill ships", agent.Name, ref)
			}
		}
		// $ONTOLOGIZER_HOME may be read as an override, but no command may
		// depend on it: the install that needs these prompts most is the one
		// that never sets it.
		for _, line := range strings.Split(agent.Instructions, "\n") {
			if strings.Contains(line, "python3 $ONTOLOGIZER_HOME") {
				t.Errorf("%s's instructions run a command through $ONTOLOGIZER_HOME: %s", agent.Name, strings.TrimSpace(line))
			}
		}
	}
	if checked == 0 {
		t.Error("no agent prompt names a package file; the check has stopped checking")
	}
}
