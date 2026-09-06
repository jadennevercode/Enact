package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/cli"
	"github.com/enact-ai/enact/server/internal/workspaceprofile"
)

// The workspace's project profile from the CLI.
//
// This is what an interview run writes. It is deliberately a whole-document
// write rather than a set of --field flags: a profile is agreed in one
// conversation and confirmed as one thing, and a flag-per-field interface
// would invite an agent to patch one value at a time, each write racing the
// last and none of them ever shown to the member as a whole.

var workspaceProfileCmd = &cobra.Command{
	Use:   "profile",
	Short: "Read and write this workspace's project profile",
	Long: `The project profile is what this workspace says about itself: a summary, the
domain, the stack, the kinds of work it brings here, and any constraints.

Two things read it. Every agent run starts with it, rendered into the brief as
"## Project profile", so a run does not have to infer the team's conventions
from files. And the Marketplace ranks listings against it, so what is
recommended is about this project rather than about what is popular.`,
}

var workspaceProfileGetCmd = &cobra.Command{
	Use:   "get [workspace-id|slug|prefix]",
	Short: "Show the project profile",
	Args:  cobra.MaximumNArgs(1),
	RunE:  runWorkspaceProfileGet,
}

var workspaceProfileSetCmd = &cobra.Command{
	Use:   "set [workspace-id|slug|prefix]",
	Short: "Replace the project profile",
	Long: `Replaces the profile with the JSON document read from stdin.

This is a REPLACE, not a merge: what you send is what the workspace will say
about itself. Read the current one with ` + "`enact workspace profile get`" + `
first and send it back with your changes, or a field you did not mention will
be cleared.

Two fields are the exception, because they are written by the repository
analysis rather than by a person: ` + "`repo_brief`" + ` and
` + "`repo_brief_sources`" + ` are carried forward when your document omits
them entirely. Send them explicitly (including as "") to change or clear them.

Fields:

  summary       one or two sentences: what this project is and who it serves
  domain        the industry or problem space, free text
  stack         technologies in use, lowercase tokens: ["go","postgres"]
  languages     human languages the team works in: ["zh","en"]
  team_size     free text, never parsed: "solo", "4 engineers"
  typical_work  a closed vocabulary; see the list below
  constraints   anything a run must respect: compliance, environments, review

typical_work must be drawn from: ` + strings.Join(workspaceprofile.TypicalWorkValues(), ", ") + `.
It is closed because the recommender maps these values to what listings say
they are for, and a rule cannot be written against free text. Put anything that
does not fit into summary or constraints, where it still reaches every run.

Preview the document with the member and get their confirmation before writing
it. This is what every later agent run will be told the project is.

Example:

  enact workspace profile set --json-stdin <<'JSON'
  {
    "summary": "A logistics control tower for mid-size carriers.",
    "domain": "logistics",
    "stack": ["go", "typescript", "postgres"],
    "languages": ["zh", "en"],
    "team_size": "4 engineers",
    "typical_work": ["ship_code", "review_code"],
    "constraints": "Production changes need a second reviewer."
  }
  JSON`,
	Args: cobra.MaximumNArgs(1),
	RunE: runWorkspaceProfileSet,
}

func init() {
	// `--output` is registered per command in this CLI rather than on the root,
	// so both of these need their own. The default is `table` because a person
	// reading their profile wants to read it; an agent asks for json.
	workspaceProfileGetCmd.Flags().String("output", "table", "Output format: table or json")
	workspaceProfileSetCmd.Flags().String("output", "table", "Output format: table or json")

	workspaceProfileSetCmd.Flags().Bool("json-stdin", false,
		"Read the profile document from stdin (required; the flag is explicit so a bare `set` cannot silently clear the profile)")

	workspaceProfileCmd.AddCommand(workspaceProfileGetCmd)
	workspaceProfileCmd.AddCommand(workspaceProfileSetCmd)
	workspaceCmd.AddCommand(workspaceProfileCmd)
}

func runWorkspaceProfileGet(cmd *cobra.Command, args []string) error {
	wsID, client, err := workspaceProfileTarget(cmd, args)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var profile map[string]any
	if err := client.GetJSON(ctx, "/api/workspaces/"+wsID+"/profile", &profile); err != nil {
		return fmt.Errorf("read workspace profile: %w", err)
	}
	return printWorkspaceProfile(cmd, profile)
}

func runWorkspaceProfileSet(cmd *cobra.Command, args []string) error {
	fromStdin, _ := cmd.Flags().GetBool("json-stdin")
	if !fromStdin {
		return fmt.Errorf("--json-stdin is required: pipe the profile document in, e.g. `enact workspace profile set --json-stdin <<'JSON' ... JSON`")
	}

	wsID, client, err := workspaceProfileTarget(cmd, args)
	if err != nil {
		return err
	}

	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		return fmt.Errorf("read the profile from stdin: %w", err)
	}
	if len(strings.TrimSpace(string(raw))) == 0 {
		return fmt.Errorf("stdin was empty; send a JSON object, or `{}` to deliberately clear the profile")
	}
	// Decoded here so a typo is a local error naming the offset, rather than a
	// 400 from the server that the agent then has to interpret.
	var document map[string]any
	if err := json.Unmarshal(raw, &document); err != nil {
		return fmt.Errorf("the profile must be a JSON object: %w", err)
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var saved map[string]any
	if err := client.PutJSON(ctx, "/api/workspaces/"+wsID+"/profile", document, &saved); err != nil {
		return fmt.Errorf("write workspace profile: %w", err)
	}
	return printWorkspaceProfile(cmd, saved)
}

// workspaceProfileTarget resolves the workspace and builds the client, which
// both subcommands do identically.
func workspaceProfileTarget(cmd *cobra.Command, args []string) (string, *cli.APIClient, error) {
	wsID, err := resolveWorkspaceArg(cmd, args)
	if err != nil {
		return "", nil, err
	}
	if wsID == "" {
		return "", nil, fmt.Errorf("workspace ID is required: pass an id/slug/prefix as argument or set ENACT_WORKSPACE_ID")
	}
	client, err := newAPIClient(cmd)
	if err != nil {
		return "", nil, err
	}
	return wsID, client, nil
}

func printWorkspaceProfile(cmd *cobra.Command, profile map[string]any) error {
	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, profile)
	}

	if empty, ok := profile["empty"].(bool); ok && empty {
		fmt.Fprintln(os.Stdout, "This workspace has no project profile yet.")
		return nil
	}
	rows := [][]string{}
	appendField := func(label, key string) {
		if value := strVal(profile, key); value != "" {
			rows = append(rows, []string{label, value})
		}
	}
	appendList := func(label, key string) {
		values, _ := profile[key].([]any)
		parts := make([]string, 0, len(values))
		for _, value := range values {
			if text, ok := value.(string); ok {
				parts = append(parts, text)
			}
		}
		if len(parts) > 0 {
			rows = append(rows, []string{label, strings.Join(parts, ", ")})
		}
	}
	appendField("Summary", "summary")
	appendField("Domain", "domain")
	appendList("Stack", "stack")
	appendList("Languages", "languages")
	appendField("Team", "team_size")
	appendList("Typical work", "typical_work")
	appendField("Constraints", "constraints")
	appendField("Repository", "repo_brief")
	appendField("Updated", "updated_at")
	cli.PrintTable(os.Stdout, []string{"FIELD", "VALUE"}, rows)
	return nil
}
