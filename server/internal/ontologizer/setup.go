package ontologizer

// Provisioning the Ontologizer checkout on a daemon host.
//
// This is deliberately not shared with internal/mmm's Setup. The two have the
// same skeleton but different bodies: mmm installs a Python analysis engine, a
// Node report generator, and a shell entry point, none of which exist here —
// Ontologizer is standard library only, which is why its three health scripts
// can be the whole readiness story. Sharing the skeleton would mean a struct
// whose fields half the callers ignore; the portfolio layer is where these two
// integrations genuinely do the same thing, and that one is shared.

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

// SetupOptions are the `enact ontologizer setup` flags.
type SetupOptions struct {
	// RuntimeDir adopts an existing checkout instead of cloning into the
	// managed location (~/.enact/ontologizer).
	RuntimeDir string
	// Ref is the git ref to track. Empty means the persisted pin, falling
	// back to DefaultRuntimeRef.
	Ref string
	// Repo is the clone URL used when no checkout exists yet.
	Repo string
	// SkipChecks skips the three health scripts. The flag exists for
	// diagnosing a half-broken host, not for routine use: the checks are the
	// only thing that decides whether this host can actually run a build.
	SkipChecks bool
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

// Setup provisions the Ontologizer checkout on the daemon host. All host
// interaction is injected for testability.
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
//  1. resolve/clone/update the checkout (hard failure)
//  2. register the Claude Code plugin via the claude CLI (degradable)
//  3. doctor.py, check_suite.py and selftest.py (hard failure unless skipped)
//
// The plugin step is degradable because a host without the claude CLI can
// still be provisioned for a different runtime family; the three checks are
// not, because they are what decides whether this host can produce a
// revision at all.
func (s *Setup) Run(ctx context.Context, opts SetupOptions) error {
	cfg, err := LoadConfig(s.Home)
	if err != nil {
		return err
	}

	runtimeDir, ref, err := s.resolveRuntime(ctx, cfg, opts)
	if err != nil {
		return err
	}

	s.registerPlugin(ctx, runtimeDir)

	cfg.RuntimeDir = runtimeDir
	cfg.RuntimeRef = ref
	if opts.Repo != "" {
		cfg.RuntimeGitURL = opts.Repo
	}
	if err := SaveConfig(s.Home, cfg); err != nil {
		return err
	}

	if opts.SkipChecks {
		for _, name := range []string{"doctor", "check_suite", "selftest"} {
			s.record(name, StepSkipped, "--skip-checks")
		}
	} else if err := s.runChecks(ctx, runtimeDir); err != nil {
		s.printSummary()
		return err
	}

	s.printSummary()
	s.printNextSteps(runtimeDir)
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
			return "", "", fmt.Errorf("%s is not an Ontologizer checkout (missing .claude-plugin/plugin.json)", dir)
		}
		if repo == "" {
			return "", "", fmt.Errorf(
				"no Ontologizer checkout found at %s and no clone URL configured — "+
					"point setup at your working copy with --runtime-dir <path>, or pass --repo <url> once a remote exists", dir)
		}
		s.stepBanner("Cloning Ontologizer")
		if err := s.Exec(ctx, "", s.Out, s.ErrOut, "git", "clone", "--branch", ref, repo, dir); err != nil {
			return "", "", fmt.Errorf("clone %s: %w", repo, err)
		}
		s.record("runtime", StepOK, fmt.Sprintf("cloned %s @ %s", dir, ref))
		return dir, ref, nil
	}

	// A checkout with no .git is a vendored copy; it is updated by updating
	// whatever bundled it, so skip the pull instead of reporting a scary git
	// failure.
	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		s.record("runtime", StepOK, fmt.Sprintf("using checkout %s (no .git — updates ship with the bundle)", dir))
		return dir, ref, nil
	}

	s.stepBanner("Updating the Ontologizer checkout")
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

// registerPlugin points the marketplace name at this checkout and updates the
// installed plugin. All state changes go through the Claude CLI.
func (s *Setup) registerPlugin(ctx context.Context, runtimeDir string) {
	s.stepBanner("Registering Claude Code plugin")
	manual := fmt.Sprintf("claude plugin marketplace remove %s; claude plugin marketplace add %s; claude plugin update %s -y",
		MarketplaceName, runtimeDir, PluginSpec)
	if _, err := s.LookPath("claude"); err != nil {
		s.record("plugin", StepDegraded, "claude CLI not found — run manually: "+manual)
		return
	}
	if err := s.Exec(ctx, "", s.Out, s.ErrOut, "claude", "plugin", "validate", "--strict", runtimeDir); err != nil {
		s.record("plugin", StepDegraded, fmt.Sprintf("plugin validation failed: %v", err))
		return
	}
	// Removal is intentionally best-effort: the first setup run has no entry.
	_ = s.Exec(ctx, "", s.Out, s.ErrOut, "claude", "plugin", "marketplace", "remove", MarketplaceName)
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

// healthScripts are the checkout's own readiness oracles, in the order that
// makes a failure cheapest to read: what this host can run, whether the
// package agrees with itself, then whether the gates actually catch what they
// claim to.
var healthScripts = []struct {
	name   string
	script string
	why    string
}{
	{"doctor", "doctor.py", "what this host can run"},
	{"check_suite", "check_suite.py", "the package's own cross-references"},
	{"selftest", "selftest.py", "the gate machinery, adversarially"},
}

func (s *Setup) runChecks(ctx context.Context, runtimeDir string) error {
	interpreter := s.scriptInterpreter()
	for _, check := range healthScripts {
		s.stepBanner("Running " + check.script + " — " + check.why)
		script := filepath.Join(runtimeDir, "scripts", check.script)
		if err := s.Exec(ctx, runtimeDir, s.Out, s.ErrOut, interpreter, script); err != nil {
			s.record(check.name, StepDegraded, err.Error())
			return fmt.Errorf("%s failed — fix what it reported and re-run `enact ontologizer setup`: %w", check.script, err)
		}
		s.record(check.name, StepOK, "")
	}
	return nil
}

// scriptInterpreter resolves the python that runs the checkout's scripts.
// There is no virtualenv to find: Ontologizer is standard library only, which
// is why provisioning it is three git-and-python steps rather than a build.
// Prefer explicitly-versioned interpreters, newest first — on stock macOS the
// plain python3 on PATH is Apple's 3.9.
func (s *Setup) scriptInterpreter() string {
	if interpreter := s.Getenv(PythonEnvVar); interpreter != "" {
		return interpreter
	}
	for _, candidate := range []string{"python3.14", "python3.13", "python3.12", "python3.11", "python3.10"} {
		if _, err := s.LookPath(candidate); err == nil {
			return candidate
		}
	}
	return "python3"
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
		line := fmt.Sprintf("  %-12s %s", r.Name, r.Status)
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

func (s *Setup) printNextSteps(runtimeDir string) {
	fmt.Fprintf(s.Out, "\nCheckout: %s\n", runtimeDir)
	fmt.Fprintln(s.Out, "Next: `enact ontologizer agent bootstrap` to create the five-role portfolio in this workspace.")
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
