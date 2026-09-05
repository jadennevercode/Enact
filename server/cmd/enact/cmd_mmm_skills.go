package main

import (
	"context"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/cli"
	"github.com/enact-ai/enact/server/internal/mmm"
)

// mmmSkillPrefix is the invocation-key namespace the daemon assigns to skills
// contributed by the mmm Claude Code plugin (claude_plugins.go keys plugin
// skills as "<plugin-name>:<skill>").
const mmmSkillPrefix = mmm.SkillPrefix

var mmmSkillCmd = &cobra.Command{
	Use:   "skill",
	Short: "Manage MMM Runtime skills in the current workspace",
}

var mmmSkillImportCmd = &cobra.Command{
	Use:   "import",
	Short: "Import every mmm:* Claude plugin skill into the current workspace",
	Args:  cobra.NoArgs,
	RunE: func(cmd *cobra.Command, _ []string) error {
		return runMMMImportSkills(cmd)
	},
}

func init() {
	mmmSkillImportCmd.Flags().String("runtime-id", "", "Online Claude runtime that exposes the mmm:* skills")
	mmmSkillCmd.AddCommand(mmmSkillImportCmd)
	mmmCmd.AddCommand(mmmSkillCmd)
}

// runMMMImportSkills drives the shared runtime local-skills machinery to
// import every mmm:* plugin skill into the workspace skill DB.
func runMMMImportSkills(cmd *cobra.Command) error {
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
	return importAllMMMSkills(ctx, client, runtimeID)
}

func importAllMMMSkills(ctx context.Context, client *cli.APIClient, runtimeID string) error {
	return importPluginSkills(ctx, client, runtimeID, mmm.DefaultAgentManifest())
}
