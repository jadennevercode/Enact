package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// The manifest is what a version says about itself: enough for a reader to
// decide whether to install it, and enough for the installer to rebuild the
// entity without consulting the publishing workspace. It is stored as JSONB
// and returned verbatim, so every field here is part of the API contract.
//
// A manifest never carries a credential. The publish path runs every
// secret-bearing field through marketplace_sanitize.go first, and the fields
// that cannot be sanitized safely — an agent's custom_env, its runtime_config,
// its Composio allowlist — are not modelled here at all. Leaving them out of
// the type is the enforcement: there is no field for them to be written into.

const (
	marketplaceKindSkill = "skill"
	marketplaceKindAgent = "agent"
	marketplaceKindMcp   = "mcp"
	// marketplaceKindSquad is an Agent Family: the product name is the
	// glossary term, the code name is the table it lands in.
	marketplaceKindSquad = "squad"
)

func validMarketplaceKind(kind string) bool {
	switch kind {
	case marketplaceKindSkill, marketplaceKindAgent, marketplaceKindMcp, marketplaceKindSquad:
		return true
	}
	return false
}

// marketplaceManifest is the envelope every version carries. Exactly one of
// the kind-specific members is populated, matching the listing's kind.
type marketplaceManifest struct {
	Kind  string                    `json:"kind"`
	Skill *marketplaceSkillManifest `json:"skill,omitempty"`
	Agent *marketplaceAgentManifest `json:"agent,omitempty"`
	Mcp   *marketplaceMcpManifest   `json:"mcp,omitempty"`
	Squad *marketplaceSquadManifest `json:"squad,omitempty"`
	// Prerequisites are things that must be true on the installing side before
	// the copy will actually work, in the publisher's own words: "run `enact
	// ontologizer setup` on the runtime host", "the repository must contain a
	// pnpm workspace".
	//
	// They exist because an install is a copy, and a copy of an agent whose
	// skills shell out to a Python engine installed on the publisher's machine
	// arrives describing commands the installing machine does not have. There
	// is nothing the server can check here — the condition is on someone
	// else's host — so this is prose shown before the install and nothing more.
	// Presenting it as a validated gate would be worse than presenting it as
	// what it is.
	Prerequisites []string `json:"prerequisites,omitempty"`
}

// maxMarketplacePrerequisites and maxMarketplacePrerequisiteLen bound the
// field. A publisher with more conditions than this is describing a runbook,
// which belongs in the skill body where it can be read properly.
const (
	maxMarketplacePrerequisites   = 8
	maxMarketplacePrerequisiteLen = 300
)

// normalizeMarketplacePrerequisites trims, drops blanks, and enforces the
// bounds. Order is the publisher's, because prerequisites are often sequential.
func normalizeMarketplacePrerequisites(values []string) ([]string, error) {
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if len(value) > maxMarketplacePrerequisiteLen {
			return nil, fmt.Errorf("each prerequisite must be at most %d characters", maxMarketplacePrerequisiteLen)
		}
		out = append(out, value)
	}
	if len(out) > maxMarketplacePrerequisites {
		return nil, fmt.Errorf("a listing may declare at most %d prerequisites", maxMarketplacePrerequisites)
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

// marketplaceSkillManifest describes a published skill. The SKILL.md body and
// every reference file live in marketplace_listing_file under the paths named
// here, not in the manifest — a 200KB body in a JSONB column would be read on
// every browse.
type marketplaceSkillManifest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// ContentPath is where the primary body was written in the version's file
	// set. Always "SKILL.md" today; named explicitly so a reader never has to
	// infer it.
	ContentPath string   `json:"content_path"`
	FilePaths   []string `json:"file_paths"`
}

// marketplaceAgentManifest is the portable half of an agent.
//
// What is deliberately absent, and why:
//
//   - custom_env — the agent's secrets. Never on the wire at all, published or
//     not (see agent_env.go).
//   - runtime_config — carries a gateway token, and describes the publishing
//     workspace's own runtime rather than anything the installer can use.
//   - runtime_id — names a machine in another workspace. The installer picks
//     its own; runtime_provider below is a hint about what the template expects.
//   - composio_toolkit_allowlist — scoped to the publisher's connected
//     accounts, meaningless anywhere else.
//   - permission_mode / invocation_targets — name members and teams of the
//     publishing workspace. An installed agent starts private to its installer.
type marketplaceAgentManifest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// Instructions is the agent's prompt: the substance of a template.
	Instructions  string  `json:"instructions"`
	AvatarURL     *string `json:"avatar_url,omitempty"`
	Model         string  `json:"model,omitempty"`
	ThinkingLevel string  `json:"thinking_level,omitempty"`
	ServiceTier   string  `json:"service_tier,omitempty"`
	// RuntimeProvider is what the publisher's runtime was, so the installer can
	// be warned when it is about to bind a template written for Claude Code to
	// a Codex runtime. Advisory: the install does not refuse on a mismatch.
	RuntimeProvider    string   `json:"runtime_provider,omitempty"`
	MaxConcurrentTasks int32    `json:"max_concurrent_tasks,omitempty"`
	CustomArgs         []string `json:"custom_args,omitempty"`
	// Skills the template brings with it, materialized as workspace skills at
	// install time. Each names a directory in the version's file set.
	Skills []marketplaceAgentSkillRef `json:"skills,omitempty"`
	// McpServers the template expects, published redacted. Each becomes a
	// workspace MCP server bound to the installed agent.
	McpServers []marketplaceMcpManifest `json:"mcp_servers,omitempty"`
}

// marketplaceAgentSkillRef points at one embedded skill's files.
type marketplaceAgentSkillRef struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// Dir is the prefix under which this skill's files were written, e.g.
	// "skills/code-review". Its SKILL.md is Dir + "/SKILL.md".
	Dir string `json:"dir"`
}

// marketplaceSquadManifest is an Agent Family as published: the squad's own
// prose, and every agent member as a full agent template of its own, each
// rooted in its own directory of the version's file set.
//
// What is deliberately absent, and why:
//
//   - human members — they name people in the publishing workspace, who are
//     not members of the installing one. The installer adds its own people.
//   - system_key — marks a squad the product seeded for this workspace; an
//     installed copy is an ordinary squad.
//   - leader_id — a row id in another workspace. The leader is named by the
//     directory of the member it is, and resolved to the agent the install
//     creates from that directory.
type marketplaceSquadManifest struct {
	Name         string  `json:"name"`
	Description  string  `json:"description"`
	Instructions string  `json:"instructions"`
	AvatarURL    *string `json:"avatar_url,omitempty"`
	// LeaderDir is the Dir of the member that leads. Always one of Agents.
	LeaderDir string `json:"leader_dir"`
	// Agents are the members, leader first. Each carries the same template an
	// agent listing would, so one installer serves both kinds.
	Agents []marketplaceSquadAgentRef `json:"agents"`
}

// marketplaceSquadAgentRef is one agent member of a published squad.
type marketplaceSquadAgentRef struct {
	// Dir is the prefix under which this member's files were written, e.g.
	// "agents/reviewer". Its skills live under Dir + "/skills/<skill>/".
	Dir string `json:"dir"`
	// Role is the squad_member role the publisher gave it ("leader" for the
	// leader, free text otherwise).
	Role  string                   `json:"role"`
	Agent marketplaceAgentManifest `json:"agent"`
}

// marketplaceMcpManifest is one MCP server entry as published: the config with
// every credential removed, and the paths the installer must fill in.
type marketplaceMcpManifest struct {
	Name      string `json:"name"`
	Transport string `json:"transport"`
	// EndpointHint is scheme://host of a withheld URL, so a reader can see
	// which service this talks to without receiving the credential that may be
	// embedded in the rest of it. Empty for stdio servers.
	EndpointHint    string          `json:"endpoint_hint,omitempty"`
	Config          json.RawMessage `json:"config"`
	RequiredSecrets []string        `json:"required_secrets"`
}

// marketplaceFile is one file of a version, in memory during publish.
type marketplaceFile struct {
	Path    string
	Content string
}

// skillContentPath is where a skill listing's primary body is written. It
// matches the on-disk name every runtime already looks for, so a version's file
// set reads the same way a checked-out skill directory does.
const skillContentPath = "SKILL.md"

// agentSkillDirPrefix namespaces an agent template's embedded skills inside its
// file set, keeping them from colliding with each other or with a future
// top-level file.
const agentSkillDirPrefix = "skills/"

// squadAgentDirPrefix namespaces a squad's member agents the same way; each
// member's skills then sit under "<member dir>/skills/".
const squadAgentDirPrefix = "agents/"

// maxMarketplaceSquadAgents bounds how many member agents one squad listing
// may carry. Every member is a full agent template with its own skills, so an
// unbounded squad would be an unbounded install transaction.
const maxMarketplaceSquadAgents = 16

// marketplaceVersionDigest is a sha256 over the canonical manifest and the full
// file set, so two people can confirm they are looking at the same version.
//
// Both halves are folded in deterministically: the manifest is re-marshalled
// through a map so Go's map-key ordering cannot leak into the hash, and files
// are sorted by path with their lengths written between fields so no
// concatenation of one file's tail and the next one's head can collide with a
// different split.
func marketplaceVersionDigest(manifest []byte, files []marketplaceFile) (string, int64, error) {
	canonical, err := canonicalJSON(manifest)
	if err != nil {
		return "", 0, err
	}

	sorted := make([]marketplaceFile, len(files))
	copy(sorted, files)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Path < sorted[j].Path })

	hash := sha256.New()
	fmt.Fprintf(hash, "manifest:%d:", len(canonical))
	hash.Write(canonical)
	size := int64(len(canonical))
	for _, file := range sorted {
		fmt.Fprintf(hash, "file:%d:%s:%d:", len(file.Path), file.Path, len(file.Content))
		hash.Write([]byte(file.Content))
		size += int64(len(file.Content))
	}
	return hex.EncodeToString(hash.Sum(nil)), size, nil
}

// canonicalJSON re-encodes a JSON document with object keys sorted, which is
// what encoding/json does for a map. Round-tripping through `any` is enough:
// the manifest is plain data with no numbers large enough for float64 to lose.
func canonicalJSON(raw []byte) ([]byte, error) {
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, err
	}
	return json.Marshal(decoded)
}

func fileSHA256(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

// marketplaceSlugify turns a display name into a slug a publisher can read and
// type. Empty input, or input with nothing slug-worthy in it, returns "" and
// the caller asks for an explicit slug rather than inventing one.
func marketplaceSlugify(name string) string {
	var b strings.Builder
	lastDash := true
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		case r == '-' || r == '_' || r == ' ' || r == '.' || r == '/':
			if !lastDash && b.Len() > 0 {
				b.WriteRune('-')
				lastDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}
