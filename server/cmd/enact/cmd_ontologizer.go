package main

// `enact ontologizer` — provisioning the Ontologizer checkout on this daemon
// host and applying its agent portfolio to a workspace.
//
// The verb is "ontologizer", not "ontology", deliberately: Enact already has
// an Ontologies surface that attaches a domain from Capability Hub to an
// agent. That one is the consumption side. This one produces ontologies, and
// naming them the same thing would make every doc sentence ambiguous.

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/cli"
	"github.com/enact-ai/enact/server/internal/ontologizer"
)

var ontologizerCmd = &cobra.Command{
	Use:   "ontologizer",
	Short: "Ontology construction tooling (Ontologizer provisioning and agent portfolio)",
	Long: `Tooling for running governed ontology construction on Enact.

The Ontologizer package (skills, deterministic validators, knowledge base)
stays an independent repository; these commands provision it on this daemon
host and create the agent portfolio that runs it in a workspace.

This is the production side: it builds ontologies. Attaching an already-built
domain to an agent is the Ontologies surface in the app, and is unrelated.`,
}

var ontologizerSetupCmd = &cobra.Command{
	Use:   "setup",
	Short: "Provision the Ontologizer checkout on this daemon host in one step",
	Long: `Provisions everything an agent needs to run ontology construction on this host:

  1. adopts an existing checkout via --runtime-dir, or clones into
     ~/.enact/ontologizer when a --repo is configured
  2. registers the Claude Code plugin (claude plugin marketplace add +
     claude plugin install ontologizer@ontologizer)
  3. runs the checkout's own three health scripts as the readiness check —
     doctor.py (what this host can run), check_suite.py (the package's own
     cross-references) and selftest.py (the gate machinery, adversarially)

There is no build step: Ontologizer is standard library only, which is why
its three checks can be the whole readiness story.

Re-running is safe and is the supported update path: an adopted checkout is
fast-forwarded and every step is idempotent. Plugin registration degrades to a
warning with manual remediation when the claude CLI is absent; the three
checks are authoritative and a failure there stops setup.

Examples:
  enact ontologizer setup --runtime-dir ~/PycharmProjects/Ontologizer
  enact ontologizer setup --runtime-dir ~/src/Ontologizer --import-skills
  enact ontologizer setup --skip-checks`,
	Args: cobra.NoArgs,
	RunE: runOntologizerSetup,
}

var ontologizerSkillCmd = &cobra.Command{
	Use:   "skill",
	Short: "Manage Ontologizer skills in the current workspace",
}

var ontologizerSkillImportCmd = &cobra.Command{
	Use:   "import",
	Short: "Import every ontologizer:* Claude plugin skill into the current workspace",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, _ []string) error {
		return runOntologizerImportSkills(cmd)
	},
}

func init() {
	ontologizerSetupCmd.Flags().String("runtime-dir", "", "Adopt an existing Ontologizer checkout instead of cloning into ~/.enact/ontologizer")
	ontologizerSetupCmd.Flags().String("ref", "", "Git ref to track (default: persisted pin, then main)")
	ontologizerSetupCmd.Flags().String("repo", "", "Clone URL used when no checkout exists yet")
	ontologizerSetupCmd.Flags().Bool("skip-checks", false, "Skip doctor.py, check_suite.py and selftest.py")
	ontologizerSetupCmd.Flags().Bool("import-skills", false, "Also import the ontologizer:* skills into the current workspace for UI visibility (claude runtimes load plugin skills natively without this)")
	ontologizerSetupCmd.Flags().String("runtime-id", "", "Runtime that exposes the skills when --import-skills is set")

	ontologizerSkillImportCmd.Flags().String("runtime-id", "", "Online Claude runtime that exposes the ontologizer:* skills")
	ontologizerSkillCmd.AddCommand(ontologizerSkillImportCmd)

	ontologizerCmd.AddCommand(ontologizerSetupCmd)
	ontologizerCmd.AddCommand(ontologizerSkillCmd)
}

func runOntologizerSetup(cmd *cobra.Command, _ []string) error {
	runtimeDir, _ := cmd.Flags().GetString("runtime-dir")
	ref, _ := cmd.Flags().GetString("ref")
	repo, _ := cmd.Flags().GetString("repo")
	skipChecks, _ := cmd.Flags().GetBool("skip-checks")
	importSkills, _ := cmd.Flags().GetBool("import-skills")

	setup := ontologizer.NewSetup(os.Stdout, os.Stderr)
	if err := setup.Run(cmd.Context(), ontologizer.SetupOptions{
		RuntimeDir: runtimeDir,
		Ref:        ref,
		Repo:       repo,
		SkipChecks: skipChecks,
	}); err != nil {
		return err
	}

	if importSkills {
		return runOntologizerImportSkills(cmd)
	}
	return nil
}

// runOntologizerImportSkills drives the shared runtime local-skills machinery
// to import every ontologizer:* plugin skill into the workspace skill DB.
func runOntologizerImportSkills(cmd *cobra.Command) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*localSkillPollTimeout)
	defer cancel()

	runtimeID := ""
	if cmd.Flags().Lookup("runtime-id") != nil {
		runtimeID, _ = cmd.Flags().GetString("runtime-id")
	}
	if runtimeID == "" {
		runtimeID, err = resolveLocalOnlineRuntime(ctx, client, cmd)
		if err != nil {
			return err
		}
	}
	return importPluginSkills(ctx, client, runtimeID, ontologizer.DefaultAgentManifest())
}

// ---------------------------------------------------------------------------
// Agent portfolio
// ---------------------------------------------------------------------------

var ontologizerAgentCmd = &cobra.Command{
	Use:   "agent",
	Short: "Manage the Ontologizer agent portfolio in the current workspace",
}

var ontologizerAgentBootstrapCmd = &cobra.Command{
	Use:   "bootstrap",
	Short: "Create the five-role ontology construction portfolio in the current workspace",
	Long: `Applies the versioned Ontologizer agent portfolio to the current workspace:

  1. imports the ontologizer:* plugin skills (unless --skip-import)
  2. creates the five role agents — Ontology Orchestrator, Ontology Domain
     Analyst, Ontology Engineer, Ontology Reviewer, Ontology Release Steward —
     public to the workspace, each with its role instructions and skill bindings
  3. creates the "Ontology Construction" Agent Family led by Ontology
     Orchestrator, with the routing table and the eight human decision points
     in its instructions
  4. creates the scheduled daily-standing-decisions autopilot assigned to
     Ontology Orchestrator (unless --skip-autopilot)

The five roles exist because the construction process insists on one boundary:
whoever generates a revision does not review it, and whoever reviews it does
not decide what ships.

Re-running is safe: existing agents, the family, and the autopilot are kept
as-is so local customizations survive; pass --force to overwrite the agents'
description, instructions, and skill bindings — and the family's instructions —
with the manifest versions. Env vars are outside --force's reach: the update
endpoint refuses them by design, so an ONTOLOGIZER_HOME that was missing at
create time has to be set with "enact agent env set".

The family ships with agents only. Add the people who own the eight decision
points as members afterwards — a manifest cannot know who they are.`,
	Args: cobra.NoArgs,
	RunE: runOntologizerAgentBootstrap,
}

var ontologizerVerifyCmd = &cobra.Command{
	Use:   "verify",
	Short: "Verify the Ontologizer wiring of the current workspace",
	Long: `Checks the server-side Ontologizer deployment wiring in one pass.

Required (a FAIL here exits non-zero):
  - the selected runtime is online
  - every ontologizer:* skill imported into the workspace
  - all five agents bound to that runtime with the manifest skill/concurrency settings
  - the "Ontology Construction" family with the expected leader and members
  - the active daily autopilot with the expected schedule

Machine-level health (the checkout, the Claude Code plugin, the three health
scripts) is the check step of "enact ontologizer setup", not this command.`,
	Args: cobra.NoArgs,
	RunE: runOntologizerVerify,
}

// registerOntologizerBootstrapFlags installs the bootstrap flags on cmd so
// tests can build an isolated command carrying the same flag set.
func registerOntologizerBootstrapFlags(c *cobra.Command) {
	defaults := ontologizer.DefaultAgentManifest().Autopilot
	c.Flags().String("runtime-id", "", "Runtime to bind the agents to (default: this machine's online runtime)")
	c.Flags().Bool("force", false, "Overwrite existing portfolio agents and family instructions with the manifest versions")
	c.Flags().Bool("skip-import", false, "Skip importing ontologizer:* skills before binding")
	c.Flags().Bool("skip-autopilot", false, "Skip creating the daily autopilot")
	c.Flags().String("cron", defaults.DefaultCron, "Cron expression for the daily autopilot trigger")
	c.Flags().String("timezone", defaults.DefaultTimezone, "IANA timezone for the daily autopilot trigger")
}

func init() {
	registerOntologizerBootstrapFlags(ontologizerAgentBootstrapCmd)
	ontologizerVerifyCmd.Flags().String("runtime-id", "", "Runtime that must be online and bound to all Ontologizer agents")
	ontologizerAgentCmd.AddCommand(ontologizerAgentBootstrapCmd)
	ontologizerCmd.AddCommand(ontologizerAgentCmd)
	ontologizerCmd.AddCommand(ontologizerVerifyCmd)
}

func runOntologizerAgentBootstrap(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	if _, err := requireWorkspaceID(cmd); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*localSkillPollTimeout)
	defer cancel()

	runtimeID, err := resolveBootstrapRuntime(ctx, client, cmd)
	if err != nil {
		return err
	}

	force, _ := cmd.Flags().GetBool("force")
	skipImport, _ := cmd.Flags().GetBool("skip-import")
	skipAutopilot, _ := cmd.Flags().GetBool("skip-autopilot")
	cron, _ := cmd.Flags().GetString("cron")
	timezone, _ := cmd.Flags().GetString("timezone")

	if err := bootstrapPortfolio(ctx, client, ontologizer.DefaultAgentManifest(), portfolioBootstrapOptions{
		RuntimeID:     runtimeID,
		Force:         force,
		SkipImport:    skipImport,
		SkipAutopilot: skipAutopilot,
		Cron:          cron,
		Timezone:      timezone,
		EnvFn:         detectOntologizerEnv,
	}); err != nil {
		return err
	}

	fmt.Fprintln(os.Stderr, "\nBootstrap complete.")
	fmt.Fprintln(os.Stderr, "Next: add the people who own the eight decision points to the \"Ontology Construction\" family,")
	fmt.Fprintln(os.Stderr, "      then run `enact ontologizer verify --runtime-id <id>` to check the wiring.")
	return nil
}

// detectOntologizerEnv returns the environment the portfolio agents need:
// where the checkout is, so a skill can spell $ONTOLOGIZER_HOME/scripts/... .
// Meaningful only when the agents' daemon host is the machine running
// bootstrap, which is the documented flow. No config simply yields no env, and
// the agent then has to be told the path by hand.
func detectOntologizerEnv() map[string]string {
	cfg, err := ontologizer.LoadConfig(os.UserHomeDir)
	if err != nil || strings.TrimSpace(cfg.RuntimeDir) == "" {
		return nil
	}
	if _, statErr := os.Stat(filepath.Join(cfg.RuntimeDir, "scripts", "state.py")); statErr != nil {
		return nil
	}
	env := map[string]string{ontologizer.HomeEnvVar: cfg.RuntimeDir}
	if python := os.Getenv(ontologizer.PythonEnvVar); python != "" {
		env[ontologizer.PythonEnvVar] = python
	}
	return env
}

func runOntologizerVerify(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	if _, err := requireWorkspaceID(cmd); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), cli.AtLeastAPITimeout(60*time.Second))
	defer cancel()

	runtimeID, _ := cmd.Flags().GetString("runtime-id")
	if runtimeID == "" {
		return fmt.Errorf("--runtime-id is required")
	}

	fmt.Fprintln(os.Stderr, "==> Verifying Ontologizer workspace wiring")
	failures, err := verifyPortfolio(ctx, client, ontologizer.DefaultAgentManifest(), runtimeID)
	if err != nil {
		return err
	}
	if failures > 0 {
		return fmt.Errorf("%d required check(s) failed", failures)
	}
	fmt.Fprintln(os.Stderr, "\nAll required checks passed. Machine-level health is `enact ontologizer setup`'s check step.")
	return nil
}

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------

var ontologizerPublishCmd = &cobra.Command{
	Use:   "publish",
	Short: "Publish the Ontologizer skills, agents and Agent Family to the Marketplace",
	Long: `Publishes what this workspace holds, as three kinds of listing:

  - every ontologizer:* skill, so a method can be taken on its own
  - each of the five role agents, so a team can take one role
  - the "Ontology Construction" Agent Family, which is the headline: installing
    it creates every member agent, the skills each carries, and the family
    binding them, in one transaction

A publish reads an entity that already exists here — the server snapshots it
and strips every credential-bearing field, which is what makes the redaction
trustworthy. So run "enact ontologizer agent bootstrap" first; this publishes
what that created, and reports anything it cannot find rather than inventing it.

Visibility defaults to "workspace", an internal library. Make it "public" when
you are ready for every workspace in the deployment to see it; both install the
same way.

A published version is never overwritten. Re-running with the same --version
reports each listing as already published and changes nothing; publishing a new
version adds it to the same listing, so the link and the history stay put.

Publishing is a human decision about what leaves the workspace: the server
refuses an agent actor, and requires workspace owner or admin.

Examples:
  enact ontologizer publish --version 0.1.0
  enact ontologizer publish --version 0.2.0 --visibility public --changelog "adds the package stage"
  enact ontologizer publish --version 0.1.0 --kinds squad --dry-run`,
	Args: cobra.NoArgs,
	RunE: runOntologizerPublish,
}

func init() {
	ontologizerPublishCmd.Flags().String("version", "", "Version string for this publish (required); a published version is never overwritten")
	ontologizerPublishCmd.Flags().String("visibility", "workspace", "workspace (internal library) or public (every workspace in the deployment)")
	ontologizerPublishCmd.Flags().String("changelog", "", "What changed in this version")
	ontologizerPublishCmd.Flags().String("category", "ontology", "Directory category")
	ontologizerPublishCmd.Flags().StringSlice("tags", []string{"ontology", "knowledge-graph", "governance", "traceability"}, "Directory tags")
	ontologizerPublishCmd.Flags().StringSlice("kinds", nil, "Limit to some of skill,agent,squad (default: all three)")
	ontologizerPublishCmd.Flags().Bool("dry-run", false, "List what would be published without publishing it")
	ontologizerCmd.AddCommand(ontologizerPublishCmd)
}

func runOntologizerPublish(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	if _, err := requireWorkspaceID(cmd); err != nil {
		return err
	}

	version, _ := cmd.Flags().GetString("version")
	if strings.TrimSpace(version) == "" {
		return fmt.Errorf("--version is required — a listing's history is a sequence of versions, and the server refuses an empty one")
	}
	visibility, _ := cmd.Flags().GetString("visibility")
	if visibility != "workspace" && visibility != "public" {
		return fmt.Errorf("--visibility must be workspace or public, got %q", visibility)
	}
	changelog, _ := cmd.Flags().GetString("changelog")
	category, _ := cmd.Flags().GetString("category")
	tags, _ := cmd.Flags().GetStringSlice("tags")
	kindList, _ := cmd.Flags().GetStringSlice("kinds")
	dryRun, _ := cmd.Flags().GetBool("dry-run")

	kinds := map[string]bool{}
	for _, kind := range kindList {
		kind = strings.TrimSpace(kind)
		if kind != "skill" && kind != "agent" && kind != "squad" {
			return fmt.Errorf("--kinds must be some of skill,agent,squad, got %q", kind)
		}
		kinds[kind] = true
	}

	ctx, cancel := context.WithTimeout(context.Background(), cli.AtLeastAPITimeout(120*time.Second))
	defer cancel()

	if err := publishPortfolio(ctx, client, ontologizer.DefaultAgentManifest(), portfolioPublishOptions{
		Version:    strings.TrimSpace(version),
		Visibility: visibility,
		Changelog:  changelog,
		Category:   category,
		Tags:       tags,
		Kinds:      kinds,
		DryRun:     dryRun,
	}); err != nil {
		return err
	}
	if !dryRun {
		fmt.Fprintln(os.Stderr, "\nBrowse them with `enact marketplace list --output json`.")
		if visibility == "workspace" {
			fmt.Fprintln(os.Stderr, "Visibility is workspace-only; re-publish a new version with --visibility public to reach the whole deployment.")
		}
	}
	return nil
}
