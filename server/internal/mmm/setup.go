package mmm

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Execer runs one external command with the given working directory, wiring
// its output to the provided writers. Injected so tests never execute real
// tools.
type Execer func(ctx context.Context, dir string, stdout, stderr io.Writer, name string, args ...string) error

// DefaultExecer executes commands with os/exec.
func DefaultExecer(ctx context.Context, dir string, stdout, stderr io.Writer, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	return cmd.Run()
}

// SetupOptions are the `enact mmm setup` flags.
type SetupOptions struct {
	// RuntimeDir adopts an existing mmm-runtime checkout instead of cloning
	// into the managed location (~/.enact/mmm-runtime).
	RuntimeDir string
	// Ref is the git ref to track. Empty means the persisted pin, falling
	// back to DefaultRuntimeRef.
	Ref string
	// Repo is the clone URL used when no checkout exists yet.
	Repo string
	// SkipDoctor skips the final scripts/doctor.py health check.
	SkipDoctor bool
}

// StepStatus classifies how a setup step ended.
type StepStatus string

const (
	StepOK StepStatus = "ok"
	// StepDegraded means the step failed but setup can continue; the user
	// gets the failure detail plus manual remediation in the summary.
	StepDegraded StepStatus = "degraded"
	StepSkipped  StepStatus = "skipped"
)

// StepResult records one step for the closing summary.
type StepResult struct {
	Name   string
	Status StepStatus
	Detail string
}

// Setup provisions mmm-runtime on the daemon host. All host interaction is
// injected for testability.
type Setup struct {
	Exec     Execer
	LookPath func(string) (string, error)
	Home     func() (string, error)
	Getenv   func(string) string
	Out      io.Writer
	ErrOut   io.Writer

	results []StepResult
}

// NewSetup returns a Setup wired to the real host.
func NewSetup(out, errOut io.Writer) *Setup {
	return &Setup{
		Exec:     DefaultExecer,
		LookPath: exec.LookPath,
		Home:     os.UserHomeDir,
		Getenv:   os.Getenv,
		Out:      out,
		ErrOut:   errOut,
	}
}

// Results exposes the per-step outcomes after Run returns.
func (s *Setup) Results() []StepResult { return s.results }

// Run executes the provisioning sequence:
//
//  1. resolve/clone/update the runtime checkout (hard failure)
//  2. pip install -e tools/engine (degradable)
//  3. npm install for the report generator (degradable)
//  4. register the Claude Code plugin via the claude CLI (degradable)
//  5. install the `mmm` entry point under $HOME (degradable)
//  6. scripts/doctor.py health check and scripts/selftest.py (hard failure
//     unless skipped)
//
// Degradable steps never abort the run: doctor is the authoritative
// readiness oracle and reports anything they left broken.
func (s *Setup) Run(ctx context.Context, opts SetupOptions) error {
	cfg, err := LoadConfig(s.Home)
	if err != nil {
		return err
	}

	runtimeDir, ref, err := s.resolveRuntime(ctx, cfg, opts)
	if err != nil {
		return err
	}

	s.installEngine(ctx, runtimeDir)
	s.installNodeDeps(ctx, runtimeDir)
	s.registerPlugin(ctx, runtimeDir)
	s.installShim(ctx, runtimeDir)

	cfg.RuntimeDir = runtimeDir
	cfg.RuntimeRef = ref
	if cfg.RuntimeGitURL == "" {
		cfg.RuntimeGitURL = firstNonEmpty(opts.Repo, DefaultRuntimeGitURL)
	} else if opts.Repo != "" {
		cfg.RuntimeGitURL = opts.Repo
	}
	if err := SaveConfig(s.Home, cfg); err != nil {
		return err
	}

	if opts.SkipDoctor {
		s.record("doctor", StepSkipped, "--skip-doctor")
		s.record("selftest", StepSkipped, "--skip-doctor")
	} else if err := s.runDoctor(ctx, runtimeDir); err != nil {
		s.printSummary()
		return fmt.Errorf("mmm-runtime health check failed — follow doctor's remediation above and re-run `enact mmm setup`: %w", err)
	} else if err := s.runSelfTest(ctx, runtimeDir); err != nil {
		s.printSummary()
		return fmt.Errorf("mmm-runtime self-test failed — fix the reported runtime invariant and re-run `enact mmm setup`: %w", err)
	}

	s.printSummary()
	return nil
}

// resolveRuntime decides which checkout to use and brings it to the pinned
// ref. Precedence: --runtime-dir flag > persisted pin > managed clone.
func (s *Setup) resolveRuntime(ctx context.Context, cfg Config, opts SetupOptions) (string, string, error) {
	ref := firstNonEmpty(opts.Ref, cfg.RuntimeRef, DefaultRuntimeRef)
	repo := firstNonEmpty(opts.Repo, cfg.RuntimeGitURL, DefaultRuntimeGitURL)

	managed, err := ManagedRuntimePath(s.Home)
	if err != nil {
		return "", "", err
	}

	dir := firstNonEmpty(opts.RuntimeDir, cfg.RuntimeDir, managed)
	dir, err = filepath.Abs(dir)
	if err != nil {
		return "", "", fmt.Errorf("resolve runtime dir: %w", err)
	}

	if !isRuntimeCheckout(dir) {
		if dir != managed {
			return "", "", fmt.Errorf("%s is not an mmm-runtime checkout (missing .claude-plugin/plugin.json)", dir)
		}
		s.stepBanner("Cloning mmm-runtime")
		if err := s.Exec(ctx, "", s.Out, s.ErrOut, "git", "clone", "--branch", ref, repo, dir); err != nil {
			return "", "", fmt.Errorf("clone %s: %w", repo, err)
		}
		s.record("runtime", StepOK, fmt.Sprintf("cloned %s @ %s", dir, ref))
		return dir, ref, nil
	}

	// Vendored copies (e.g. the mmm-runtime/ directory bundled inside a
	// shared Enact checkout) have no .git — they are updated by updating
	// the bundle itself, so skip the pull instead of reporting a scary
	// git failure.
	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		s.record("runtime", StepOK, fmt.Sprintf("using vendored checkout %s (no .git — updates ship with the bundle)", dir))
		return dir, ref, nil
	}

	s.stepBanner("Updating mmm-runtime checkout")
	// Adopted working trees may carry local work; a fast-forward-only pull
	// updates clean trees and refuses to touch diverged ones, in which case
	// we keep whatever the user has checked out.
	if err := s.Exec(ctx, dir, s.Out, s.ErrOut, "git", "pull", "--ff-only"); err != nil {
		s.record("runtime", StepDegraded,
			fmt.Sprintf("using %s as-is; auto-update failed (local changes or diverged history): %v", dir, err))
		return dir, ref, nil
	}
	s.record("runtime", StepOK, fmt.Sprintf("updated %s", dir))
	return dir, ref, nil
}

func (s *Setup) installEngine(ctx context.Context, runtimeDir string) {
	s.stepBanner("Installing mmm-engine (Python)")
	interpreter, err := s.engineInterpreter(ctx, runtimeDir)
	if err != nil {
		s.record("engine", StepDegraded, err.Error())
		return
	}
	engineDir := filepath.Join(runtimeDir, "tools", "engine")
	if err := s.Exec(ctx, runtimeDir, s.Out, s.ErrOut, interpreter, "-m", "pip", "install", "-e", engineDir); err != nil {
		s.record("engine", StepDegraded,
			fmt.Sprintf("pip install failed: %v — install manually: %s -m pip install -e %s", err, interpreter, engineDir))
		return
	}
	s.record("engine", StepOK, "into "+interpreter)
}

// engineInterpreter resolves the Python that owns the engine install:
// MMM_ENGINE_INTERPRETER wins, then the runtime's own .venv, which is
// created on the spot when missing — system Pythons routinely refuse
// direct pip installs (PEP 668), so a venv is the only reliable one-step
// target on a fresh host.
func (s *Setup) engineInterpreter(ctx context.Context, runtimeDir string) (string, error) {
	if env := s.Getenv("MMM_ENGINE_INTERPRETER"); env != "" {
		return env, nil
	}
	venvDir := filepath.Join(runtimeDir, ".venv")
	if py, ok := venvPython(venvDir); ok {
		return py, nil
	}
	base := s.basePython()
	if err := s.Exec(ctx, runtimeDir, s.Out, s.ErrOut, base, "-m", "venv", venvDir); err != nil {
		return "", fmt.Errorf("create engine venv failed: %v — create manually: %s -m venv %s", err, base, venvDir)
	}
	if py, ok := venvPython(venvDir); ok {
		return py, nil
	}
	return "", fmt.Errorf("engine venv at %s has no python executable", venvDir)
}

// basePython picks the interpreter that seeds the engine venv. The runtime
// requires Python 3.11+, but on stock macOS the plain `python3` on PATH is
// Apple's 3.9 — so prefer explicitly-versioned interpreters (newest first)
// and only fall back to generic python3. Doctor remains the authority: if
// even the fallback is too old, it fails with its own remediation.
func (s *Setup) basePython() string {
	for _, candidate := range []string{"python3.14", "python3.13", "python3.12", "python3.11"} {
		if _, err := s.LookPath(candidate); err == nil {
			return candidate
		}
	}
	return "python3"
}

// venvPython finds the interpreter inside a virtualenv, covering both the
// POSIX and Windows layouts.
func venvPython(venvDir string) (string, bool) {
	for _, candidate := range []string{
		filepath.Join(venvDir, "bin", "python"),
		filepath.Join(venvDir, "Scripts", "python.exe"),
	} {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, true
		}
	}
	return "", false
}

func (s *Setup) installNodeDeps(ctx context.Context, runtimeDir string) {
	s.stepBanner("Installing report generator dependencies (Node)")
	if err := s.Exec(ctx, runtimeDir, s.Out, s.ErrOut, "npm", "install"); err != nil {
		s.record("node", StepDegraded,
			fmt.Sprintf("npm install failed: %v — install manually: (cd %s && npm install)", err, runtimeDir))
		return
	}
	s.record("node", StepOK, "")
}

// registerPlugin points the canonical marketplace name at this runtime and
// updates the installed plugin. All state changes go through the Claude CLI.
func (s *Setup) registerPlugin(ctx context.Context, runtimeDir string) {
	s.stepBanner("Registering Claude Code plugin")
	manual := fmt.Sprintf("claude plugin marketplace remove mmm-runtime; claude plugin marketplace add %s; claude plugin update %s -y", runtimeDir, PluginSpec)
	if _, err := s.LookPath("claude"); err != nil {
		s.record("plugin", StepDegraded, "claude CLI not found — run manually: "+manual)
		return
	}
	if err := s.Exec(ctx, "", s.Out, s.ErrOut, "claude", "plugin", "validate", "--strict", runtimeDir); err != nil {
		s.record("plugin", StepDegraded, fmt.Sprintf("plugin validation failed: %v", err))
		return
	}
	// Removal is intentionally best-effort: the first setup run has no entry.
	_ = s.Exec(ctx, "", s.Out, s.ErrOut, "claude", "plugin", "marketplace", "remove", "mmm-runtime")
	if err := s.Exec(ctx, "", s.Out, s.ErrOut, "claude", "plugin", "marketplace", "add", runtimeDir); err != nil {
		s.record("plugin", StepDegraded, fmt.Sprintf("marketplace registration failed: %v — run manually: %s", err, manual))
		return
	}
	if err := s.Exec(ctx, "", s.Out, s.ErrOut, "claude", "plugin", "update", PluginSpec, "-y"); err != nil {
		if installErr := s.Exec(ctx, "", s.Out, s.ErrOut, "claude", "plugin", "install", PluginSpec); installErr != nil {
			s.record("plugin", StepDegraded, fmt.Sprintf("plugin update failed (%v); install failed (%v) — run manually: %s", err, installErr, manual))
			return
		}
	}
	var enableOutput strings.Builder
	enableWriter := io.MultiWriter(s.Out, &enableOutput)
	if err := s.Exec(ctx, "", enableWriter, enableWriter, "claude", "plugin", "enable", PluginSpec); err != nil &&
		!strings.Contains(strings.ToLower(enableOutput.String()), "already enabled") {
		s.record("plugin", StepDegraded, fmt.Sprintf("plugin enable failed: %v — run manually: claude plugin enable %s", err, PluginSpec))
		return
	}
	s.record("plugin", StepOK, "")
}

// installShim puts the `mmm` entry point at a fixed path under $HOME, so a
// skill can spell a command without knowing where the runtime is installed.
//
// Degradable: every skill spells the entry point in full, doctor reports it
// missing, and the script can be run by hand — so a failure here costs a manual
// step, not the installation.
func (s *Setup) installShim(ctx context.Context, runtimeDir string) {
	s.stepBanner("Installing the mmm entry point")
	script := filepath.Join(runtimeDir, "scripts", "install_shim.py")
	interpreter := s.scriptInterpreter(runtimeDir)
	if err := s.Exec(ctx, runtimeDir, s.Out, s.ErrOut, interpreter, script); err != nil {
		s.record("shim", StepDegraded,
			fmt.Sprintf("install failed: %v — run manually: %s %s", err, interpreter, script))
		return
	}
	s.record("shim", StepOK, "~/.local/bin/mmm")
}

// scriptInterpreter resolves the python that runs the runtime's own stdlib
// scripts: env override, then the runtime venv, then the best base python.
// Running them under an unsupported system python3 would fail a version gate
// even though the venv that actually executes the engine is fine.
func (s *Setup) scriptInterpreter(runtimeDir string) string {
	if interpreter := s.Getenv("MMM_ENGINE_INTERPRETER"); interpreter != "" {
		return interpreter
	}
	if py, ok := venvPython(filepath.Join(runtimeDir, ".venv")); ok {
		return py
	}
	return s.basePython()
}

func (s *Setup) runDoctor(ctx context.Context, runtimeDir string) error {
	s.stepBanner("Running mmm-runtime doctor")
	interpreter := s.scriptInterpreter(runtimeDir)
	doctor := filepath.Join(runtimeDir, "scripts", "doctor.py")
	if err := s.Exec(ctx, runtimeDir, s.Out, s.ErrOut, interpreter, doctor); err != nil {
		s.record("doctor", StepDegraded, err.Error())
		return err
	}
	s.record("doctor", StepOK, "")
	return nil
}

func (s *Setup) runSelfTest(ctx context.Context, runtimeDir string) error {
	s.stepBanner("Running mmm-runtime self-test")
	interpreter := s.scriptInterpreter(runtimeDir)
	selftest := filepath.Join(runtimeDir, "scripts", "selftest.py")
	if err := s.Exec(ctx, runtimeDir, s.Out, s.ErrOut, interpreter, selftest); err != nil {
		s.record("selftest", StepDegraded, err.Error())
		return err
	}
	s.record("selftest", StepOK, "")
	return nil
}

func (s *Setup) stepBanner(title string) {
	fmt.Fprintf(s.Out, "\n==> %s\n", title)
}

func (s *Setup) record(name string, status StepStatus, detail string) {
	s.results = append(s.results, StepResult{Name: name, Status: status, Detail: detail})
}

func (s *Setup) printSummary() {
	fmt.Fprintf(s.Out, "\nSetup summary:\n")
	degraded := 0
	for _, r := range s.results {
		line := fmt.Sprintf("  %-8s %s", r.Name, r.Status)
		if r.Detail != "" {
			line += " — " + r.Detail
		}
		fmt.Fprintln(s.Out, line)
		if r.Status == StepDegraded {
			degraded++
		}
	}
	if degraded > 0 {
		fmt.Fprintf(s.ErrOut, "\nSetup finished with %d warning(s); see details above.\n", degraded)
	}
}

func isRuntimeCheckout(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, ".claude-plugin", "plugin.json"))
	return err == nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
