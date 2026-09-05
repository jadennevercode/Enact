package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/cli"
)

// The Marketplace from the CLI.
//
// This exists so an agent can install capability the same way a person can.
// Publishing is deliberately absent: it is an admin decision about what leaves
// the workspace, and the server refuses it for agent actors anyway — a command
// that always fails for the caller most likely to run it would be worse than no
// command.

var marketplaceCmd = &cobra.Command{
	Use:   "marketplace",
	Short: "Browse and install published capability",
}

var marketplaceListCmd = &cobra.Command{
	Use:   "list",
	Short: "List listings this workspace can install",
	RunE:  runMarketplaceList,
}

var marketplaceGetCmd = &cobra.Command{
	Use:   "get <listing-id>",
	Short: "Show one listing, including what installing it would create",
	Args:  exactArgs(1),
	RunE:  runMarketplaceGet,
}

var marketplaceInstallCmd = &cobra.Command{
	Use:   "install <listing-id>",
	Short: "Install a listing into this workspace",
	Args:  exactArgs(1),
	RunE:  runMarketplaceInstall,
}

func init() {
	marketplaceListCmd.Flags().String("kind", "", "Filter by kind: skill, agent, mcp, squad (an Agent Family)")
	marketplaceListCmd.Flags().String("query", "", "Free-text filter over name, description and tags")
	marketplaceListCmd.Flags().String("tag", "", "Filter by tag")
	marketplaceListCmd.Flags().Bool("mine", false, "Only listings this workspace published")
	marketplaceListCmd.Flags().Bool("installed", false, "Only listings this workspace has installed")
	marketplaceListCmd.Flags().Bool("not-installed", false, "Only listings this workspace has not installed")
	marketplaceListCmd.MarkFlagsMutuallyExclusive("installed", "not-installed")

	marketplaceGetCmd.Flags().String("version-id", "", "Read a specific version instead of the latest")

	marketplaceInstallCmd.Flags().String("version-id", "", "Install a specific version instead of the latest")
	marketplaceInstallCmd.Flags().String("name", "", "Name for the copy in this workspace")
	marketplaceInstallCmd.Flags().String("runtime-id", "",
		"Runtime to bind an agent template, or every member of an Agent Family, to (required for kind=agent and kind=squad)")
	marketplaceInstallCmd.Flags().String("on-conflict", "fail", "fail | overwrite | rename | skip")
	marketplaceInstallCmd.Flags().StringArray("secret", nil,
		"A value the publisher withheld, as path=value (repeatable), e.g. env.GITHUB_TOKEN=ghp_...; "+
			"prefix with the server name for an agent template (github/env.GITHUB_TOKEN=...) "+
			"and with the member then the server for an Agent Family (reviewer/github/env.GITHUB_TOKEN=...)")

	marketplaceCmd.AddCommand(marketplaceListCmd)
	marketplaceCmd.AddCommand(marketplaceGetCmd)
	marketplaceCmd.AddCommand(marketplaceInstallCmd)
}

func runMarketplaceList(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	query := url.Values{}
	if kind, _ := cmd.Flags().GetString("kind"); kind != "" {
		query.Set("kind", kind)
	}
	if q, _ := cmd.Flags().GetString("query"); q != "" {
		query.Set("q", q)
	}
	if tag, _ := cmd.Flags().GetString("tag"); tag != "" {
		query.Set("tag", tag)
	}
	if mine, _ := cmd.Flags().GetBool("mine"); mine {
		query.Set("mine", "true")
	}
	if installed, _ := cmd.Flags().GetBool("installed"); installed {
		query.Set("installed", "true")
	}
	if notInstalled, _ := cmd.Flags().GetBool("not-installed"); notInstalled {
		query.Set("installed", "false")
	}
	path := "/api/marketplace/listings"
	if encoded := query.Encode(); encoded != "" {
		path += "?" + encoded
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var catalog struct {
		Count    int              `json:"count"`
		Total    int              `json:"total"`
		Listings []map[string]any `json:"listings"`
	}
	if err := client.GetJSON(ctx, path, &catalog); err != nil {
		return fmt.Errorf("list marketplace listings: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, catalog)
	}

	headers := []string{"ID", "KIND", "NAME", "VERSION", "PUBLISHER", "INSTALLED"}
	rows := make([][]string, 0, len(catalog.Listings))
	for _, listing := range catalog.Listings {
		// The column says both whether and which: "no" for a listing this
		// workspace never took, the version it holds otherwise.
		installed := strVal(listing, "installed_version")
		if installed == "" {
			installed = "no"
		}
		rows = append(rows, []string{
			strVal(listing, "id"),
			strVal(listing, "kind"),
			strVal(listing, "name"),
			strVal(listing, "latest_version"),
			strVal(listing, "publisher_workspace_name"),
			installed,
		})
	}
	cli.PrintTable(os.Stdout, headers, rows)
	return nil
}

func runMarketplaceGet(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	path := "/api/marketplace/listings/" + args[0]
	if versionID, _ := cmd.Flags().GetString("version-id"); versionID != "" {
		path += "?version_id=" + url.QueryEscape(versionID)
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var listing map[string]any
	if err := client.GetJSON(ctx, path, &listing); err != nil {
		return fmt.Errorf("get marketplace listing: %w", err)
	}
	// Always JSON: the useful part is the manifest, which says what installing
	// would create and which values the installer must supply. Flattening that
	// into a table would drop exactly the part a caller needs.
	return cli.PrintJSON(os.Stdout, listing)
}

func runMarketplaceInstall(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	strategy, _ := cmd.Flags().GetString("on-conflict")
	// Same four strategies, resolved the same way, so the CLI validates them
	// with the helper skill import already owns rather than a second copy.
	if !validSkillImportConflictStrategy(strategy) {
		return fmt.Errorf("--on-conflict must be one of fail, overwrite, rename, skip")
	}

	secrets := map[string]string{}
	pairs, _ := cmd.Flags().GetStringArray("secret")
	for _, pair := range pairs {
		name, value, found := strings.Cut(pair, "=")
		if !found || strings.TrimSpace(name) == "" {
			return fmt.Errorf("--secret must be path=value, got %q", pair)
		}
		secrets[strings.TrimSpace(name)] = value
	}

	body := map[string]any{"on_conflict": strategy}
	if versionID, _ := cmd.Flags().GetString("version-id"); versionID != "" {
		body["version_id"] = versionID
	}
	if name, _ := cmd.Flags().GetString("name"); name != "" {
		body["name"] = name
	}
	if runtimeID, _ := cmd.Flags().GetString("runtime-id"); runtimeID != "" {
		body["runtime_id"] = runtimeID
	}
	if len(secrets) > 0 {
		body["secrets"] = secrets
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var result map[string]any
	err = client.PostJSON(ctx, "/api/marketplace/listings/"+args[0]+"/install", body, &result)

	// A conflict is a result, not a transport failure: the server describes what
	// it hit and which strategies would resolve it, so the envelope is printed
	// and the exit code carries the outcome — the same contract skill import
	// uses, so a caller can treat both the same way.
	output, _ := cmd.Flags().GetString("output")
	if len(result) > 0 {
		if output == "json" {
			if printErr := cli.PrintJSON(os.Stdout, result); printErr != nil {
				return printErr
			}
		} else {
			fmt.Fprintf(os.Stdout, "%s\n", marketplaceInstallSummary(result))
		}
		if status := strVal(result, "status"); status != "" && status != "created" && status != "updated" {
			return fmt.Errorf("install %s: %s", status, strVal(result, "reason"))
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("install listing: %w", err)
	}
	return nil
}

// marketplaceInstallSummary renders one line a person can read, naming what was
// created so the next command has something to use.
func marketplaceInstallSummary(result map[string]any) string {
	status := strVal(result, "status")
	kind := strVal(result, "entity_kind")
	id := strVal(result, "entity_id")
	reason := strVal(result, "reason")

	parts := []string{status}
	if kind != "" {
		parts = append(parts, kind)
	}
	if id != "" {
		parts = append(parts, id)
	}
	line := strings.Join(parts, " ")
	if reason != "" {
		line += " — " + reason
	}
	return line
}
