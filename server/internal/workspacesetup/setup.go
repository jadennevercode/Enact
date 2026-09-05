// Package workspacesetup owns the checklist a new workspace opens with: which
// steps there are, how each one is identified in the database, and the
// product-authored copy for all four languages.
//
// It is data and rendering only. The handler files the issues and the inbox
// item; this package decides what they say and how a later read finds them
// again.
//
// Why a checklist of real issues rather than a wizard: a wizard is gone the
// moment it is dismissed, and the thing a new workspace most needs is a place
// to come back to. The issues are ordinary issues — assignable, commentable,
// closable — so the product's own onboarding lives in the same surface the
// team's work will.
package workspacesetup

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Step is one thing a new workspace has to do before agents can work on its
// behalf. The order is the order they are filed and rendered in, and it is the
// order they unblock each other: no runtime means no agent, no agent means
// nothing can read the repository, and nothing can be recommended before the
// workspace has said what it is.
type Step string

const (
	// StepRuntime — connect a computer for agents to run on.
	StepRuntime Step = "runtime"
	// StepRepository — point the workspace at the code or files the work is about.
	StepRepository Step = "repository"
	// StepProfile — say what this project is, so runs and recommendations
	// start informed.
	StepProfile Step = "profile"
	// StepCapability — review what the Marketplace has for this project.
	StepCapability Step = "capability"
)

// Steps is the canonical order. Inserting a step here is all it takes to add
// one: the filer, the checklist endpoint and the four copy tables are all
// keyed on this slice, and a step missing copy fails the copy test rather
// than shipping an English string into a Chinese workspace.
var Steps = []Step{StepRuntime, StepRepository, StepProfile, StepCapability}

// OriginType is the issue.origin_type every setup issue carries. It is how a
// later read finds them: titles are localized and owner-editable, so nothing
// server-side may key off them.
const OriginType = "workspace_setup"

// InboxTypeWelcome is the inbox item filed with the checklist. Inbox types are
// bare strings throughout this schema — the column has no CHECK, and
// notification grouping treats an unknown type as always-deliver — so the
// constant exists to keep the server and the client's union in step, not
// because the database enforces it. `packages/core/types/inbox.ts` carries the
// other half.
const InboxTypeWelcome = "workspace_welcome"

// RepoAnalysisOriginType stamps the run that reads a connected repository.
// It lives here rather than beside the analysis code because the setup
// checklist reads it too — an analysis in flight is what "we are working on
// the repository step" looks like.
const RepoAnalysisOriginType = "repo_analysis"

// setupNamespace is the UUIDv5 namespace the derived step ids live in. A fixed
// random UUID, generated once for this purpose: v5 needs a namespace, and
// reusing a published one (DNS, URL) would mean our ids collide with anyone
// else deriving from the same string.
var setupNamespace = uuid.MustParse("6f1f4b52-3a1e-5a7e-9c4e-2d8f0b6a41c7")

// StepOriginID derives the origin_id a step's issue carries, deterministically
// from the workspace and the step key.
//
// Deriving rather than storing is what lets the partial unique index in
// migration 447 be the once-only guarantee: the insert conflicts on a value
// the caller can compute without reading anything first, so a retry, a second
// tab, and a backfill all converge on the same row instead of racing to check
// then insert.
func StepOriginID(workspaceID uuid.UUID, step Step) uuid.UUID {
	return uuid.NewSHA1(setupNamespace, []byte(workspaceID.String()+"/"+string(step)))
}

// ParentOriginID is the parent issue's origin_id: the workspace's own id. It
// shares the index with the steps, so a workspace can only ever hold one.
func ParentOriginID(workspaceID uuid.UUID) uuid.UUID { return workspaceID }

// MetadataKey is the issue.metadata key holding the step this issue is. The
// origin_id already identifies it uniquely, but a derived UUID is unreadable;
// the metadata key is what makes an issue row explicable to a person reading
// the database, and what the checklist matches on.
const MetadataKey = "setup_step"

// ParentMetadataValue marks the parent. Written into the same metadata key so
// one read classifies every setup issue.
const ParentMetadataValue = "parent"

// Languages is the set the product ships copy for, in the order the fallback
// walks. English is first because it is the fallback.
var Languages = []string{"en", "zh", "ja", "ko"}

// NormalizeLanguage maps a client-supplied language onto one this package has
// copy for, falling back to English. It accepts the tags the frontend already
// sends ("zh-Hans", "zh-CN") rather than requiring an exact match, because the
// alternative is a Chinese workspace opening in English over a region suffix.
func NormalizeLanguage(raw string) string {
	lang := strings.ToLower(strings.TrimSpace(raw))
	if lang == "" {
		return "en"
	}
	if idx := strings.IndexAny(lang, "-_"); idx > 0 {
		lang = lang[:idx]
	}
	for _, known := range Languages {
		if lang == known {
			return lang
		}
	}
	return "en"
}

// Copy is one language's rendering of the whole checklist.
type Copy struct {
	// InboxTitle and InboxBody are the welcome item. The body is plain text:
	// the inbox renders it with whitespace preserved and no markdown, so
	// anything structured has to live on the issue instead.
	InboxTitle string
	InboxBody  string
	// ParentTitle takes the workspace name. ParentBody is markdown — it is the
	// one place that explains what Enact is, and the inbox item's detail pane
	// renders the issue, so this is what a new member actually reads.
	ParentTitle string
	ParentBody  string
	// Steps is keyed by Step; every key in Steps must be present.
	StepTitles map[Step]string
	StepBodies map[Step]string
}

// ParentTitleFor renders the parent title for a workspace name.
func (c Copy) ParentTitleFor(workspaceName string) string {
	return fmt.Sprintf(c.ParentTitle, strings.TrimSpace(workspaceName))
}

// For returns the copy for a language, falling back to English. The language
// must already have been through NormalizeLanguage.
func For(language string) Copy {
	if c, ok := copies[language]; ok {
		return c
	}
	return copies["en"]
}
