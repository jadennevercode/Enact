package mmm

import (
	"bytes"
	"context"
	"errors"
	"fmt"
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
	// fail maps a command prefix (e.g. "git pull", "python3 -m pip") to an
	// error returned when a call matches it.
	fail map[string]error
	// missingBinaries makes LookPath fail for these names.
	missingBinaries map[string]bool
	// extraBinaries makes LookPath succeed for names beyond knownBinaries.
	extraBinaries map[string]bool
}

func newFakeHost(t *testing.T) *fakeHost {
	return &fakeHost{
		t:               t,
		home:            t.TempDir(),
		fail:            map[string]error{},
		missingBinaries: map[string]bool{},
		extraBinaries:   map[string]bool{},
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
		target := args[len(args)-1]
		writePluginManifest(f.t, target)
	}
	// A successful venv creation must leave an interpreter behind.
	if len(args) >= 3 && args[0] == "-m" && args[1] == "venv" {
		writeVenvPython(f.t, args[2])
	}
	return nil
}

// knownBinaries is the default toolchain the fake host "has installed".
// Versioned pythons are deliberately absent so the default expectation is
// the generic python3 fallback; tests opt individual versions in via
// extraBinaries.
var knownBinaries = map[string]bool{"git": true, "npm": true, "claude": true, "python3": true}

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
		Getenv:   func(string) string { return "" },
		Out:      &bytes.Buffer{},
		ErrOut:   &bytes.Buffer{},
	}
}

func (f *fakeHost) commandStrings() []string {
	out := make([]string, 0, len(f.calls))
	for _, c := range f.calls {
		out = append(out, c.String())
	}
	return out
}

func (f *fakeHost) hasCommandPrefix(prefix string) bool {
	for _, c := range f.calls {
		if strings.HasPrefix(c.String(), prefix) {
			return true
		}
	}
	return false
}

func writeVenvPython(t *testing.T, venvDir string) {
	t.Helper()
	binDir := filepath.Join(venvDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binDir, "python"), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
}

func writePluginManifest(t *testing.T, dir string) {
	t.Helper()
	writeVendoredManifest(t, dir)
	// Fixtures model real git checkouts by default; vendored-copy tests use
	// writeVendoredManifest directly.
	if err := os.MkdirAll(filepath.Join(dir, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
}

// writeVendoredManifest lays down a runtime checkout WITHOUT .git — the
// vendored-bundle shape (mmm-runtime/ inside a shared Enact checkout).
func writeVendoredManifest(t *testing.T, dir string) {
	t.Helper()
	manifestDir := filepath.Join(dir, ".claude-plugin")
	if err := os.MkdirAll(manifestDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(manifestDir, "plugin.json"), []byte(`{"name":"mmm"}`), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSetupClonesIntoManagedDirWhenNoCheckoutExists(t *testing.T) {
	host := newFakeHost(t)
	s := host.setup()

	if err := s.Run(context.Background(), SetupOptions{}); err != nil {
		t.Fatalf("Run: %v", err)
	}

	managed := filepath.Join(host.home, ".enact", "mmm-runtime")
	wantClone := fmt.Sprintf("git clone --branch %s %s %s", DefaultRuntimeRef, DefaultRuntimeGitURL, managed)
	if !host.hasCommandPrefix(wantClone) {
		t.Fatalf("expected clone command %q, got %v", wantClone, host.commandStrings())
	}
	venvPy := filepath.Join(managed, ".venv", "bin", "python")
	for _, prefix := range []string{
		"python3 -m venv " + filepath.Join(managed, ".venv"),
		venvPy + " -m pip install -e " + filepath.Join(managed, "tools", "engine"),
		"npm install",
		"claude plugin validate --strict " + managed,
		"claude plugin marketplace remove mmm-runtime",
		"claude plugin marketplace add " + managed,
		"claude plugin update " + PluginSpec + " -y",
		"claude plugin enable " + PluginSpec,
		venvPy + " " + filepath.Join(managed, "scripts", "doctor.py"),
		venvPy + " " + filepath.Join(managed, "scripts", "selftest.py"),
	} {
		if !host.hasCommandPrefix(prefix) {
			t.Errorf("missing command %q in %v", prefix, host.commandStrings())
		}
	}

	cfg, err := LoadConfig(s.Home)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.RuntimeDir != managed || cfg.RuntimeRef != DefaultRuntimeRef || cfg.RuntimeGitURL != DefaultRuntimeGitURL {
		t.Fatalf("persisted config = %+v", cfg)
	}
}

func TestSetupAdoptsExistingCheckoutWithoutCloning(t *testing.T) {
	host := newFakeHost(t)
	adopted := filepath.Join(host.home, "src", "mmm-runtime")
	writePluginManifest(t, adopted)

	s := host.setup()
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: adopted}); err != nil {
		t.Fatalf("Run: %v", err)
	}

	if host.hasCommandPrefix("git clone") {
		t.Fatalf("adopted checkout must not be re-cloned: %v", host.commandStrings())
	}
	if !host.hasCommandPrefix("git pull --ff-only") {
		t.Fatalf("expected ff-only update, got %v", host.commandStrings())
	}
	cfg, err := LoadConfig(s.Home)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.RuntimeDir != adopted {
		t.Fatalf("persisted runtime dir = %q, want %q", cfg.RuntimeDir, adopted)
	}
}

func TestSetupSecondRunReusesPersistedDir(t *testing.T) {
	host := newFakeHost(t)
	adopted := filepath.Join(host.home, "src", "mmm-runtime")
	writePluginManifest(t, adopted)

	if err := host.setup().Run(context.Background(), SetupOptions{RuntimeDir: adopted}); err != nil {
		t.Fatalf("first Run: %v", err)
	}
	host.calls = nil

	// Re-run without --runtime-dir: the persisted pin must win over the
	// managed default.
	if err := host.setup().Run(context.Background(), SetupOptions{}); err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if host.hasCommandPrefix("git clone") {
		t.Fatalf("second run must not clone: %v", host.commandStrings())
	}
	venvPy := filepath.Join(adopted, ".venv", "bin", "python")
	if !host.hasCommandPrefix(venvPy + " -m pip install -e " + filepath.Join(adopted, "tools", "engine")) {
		t.Fatalf("second run should reinstall engine from %s: %v", adopted, host.commandStrings())
	}
	// The venv created by the first run must be reused, not recreated.
	venvCreations := 0
	for _, c := range host.commandStrings() {
		if strings.HasPrefix(c, "python3 -m venv") {
			venvCreations++
		}
	}
	if venvCreations != 0 {
		t.Fatalf("second run must reuse the existing venv: %v", host.commandStrings())
	}
}

func TestSetupRejectsNonRuntimeDir(t *testing.T) {
	host := newFakeHost(t)
	notRuntime := filepath.Join(host.home, "elsewhere")
	if err := os.MkdirAll(notRuntime, 0o755); err != nil {
		t.Fatal(err)
	}

	err := host.setup().Run(context.Background(), SetupOptions{RuntimeDir: notRuntime})
	if err == nil || !strings.Contains(err.Error(), "not an mmm-runtime checkout") {
		t.Fatalf("expected checkout validation error, got %v", err)
	}
}

func TestSetupDegradesWhenClaudeCLIMissing(t *testing.T) {
	host := newFakeHost(t)
	host.missingBinaries["claude"] = true
	adopted := filepath.Join(host.home, "src", "mmm-runtime")
	writePluginManifest(t, adopted)

	s := host.setup()
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: adopted}); err != nil {
		t.Fatalf("Run should degrade, not fail: %v", err)
	}
	if host.hasCommandPrefix("claude") {
		t.Fatalf("claude must not be invoked when missing: %v", host.commandStrings())
	}
	if !hasStep(s.Results(), "plugin", StepDegraded) {
		t.Fatalf("plugin step should be degraded: %+v", s.Results())
	}
}

func TestSetupDegradesOnDirtyAdoptedTree(t *testing.T) {
	host := newFakeHost(t)
	host.fail["git pull --ff-only"] = errors.New("diverged")
	adopted := filepath.Join(host.home, "src", "mmm-runtime")
	writePluginManifest(t, adopted)

	s := host.setup()
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: adopted}); err != nil {
		t.Fatalf("Run should continue on failed pull: %v", err)
	}
	if !hasStep(s.Results(), "runtime", StepDegraded) {
		t.Fatalf("runtime step should be degraded: %+v", s.Results())
	}
}

func TestSetupInstallsShimBeforeDoctor(t *testing.T) {
	host := newFakeHost(t)
	adopted := filepath.Join(host.home, "src", "mmm-runtime")
	writePluginManifest(t, adopted)

	s := host.setup()
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: adopted}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	shim := filepath.Join(adopted, "scripts", "install_shim.py")
	if !host.hasCommandPrefix(filepath.Join(adopted, ".venv", "bin", "python") + " " + shim) {
		t.Fatalf("install_shim.py must run under the venv python: %v", host.commandStrings())
	}
	if !hasStep(s.Results(), "shim", StepOK) {
		t.Fatalf("shim step should be ok: %+v", s.Results())
	}
	// Doctor is the readiness oracle, so it has to see the shim already
	// installed — otherwise it reports a missing entry point on a good install.
	shimAt, doctorAt := -1, -1
	for i, call := range host.commandStrings() {
		if strings.Contains(call, "install_shim.py") {
			shimAt = i
		}
		if strings.Contains(call, "doctor.py") {
			doctorAt = i
		}
	}
	if shimAt < 0 || doctorAt < 0 || shimAt > doctorAt {
		t.Fatalf("shim must be installed before doctor runs: %v", host.commandStrings())
	}
}

func TestSetupDegradesWhenShimInstallFails(t *testing.T) {
	host := newFakeHost(t)
	adopted := filepath.Join(host.home, "src", "mmm-runtime")
	writePluginManifest(t, adopted)
	host.fail[filepath.Join(adopted, ".venv", "bin", "python")+" "+
		filepath.Join(adopted, "scripts", "install_shim.py")] = errors.New("permission denied")

	s := host.setup()
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: adopted}); err != nil {
		t.Fatalf("a failed shim install must not abort setup: %v", err)
	}
	if !hasStep(s.Results(), "shim", StepDegraded) {
		t.Fatalf("shim step should be degraded: %+v", s.Results())
	}
}

func TestRegisterPluginTreatsAlreadyEnabledAsSuccess(t *testing.T) {
	s := &Setup{
		Exec: func(_ context.Context, _ string, stdout, stderr io.Writer, name string, args ...string) error {
			if name == "claude" && len(args) >= 2 && args[0] == "plugin" && args[1] == "enable" {
				fmt.Fprintln(stderr, `Plugin "mmm@mmm-runtime" is already enabled`)
				return errors.New("exit status 1")
			}
			return nil
		},
		LookPath: func(string) (string, error) { return "/usr/bin/claude", nil },
		Out:      &bytes.Buffer{},
		ErrOut:   &bytes.Buffer{},
	}

	s.registerPlugin(context.Background(), t.TempDir())
	if !hasStep(s.Results(), "plugin", StepOK) {
		t.Fatalf("already-enabled plugin should be ok: %+v", s.Results())
	}
}

func TestSetupFailsWhenDoctorFails(t *testing.T) {
	host := newFakeHost(t)
	venvPy := filepath.Join(host.home, "src", "mmm-runtime", ".venv", "bin", "python")
	host.fail[venvPy+" "+filepath.Join(host.home, "src", "mmm-runtime", "scripts", "doctor.py")] = errors.New("exit 1")
	adopted := filepath.Join(host.home, "src", "mmm-runtime")
	writePluginManifest(t, adopted)

	err := host.setup().Run(context.Background(), SetupOptions{RuntimeDir: adopted})
	if err == nil || !strings.Contains(err.Error(), "health check failed") {
		t.Fatalf("expected doctor failure, got %v", err)
	}
}

func TestSetupSkipDoctor(t *testing.T) {
	host := newFakeHost(t)
	adopted := filepath.Join(host.home, "src", "mmm-runtime")
	writePluginManifest(t, adopted)

	s := host.setup()
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: adopted, SkipDoctor: true}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if host.hasCommandPrefix(filepath.Join(adopted, ".venv", "bin", "python") + " " + filepath.Join(adopted, "scripts", "doctor.py")) {
		t.Fatalf("doctor must not run with SkipDoctor: %v", host.commandStrings())
	}
	if !hasStep(s.Results(), "doctor", StepSkipped) {
		t.Fatalf("doctor step should be skipped: %+v", s.Results())
	}
	if host.hasCommandPrefix(filepath.Join(adopted, ".venv", "bin", "python") + " " + filepath.Join(adopted, "scripts", "selftest.py")) {
		t.Fatalf("selftest must not run with SkipDoctor: %v", host.commandStrings())
	}
	if !hasStep(s.Results(), "selftest", StepSkipped) {
		t.Fatalf("selftest step should be skipped: %+v", s.Results())
	}
}

func TestSetupFailsWhenSelfTestFails(t *testing.T) {
	host := newFakeHost(t)
	adopted := filepath.Join(host.home, "src", "mmm-runtime")
	writePluginManifest(t, adopted)
	venvPy := filepath.Join(adopted, ".venv", "bin", "python")
	host.fail[venvPy+" "+filepath.Join(adopted, "scripts", "selftest.py")] = errors.New("exit 1")

	err := host.setup().Run(context.Background(), SetupOptions{RuntimeDir: adopted})
	if err == nil || !strings.Contains(err.Error(), "self-test failed") {
		t.Fatalf("expected selftest failure, got %v", err)
	}
}

func TestSetupHonorsEngineInterpreterEnv(t *testing.T) {
	host := newFakeHost(t)
	adopted := filepath.Join(host.home, "src", "mmm-runtime")
	writePluginManifest(t, adopted)

	s := host.setup()
	s.Getenv = func(key string) string {
		if key == "MMM_ENGINE_INTERPRETER" {
			return "/opt/venv/bin/python"
		}
		return ""
	}
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: adopted}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !host.hasCommandPrefix("/opt/venv/bin/python -m pip install") {
		t.Fatalf("expected custom interpreter for pip, got %v", host.commandStrings())
	}
	if !host.hasCommandPrefix("/opt/venv/bin/python " + filepath.Join(adopted, "scripts", "doctor.py")) {
		t.Fatalf("expected custom interpreter for doctor, got %v", host.commandStrings())
	}
}

func TestSetupVendoredCheckoutSkipsGitUpdate(t *testing.T) {
	host := newFakeHost(t)
	vendored := filepath.Join(host.home, "bundle", "mmm-runtime")
	writeVendoredManifest(t, vendored)

	s := host.setup()
	if err := s.Run(context.Background(), SetupOptions{RuntimeDir: vendored}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if host.hasCommandPrefix("git") {
		t.Fatalf("vendored checkout must not run git at all: %v", host.commandStrings())
	}
	if !hasStep(s.Results(), "runtime", StepOK) {
		t.Fatalf("vendored runtime step should be ok, got %+v", s.Results())
	}
}

func TestSetupPrefersVersionedPythonForVenv(t *testing.T) {
	host := newFakeHost(t)
	host.extraBinaries["python3.12"] = true
	adopted := filepath.Join(host.home, "src", "mmm-runtime")
	writePluginManifest(t, adopted)

	if err := host.setup().Run(context.Background(), SetupOptions{RuntimeDir: adopted}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !host.hasCommandPrefix("python3.12 -m venv " + filepath.Join(adopted, ".venv")) {
		t.Fatalf("expected python3.12 to seed the venv, got %v", host.commandStrings())
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
