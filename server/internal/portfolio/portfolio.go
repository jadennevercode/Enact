// Package portfolio holds the deployment-independent description of an agent
// portfolio: which agents run a kind of engagement, what each one is for, how
// they group into a squad, and what runs on a schedule.
//
// It exists because two integrations — MMM and Ontologizer — provision the
// same server objects from the same shapes, and the CLI applies them with one
// set of idempotent ensure/verify routines. Keeping the shapes here and the
// application in the CLI means adding a third integration is a manifest, not a
// second copy of six hundred lines that will drift from the first.
//
// The package deliberately performs no I/O and knows nothing about the Enact
// API. A manifest is data; `enact <integration> agent bootstrap` is what makes
// it real.
package portfolio

// AgentSpec is one agent in a portfolio.
//
// Model and thinking level are deliberately absent: they follow the
// runtime/server defaults of whatever deployment the manifest lands on, so the
// same portfolio works on a Claude host and on a Codex one.
type AgentSpec struct {
	Name         string
	Description  string
	Instructions string
	// SkillNames are workspace skill names to bind, for UI visibility and for
	// assignment. A Claude runtime loads the plugin's skills natively whether
	// or not they are bound here.
	SkillNames []string
	// MaxConcurrentTasks caps parallel task claims. One is not a performance
	// setting: for agents that write to a shared on-disk workspace it is what
	// keeps two runs from racing on the same files.
	MaxConcurrentTasks int
	// NeedsRuntimeEnv marks agents whose runs invoke the integration's own
	// tooling, so bootstrap injects the integration's environment for them.
	NeedsRuntimeEnv bool
}

// SquadSpec is the Agent Family that groups a portfolio. Human members never
// appear here: bootstrap runs before anyone has said which people belong, and
// a workspace's members are not knowable from a manifest. Name the human roles
// in Instructions instead, and let the operator add the people.
type SquadSpec struct {
	Name        string
	Description string
	// Instructions reach the leader on every turn — routing rules, escalation
	// policy, and who to ask for each human decision.
	Instructions string
	LeaderName   string
	MemberNames  []string
}

// AutopilotSpec is one scheduled automation. A zero Title means the portfolio
// has none.
type AutopilotSpec struct {
	Title              string
	Description        string
	AssigneeName       string
	IssueTitleTemplate string
	DefaultCron        string
	DefaultTimezone    string
}

// Manifest is a complete portfolio plus the integration metadata the CLI needs
// to talk about it: which plugin skills belong to it, and which commands to
// name when something is missing.
type Manifest struct {
	Agents    []AgentSpec
	Squad     SquadSpec
	Autopilot AutopilotSpec

	// SkillPrefix is the invocation-key namespace the daemon assigns to skills
	// contributed by this integration's Claude Code plugin — "mmm:" for the
	// mmm plugin, "ontologizer:" for the Ontologizer one.
	SkillPrefix string
	// RuntimeSkillNames is every workspace skill name the plugin contributes.
	RuntimeSkillNames []string
	// PluginName is the marketplace entry the setup step registers, used in
	// remediation text when a runtime reports no skills.
	PluginName string
	// SetupCommand and BootstrapCommand are quoted back to the operator when a
	// check fails, so the fix is in the message rather than in the docs.
	SetupCommand     string
	BootstrapCommand string
}

// HasAutopilot reports whether this portfolio ships a scheduled automation.
func (m Manifest) HasAutopilot() bool { return m.Autopilot.Title != "" }

// AgentByName finds a spec by its portfolio name.
func (m Manifest) AgentByName(name string) (AgentSpec, bool) {
	for _, spec := range m.Agents {
		if spec.Name == name {
			return spec, true
		}
	}
	return AgentSpec{}, false
}
