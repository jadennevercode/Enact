package handler

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/enact-ai/enact/server/internal/logger"
	"github.com/enact-ai/enact/server/internal/service"
	"github.com/enact-ai/enact/server/internal/workspaceprofile"
	"github.com/enact-ai/enact/server/internal/workspacesetup"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
)

// Reading a newly connected repository into the workspace profile.
//
// A team says what their project is in a sentence. What it is actually built
// in — the languages, the frameworks, how it is built and tested, how it is
// laid out — is written down already, in the repository. Asking a member to
// retype it is asking them for something a run could read in a minute.
//
// So the first time a workspace connects a resource, and only if it already
// has a profile and a Mika to do it, one issue is filed asking Mika to read
// the tree and write `repo_brief` back.
//
// Why an issue and not a chat turn: Mika's own instructions forbid checking
// out a repository inside a chat turn, and rightly — the checkout happens on
// the runtime host, takes real time, and its result belongs somewhere a person
// can find it. `enact repo checkout` is only available to a task.
//
// Why it is gated rather than automatic:
//
//   - No profile yet → the member has not said what the project is, and a
//     repository brief attached to nothing is a report nobody asked for. The
//     profile step comes first in the checklist for this reason.
//   - No Mika → nothing to assign it to. A workspace with no runtime cannot
//     read a repository at all, and the checklist's repository step closes on
//     the resource alone in that case.
//   - Already has a brief covering this resource → nothing to do.
//
// Migration 448's partial unique index is the once-only guarantee: a resource
// that is edited re-enters this code, and the index is why an edit cannot
// produce a second analysis of the same tree.

// repoAnalysisAssignableTypes are the resource kinds worth reading. A resource
// this workspace cannot check out is not worth filing an issue about.
var repoAnalysisAssignableTypes = map[string]bool{
	"github_repo":     true,
	"local_directory": true,
}

// maybeFileRepositoryAnalysis considers filing the analysis issue for a
// resource that was just attached, and reports the issue if it filed one.
//
// Every failure here is logged and swallowed. The member's action was adding a
// resource; that succeeded, and failing their request because an optional
// follow-up could not be filed would be the wrong trade. The next resource
// they add, or the next read of the setup checklist, is another chance.
func (h *Handler) maybeFileRepositoryAnalysis(
	r *http.Request,
	ws db.Workspace,
	resource db.WorkspaceResource,
	requestedBy string,
) *db.Issue {
	if !repoAnalysisAssignableTypes[resource.ResourceType] {
		return nil
	}

	profile := workspaceprofile.Parse(ws.Profile)
	if profile.IsEmpty() {
		return nil
	}
	if profile.CoversResource(uuidToString(resource.ID)) {
		return nil
	}

	mika, err := h.Queries.GetAgentBySystemKey(r.Context(), db.GetAgentBySystemKeyParams{
		WorkspaceID: ws.ID,
		SystemKey:   pgtype.Text{String: service.MikaSystemKey, Valid: true},
	})
	if err != nil {
		// No Mika: the workspace has not finished setup, or the owner archived
		// her. Either way there is nobody to assign this to.
		return nil
	}
	if !mika.RuntimeID.Valid {
		return nil
	}

	existing, err := h.Queries.CountIssuesByOrigin(r.Context(), db.CountIssuesByOriginParams{
		WorkspaceID: ws.ID,
		OriginType:  pgtype.Text{String: workspacesetup.RepoAnalysisOriginType, Valid: true},
		OriginID:    resource.ID,
	})
	if err != nil || existing > 0 {
		return nil
	}

	issue, err := h.fileRepositoryAnalysisIssue(r.Context(), ws, resource, mika, requestedBy)
	if err != nil {
		slog.Warn("file repository analysis issue failed",
			append(logger.RequestAttrs(r), "error", err, "resource_id", uuidToString(resource.ID))...)
		return nil
	}
	return issue
}

// fileRepositoryAnalysisIssue writes the issue and assigns it to Mika.
//
// It goes through IssueService.Create rather than inserting directly, because
// that is what enqueues the agent task: an agent-assigned `todo` issue starts
// its agent, and a raw insert would file an issue that sits there. The same
// call also emits the broadcast that puts it in an open issue list.
func (h *Handler) fileRepositoryAnalysisIssue(
	ctx context.Context,
	ws db.Workspace,
	resource db.WorkspaceResource,
	mika db.Agent,
	requestedBy string,
) (*db.Issue, error) {
	result, err := h.IssueService.Create(ctx, service.IssueCreateParams{
		WorkspaceID: ws.ID,
		Title:       repositoryAnalysisTitle(resource),
		Description: strOrNullText(repositoryAnalysisBody(resource)),
		// `todo` rather than `backlog`: an agent-assigned todo issue starts the
		// agent, and the point of filing this is that it runs now.
		Status:       "todo",
		Priority:     "low",
		AssigneeType: pgtype.Text{String: "agent", Valid: true},
		AssigneeID:   mika.ID,
		// Filed in the member's name so it lands in their subscriptions and
		// they see the result. The product's authorship is carried by
		// origin_type, not by the creator.
		CreatorType: "member",
		CreatorID:   parseUUID(requestedBy),
		OriginType:  pgtype.Text{String: workspacesetup.RepoAnalysisOriginType, Valid: true},
		OriginID:    resource.ID,
		// The duplicate guard keys on (workspace, parent, normalized title),
		// which would suppress a legitimate analysis of a second repository
		// whose label happens to be absent. Once-only here is migration 448's
		// index, not the guard.
		AllowDuplicate: true,
	}, service.IssueCreateOpts{
		BroadcastPayload: func(created db.Issue, _ []db.Attachment, _ []db.IssueLabel) map[string]any {
			return map[string]any{
				"issue": service.IssueToMapWithCategory(ctx, h.Queries, created, ws.IssuePrefix),
			}
		},
	})
	if err != nil {
		return nil, fmt.Errorf("create issue: %w", err)
	}
	return &result.Issue, nil
}

func repositoryAnalysisTitle(resource db.WorkspaceResource) string {
	if label := strings.TrimSpace(resource.Label.String); label != "" {
		return "Read " + label + " into the project profile"
	}
	return "Read the connected repository into the project profile"
}

// repositoryAnalysisBody is the whole brief for the run. It is written for an
// agent that never saw the conversation that produced it, because that is
// exactly what will execute it: a fresh run, claiming this issue, with only
// the workspace's own context.
func repositoryAnalysisBody(resource db.WorkspaceResource) string {
	return fmt.Sprintf(`A repository was just connected to this workspace. Read it and write what you find into the workspace's project profile, so every later run starts knowing how this codebase is actually built.

## What to do

1. Check the repository out with `+"`enact repo checkout`"+`. The resource id is `+"`%s`"+`; `+"`enact resource list --output json`"+` gives you its URL or path.
2. Read enough to answer the questions below. README, the package or module manifests, the CI configuration, and the top two levels of the directory tree are usually enough. Do not read the whole tree.
3. Write the answers into the profile.

## What to write

Load the built-in `+"`enact-workspace-profile`"+` skill for how the profile is written, then set two fields and leave the rest of the document exactly as you found it:

- `+"`repo_brief`"+` — languages and frameworks, how it is built, how it is tested, how the tree is laid out, and any convention a later run would otherwise have to discover by getting it wrong. Prose and short lists, not a file dump.
- `+"`repo_brief_sources`"+` — the existing values plus `+"`%s`"+`, so a second repository connected later is analysed and this one is not analysed twice.

Read the current profile first and send it back with these two fields changed. The write is a replace, so a field you omit is cleared. `+"`stack`"+` is the one other field worth updating: if the repository shows technologies the member did not name, add them.

## What not to do

Do not change `+"`summary`"+`, `+"`domain`"+`, `+"`typical_work`"+` or `+"`constraints`"+`. Those are the team's own words about their project, and a repository is evidence about the code rather than about what the team is trying to do.

Do not open a pull request, change any file, or run a build. This is a read.

When the profile is written, comment with what you found in a few sentences and close the issue.`,
		uuidToString(resource.ID), uuidToString(resource.ID))
}
