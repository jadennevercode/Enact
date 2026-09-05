package ontologizer

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type recordedCall struct {
	dir  string
	name string
	args []string
}

func (c recordedCall) String() string {
	return strings.TrimSpace(c.name + " " + strings.Join(c.args, " "))
}

// fakeHost drives Setup without touching real tools.
type fakeHost struct {
	t     *testing.T
	home  string
	calls []recordedCall
	// fail maps a command prefix to an error returned when a call matches it.
	fail map[string]error
	// missingBinaries makes LookPath fail for these names.
	missingBinaries map[string]bool
	// extraBinaries makes LookPath succeed for names beyond knownBinaries.
	extraBinaries map[string]bool
	env           map[string]string
}

func newFakeHost(t *testing.T) *fakeHost {
	return &fakeHost{
		t:               t,
		home:            t.TempDir(),
		fail:            map[string]error{},
		missingBinaries: map[string]bool{},
		extraBinaries:   map[string]bool{},
		env:             map[string]string{},
	}
}

func (f *fakeHost) exec(_ context.Context, dir string, _, _ io.Writer, name string, args ...string) error {
	call := recordedCall{dir: dir, name: name, args: args}
	f.calls = append(f.calls, call)
	for prefix, err := range f.fail {
		if strings.HasPrefix(call.String(), prefix) {
			return err
		}
	}
	// A successful clone must leave a checkout behind for later steps.
	if name == "git" && len(args) > 0 && args[0] == "clone" {
		writeCheckout(f.t, args[len(args)-1], true)
	}
	return nil
}

// knownBinaries is the default toolchain the fake host "has installed".
// Versioned pythons are deliberately absent so the default expectation is the
// generic python3 fallback; tests opt individual versions in.
var knownBinaries = map[string]bool{"git": true, "claude": true, "python3": true}

func (f *fakeHost) lookPath(name string) (string, error) {
	if f.missingBinaries[name] {
		return "", errors.New("not found")
	}
	if knownBinaries[name] || f.extraBinaries[name] {
		return "/usr/bin/" + name, nil
	}
	return "", errors.New("not found")
}

func (f *fakeHost) setup() *Setup {
	return &Setup{
		Exec:     f.exec,
		LookPath: f.lookPath,
		Home:     func() (string, error) { return f.home, nil },
		Getenv:   func(key string) string { return f.env[key] },
		Out:      &bytes.Buffer{},
		ErrOut:   &bytes.Buffer{},
	}
}

func (f *fakeHost) hasCommandPrefix(prefix string) bool {
	for _, c := range f.calls {
		if strings.HasPrefix(c.String(), prefix) {
			return true
		}
	}
	return false
}

func (f *fakeHost) commandStrings() []string {
	out := make([]string, 0, len(f.calls))
	for _, c := range f.calls {
		out = append(out, c.String())
	}
	return out
}

// writeCheckout lays down what makes a directory an Ontologizer checkout.
func writeCheckout(t *testing.T, dir string, withGit bool) {
	t.Helper()
	manifestDir := filepath.Join(dir, ".claude-plugin")
	if err := os.MkdirAll(manifestDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(manifestDir, "plugin.json"), []byte(`{"name":"ontologizer"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if withGit {
		if err := os.MkdirAll(filepath.Join(dir, ".git"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
}

func hasStep(results []StepResult, name string, status StepStatus) bool {
	for _, r := range results {
		if r.Name == name && r.Status == status {
			return true
		}
	}
	return false
}

func TestSetupAdoptsExistingCheckoutWithoutCloning(t *testing.T) {
	host := newFakeHost(t)
	dir := t.TempDir()
	writeCheckout(t, dir, true)

	s := host.setup()
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: dir}); err != nil {
		t.Fatalf("setup: %v", err)
	}
	if host.hasCommandPrefix("git clone") {
		t.Errorf("adopting a checkout must not clone: %v", host.commandStrings())
	}
	if !host.hasCommandPrefix("git pull --ff-only") {
		t.Errorf("an adopted git checkout should be fast-forwarded: %v", host.commandStrings())
	}
	cfg, err := LoadConfig(func() (string, error) { return host.home, nil })
	if err != nil {
		t.Fatal(err)
	}
	if cfg.RuntimeDir != dir {
		t.Errorf("persisted dir %q, want %q", cfg.RuntimeDir, dir)
	}
}

func TestSetupRefusesToCloneWithoutARemote(t *testing.T) {
	host := newFakeHost(t)

	s := host.setup()
	err := s.Run(context.Background(), SetupOptions{})
	if err == nil {
		t.Fatal("setup should fail when there is no checkout and no clone URL")
	}
	// The point of the error is that it names the fix. Ontologizer has no
	// published remote, so a bare git failure would be a riddle.
	if !strings.Contains(err.Error(), "--runtime-dir") {
		t.Errorf("error should point at --runtime-dir, got: %v", err)
	}
	if host.hasCommandPrefix("git clone") {
		t.Error("nothing should have been cloned")
	}
}

func TestSetupClonesWhenARepoIsGiven(t *testing.T) {
	host := newFakeHost(t)

	s := host.setup()
	if err := s.Run(context.Background(), SetupOptions{Repo: "https://example.test/Ontologizer"}); err != nil {
		t.Fatalf("setup: %v", err)
	}
	if !host.hasCommandPrefix("git clone --branch main https://example.test/Ontologizer") {
		t.Errorf("expected a clone of the given repo: %v", host.commandStrings())
	}
}

func TestSetupRejectsNonCheckoutDir(t *testing.T) {
	host := newFakeHost(t)
	dir := t.TempDir()

	s := host.setup()
	err := s.Run(context.Background(), SetupOptions{RuntimeDir: dir})
	if err == nil || !strings.Contains(err.Error(), "not an Ontologizer checkout") {
		t.Fatalf("want a checkout-shape error, got: %v", err)
	}
}

func TestSetupRunsThreeHealthScriptsInOrder(t *testing.T) {
	host := newFakeHost(t)
	dir := t.TempDir()
	writeCheckout(t, dir, true)

	s := host.setup()
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: dir}); err != nil {
		t.Fatalf("setup: %v", err)
	}
	for _, script := range []string{"doctor.py", "check_suite.py", "selftest.py"} {
		if !host.hasCommandPrefix("python3 " + filepath.Join(dir, "scripts", script)) {
			t.Errorf("%s was never run: %v", script, host.commandStrings())
		}
	}
	for _, name := range []string{"doctor", "check_suite", "selftest"} {
		if !hasStep(s.Results(), name, StepOK) {
			t.Errorf("%s step should be ok: %+v", name, s.Results())
		}
	}
}

func TestSetupStopsAtTheFirstFailingCheck(t *testing.T) {
	host := newFakeHost(t)
	dir := t.TempDir()
	writeCheckout(t, dir, true)
	host.fail["python3 "+filepath.Join(dir, "scripts", "check_suite.py")] = errors.New("2 problems")

	s := host.setup()
	err := s.Run(context.Background(), SetupOptions{RuntimeDir: dir})
	if err == nil || !strings.Contains(err.Error(), "check_suite.py") {
		t.Fatalf("want the failing script named in the error, got: %v", err)
	}
	// A failing check is what says this host cannot produce a revision, so the
	// run stops rather than reporting later checks against a broken package.
	if host.hasCommandPrefix("python3 " + filepath.Join(dir, "scripts", "selftest.py")) {
		t.Error("selftest should not run after check_suite failed")
	}
}

func TestSetupSkipChecksRecordsAllThreeAsSkipped(t *testing.T) {
	host := newFakeHost(t)
	dir := t.TempDir()
	writeCheckout(t, dir, true)

	s := host.setup()
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: dir, SkipChecks: true}); err != nil {
		t.Fatalf("setup: %v", err)
	}
	for _, name := range []string{"doctor", "check_suite", "selftest"} {
		if !hasStep(s.Results(), name, StepSkipped) {
			t.Errorf("%s should be skipped: %+v", name, s.Results())
		}
	}
}

func TestSetupDegradesWhenClaudeCLIMissing(t *testing.T) {
	host := newFakeHost(t)
	host.missingBinaries["claude"] = true
	dir := t.TempDir()
	writeCheckout(t, dir, true)

	s := host.setup()
	// A host without the claude CLI can still be provisioned; the plugin step
	// reports manual remediation instead of aborting.
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: dir}); err != nil {
		t.Fatalf("setup should survive a missing claude CLI: %v", err)
	}
	if !hasStep(s.Results(), "plugin", StepDegraded) {
		t.Fatalf("plugin step should be degraded: %+v", s.Results())
	}
}

func TestSetupTreatsAlreadyEnabledPluginAsSuccess(t *testing.T) {
	host := newFakeHost(t)
	dir := t.TempDir()
	writeCheckout(t, dir, true)
	host.fail["claude plugin enable"] = errors.New("exit status 1")

	s := &Setup{
		Exec: func(ctx context.Context, execDir string, stdout, stderr io.Writer, name string, args ...string) error {
			if name == "claude" && len(args) >= 2 && args[0] == "plugin" && args[1] == "enable" {
				_, _ = io.WriteString(stdout, "Plugin ontologizer is already enabled\n")
			}
			return host.exec(ctx, execDir, stdout, stderr, name, args...)
		},
		LookPath: host.lookPath,
		Home:     func() (string, error) { return host.home, nil },
		Getenv:   func(string) string { return "" },
		Out:      &bytes.Buffer{},
		ErrOut:   &bytes.Buffer{},
	}
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: dir}); err != nil {
		t.Fatalf("setup: %v", err)
	}
	if !hasStep(s.Results(), "plugin", StepOK) {
		t.Fatalf("already-enabled plugin should be ok: %+v", s.Results())
	}
}

func TestSetupVendoredCheckoutSkipsGitUpdate(t *testing.T) {
	host := newFakeHost(t)
	dir := t.TempDir()
	writeCheckout(t, dir, false)

	s := host.setup()
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: dir}); err != nil {
		t.Fatalf("setup: %v", err)
	}
	if host.hasCommandPrefix("git pull") {
		t.Errorf("a checkout without .git must not be pulled: %v", host.commandStrings())
	}
	if !hasStep(s.Results(), "runtime", StepOK) {
		t.Errorf("runtime step should be ok: %+v", s.Results())
	}
}

func TestSetupDegradesOnDivergedAdoptedTree(t *testing.T) {
	host := newFakeHost(t)
	dir := t.TempDir()
	writeCheckout(t, dir, true)
	host.fail["git pull --ff-only"] = errors.New("diverged")

	s := host.setup()
	// Local work in an adopted checkout is the operator's, not ours to reset.
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: dir}); err != nil {
		t.Fatalf("setup should continue with the tree as-is: %v", err)
	}
	if !hasStep(s.Results(), "runtime", StepDegraded) {
		t.Fatalf("runtime step should be degraded: %+v", s.Results())
	}
}

func TestSetupHonorsPythonOverride(t *testing.T) {
	host := newFakeHost(t)
	host.env[PythonEnvVar] = "/opt/py/bin/python3.13"
	dir := t.TempDir()
	writeCheckout(t, dir, true)

	s := host.setup()
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: dir}); err != nil {
		t.Fatalf("setup: %v", err)
	}
	if !host.hasCommandPrefix("/opt/py/bin/python3.13 " + filepath.Join(dir, "scripts", "doctor.py")) {
		t.Errorf("the override interpreter should run the checks: %v", host.commandStrings())
	}
}

func TestSetupPrefersNewestVersionedPython(t *testing.T) {
	host := newFakeHost(t)
	host.extraBinaries["python3.12"] = true
	dir := t.TempDir()
	writeCheckout(t, dir, true)

	s := host.setup()
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: dir}); err != nil {
		t.Fatalf("setup: %v", err)
	}
	// On stock macOS the plain python3 is Apple's 3.9, which the package's
	// own scripts refuse.
	if !host.hasCommandPrefix("python3.12 " + filepath.Join(dir, "scripts", "doctor.py")) {
		t.Errorf("expected python3.12 to be preferred: %v", host.commandStrings())
	}
}

func TestSetupSecondRunReusesPersistedDir(t *testing.T) {
	host := newFakeHost(t)
	dir := t.TempDir()
	writeCheckout(t, dir, true)

	if err := host.setup().Run(context.Background(), SetupOptions{RuntimeDir: dir}); err != nil {
		t.Fatalf("first setup: %v", err)
	}
	host.calls = nil
	if err := host.setup().Run(context.Background(), SetupOptions{}); err != nil {
		t.Fatalf("second setup: %v", err)
	}
	if host.hasCommandPrefix("git clone") {
		t.Errorf("re-running must reuse the persisted checkout: %v", host.commandStrings())
	}
	if !host.hasCommandPrefix("python3 " + filepath.Join(dir, "scripts", "selftest.py")) {
		t.Errorf("the persisted checkout should be re-checked: %v", host.commandStrings())
	}
}
