package service

import (
	"context"
	"errors"
	"log/slog"

	"github.com/enact-ai/enact/server/internal/util"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
)

// RetrospectiveService closes the loop on a Lesson Learner scan: when the run
// the retrospective launched ends, the retrospective ends with it.
//
// It exists as a service rather than a handler because nothing here is a
// request. The Learner finishes on its own schedule and the transition has to
// be recorded whether or not anyone is looking at the page.
type RetrospectiveService struct {
	Queries *db.Queries
}

func NewRetrospectiveService(queries *db.Queries) *RetrospectiveService {
	return &RetrospectiveService{Queries: queries}
}

// SyncFromTask records the outcome of the run a retrospective launched.
//
// The lesson count comes from counting the lessons that name this
// retrospective, not from anything the agent reports. An agent that says it
// filed three lessons and filed none would otherwise leave a row claiming work
// that is not there, and the count is what the list page shows.
func (s *RetrospectiveService) SyncFromTask(ctx context.Context, task db.AgentTaskQueue) {
	if !task.ID.Valid {
		return
	}
	retro, err := s.Queries.GetRetrospectiveByTask(ctx, task.ID)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.Debug("retrospective lookup by task failed",
				"task_id", util.UUIDToString(task.ID), "error", err)
		}
		return
	}
	if retro.Status != "queued" && retro.Status != "running" {
		return
	}

	switch task.Status {
	case "running":
		if _, err := s.Queries.MarkRetrospectiveRunning(ctx, retro.ID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("retrospective running transition failed",
				"retrospective_id", util.UUIDToString(retro.ID), "error", err)
		}
	case "completed":
		lessons, err := s.Queries.ListLessonsByRetrospective(ctx, retro.ID)
		if err != nil {
			slog.Warn("retrospective lesson count failed",
				"retrospective_id", util.UUIDToString(retro.ID), "error", err)
		}
		if _, err := s.Queries.CompleteRetrospective(ctx, db.CompleteRetrospectiveParams{
			ID:          retro.ID,
			LessonCount: int32(len(lessons)),
		}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("retrospective completion failed",
				"retrospective_id", util.UUIDToString(retro.ID), "error", err)
		}
	case "failed", "cancelled":
		reason := task.FailureReason.String
		if reason == "" {
			reason = task.Error.String
		}
		if reason == "" {
			reason = "the Lesson Learner run ended without finishing"
		}
		if _, err := s.Queries.FailRetrospective(ctx, db.FailRetrospectiveParams{
			ID:            retro.ID,
			FailureReason: reason,
		}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("retrospective failure transition failed",
				"retrospective_id", util.UUIDToString(retro.ID), "error", err)
		}
	}
}
