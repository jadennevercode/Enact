package main

import (
	"os"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/mmm"
)

var mmmCmd = &cobra.Command{
	Use:   "mmm",
	Short: "MMM engagement tooling (mmm-runtime provisioning and project linking)",
	Long: `Tooling for running Marketing Mix Modeling engagements on Enact.

The mmm-runtime (skills, analysis engine, knowledge packs) stays an
independent repository; these commands provision it on this daemon host and
link engagement directories to Enact projects.`,
}

var mmmSetupCmd = &cobra.Command{
	Use:   "setup",
	Short: "Provision mmm-runtime on this daemon host in one step",
	Long: `Provisions everything an agent needs to run MMM engagements on this host:

  1. clones mmm-runtime into ~/.enact/mmm-runtime (or adopts an existing
     checkout via --runtime-dir) and fast-forwards it to the tracked ref
  2. installs the Python analysis engine (pip install -e tools/engine)
  3. installs the Node report-generator dependencies (npm install)
  4. registers the Claude Code plugin (claude plugin marketplace add +
     claude plugin install mmm@mmm-runtime)
  5. runs the runtime's own doctor script as the final health check

Re-running is safe and is the supported update path: the checkout is
fast-forwarded and every install step is idempotent. Steps that fail in a
recoverable way (e.g. the claude CLI is not installed) print manual
remediation commands and setup continues; the doctor check is authoritative.

Examples:
  enact mmm setup
  enact mmm setup --runtime-dir ~/src/mmm-runtime
  enact mmm setup --ref v0.3.0 --skip-doctor`,
	RunE: runMMMSetup,
}

func init() {
	mmmSetupCmd.Flags().String("runtime-dir", "", "Adopt an existing mmm-runtime checkout instead of cloning into ~/.enact/mmm-runtime")
	mmmSetupCmd.Flags().String("ref", "", "Git ref to track (default: persisted pin, then main)")
	mmmSetupCmd.Flags().String("repo", "", "Clone URL used when no checkout exists yet (default: "+mmm.DefaultRuntimeGitURL+")")
	mmmSetupCmd.Flags().Bool("skip-doctor", false, "Skip the final doctor.py health check")
	mmmSetupCmd.Flags().Bool("import-skills", false, "Also import the mmm:* skills into the current workspace for UI visibility (claude runtimes load plugin skills natively without this)")

	mmmCmd.AddCommand(mmmSetupCmd)
}

func runMMMSetup(cmd *cobra.Command, _ []string) error {
	runtimeDir, _ := cmd.Flags().GetString("runtime-dir")
	ref, _ := cmd.Flags().GetString("ref")
	repo, _ := cmd.Flags().GetString("repo")
	skipDoctor, _ := cmd.Flags().GetBool("skip-doctor")
	importSkills, _ := cmd.Flags().GetBool("import-skills")

	setup := mmm.NewSetup(os.Stdout, os.Stderr)
	if err := setup.Run(cmd.Context(), mmm.SetupOptions{
		RuntimeDir: runtimeDir,
		Ref:        ref,
		Repo:       repo,
		SkipDoctor: skipDoctor,
	}); err != nil {
		return err
	}

	if importSkills {
		return runMMMImportSkills(cmd)
	}
	return nil
}
