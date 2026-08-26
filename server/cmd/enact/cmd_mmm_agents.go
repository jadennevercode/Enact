package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/cli"
	"github.com/enact-ai/enact/server/internal/mmm"
)

var mmmAgentCmd = &cobra.Command{
	Use:   "agent",
	Short: "Manage the MMM agent portfolio in the current workspace",
}

var mmmAgentBootstrapCmd = &cobra.Command{
	Use:   "bootstrap",
	Short: "Create the four-role MMM agent portfolio in the current workspace",
	Long: `Applies the versioned MMM agent portfolio to the current workspace:

  1. imports the mmm:* plugin skills (unless --skip-import)
  2. creates the four role agents — MMM Orchestrator, MMM Business Analyst,
     MMM Data Scientist, MMM Metadata Manager — public to the workspace, each with
     its role instructions and skill bindings
  3. creates the "MMM Delivery" squad led by MMM Orchestrator
  4. creates the scheduled daily-report autopilot assigned to MMM Metadata Manager
     (unless --skip-autopilot)

Re-running is safe: existing agents, the squad, and the autopilot are kept
as-is so local customizations survive; pass --force to overwrite the agents'
description, instructions, and skill bindings with the manifest versions.
Env vars are outside --force's reach — the update endpoint refuses them by
design, so a MMM_ENGINE_INTERPRETER that was missing at create time has to be
set with "enact agent env set".

Model and thinking level are never set — agents follow the runtime defaults
of this deployment. Run once per workspace; every engagement project in the
workspace is served by the same portfolio.`,
	Args: cobra.NoArgs,
	RunE: runMMMAgentBootstrap,
}

var mmmVerifyCmd = &cobra.Command{
	Use:   "verify",
	Short: "Verify the MMM wiring of the current workspace",
	Long: `Checks the server-side MMM deployment wiring in one pass.

Required (a FAIL here exits non-zero):
  - the selected runtime is online
  - every mmm:* skill imported into the workspace
  - all four agents bound to that runtime with the manifest skill/concurrency settings
  - the "MMM Delivery" squad with the expected leader and members
  - the active daily-report autopilot with the expected schedule

Machine-level health (Python engine, Node deps, Claude Code plugin) is the
doctor step of "enact mmm setup", not this command.`,
	Args: cobra.NoArgs,
	RunE: runMMMVerify,
}

// registerMMMAgentBootstrapFlags installs the bootstrap flags on cmd so tests
// can build an isolated command carrying the same flag set.
func registerMMMAgentBootstrapFlags(c *cobra.Command) {
	defaults := mmm.DefaultAgentManifest().Autopilot
	c.Flags().String("runtime-id", "", "Runtime to bind the agents to (default: this machine's online runtime)")
	c.Flags().Bool("force", false, "Overwrite existing portfolio agents' description, instructions, and skill bindings with the manifest versions")
	c.Flags().Bool("skip-import", false, "Skip importing mmm:* skills before binding")
	c.Flags().Bool("skip-autopilot", false, "Skip creating the daily-report autopilot")
	c.Flags().String("cron", defaults.DefaultCron, "Cron expression for the daily-report autopilot trigger")
	c.Flags().String("timezone", defaults.DefaultTimezone, "IANA timezone for the daily-report autopilot trigger")
}

func init() {
	registerMMMAgentBootstrapFlags(mmmAgentBootstrapCmd)
	mmmVerifyCmd.Flags().String("runtime-id", "", "Runtime that must be online and bound to all MMM agents")
	mmmAgentCmd.AddCommand(mmmAgentBootstrapCmd)
	mmmCmd.AddCommand(mmmAgentCmd)
	mmmCmd.AddCommand(mmmVerifyCmd)
}

func runMMMAgentBootstrap(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	if _, err := requireWorkspaceID(cmd); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*localSkillPollTimeout)
	defer cancel()

	runtimeID, _ := cmd.Flags().GetString("runtime-id")
	if runtimeID == "" {
		runtimeID, err = resolveLocalOnlineRuntime(ctx, client, cmd)
		if err != nil {
			// The shared resolver's guidance is written for skill import,
			// which has no runtime flag; bootstrap does.
			return fmt.Errorf("%w (or pass --runtime-id to choose explicitly)", err)
		}
	}

	if skip, _ := cmd.Flags().GetBool("skip-import"); !skip {
		// Recoverable: claude runtimes load plugin skills natively, so a
		// failed import only reduces UI visibility — bindings below cover
		// whatever is already in the workspace.
		if err := importAllMMMSkills(ctx, client, runtimeID); err != nil {
			fmt.Fprintf(os.Stderr, "warning: skill import failed: %v\n", err)
			fmt.Fprintln(os.Stderr, "         continuing — skill bindings will cover only already-imported skills")
		}
	}

	skillIDs, err := fetchMMMSkillIDsByName(ctx, client)
	if err != nil {
		return err
	}

	manifest := mmm.DefaultAgentManifest()
	force, _ := cmd.Flags().GetBool("force")

	fmt.Fprintf(os.Stderr, "\n==> Ensuring MMM agent portfolio (runtime %s)\n", runtimeID)
	agentIDs, err := ensurePortfolioAgents(ctx, client, manifest, runtimeID, skillIDs, force)
	if err != nil {
		return err
	}

	fmt.Fprintf(os.Stderr, "\n==> Ensuring squad %q\n", manifest.Squad.Name)
	if err := ensurePortfolioSquad(ctx, client, manifest.Squad, agentIDs); err != nil {
		return err
	}

	if skip, _ := cmd.Flags().GetBool("skip-autopilot"); !skip {
		cron, _ := cmd.Flags().GetString("cron")
		timezone, _ := cmd.Flags().GetString("timezone")
		fmt.Fprintf(os.Stderr, "\n==> Ensuring autopilot %q\n", manifest.Autopilot.Title)
		if err := ensureDailyReportAutopilot(ctx, client, manifest.Autopilot, agentIDs, cron, timezone); err != nil {
			return err
		}
	}

	fmt.Fprintln(os.Stderr, "\nBootstrap complete. Run `enact mmm verify` to check the full wiring.")
	return nil
}

// fetchMMMSkillIDsByName maps workspace skill names to IDs for every mmm:*
// skill currently in the workspace.
func fetchMMMSkillIDsByName(ctx context.Context, client *cli.APIClient) (map[string]string, error) {
	var skills []map[string]any
	if err := client.GetJSON(ctx, "/api/skills", &skills); err != nil {
		return nil, fmt.Errorf("list workspace skills: %w", err)
	}
	ids := make(map[string]string)
	for _, s := range skills {
		if name := strVal(s, "name"); strings.HasPrefix(name, mmmSkillPrefix) {
			ids[name] = strVal(s, "id")
		}
	}
	return ids, nil
}

// ensurePortfolioAgents creates every manifest agent that does not exist yet
// and returns the name→ID map for the whole portfolio. Existing agents are
// kept untouched (their runtime binding is restored when unbound) unless
// force is set, which pushes the manifest description, instructions, and
// skill bindings over them.
func ensurePortfolioAgents(ctx context.Context, client *cli.APIClient, manifest mmm.AgentManifest, runtimeID string, skillIDs map[string]string, force bool) (map[string]string, error) {
	var agents []map[string]any
	path := "/api/agents?" + url.Values{"workspace_id": {client.WorkspaceID}}.Encode()
	if err := client.GetJSON(ctx, path, &agents); err != nil {
		return nil, fmt.Errorf("list agents: %w", err)
	}
	existing := make(map[string]map[string]any, len(agents))
	for _, a := range agents {
		existing[strVal(a, "name")] = a
	}

	engineEnv := detectEngineEnv()
	ids := make(map[string]string, len(manifest.Agents))
	for _, spec := range manifest.Agents {
		if current, ok := existing[spec.Name]; ok {
			id := strVal(current, "id")
			ids[spec.Name] = id
			if force {
				body := map[string]any{
					"description":          spec.Description,
					"instructions":         spec.Instructions,
					"runtime_id":           runtimeID,
					"max_concurrent_tasks": spec.MaxConcurrentTasks,
				}
				var updated map[string]any
				if err := client.PutJSON(ctx, "/api/agents/"+id, body, &updated); err != nil {
					return nil, fmt.Errorf("update agent %s: %w", spec.Name, err)
				}
				rebindPortfolioAgentSkills(ctx, client, id, spec, skillIDs)
				fmt.Fprintf(os.Stderr, "  %-20s updated to the manifest version\n", spec.Name)
			} else {
				// An unbound agent (its runtime was deleted) refuses every
				// trigger path; restore the binding so it can run again.
				if strVal(current, "runtime_id") == "" {
					var updated map[string]any
					if err := client.PutJSON(ctx, "/api/agents/"+id, map[string]any{"runtime_id": runtimeID}, &updated); err != nil {
						return nil, fmt.Errorf("rebind agent %s to runtime: %w", spec.Name, err)
					}
					fmt.Fprintf(os.Stderr, "  %-20s kept — rebound to runtime %s\n", spec.Name, runtimeID)
				} else {
					fmt.Fprintf(os.Stderr, "  %-20s kept (--force overwrites with the manifest version)\n", spec.Name)
				}
			}
			continue
		}

		body := map[string]any{
			"name":                 spec.Name,
			"runtime_id":           runtimeID,
			"description":          spec.Description,
			"instructions":         spec.Instructions,
			"permission_mode":      "public_to",
			"invocation_targets":   []map[string]any{{"target_type": "workspace"}},
			"max_concurrent_tasks": spec.MaxConcurrentTasks,
		}
		// skill_ids on create binds inside the same transaction as the agent
		// row, so a create never lands as a half-configured agent.
		resolved, missing := resolveSpecSkillIDs(spec, skillIDs)
		if len(missing) > 0 {
			warnMissingSkills(spec.Name, missing)
		}
		if len(resolved) > 0 {
			body["skill_ids"] = resolved
		}
		if spec.EngineEnv && len(engineEnv) > 0 {
			body["custom_env"] = engineEnv
		}
		var created map[string]any
		if err := client.PostJSON(ctx, "/api/agents", body, &created); err != nil {
			return nil, fmt.Errorf("create agent %s: %w", spec.Name, err)
		}
		ids[spec.Name] = strVal(created, "id")
		fmt.Fprintf(os.Stderr, "  %-20s created\n", spec.Name)
	}
	return ids, nil
}

// resolveSpecSkillIDs maps a spec's skill names to workspace skill IDs,
// reporting the names that are not in the workspace.
func resolveSpecSkillIDs(spec mmm.AgentSpec, skillIDs map[string]string) (resolved, missing []string) {
	resolved = make([]string, 0, len(spec.SkillNames))
	for _, name := range spec.SkillNames {
		if id, ok := skillIDs[name]; ok {
			resolved = append(resolved, id)
		} else {
			missing = append(missing, name)
		}
	}
	return resolved, missing
}

func warnMissingSkills(agentName string, missing []string) {
	fmt.Fprintf(os.Stderr, "  %-20s warning: skills not in workspace, skipped binding: %s\n", agentName, strings.Join(missing, ", "))
}

// rebindPortfolioAgentSkills replaces an existing agent's skill bindings with
// the manifest set. Binding is UI-visibility sugar (claude runtimes load
// plugin skills natively), so failures degrade to warnings instead of
// aborting the whole bootstrap.
func rebindPortfolioAgentSkills(ctx context.Context, client *cli.APIClient, agentID string, spec mmm.AgentSpec, skillIDs map[string]string) {
	resolved, missing := resolveSpecSkillIDs(spec, skillIDs)
	if len(missing) > 0 {
		warnMissingSkills(spec.Name, missing)
	}
	if len(resolved) == 0 {
		return
	}
	body := map[string]any{"skill_ids": resolved}
	var result map[string]any
	if err := client.PutJSON(ctx, "/api/agents/"+agentID+"/skills", body, &result); err != nil {
		fmt.Fprintf(os.Stderr, "  %-20s warning: bind skills failed: %v\n", spec.Name, err)
	}
}

// detectEngineEnv returns the MMM engine env for agents provisioned from this
// machine. Meaningful only when the agents' daemon host is the machine running
// bootstrap — which is the documented flow (bootstrap runs on the workmachine
// after `enact mmm setup`). Missing config or venv simply yields no env.
func detectEngineEnv() map[string]string {
	cfg, err := mmm.LoadConfig(os.UserHomeDir)
	if err != nil || strings.TrimSpace(cfg.RuntimeDir) == "" {
		return nil
	}
	for _, rel := range []string{
		filepath.Join(".venv", "bin", "python"),
		filepath.Join(".venv", "Scripts", "python.exe"),
	} {
		p := filepath.Join(cfg.RuntimeDir, rel)
		if _, statErr := os.Stat(p); statErr == nil {
			return map[string]string{"MMM_ENGINE_INTERPRETER": p}
		}
	}
	return nil
}

// ensurePortfolioSquad creates the delivery squad when absent and adds every
// portfolio agent that is not yet a member.
func ensurePortfolioSquad(ctx context.Context, client *cli.APIClient, spec mmm.SquadSpec, agentIDs map[string]string) error {
	var squads []map[string]any
	if err := client.GetJSON(ctx, "/api/squads", &squads); err != nil {
		return fmt.Errorf("list squads: %w", err)
	}
	squadID := ""
	for _, s := range squads {
		if strVal(s, "name") == spec.Name {
			squadID = strVal(s, "id")
			break
		}
	}

	if squadID == "" {
		leaderID := agentIDs[spec.LeaderName]
		if leaderID == "" {
			return fmt.Errorf("squad leader agent %s has no ID", spec.LeaderName)
		}
		body := map[string]any{
			"name":        spec.Name,
			"description": spec.Description,
			"leader_id":   leaderID,
		}
		var created map[string]any
		if err := client.PostJSON(ctx, "/api/squads", body, &created); err != nil {
			return fmt.Errorf("create squad: %w", err)
		}
		squadID = strVal(created, "id")
		fmt.Fprintf(os.Stderr, "  squad created (leader %s)\n", spec.LeaderName)
	} else {
		fmt.Fprintln(os.Stderr, "  squad exists — kept")
	}

	var members []map[string]any
	if err := client.GetJSON(ctx, "/api/squads/"+squadID+"/members", &members); err != nil {
		return fmt.Errorf("list squad members: %w", err)
	}
	present := make(map[string]bool, len(members))
	for _, m := range members {
		if strVal(m, "member_type") == "agent" {
			present[strVal(m, "member_id")] = true
		}
	}
	for _, name := range spec.MemberNames {
		id := agentIDs[name]
		if id == "" || present[id] {
			continue
		}
		body := map[string]any{"member_type": "agent", "member_id": id, "role": "member"}
		var result map[string]any
		if err := client.PostJSON(ctx, "/api/squads/"+squadID+"/members", body, &result); err != nil {
			// One member failing to join does not invalidate the rest of the
			// portfolio; report it and let the operator re-run or add by hand.
			fmt.Fprintf(os.Stderr, "  warning: add %s to squad failed: %v\n", name, err)
			continue
		}
		fmt.Fprintf(os.Stderr, "  member %s added\n", name)
	}
	return nil
}

// ensureDailyReportAutopilot creates the scheduled daily-report autopilot when
// absent and guarantees it has at least one schedule trigger.
func ensureDailyReportAutopilot(ctx context.Context, client *cli.APIClient, spec mmm.AutopilotSpec, agentIDs map[string]string, cron, timezone string) error {
	var listResp struct {
		Autopilots []map[string]any `json:"autopilots"`
	}
	if err := client.GetJSON(ctx, "/api/autopilots", &listResp); err != nil {
		return fmt.Errorf("list autopilots: %w", err)
	}
	autopilotID := ""
	for _, a := range listResp.Autopilots {
		if strVal(a, "title") == spec.Title {
			autopilotID = strVal(a, "id")
			break
		}
	}

	if autopilotID == "" {
		assigneeID := agentIDs[spec.AssigneeName]
		if assigneeID == "" {
			return fmt.Errorf("autopilot assignee agent %s has no ID", spec.AssigneeName)
		}
		body := map[string]any{
			"title":                spec.Title,
			"description":          spec.Description,
			"assignee_id":          assigneeID,
			"execution_mode":       "create_issue",
			"issue_title_template": spec.IssueTitleTemplate,
		}
		var created map[string]any
		if err := client.PostJSON(ctx, "/api/autopilots", body, &created); err != nil {
			return fmt.Errorf("create autopilot: %w", err)
		}
		autopilotID = strVal(created, "id")
		fmt.Fprintf(os.Stderr, "  autopilot created (assignee %s)\n", spec.AssigneeName)
	} else {
		fmt.Fprintln(os.Stderr, "  autopilot exists — kept")
	}

	var detail map[string]any
	if err := client.GetJSON(ctx, "/api/autopilots/"+autopilotID, &detail); err != nil {
		return fmt.Errorf("get autopilot: %w", err)
	}
	if hasScheduleTrigger(detail) {
		fmt.Fprintln(os.Stderr, "  schedule trigger exists — kept")
		return nil
	}
	body := map[string]any{
		"kind":            "schedule",
		"cron_expression": cron,
		"timezone":        timezone,
		"label":           "daily report",
	}
	var trigger map[string]any
	if err := client.PostJSON(ctx, "/api/autopilots/"+autopilotID+"/triggers", body, &trigger); err != nil {
		return fmt.Errorf("create schedule trigger: %w", err)
	}
	fmt.Fprintf(os.Stderr, "  schedule trigger created (%s %s)\n", cron, timezone)
	return nil
}

// hasScheduleTrigger reports whether an autopilot detail response carries at
// least one schedule trigger.
func hasScheduleTrigger(detail map[string]any) bool {
	triggers, _ := detail["triggers"].([]any)
	for _, t := range triggers {
		if m, ok := t.(map[string]any); ok && strVal(m, "kind") == "schedule" {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

// verifyReporter prints one check line per result and counts the required
// ones that failed. "FAIL" marks a required check; "warn" marks an advisory
// one that never changes the exit code.
type verifyReporter struct {
	failures int
}

func (r *verifyReporter) ok(check, detail string)   { r.line("ok", check, detail) }
func (r *verifyReporter) warn(check, detail string) { r.line("warn", check, detail) }
func (r *verifyReporter) fail(check, detail string) {
	r.failures++
	r.line("FAIL", check, detail)
}

func (r *verifyReporter) line(status, check, detail string) {
	fmt.Fprintf(os.Stderr, "  %-4s %-12s %s\n", status, check, detail)
}

func runMMMVerify(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	if _, err := requireWorkspaceID(cmd); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), cli.AtLeastAPITimeout(60*time.Second))
	defer cancel()

	manifest := mmm.DefaultAgentManifest()
	rep := &verifyReporter{}
	runtimeID, _ := cmd.Flags().GetString("runtime-id")
	if runtimeID == "" {
		return fmt.Errorf("--runtime-id is required")
	}

	fmt.Fprintln(os.Stderr, "==> Verifying MMM workspace wiring")

	if err := verifyRuntime(ctx, client, runtimeID, rep); err != nil {
		return err
	}
	if err := verifySkills(ctx, client, manifest, rep); err != nil {
		return err
	}
	if err := verifyAgents(ctx, client, manifest, runtimeID, rep); err != nil {
		return err
	}
	if err := verifySquad(ctx, client, manifest, rep); err != nil {
		return err
	}
	if err := verifyAutopilot(ctx, client, manifest, rep); err != nil {
		return err
	}

	if rep.failures > 0 {
		return fmt.Errorf("%d required check(s) failed", rep.failures)
	}
	fmt.Fprintln(os.Stderr, "\nAll required checks passed. Machine-level health (engine, plugin) is `enact mmm setup`'s doctor step.")
	return nil
}

// verifyRuntime requires at least one online runtime to claim agent tasks.
func verifyRuntime(ctx context.Context, client *cli.APIClient, runtimeID string, rep *verifyReporter) error {
	var runtimes []map[string]any
	if err := client.GetJSON(ctx, "/api/runtimes", &runtimes); err != nil {
		return fmt.Errorf("list runtimes: %w", err)
	}
	for _, rt := range runtimes {
		if strVal(rt, "id") != runtimeID {
			continue
		}
		if strVal(rt, "status") != "online" {
			rep.fail("runtime", fmt.Sprintf("%s is %s", runtimeID, strVal(rt, "status")))
			return nil
		}
		rep.ok("runtime", runtimeID+" online")
		return nil
	}
	rep.fail("runtime", runtimeID+" not found")
	return nil
}

// verifySkills requires every runtime skill to be imported into the workspace.
func verifySkills(ctx context.Context, client *cli.APIClient, _ mmm.AgentManifest, rep *verifyReporter) error {
	skillIDs, err := fetchMMMSkillIDsByName(ctx, client)
	if err != nil {
		return err
	}
	var missing []string
	for _, name := range mmm.RuntimeSkillNames {
		if _, ok := skillIDs[name]; !ok {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		rep.fail("skills", fmt.Sprintf("missing %s — run `enact mmm agent bootstrap`", strings.Join(missing, ", ")))
		return nil
	}
	rep.ok("skills", fmt.Sprintf("%d/%d mmm:* skills imported", len(mmm.RuntimeSkillNames), len(mmm.RuntimeSkillNames)))
	return nil
}

// verifyAgents requires every portfolio agent to exist and be runtime-bound.
// Skill bindings are advisory: claude runtimes load plugin skills natively, so
// a missing binding costs UI visibility, not the ability to run.
func verifyAgents(ctx context.Context, client *cli.APIClient, manifest mmm.AgentManifest, runtimeID string, rep *verifyReporter) error {
	var agents []map[string]any
	path := "/api/agents?" + url.Values{"workspace_id": {client.WorkspaceID}}.Encode()
	if err := client.GetJSON(ctx, path, &agents); err != nil {
		return fmt.Errorf("list agents: %w", err)
	}
	byName := make(map[string]map[string]any, len(agents))
	for _, a := range agents {
		byName[strVal(a, "name")] = a
	}

	for _, spec := range manifest.Agents {
		current, ok := byName[spec.Name]
		if !ok {
			rep.fail("agent", spec.Name+" missing — run `enact mmm agent bootstrap`")
			continue
		}
		if got := strVal(current, "runtime_id"); got != runtimeID {
			rep.fail("agent", fmt.Sprintf("%s runtime %q, want %q", spec.Name, got, runtimeID))
			continue
		}
		if got := intVal(current, "max_concurrent_tasks"); got != spec.MaxConcurrentTasks {
			rep.fail("agent", fmt.Sprintf("%s concurrency %d, want %d", spec.Name, got, spec.MaxConcurrentTasks))
			continue
		}

		var bound []map[string]any
		if err := client.GetJSON(ctx, "/api/agents/"+strVal(current, "id")+"/skills", &bound); err != nil {
			rep.warn("skills", spec.Name+": could not list bindings: "+err.Error())
			continue
		}
		boundNames := make(map[string]bool, len(bound))
		for _, s := range bound {
			boundNames[strVal(s, "name")] = true
		}
		var unbound []string
		for _, name := range spec.SkillNames {
			if !boundNames[name] {
				unbound = append(unbound, name)
			}
		}
		if len(unbound) > 0 {
			rep.fail("skills", spec.Name+" not bound to "+strings.Join(unbound, ", "))
			continue
		}
		rep.ok("agent", spec.Name)
	}
	return nil
}

// verifySquad requires the delivery squad, which bootstrap always creates —
// its absence means bootstrap never ran or failed partway.
func verifySquad(ctx context.Context, client *cli.APIClient, manifest mmm.AgentManifest, rep *verifyReporter) error {
	var squads []map[string]any
	if err := client.GetJSON(ctx, "/api/squads", &squads); err != nil {
		return fmt.Errorf("list squads: %w", err)
	}
	for _, s := range squads {
		if strVal(s, "name") == manifest.Squad.Name {
			if strVal(s, "leader_id") == "" {
				rep.fail("squad", manifest.Squad.Name+" has no leader")
				return nil
			}
			var members []map[string]any
			if err := client.GetJSON(ctx, "/api/squads/"+strVal(s, "id")+"/members", &members); err != nil {
				return fmt.Errorf("list squad members: %w", err)
			}
			if len(members) < len(manifest.Squad.MemberNames) {
				rep.fail("squad", fmt.Sprintf("%s has %d members, want %d", manifest.Squad.Name, len(members), len(manifest.Squad.MemberNames)))
				return nil
			}
			rep.ok("squad", fmt.Sprintf("%s (%d members)", manifest.Squad.Name, len(members)))
			return nil
		}
	}
	rep.fail("squad", manifest.Squad.Name+" missing — run `enact mmm agent bootstrap`")
	return nil
}

// verifyAutopilot requires the production daily-report automation.
func verifyAutopilot(ctx context.Context, client *cli.APIClient, manifest mmm.AgentManifest, rep *verifyReporter) error {
	var resp struct {
		Autopilots []map[string]any `json:"autopilots"`
	}
	if err := client.GetJSON(ctx, "/api/autopilots", &resp); err != nil {
		return fmt.Errorf("list autopilots: %w", err)
	}
	id, status := "", ""
	for _, a := range resp.Autopilots {
		if strVal(a, "title") == manifest.Autopilot.Title {
			id = strVal(a, "id")
			status = strVal(a, "status")
			break
		}
	}
	switch {
	case id == "":
		rep.fail("autopilot", manifest.Autopilot.Title+" missing — run `enact mmm agent bootstrap`")
	case status != "active":
		rep.fail("autopilot", fmt.Sprintf("%s is %s", manifest.Autopilot.Title, status))
	default:
		var detail map[string]any
		if err := client.GetJSON(ctx, "/api/autopilots/"+id, &detail); err != nil {
			return fmt.Errorf("read autopilot triggers: %w", err)
		}
		if !hasExpectedScheduleTrigger(detail, manifest.Autopilot.DefaultCron, manifest.Autopilot.DefaultTimezone) {
			rep.fail("autopilot", fmt.Sprintf("%s schedule must be %s %s", manifest.Autopilot.Title, manifest.Autopilot.DefaultCron, manifest.Autopilot.DefaultTimezone))
			return nil
		}
		rep.ok("autopilot", manifest.Autopilot.Title)
	}
	return nil
}

func hasExpectedScheduleTrigger(detail map[string]any, cron, timezone string) bool {
	triggers, _ := detail["triggers"].([]any)
	for _, raw := range triggers {
		trigger, ok := raw.(map[string]any)
		if ok && strVal(trigger, "kind") == "schedule" && strVal(trigger, "cron_expression") == cron && strVal(trigger, "timezone") == timezone {
			return true
		}
	}
	return false
}

func intVal(m map[string]any, key string) int {
	if value, ok := m[key].(float64); ok {
		return int(value)
	}
	if value, ok := m[key].(int); ok {
		return value
	}
	return 0
}
