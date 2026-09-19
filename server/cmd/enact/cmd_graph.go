package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/cli"
	"github.com/enact-ai/enact/server/internal/codegraph"
)

// `enact graph` reads the code graph the server builds for a repository: a
// structure map of files, symbols, imports and calls, grouped into
// subsystems. It is a read surface only — building is the server's job, and
// whether a repository has a graph at all is a workspace setting.
//
// Every subcommand resolves the repository the same way: --repo when given,
// otherwise the `origin` remote of the current working directory, matched
// against the workspace's resources by normalized URL.

// errGraphUnavailable is the one-line, non-fatal outcome: the graph is off,
// not built yet, or the deployment has no builder. Callers should carry on
// without it, so it exits 2 rather than printing a stack of causes.
type errGraphUnavailable struct{ reason string }

func (e *errGraphUnavailable) Error() string { return e.reason }

const graphUnavailableExitCode = 2

var graphRepoFlag string

var graphCmd = &cobra.Command{
	Use:   "graph",
	Short: "Read a repository's code graph",
	Long: "Reads the code graph the workspace builds for a repository: subsystems, key hubs, " +
		"neighbours and paths between symbols. Use it to locate code before reading it.",
}

var graphStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Report whether this repository has a code graph",
	Args:  cobra.NoArgs,
	RunE:  runGraphStatus,
}

var graphReportCmd = &cobra.Command{
	Use:   "report",
	Short: "Print the code graph report (subsystems, hubs, surprising links)",
	Args:  cobra.NoArgs,
	RunE:  runGraphReport,
}

var graphQueryCmd = &cobra.Command{
	Use:   "query <question>",
	Short: "Find the part of the graph that answers a question",
	Args:  exactArgs(1),
	RunE:  runGraphQuery,
}

var graphPathCmd = &cobra.Command{
	Use:   "path <from> <to>",
	Short: "Show the shortest path between two symbols",
	Args:  exactArgs(2),
	RunE:  runGraphPath,
}

var graphExplainCmd = &cobra.Command{
	Use:   "explain <node>",
	Short: "Show what one symbol connects to",
	Args:  exactArgs(1),
	RunE:  runGraphExplain,
}

var graphAffectedCmd = &cobra.Command{
	Use:   "affected <node>",
	Short: "Show what depends on a symbol (reverse impact)",
	Args:  exactArgs(1),
	RunE:  runGraphAffected,
}

var graphCommunitiesCmd = &cobra.Command{
	Use:   "communities",
	Short: "List the repository's subsystems",
	Args:  cobra.NoArgs,
	RunE:  runGraphCommunities,
}

func init() {
	graphCmd.AddCommand(graphStatusCmd, graphReportCmd, graphQueryCmd,
		graphPathCmd, graphExplainCmd, graphAffectedCmd, graphCommunitiesCmd)

	graphCmd.PersistentFlags().StringVar(&graphRepoFlag, "repo", "",
		"Repository URL; defaults to the origin remote of the working directory")

	graphStatusCmd.Flags().Bool("json", false, "Print the raw status JSON")
	graphCommunitiesCmd.Flags().Bool("json", false, "Print the raw communities JSON")

	graphQueryCmd.Flags().Bool("dfs", false, "Trace one dependency chain deeply instead of the neighbourhood")
	graphQueryCmd.Flags().Int("depth", 0, "How many hops to traverse (server default when unset)")
	graphQueryCmd.Flags().Int("budget", 0, "Approximate token budget for the answer")
	graphQueryCmd.Flags().StringArray("context", nil, "Restrict to an edge context, e.g. call (repeatable)")

	graphPathCmd.Flags().Bool("directed", false, "Follow edge direction instead of treating the graph as undirected")

	graphAffectedCmd.Flags().Int("depth", 0, "How many hops of dependents to include")
	graphAffectedCmd.Flags().StringArray("relation", nil, "Restrict to a relation, e.g. calls (repeatable)")
}

// ── Repository resolution ────────────────────────────────────────────────────

// resolveGraphResource finds the workspace resource for the repository this
// command is about. The failure modes are deliberately distinct: no repo at
// all, a repo the workspace does not carry, and a repo whose graph is off.
func resolveGraphResource(ctx context.Context, client *cli.APIClient) (string, error) {
	target := strings.TrimSpace(graphRepoFlag)
	if target == "" {
		target = gitOriginURL()
	}
	if target == "" {
		return "", &errGraphUnavailable{"no repository: pass --repo <url>, or run this inside a repository checkout"}
	}
	normalized := codegraph.NormalizeRepoURL(target)
	if normalized == "" {
		return "", &errGraphUnavailable{fmt.Sprintf("%q is not a repository URL", target)}
	}
	resources, err := fetchWorkspaceResources(ctx, client)
	if err != nil {
		return "", err
	}
	for _, raw := range resources {
		r, ok := raw.(map[string]any)
		if !ok || strVal(r, "resource_type") != "github_repo" {
			continue
		}
		ref, _ := r["resource_ref"].(map[string]any)
		if ref == nil {
			continue
		}
		if codegraph.NormalizeRepoURL(strVal(ref, "url")) != normalized {
			continue
		}
		if enabled, _ := ref["code_graph"].(bool); !enabled {
			return "", &errGraphUnavailable{"code graph is not enabled for " + normalized}
		}
		return strVal(r, "id"), nil
	}
	return "", &errGraphUnavailable{normalized + " is not a repository of this workspace"}
}

// gitOriginURL reads the origin remote of the working directory. Any failure
// is "no origin"; the caller turns that into an actionable message.
func gitOriginURL() string {
	cmd := exec.Command("git", "config", "--get", "remote.origin.url")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// graphGet and graphPost call the code graph API for a resource and turn the
// two expected refusals into the non-fatal outcome.
func graphGet(ctx context.Context, client *cli.APIClient, resourceID, suffix string, query url.Values, out any) error {
	path := "/api/code-graph/resources/" + resourceID + "/" + suffix
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	return graphUnavailableIfExpected(client.GetJSON(ctx, path, out))
}

func graphPost(ctx context.Context, client *cli.APIClient, resourceID, suffix string, body, out any) error {
	path := "/api/code-graph/resources/" + resourceID + "/" + suffix
	return graphUnavailableIfExpected(client.PostJSON(ctx, path, body, out))
}

// graphUnavailableIfExpected maps the API's "not built / not enabled / no
// builder" answers onto the soft outcome. Everything else keeps its own
// error and its own exit code.
func graphUnavailableIfExpected(err error) error {
	if err == nil {
		return nil
	}
	var httpErr *cli.HTTPError
	if errors.As(err, &httpErr) {
		switch httpErr.StatusCode {
		case 404:
			return &errGraphUnavailable{"this repository has no code graph"}
		case 409:
			return &errGraphUnavailable{"the code graph is not built yet"}
		case 503:
			return &errGraphUnavailable{"this deployment has no code graph service"}
		}
	}
	return err
}

// graphSetup resolves the client and the resource for every subcommand.
func graphSetup(cmd *cobra.Command) (context.Context, context.CancelFunc, *cli.APIClient, string, error) {
	client, err := newAPIClient(cmd)
	if err != nil {
		return nil, nil, nil, "", err
	}
	ctx, cancel := cli.APIContext(context.Background())
	resourceID, err := resolveGraphResource(ctx, client)
	if err != nil {
		cancel()
		return nil, nil, nil, "", err
	}
	return ctx, cancel, client, resourceID, nil
}

// ── Commands ─────────────────────────────────────────────────────────────────

func runGraphStatus(cmd *cobra.Command, _ []string) error {
	ctx, cancel, client, resourceID, err := graphSetup(cmd)
	if err != nil {
		return err
	}
	defer cancel()

	var status map[string]any
	// status answers for a disabled-but-present resource too, so it does not
	// go through the soft mapping: a 404 here means the resource is gone.
	if err := client.GetJSON(ctx, "/api/code-graph/resources/"+resourceID+"/status", &status); err != nil {
		return graphUnavailableIfExpected(err)
	}
	if asJSON, _ := cmd.Flags().GetBool("json"); asJSON {
		return cli.PrintJSON(os.Stdout, status)
	}
	fmt.Fprintln(os.Stdout, formatGraphStatus(status))
	return nil
}

// formatGraphStatus renders one line an agent can branch on, followed by the
// build's numbers when there are any.
func formatGraphStatus(status map[string]any) string {
	enabled, _ := status["enabled"].(bool)
	if !enabled {
		return "not enabled: this repository does not build a code graph"
	}
	build, _ := status["build"].(map[string]any)
	if build == nil {
		return "queued: the first build has not started yet"
	}
	state := strVal(build, "state")
	var b strings.Builder
	switch state {
	case "ready":
		b.WriteString("ready")
		if commit := strVal(build, "commit"); commit != "" {
			b.WriteString(" at " + shortCommit(commit))
		}
		if stale, _ := status["stale"].(bool); stale {
			b.WriteString(" (stale: the repository has moved on; a rebuild is queued)")
		}
	case "queued", "building":
		b.WriteString(state + ": no graph yet — work as usual, do not wait for it")
	case "skipped":
		b.WriteString("skipped")
		if reason := strVal(build, "skipped_reason"); reason != "" {
			b.WriteString(": " + reason)
		}
	case "failed":
		b.WriteString("failed")
		if msg := strVal(build, "error"); msg != "" {
			b.WriteString(": " + msg)
		}
	default:
		b.WriteString(state)
	}
	if stats, ok := build["stats"].(map[string]any); ok && len(stats) > 0 {
		b.WriteString("\n" + formatGraphStats(stats))
	}
	return b.String()
}

func formatGraphStats(stats map[string]any) string {
	parts := make([]string, 0, 4)
	for _, key := range []string{"files", "nodes", "edges", "communities"} {
		if value, ok := numberFromJSON(stats[key]); ok {
			label := key
			if key == "communities" {
				label = "subsystems"
			}
			parts = append(parts, strconv.FormatInt(value, 10)+" "+label)
		}
	}
	return strings.Join(parts, " · ")
}

func numberFromJSON(v any) (int64, bool) {
	switch n := v.(type) {
	case float64:
		return int64(n), true
	case json.Number:
		parsed, err := n.Int64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func shortCommit(commit string) string {
	if len(commit) > 8 {
		return commit[:8]
	}
	return commit
}

func runGraphReport(cmd *cobra.Command, _ []string) error {
	ctx, cancel, client, resourceID, err := graphSetup(cmd)
	if err != nil {
		return err
	}
	defer cancel()

	var out struct {
		ReportMD string `json:"report_md"`
	}
	if err := graphGet(ctx, client, resourceID, "report", nil, &out); err != nil {
		return err
	}
	fmt.Fprintln(os.Stdout, strings.TrimRight(out.ReportMD, "\n"))
	return nil
}

func runGraphQuery(cmd *cobra.Command, args []string) error {
	ctx, cancel, client, resourceID, err := graphSetup(cmd)
	if err != nil {
		return err
	}
	defer cancel()

	body := map[string]any{"question": args[0]}
	if dfs, _ := cmd.Flags().GetBool("dfs"); dfs {
		body["mode"] = "dfs"
	}
	if depth, _ := cmd.Flags().GetInt("depth"); depth > 0 {
		body["depth"] = depth
	}
	if budget, _ := cmd.Flags().GetInt("budget"); budget > 0 {
		body["token_budget"] = budget
	}
	if contexts, _ := cmd.Flags().GetStringArray("context"); len(contexts) > 0 {
		body["context"] = contexts
	}
	return graphPrintText(ctx, client, resourceID, "query", body)
}

func runGraphPath(cmd *cobra.Command, args []string) error {
	ctx, cancel, client, resourceID, err := graphSetup(cmd)
	if err != nil {
		return err
	}
	defer cancel()

	directed, _ := cmd.Flags().GetBool("directed")
	return graphPrintText(ctx, client, resourceID, "path", map[string]any{
		"source": args[0], "target": args[1], "undirected": !directed,
	})
}

func runGraphExplain(cmd *cobra.Command, args []string) error {
	ctx, cancel, client, resourceID, err := graphSetup(cmd)
	if err != nil {
		return err
	}
	defer cancel()
	return graphPrintText(ctx, client, resourceID, "explain", map[string]any{"node": args[0]})
}

func runGraphAffected(cmd *cobra.Command, args []string) error {
	ctx, cancel, client, resourceID, err := graphSetup(cmd)
	if err != nil {
		return err
	}
	defer cancel()

	body := map[string]any{"seed": args[0]}
	if depth, _ := cmd.Flags().GetInt("depth"); depth > 0 {
		body["depth"] = depth
	}
	if relations, _ := cmd.Flags().GetStringArray("relation"); len(relations) > 0 {
		body["relations"] = relations
	}
	return graphPrintText(ctx, client, resourceID, "affected", body)
}

// graphPrintText runs one of the text-answering routes. They all return
// {"text": ...}; anything else is printed as JSON rather than swallowed.
func graphPrintText(ctx context.Context, client *cli.APIClient, resourceID, suffix string, body map[string]any) error {
	var out map[string]any
	if err := graphPost(ctx, client, resourceID, suffix, body, &out); err != nil {
		return err
	}
	if text := strVal(out, "text"); text != "" {
		fmt.Fprintln(os.Stdout, strings.TrimRight(text, "\n"))
		return nil
	}
	return cli.PrintJSON(os.Stdout, out)
}

func runGraphCommunities(cmd *cobra.Command, _ []string) error {
	ctx, cancel, client, resourceID, err := graphSetup(cmd)
	if err != nil {
		return err
	}
	defer cancel()

	var out map[string]any
	if err := graphGet(ctx, client, resourceID, "communities", nil, &out); err != nil {
		return err
	}
	if asJSON, _ := cmd.Flags().GetBool("json"); asJSON {
		return cli.PrintJSON(os.Stdout, out)
	}
	communities, _ := out["communities"].([]any)
	if len(communities) == 0 {
		fmt.Fprintln(os.Stdout, "no subsystems in this graph")
		return nil
	}
	headers := []string{"ID", "SUBSYSTEM", "NODES", "TOP FILE"}
	rows := make([][]string, 0, len(communities))
	for _, raw := range communities {
		c, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id := ""
		if n, ok := numberFromJSON(c["id"]); ok {
			id = strconv.FormatInt(n, 10)
		}
		size := ""
		if n, ok := numberFromJSON(c["size"]); ok {
			size = strconv.FormatInt(n, 10)
		}
		topFile := ""
		if nodes, ok := c["top_nodes"].([]any); ok && len(nodes) > 0 {
			if first, ok := nodes[0].(map[string]any); ok {
				topFile = strVal(first, "source_file")
			}
		}
		rows = append(rows, []string{id, strVal(c, "label"), size, topFile})
	}
	cli.PrintTable(os.Stdout, headers, rows)
	return nil
}
