package service

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// The sdlc-core scripts resolve gate approvers from the workspace role catalog.
// That logic is Python, so it is tested in Python; this runs that suite as part
// of `make test` so a change to the scripts cannot land untested.
//
// The Python tests stand a FAKE `enact` on PATH — nothing here resolves or runs
// a user-installed CLI, and no account is touched.
func TestSDLCRoleScripts(t *testing.T) {
	t.Parallel()

	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not available")
	}
	// The scripts import PyYAML at module scope and exit 2 without it, which is
	// an environment problem rather than a failing check.
	if err := exec.Command(python, "-c", "import yaml").Run(); err != nil {
		t.Skip("PyYAML not available")
	}

	dir, err := filepath.Abs(filepath.Join("testdata", "sdlc"))
	if err != nil {
		t.Fatalf("resolve test dir: %v", err)
	}
	cmd := exec.Command(python, "-m", "unittest", "discover", "-s", dir, "-p", "test_*.py")
	// Byte-code caching would write __pycache__ INTO the embedded skill bundle,
	// and every file under it ships to agents — TestLoadSDLCDefaultSkills counts
	// them, so a second `go test` run would otherwise fail on the leftovers of
	// the first.
	cmd.Env = append(os.Environ(), "PYTHONDONTWRITEBYTECODE=1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("sdlc role script tests failed: %v\n%s", err, strings.TrimSpace(string(out)))
	}
}
