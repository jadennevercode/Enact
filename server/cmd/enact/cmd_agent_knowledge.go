package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/cli"
)

// Knowledge bases are attached per agent, not per workspace.
//
// A workspace resource of type knowledge_repo is the library entry; binding it
// to an agent here is what puts its index in that agent's brief. An agent with
// no bindings never sees the section and pays nothing for it, which is why
// there is no workspace-level switch to go with these commands.

var agentKnowledgeCmd = &cobra.Command{
	Use:   "knowledge",
	Short: "Manage the knowledge bases an agent reads",
}

var agentKnowledgeListCmd = &cobra.Command{
	Use:   "list <agent-id>",
	Short: "List the knowledge bases attached to an agent",
	Args:  exactArgs(1),
	RunE:  runAgentKnowledgeList,
}

var agentKnowledgeAddCmd = &cobra.Command{
	Use:   "add <agent-id>",
	Short: "Attach a workspace knowledge base to an agent",
	Args:  exactArgs(1),
	RunE:  runAgentKnowledgeAdd,
}

var agentKnowledgeRemoveCmd = &cobra.Command{
	Use:   "remove <agent-id> <resource-id>",
	Short: "Detach a knowledge base from an agent (the workspace keeps the resource)",
	Args:  exactArgs(2),
	RunE:  runAgentKnowledgeRemove,
}

func init() {
	agentCmd.AddCommand(agentKnowledgeCmd)
	agentKnowledgeCmd.AddCommand(agentKnowledgeListCmd)
	agentKnowledgeCmd.AddCommand(agentKnowledgeAddCmd)
	agentKnowledgeCmd.AddCommand(agentKnowledgeRemoveCmd)

	agentKnowledgeListCmd.Flags().String("output", "table", "Output format: table or json")
	agentKnowledgeListCmd.Flags().Bool("full-id", false, "Show full UUIDs in table output")

	agentKnowledgeAddCmd.Flags().String("resource-id", "", "ID of the knowledge_repo resource to attach (see `enact resource list`)")
	agentKnowledgeAddCmd.Flags().String("output", "json", "Output format: table or json")

	agentKnowledgeRemoveCmd.Flags().String("output", "json", "Output format: table or json")
}

type agentKnowledgeListResponse struct {
	KnowledgeSources []agentKnowledgeSource `json:"knowledge_sources"`
	Total            int                    `json:"total"`
}

type agentKnowledgeSource struct {
	ResourceID string  `json:"resource_id"`
	URL        string  `json:"url"`
	Ref        string  `json:"ref"`
	Path       string  `json:"path"`
	Delivery   string  `json:"delivery"`
	Label      *string `json:"label"`
}

func runAgentKnowledgeList(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var resp agentKnowledgeListResponse
	if err := client.GetJSON(ctx, "/api/agents/"+args[0]+"/knowledge", &resp); err != nil {
		return fmt.Errorf("list agent knowledge bases: %w", err)
	}
	return printAgentKnowledge(cmd, resp)
}

func runAgentKnowledgeAdd(cmd *cobra.Command, args []string) error {
	resourceID := strings.TrimSpace(mustString(cmd, "resource-id"))
	if resourceID == "" {
		return fmt.Errorf("--resource-id is required (list them with `enact resource list`)")
	}
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var resp agentKnowledgeListResponse
	if err := client.PostJSON(ctx, "/api/agents/"+args[0]+"/knowledge",
		map[string]any{"resource_id": resourceID}, &resp); err != nil {
		return fmt.Errorf("attach knowledge base: %w", err)
	}
	return printAgentKnowledge(cmd, resp)
}

func runAgentKnowledgeRemove(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var resp agentKnowledgeListResponse
	if err := client.DeleteJSONResponse(ctx,
		"/api/agents/"+args[0]+"/knowledge/"+args[1], &resp); err != nil {
		return fmt.Errorf("remove knowledge base: %w", err)
	}
	return printAgentKnowledge(cmd, resp)
}

func printAgentKnowledge(cmd *cobra.Command, resp agentKnowledgeListResponse) error {
	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, resp)
	}
	fullID, _ := cmd.Flags().GetBool("full-id")
	headers := []string{"RESOURCE ID", "LABEL", "URL", "REF", "PATH", "DELIVERY"}
	rows := make([][]string, 0, len(resp.KnowledgeSources))
	for _, src := range resp.KnowledgeSources {
		label := ""
		if src.Label != nil {
			label = *src.Label
		}
		rows = append(rows, []string{
			displayID(src.ResourceID, fullID),
			label,
			src.URL,
			src.Ref,
			src.Path,
			src.Delivery,
		})
	}
	cli.PrintTable(os.Stdout, headers, rows)
	return nil
}
