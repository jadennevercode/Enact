package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/enact-ai/enact/server/internal/ontologizer"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (h *Handler) semanticConstructionForIssue(w http.ResponseWriter, r *http.Request) {
	a, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	issueID, ok := semanticParam(w, r, "issueID")
	if !ok {
		return
	}
	if a.TaskID != nil && !h.semanticTaskPrincipal(w, r, &a) {
		return
	}
	var constructionID string
	err := h.DB.QueryRow(r.Context(), `WITH RECURSIVE ancestors AS (
		SELECT id,parent_issue_id FROM issue WHERE id=$2 AND workspace_id=$1
		UNION ALL SELECT i.id,i.parent_issue_id FROM issue i JOIN ancestors a ON a.parent_issue_id=i.id WHERE i.workspace_id=$1
	) SELECT c.id::text FROM semantic_construction c JOIN ancestors a ON a.id=c.issue_id
	WHERE c.workspace_id=$1 ORDER BY c.created_at DESC LIMIT 1`, a.WorkspaceID, issueID).Scan(&constructionID)
	if err == pgx.ErrNoRows {
		writeError(w, 404, "construction not found for this Issue tree")
		return
	}
	if err != nil {
		writeError(w, 500, "failed to resolve construction")
		return
	}
	writeJSON(w, 200, map[string]any{"construction_id": constructionID})
}

func (h *Handler) semanticGetConstructionAuthoring(w http.ResponseWriter, r *http.Request) {
	a, constructionID, _, ok := h.semanticConstructionScope(w, r)
	if !ok {
		return
	}
	h.semanticRow(w, r, 200, `SELECT jsonb_build_object('construction_id',id,'revision',authoring_revision,'interview',interview_state,'cards',candidate_cards,
		'coordinator_resume',(SELECT e.data->'coordinator_resume' FROM semantic_construction_event e WHERE e.workspace_id=semantic_construction.workspace_id AND e.construction_id=semantic_construction.id AND e.kind='human_decision' AND e.data ? 'coordinator_resume_message' ORDER BY e.created_at DESC,e.id DESC LIMIT 1))
		FROM semantic_construction WHERE workspace_id=$1 AND id=$2`, a.WorkspaceID, constructionID)
}

type semanticAuthoringError string

func (e semanticAuthoringError) Error() string  { return string(e) }
func errSemanticAuthoring(message string) error { return semanticAuthoringError(message) }

func mergeInterviewProposal(current, proposed ontologizer.InterviewState) (ontologizer.InterviewState, error) {
	if proposed.Round < current.Round {
		return current, errSemanticAuthoring("interview round cannot move backwards")
	}
	existing := make(map[string]ontologizer.InterviewQuestion, len(current.Questions))
	for _, question := range current.Questions {
		existing[question.Key] = question
	}
	newCount := 0
	merged := make([]ontologizer.InterviewQuestion, 0, len(proposed.Questions)+len(current.Questions))
	seen := map[string]bool{}
	for _, question := range proposed.Questions {
		question.Status = "unanswered"
		if prior, found := existing[question.Key]; found {
			if prior.Status == "answered" || prior.Status == "skipped" {
				question = prior
			}
		} else {
			newCount++
		}
		merged = append(merged, question)
		seen[question.Key] = true
	}
	for _, question := range current.Questions {
		if !seen[question.Key] {
			merged = append(merged, question)
		}
	}
	pendingCount := 0
	for _, question := range merged {
		if question.Status != "answered" && question.Status != "skipped" {
			pendingCount++
		}
	}
	if newCount > 3 || pendingCount > 5 {
		return current, errSemanticAuthoring("each round may add one to three questions and at most five questions may remain unanswered")
	}
	proposed.Questions = merged
	return proposed, nil
}

func mergeCandidateCardProposal(current, proposed []ontologizer.CandidateCard) []ontologizer.CandidateCard {
	existing := make(map[string]ontologizer.CandidateCard, len(current))
	for _, card := range current {
		existing[card.Key] = card
	}
	merged := make([]ontologizer.CandidateCard, 0, len(proposed)+len(current))
	seen := map[string]bool{}
	for _, card := range proposed {
		card.Status = "proposed"
		if prior, found := existing[card.Key]; found && prior.DecisionID != "" {
			card = prior
		}
		merged = append(merged, card)
		seen[card.Key] = true
	}
	for _, card := range current {
		if !seen[card.Key] && card.DecisionID != "" {
			merged = append(merged, card)
		}
	}
	return merged
}

func semanticCurrentConstructionStage(ctx context.Context, tx pgx.Tx, workspaceID, constructionID string) (string, error) {
	var stage string
	err := tx.QueryRow(ctx, `SELECT stage FROM semantic_construction WHERE workspace_id=$1 AND id=$2`, workspaceID, constructionID).Scan(&stage)
	return stage, err
}

func (h *Handler) semanticPatchConstructionAuthoring(w http.ResponseWriter, r *http.Request) {
	a, constructionID, _, ok := h.semanticConstructionScope(w, r)
	if !ok {
		return
	}
	if a.TaskID == nil || a.ActorType != "agent" {
		writeError(w, 403, "an active Family task may persist authoring proposals")
		return
	}
	var input struct {
		ExpectedRevision int64                       `json:"expected_revision"`
		Interview        ontologizer.InterviewState  `json:"interview"`
		Cards            []ontologizer.CandidateCard `json:"cards"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	if err := ontologizer.ValidateInterviewProposal(input.Interview); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	if err := ontologizer.ValidateCandidateCardProposal(input.Cards); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "failed to start authoring update")
		return
	}
	defer tx.Rollback(r.Context())
	var revision int64
	var interviewRaw, cardsRaw json.RawMessage
	err = tx.QueryRow(r.Context(), `SELECT authoring_revision,interview_state,candidate_cards FROM semantic_construction WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, a.WorkspaceID, constructionID).Scan(&revision, &interviewRaw, &cardsRaw)
	if err != nil {
		writeError(w, 404, "construction not found")
		return
	}
	if revision != input.ExpectedRevision {
		writeError(w, 409, "authoring state changed; reload before saving the proposal")
		return
	}
	var currentInterview ontologizer.InterviewState
	var currentCards []ontologizer.CandidateCard
	_ = json.Unmarshal(interviewRaw, &currentInterview)
	_ = json.Unmarshal(cardsRaw, &currentCards)
	mergedInterview, mergeErr := mergeInterviewProposal(currentInterview, input.Interview)
	if mergeErr != nil {
		writeError(w, 400, mergeErr.Error())
		return
	}
	mergedCards := mergeCandidateCardProposal(currentCards, input.Cards)
	var output json.RawMessage
	err = tx.QueryRow(r.Context(), `UPDATE semantic_construction SET authoring_revision=authoring_revision+1,interview_state=$3,candidate_cards=$4,updated_at=now()
		WHERE workspace_id=$1 AND id=$2 RETURNING jsonb_build_object('construction_id',id,'revision',authoring_revision,'interview',interview_state,'cards',candidate_cards)`,
		a.WorkspaceID, constructionID, semanticMarshal(mergedInterview), semanticMarshal(mergedCards)).Scan(&output)
	if err == nil {
		err = semanticInvalidateConstructionReviews(r.Context(), tx, a.WorkspaceID, constructionID)
	}
	eventStage := "scope"
	if err == nil {
		eventStage, err = semanticCurrentConstructionStage(r.Context(), tx, a.WorkspaceID, constructionID)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO semantic_construction_event(id,workspace_id,construction_id,task_id,actor_type,actor_id,stage,kind,message,data)
			VALUES($1,$2,$3,$4,$5,$6,$7,'artifact','Authoring proposal updated',$8)`, uuid.NewString(), a.WorkspaceID, constructionID, *a.TaskID, a.ActorType, a.ActorID, eventStage, semanticMarshal(map[string]any{"authoring_revision": revision + 1}))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, 500, "failed to persist authoring proposal")
		return
	}
	writeJSON(w, 200, output)
}

func (h *Handler) semanticRespondConstructionAuthoring(w http.ResponseWriter, r *http.Request) {
	a, constructionID, _, ok := h.semanticConstructionScope(w, r)
	if !ok {
		return
	}
	if a.TaskID != nil || a.ActorType == "agent" || isMachineCredentialActor(r) {
		writeError(w, 403, "only a signed-in workspace member may answer the interview")
		return
	}
	var input struct {
		ExpectedRevision int64 `json:"expected_revision"`
		Answers          []struct {
			QuestionKey string `json:"question_key"`
			Answer      string `json:"answer"`
			AnswerKind  string `json:"answer_kind"`
		} `json:"answers"`
		CardDecisions []struct {
			CardKey    string `json:"card_key"`
			Decision   string `json:"decision"`
			Rationale  string `json:"rationale"`
			Correction struct {
				Kind        string `json:"kind"`
				Label       string `json:"label"`
				Description string `json:"description"`
			} `json:"correction"`
		} `json:"card_decisions"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	if len(input.Answers) == 0 && len(input.CardDecisions) == 0 {
		writeError(w, 400, "at least one answer or card decision is required")
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "failed to start authoring response")
		return
	}
	defer tx.Rollback(r.Context())
	var revision int64
	var interviewRaw, cardsRaw json.RawMessage
	err = tx.QueryRow(r.Context(), `SELECT authoring_revision,interview_state,candidate_cards FROM semantic_construction WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, a.WorkspaceID, constructionID).Scan(&revision, &interviewRaw, &cardsRaw)
	if err != nil {
		writeError(w, 404, "construction not found")
		return
	}
	if revision != input.ExpectedRevision {
		writeError(w, 409, "authoring state changed; reload before responding")
		return
	}
	var interview ontologizer.InterviewState
	var cards []ontologizer.CandidateCard
	_ = json.Unmarshal(interviewRaw, &interview)
	_ = json.Unmarshal(cardsRaw, &cards)
	type decisionRecord struct {
		ID        string
		Gate      ontologizer.ReviewGate
		Decision  string
		Rationale string
	}
	decisions := make([]decisionRecord, 0, len(input.Answers)+len(input.CardDecisions))
	seenQuestions := make(map[string]struct{}, len(input.Answers))
	for _, answer := range input.Answers {
		if strings.TrimSpace(answer.QuestionKey) == "" || strings.TrimSpace(answer.Answer) == "" {
			writeError(w, 400, "answers require question_key and answer")
			return
		}
		if answer.AnswerKind != "" && answer.AnswerKind != "answer" && answer.AnswerKind != "unknown" {
			writeError(w, 400, "answer_kind must be answer or unknown")
			return
		}
		if _, duplicate := seenQuestions[answer.QuestionKey]; duplicate {
			writeError(w, 400, "an interview question may be answered only once per response")
			return
		}
		seenQuestions[answer.QuestionKey] = struct{}{}
		found := false
		for index := range interview.Questions {
			question := &interview.Questions[index]
			if question.Key != answer.QuestionKey {
				continue
			}
			found = true
			decisionID := uuid.NewString()
			question.Answer = strings.TrimSpace(answer.Answer)
			question.AnswerKind = "human_confirmation"
			if answer.AnswerKind == "unknown" {
				question.AnswerKind = "unknown"
			}
			question.AnsweredBy = a.UserID
			question.DecisionID = decisionID
			question.Status = "answered"
			gate := ontologizer.ReviewGateModel
			switch question.Topic {
			case "goal", "boundary", "decisions":
				gate = ontologizer.ReviewGateScope
			}
			decisions = append(decisions, decisionRecord{ID: decisionID, Gate: gate, Decision: "answer", Rationale: question.Answer})
			break
		}
		if !found {
			writeError(w, 400, "answer references an unknown interview question")
			return
		}
	}
	seenCards := make(map[string]struct{}, len(input.CardDecisions))
	for _, cardDecision := range input.CardDecisions {
		if _, duplicate := seenCards[cardDecision.CardKey]; duplicate {
			writeError(w, 400, "a candidate card may be decided only once per response")
			return
		}
		seenCards[cardDecision.CardKey] = struct{}{}
		switch cardDecision.Decision {
		case "confirm", "correct", "unknown", "reject":
		default:
			writeError(w, 400, "card decision must be confirm, correct, unknown or reject")
			return
		}
		if strings.TrimSpace(cardDecision.Rationale) == "" {
			writeError(w, 400, "card decisions require a rationale")
			return
		}
		if cardDecision.Decision == "correct" && strings.TrimSpace(cardDecision.Correction.Kind) == "" && strings.TrimSpace(cardDecision.Correction.Label) == "" && strings.TrimSpace(cardDecision.Correction.Description) == "" {
			writeError(w, 400, "corrected cards require at least one corrected field")
			return
		}
		found := false
		for index := range cards {
			card := &cards[index]
			if card.Key != cardDecision.CardKey {
				continue
			}
			found = true
			decisionID := uuid.NewString()
			switch cardDecision.Decision {
			case "confirm":
				card.Status = "confirmed"
				card.Classification = "human_confirmation"
			case "correct":
				if cardDecision.Correction.Kind != "" {
					candidate := *card
					candidate.Kind = cardDecision.Correction.Kind
					candidate.Classification = "recommendation"
					candidate.Status = "proposed"
					candidate.Rationale = ""
					candidate.DecidedBy = ""
					candidate.DecisionID = ""
					if err := ontologizer.ValidateCandidateCardProposal([]ontologizer.CandidateCard{candidate}); err != nil {
						writeError(w, 400, err.Error())
						return
					}
					card.Kind = cardDecision.Correction.Kind
				}
				if strings.TrimSpace(cardDecision.Correction.Label) != "" {
					card.Label = strings.TrimSpace(cardDecision.Correction.Label)
				}
				if strings.TrimSpace(cardDecision.Correction.Description) != "" {
					card.Description = strings.TrimSpace(cardDecision.Correction.Description)
				}
				card.Status = "corrected"
				card.Classification = "human_confirmation"
			case "unknown":
				card.Status = "unknown"
				card.Classification = "unknown"
			case "reject":
				card.Status = "rejected"
			}
			card.Rationale = strings.TrimSpace(cardDecision.Rationale)
			card.DecidedBy = a.UserID
			card.DecisionID = decisionID
			decisions = append(decisions, decisionRecord{ID: decisionID, Gate: ontologizer.ReviewGateModel, Decision: cardDecision.Decision, Rationale: card.Rationale})
			break
		}
		if !found {
			writeError(w, 400, "card decision references an unknown candidate card")
			return
		}
	}
	var output json.RawMessage
	resumeEventID := uuid.NewString()
	resumeMessage := "我已收到你对访谈问题和候选卡的决定。请读取最新已保存的答复，继续整理本体；只在仍有真实业务缺口时再提问。"
	err = tx.QueryRow(r.Context(), `UPDATE semantic_construction SET authoring_revision=authoring_revision+1,interview_state=$3,candidate_cards=$4,updated_at=now()
		WHERE workspace_id=$1 AND id=$2 RETURNING jsonb_build_object('construction_id',id,'revision',authoring_revision,'interview',interview_state,'cards',candidate_cards)`,
		a.WorkspaceID, constructionID, semanticMarshal(interview), semanticMarshal(cards)).Scan(&output)
	if err != nil {
		writeError(w, 500, "failed to save authoring response")
		return
	}
	digests, err := semanticConstructionReviewDigests(r.Context(), tx, a.WorkspaceID, constructionID)
	if err != nil {
		writeError(w, 500, "failed to digest authoring response")
		return
	}
	for _, decision := range decisions {
		_, err = tx.Exec(r.Context(), `INSERT INTO semantic_human_decision(id,workspace_id,construction_id,gate,decision,rationale,artifact_digest,review_subject_digest,decided_by)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, decision.ID, a.WorkspaceID, constructionID, decision.Gate, decision.Decision, decision.Rationale, digests.Artifact, digests.ByGate[decision.Gate], a.UserID)
		if err != nil {
			break
		}
	}
	if err == nil {
		err = semanticInvalidateConstructionReviews(r.Context(), tx, a.WorkspaceID, constructionID)
	}
	eventStage := "scope"
	if err == nil {
		eventStage, err = semanticCurrentConstructionStage(r.Context(), tx, a.WorkspaceID, constructionID)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO semantic_construction_event(id,workspace_id,construction_id,actor_type,actor_id,stage,kind,message,data)
			VALUES($1,$2,$3,$4,$5,$6,'human_decision','Authoring interview response recorded',$7)`, resumeEventID, a.WorkspaceID, constructionID, a.ActorType, a.ActorID, eventStage, semanticMarshal(map[string]any{"authoring_revision": revision + 1, "decision_count": len(decisions), "coordinator_resume_status": "pending", "coordinator_resume_message": resumeMessage}))
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, 500, "failed to persist authoring response")
		return
	}
	resume := h.semanticResumeConstructionCoordinator(r, a.WorkspaceID, constructionID, resumeEventID, resumeMessage)
	var response map[string]any
	if json.Unmarshal(output, &response) != nil {
		response = map[string]any{"construction_id": constructionID, "revision": revision + 1}
	}
	response["coordinator_resume"] = resume
	writeJSON(w, 200, response)
}
