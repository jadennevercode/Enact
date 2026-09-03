package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/enact-ai/enact/server/internal/skillversion"
	"github.com/enact-ai/enact/server/internal/util"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/protocol"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Lessons turn something learned from finished work into a reviewed change to a
// skill. The rules the endpoints in this file and lesson_decision.go enforce:
//
//  1. A proposal names a version. `base_version_id` is the skill_version the
//     proposal was written against; approval fails if the skill has moved. What
//     the reviewer read is what the reviewer approved.
//  2. A proposal states its own limits. `applies_when` and `counterexample` are
//     required, because a rule whose author cannot say where it stops is not
//     ready to affect every future run.
//  3. Only a person decides. Enforced in lesson_decision.go — see the header
//     there for why the guard is doubled.
//
// The one deliberate omission is an adoption-scope field. Which agents a lesson
// reaches is decided by which agents mount the target skill, and that is a fact
// the server reads at review time (see lessonAffectedAgents) rather than a
// second copy the proposer has to keep true.

const (
	lessonStatusProposed   = "proposed"
	lessonStatusInReview   = "in_review"
	lessonStatusPublished  = "published"
	lessonStatusRejected   = "rejected"
	lessonStatusDeprecated = "deprecated"
)

const (
	lessonEventProposed   = "proposed"
	lessonEventSubmitted  = "submitted"
	lessonEventApproved   = "approved"
	lessonEventRejected   = "rejected"
	lessonEventPublished  = "published"
	lessonEventDeprecated = "deprecated"
	lessonEventAmended    = "amended"
)

// Field limits. Generous enough that no honest proposal hits them, tight enough
// that a runaway agent cannot turn the review queue into a log sink.
const (
	maxLessonTitleLen    = 200
	maxLessonTextLen     = 20_000
	maxLessonContentLen  = 1 << 20
	maxLessonFiles       = 64
	maxLessonEvidence    = 20
	defaultLessonPageLen = 50
	maxLessonPageLen     = 200
)

// --- Request / response shapes ---

type LessonEvidence struct {
	// Kind is "task", "issue" or "comment": the three things that happened and
	// can be pointed at afterwards. Anything else is refused rather than stored,
	// so a reader can always resolve a reference to something real.
	Kind string `json:"kind"`
	ID   string `json:"id"`
	Note string `json:"note,omitempty"`
}

type LessonSkillFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// LessonSkillState is one complete side of the change: what the skill says now,
// or what it would say. Both sides are resolved server-side so a client never
// has to reconstruct "unchanged means look at the other side".
type LessonSkillState struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Content     string            `json:"content"`
	Files       []LessonSkillFile `json:"files"`
}

type LessonAffectedAgent struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
}

type LessonResponse struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspace_id"`
	Number      int32  `json:"number"`
	// Key is the number as people say it: LP-12.
	Key    string `json:"key"`
	Title  string `json:"title"`
	Status string `json:"status"`

	TargetKind      string  `json:"target_kind"`
	TargetSkillID   *string `json:"target_skill_id"`
	TargetSkillName string  `json:"target_skill_name,omitempty"`
	BaseVersionID   *string `json:"base_version_id"`
	BaseVersion     *int32  `json:"base_version,omitempty"`
	// BaseVersionCurrent is false once the skill has been changed by anything
	// else since this was written. A stale proposal cannot be approved; the UI
	// says so before the reviewer reads the diff rather than after.
	BaseVersionCurrent bool   `json:"base_version_current"`
	NewAsset           bool   `json:"new_asset"`
	ProposedSkillName  string `json:"proposed_skill_name,omitempty"`

	Observation    string           `json:"observation"`
	Evidence       []LessonEvidence `json:"evidence"`
	AppliesWhen    string           `json:"applies_when"`
	Counterexample string           `json:"counterexample"`
	ChangeSummary  string           `json:"change_summary"`

	RetrospectiveID *string `json:"retrospective_id"`
	SourceTaskID    *string `json:"source_task_id"`
	SourceIssueID   *string `json:"source_issue_id"`
	ProposedByType  string  `json:"proposed_by_type"`
	ProposedByID    *string `json:"proposed_by_id"`

	DecidedBy      *string `json:"decided_by"`
	DecidedAt      *string `json:"decided_at"`
	DecisionReason string  `json:"decision_reason"`

	PublishedVersionID *string `json:"published_version_id"`
	PublishedAt        *string `json:"published_at"`
	DeprecatedAt       *string `json:"deprecated_at"`
	DeprecationReason  string  `json:"deprecation_reason"`
	RevertedVersionID  *string `json:"reverted_version_id"`
	ParentLessonID     *string `json:"parent_lesson_id"`

	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type LessonEventResponse struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind"`
	ActorType string  `json:"actor_type"`
	ActorID   *string `json:"actor_id"`
	Note      string  `json:"note"`
	Details   any     `json:"details"`
	CreatedAt string  `json:"created_at"`
}

type LessonDetailResponse struct {
	LessonResponse
	// Base is what the target skill said when the proposal was written. Nil for
	// a lesson proposing a skill that does not exist yet.
	Base *LessonSkillState `json:"base"`
	// Proposed is the complete state the skill would have. Fields the proposal
	// left alone are filled in from Base, so the two are directly comparable.
	Proposed LessonSkillState `json:"proposed"`
	// AffectedAgents is the blast radius: who mounts this skill today.
	AffectedAgents []LessonAffectedAgent `json:"affected_agents"`
	Events         []LessonEventResponse `json:"events"`
}

func lessonKey(number int32) string { return "LP-" + strconv.Itoa(int(number)) }

func decodeLessonEvidence(raw []byte) []LessonEvidence {
	if len(raw) == 0 {
		return []LessonEvidence{}
	}
	var out []LessonEvidence
	if err := json.Unmarshal(raw, &out); err != nil {
		return []LessonEvidence{}
	}
	if out == nil {
		return []LessonEvidence{}
	}
	return out
}

func lessonToResponse(l db.Lesson) LessonResponse {
	return LessonResponse{
		ID:                 uuidToString(l.ID),
		WorkspaceID:        uuidToString(l.WorkspaceID),
		Number:             l.Number,
		Key:                lessonKey(l.Number),
		Title:              l.Title,
		Status:             l.Status,
		TargetKind:         l.TargetKind,
		TargetSkillID:      uuidToPtr(l.TargetSkillID),
		BaseVersionID:      uuidToPtr(l.BaseVersionID),
		NewAsset:           l.NewAsset,
		ProposedSkillName:  l.ProposedSkillName,
		Observation:        l.Observation,
		Evidence:           decodeLessonEvidence(l.Evidence),
		AppliesWhen:        l.AppliesWhen,
		Counterexample:     l.Counterexample,
		ChangeSummary:      l.ChangeSummary,
		RetrospectiveID:    uuidToPtr(l.RetrospectiveID),
		SourceTaskID:       uuidToPtr(l.SourceTaskID),
		SourceIssueID:      uuidToPtr(l.SourceIssueID),
		ProposedByType:     l.ProposedByType,
		ProposedByID:       uuidToPtr(l.ProposedByID),
		DecidedBy:          uuidToPtr(l.DecidedBy),
		DecidedAt:          timestampToPtr(l.DecidedAt),
		DecisionReason:     l.DecisionReason,
		PublishedVersionID: uuidToPtr(l.PublishedVersionID),
		PublishedAt:        timestampToPtr(l.PublishedAt),
		DeprecatedAt:       timestampToPtr(l.DeprecatedAt),
		DeprecationReason:  l.DeprecationReason,
		RevertedVersionID:  uuidToPtr(l.RevertedVersionID),
		ParentLessonID:     uuidToPtr(l.ParentLessonID),
		CreatedAt:          timestampToString(l.CreatedAt),
		UpdatedAt:          timestampToString(l.UpdatedAt),
	}
}

func lessonEventToResponse(e db.LessonEvent) LessonEventResponse {
	var details any
	if len(e.Details) > 0 {
		_ = json.Unmarshal(e.Details, &details)
	}
	return LessonEventResponse{
		ID:        uuidToString(e.ID),
		Kind:      e.Kind,
		ActorType: e.ActorType,
		ActorID:   uuidToPtr(e.ActorID),
		Note:      e.Note,
		Details:   details,
		CreatedAt: timestampToString(e.CreatedAt),
	}
}

// --- Shared loading ---

// loadLessonForUser resolves a lesson the caller may see. Workspace membership
// is the whole gate for reading: a lesson is a proposal about how this
// workspace's agents will behave, and hiding it from the people it will affect
// serves nobody.
func (h *Handler) loadLessonForUser(w http.ResponseWriter, r *http.Request, id string) (db.Lesson, bool) {
	lessonUUID, ok := parseUUIDOrBadRequest(w, id, "lesson id")
	if !ok {
		return db.Lesson{}, false
	}
	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace not specified")
		return db.Lesson{}, false
	}
	if _, ok := h.requireWorkspaceRole(w, r, workspaceID, "lesson not found", "owner", "admin", "member"); !ok {
		return db.Lesson{}, false
	}
	lesson, err := h.Queries.GetLessonInWorkspace(r.Context(), db.GetLessonInWorkspaceParams{
		ID:          lessonUUID,
		WorkspaceID: parseUUID(workspaceID),
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "lesson not found")
		return db.Lesson{}, false
	}
	return lesson, true
}

// lessonAffectedAgents answers "who is going to behave differently if this is
// approved" from the binding table, at read time. The proposer does not supply
// it and cannot get it wrong.
func (h *Handler) lessonAffectedAgents(ctx context.Context, lesson db.Lesson) []LessonAffectedAgent {
	if !lesson.TargetSkillID.Valid {
		return []LessonAffectedAgent{}
	}
	rows, err := h.Queries.ListAgentSkillsByWorkspace(ctx, lesson.WorkspaceID)
	if err != nil {
		return []LessonAffectedAgent{}
	}
	target := uuidToString(lesson.TargetSkillID)
	out := make([]LessonAffectedAgent, 0, 4)
	seen := make(map[string]struct{}, 4)
	for _, row := range rows {
		if uuidToString(row.ID) != target {
			continue
		}
		agentID := uuidToString(row.AgentID)
		if _, dup := seen[agentID]; dup {
			continue
		}
		seen[agentID] = struct{}{}
		agent, err := h.Queries.GetAgent(ctx, row.AgentID)
		if err != nil {
			continue
		}
		out = append(out, LessonAffectedAgent{ID: agentID, Name: agent.Name, Enabled: row.Enabled})
	}
	return out
}

// lessonSkillStates resolves both sides of the change. The proposal stores only
// what it wants to change; everything else is inherited from the base version,
// and that resolution happens once, here, rather than in each client.
func (h *Handler) lessonSkillStates(ctx context.Context, lesson db.Lesson) (*LessonSkillState, LessonSkillState, bool) {
	var base *LessonSkillState
	baseCurrent := lesson.NewAsset

	if lesson.BaseVersionID.Valid {
		version, err := h.Queries.GetSkillVersion(ctx, lesson.BaseVersionID)
		if err == nil {
			files := skillversion.DecodeFiles(version.Files)
			state := LessonSkillState{
				Name:        version.Name,
				Description: version.Description,
				Content:     version.Content,
				Files:       make([]LessonSkillFile, 0, len(files)),
			}
			for _, f := range files {
				state.Files = append(state.Files, LessonSkillFile{Path: f.Path, Content: f.Content})
			}
			base = &state
		}
	}
	if lesson.TargetSkillID.Valid && lesson.BaseVersionID.Valid {
		if skill, err := h.Queries.GetSkill(ctx, lesson.TargetSkillID); err == nil {
			baseCurrent = skill.CurrentVersionID.Valid &&
				uuidToString(skill.CurrentVersionID) == uuidToString(lesson.BaseVersionID)
		}
	}

	proposed := LessonSkillState{Files: []LessonSkillFile{}}
	if base != nil {
		proposed = LessonSkillState{
			Name:        base.Name,
			Description: base.Description,
			Content:     base.Content,
			Files:       append([]LessonSkillFile(nil), base.Files...),
		}
	} else if lesson.NewAsset {
		proposed.Name = lesson.ProposedSkillName
	}
	if lesson.ProposedName.Valid {
		proposed.Name = lesson.ProposedName.String
	}
	if lesson.ProposedDescription.Valid {
		proposed.Description = lesson.ProposedDescription.String
	}
	if lesson.ProposedContent.Valid {
		proposed.Content = lesson.ProposedContent.String
	}
	if len(lesson.ProposedFiles) > 0 {
		files := skillversion.DecodeFiles(lesson.ProposedFiles)
		out := make([]LessonSkillFile, 0, len(files))
		for _, f := range files {
			out = append(out, LessonSkillFile{Path: f.Path, Content: f.Content})
		}
		proposed.Files = out
	}
	if proposed.Files == nil {
		proposed.Files = []LessonSkillFile{}
	}
	return base, proposed, baseCurrent
}

func (h *Handler) lessonDetail(ctx context.Context, lesson db.Lesson) LessonDetailResponse {
	resp := LessonDetailResponse{LessonResponse: lessonToResponse(lesson)}

	base, proposed, baseCurrent := h.lessonSkillStates(ctx, lesson)
	resp.Base = base
	resp.Proposed = proposed
	resp.BaseVersionCurrent = baseCurrent

	if lesson.BaseVersionID.Valid {
		if version, err := h.Queries.GetSkillVersion(ctx, lesson.BaseVersionID); err == nil {
			v := version.Version
			resp.BaseVersion = &v
		}
	}
	if lesson.TargetSkillID.Valid {
		if skill, err := h.Queries.GetSkill(ctx, lesson.TargetSkillID); err == nil {
			resp.TargetSkillName = skill.Name
		}
	}
	resp.AffectedAgents = h.lessonAffectedAgents(ctx, lesson)

	events, err := h.Queries.ListLessonEvents(ctx, lesson.ID)
	if err == nil {
		resp.Events = make([]LessonEventResponse, 0, len(events))
		for _, e := range events {
			resp.Events = append(resp.Events, lessonEventToResponse(e))
		}
	} else {
		resp.Events = []LessonEventResponse{}
	}
	return resp
}

// --- List / get ---

func (h *Handler) ListLessons(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace not specified")
		return
	}
	if _, ok := h.requireWorkspaceRole(w, r, workspaceID, "workspace not found", "owner", "admin", "member"); !ok {
		return
	}

	params := db.ListLessonsByWorkspaceParams{
		WorkspaceID: parseUUID(workspaceID),
		Limit:       int32(clampLimit(r.URL.Query().Get("limit"), defaultLessonPageLen, maxLessonPageLen)),
		Offset:      int32(parseOffset(r.URL.Query().Get("offset"))),
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		if !validLessonStatus(status) {
			writeError(w, http.StatusBadRequest, "invalid status")
			return
		}
		params.Status = pgtype.Text{String: status, Valid: true}
	}
	if skillID := strings.TrimSpace(r.URL.Query().Get("skill_id")); skillID != "" {
		skillUUID, ok := parseUUIDOrBadRequest(w, skillID, "skill id")
		if !ok {
			return
		}
		params.TargetSkillID = skillUUID
	}
	if retroID := strings.TrimSpace(r.URL.Query().Get("retrospective_id")); retroID != "" {
		retroUUID, ok := parseUUIDOrBadRequest(w, retroID, "retrospective id")
		if !ok {
			return
		}
		params.RetrospectiveID = retroUUID
	}

	rows, err := h.Queries.ListLessonsByWorkspace(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list lessons")
		return
	}

	lessons := make([]LessonResponse, 0, len(rows))
	for _, row := range rows {
		resp := lessonToResponse(row)
		if row.TargetSkillID.Valid {
			if skill, serr := h.Queries.GetSkill(r.Context(), row.TargetSkillID); serr == nil {
				resp.TargetSkillName = skill.Name
				resp.BaseVersionCurrent = row.BaseVersionID.Valid &&
					skill.CurrentVersionID.Valid &&
					uuidToString(skill.CurrentVersionID) == uuidToString(row.BaseVersionID)
			}
		} else {
			resp.BaseVersionCurrent = row.NewAsset
		}
		lessons = append(lessons, resp)
	}

	counts := map[string]int64{}
	if rows, cerr := h.Queries.CountLessonsByStatus(r.Context(), parseUUID(workspaceID)); cerr == nil {
		for _, row := range rows {
			counts[row.Status] = row.Count
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"lessons": lessons, "counts": counts})
}

func (h *Handler) GetLesson(w http.ResponseWriter, r *http.Request) {
	lesson, ok := h.loadLessonForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, h.lessonDetail(r.Context(), lesson))
}

func validLessonStatus(status string) bool {
	switch status {
	case lessonStatusProposed, lessonStatusInReview, lessonStatusPublished,
		lessonStatusRejected, lessonStatusDeprecated:
		return true
	}
	return false
}

func clampLimit(raw string, fallback, max int) int {
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return fallback
	}
	if n > max {
		return max
	}
	return n
}

func parseOffset(raw string) int {
	if raw == "" {
		return 0
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// --- Propose ---

type CreateLessonRequest struct {
	Title          string           `json:"title"`
	Observation    string           `json:"observation"`
	Evidence       []LessonEvidence `json:"evidence"`
	AppliesWhen    string           `json:"applies_when"`
	Counterexample string           `json:"counterexample"`
	ChangeSummary  string           `json:"change_summary"`

	TargetSkillID string `json:"target_skill_id,omitempty"`
	BaseVersionID string `json:"base_version_id,omitempty"`
	NewAsset      bool   `json:"new_asset,omitempty"`
	SkillName     string `json:"skill_name,omitempty"`

	ProposedName        *string           `json:"proposed_name,omitempty"`
	ProposedDescription *string           `json:"proposed_description,omitempty"`
	ProposedContent     *string           `json:"proposed_content,omitempty"`
	ProposedFiles       []LessonSkillFile `json:"proposed_files,omitempty"`

	RetrospectiveID string `json:"retrospective_id,omitempty"`
	SourceTaskID    string `json:"source_task_id,omitempty"`
	SourceIssueID   string `json:"source_issue_id,omitempty"`
	ParentLessonID  string `json:"parent_lesson_id,omitempty"`
}

// CreateLesson files a proposal. Any workspace member may file one, and so may
// an agent — that is the point, since the Lesson Learner is an agent. What
// nobody may do from here is change anything: this endpoint writes one row in
// `proposed` and nothing else.
func (h *Handler) CreateLesson(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace not specified")
		return
	}
	if _, ok := h.requireWorkspaceRole(w, r, workspaceID, "workspace not found", "owner", "admin", "member"); !ok {
		return
	}

	var req CreateLessonRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	workspaceUUID := parseUUID(workspaceID)
	userID := requestUserID(r)
	actorType, actorID := h.resolveActor(r, userID, workspaceID)

	prepared, status, msg := h.prepareLessonProposal(r.Context(), workspaceUUID, &req)
	if status != 0 {
		writeError(w, status, msg)
		return
	}

	evidence, err := json.Marshal(normalizeLessonEvidence(req.Evidence))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid evidence")
		return
	}

	params := db.CreateLessonParams{
		WorkspaceID:         workspaceUUID,
		Title:               sanitizeNullBytes(strings.TrimSpace(req.Title)),
		Status:              lessonStatusProposed,
		TargetKind:          "skill",
		TargetSkillID:       prepared.targetSkillID,
		BaseVersionID:       prepared.baseVersionID,
		NewAsset:            req.NewAsset,
		ProposedSkillName:   prepared.newSkillName,
		Observation:         sanitizeNullBytes(strings.TrimSpace(req.Observation)),
		Evidence:            evidence,
		AppliesWhen:         sanitizeNullBytes(strings.TrimSpace(req.AppliesWhen)),
		Counterexample:      sanitizeNullBytes(strings.TrimSpace(req.Counterexample)),
		ChangeSummary:       sanitizeNullBytes(strings.TrimSpace(req.ChangeSummary)),
		ProposedName:        ptrToText(sanitizeOptionalText(req.ProposedName)),
		ProposedDescription: ptrToText(sanitizeOptionalText(req.ProposedDescription)),
		ProposedContent:     ptrToText(sanitizeOptionalText(req.ProposedContent)),
		ProposedFiles:       prepared.proposedFiles,
		RetrospectiveID:     prepared.retrospectiveID,
		SourceTaskID:        prepared.sourceTaskID,
		SourceIssueID:       prepared.sourceIssueID,
		ProposedByType:      actorType,
		ProposedByID:        optionalUUID(actorID),
		ParentLessonID:      prepared.parentLessonID,
	}

	lesson, err := h.createLessonWithNumber(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create lesson: "+err.Error())
		return
	}

	if _, err := h.Queries.CreateLessonEvent(r.Context(), db.CreateLessonEventParams{
		LessonID:    lesson.ID,
		WorkspaceID: workspaceUUID,
		Kind:        lessonEventProposed,
		ActorType:   actorType,
		ActorID:     optionalUUID(actorID),
		Note:        lesson.ChangeSummary,
		Details:     []byte("{}"),
	}); err != nil {
		// The proposal exists and is the thing that matters; a missing history
		// line is worth logging, not worth failing the request over.
		logLessonEventFailure(lesson, err)
	}

	h.notifyLessonProposed(r.Context(), lesson, actorType, actorID)
	h.publishLessonEvent(protocol.EventLessonCreated, lesson, actorType, actorID)
	writeJSON(w, http.StatusCreated, h.lessonDetail(r.Context(), lesson))
}

type preparedLesson struct {
	targetSkillID   pgtype.UUID
	baseVersionID   pgtype.UUID
	newSkillName    string
	proposedFiles   []byte
	retrospectiveID pgtype.UUID
	sourceTaskID    pgtype.UUID
	sourceIssueID   pgtype.UUID
	parentLessonID  pgtype.UUID
}

// prepareLessonProposal validates the proposal and resolves its references.
// Returns (result, 0, "") when the proposal is admissible, or a status and a
// message to refuse it with.
//
// The version check is the interesting one. Proposing against a version that is
// no longer current is refused here rather than at approval, because the agent
// that wrote it can still do something about it now — re-read the skill and
// rewrite the change — whereas a reviewer looking at a stale diff a week later
// cannot.
func (h *Handler) prepareLessonProposal(ctx context.Context, workspaceID pgtype.UUID, req *CreateLessonRequest) (preparedLesson, int, string) {
	var out preparedLesson

	if strings.TrimSpace(req.Title) == "" {
		return out, http.StatusBadRequest, "title is required"
	}
	if len(req.Title) > maxLessonTitleLen {
		return out, http.StatusBadRequest, "title is too long"
	}
	for field, value := range map[string]string{
		"observation":    req.Observation,
		"applies_when":   req.AppliesWhen,
		"counterexample": req.Counterexample,
		"change_summary": req.ChangeSummary,
	} {
		if strings.TrimSpace(value) == "" {
			// applies_when and counterexample are required for the reason in
			// the file header: a rule with no stated boundary is a rule nobody
			// can review.
			return out, http.StatusBadRequest, field + " is required"
		}
		if len(value) > maxLessonTextLen {
			return out, http.StatusBadRequest, field + " is too long"
		}
	}
	if len(req.Evidence) > maxLessonEvidence {
		return out, http.StatusBadRequest, "too many evidence references"
	}
	for _, e := range req.Evidence {
		switch e.Kind {
		case "task", "issue", "comment":
		default:
			return out, http.StatusBadRequest, "evidence kind must be task, issue or comment"
		}
		if _, err := parseUUIDStrict(e.ID); err != nil {
			return out, http.StatusBadRequest, "evidence id must be a uuid"
		}
	}

	if req.ProposedContent != nil && len(*req.ProposedContent) > maxLessonContentLen {
		return out, http.StatusBadRequest, "proposed content is too long"
	}
	if len(req.ProposedFiles) > maxLessonFiles {
		return out, http.StatusBadRequest, "too many proposed files"
	}
	for _, f := range req.ProposedFiles {
		if !validateFilePath(f.Path) {
			return out, http.StatusBadRequest, "invalid file path: " + f.Path
		}
		if len(f.Content) > maxLessonContentLen {
			return out, http.StatusBadRequest, "proposed file is too long: " + f.Path
		}
	}

	hasChange := req.ProposedName != nil || req.ProposedDescription != nil ||
		req.ProposedContent != nil || req.ProposedFiles != nil
	if !hasChange {
		return out, http.StatusBadRequest, "a lesson must propose a change"
	}

	if req.NewAsset {
		name := sanitizeNullBytes(strings.TrimSpace(req.SkillName))
		if name == "" {
			return out, http.StatusBadRequest, "skill_name is required when new_asset is set"
		}
		if _, found, err := h.existingSkillIdentityByName(ctx, workspaceID, name); err != nil {
			return out, http.StatusInternalServerError, "failed to check skill name"
		} else if found {
			return out, http.StatusConflict, "a skill with this name already exists"
		}
		out.newSkillName = name
		if req.ProposedContent == nil || strings.TrimSpace(*req.ProposedContent) == "" {
			return out, http.StatusBadRequest, "proposed_content is required for a new skill"
		}
	} else {
		if strings.TrimSpace(req.TargetSkillID) == "" {
			return out, http.StatusBadRequest, "target_skill_id is required"
		}
		skillUUID, err := parseUUIDStrict(req.TargetSkillID)
		if err != nil {
			return out, http.StatusBadRequest, "target_skill_id must be a uuid"
		}
		skill, err := h.Queries.GetSkillInWorkspace(ctx, db.GetSkillInWorkspaceParams{
			ID:          skillUUID,
			WorkspaceID: workspaceID,
		})
		if err != nil {
			return out, http.StatusNotFound, "target skill not found"
		}
		out.targetSkillID = skill.ID

		if strings.TrimSpace(req.BaseVersionID) == "" {
			return out, http.StatusBadRequest, "base_version_id is required"
		}
		versionUUID, err := parseUUIDStrict(req.BaseVersionID)
		if err != nil {
			return out, http.StatusBadRequest, "base_version_id must be a uuid"
		}
		version, err := h.Queries.GetSkillVersion(ctx, versionUUID)
		if err != nil || uuidToString(version.SkillID) != uuidToString(skill.ID) {
			return out, http.StatusNotFound, "base version not found for this skill"
		}
		if !skill.CurrentVersionID.Valid || uuidToString(skill.CurrentVersionID) != uuidToString(version.ID) {
			return out, http.StatusConflict,
				"the skill has changed since this version; re-read it and propose against " + uuidToString(skill.CurrentVersionID)
		}
		out.baseVersionID = version.ID

		open, err := h.Queries.CountOpenLessonsForSkill(ctx, skill.ID)
		if err != nil {
			return out, http.StatusInternalServerError, "failed to check open lessons"
		}
		if open > 0 {
			return out, http.StatusConflict, "this skill already has a lesson awaiting review"
		}
	}

	if req.ProposedFiles != nil {
		files := make([]skillversion.File, 0, len(req.ProposedFiles))
		for _, f := range req.ProposedFiles {
			files = append(files, skillversion.File{
				Path:    sanitizeNullBytes(f.Path),
				Content: sanitizeNullBytes(f.Content),
			})
		}
		encoded, err := json.Marshal(files)
		if err != nil {
			return out, http.StatusBadRequest, "invalid proposed files"
		}
		out.proposedFiles = encoded
	}

	for _, ref := range []struct {
		raw    string
		target *pgtype.UUID
		label  string
	}{
		{req.RetrospectiveID, &out.retrospectiveID, "retrospective_id"},
		{req.SourceTaskID, &out.sourceTaskID, "source_task_id"},
		{req.SourceIssueID, &out.sourceIssueID, "source_issue_id"},
		{req.ParentLessonID, &out.parentLessonID, "parent_lesson_id"},
	} {
		if strings.TrimSpace(ref.raw) == "" {
			continue
		}
		parsed, err := parseUUIDStrict(ref.raw)
		if err != nil {
			return out, http.StatusBadRequest, ref.label + " must be a uuid"
		}
		*ref.target = parsed
	}

	return out, 0, ""
}

// createLessonWithNumber allocates the workspace-local LP number and inserts.
//
// The number comes from MAX+1 rather than a sequence, so two proposals filed at
// the same moment can pick the same one and the unique index rejects the
// loser. Retrying is correct and cheap; the alternative — a counter column on
// workspace — buys nothing at the rate lessons are filed.
func (h *Handler) createLessonWithNumber(ctx context.Context, params db.CreateLessonParams) (db.Lesson, error) {
	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		next, err := h.Queries.NextLessonNumber(ctx, params.WorkspaceID)
		if err != nil {
			return db.Lesson{}, err
		}
		params.Number = int32(next)
		lesson, err := h.Queries.CreateLesson(ctx, params)
		if err == nil {
			return lesson, nil
		}
		if !isUniqueViolation(err) {
			return db.Lesson{}, err
		}
		lastErr = err
	}
	return db.Lesson{}, lastErr
}

// --- Edit ---

type UpdateLessonRequest struct {
	Title               *string           `json:"title,omitempty"`
	Observation         *string           `json:"observation,omitempty"`
	Evidence            []LessonEvidence  `json:"evidence,omitempty"`
	AppliesWhen         *string           `json:"applies_when,omitempty"`
	Counterexample      *string           `json:"counterexample,omitempty"`
	ChangeSummary       *string           `json:"change_summary,omitempty"`
	ProposedName        *string           `json:"proposed_name,omitempty"`
	ProposedDescription *string           `json:"proposed_description,omitempty"`
	ProposedContent     *string           `json:"proposed_content,omitempty"`
	ProposedFiles       []LessonSkillFile `json:"proposed_files,omitempty"`
}

// UpdateLesson edits a proposal that has not been decided yet. The proposer and
// workspace admins may edit; a decided lesson is immutable, because the record
// of what was approved is the only thing that makes the approval mean anything.
func (h *Handler) UpdateLesson(w http.ResponseWriter, r *http.Request) {
	lesson, ok := h.loadLessonForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	if lesson.Status != lessonStatusProposed && lesson.Status != lessonStatusInReview {
		writeError(w, http.StatusConflict, "a decided lesson cannot be edited")
		return
	}
	if !h.canEditLesson(w, r, lesson) {
		return
	}

	var req UpdateLessonRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	params := db.UpdateLessonProposalParams{ID: lesson.ID}
	if req.Title != nil {
		if strings.TrimSpace(*req.Title) == "" || len(*req.Title) > maxLessonTitleLen {
			writeError(w, http.StatusBadRequest, "invalid title")
			return
		}
		params.Title = strToText(sanitizeNullBytes(strings.TrimSpace(*req.Title)))
	}
	for _, field := range []struct {
		value  *string
		target *pgtype.Text
		label  string
	}{
		{req.Observation, &params.Observation, "observation"},
		{req.AppliesWhen, &params.AppliesWhen, "applies_when"},
		{req.Counterexample, &params.Counterexample, "counterexample"},
		{req.ChangeSummary, &params.ChangeSummary, "change_summary"},
	} {
		if field.value == nil {
			continue
		}
		if strings.TrimSpace(*field.value) == "" {
			writeError(w, http.StatusBadRequest, field.label+" cannot be cleared")
			return
		}
		if len(*field.value) > maxLessonTextLen {
			writeError(w, http.StatusBadRequest, field.label+" is too long")
			return
		}
		*field.target = strToText(sanitizeNullBytes(strings.TrimSpace(*field.value)))
	}
	if req.Evidence != nil {
		if len(req.Evidence) > maxLessonEvidence {
			writeError(w, http.StatusBadRequest, "too many evidence references")
			return
		}
		encoded, err := json.Marshal(normalizeLessonEvidence(req.Evidence))
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid evidence")
			return
		}
		params.Evidence = encoded
	}
	if req.ProposedName != nil {
		params.ProposedName = ptrToText(sanitizeOptionalText(req.ProposedName))
	}
	if req.ProposedDescription != nil {
		params.ProposedDescription = ptrToText(sanitizeOptionalText(req.ProposedDescription))
	}
	if req.ProposedContent != nil {
		if len(*req.ProposedContent) > maxLessonContentLen {
			writeError(w, http.StatusBadRequest, "proposed content is too long")
			return
		}
		params.ProposedContent = ptrToText(sanitizeOptionalText(req.ProposedContent))
	}
	if req.ProposedFiles != nil {
		if len(req.ProposedFiles) > maxLessonFiles {
			writeError(w, http.StatusBadRequest, "too many proposed files")
			return
		}
		files := make([]skillversion.File, 0, len(req.ProposedFiles))
		for _, f := range req.ProposedFiles {
			if !validateFilePath(f.Path) {
				writeError(w, http.StatusBadRequest, "invalid file path: "+f.Path)
				return
			}
			files = append(files, skillversion.File{
				Path:    sanitizeNullBytes(f.Path),
				Content: sanitizeNullBytes(f.Content),
			})
		}
		encoded, err := json.Marshal(files)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid proposed files")
			return
		}
		params.ProposedFiles = encoded
	}

	updated, err := h.Queries.UpdateLessonProposal(r.Context(), params)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusConflict, "a decided lesson cannot be edited")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to update lesson")
		return
	}

	actorType, actorID := h.resolveActor(r, requestUserID(r), uuidToString(updated.WorkspaceID))
	h.publishLessonEvent(protocol.EventLessonUpdated, updated, actorType, actorID)
	writeJSON(w, http.StatusOK, h.lessonDetail(r.Context(), updated))
}

// canEditLesson allows the proposer and workspace owners/admins. A member who
// did not write it has no business rewriting what someone else is asking to be
// held to.
func (h *Handler) canEditLesson(w http.ResponseWriter, r *http.Request, lesson db.Lesson) bool {
	member, ok := h.requireWorkspaceRole(w, r, uuidToString(lesson.WorkspaceID), "lesson not found", "owner", "admin", "member")
	if !ok {
		return false
	}
	if roleAllowed(member.Role, "owner", "admin") {
		return true
	}
	if lesson.ProposedByType == "member" && lesson.ProposedByID.Valid &&
		uuidToString(lesson.ProposedByID) == requestUserID(r) {
		return true
	}
	writeError(w, http.StatusForbidden, "only the proposer or a workspace admin can edit this lesson")
	return false
}

// --- Small helpers ---

func normalizeLessonEvidence(in []LessonEvidence) []LessonEvidence {
	out := make([]LessonEvidence, 0, len(in))
	for _, e := range in {
		out = append(out, LessonEvidence{
			Kind: e.Kind,
			ID:   e.ID,
			Note: sanitizeNullBytes(e.Note),
		})
	}
	return out
}

func sanitizeOptionalText(v *string) *string {
	if v == nil {
		return nil
	}
	cleaned := sanitizeNullBytes(*v)
	return &cleaned
}

func optionalUUID(id string) pgtype.UUID {
	parsed, err := parseUUIDStrict(id)
	if err != nil {
		return pgtype.UUID{}
	}
	return parsed
}

// parseUUIDStrict is the checked parse for request-boundary ids that are not
// already covered by parseUUIDOrBadRequest, which writes its own response.
// Lesson validation collects a status and message instead, so it needs the
// error rather than the side effect.
func parseUUIDStrict(s string) (pgtype.UUID, error) {
	return util.ParseUUID(s)
}
