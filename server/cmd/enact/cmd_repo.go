package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/enact-ai/enact/server/internal/cli"
	"github.com/spf13/cobra"
)

var repoCmd = &cobra.Command{
	Use:   "repo",
	Short: "Work with repositories",
}

var repoListCmd = &cobra.Command{
	Use:   "list",
	Short: "List workspace repositories",
	Long:  "Lists the repository registry for the current workspace. These are workspace-level repos, separate from project resources.",
	Args:  cobra.NoArgs,
	RunE:  runRepoList,
}

var repoAddCmd = &cobra.Command{
	Use:   "add [url]...",
	Short: "Add repositories to the workspace registry",
	Long: "Adds one or more repository URLs to the current workspace repository registry. " +
		"Existing URLs are not duplicated. Use project resources when you need project-specific context instead.",
	Args: cobra.ArbitraryArgs,
	RunE: runRepoAdd,
}

var repoRemoveCmd = &cobra.Command{
	Use:     "remove [url]...",
	Aliases: []string{"rm"},
	Short:   "Remove repositories from the workspace registry",
	Long:    "Removes one or more repository URLs from the current workspace repository registry.",
	Args:    cobra.ArbitraryArgs,
	RunE:    runRepoRemove,
}

var repoCheckoutCmd = &cobra.Command{
	Use:   "checkout <url>",
	Short: "Check out a repository into the working directory",
	Long:  "Creates a git worktree from the daemon's bare clone cache. Used by agents to check out repos on demand.",
	Args:  exactArgs(1),
	RunE:  runRepoCheckout,
}

var repoCheckoutRef string

func init() {
	repoListCmd.Flags().String("output", "table", "Output format: table or json")

	repoAddCmd.Flags().StringArray("url", nil, "Repository URL to add (may be repeated)")
	repoAddCmd.Flags().String("description", "", "Optional description; only valid when adding one URL")
	repoAddCmd.Flags().String("output", "json", "Output format: table or json")

	repoRemoveCmd.Flags().StringArray("url", nil, "Repository URL to remove (may be repeated)")
	repoRemoveCmd.Flags().String("output", "json", "Output format: table or json")

	repoCheckoutCmd.Flags().StringVar(&repoCheckoutRef, "ref", "", "branch, tag, or commit to check out instead of the remote default branch")

	repoCmd.AddCommand(repoListCmd)
	repoCmd.AddCommand(repoAddCmd)
	repoCmd.AddCommand(repoRemoveCmd)
	repoCmd.AddCommand(repoCheckoutCmd)
}

// `enact repo` is the repository-shaped view of workspace resources. There is
// one storage — the workspace_resource table — and `enact resource` is its
// general typed surface; this command exists because "add a repo" is the thing
// people actually do, and `--type github_repo --url …` is a lot of ceremony for
// it. It used to write `workspace.repos`, a separate list that migration 438
// folded into resources.

type repoResource struct {
	ID          string
	URL         string
	Ref         string
	Description string
}

// listRepoResources returns the workspace's github_repo resources, skipping
// every other resource type. A malformed row is skipped rather than failing the
// listing: one bad ref should not hide the repositories around it.
func listRepoResources(ctx context.Context, client *cli.APIClient) ([]repoResource, error) {
	raw, err := fetchWorkspaceResources(ctx, client)
	if err != nil {
		return nil, err
	}
	repos := make([]repoResource, 0, len(raw))
	for _, item := range raw {
		row, ok := item.(map[string]any)
		if !ok || strVal(row, "resource_type") != "github_repo" {
			continue
		}
		ref, _ := row["resource_ref"].(map[string]any)
		url := strings.TrimSpace(strVal(ref, "url"))
		if url == "" {
			continue
		}
		repos = append(repos, repoResource{
			ID:          strVal(row, "id"),
			URL:         url,
			Ref:         strings.TrimSpace(strVal(ref, "ref")),
			Description: strings.TrimSpace(strVal(row, "label")),
		})
	}
	return repos, nil
}

func repoURLsFromArgsAndFlags(cmd *cobra.Command, args []string) ([]string, error) {
	urls := append([]string{}, args...)
	if flagURLs, err := cmd.Flags().GetStringArray("url"); err == nil {
		urls = append(urls, flagURLs...)
	}
	seen := make(map[string]struct{}, len(urls))
	out := make([]string, 0, len(urls))
	for _, raw := range urls {
		url := strings.TrimSpace(raw)
		if url == "" {
			continue
		}
		if _, dup := seen[url]; dup {
			continue
		}
		seen[url] = struct{}{}
		out = append(out, url)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("at least one repository URL is required")
	}
	return out, nil
}

func runRepoList(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	repos, err := listRepoResources(cmd.Context(), client)
	if err != nil {
		return err
	}
	if output, _ := cmd.Flags().GetString("output"); output == "json" {
		return cli.PrintJSON(os.Stdout, repos)
	}
	if len(repos) == 0 {
		fmt.Fprintln(os.Stdout, "No repositories attached to this workspace.")
		return nil
	}
	rows := make([][]string, 0, len(repos))
	for _, repo := range repos {
		rows = append(rows, []string{repo.URL, repo.Ref, repo.Description})
	}
	cli.PrintTable(os.Stdout, []string{"URL", "REF", "DESCRIPTION"}, rows)
	return nil
}

func runRepoAdd(cmd *cobra.Command, args []string) error {
	urls, err := repoURLsFromArgsAndFlags(cmd, args)
	if err != nil {
		return err
	}
	description := strings.TrimSpace(mustString(cmd, "description"))
	// One description cannot describe several repositories, and silently
	// applying it to all of them would be worse than refusing.
	if description != "" && len(urls) > 1 {
		return fmt.Errorf("--description applies to a single repository; got %d", len(urls))
	}

	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	existing, err := listRepoResources(cmd.Context(), client)
	if err != nil {
		return err
	}
	byURL := make(map[string]repoResource, len(existing))
	for _, repo := range existing {
		byURL[repo.URL] = repo
	}

	added := make([]string, 0, len(urls))
	updated := make([]string, 0, 1)
	for _, url := range urls {
		if repo, dup := byURL[url]; dup {
			// Re-adding an attached repository is how you set or change its
			// description; without one it is a no-op rather than an error.
			if description == "" || repo.Description == description {
				continue
			}
			body := map[string]any{"label": description}
			var result map[string]any
			if err := client.PutJSON(cmd.Context(), "/api/resources/"+repo.ID, body, &result); err != nil {
				return fmt.Errorf("update repository %s: %w", url, err)
			}
			updated = append(updated, url)
			continue
		}
		body := map[string]any{
			"resource_type": "github_repo",
			"resource_ref":  map[string]any{"url": url},
		}
		if description != "" {
			body["label"] = description
		}
		var result map[string]any
		if err := client.PostJSON(cmd.Context(), "/api/resources", body, &result); err != nil {
			return fmt.Errorf("add repository %s: %w", url, err)
		}
		byURL[url] = repoResource{URL: url}
		added = append(added, url)
	}

	if len(added) == 0 && len(updated) == 0 {
		fmt.Fprintln(os.Stdout, "Already attached; nothing to do.")
		return nil
	}
	for _, url := range added {
		fmt.Fprintf(os.Stdout, "Attached %s\n", url)
	}
	for _, url := range updated {
		fmt.Fprintf(os.Stdout, "Updated %s\n", url)
	}
	return nil
}

func runRepoRemove(cmd *cobra.Command, args []string) error {
	urls, err := repoURLsFromArgsAndFlags(cmd, args)
	if err != nil {
		return err
	}
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	existing, err := listRepoResources(cmd.Context(), client)
	if err != nil {
		return err
	}
	byURL := make(map[string]repoResource, len(existing))
	for _, repo := range existing {
		byURL[repo.URL] = repo
	}

	removed := make([]string, 0, len(urls))
	missing := make([]string, 0)
	for _, url := range urls {
		repo, ok := byURL[url]
		if !ok {
			missing = append(missing, url)
			continue
		}
		if err := client.DeleteJSON(cmd.Context(), "/api/resources/"+repo.ID); err != nil {
			return fmt.Errorf("remove repository %s: %w", url, err)
		}
		removed = append(removed, url)
	}
	for _, url := range removed {
		fmt.Fprintf(os.Stdout, "Removed %s\n", url)
	}
	if len(missing) > 0 {
		return fmt.Errorf("not attached to this workspace: %s", strings.Join(missing, ", "))
	}
	return nil
}

func runRepoCheckout(cmd *cobra.Command, args []string) error {
	repoURL := args[0]

	daemonPort := os.Getenv("ENACT_DAEMON_PORT")
	if daemonPort == "" {
		return fmt.Errorf("ENACT_DAEMON_PORT not set (this command is intended to be run by an agent inside a daemon task)")
	}

	workspaceID := os.Getenv("ENACT_WORKSPACE_ID")
	agentName := os.Getenv("ENACT_AGENT_NAME")
	taskID := os.Getenv("ENACT_TASK_ID")
	taskToken := os.Getenv("ENACT_TOKEN")
	if taskToken == "" {
		return fmt.Errorf("ENACT_TOKEN not set (repo checkout requires the active task credential)")
	}

	// Use current working directory as the checkout target.
	workDir, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("get working directory: %w", err)
	}

	reqBody := map[string]any{
		"url":           repoURL,
		"workspace_id":  workspaceID,
		"workdir":       workDir,
		"ref":           repoCheckoutRef,
		"agent_name":    agentName,
		"task_id":       taskID,
		"checkout_mode": strings.TrimSpace(os.Getenv("ENACT_REPO_CHECKOUT_MODE")),
		"retry_busy":    true,
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("encode request: %w", err)
	}

	parentCtx := cmd.Context()
	if parentCtx == nil {
		parentCtx = context.Background()
	}
	ctx, cancel := context.WithTimeout(parentCtx, 5*time.Minute)
	defer cancel()
	client := &http.Client{}
	checkoutURL := fmt.Sprintf("http://127.0.0.1:%s/repo/checkout", daemonPort)
	var body []byte
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, checkoutURL, bytes.NewReader(data))
		if err != nil {
			return fmt.Errorf("create daemon checkout request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+taskToken)
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("connect to daemon: %w", err)
		}
		body, err = io.ReadAll(resp.Body)
		closeErr := resp.Body.Close()
		if err != nil {
			return fmt.Errorf("read daemon checkout response: %w", err)
		}
		if closeErr != nil {
			return fmt.Errorf("close daemon checkout response: %w", closeErr)
		}
		if resp.StatusCode == http.StatusServiceUnavailable && resp.Header.Get("X-Enact-Retryable") == "repo-busy" {
			delay := repoCheckoutRetryDelay(resp.Header.Get("Retry-After"), time.Now())
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return fmt.Errorf("connect to daemon: %w", context.Cause(ctx))
			case <-timer.C:
				continue
			}
		}
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("checkout failed: %s", string(body))
		}
		break
	}

	var result struct {
		Path       string `json:"path"`
		BranchName string `json:"branch_name"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}

	fmt.Fprintf(os.Stdout, "%s\n", result.Path)
	fmt.Fprintf(os.Stderr, "Checked out %s → %s (branch: %s)\n", repoURL, result.Path, result.BranchName)

	return nil
}

func repoCheckoutRetryDelay(value string, now time.Time) time.Duration {
	const (
		defaultDelay = time.Second
		maxDelay     = 30 * time.Second
	)
	value = strings.TrimSpace(value)
	if seconds, err := strconv.Atoi(value); err == nil && seconds >= 0 {
		return min(time.Duration(seconds)*time.Second, maxDelay)
	}
	if retryAt, err := http.ParseTime(value); err == nil {
		return min(max(retryAt.Sub(now), time.Duration(0)), maxDelay)
	}
	return defaultDelay
}
