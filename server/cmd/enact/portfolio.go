package main

// Applying an agent portfolio to a workspace, and checking that it is still
// applied. Both MMM and Ontologizer provision the same server objects from the
// same shapes; this is the one implementation, parameterised by the manifest.
//
// Every routine here is idempotent by construction, because the operator runs
// them again after every runtime change and after every upgrade. "Kept" is the
// default outcome, so local customization survives a re-run; --force is the
// only path that overwrites what someone edited in the UI.

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/enact-ai/enact/server/internal/cli"
	"github.com/enact-ai/enact/server/internal/portfolio"
)

// portfolioEnvFn supplies the environment an integration's agents need. It is
// consulted only when creating an agent: the update endpoint refuses env by
// design, so a value that was missing at create time has to be set with
// `enact agent env set`.
type portfolioEnvFn func() map[string]string

// fetchPortfolioSkillIDs maps workspace skill names to IDs for every skill in
// the manifest's plugin namespace.
func fetchPortfolioSkillIDs(ctx context.Context, client *cli.APIClient, manifest portfolio.Manifest) (map[string]string, error) {
	var skills []map[string]any
	if err := client.GetJSON(ctx, "/api/skills", &skills); err != nil {
		return nil, fmt.Errorf("list workspace skills: %w", err)
	}
	ids := make(map[string]string)
	for _, s := range skills {
		if name := strVal(s, "name"); strings.HasPrefix(name, manifest.SkillPrefix) {
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
func ensurePortfolioAgents(
	ctx context.Context,
	client *cli.APIClient,
	manifest portfolio.Manifest,
	runtimeID string,
	skillIDs map[string]string,
	force bool,
	envFn portfolioEnvFn,
) (map[string]string, error) {
	var agents []map[string]any
	path := "/api/agents?" + url.Values{"workspace_id": {client.WorkspaceID}}.Encode()
	if err := client.GetJSON(ctx, path, &agents); err != nil {
		return nil, fmt.Errorf("list agents: %w", err)
	}
	existing := make(map[string]map[string]any, len(agents))
	for _, a := range agents {
		existing[strVal(a, "name")] = a
	}

	var runtimeEnv map[string]string
	if envFn != nil {
		runtimeEnv = envFn()
	}
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
				fmt.Fprintf(os.Stderr, "  %-26s updated to the manifest version\n", spec.Name)
			} else {
				// An unbound agent (its runtime was deleted) refuses every
				// trigger path; restore the binding so it can run again.
				if strVal(current, "runtime_id") == "" {
					var updated map[string]any
					if err := client.PutJSON(ctx, "/api/agents/"+id, map[string]any{"runtime_id": runtimeID}, &updated); err != nil {
						return nil, fmt.Errorf("rebind agent %s to runtime: %w", spec.Name, err)
					}
					fmt.Fprintf(os.Stderr, "  %-26s kept — rebound to runtime %s\n", spec.Name, runtimeID)
				} else {
					fmt.Fprintf(os.Stderr, "  %-26s kept (--force overwrites with the manifest version)\n", spec.Name)
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
		if spec.NeedsRuntimeEnv && len(runtimeEnv) > 0 {
			body["custom_env"] = runtimeEnv
		}
		var created map[string]any
		if err := client.PostJSON(ctx, "/api/agents", body, &created); err != nil {
			return nil, fmt.Errorf("create agent %s: %w", spec.Name, err)
		}
		ids[spec.Name] = strVal(created, "id")
		fmt.Fprintf(os.Stderr, "  %-26s created\n", spec.Name)
	}
	return ids, nil
}

// resolveSpecSkillIDs maps a spec's skill names to workspace skill IDs,
// reporting the names that are not in the workspace.
func resolveSpecSkillIDs(spec portfolio.AgentSpec, skillIDs map[string]string) (resolved, missing []string) {
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
	fmt.Fprintf(os.Stderr, "  %-26s warning: skills not in workspace, skipped binding: %s\n", agentName, strings.Join(missing, ", "))
}

// rebindPortfolioAgentSkills replaces an existing agent's skill bindings with
// the manifest set. Binding is UI-visibility sugar (claude runtimes load
// plugin skills natively), so failures degrade to warnings instead of
// aborting the whole bootstrap.
func rebindPortfolioAgentSkills(ctx context.Context, client *cli.APIClient, agentID string, spec portfolio.AgentSpec, skillIDs map[string]string) {
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
		fmt.Fprintf(os.Stderr, "  %-26s warning: bind skills failed: %v\n", spec.Name, err)
	}
}

// ensurePortfolioSquad creates the delivery squad when absent and adds every
// portfolio agent that is not yet a member. Squad instructions are written on
// create, and on --force, because they carry the leader's routing rules and a
// stale routing table sends work to the wrong member.
func ensurePortfolioSquad(
	ctx context.Context,
	client *cli.APIClient,
	spec portfolio.SquadSpec,
	agentIDs map[string]string,
	force bool,
) error {
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

	created := squadID == ""
	if created {
		leaderID := agentIDs[spec.LeaderName]
		if leaderID == "" {
			return fmt.Errorf("squad leader agent %s has no ID", spec.LeaderName)
		}
		body := map[string]any{
			"name":        spec.Name,
			"description": spec.Description,
			"leader_id":   leaderID,
		}
		var result map[string]any
		if err := client.PostJSON(ctx, "/api/squads", body, &result); err != nil {
			return fmt.Errorf("create squad: %w", err)
		}
		squadID = strVal(result, "id")
		fmt.Fprintf(os.Stderr, "  squad created (leader %s)\n", spec.LeaderName)
	} else {
		fmt.Fprintln(os.Stderr, "  squad exists — kept")
	}

	// The create endpoint takes no instructions; they are a separate update.
	if spec.Instructions != "" && (created || force) {
		var updated map[string]any
		if err := client.PutJSON(ctx, "/api/squads/"+squadID, map[string]any{"instructions": spec.Instructions}, &updated); err != nil {
			fmt.Fprintf(os.Stderr, "  warning: set squad instructions failed: %v\n", err)
		} else {
			fmt.Fprintln(os.Stderr, "  squad instructions written")
		}
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

// ensurePortfolioAutopilot creates the scheduled automation when absent and
// guarantees it has at least one schedule trigger.
func ensurePortfolioAutopilot(
	ctx context.Context,
	client *cli.APIClient,
	spec portfolio.AutopilotSpec,
	agentIDs map[string]string,
	cron, timezone string,
) error {
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
		"label":           "scheduled",
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

// bootstrapPortfolio runs the whole apply sequence for one manifest.
func bootstrapPortfolio(
	ctx context.Context,
	client *cli.APIClient,
	manifest portfolio.Manifest,
	opts portfolioBootstrapOptions,
) error {
	if !opts.SkipImport {
		// Recoverable: claude runtimes load plugin skills natively, so a
		// failed import only reduces UI visibility — bindings below cover
		// whatever is already in the workspace.
		if err := importPluginSkills(ctx, client, opts.RuntimeID, manifest); err != nil {
			fmt.Fprintf(os.Stderr, "warning: skill import failed: %v\n", err)
			fmt.Fprintln(os.Stderr, "         continuing — skill bindings will cover only already-imported skills")
		}
	}

	skillIDs, err := fetchPortfolioSkillIDs(ctx, client, manifest)
	if err != nil {
		return err
	}

	fmt.Fprintf(os.Stderr, "\n==> Ensuring agent portfolio (runtime %s)\n", opts.RuntimeID)
	agentIDs, err := ensurePortfolioAgents(ctx, client, manifest, opts.RuntimeID, skillIDs, opts.Force, opts.EnvFn)
	if err != nil {
		return err
	}

	fmt.Fprintf(os.Stderr, "\n==> Ensuring squad %q\n", manifest.Squad.Name)
	if err := ensurePortfolioSquad(ctx, client, manifest.Squad, agentIDs, opts.Force); err != nil {
		return err
	}

	if manifest.HasAutopilot() && !opts.SkipAutopilot {
		fmt.Fprintf(os.Stderr, "\n==> Ensuring autopilot %q\n", manifest.Autopilot.Title)
		if err := ensurePortfolioAutopilot(ctx, client, manifest.Autopilot, agentIDs, opts.Cron, opts.Timezone); err != nil {
			return err
		}
	}
	return nil
}

type portfolioBootstrapOptions struct {
	RuntimeID     string
	Force         bool
	SkipImport    bool
	SkipAutopilot bool
	Cron          string
	Timezone      string
	EnvFn         portfolioEnvFn
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

// verifyPortfolio checks runtime, skills, agents, squad, and (when the
// manifest has one) the autopilot, returning the number of required checks
// that failed.
func verifyPortfolio(ctx context.Context, client *cli.APIClient, manifest portfolio.Manifest, runtimeID string) (int, error) {
	rep := &verifyReporter{}
	if err := verifyRuntime(ctx, client, runtimeID, rep); err != nil {
		return 0, err
	}
	if err := verifyPortfolioSkills(ctx, client, manifest, rep); err != nil {
		return 0, err
	}
	if err := verifyPortfolioAgents(ctx, client, manifest, runtimeID, rep); err != nil {
		return 0, err
	}
	if err := verifyPortfolioSquad(ctx, client, manifest, rep); err != nil {
		return 0, err
	}
	if manifest.HasAutopilot() {
		if err := verifyPortfolioAutopilot(ctx, client, manifest, rep); err != nil {
			return 0, err
		}
	}
	return rep.failures, nil
}

// verifyRuntime requires the named runtime to be online to claim agent tasks.
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

// verifyPortfolioSkills requires every plugin skill to be imported into the
// workspace.
func verifyPortfolioSkills(ctx context.Context, client *cli.APIClient, manifest portfolio.Manifest, rep *verifyReporter) error {
	skillIDs, err := fetchPortfolioSkillIDs(ctx, client, manifest)
	if err != nil {
		return err
	}
	var missing []string
	for _, name := range manifest.RuntimeSkillNames {
		if _, ok := skillIDs[name]; !ok {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		rep.fail("skills", fmt.Sprintf("missing %s — run `%s`", strings.Join(missing, ", "), manifest.BootstrapCommand))
		return nil
	}
	rep.ok("skills", fmt.Sprintf("%d/%d %s* skills imported",
		len(manifest.RuntimeSkillNames), len(manifest.RuntimeSkillNames), manifest.SkillPrefix))
	return nil
}

// verifyPortfolioAgents requires every portfolio agent to exist and be
// runtime-bound with the manifest's concurrency and skill bindings.
func verifyPortfolioAgents(ctx context.Context, client *cli.APIClient, manifest portfolio.Manifest, runtimeID string, rep *verifyReporter) error {
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
			rep.fail("agent", spec.Name+" missing — run `"+manifest.BootstrapCommand+"`")
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

// verifyPortfolioSquad requires the squad, which bootstrap always creates —
// its absence means bootstrap never ran or failed partway.
func verifyPortfolioSquad(ctx context.Context, client *cli.APIClient, manifest portfolio.Manifest, rep *verifyReporter) error {
	var squads []map[string]any
	if err := client.GetJSON(ctx, "/api/squads", &squads); err != nil {
		return fmt.Errorf("list squads: %w", err)
	}
	for _, s := range squads {
		if strVal(s, "name") != manifest.Squad.Name {
			continue
		}
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
	rep.fail("squad", manifest.Squad.Name+" missing — run `"+manifest.BootstrapCommand+"`")
	return nil
}

// verifyPortfolioAutopilot requires the scheduled automation to be active on
// the manifest's schedule.
func verifyPortfolioAutopilot(ctx context.Context, client *cli.APIClient, manifest portfolio.Manifest, rep *verifyReporter) error {
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
		rep.fail("autopilot", manifest.Autopilot.Title+" missing — run `"+manifest.BootstrapCommand+"`")
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

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

// Publishing a whole portfolio to the Marketplace.
//
// A publish reads an entity that already exists in the workspace — the server
// snapshots it and strips every credential-bearing field, which is what makes
// the redaction trustworthy. So this runs after bootstrap, never instead of it.
//
// One integration produces three kinds of listing. The Agent Family is the
// headline: installing it creates every member agent, the skills each carries,
// and the family binding them, in one transaction. The individual agents and
// skills are published too so someone can take one role, or one method,
// without the rest.

type portfolioPublishOptions struct {
	Version    string
	Visibility string
	Changelog  string
	Category   string
	Tags       []string
	// Kinds selects which of skill/agent/squad to publish. Empty means all.
	Kinds  map[string]bool
	DryRun bool
}

func (o portfolioPublishOptions) wants(kind string) bool {
	return len(o.Kinds) == 0 || o.Kinds[kind]
}

type publishTarget struct {
	kind     string
	sourceID string
	slug     string
	label    string
}

// publishPortfolio publishes every entity the manifest describes, in the order
// that reads best in the output: the methods, then the roles that use them,
// then the family that binds the roles.
func publishPortfolio(ctx context.Context, client *cli.APIClient, manifest portfolio.Manifest, opts portfolioPublishOptions) error {
	targets, err := collectPublishTargets(ctx, client, manifest, opts)
	if err != nil {
		return err
	}
	if len(targets) == 0 {
		return fmt.Errorf("nothing to publish — run `%s` first so the entities exist in this workspace", manifest.BootstrapCommand)
	}

	if opts.DryRun {
		fmt.Fprintf(os.Stderr, "\n==> Would publish %d listing(s) at version %s (%s)\n", len(targets), opts.Version, opts.Visibility)
		for _, t := range targets {
			fmt.Fprintf(os.Stderr, "  %-6s %-34s %s\n", t.kind, t.slug, t.label)
		}
		return nil
	}

	fmt.Fprintf(os.Stderr, "\n==> Publishing %d listing(s) at version %s (%s)\n", len(targets), opts.Version, opts.Visibility)
	published, existing, failed := 0, 0, 0
	for _, t := range targets {
		body := map[string]any{
			"kind":       t.kind,
			"source_id":  t.sourceID,
			"slug":       t.slug,
			"version":    opts.Version,
			"visibility": opts.Visibility,
		}
		if opts.Changelog != "" {
			body["changelog"] = opts.Changelog
		}
		if opts.Category != "" {
			body["category"] = opts.Category
		}
		if len(opts.Tags) > 0 {
			body["tags"] = opts.Tags
		}
		var result map[string]any
		if err := client.PostJSON(ctx, "/api/marketplace/listings", body, &result); err != nil {
			// A version that is already published is the idempotent re-run
			// case, not a failure: a published version is never overwritten,
			// so the listing already carries exactly what this run would send.
			if strings.Contains(err.Error(), "already been published") {
				existing++
				fmt.Fprintf(os.Stderr, "  %-6s %-34s already at %s — kept\n", t.kind, t.slug, opts.Version)
				continue
			}
			failed++
			fmt.Fprintf(os.Stderr, "  %-6s %-34s failed: %v\n", t.kind, t.slug, err)
			continue
		}
		published++
		fmt.Fprintf(os.Stderr, "  %-6s %-34s published\n", t.kind, t.slug)
	}

	fmt.Fprintf(os.Stderr, "Listings: %d published, %d already at this version, %d failed\n", published, existing, failed)
	if failed > 0 {
		return fmt.Errorf("%d listing(s) failed to publish", failed)
	}
	return nil
}

// collectPublishTargets resolves the workspace entities the manifest names.
// Anything missing is reported and skipped rather than aborting: publishing
// four of five roles is more useful than publishing none because one was
// archived.
func collectPublishTargets(ctx context.Context, client *cli.APIClient, manifest portfolio.Manifest, opts portfolioPublishOptions) ([]publishTarget, error) {
	var targets []publishTarget

	if opts.wants("skill") {
		skillIDs, err := fetchPortfolioSkillIDs(ctx, client, manifest)
		if err != nil {
			return nil, err
		}
		for _, name := range manifest.RuntimeSkillNames {
			id, ok := skillIDs[name]
			if !ok {
				fmt.Fprintf(os.Stderr, "  skill  %-34s not in the workspace — skipped\n", name)
				continue
			}
			targets = append(targets, publishTarget{
				kind: "skill", sourceID: id, label: name,
				// The plugin prefix separates with a colon, which slugifies to
				// nothing; spell the slug so the handle stays readable.
				slug: marketplaceSlug(name),
			})
		}
	}

	if opts.wants("agent") || opts.wants("squad") {
		var agents []map[string]any
		path := "/api/agents?" + url.Values{"workspace_id": {client.WorkspaceID}}.Encode()
		if err := client.GetJSON(ctx, path, &agents); err != nil {
			return nil, fmt.Errorf("list agents: %w", err)
		}
		byName := make(map[string]string, len(agents))
		for _, a := range agents {
			byName[strVal(a, "name")] = strVal(a, "id")
		}
		if opts.wants("agent") {
			for _, spec := range manifest.Agents {
				id, ok := byName[spec.Name]
				if !ok {
					fmt.Fprintf(os.Stderr, "  agent  %-34s not in the workspace — skipped\n", spec.Name)
					continue
				}
				targets = append(targets, publishTarget{
					kind: "agent", sourceID: id, slug: marketplaceSlug(spec.Name), label: spec.Name,
				})
			}
		}
	}

	if opts.wants("squad") {
		var squads []map[string]any
		if err := client.GetJSON(ctx, "/api/squads", &squads); err != nil {
			return nil, fmt.Errorf("list squads: %w", err)
		}
		found := false
		for _, s := range squads {
			if strVal(s, "name") != manifest.Squad.Name {
				continue
			}
			found = true
			targets = append(targets, publishTarget{
				kind: "squad", sourceID: strVal(s, "id"),
				slug: marketplaceSlug(manifest.Squad.Name), label: manifest.Squad.Name,
			})
		}
		if !found {
			fmt.Fprintf(os.Stderr, "  squad  %-34s not in the workspace — skipped\n", manifest.Squad.Name)
		}
	}

	return targets, nil
}

// marketplaceSlug mirrors the server's slugify, except that it treats a colon
// as a separator. The server drops it, which would turn "ontologizer:trace"
// into "ontologizertrace" — a handle nobody can read or type.
func marketplaceSlug(name string) string {
	var b strings.Builder
	lastDash := true
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		case r == '-', r == '_', r == ' ', r == '.', r == '/', r == ':':
			if !lastDash && b.Len() > 0 {
				b.WriteRune('-')
				lastDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}
