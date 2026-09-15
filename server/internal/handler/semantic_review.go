package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/enact-ai/enact/server/internal/ontologizer"
	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// registerSemanticReviewRoutes is intentionally separate from the semantic
// root router so the human-review contract can be integrated atomically with
// clients that parse its response envelopes.
func (h *Handler) registerSemanticReviewRoutes(r chi.Router) {
	r.Get("/constructions/for-issue/{issueID}", h.semanticConstructionForIssue)
	r.Get("/constructions/{id}/authoring", h.semanticGetConstructionAuthoring)
	r.Patch("/constructions/{id}/authoring/proposal", h.semanticPatchConstructionAuthoring)
	r.Post("/constructions/{id}/authoring/respond", h.semanticRespondConstructionAuthoring)
	r.Post("/constructions/{id}/resume", h.semanticResumeConstruction)
	r.Get("/constructions/{id}/review-subject", h.semanticGetReviewSubject)
	r.Get("/constructions/{id}/review-packets", h.semanticListReviewPackets)
	r.Post("/constructions/{id}/review-packets", h.semanticCreateReviewPacket)
	r.Post("/review-packets/{id}/decisions", h.semanticDecideReviewPacket)
}

type semanticReviewDigests struct {
	Artifact string
	ByGate   map[ontologizer.ReviewGate]string
}

type semanticReviewQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func semanticReviewSubject(artifact map[string]any, bindings json.RawMessage, gate ontologizer.ReviewGate) any {
	definition, _ := artifact["definition"].(map[string]any)
	nativeOntology, _ := artifact["native_ontology"].(map[string]any)
	switch gate {
	case ontologizer.ReviewGateModel:
		return map[string]any{
			"entities":      definition["entities"],
			"attributes":    definition["attributes"],
			"relationships": definition["relationships"],
			"classes":       nativeOntology["classes"],
			"properties":    nativeOntology["properties"],
		}
	case ontologizer.ReviewGateOperations:
		return map[string]any{
			"actions":         definition["actions"],
			"policies":        definition["policies"],
			"data_bindings":   definition["data_bindings"],
			"action_bindings": definition["action_bindings"],
			"native_rules":    artifact["native_rules"],
			"bindings":        artifact["bindings"],
			"binding_config":  bindings,
		}
	case ontologizer.ReviewGateRelease:
		return map[string]any{"artifact": artifact, "binding_config": bindings}
	default:
		return nil
	}
}

func semanticScopeReviewSubject(sourceSnapshots, competencyQuestions, interview json.RawMessage) any {
	var state struct {
		Scope     json.RawMessage `json:"scope"`
		Questions []struct {
			Topic      string          `json:"topic"`
			Key        string          `json:"key"`
			Answer     json.RawMessage `json:"answer"`
			AnswerKind string          `json:"answer_kind"`
		} `json:"questions"`
	}
	_ = json.Unmarshal(interview, &state)
	scopeAnswers := make([]any, 0)
	for _, question := range state.Questions {
		switch question.Topic {
		case "goal", "boundary", "decisions":
			scopeAnswers = append(scopeAnswers, map[string]any{
				"key": question.Key, "answer": question.Answer, "answer_kind": question.AnswerKind,
			})
		}
	}
	return map[string]any{
		"source_snapshot_ids":  sourceSnapshots,
		"competency_questions": competencyQuestions,
		"scope":                state.Scope,
		"scope_answers":        scopeAnswers,
	}
}

func semanticHumanAuthoringSubjects(interview, cards json.RawMessage) (model []any, operations []any) {
	var state ontologizer.InterviewState
	var candidates []ontologizer.CandidateCard
	_ = json.Unmarshal(interview, &state)
	_ = json.Unmarshal(cards, &candidates)
	for _, question := range state.Questions {
		if question.DecisionID == "" {
			continue
		}
		item := map[string]any{"key": question.Key, "topic": question.Topic, "answer": question.Answer, "answer_kind": question.AnswerKind, "decision_id": question.DecisionID}
		switch question.Topic {
		case "objects", "terminology", "granularity":
			model = append(model, item)
		case "process", "exceptions":
			operations = append(operations, item)
		}
	}
	for _, card := range candidates {
		if card.DecisionID == "" {
			continue
		}
		item := map[string]any{"key": card.Key, "kind": card.Kind, "label": card.Label, "description": card.Description, "classification": card.Classification, "status": card.Status, "rationale": card.Rationale, "decision_id": card.DecisionID}
		switch card.Kind {
		case "entity", "attribute", "relationship":
			model = append(model, item)
		case "action", "policy", "data_binding", "action_binding":
			operations = append(operations, item)
		}
	}
	sortAuthoring := func(items []any) {
		sort.SliceStable(items, func(i, j int) bool {
			left, _ := items[i].(map[string]any)
			right, _ := items[j].(map[string]any)
			leftType, rightType := "question", "question"
			if left["kind"] != nil {
				leftType = "card"
			}
			if right["kind"] != nil {
				rightType = "card"
			}
			leftKey, _ := left["key"].(string)
			rightKey, _ := right["key"].(string)
			return leftType+":"+leftKey < rightType+":"+rightKey
		})
	}
	sortAuthoring(model)
	sortAuthoring(operations)
	return model, operations
}

func semanticConstructionReviewDigests(ctx context.Context, q semanticReviewQuerier, workspaceID, constructionID string) (semanticReviewDigests, error) {
	digests, _, err := semanticConstructionReviewState(ctx, q, workspaceID, constructionID)
	return digests, err
}

func semanticConstructionReviewState(ctx context.Context, q semanticReviewQuerier, workspaceID, constructionID string) (semanticReviewDigests, map[ontologizer.ReviewGate]any, error) {
	var bundle, bindings, sources, questions, interview, cards json.RawMessage
	err := q.QueryRow(ctx, `SELECT o.bundle,o.binding_config,c.source_snapshot_ids,c.competency_questions,c.interview_state,c.candidate_cards
		FROM semantic_construction c JOIN semantic_ontology o ON o.id=c.ontology_id AND o.workspace_id=c.workspace_id
		WHERE c.workspace_id=$1 AND c.id=$2`, workspaceID, constructionID).Scan(&bundle, &bindings, &sources, &questions, &interview, &cards)
	if err != nil {
		return semanticReviewDigests{}, nil, err
	}
	var envelope struct {
		Artifact map[string]any `json:"native_artifact"`
	}
	_ = json.Unmarshal(bundle, &envelope)
	if envelope.Artifact == nil {
		envelope.Artifact = map[string]any{}
	}
	digests := semanticReviewDigests{Artifact: semantic.Digest(envelope.Artifact), ByGate: map[ontologizer.ReviewGate]string{}}
	subjects := map[ontologizer.ReviewGate]any{ontologizer.ReviewGateScope: semanticScopeReviewSubject(sources, questions, interview)}
	digests.ByGate[ontologizer.ReviewGateScope] = semantic.Digest(subjects[ontologizer.ReviewGateScope])
	modelAuthoring, operationsAuthoring := semanticHumanAuthoringSubjects(interview, cards)
	for _, gate := range []ontologizer.ReviewGate{ontologizer.ReviewGateModel, ontologizer.ReviewGateOperations, ontologizer.ReviewGateRelease} {
		subjects[gate] = semanticReviewSubject(envelope.Artifact, bindings, gate)
		if section, ok := subjects[gate].(map[string]any); ok {
			switch gate {
			case ontologizer.ReviewGateModel:
				if len(modelAuthoring) > 0 {
					section["human_authoring"] = modelAuthoring
				}
			case ontologizer.ReviewGateOperations:
				if len(operationsAuthoring) > 0 {
					section["human_authoring"] = operationsAuthoring
				}
			}
		}
		digests.ByGate[gate] = semantic.Digest(subjects[gate])
	}
	return digests, subjects, nil
}

func (h *Handler) semanticGetReviewSubject(w http.ResponseWriter, r *http.Request) {
	a, constructionID, _, ok := h.semanticConstructionScope(w, r)
	if !ok {
		return
	}
	gate, valid := ontologizer.ParseReviewGate(r.URL.Query().Get("gate"))
	if !valid {
		writeError(w, 400, "gate must be scope, model, operations or release")
		return
	}
	var currentGate string
	if err := h.DB.QueryRow(r.Context(), `SELECT stage FROM semantic_construction WHERE workspace_id=$1 AND id=$2`, a.WorkspaceID, constructionID).Scan(&currentGate); err != nil {
		writeError(w, 404, "construction not found")
		return
	}
	if currentGate != string(gate) {
		writeError(w, 409, "requested review subject is not the construction's current gate")
		return
	}
	digests, subjects, err := semanticConstructionReviewState(r.Context(), h.DB, a.WorkspaceID, constructionID)
	if err != nil {
		writeError(w, 500, "failed to calculate review subject")
		return
	}
	writeJSON(w, 200, map[string]any{"construction_id": constructionID, "gate": gate, "artifact_digest": digests.Artifact, "review_subject_digest": digests.ByGate[gate], "subject": subjects[gate]})
}

func semanticReviewGateValues(gates []ontologizer.ReviewGate) []string {
	values := make([]string, len(gates))
	for index, gate := range gates {
		values[index] = string(gate)
	}
	return values
}

// semanticInvalidateConstructionReviews compares each active review to the
// section it approved. It invalidates only that section and dependent gates.
func semanticInvalidateConstructionReviews(ctx context.Context, tx pgx.Tx, workspaceID, constructionID string) error {
	digests, err := semanticConstructionReviewDigests(ctx, tx, workspaceID, constructionID)
	if err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT gate,review_subject_digest FROM semantic_review_packet
		WHERE workspace_id=$1 AND construction_id=$2 AND status IN ('pending','approved')
		ORDER BY sequence DESC`, workspaceID, constructionID)
	if err != nil {
		return err
	}
	defer rows.Close()
	var changed []ontologizer.ReviewGate
	seen := map[ontologizer.ReviewGate]bool{}
	for rows.Next() {
		var gateValue, reviewed string
		if err = rows.Scan(&gateValue, &reviewed); err != nil {
			return err
		}
		gate, ok := ontologizer.ParseReviewGate(gateValue)
		if !ok || seen[gate] {
			continue
		}
		seen[gate] = true
		if digests.ByGate[gate] != reviewed {
			changed = append(changed, gate)
		}
	}
	if err = rows.Err(); err != nil {
		return err
	}
	rows.Close()
	var earliest ontologizer.ReviewGate
	for _, candidate := range ontologizer.ReviewGates {
		for _, gate := range changed {
			if candidate == gate {
				earliest = gate
				break
			}
		}
		if earliest != "" {
			break
		}
	}
	for _, gate := range changed {
		_, err = tx.Exec(ctx, `UPDATE semantic_review_packet SET status='stale',stale_reason=$4,updated_at=now()
			WHERE workspace_id=$1 AND construction_id=$2 AND gate=ANY($3) AND status IN ('pending','approved')`,
			workspaceID, constructionID, semanticReviewGateValues(ontologizer.ReviewGateAndDownstream(gate)), "review subject changed at "+string(gate))
		if err != nil {
			return err
		}
	}
	if earliest != "" {
		_, err = tx.Exec(ctx, `UPDATE semantic_construction SET stage=$3,status='active',updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status<>'completed'`, workspaceID, constructionID, earliest)
		if err != nil {
			return err
		}
	}
	return nil
}

// semanticInvalidateOntologyReviews is the native-authoring integration hook.
// Call it in the same transaction after the new ontology revision is stored.
func (h *Handler) semanticInvalidateOntologyReviews(ctx context.Context, tx pgx.Tx, workspaceID, ontologyID string) error {
	rows, err := tx.Query(ctx, `SELECT id::text FROM semantic_construction WHERE workspace_id=$1 AND ontology_id=$2 AND status<>'completed'`, workspaceID, ontologyID)
	if err != nil {
		return err
	}
	defer rows.Close()
	var constructionIDs []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return err
		}
		constructionIDs = append(constructionIDs, id)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	rows.Close()
	for _, constructionID := range constructionIDs {
		if err = semanticInvalidateConstructionReviews(ctx, tx, workspaceID, constructionID); err != nil {
			return err
		}
	}
	return nil
}

func semanticReviewDependencyApproved(ctx context.Context, q semanticReviewQuerier, workspaceID, constructionID string, gate ontologizer.ReviewGate, digests semanticReviewDigests) (bool, error) {
	previous, required := ontologizer.PreviousReviewGate(gate)
	if !required {
		return true, nil
	}
	var approved bool
	err := q.QueryRow(ctx, `SELECT COALESCE((SELECT status='approved' AND review_subject_digest=$4 FROM semantic_review_packet WHERE workspace_id=$1 AND construction_id=$2 AND gate=$3 ORDER BY sequence DESC LIMIT 1),false)`, workspaceID, constructionID, previous, digests.ByGate[previous]).Scan(&approved)
	return approved, err
}

func (h *Handler) semanticListReviewPackets(w http.ResponseWriter, r *http.Request) {
	a, id, _, ok := h.semanticConstructionScope(w, r)
	if !ok {
		return
	}
	h.semanticRows(w, r, `SELECT jsonb_build_object(
		'id',p.id,'construction_id',p.construction_id,'gate',p.gate,'sequence',p.sequence,'status',p.status,
		'artifact_digest',p.artifact_digest,'review_subject_digest',p.review_subject_digest,'packet',p.packet,
		'created_by_task_id',p.created_by_task_id,'created_at',p.created_at,'stale_reason',p.stale_reason,
		'decision',(SELECT jsonb_build_object('id',d.id,'decision',d.decision,'rationale',d.rationale,'decided_by',d.decided_by,'created_at',d.created_at) FROM semantic_human_decision d WHERE d.review_packet_id=p.id ORDER BY d.created_at DESC LIMIT 1))
		FROM semantic_review_packet p WHERE p.workspace_id=$1 AND p.construction_id=$2 ORDER BY p.sequence`, a.WorkspaceID, id)
}

func (h *Handler) semanticCreateReviewPacket(w http.ResponseWriter, r *http.Request) {
	a, constructionID, _, ok := h.semanticConstructionScope(w, r)
	if !ok {
		return
	}
	if a.TaskID == nil || a.ActorType != "agent" {
		writeError(w, 403, "an active Family task must create review packets")
		return
	}
	var input struct {
		Gate                string          `json:"gate"`
		ArtifactDigest      string          `json:"artifact_digest"`
		ReviewSubjectDigest string          `json:"review_subject_digest"`
		Packet              json.RawMessage `json:"packet"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	gate, valid := ontologizer.ParseReviewGate(input.Gate)
	var packet ontologizer.ReviewPacket
	if !valid || json.Unmarshal(input.Packet, &packet) != nil {
		writeError(w, 400, "gate and review packet are invalid")
		return
	}
	if err := ontologizer.ValidateReviewPacket(packet); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "failed to start review request")
		return
	}
	defer tx.Rollback(r.Context())
	if err = tx.QueryRow(r.Context(), `SELECT id::text FROM semantic_construction WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, a.WorkspaceID, constructionID).Scan(new(string)); err != nil {
		writeError(w, 404, "construction not found")
		return
	}
	var currentGate string
	if err = tx.QueryRow(r.Context(), `SELECT stage FROM semantic_construction WHERE workspace_id=$1 AND id=$2`, a.WorkspaceID, constructionID).Scan(&currentGate); err != nil || currentGate != string(gate) {
		writeError(w, 409, "review packet gate does not match the construction's current gate")
		return
	}
	if err = semanticInvalidateConstructionReviews(r.Context(), tx, a.WorkspaceID, constructionID); err != nil {
		writeError(w, 500, "failed to refresh review state")
		return
	}
	digests, err := semanticConstructionReviewDigests(r.Context(), tx, a.WorkspaceID, constructionID)
	if err != nil {
		writeError(w, 500, "failed to calculate review subject")
		return
	}
	if input.ArtifactDigest != digests.Artifact || input.ReviewSubjectDigest != digests.ByGate[gate] {
		writeError(w, 409, "review packet does not describe the current candidate")
		return
	}
	if approved, dependencyErr := semanticReviewDependencyApproved(r.Context(), tx, a.WorkspaceID, constructionID, gate, digests); dependencyErr != nil || !approved {
		writeError(w, 409, "the previous review gate is not approved for its current subject")
		return
	}
	for _, group := range packet.Groups {
		for _, item := range group.Items {
			if item.Classification != "human_confirmation" {
				continue
			}
			var exists bool
			if err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM semantic_human_decision WHERE id=$1 AND workspace_id=$2 AND construction_id=$3)`, item.DecisionID, a.WorkspaceID, constructionID).Scan(&exists); err != nil || !exists {
				writeError(w, 400, "human_confirmation must reference a real member decision in this construction")
				return
			}
		}
	}
	_, err = tx.Exec(r.Context(), `UPDATE semantic_review_packet SET status='stale',stale_reason='superseded by a newer review packet',updated_at=now() WHERE workspace_id=$1 AND construction_id=$2 AND gate=$3 AND status='pending'`, a.WorkspaceID, constructionID, gate)
	var sequence int64
	if err == nil {
		err = tx.QueryRow(r.Context(), `SELECT COALESCE(max(sequence),0)+1 FROM semantic_review_packet WHERE workspace_id=$1 AND construction_id=$2`, a.WorkspaceID, constructionID).Scan(&sequence)
	}
	id := uuid.NewString()
	var output json.RawMessage
	if err == nil {
		err = tx.QueryRow(r.Context(), `INSERT INTO semantic_review_packet(id,workspace_id,construction_id,gate,sequence,artifact_digest,review_subject_digest,packet,created_by_task_id,created_by_actor_id)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING to_jsonb(semantic_review_packet)`, id, a.WorkspaceID, constructionID, gate, sequence, input.ArtifactDigest, input.ReviewSubjectDigest, input.Packet, *a.TaskID, a.ActorID).Scan(&output)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO semantic_construction_event(id,workspace_id,construction_id,task_id,actor_type,actor_id,stage,kind,message,data)
			VALUES($1,$2,$3,$4,$5,$6,$7,'review_requested','Review requested',$8)`, uuid.NewString(), a.WorkspaceID, constructionID, *a.TaskID, a.ActorType, a.ActorID, gate, semanticMarshal(map[string]any{"review_packet_id": id, "artifact_digest": input.ArtifactDigest, "review_subject_digest": input.ReviewSubjectDigest}))
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE semantic_construction SET stage=$3,status='awaiting_review',updated_at=now() WHERE workspace_id=$1 AND id=$2`, a.WorkspaceID, constructionID, gate)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, 500, "failed to persist review packet")
		return
	}
	writeJSON(w, 201, output)
}

func (h *Handler) semanticDecideReviewPacket(w http.ResponseWriter, r *http.Request) {
	a, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	if a.TaskID != nil || a.ActorType == "agent" || isMachineCredentialActor(r) {
		writeError(w, 403, "only a signed-in workspace member may decide a review packet")
		return
	}
	packetID, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	var input struct {
		Decision                    string `json:"decision"`
		Rationale                   string `json:"rationale"`
		ExpectedArtifactDigest      string `json:"expected_artifact_digest"`
		ExpectedReviewSubjectDigest string `json:"expected_review_subject_digest"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	if (input.Decision != "approve" && input.Decision != "request_changes") || strings.TrimSpace(input.Rationale) == "" {
		writeError(w, 400, "decision must be approve or request_changes and include a rationale")
		return
	}
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "failed to start review decision")
		return
	}
	defer tx.Rollback(r.Context())
	var constructionID, gateValue, status, artifactDigest, subjectDigest string
	err = tx.QueryRow(r.Context(), `SELECT construction_id::text,gate,status,artifact_digest,review_subject_digest FROM semantic_review_packet WHERE id=$1 AND workspace_id=$2 FOR UPDATE`, packetID, a.WorkspaceID).Scan(&constructionID, &gateValue, &status, &artifactDigest, &subjectDigest)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 404, "review packet not found")
		return
	}
	if err != nil {
		writeError(w, 500, "failed to load review packet")
		return
	}
	gate, valid := ontologizer.ParseReviewGate(gateValue)
	if !valid || status != "pending" {
		writeError(w, 409, "review packet is no longer pending")
		return
	}
	if input.ExpectedArtifactDigest != artifactDigest || input.ExpectedReviewSubjectDigest != subjectDigest {
		writeError(w, 409, "review packet changed; reload before deciding")
		return
	}
	digests, err := semanticConstructionReviewDigests(r.Context(), tx, a.WorkspaceID, constructionID)
	if err != nil || digests.ByGate[gate] != subjectDigest {
		_ = semanticInvalidateConstructionReviews(r.Context(), tx, a.WorkspaceID, constructionID)
		_ = tx.Commit(r.Context())
		writeError(w, 409, "review subject changed; request a current review packet")
		return
	}
	if approved, dependencyErr := semanticReviewDependencyApproved(r.Context(), tx, a.WorkspaceID, constructionID, gate, digests); dependencyErr != nil || !approved {
		writeError(w, 409, "the previous review gate is not approved for its current subject")
		return
	}
	decisionID := uuid.NewString()
	resumeEventID := uuid.NewString()
	gateLabel := map[ontologizer.ReviewGate]string{
		ontologizer.ReviewGateScope:      "范围确认",
		ontologizer.ReviewGateModel:      "业务模型",
		ontologizer.ReviewGateOperations: "行动与规则",
		ontologizer.ReviewGateRelease:    "发布",
	}[gate]
	resumeMessage := "成员已通过“" + gateLabel + "”审阅。请读取已保存的审阅包和成员决定，从下一关继续本体构建。"
	if input.Decision == "request_changes" {
		resumeMessage = "成员已在“" + gateLabel + "”审阅中要求修改。请读取已保存的理由，在当前关口修订后重新提交审阅。"
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO semantic_human_decision(id,workspace_id,construction_id,review_packet_id,gate,decision,rationale,artifact_digest,review_subject_digest,decided_by)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, decisionID, a.WorkspaceID, constructionID, packetID, gate, input.Decision, strings.TrimSpace(input.Rationale), artifactDigest, subjectDigest, a.UserID)
	if err == nil {
		packetStatus := "approved"
		if input.Decision == "request_changes" {
			packetStatus = "changes_requested"
		}
		_, err = tx.Exec(r.Context(), `UPDATE semantic_review_packet SET status=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2`, a.WorkspaceID, packetID, packetStatus)
	}
	if err == nil && input.Decision == "request_changes" {
		downstream := ontologizer.ReviewGateAndDownstream(gate)
		if len(downstream) > 1 {
			_, err = tx.Exec(r.Context(), `UPDATE semantic_review_packet SET status='stale',stale_reason=$4,updated_at=now() WHERE workspace_id=$1 AND construction_id=$2 AND gate=ANY($3) AND status IN ('pending','approved')`, a.WorkspaceID, constructionID, semanticReviewGateValues(downstream[1:]), "upstream changes requested at "+string(gate))
		}
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO semantic_construction_event(id,workspace_id,construction_id,actor_type,actor_id,stage,kind,message,data)
			VALUES($1,$2,$3,$4,$5,$6,'human_decision',$7,$8)`, resumeEventID, a.WorkspaceID, constructionID, a.ActorType, a.ActorID, gate, input.Rationale, semanticMarshal(map[string]any{"decision_id": decisionID, "review_packet_id": packetID, "decision": input.Decision, "artifact_digest": artifactDigest, "review_subject_digest": subjectDigest, "coordinator_resume_status": "pending", "coordinator_resume_message": resumeMessage}))
	}
	if err == nil {
		constructionStatus := "active"
		nextGate := gate
		if input.Decision == "approve" {
			if next, exists := ontologizer.NextReviewGate(gate); exists {
				nextGate = next
			}
		}
		if input.Decision == "approve" && gate == ontologizer.ReviewGateRelease {
			constructionStatus = "approved_for_release"
		}
		_, err = tx.Exec(r.Context(), `UPDATE semantic_construction SET stage=$3,status=$4,updated_at=now() WHERE workspace_id=$1 AND id=$2`, a.WorkspaceID, constructionID, nextGate, constructionStatus)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, 500, "failed to save review decision")
		return
	}
	resume := h.semanticResumeConstructionCoordinator(r, a.WorkspaceID, constructionID, resumeEventID, resumeMessage)
	writeJSON(w, 200, map[string]any{"id": decisionID, "review_packet_id": packetID, "construction_id": constructionID, "gate": gate, "decision": input.Decision, "rationale": strings.TrimSpace(input.Rationale), "artifact_digest": artifactDigest, "review_subject_digest": subjectDigest, "decided_by": a.UserID, "coordinator_resume": resume})
}

// semanticRequireReleaseReview is the publication integration hook. Call it
// while holding the ontology publication transaction lock.
func (h *Handler) semanticRequireReleaseReview(ctx context.Context, tx pgx.Tx, workspaceID, ontologyID string) error {
	var constructionID string
	err := tx.QueryRow(ctx, `SELECT id::text FROM semantic_construction WHERE workspace_id=$1 AND ontology_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`, workspaceID, ontologyID).Scan(&constructionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("ontology has no governed construction to publish")
	}
	if err != nil {
		return err
	}
	if err = semanticInvalidateConstructionReviews(ctx, tx, workspaceID, constructionID); err != nil {
		return err
	}
	digests, err := semanticConstructionReviewDigests(ctx, tx, workspaceID, constructionID)
	if err != nil {
		return err
	}
	var approved bool
	err = tx.QueryRow(ctx, `SELECT COALESCE((SELECT status='approved' AND review_subject_digest=$3 FROM semantic_review_packet WHERE workspace_id=$1 AND construction_id=$2 AND gate='release' ORDER BY sequence DESC LIMIT 1),false)`, workspaceID, constructionID, digests.ByGate[ontologizer.ReviewGateRelease]).Scan(&approved)
	if err != nil {
		return err
	}
	if !approved {
		return errors.New("current ontology candidate requires an approved release review")
	}
	return nil
}
