package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/enact-ai/enact/server/internal/skillversion"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/dbid"
	"github.com/enact-ai/enact/server/pkg/protocol"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Deciding a lesson.
//
// Only a person may approve or reject, and the guard is deliberately doubled:
//
//   - RequireHumanActor on the route rejects mat_ task tokens and mcn_ cloud
//     PATs by their server-stamped X-Actor-Source header. That is the
//     authoritative check and it catches the agent process itself.
//   - requireHumanLessonActor here additionally refuses a request that
//     resolveActor classifies as an agent. That covers the legacy CLI path,
//     where a member token carries X-Agent-ID plus a matching X-Task-ID and is
//     attributed to the agent for authorship purposes. Attribution and
//     authorization are different questions, and a request that would be
//     recorded as "the agent said this" must not be recorded as "a person
//     approved this".
//
// One of these alone would be enough today. Both are here because the failure
// they prevent is an agent quietly approving its own proposal, and that failure
// is invisible afterwards: the published skill looks exactly like one a human
// approved.

type LessonDecisionRequest struct {
	Reason string `json:"reason,omitempty"`
}

const maxLessonDecisionReasonLen = 4_000

// requireHumanLessonActor reports whether this request may decide a lesson. See
// the file header for why both checks are here.
func (h *Handler) requireHumanLessonActor(w http.ResponseWriter, r *http.Request, workspaceID string) (string, bool) {
	if isMachineCredentialActor(r) {
		writeError(w, http.StatusForbidden, "only a person can decide a lesson")
		return "", false
	}
	userID := requestUserID(r)
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return "", false
	}
	if actorType, _ := h.resolveActor(r, userID, workspaceID); actorType == "agent" {
		writeError(w, http.StatusForbidden, "only a person can decide a lesson")
		return "", false
	}
	return userID, true
}

// canDecideLesson reports whether the caller may approve or reject.
//
// For a lesson targeting an existing skill this is exactly the permission to
// change that skill: creator, or workspace owner/admin. Approving a lesson and
// editing the skill by hand have the same effect, so gating them differently
// would only decide which door someone walks through.
//
// A lesson proposing a new skill has no creator to defer to, so it needs an
// owner or admin.
func (h *Handler) canDecideLesson(w http.ResponseWriter, r *http.Request, lesson db.Lesson) bool {
	if lesson.TargetSkillID.Valid {
		skill, err := h.Queries.GetSkill(r.Context(), lesson.TargetSkillID)
		if err != nil {
			writeError(w, http.StatusNotFound, "target skill not found")
			return false
		}
		return h.canManageSkill(w, r, skill)
	}
	if _, ok := h.requireWorkspaceRole(w, r, uuidToString(lesson.WorkspaceID),
		"lesson not found", "owner", "admin"); !ok {
		return false
	}
	return true
}

// ApproveLesson approves and publishes in one transaction.
//
// There is no separate "approved, not yet applied" state, and that is on
// purpose. A gate whose decision and whose effect can drift apart gives two
// answers to "is this rule in force", and the useful one is whichever the agent
// runtime happens to read. Approving is applying.
func (h *Handler) ApproveLesson(w http.ResponseWriter, r *http.Request) {
	lesson, ok := h.loadLessonForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	userID, ok := h.requireHumanLessonActor(w, r, uuidToString(lesson.WorkspaceID))
	if !ok {
		return
	}
	if !h.canDecideLesson(w, r, lesson) {
		return
	}
	if lesson.Status != lessonStatusProposed && lesson.Status != lessonStatusInReview {
		writeError(w, http.StatusConflict, "this lesson has already been decided")
		return
	}

	var req LessonDecisionRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	if len(req.Reason) > maxLessonDecisionReasonLen {
		writeError(w, http.StatusBadRequest, "reason is too long")
		return
	}

	published, skillResp, status, msg := h.publishLesson(r.Context(), lesson, parseUUID(userID), sanitizeNullBytes(strings.TrimSpace(req.Reason)))
	if status != 0 {
		writeError(w, status, msg)
		return
	}

	wsID := uuidToString(published.WorkspaceID)
	actorType, actorID := h.resolveActor(r, userID, wsID)
	if skillResp != nil {
		h.publish(protocol.EventSkillUpdated, wsID, actorType, actorID, map[string]any{"skill": *skillResp})
	}
	h.publishLessonEvent(protocol.EventLessonDecided, published, actorType, actorID)
	h.notifyLessonDecided(r.Context(), published, actorType, actorID)
	writeJSON(w, http.StatusOK, h.lessonDetail(r.Context(), published))
}

// publishLesson does the whole of publication in one transaction: build the new
// skill state, write it, snapshot it, and flip the lesson. Returns (lesson,
// skill response, 0, "") on success.
func (h *Handler) publishLesson(
	ctx context.Context,
	lesson db.Lesson,
	deciderID pgtype.UUID,
	reason string,
) (db.Lesson, *SkillWithFilesResponse, int, string) {
	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return db.Lesson{}, nil, http.StatusInternalServerError, "failed to start transaction"
	}
	defer tx.Rollback(ctx)
	qtx := h.Queries.WithTx(tx)

	_, proposed, _ := h.lessonSkillStates(ctx, lesson)
	files := make([]skillversion.File, 0, len(proposed.Files))
	for _, f := range proposed.Files {
		files = append(files, skillversion.File{Path: f.Path, Content: f.Content})
	}

	summary := "Published " + lessonKey(lesson.Number) + ": " + lesson.Title

	var (
		skillResp    SkillWithFilesResponse
		newVersionID pgtype.UUID
		targetSkill  pgtype.UUID
	)

	if lesson.NewAsset && !lesson.TargetSkillID.Valid {
		createFiles := make([]CreateSkillFileRequest, 0, len(files))
		for _, f := range files {
			createFiles = append(createFiles, CreateSkillFileRequest{Path: f.Path, Content: f.Content})
		}
		created, err := createSkillWithFilesInTx(ctx, qtx, skillCreateInput{
			WorkspaceID: lesson.WorkspaceID,
			CreatorID:   deciderID,
			Name:        firstNonEmpty(proposed.Name, lesson.ProposedSkillName),
			Description: proposed.Description,
			Content:     proposed.Content,
			Config:      lessonSkillConfig(lesson),
			Files:       createFiles,
			Source:      skillversion.SourceLesson,
		})
		if err != nil {
			if isUniqueViolation(err) {
				return db.Lesson{}, nil, http.StatusConflict, "a skill with this name already exists"
			}
			return db.Lesson{}, nil, http.StatusInternalServerError, "failed to create skill: " + err.Error()
		}
		skillResp = created
		targetSkill = parseUUID(created.ID)
		// The version the create just recorded is the skill's current one.
		if skill, err := qtx.GetSkill(ctx, targetSkill); err == nil {
			newVersionID = skill.CurrentVersionID
			// Attribute the version to the lesson that produced it, now that
			// the lesson id is knowable from inside this transaction.
			_ = qtx.SetSkillVersionLesson(ctx, db.SetSkillVersionLessonParams{
				ID:       skill.CurrentVersionID,
				LessonID: lesson.ID,
			})
		}
	} else {
		skill, err := qtx.GetSkillInWorkspace(ctx, db.GetSkillInWorkspaceParams{
			ID:          lesson.TargetSkillID,
			WorkspaceID: lesson.WorkspaceID,
		})
		if err != nil {
			return db.Lesson{}, nil, http.StatusNotFound, "target skill not found"
		}
		// The version check, again, at the moment of writing. The proposal was
		// refused at creation time if the skill had moved, but that was then;
		// this is the check that actually protects the reviewer, because it
		// runs inside the transaction that changes the skill.
		if !skill.CurrentVersionID.Valid || !lesson.BaseVersionID.Valid ||
			uuidToString(skill.CurrentVersionID) != uuidToString(lesson.BaseVersionID) {
			return db.Lesson{}, nil, http.StatusConflict,
				"the skill changed after this lesson was written; it must be rewritten against the current version"
		}

		updated, version, err := applySkillSnapshotInTx(ctx, qtx, skill, skillSnapshot{
			Name:        proposed.Name,
			Description: proposed.Description,
			Content:     proposed.Content,
			Config:      skill.Config,
			Files:       files,
		}, skillversion.SourceLesson, deciderID, lesson.ID, summary)
		if err != nil {
			if isUniqueViolation(err) {
				return db.Lesson{}, nil, http.StatusConflict, "a skill with this name already exists"
			}
			if errors.Is(err, pgx.ErrNoRows) {
				return db.Lesson{}, nil, http.StatusNotFound, "target skill not found"
			}
			return db.Lesson{}, nil, http.StatusInternalServerError, "failed to apply lesson: " + err.Error()
		}
		newVersionID = version.ID
		targetSkill = updated.ID

		fileRows, err := qtx.ListSkillFiles(ctx, updated.ID)
		if err != nil {
			return db.Lesson{}, nil, http.StatusInternalServerError, "failed to read skill files"
		}
		fileResps := make([]SkillFileResponse, len(fileRows))
		for i, f := range fileRows {
			fileResps[i] = skillFileToResponse(f)
		}
		skillResp = SkillWithFilesResponse{SkillResponse: skillToResponse(updated), Files: fileResps}
	}

	updatedLesson, err := qtx.PublishLesson(ctx, db.PublishLessonParams{
		ID:                 lesson.ID,
		TargetSkillID:      targetSkill,
		DecidedBy:          deciderID,
		DecisionReason:     reason,
		PublishedVersionID: newVersionID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Someone decided it between the read and this write.
			return db.Lesson{}, nil, http.StatusConflict, "this lesson has already been decided"
		}
		return db.Lesson{}, nil, http.StatusInternalServerError, "failed to publish lesson"
	}

	details, _ := json.Marshal(map[string]string{
		"skill_id":   uuidToString(targetSkill),
		"version_id": uuidToString(newVersionID),
	})
	if _, err := qtx.CreateLessonEvent(ctx, db.CreateLessonEventParams{
		LessonID:    lesson.ID,
		WorkspaceID: lesson.WorkspaceID,
		Kind:        lessonEventPublished,
		ActorType:   "member",
		ActorID:     deciderID,
		Note:        reason,
		Details:     details,
	}); err != nil {
		return db.Lesson{}, nil, http.StatusInternalServerError, "failed to record lesson event"
	}

	if err := tx.Commit(ctx); err != nil {
		return db.Lesson{}, nil, http.StatusInternalServerError, "failed to commit lesson publication"
	}
	return updatedLesson, &skillResp, 0, ""
}

// RejectLesson records a decision not to adopt. The row stays: the next person
// to have the same idea should be able to find out it was considered and why
// it was turned down.
func (h *Handler) RejectLesson(w http.ResponseWriter, r *http.Request) {
	lesson, ok := h.loadLessonForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	userID, ok := h.requireHumanLessonActor(w, r, uuidToString(lesson.WorkspaceID))
	if !ok {
		return
	}
	if !h.canDecideLesson(w, r, lesson) {
		return
	}

	var req LessonDecisionRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	if len(req.Reason) > maxLessonDecisionReasonLen {
		writeError(w, http.StatusBadRequest, "reason is too long")
		return
	}

	updated, err := h.Queries.RejectLesson(r.Context(), db.RejectLessonParams{
		ID:             lesson.ID,
		DecidedBy:      parseUUID(userID),
		DecisionReason: sanitizeNullBytes(strings.TrimSpace(req.Reason)),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusConflict, "this lesson has already been decided")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to reject lesson")
		return
	}

	if _, err := h.Queries.CreateLessonEvent(r.Context(), db.CreateLessonEventParams{
		LessonID:    updated.ID,
		WorkspaceID: updated.WorkspaceID,
		Kind:        lessonEventRejected,
		ActorType:   "member",
		ActorID:     parseUUID(userID),
		Note:        updated.DecisionReason,
		Details:     []byte("{}"),
	}); err != nil {
		logLessonEventFailure(updated, err)
	}

	actorType, actorID := h.resolveActor(r, userID, uuidToString(updated.WorkspaceID))
	h.publishLessonEvent(protocol.EventLessonDecided, updated, actorType, actorID)
	h.notifyLessonDecided(r.Context(), updated, actorType, actorID)
	writeJSON(w, http.StatusOK, h.lessonDetail(r.Context(), updated))
}

// DeprecateLesson withdraws a published lesson.
//
// It reverts the skill only when the skill still stands where this lesson left
// it. If anything has been written since, reverting would silently discard that
// work, so the lesson is marked withdrawn and the skill is left alone; the
// response says which of the two happened via reverted_version_id.
func (h *Handler) DeprecateLesson(w http.ResponseWriter, r *http.Request) {
	lesson, ok := h.loadLessonForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	userID, ok := h.requireHumanLessonActor(w, r, uuidToString(lesson.WorkspaceID))
	if !ok {
		return
	}
	if !h.canDecideLesson(w, r, lesson) {
		return
	}
	if lesson.Status != lessonStatusPublished {
		writeError(w, http.StatusConflict, "only a published lesson can be withdrawn")
		return
	}

	var req LessonDecisionRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	if len(req.Reason) > maxLessonDecisionReasonLen {
		writeError(w, http.StatusBadRequest, "reason is too long")
		return
	}
	reason := sanitizeNullBytes(strings.TrimSpace(req.Reason))
	if reason == "" {
		writeError(w, http.StatusBadRequest, "a reason is required to withdraw a lesson")
		return
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	var (
		revertedTo pgtype.UUID
		skillResp  *SkillWithFilesResponse
	)
	if lesson.TargetSkillID.Valid && lesson.PublishedVersionID.Valid {
		skill, err := qtx.GetSkillInWorkspace(r.Context(), db.GetSkillInWorkspaceParams{
			ID:          lesson.TargetSkillID,
			WorkspaceID: lesson.WorkspaceID,
		})
		if err == nil && skill.CurrentVersionID.Valid &&
			uuidToString(skill.CurrentVersionID) == uuidToString(lesson.PublishedVersionID) {
			published, perr := qtx.GetSkillVersion(r.Context(), lesson.PublishedVersionID)
			if perr == nil && published.Version > 1 {
				previous, verr := qtx.GetSkillVersionByNumber(r.Context(), db.GetSkillVersionByNumberParams{
					SkillID: skill.ID,
					Version: published.Version - 1,
				})
				if verr == nil {
					updated, version, aerr := applySkillSnapshotInTx(
						r.Context(), qtx, skill, snapshotFromVersion(previous),
						skillversion.SourceRollback, parseUUID(userID), lesson.ID,
						"Withdrew "+lessonKey(lesson.Number),
					)
					if aerr != nil {
						writeError(w, http.StatusInternalServerError, "failed to revert skill: "+aerr.Error())
						return
					}
					revertedTo = version.ID
					fileRows, ferr := qtx.ListSkillFiles(r.Context(), updated.ID)
					if ferr != nil {
						writeError(w, http.StatusInternalServerError, "failed to read skill files")
						return
					}
					fileResps := make([]SkillFileResponse, len(fileRows))
					for i, f := range fileRows {
						fileResps[i] = skillFileToResponse(f)
					}
					resp := SkillWithFilesResponse{SkillResponse: skillToResponse(updated), Files: fileResps}
					skillResp = &resp
				}
			}
		}
	}

	updated, err := qtx.DeprecateLesson(r.Context(), db.DeprecateLessonParams{
		ID:                lesson.ID,
		DeprecatedBy:      parseUUID(userID),
		DeprecationReason: reason,
		RevertedVersionID: revertedTo,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusConflict, "only a published lesson can be withdrawn")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to withdraw lesson")
		return
	}

	details, _ := json.Marshal(map[string]any{
		"reverted": revertedTo.Valid,
	})
	if _, err := qtx.CreateLessonEvent(r.Context(), db.CreateLessonEventParams{
		LessonID:    updated.ID,
		WorkspaceID: updated.WorkspaceID,
		Kind:        lessonEventDeprecated,
		ActorType:   "member",
		ActorID:     parseUUID(userID),
		Note:        reason,
		Details:     details,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to record lesson event")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit lesson withdrawal")
		return
	}

	wsID := uuidToString(updated.WorkspaceID)
	actorType, actorID := h.resolveActor(r, userID, wsID)
	if skillResp != nil {
		h.publish(protocol.EventSkillUpdated, wsID, actorType, actorID, map[string]any{"skill": *skillResp})
	}
	h.publishLessonEvent(protocol.EventLessonDecided, updated, actorType, actorID)
	writeJSON(w, http.StatusOK, h.lessonDetail(r.Context(), updated))
}

// --- Notifications and realtime ---

func (h *Handler) publishLessonEvent(eventType string, lesson db.Lesson, actorType, actorID string) {
	h.publish(eventType, uuidToString(lesson.WorkspaceID), actorType, actorID, map[string]any{
		"lesson": lessonToResponse(lesson),
	})
}

func logLessonEventFailure(lesson db.Lesson, err error) {
	slog.Error("lesson event write failed",
		"lesson_id", uuidToString(lesson.ID),
		"workspace_id", uuidToString(lesson.WorkspaceID),
		"error", err)
}

// notifyLessonProposed tells the people who can decide it that there is
// something to decide. Reviewers are the same set canDecideLesson admits:
// workspace owners and admins, plus the target skill's creator.
func (h *Handler) notifyLessonProposed(ctx context.Context, lesson db.Lesson, actorType, actorID string) {
	recipients := h.lessonReviewers(ctx, lesson)
	if len(recipients) == 0 {
		return
	}
	details, _ := json.Marshal(map[string]string{
		"lesson_id":  uuidToString(lesson.ID),
		"lesson_key": lessonKey(lesson.Number),
	})
	body := lesson.ChangeSummary
	for _, recipient := range recipients {
		if actorType == "member" && recipient == actorID {
			// Nobody needs telling about their own proposal.
			continue
		}
		if _, err := h.Queries.CreateInboxItem(ctx, db.CreateInboxItemParams{
			ID:            dbid.NewV7(),
			WorkspaceID:   lesson.WorkspaceID,
			RecipientType: "member",
			RecipientID:   parseUUID(recipient),
			Type:          "lesson_proposed",
			Severity:      "action_required",
			Title:         lessonKey(lesson.Number) + " " + lesson.Title,
			Body:          pgtype.Text{String: body, Valid: body != ""},
			ActorType:     pgtype.Text{String: actorType, Valid: true},
			ActorID:       optionalUUID(actorID),
			Details:       details,
		}); err != nil {
			slog.Error("lesson proposal inbox write failed",
				"lesson_id", uuidToString(lesson.ID), "error", err)
		}
	}
}

// notifyLessonDecided closes the loop for whoever proposed it. An agent has no
// inbox, so an agent-filed lesson notifies nobody here — the retrospective it
// came from is what a person looks at.
func (h *Handler) notifyLessonDecided(ctx context.Context, lesson db.Lesson, actorType, actorID string) {
	if lesson.ProposedByType != "member" || !lesson.ProposedByID.Valid {
		return
	}
	proposer := uuidToString(lesson.ProposedByID)
	if actorType == "member" && proposer == actorID {
		return
	}
	details, _ := json.Marshal(map[string]string{
		"lesson_id":  uuidToString(lesson.ID),
		"lesson_key": lessonKey(lesson.Number),
		"status":     lesson.Status,
	})
	if _, err := h.Queries.CreateInboxItem(ctx, db.CreateInboxItemParams{
		ID:            dbid.NewV7(),
		WorkspaceID:   lesson.WorkspaceID,
		RecipientType: "member",
		RecipientID:   lesson.ProposedByID,
		Type:          "lesson_decided",
		Severity:      "info",
		Title:         lessonKey(lesson.Number) + " " + lesson.Title,
		Body:          pgtype.Text{String: lesson.DecisionReason, Valid: lesson.DecisionReason != ""},
		ActorType:     pgtype.Text{String: actorType, Valid: true},
		ActorID:       optionalUUID(actorID),
		Details:       details,
	}); err != nil {
		slog.Error("lesson decision inbox write failed",
			"lesson_id", uuidToString(lesson.ID), "error", err)
	}
}

func (h *Handler) lessonReviewers(ctx context.Context, lesson db.Lesson) []string {
	seen := make(map[string]struct{}, 4)
	out := make([]string, 0, 4)
	add := func(id string) {
		if id == "" {
			return
		}
		if _, dup := seen[id]; dup {
			return
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}

	members, err := h.Queries.ListMembers(ctx, lesson.WorkspaceID)
	if err == nil {
		for _, m := range members {
			if roleAllowed(m.Role, "owner", "admin") {
				add(uuidToString(m.UserID))
			}
		}
	}
	if lesson.TargetSkillID.Valid {
		if skill, err := h.Queries.GetSkill(ctx, lesson.TargetSkillID); err == nil && skill.CreatedBy.Valid {
			add(uuidToString(skill.CreatedBy))
		}
	}
	return out
}

// lessonSkillConfig marks a skill created by a lesson, so the skills page can
// say where it came from the same way it does for imported ones.
func lessonSkillConfig(lesson db.Lesson) map[string]any {
	return map[string]any{
		"origin": map[string]any{
			"kind":       "lesson",
			"lesson_id":  uuidToString(lesson.ID),
			"lesson_key": lessonKey(lesson.Number),
		},
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
