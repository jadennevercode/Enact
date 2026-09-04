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

var retrospectiveCmd = &cobra.Command{
	Use:   "retrospective",
	Short: "Run retrospectives that look for lessons in finished work",
}

var retrospectiveListCmd = &cobra.Command{
	Use:   "list",
	Short: "List retrospectives in the workspace",
	RunE:  runRetrospectiveList,
}

var retrospectiveGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get a retrospective and the lessons it produced",
	Args:  exactArgs(1),
	RunE:  runRetrospectiveGet,
}

var retrospectiveStartCmd = &cobra.Command{
	Use:   "start",
	Short: "Start a new retrospective",
	RunE:  runRetrospectiveStart,
}

var retrospectiveAcceptCmd = &cobra.Command{
	Use:   "accept <id>",
	Short: "Accept a suggested retrospective and run it",
	Args:  exactArgs(1),
	RunE:  runRetrospectiveAccept,
}

var retrospectiveDismissCmd = &cobra.Command{
	Use:   "dismiss <id>",
	Short: "Dismiss a suggested retrospective",
	Args:  exactArgs(1),
	RunE:  runRetrospectiveDismiss,
}

func init() {
	retrospectiveCmd.AddCommand(retrospectiveListCmd)
	retrospectiveCmd.AddCommand(retrospectiveGetCmd)
	retrospectiveCmd.AddCommand(retrospectiveStartCmd)
	retrospectiveCmd.AddCommand(retrospectiveAcceptCmd)
	retrospectiveCmd.AddCommand(retrospectiveDismissCmd)

	// retrospective list
	retrospectiveListCmd.Flags().String("status", "", "Filter by status (suggested, dismissed, queued, running, completed, failed)")
	retrospectiveListCmd.Flags().String("output", "table", "Output format: table or json")

	// retrospective get
	retrospectiveGetCmd.Flags().String("output", "json", "Output format: table or json")

	// retrospective start
	retrospectiveStartCmd.Flags().String("scope", "workspace", "What to review: issue or workspace")
	retrospectiveStartCmd.Flags().String("scope-id", "", "Issue id. Required unless --scope is workspace.")
	retrospectiveStartCmd.Flags().Int("since-days", 0, "How far back to look. Ignored for an issue-scoped retrospective.")
	retrospectiveStartCmd.Flags().String("output", "table", "Output format: table or json")

	// retrospective accept / dismiss
	retrospectiveAcceptCmd.Flags().String("output", "table", "Output format: table or json")
	retrospectiveDismissCmd.Flags().String("output", "table", "Output format: table or json")
}

// ---------------------------------------------------------------------------
// Retrospective commands
// ---------------------------------------------------------------------------

func runRetrospectiveList(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	path := "/api/retrospectives"
	if status, _ := cmd.Flags().GetString("status"); status != "" {
		path += "?" + url.Values{"status": {status}}.Encode()
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var result map[string]any
	if err := client.GetJSON(ctx, path, &result); err != nil {
		return fmt.Errorf("list retrospectives: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, result)
	}

	printRetrospectiveTable(nestedList(result, "retrospectives"))
	return nil
}

func runRetrospectiveGet(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var result map[string]any
	if err := client.GetJSON(ctx, "/api/retrospectives/"+args[0], &result); err != nil {
		return fmt.Errorf("get retrospective: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, result)
	}

	printRetrospectiveTable([]map[string]any{nestedMap(result, "retrospective")})

	lessons := nestedList(result, "lessons")
	fmt.Println()
	if len(lessons) == 0 {
		fmt.Println("No lessons filed by this retrospective.")
		return nil
	}
	headers := []string{"KEY", "TITLE", "STATUS", "CREATED_AT"}
	rows := make([][]string, 0, len(lessons))
	for _, l := range lessons {
		rows = append(rows, []string{
			strVal(l, "key"),
			strVal(l, "title"),
			strVal(l, "status"),
			strVal(l, "created_at"),
		})
	}
	cli.PrintTable(os.Stdout, headers, rows)
	return nil
}

func runRetrospectiveStart(cmd *cobra.Command, _ []string) error {
	scope, _ := cmd.Flags().GetString("scope")
	scopeID, _ := cmd.Flags().GetString("scope-id")
	switch scope {
	case "issue", "project":
		if strings.TrimSpace(scopeID) == "" {
			return fmt.Errorf("--scope-id is required when --scope is %s", scope)
		}
	case "workspace":
	default:
		return fmt.Errorf("--scope must be issue, project or workspace")
	}

	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	body := map[string]any{"scope": scope}
	if scopeID != "" {
		body["scope_id"] = scopeID
	}
	if days, _ := cmd.Flags().GetInt("since-days"); days > 0 {
		body["since_days"] = days
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var result map[string]any
	if err := client.PostJSON(ctx, "/api/retrospectives", body, &result); err != nil {
		return fmt.Errorf("start retrospective: %w", err)
	}

	return printRetrospectiveResult(cmd, result, "started")
}

func runRetrospectiveAccept(cmd *cobra.Command, args []string) error {
	return runRetrospectiveAnswer(cmd, args[0], "start", "accepted")
}

func runRetrospectiveDismiss(cmd *cobra.Command, args []string) error {
	return runRetrospectiveAnswer(cmd, args[0], "dismiss", "dismissed")
}

// runRetrospectiveAnswer answers a retrospective the server suggested. The
// route segment differs; nothing else does.
func runRetrospectiveAnswer(cmd *cobra.Command, id, route, past string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var result map[string]any
	if err := client.PostJSON(ctx, "/api/retrospectives/"+id+"/"+route, map[string]any{}, &result); err != nil {
		return fmt.Errorf("%s retrospective: %w", past, err)
	}

	return printRetrospectiveResult(cmd, result, past)
}

func printRetrospectiveResult(cmd *cobra.Command, result map[string]any, past string) error {
	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, result)
	}

	retro := nestedMap(result, "retrospective")
	fmt.Printf("Retrospective %s: %s (%s)\n", past, strVal(retro, "id"), strVal(retro, "status"))
	return nil
}

func printRetrospectiveTable(retros []map[string]any) {
	headers := []string{"ID", "STATUS", "SCOPE", "TRIGGER", "LESSONS", "CREATED_AT"}
	rows := make([][]string, 0, len(retros))
	for _, r := range retros {
		rows = append(rows, []string{
			strVal(r, "id"),
			strVal(r, "status"),
			strVal(r, "scope"),
			strVal(r, "trigger"),
			strVal(r, "lesson_count"),
			strVal(r, "created_at"),
		})
	}
	cli.PrintTable(os.Stdout, headers, rows)
}
