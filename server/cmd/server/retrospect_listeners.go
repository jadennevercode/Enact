package main

import (
	"context"
	"errors"
	"log/slog"

	"github.com/enact-ai/enact/server/internal/events"
	"github.com/enact-ai/enact/server/internal/handler"
	"github.com/enact-ai/enact/server/internal/service"
	"github.com/enact-ai/enact/server/internal/util"
	"github.com/enact-ai/enact/server/pkg/protocol"
)

// registerRetrospectListeners files a retrospect sub-issue when work finishes.
//
// It hangs off EventIssueUpdated rather than off the update handler because
// three code paths finish an issue — the single update, the batch update, and
// the GitHub webhook that advances an issue to done — and all three publish this
// event. The predecessor of this feature was called from the single-update
// handler only, so closing a batch of issues or closing one from a pull request
// never produced anything to learn from.
func registerRetrospectListeners(bus *events.Bus, svc *service.RetrospectService) {
	ctx := context.Background()

	bus.Subscribe(protocol.EventIssueUpdated, func(e events.Event) {
		payload, ok := e.Payload.(map[string]any)
		if !ok {
			return
		}
		if statusChanged, _ := payload["status_changed"].(bool); !statusChanged {
			return
		}
		rawID, ok := issueIDFromPayload(payload["issue"])
		if !ok {
			return
		}
		prevStatus, _ := payload["prev_status"].(string)

		workspaceID, err := util.ParseUUID(e.WorkspaceID)
		if err != nil {
			return
		}
		issueID, err := util.ParseUUID(rawID)
		if err != nil {
			return
		}

		// The bus is synchronous and runs on the request goroutine, so this
		// work sits inside the caller's response time. A workspace with no
		// Retrospect Agent — the overwhelmingly common case — pays one issue
		// read and one indexed agent lookup before stopping, the same shape of
		// cost the autopilot listener alongside it already pays.
		if err := svc.MaybeFileForFinishedIssue(ctx, workspaceID, issueID, prevStatus); err != nil {
			// A workspace that has not configured the agent is the ordinary
			// case, not something to log about on every close.
			if errors.Is(err, service.ErrNoRetrospectAgent) {
				return
			}
			slog.Warn("retrospect: file sub-issue failed",
				"error", err, "issue_id", rawID, "workspace_id", e.WorkspaceID)
		}
	})
}

// issueIDFromPayload reads the issue id out of an issue event, whichever of the
// two shapes the publisher used.
//
// EventIssueUpdated is published with handler.IssueResponse from the HTTP
// handlers and with service.IssueToMap from everything outside them — the
// background stuck-issue sweeper today, and anything later that resets a status
// without a request behind it. A listener that understood only the first would
// silently skip whichever paths grow into the second, which is exactly the gap
// this feature was moved onto the bus to close.
//
// Only the id is taken. Every other fact the filing rules need is read from the
// issue row, which cannot be stale the way a payload assembled before the write
// settled can be.
func issueIDFromPayload(v any) (string, bool) {
	if issue, ok := v.(handler.IssueResponse); ok {
		return issue.ID, issue.ID != ""
	}
	m, ok := v.(map[string]any)
	if !ok {
		return "", false
	}
	id, _ := m["id"].(string)
	return id, id != ""
}
