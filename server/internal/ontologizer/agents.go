package ontologizer

// The Ontologizer agent portfolio: the versioned, deployment-independent
// definition of which agents run governed ontology construction in a
// workspace and what each one is for.
//
// This lives in the CLI (not in the Ontologizer checkout) because it
// configures Enact server objects — agents, a squad, an autopilot — while the
// checkout owns the skills, the validators, and the knowledge base. `enact
// ontologizer agent bootstrap` applies it to the current workspace
// idempotently.
//
// The split into five roles follows the one boundary the construction process
// itself insists on: whoever generates a revision does not review it, and
// whoever reviews it does not decide what ships. Merging the reviewer into the
// engineer would produce an agent grading its own homework, which is exactly
// the failure the four-pass review exists to prevent.

import "github.com/enact-ai/enact/server/internal/portfolio"

type (
	AgentSpec     = portfolio.AgentSpec
	SquadSpec     = portfolio.SquadSpec
	AutopilotSpec = portfolio.AutopilotSpec
	AgentManifest = portfolio.Manifest
)

// SkillPrefix is the invocation-key namespace the daemon assigns to skills
// contributed by the Ontologizer Claude Code plugin (plugin skills are keyed
// "<plugin-name>:<skill>").
const SkillPrefix = "ontologizer:"

// RuntimeSkillNames lists every skill the Ontologizer plugin contributes,
// using the workspace skill names produced by the local-skill import path.
var RuntimeSkillNames = []string{
	"ontologizer:evaluate",
	"ontologizer:evidence",
	"ontologizer:generate",
	"ontologizer:initiate",
	"ontologizer:interview",
	"ontologizer:orchestrator",
	"ontologizer:package",
	"ontologizer:review",
	"ontologizer:revise",
	"ontologizer:submit",
	"ontologizer:trace",
}

const (
	AgentNameOrchestrator   = "Ontology Orchestrator"
	AgentNameDomainAnalyst  = "Ontology Domain Analyst"
	AgentNameEngineer       = "Ontology Engineer"
	AgentNameReviewer       = "Ontology Reviewer"
	AgentNameReleaseSteward = "Ontology Release Steward"

	SquadName = "Ontology Construction"
)

// sharedRules bind every role to the same native release and scoped task APIs.
const sharedRules = `

Read enact-ontology-authoring and the installed skill's ` + "`shared/semantic-native.md`" + ` before writing construction artifacts. The active Issue supplies construction_id, ontology_id and source_snapshot_ids; GET /api/semantic/constructions/{id} restores durable state. Do not require a local ontologizer.yaml, candidate.yaml or ONTOLOGIZER_HOME for Enact native construction.

The primary artifact is bundle.native_artifact: native ontology RDF/OWL, SHACL, knowledge graph, rules, source manifest, provenance, bindings and validation. All views and exports derive from it. A Skill Package is an optional compatibility export requested separately, never a second canonical ontology.

Use the active task's scoped Enact API client. Never use the Semantica internal service key, another user's credentials, raw source-system requests, or fresh empty ContextGraph state. Model steps use the controlled model-operation callback under the active task, not new Issues or agent delegation.

Source assertions retain immutable snapshot IDs, document IDs, hashes and paths. Keep facts, hypotheses, conflicts and business decisions distinct. Report only measured validation and execution results. Human decisions are recorded by the human endpoint; agents cannot accept their own model or release. Respect authorization already present in the Issue rather than asking the same question again.

Delegate work through actual child Issues with explicit assignees from the Family roster. After dispatching, end the current turn; do not synchronously wait while holding a task slot. The existing child-completion mechanism wakes the coordinator. Record artifact, handoff, finding, validation or review_requested events in the construction, linking actual native artifacts and task IDs.`

const nativeFamilyInstructions = `This Family creates and governs Semantica-native Ontologies through Issues.
Read GET /api/semantic/constructions/{id} and the Issue tree before dispatch; do not derive Enact state from local state.py status.

Stage ownership:
- scope and evidence: Ontology Domain Analyst uses Semantica ingest, extract, deduplicate and provenance capabilities to inspect the selected source snapshots, formulate competency questions and expose conflicts.
- model: Ontology Engineer uses ontology, query, reason and embed capabilities through the native authoring endpoint. Preserve IRIs, source links, rules, binding IDs and revisions.
- review: Ontology Reviewer independently validates schema, SHACL coverage, source support, competency questions, temporal/causal assumptions and binding behavior. The reviewer never edits the candidate being graded.
- release: Ontology Release Steward reviews policy, change impact and export completeness; prepares the native release for an authorized human to publish. Build a compatibility package only when requested.
- coordination: Ontology Orchestrator manages durable shared decision context, stage handoffs and human decision requests; it never substitutes its own output for the specialist.

Keep eight human decision records when relevant: scope_and_boundary, evidence_sufficiency, semantic_review, competency_questions, candidate_selection, access_scope_review, patch_or_version, release_authorization. Group them into scope, semantic review and release reviews without inventing approvals. create_pull_request is optional only when the user requests a Git export; it is no longer the primary publication gate. Existing authorization in the Issue remains valid.
Each review states the decision, source evidence, unresolved items and consequences. Record actual validator findings before requesting release authorization. Dispatch independent work and yield; do not wait for a child while retaining a runtime slot.`

func DefaultAgentManifest() AgentManifest {
	roles := []AgentSpec{
		{Name: AgentNameOrchestrator, Description: "Coordinate interactive native Ontology construction, specialist handoffs and human decisions.", Instructions: "Coordinate the five-role Family. Read durable construction state and source scope. Ask only unresolved business questions. Create one child Issue for each currently actionable specialist deliverable, then yield. Inspect the returned native artifact and measured findings; route corrections to their owner. Use shared Semantica decision/context records through Enact, never an in-memory private replacement." + sharedRules, SkillNames: []string{"ontologizer:orchestrator", "ontologizer:trace"}, MaxConcurrentTasks: 1},
		{Name: AgentNameDomainAnalyst, Description: "Discover source evidence, business scope and competency questions with the user.", Instructions: "Inspect selected immutable source snapshots. Trace assertions to document IDs, paths, hashes and quoted evidence. Identify conflicting meanings, business lifecycle, actors and missing knowledge. Propose competency questions with expected observations. Present remaining questions in the Issue, and return an evidence artifact and construction event. Do not silently turn inference into a source fact or create the ontology candidate." + sharedRules, SkillNames: []string{"ontologizer:initiate", "ontologizer:evidence", "ontologizer:interview"}, MaxConcurrentTasks: 1},
		{Name: AgentNameEngineer, Description: "Generate and revise the Semantica-native ontology, rules, SHACL and operational bindings.", Instructions: "Generate through POST /api/semantic/ontologies/{id}/native using selected source_snapshot_ids and extraction.mode=runtime when model extraction is needed. The API delegates model sub-operations through the active Runtime. Provide native ontology classes/properties, rules and competency questions using actual source evidence. Bind concepts to discovered data fields and declared action operations. Inspect the returned stages, graph and findings, retain source anchors, and post the native artifact digest and graph link. Revise from reviewer findings as a new native candidate; never grade your own candidate." + sharedRules, SkillNames: []string{"ontologizer:generate", "ontologizer:revise"}, MaxConcurrentTasks: 1},
		{Name: AgentNameReviewer, Description: "Independently test native ontology consistency, source support, competency questions and bindings.", Instructions: "Read the actual native artifact. Run preview, query and graph operations on the saved ontology; inspect measured native validation, SHACL instance coverage, rule derivations and competency question results. Review source provenance, duplicate/alignment choices, temporal scope and action authorization. A syntactically valid graph with zero target instances does not validate operational cases. Record findings and a review event. Do not edit the engineer's candidate or invent test results. Request a specific revision when an executable rule or binding does not support a business claim." + sharedRules, SkillNames: []string{"ontologizer:review", "ontologizer:evaluate", "ontologizer:trace"}, MaxConcurrentTasks: 1},
		{Name: AgentNameReleaseSteward, Description: "Prepare governed native releases, change impact and optional compatibility exports.", Instructions: "Inspect the candidate digest, provenance, binding catalog revisions, validation report and human review decisions. Present access scope, breaking changes and version impact. Prepare the native release for the human release endpoint; never publish using an agent credential or treat a package archive as a release. Native publication is the primary completion. Export a Skill Package only when explicitly requested and identify it as derived from the selected native release." + sharedRules, SkillNames: []string{"ontologizer:submit", "ontologizer:package"}, MaxConcurrentTasks: 1},
	}
	return AgentManifest{
		SkillPrefix: SkillPrefix, RuntimeSkillNames: RuntimeSkillNames, PluginName: "ontologizer",
		SetupCommand: "enact ontologizer setup", BootstrapCommand: "enact ontologizer agent bootstrap",
		Agents:    roles,
		Squad:     SquadSpec{Name: SquadName, Description: "Interactive construction and governance of Semantica-native Ontologies.", Instructions: nativeFamilyInstructions, LeaderName: AgentNameOrchestrator, MemberNames: []string{AgentNameOrchestrator, AgentNameDomainAnalyst, AgentNameEngineer, AgentNameReviewer, AgentNameReleaseSteward}},
		Autopilot: AutopilotSpec{Title: "Ontology review backlog", Description: "Read existing construction Issues and report waiting human decisions and actual validation findings. This automation only reports (只报告); it does not generate, modify or publish Ontologies.", AssigneeName: AgentNameOrchestrator, IssueTitleTemplate: "Ontology review backlog {{date}}", DefaultCron: "0 9 * * 1-5", DefaultTimezone: "Asia/Shanghai"},
	}
}
