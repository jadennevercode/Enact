package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/cli"
	"github.com/enact-ai/enact/server/internal/mmm"
)

var mmmAgentCmd = &cobra.Command{
	Use:   "agent",
	Short: "Manage the MMM agent portfolio in the current workspace",
}

var mmmAgentBootstrapCmd = &cobra.Command{
	Use:   "bootstrap",
	Short: "Create the four-role MMM agent portfolio in the current workspace",
	Long: `Applies the versioned MMM agent portfolio to the current workspace:

  1. imports the mmm:* plugin skills (unless --skip-import)
  2. creates the four role agents — MMM Orchestrator, MMM Business Analyst,
     MMM Data Scientist, MMM Metadata Manager — public to the workspace, each with
     its role instructions and skill bindings
  3. creates the "MMM Delivery" squad led by MMM Orchestrator
  4. creates the scheduled daily-report autopilot assigned to MMM Metadata Manager
     (unless --skip-autopilot)

Re-running is safe: existing agents, the squad, and the autopilot are kept
as-is so local customizations survive; pass --force to overwrite the agents'
description, instructions, and skill bindings with the manifest versions.
Env vars are outside --force's reach — the update endpoint refuses them by
design, so a MMM_ENGINE_INTERPRETER that was missing at create time has to be
set with "enact agent env set".

Model and thinking level are never set — agents follow the runtime defaults
of this deployment. Run once per workspace; every engagement project in the
workspace is served by the same portfolio.`,
	Args: cobra.NoArgs,
	RunE: runMMMAgentBootstrap,
}

var mmmVerifyCmd = &cobra.Command{
	Use:   "verify",
	Short: "Verify the MMM wiring of the current workspace",
	Long: `Checks the server-side MMM deployment wiring in one pass.

Required (a FAIL here exits non-zero):
  - the selected runtime is online
  - every mmm:* skill imported into the workspace
  - all four agents bound to that runtime with the manifest skill/concurrency settings
  - the "MMM Delivery" squad with the expected leader and members
  - the active daily-report autopilot with the expected schedule

Machine-level health (Python engine, Node deps, Claude Code plugin) is the
doctor step of "enact mmm setup", not this command.`,
	Args: cobra.NoArgs,
	RunE: runMMMVerify,
}

// registerMMMAgentBootstrapFlags installs the bootstrap flags on cmd so tests
// can build an isolated command carrying the same flag set.
func registerMMMAgentBootstrapFlags(c *cobra.Command) {
	defaults := mmm.DefaultAgentManifest().Autopilot
	c.Flags().String("runtime-id", "", "Runtime to bind the agents to (default: this machine's online runtime)")
	c.Flags().Bool("force", false, "Overwrite existing portfolio agents' description, instructions, and skill bindings with the manifest versions")
	c.Flags().Bool("skip-import", false, "Skip importing mmm:* skills before binding")
	c.Flags().Bool("skip-autopilot", false, "Skip creating the daily-report autopilot")
	c.Flags().String("cron", defaults.DefaultCron, "Cron expression for the daily-report autopilot trigger")
	c.Flags().String("timezone", defaults.DefaultTimezone, "IANA timezone for the daily-report autopilot trigger")
}

func init() {
	registerMMMAgentBootstrapFlags(mmmAgentBootstrapCmd)
	mmmVerifyCmd.Flags().String("runtime-id", "", "Runtime that must be online and bound to all MMM agents")
	mmmAgentCmd.AddCommand(mmmAgentBootstrapCmd)
	mmmCmd.AddCommand(mmmAgentCmd)
	mmmCmd.AddCommand(mmmVerifyCmd)
}

func runMMMAgentBootstrap(cmd *cobra.Command, _ []string) error {
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

	if err := bootstrapPortfolio(ctx, client, mmm.DefaultAgentManifest(), portfolioBootstrapOptions{
		RuntimeID:     runtimeID,
		Force:         force,
		SkipImport:    skipImport,
		SkipAutopilot: skipAutopilot,
		Cron:          cron,
		Timezone:      timezone,
		EnvFn:         detectEngineEnv,
	}); err != nil {
		return err
	}

	fmt.Fprintln(os.Stderr, "\nBootstrap complete. Run `enact mmm verify` to check the full wiring.")
	return nil
}

// detectEngineEnv returns the MMM engine env for agents provisioned from this
// machine. Meaningful only when the agents' daemon host is the machine running
// bootstrap — which is the documented flow (bootstrap runs on the workmachine
// after `enact mmm setup`). Missing config or venv simply yields no env.
func detectEngineEnv() map[string]string {
	cfg, err := mmm.LoadConfig(os.UserHomeDir)
	if err != nil || strings.TrimSpace(cfg.RuntimeDir) == "" {
		return nil
	}
	for _, rel := range []string{
		filepath.Join(".venv", "bin", "python"),
		filepath.Join(".venv", "Scripts", "python.exe"),
	} {
		p := filepath.Join(cfg.RuntimeDir, rel)
		if _, statErr := os.Stat(p); statErr == nil {
			return map[string]string{"MMM_ENGINE_INTERPRETER": p}
		}
	}
	return nil
}

func runMMMVerify(cmd *cobra.Command, _ []string) error {
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

	fmt.Fprintln(os.Stderr, "==> Verifying MMM workspace wiring")
	failures, err := verifyPortfolio(ctx, client, mmm.DefaultAgentManifest(), runtimeID)
	if err != nil {
		return err
	}
	if failures > 0 {
		return fmt.Errorf("%d required check(s) failed", failures)
	}
	fmt.Fprintln(os.Stderr, "\nAll required checks passed. Machine-level health (engine, plugin) is `enact mmm setup`'s doctor step.")
	return nil
}
