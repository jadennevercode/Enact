package main

// Importing a Claude Code plugin's skills into the workspace skill DB.
//
// This is for Enact UI visibility and assignment only: a Claude runtime loads
// an enabled plugin's skills natively in-session whether or not they were ever
// imported. What the import buys is a skill row an agent can be bound to and a
// person can read on the Skills page.

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/cli"
	"github.com/enact-ai/enact/server/internal/daemon"
	"github.com/enact-ai/enact/server/internal/portfolio"
)

const (
	localSkillPollInterval = 2 * time.Second
	localSkillPollTimeout  = 90 * time.Second
)

// importPluginSkills lists the runtime's local skills and imports every one in
// the manifest's plugin namespace, keeping existing workspace copies on
// conflict so a re-run never overwrites a local edit.
func importPluginSkills(ctx context.Context, client *cli.APIClient, runtimeID string, manifest portfolio.Manifest) error {
	fmt.Fprintf(os.Stderr, "\n==> Importing %s* skills via runtime %s\n", manifest.SkillPrefix, runtimeID)

	skills, err := listRuntimeLocalSkills(ctx, client, runtimeID)
	if err != nil {
		return err
	}
	keys := make([]string, 0, len(skills))
	for _, key := range skills {
		if strings.HasPrefix(key, manifest.SkillPrefix) {
			keys = append(keys, key)
		}
	}
	if len(keys) == 0 {
		return fmt.Errorf("runtime reported no %s* skills — is the %s plugin installed and enabled? Run `%s` first",
			manifest.SkillPrefix, manifest.PluginName, manifest.SetupCommand)
	}

	imported, skipped, failed := 0, 0, 0
	for _, key := range keys {
		status, detail := importRuntimeLocalSkill(ctx, client, runtimeID, key)
		switch status {
		case "completed":
			imported++
			fmt.Fprintf(os.Stderr, "  %-32s imported\n", key)
		case "conflict":
			// Already in the workspace (same name). Idempotent re-run case —
			// keep the existing skill and its local customizations.
			skipped++
			fmt.Fprintf(os.Stderr, "  %-32s already exists — kept workspace copy\n", key)
		default:
			failed++
			fmt.Fprintf(os.Stderr, "  %-32s failed: %s\n", key, detail)
		}
	}
	fmt.Fprintf(os.Stderr, "Skills: %d imported, %d already present, %d failed\n", imported, skipped, failed)
	if failed > 0 {
		return fmt.Errorf("%d skill import(s) failed; re-run `%s --import-skills` after fixing the reported errors", failed, manifest.SetupCommand)
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

// resolveBootstrapRuntime resolves the runtime a bootstrap or verify run binds
// agents to: the --runtime-id flag when set, otherwise this machine's.
func resolveBootstrapRuntime(ctx context.Context, client *cli.APIClient, cmd *cobra.Command) (string, error) {
	runtimeID, _ := cmd.Flags().GetString("runtime-id")
	if runtimeID != "" {
		return runtimeID, nil
	}
	runtimeID, err := resolveLocalOnlineRuntime(ctx, client, cmd)
	if err != nil {
		// The shared resolver's guidance is written for skill import, which
		// has no runtime flag; bootstrap does.
		return "", fmt.Errorf("%w (or pass --runtime-id to choose explicitly)", err)
	}
	return runtimeID, nil
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
