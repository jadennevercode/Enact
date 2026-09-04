package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/cli"
)

// Resources are workspace-level: a repo or a local directory the workspace's
// agents check out to do their work. They used to hang off a project; the
// X-Workspace-ID header the API client already sends is now the whole address,
// so every command here takes the resource id alone.

var resourceCmd = &cobra.Command{
	Use:   "resource",
	Short: "Manage resources attached to the workspace",
}

var resourceListCmd = &cobra.Command{
	Use:   "list",
	Short: "List resources attached to the workspace",
	RunE:  runResourceList,
}

var resourceAddCmd = &cobra.Command{
	Use:   "add",
	Short: "Attach a resource to the workspace (e.g. --type github_repo --url <url>)",
	RunE:  runResourceAdd,
}

var resourceUpdateCmd = &cobra.Command{
	Use:   "update <resource-id>",
	Short: "Edit an attached resource (ref payload, label, or position)",
	Args:  exactArgs(1),
	RunE:  runResourceUpdate,
}

var resourceRemoveCmd = &cobra.Command{
	Use:   "remove <resource-id>",
	Short: "Detach a resource from the workspace",
	Args:  exactArgs(1),
	RunE:  runResourceRemove,
}

func init() {
	resourceCmd.AddCommand(resourceListCmd)
	resourceCmd.AddCommand(resourceAddCmd)
	resourceCmd.AddCommand(resourceUpdateCmd)
	resourceCmd.AddCommand(resourceRemoveCmd)

	// resource list
	resourceListCmd.Flags().String("output", "table", "Output format: table or json")
	resourceListCmd.Flags().Bool("full-id", false, "Show full UUIDs in table output")

	// resource add — generic shape: any --type with a JSON --ref payload works
	// without further CLI changes. github_repo is supported via dedicated
	// shortcuts; for that type, a non-JSON --ref value is treated as the
	// default checkout ref.
	resourceAddCmd.Flags().String("type", "github_repo", "Resource type (e.g. github_repo, local_directory — see docs)")
	resourceAddCmd.Flags().String("url", "", "Shortcut: the repo URL (only used when --type github_repo)")
	resourceAddCmd.Flags().String("default-branch-hint", "", "Shortcut: optional default branch hint (only used when --type github_repo)")
	resourceAddCmd.Flags().String("local-path", "", "Shortcut: absolute path to the working directory (only used when --type local_directory)")
	resourceAddCmd.Flags().String("daemon-id", "", "Shortcut: id of the daemon that owns the local path (only used when --type local_directory)")
	resourceAddCmd.Flags().String("ref-label", "", "Shortcut: optional label embedded in resource_ref (only used when --type local_directory)")
	resourceAddCmd.Flags().String("execution-mode", "", "Shortcut: how tasks share the directory — in_place (default, one task at a time) or worktree (each task gets its own git worktree; requires a git repo) (only used when --type local_directory)")
	resourceAddCmd.Flags().String("ref", "", "Generic JSON resource_ref payload, or a github_repo checkout ref when used with --url")
	resourceAddCmd.Flags().String("label", "", "Optional human-readable label")
	resourceAddCmd.Flags().String("output", "json", "Output format: table or json")

	// resource update — mirrors `add` flags, but every field is optional so the
	// caller can edit one thing at a time.
	resourceUpdateCmd.Flags().String("url", "", "Shortcut: new repo URL (github_repo)")
	resourceUpdateCmd.Flags().String("default-branch-hint", "", "Shortcut: new default branch hint (github_repo)")
	resourceUpdateCmd.Flags().String("local-path", "", "Shortcut: new absolute local path (local_directory)")
	resourceUpdateCmd.Flags().String("daemon-id", "", "Shortcut: new daemon id (local_directory)")
	resourceUpdateCmd.Flags().String("ref-label", "", "Shortcut: new label embedded in resource_ref (local_directory)")
	resourceUpdateCmd.Flags().String("execution-mode", "", "Shortcut: new execution mode — in_place or worktree (local_directory)")
	resourceUpdateCmd.Flags().String("ref", "", "Generic JSON resource_ref payload, or a github_repo checkout ref")
	resourceUpdateCmd.Flags().String("label", "", "New human-readable label; pass an empty string to clear")
	resourceUpdateCmd.Flags().Bool("clear-label", false, "Clear the human-readable label")
	resourceUpdateCmd.Flags().Int32("position", 0, "New display position")
	resourceUpdateCmd.Flags().String("output", "json", "Output format: table or json")

	// resource remove
	resourceRemoveCmd.Flags().String("output", "table", "Output format: table or json")
}

// ---------------------------------------------------------------------------
// Resource commands
// ---------------------------------------------------------------------------

func runResourceList(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	resourcesRaw, err := fetchWorkspaceResources(ctx, client)
	if err != nil {
		return err
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, resourcesRaw)
	}

	fullID, _ := cmd.Flags().GetBool("full-id")
	headers := []string{"ID", "TYPE", "REF", "LABEL"}
	rows := make([][]string, 0, len(resourcesRaw))
	for _, raw := range resourcesRaw {
		r, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		rows = append(rows, []string{
			displayID(strVal(r, "id"), fullID),
			strVal(r, "resource_type"),
			summarizeResourceRef(r["resource_ref"]),
			strVal(r, "label"),
		})
	}
	cli.PrintTable(os.Stdout, headers, rows)
	return nil
}

func runResourceAdd(cmd *cobra.Command, _ []string) error {
	resourceType, _ := cmd.Flags().GetString("type")
	resourceType = strings.TrimSpace(resourceType)
	if resourceType == "" {
		return fmt.Errorf("--type is required")
	}

	body := map[string]any{"resource_type": resourceType}

	// --ref takes precedence when it is JSON: any new resource type works
	// through that path without a CLI change. For github_repo only, a non-JSON
	// --ref is a checkout ref shortcut and merges with --url.
	if ref, ok, err := buildResourceRefFromRefFlag(cmd, resourceType, nil); err != nil {
		return err
	} else if ok {
		body["resource_ref"] = ref
	} else {
		switch resourceType {
		case "github_repo":
			ref, has, err := buildResourceRefFromFlags(cmd, resourceType, nil)
			if err != nil {
				return err
			}
			if !has {
				return fmt.Errorf("github_repo requires --url (or pass a JSON payload via --ref)")
			}
			body["resource_ref"] = ref
		case "local_directory":
			pathVal, _ := cmd.Flags().GetString("local-path")
			pathVal = strings.TrimSpace(pathVal)
			daemonVal, _ := cmd.Flags().GetString("daemon-id")
			daemonVal = strings.TrimSpace(daemonVal)
			if pathVal == "" || daemonVal == "" {
				return fmt.Errorf("local_directory requires --local-path and --daemon-id (or pass a JSON payload via --ref)")
			}
			ref := map[string]any{"local_path": pathVal, "daemon_id": daemonVal}
			if refLabel, _ := cmd.Flags().GetString("ref-label"); strings.TrimSpace(refLabel) != "" {
				ref["label"] = strings.TrimSpace(refLabel)
			}
			if mode, _ := cmd.Flags().GetString("execution-mode"); strings.TrimSpace(mode) != "" {
				ref["execution_mode"] = strings.TrimSpace(mode)
			}
			body["resource_ref"] = ref
		default:
			return fmt.Errorf("type %q has no built-in CLI shortcut; pass the payload via --ref '<json>'", resourceType)
		}
	}

	if label, _ := cmd.Flags().GetString("label"); label != "" {
		body["label"] = label
	}

	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var result map[string]any
	if err := client.PostJSON(ctx, "/api/resources", body, &result); err != nil {
		return fmt.Errorf("add resource: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "table" {
		headers := []string{"ID", "TYPE", "REF"}
		rows := [][]string{{
			strVal(result, "id"),
			strVal(result, "resource_type"),
			summarizeResourceRef(result["resource_ref"]),
		}}
		cli.PrintTable(os.Stdout, headers, rows)
		return nil
	}
	return cli.PrintJSON(os.Stdout, result)
}

func runResourceUpdate(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	resourceRef, err := resolveWorkspaceResourceID(ctx, client, args[0])
	if err != nil {
		return fmt.Errorf("resolve resource: %w", err)
	}

	// Fetch the existing row so per-type shortcuts know which schema to emit
	// and which fields to preserve. The server treats resource_ref as
	// opaque-replace, so a partial edit like `--default-branch-hint` has to
	// rebuild the full payload here — otherwise the unmentioned `url` would
	// vanish and the server would 400.
	existing, err := fetchWorkspaceResources(ctx, client)
	if err != nil {
		return err
	}
	var resourceType string
	var existingRef map[string]any
	for _, raw := range existing {
		row, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if strVal(row, "id") == resourceRef.ID {
			resourceType = strVal(row, "resource_type")
			if ref, ok := row["resource_ref"].(map[string]any); ok {
				existingRef = ref
			}
			break
		}
	}

	body := map[string]any{}

	if ref, ok, err := buildResourceRefFromRefFlag(cmd, resourceType, existingRef); err != nil {
		return err
	} else if ok {
		body["resource_ref"] = ref
	} else {
		ref, has, err := buildResourceRefFromFlags(cmd, resourceType, existingRef)
		if err != nil {
			return err
		}
		if has {
			body["resource_ref"] = ref
		}
	}

	clearLabel, _ := cmd.Flags().GetBool("clear-label")
	if clearLabel {
		body["label"] = nil
	} else if cmd.Flags().Changed("label") {
		label, _ := cmd.Flags().GetString("label")
		body["label"] = label
	}

	if cmd.Flags().Changed("position") {
		pos, _ := cmd.Flags().GetInt32("position")
		body["position"] = pos
	}

	if len(body) == 0 {
		return fmt.Errorf("nothing to update — pass --ref / --url / --local-path / --label / --position / --clear-label")
	}

	var result map[string]any
	if err := client.PutJSON(ctx, "/api/resources/"+resourceRef.ID, body, &result); err != nil {
		return fmt.Errorf("update resource: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "table" {
		headers := []string{"ID", "TYPE", "REF", "LABEL"}
		rows := [][]string{{
			strVal(result, "id"),
			strVal(result, "resource_type"),
			summarizeResourceRef(result["resource_ref"]),
			strVal(result, "label"),
		}}
		cli.PrintTable(os.Stdout, headers, rows)
		return nil
	}
	return cli.PrintJSON(os.Stdout, result)
}

func runResourceRemove(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	resourceRef, err := resolveWorkspaceResourceID(ctx, client, args[0])
	if err != nil {
		return fmt.Errorf("resolve resource: %w", err)
	}

	if err := client.DeleteJSON(ctx, "/api/resources/"+resourceRef.ID); err != nil {
		return fmt.Errorf("remove resource: %w", err)
	}

	fmt.Fprintf(os.Stderr, "Resource %s removed from the workspace.\n", resourceRef.Display)
	return nil
}

// fetchWorkspaceResources returns the raw `resources` array from
// GET /api/resources. Shared by list, update (to seed a partial ref edit) and
// the id resolver, which all need the same rows.
func fetchWorkspaceResources(ctx context.Context, client *cli.APIClient) ([]any, error) {
	var result map[string]any
	if err := client.GetJSON(ctx, "/api/resources", &result); err != nil {
		return nil, fmt.Errorf("list resources: %w", err)
	}
	resources, _ := result["resources"].([]any)
	return resources, nil
}

func buildResourceRefFromRefFlag(cmd *cobra.Command, resourceType string, existingRef map[string]any) (any, bool, error) {
	if !cmd.Flags().Changed("ref") {
		return nil, false, nil
	}
	rawRef, _ := cmd.Flags().GetString("ref")
	rawRef = strings.TrimSpace(rawRef)
	// --ref is the generic JSON resource_ref escape hatch. For github_repo it
	// does double duty: a JSON object/array ("{...}" / "[...]") is still the
	// escape hatch, but any other value — including bare scalars like a numeric
	// tag ("2024") or an all-digit short SHA ("1234567") — is a checkout-ref
	// shortcut that merges with --url. Only parse JSON when the value is
	// actually meant as JSON; otherwise json.Unmarshal would accept "2024" as a
	// number and silently swallow a legitimate checkout ref.
	if rawRef != "" && (resourceType != "github_repo" || looksLikeJSONPayload(rawRef)) {
		var ref any
		if err := json.Unmarshal([]byte(rawRef), &ref); err != nil {
			return nil, false, fmt.Errorf("--ref is not valid JSON: %w", err)
		}
		return ref, true, nil
	}
	if resourceType != "github_repo" {
		return nil, false, fmt.Errorf("--ref must be a JSON resource_ref payload for resource type %q", resourceType)
	}
	ref, has, err := buildResourceRefFromFlags(cmd, resourceType, existingRef)
	if err != nil {
		return nil, false, err
	}
	return ref, has, nil
}

func looksLikeJSONPayload(raw string) bool {
	raw = strings.TrimSpace(raw)
	return strings.HasPrefix(raw, "{") || strings.HasPrefix(raw, "[")
}

// buildResourceRefFromFlags collects the per-type shortcut flags into a
// resource_ref payload, seeding from existingRef so partial edits (only
// --default-branch-hint, only --ref-label) preserve the unmentioned fields.
// Returns (ref, true) only when the caller actually set at least one shortcut
// flag — that lets the update command tell "no change requested" apart from
// "change ref to empty object". existingRef may be nil for the `add` path,
// where there is nothing to merge with; in that case partial inputs that miss
// required fields are still rejected.
func buildResourceRefFromFlags(cmd *cobra.Command, resourceType string, existingRef map[string]any) (map[string]any, bool, error) {
	switch resourceType {
	case "github_repo":
		urlSet := cmd.Flags().Changed("url")
		hintSet := cmd.Flags().Changed("default-branch-hint")
		refSet := cmd.Flags().Changed("ref")
		if !urlSet && !hintSet && !refSet {
			return nil, false, nil
		}
		ref := map[string]any{}
		// Seed from the existing row so a `--default-branch-hint` edit doesn't
		// clobber the `url` (server overwrites resource_ref wholesale).
		if existingRef != nil {
			if u, ok := existingRef["url"].(string); ok && strings.TrimSpace(u) != "" {
				ref["url"] = strings.TrimSpace(u)
			}
			if h, ok := existingRef["default_branch_hint"].(string); ok && strings.TrimSpace(h) != "" {
				ref["default_branch_hint"] = strings.TrimSpace(h)
			}
			if checkoutRef, ok := existingRef["ref"].(string); ok && strings.TrimSpace(checkoutRef) != "" {
				ref["ref"] = strings.TrimSpace(checkoutRef)
			}
		}
		if urlSet {
			urlVal, _ := cmd.Flags().GetString("url")
			urlVal = strings.TrimSpace(urlVal)
			if urlVal == "" {
				return nil, false, fmt.Errorf("--url cannot be empty")
			}
			ref["url"] = urlVal
		}
		if hintSet {
			hint := strings.TrimSpace(mustString(cmd, "default-branch-hint"))
			if hint == "" {
				delete(ref, "default_branch_hint")
			} else {
				ref["default_branch_hint"] = hint
			}
		}
		if refSet {
			checkoutRef := strings.TrimSpace(mustString(cmd, "ref"))
			if checkoutRef == "" {
				delete(ref, "ref")
			} else {
				ref["ref"] = checkoutRef
			}
		}
		if _, ok := ref["url"]; !ok {
			return nil, false, fmt.Errorf("github_repo: --url is required (no existing url to merge with)")
		}
		return ref, true, nil
	case "local_directory":
		pathSet := cmd.Flags().Changed("local-path")
		daemonSet := cmd.Flags().Changed("daemon-id")
		labelSet := cmd.Flags().Changed("ref-label")
		modeSet := cmd.Flags().Changed("execution-mode")
		if !pathSet && !daemonSet && !labelSet && !modeSet {
			return nil, false, nil
		}
		ref := map[string]any{}
		if existingRef != nil {
			if p, ok := existingRef["local_path"].(string); ok && strings.TrimSpace(p) != "" {
				ref["local_path"] = strings.TrimSpace(p)
			}
			if d, ok := existingRef["daemon_id"].(string); ok && strings.TrimSpace(d) != "" {
				ref["daemon_id"] = strings.TrimSpace(d)
			}
			if l, ok := existingRef["label"].(string); ok && strings.TrimSpace(l) != "" {
				ref["label"] = strings.TrimSpace(l)
			}
			if m, ok := existingRef["execution_mode"].(string); ok && strings.TrimSpace(m) != "" {
				ref["execution_mode"] = strings.TrimSpace(m)
			}
		}
		if pathSet {
			pathVal := strings.TrimSpace(mustString(cmd, "local-path"))
			if pathVal == "" {
				return nil, false, fmt.Errorf("--local-path cannot be empty")
			}
			ref["local_path"] = pathVal
		}
		if daemonSet {
			daemonVal := strings.TrimSpace(mustString(cmd, "daemon-id"))
			if daemonVal == "" {
				return nil, false, fmt.Errorf("--daemon-id cannot be empty")
			}
			ref["daemon_id"] = daemonVal
		}
		if labelSet {
			refLabel := strings.TrimSpace(mustString(cmd, "ref-label"))
			if refLabel == "" {
				delete(ref, "label")
			} else {
				ref["label"] = refLabel
			}
		}
		if modeSet {
			// An empty value clears the field back to the in_place default,
			// mirroring how --ref-label clears a label.
			mode := strings.TrimSpace(mustString(cmd, "execution-mode"))
			if mode == "" {
				delete(ref, "execution_mode")
			} else {
				ref["execution_mode"] = mode
			}
		}
		if v, ok := ref["local_path"].(string); !ok || v == "" {
			return nil, false, fmt.Errorf("local_directory: --local-path is required (no existing local_path to merge with)")
		}
		if v, ok := ref["daemon_id"].(string); !ok || v == "" {
			return nil, false, fmt.Errorf("local_directory: --daemon-id is required (no existing daemon_id to merge with)")
		}
		return ref, true, nil
	default:
		// Unknown type or empty (resource not found) — caller must use --ref.
		if cmd.Flags().Changed("url") || cmd.Flags().Changed("default-branch-hint") ||
			cmd.Flags().Changed("local-path") || cmd.Flags().Changed("daemon-id") ||
			cmd.Flags().Changed("ref-label") || cmd.Flags().Changed("execution-mode") {
			return nil, false, fmt.Errorf("no built-in shortcut for resource type %q; pass the full payload via --ref '<json>'", resourceType)
		}
		return nil, false, nil
	}
}

func mustString(cmd *cobra.Command, name string) string {
	v, _ := cmd.Flags().GetString(name)
	return v
}

// summarizeResourceRef extracts the most useful single string from a
// resource_ref object — for github_repo this is the URL; for
// local_directory it is the local path.
func summarizeResourceRef(raw any) string {
	m, ok := raw.(map[string]any)
	if !ok {
		return ""
	}
	if u, ok := m["url"].(string); ok && u != "" {
		if ref, ok := m["ref"].(string); ok && strings.TrimSpace(ref) != "" {
			return u + " @ " + strings.TrimSpace(ref)
		}
		return u
	}
	if p, ok := m["local_path"].(string); ok && p != "" {
		return p
	}
	if data, err := json.Marshal(m); err == nil {
		return string(data)
	}
	return ""
}
