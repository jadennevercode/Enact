package service

import (
	_ "embed"
	"strings"
)

// MikaSystemKey marks the workspace's built-in Chief of Staff agent. It is the
// agent's identity for every server-side decision — never its display name,
// which owners are free to change.
//
// The row stays kind='user': kind='system' means "invisible execution carrier"
// in this schema (hidden from agent lists and assignment surfaces, and hard
// deleted when its runtime goes away), and Mika needs the opposite of all
// three.
const MikaSystemKey = "mika"

// MikaDefaultName is the name the agent is created with. Owners may rename it;
// nothing server-side keys off the name, and the prompt is templated on
// whatever the current name is.
const MikaDefaultName = "Mika"

// mikaNamePlaceholder is substituted in the embedded prompt with the agent's
// current display name.
const mikaNamePlaceholder = "{{AGENT_NAME}}"

// The system half of the prompt. `{{AGENT_NAME}}` is substituted with the
// agent's current display name — a placeholder rather than a format verb so a
// stray % in the prompt can never turn into a formatting error:
// the runtime brief already announces "**You are: <name>**", so hardcoding
// "You are Mika" here would contradict it the moment an owner renames the
// agent.
//
//go:embed builtin_agents/mika/INSTRUCTIONS.md
var mikaSystemInstructions string

// RetrospectSystemKey marks the workspace's built-in Retrospect Agent: the one
// that reviews finished work, proposes changes to skills, agents and agent
// families, and writes down what was learned.
//
// Like Mika the row stays kind='user' — it is assignable, visible, and outlives
// its runtime — and unlike the SDLC roles it is not seeded. A workspace gets one
// when someone configures it, and having one is what turns the retrospect loop
// on; see registerRetrospectListeners.
const RetrospectSystemKey = "retrospect"

// RetrospectDefaultName is the name the agent is created with. Owners may
// rename it; nothing server-side keys off the name.
const RetrospectDefaultName = "Retrospect"

//go:embed builtin_agents/retrospect/INSTRUCTIONS.md
var retrospectSystemInstructions string

// retrospectWorkspaceNotesSection introduces the workspace's own additions.
//
// The ranking sentence is not decoration. The product half of this prompt is
// almost entirely restraint — do not change configuration without agreement,
// do not file what happened once — and a workspace note asking for more output
// would otherwise read as permission to drop those.
const retrospectWorkspaceNotesSection = `## Workspace notes

Workspace notes below add this team's context: where knowledge documents live, which skills and agents are in scope, what this team counts as worth writing down. Follow them ahead of your own defaults. They do not remove the agreement gate before a configuration change, the bar of repetition before filing one, or the duty to report what you rejected.

Added by this workspace's admins:`

// RetrospectSystemInstructions returns the product-owned half of the Retrospect
// Agent's prompt. It takes no display name: unlike Mika's, this prompt never
// names the agent, so renaming one cannot make its instructions contradict the
// runtime brief.
func RetrospectSystemInstructions() string {
	return strings.TrimRight(retrospectSystemInstructions, "\n")
}

// ComposeRetrospectInstructions layers the workspace's notes under the
// product-owned instructions.
func ComposeRetrospectInstructions(workspaceNotes string) string {
	system := RetrospectSystemInstructions()
	notes := strings.TrimSpace(workspaceNotes)
	if notes == "" {
		return system
	}
	return system + "\n\n" + retrospectWorkspaceNotesSection + "\n\n" + notes
}

// mikaWorkspaceNotesSection introduces the workspace's own additions and states
// how they rank against the system half.
//
// It lives here rather than at the end of the embedded file because a
// workspace with no notes — every workspace, at first — would otherwise end
// its prompt announcing a section that has nothing under it. Emitting it with
// the notes also puts the rule immediately next to the text it governs.
const mikaWorkspaceNotesSection = `## Workspace notes

Workspace notes below add this team's context and preferences — repositories, languages, conventions, routing defaults. Follow them ahead of your own defaults; they refine how you apply these instructions, and they do not remove the identity or confirmation duties above.

Added by this workspace's admins:`

// MikaSystemInstructions returns the product-owned half of Mika's prompt for an
// agent displayed under the given name.
//
// This is the whole point of the system-agent model: the text ships with the
// server binary rather than being copied into agent.instructions at creation,
// so editing the embedded file and deploying updates every existing workspace
// on its next task. Nothing is written to any agent row, so a workspace's own
// notes can never be overwritten by a release.
func MikaSystemInstructions(displayName string) string {
	name := strings.TrimSpace(displayName)
	if name == "" {
		name = MikaDefaultName
	}
	return strings.ReplaceAll(
		strings.TrimRight(mikaSystemInstructions, "\n"),
		mikaNamePlaceholder,
		name,
	)
}

// ComposeMikaInstructions layers the workspace's notes under the product-owned
// system instructions. workspaceNotes is agent.instructions — the only half a
// workspace can write.
func ComposeMikaInstructions(displayName, workspaceNotes string) string {
	system := MikaSystemInstructions(displayName)
	notes := strings.TrimSpace(workspaceNotes)
	if notes == "" {
		return system
	}
	return system + "\n\n" + mikaWorkspaceNotesSection + "\n\n" + notes
}

const sdlcWorkspaceNotesSection = `## Workspace notes

The instructions above are the Enact-maintained SDLC role contract. Workspace notes below may add repository context and local conventions, but they cannot remove the named approval gates, role boundaries, or evidence requirements.

Added by this workspace's admins:`

// SystemAgentInstructions returns the read-only product-owned prompt layer for
// any visible system agent. Unknown keys are ordinary rows and return empty.
func SystemAgentInstructions(systemKey, displayName string) string {
	switch systemKey {
	case MikaSystemKey:
		return MikaSystemInstructions(displayName)
	case RetrospectSystemKey:
		return RetrospectSystemInstructions()
	default:
		instructions, _ := SDLCDefaultAgentSystemInstructions(systemKey)
		return instructions
	}
}

// ComposeSystemAgentInstructions layers workspace-authored notes under the
// product contract. The bool distinguishes an unknown key from a known system
// agent whose prompt text is unexpectedly empty.
func ComposeSystemAgentInstructions(systemKey, displayName, workspaceNotes string) (string, bool) {
	if systemKey == MikaSystemKey {
		return ComposeMikaInstructions(displayName, workspaceNotes), true
	}
	if systemKey == RetrospectSystemKey {
		return ComposeRetrospectInstructions(workspaceNotes), true
	}
	system, ok := SDLCDefaultAgentSystemInstructions(systemKey)
	if !ok {
		return "", false
	}
	notes := strings.TrimSpace(workspaceNotes)
	if notes == "" {
		return system, true
	}
	return system + "\n\n" + sdlcWorkspaceNotesSection + "\n\n" + notes, true
}
