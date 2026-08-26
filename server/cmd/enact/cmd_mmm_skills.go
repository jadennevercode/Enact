package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/cli"
	"github.com/enact-ai/enact/server/internal/daemon"
)

// mmmSkillPrefix is the invocation-key namespace the daemon assigns to skills
// contributed by the mmm Claude Code plugin (claude_plugins.go keys plugin
// skills as "<plugin-name>:<skill>").
const mmmSkillPrefix = "mmm:"

const (
	localSkillPollInterval = 2 * time.Second
	localSkillPollTimeout  = 90 * time.Second
)

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

// runMMMImportSkills drives the existing runtime local-skills machinery to
// import every mmm:* plugin skill into the workspace skill DB. This is for
// Enact UI visibility/assignment only — claude runtimes load plugin skills
// natively in-session without any import.
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

// importAllMMMSkills lists the runtime's local plugin skills and imports every
// mmm:* one into the workspace, keeping existing workspace copies on conflict.
func importAllMMMSkills(ctx context.Context, client *cli.APIClient, runtimeID string) error {
	fmt.Fprintf(os.Stderr, "\n==> Importing mmm:* skills via runtime %s\n", runtimeID)

	skills, err := listRuntimeLocalSkills(ctx, client, runtimeID)
	if err != nil {
		return err
	}
	mmmKeys := make([]string, 0, len(skills))
	for _, key := range skills {
		if strings.HasPrefix(key, mmmSkillPrefix) {
			mmmKeys = append(mmmKeys, key)
		}
	}
	if len(mmmKeys) == 0 {
		return fmt.Errorf("runtime reported no %s* skills — is the mmm plugin installed and enabled? Run `enact mmm setup` first", mmmSkillPrefix)
	}

	imported, skipped, failed := 0, 0, 0
	for _, key := range mmmKeys {
		status, detail := importRuntimeLocalSkill(ctx, client, runtimeID, key)
		switch status {
		case "completed":
			imported++
			fmt.Fprintf(os.Stderr, "  %-28s imported\n", key)
		case "conflict":
			// Already in the workspace (same name). Idempotent re-run case —
			// keep the existing skill and its local customizations.
			skipped++
			fmt.Fprintf(os.Stderr, "  %-28s already exists — kept workspace copy\n", key)
		default:
			failed++
			fmt.Fprintf(os.Stderr, "  %-28s failed: %s\n", key, detail)
		}
	}
	fmt.Fprintf(os.Stderr, "Skills: %d imported, %d already present, %d failed\n", imported, skipped, failed)
	if failed > 0 {
		return fmt.Errorf("%d skill import(s) failed; re-run `enact mmm setup --import-skills` after fixing the reported errors", failed)
	}
	return nil
}

// resolveLocalOnlineRuntime picks the online runtime for this machine's
// daemon identity, falling back to the only online runtime when unambiguous.
func resolveLocalOnlineRuntime(ctx context.Context, client *cli.APIClient, cmd *cobra.Command) (string, error) {
	var runtimes []map[string]any
	if err := client.GetJSON(ctx, "/api/runtimes", &runtimes); err != nil {
		return "", fmt.Errorf("list runtimes: %w", err)
	}
	localDaemonID, _ := daemon.EnsureDaemonID(resolveProfile(cmd))

	online := make([]map[string]any, 0, len(runtimes))
	for _, rt := range runtimes {
		if strVal(rt, "status") != "online" {
			continue
		}
		online = append(online, rt)
		if localDaemonID != "" && strVal(rt, "daemon_id") == localDaemonID {
			return strVal(rt, "id"), nil
		}
	}
	if len(online) == 1 {
		return strVal(online[0], "id"), nil
	}
	if len(online) == 0 {
		return "", fmt.Errorf("no online runtime found — start the daemon (`enact daemon restart`) and retry")
	}
	return "", fmt.Errorf("multiple online runtimes and none matches this machine's daemon; import skills from the Runtimes UI instead")
}

func listRuntimeLocalSkills(ctx context.Context, client *cli.APIClient, runtimeID string) ([]string, error) {
	var initiated struct {
		ID string `json:"id"`
	}
	if err := client.PostJSON(ctx, "/api/runtimes/"+runtimeID+"/local-skills", map[string]any{}, &initiated); err != nil {
		return nil, fmt.Errorf("initiate local skills listing: %w", err)
	}

	deadline := time.Now().Add(localSkillPollTimeout)
	for {
		var req struct {
			Status string `json:"status"`
			Error  string `json:"error"`
			Skills []struct {
				Key string `json:"key"`
			} `json:"skills"`
		}
		if err := client.GetJSON(ctx, "/api/runtimes/"+runtimeID+"/local-skills/"+initiated.ID, &req); err != nil {
			return nil, fmt.Errorf("poll local skills listing: %w", err)
		}
		switch req.Status {
		case "completed":
			keys := make([]string, 0, len(req.Skills))
			for _, s := range req.Skills {
				keys = append(keys, s.Key)
			}
			return keys, nil
		case "failed", "timeout":
			return nil, fmt.Errorf("local skills listing %s: %s", req.Status, req.Error)
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("timed out waiting for the daemon to list local skills")
		}
		time.Sleep(localSkillPollInterval)
	}
}

// importRuntimeLocalSkill returns the terminal status ("completed",
// "conflict", "failed", "timeout") plus a detail message.
func importRuntimeLocalSkill(ctx context.Context, client *cli.APIClient, runtimeID, skillKey string) (string, string) {
	var initiated struct {
		ID string `json:"id"`
	}
	// Action "create" is the wire default (empty string) — sending any other
	// literal is rejected as invalid.
	body := map[string]any{"skill_key": skillKey, "supports_conflict": true}
	if err := client.PostJSON(ctx, "/api/runtimes/"+runtimeID+"/local-skills/import", body, &initiated); err != nil {
		return "failed", err.Error()
	}

	deadline := time.Now().Add(localSkillPollTimeout)
	for {
		var req struct {
			Status string `json:"status"`
			Error  string `json:"error"`
		}
		if err := client.GetJSON(ctx, "/api/runtimes/"+runtimeID+"/local-skills/import/"+initiated.ID, &req); err != nil {
			return "failed", err.Error()
		}
		switch req.Status {
		case "completed", "conflict", "failed", "timeout":
			return req.Status, req.Error
		}
		if time.Now().After(deadline) {
			return "timeout", "timed out waiting for the daemon"
		}
		time.Sleep(localSkillPollInterval)
	}
}
