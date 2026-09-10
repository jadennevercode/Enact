package handler

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/enact-ai/enact/server/internal/ontologizer"
	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

type semanticReviewFixture struct {
	ConstructionID string
	OntologyID     string
	AgentID        string
	TaskID         string
	SquadID        string
	IssueID        string
}

func newSemanticReviewFixture(t *testing.T) semanticReviewFixture {
	t.Helper()
	suffix := uuid.NewString()[:8]
	runtimeID := dbfx.Runtime(t, "review packet runtime "+suffix, testutil.Cols{"provider": "codex"})
	agentID := dbfx.Agent(t, "review packet agent "+suffix, runtimeID)
	squadID := dbfx.Squad(t, "review packet family "+suffix, agentID)
	issueID := dbfx.Issue(t, "governed ontology")
	taskID := dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": issueID, "status": "running", "originator_user_id": testUserID, "accountable_user_id": testUserID})
	ontologyID := dbfx.Insert(t, "semantic_ontology", testutil.Cols{
		"workspace_id": testWorkspaceID,
		"name":         "review packet ontology",
		"bundle":       []byte(`{"native_artifact":{"definition":{"schema_version":2,"entities":[{"id":"order","label":"订单"}],"attributes":[],"relationships":[],"actions":[],"policies":[],"data_bindings":[],"action_bindings":[]},"native_rules":[],"bindings":[]}}`),
		"created_by":   testUserID,
	})
	constructionID := dbfx.Insert(t, "semantic_construction", testutil.Cols{"id": uuid.NewString(), "workspace_id": testWorkspaceID, "ontology_id": ontologyID, "issue_id": issueID, "squad_id": squadID, "created_by": testUserID, "stage": "scope"})
	dbfx.Cleanup(t, `DELETE FROM semantic_human_decision WHERE construction_id=$1`, constructionID)
	dbfx.Cleanup(t, `DELETE FROM semantic_review_packet WHERE construction_id=$1`, constructionID)
	dbfx.Cleanup(t, `DELETE FROM semantic_construction_event WHERE construction_id=$1`, constructionID)
	return semanticReviewFixture{ConstructionID: constructionID, OntologyID: ontologyID, AgentID: agentID, TaskID: taskID, SquadID: squadID, IssueID: issueID}
}

func (f semanticReviewFixture) agentRequest(method, id string, input any) *http.Request {
	return testutil.WithHeaders(semanticRequest(method, id, input), "X-Actor-Source", "task_token", "X-Agent-ID", f.AgentID, "X-Task-ID", f.TaskID)
}

func reviewPacketBody(t *testing.T, constructionID string, gate ontologizer.ReviewGate) map[string]any {
	t.Helper()
	digests, err := semanticConstructionReviewDigests(context.Background(), testHandler.DB, testWorkspaceID, constructionID)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]any{
		"gate": gate, "artifact_digest": digests.Artifact, "review_subject_digest": digests.ByGate[gate],
		"packet": map[string]any{
			"title": "请确认", "summary": "确认这一部分的业务含义",
			"groups": []any{map[string]any{"title": "业务内容", "items": []any{map[string]any{"label": "订单", "value": "客户提交的购买请求", "classification": "fact"}}}},
			"checks": []any{map[string]any{"label": "结构检查", "status": "pass"}}, "unresolved": []any{}, "proposal": map[string]any{},
		},
	}
}

func decideReviewPacket(t *testing.T, packet map[string]any, decision string) *testutil.Response {
	t.Helper()
	return testutil.Call(t, testHandler.semanticDecideReviewPacket, semanticRequest("POST", packet["id"].(string), map[string]any{
		"decision": decision, "rationale": "业务负责人已核对", "expected_artifact_digest": packet["artifact_digest"], "expected_review_subject_digest": packet["review_subject_digest"],
	}))
}

func TestSemanticReviewRejectsAgentApprovalAndRequiresGateOrder(t *testing.T) {
	fixture := newSemanticReviewFixture(t)
	testutil.Call(t, testHandler.semanticCreateReviewPacket, fixture.agentRequest("POST", fixture.ConstructionID, reviewPacketBody(t, fixture.ConstructionID, ontologizer.ReviewGateModel))).Want(409)
	var scope map[string]any
	testutil.Call(t, testHandler.semanticCreateReviewPacket, fixture.agentRequest("POST", fixture.ConstructionID, reviewPacketBody(t, fixture.ConstructionID, ontologizer.ReviewGateScope))).Want(201).JSON(&scope)
	testutil.Call(t, testHandler.semanticDecideReviewPacket, fixture.agentRequest("POST", scope["id"].(string), map[string]any{
		"decision": "approve", "rationale": "self approval", "expected_artifact_digest": scope["artifact_digest"], "expected_review_subject_digest": scope["review_subject_digest"],
	})).Want(403)
	var decision map[string]any
	decideReviewPacket(t, scope, "approve").Want(200).JSON(&decision)
	assertCoordinatorResume(t, fixture, decision)
	var stage string
	dbfx.QueryRow(t, `SELECT stage FROM semantic_construction WHERE id=$1`, fixture.ConstructionID).Scan(&stage)
	if stage != "model" {
		t.Fatalf("scope approval advanced to %q, want model", stage)
	}
}

func assertCoordinatorResume(t *testing.T, fixture semanticReviewFixture, response map[string]any) {
	t.Helper()
	resume, ok := response["coordinator_resume"].(map[string]any)
	if !ok {
		t.Fatalf("missing coordinator_resume: %#v", response)
	}
	status, _ := resume["status"].(string)
	if status != "queued" && status != "coalesced" && status != "deferred" {
		t.Fatalf("coordinator resume status = %v, want an accepted dispatch", resume["status"])
	}
	commentID, _ := resume["comment_id"].(string)
	message, _ := resume["message"].(string)
	if commentID == "" || strings.TrimSpace(message) == "" {
		t.Fatalf("coordinator resume is not actionable: %#v", resume)
	}
	var issueID, content string
	dbfx.QueryRow(t, `SELECT issue_id::text,content FROM comment WHERE id=$1`, commentID).Scan(&issueID, &content)
	if issueID != fixture.IssueID || !strings.Contains(content, "mention://squad/"+fixture.SquadID) {
		t.Fatalf("resume comment was not persisted for the root Family: issue=%q content=%q", issueID, content)
	}
}

func TestSemanticReviewStalePacketCannotBeApproved(t *testing.T) {
	fixture := newSemanticReviewFixture(t)
	var scope, model map[string]any
	testutil.Call(t, testHandler.semanticCreateReviewPacket, fixture.agentRequest("POST", fixture.ConstructionID, reviewPacketBody(t, fixture.ConstructionID, ontologizer.ReviewGateScope))).Want(201).JSON(&scope)
	decideReviewPacket(t, scope, "approve").Want(200)
	testutil.Call(t, testHandler.semanticCreateReviewPacket, fixture.agentRequest("POST", fixture.ConstructionID, reviewPacketBody(t, fixture.ConstructionID, ontologizer.ReviewGateModel))).Want(201).JSON(&model)
	dbfx.Exec(t, `UPDATE semantic_ontology SET bundle=jsonb_set(bundle,'{native_artifact,definition,entities}', '[{"id":"invoice","label":"发票"}]'::jsonb) WHERE id=$1`, fixture.OntologyID)
	tx, err := testHandler.TxStarter.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err = testHandler.semanticInvalidateOntologyReviews(context.Background(), tx, testWorkspaceID, fixture.OntologyID); err == nil {
		err = tx.Commit(context.Background())
	} else {
		_ = tx.Rollback(context.Background())
	}
	if err != nil {
		t.Fatal(err)
	}
	decideReviewPacket(t, model, "approve").Want(409)
	var status string
	dbfx.QueryRow(t, `SELECT status FROM semantic_review_packet WHERE id=$1`, model["id"]).Scan(&status)
	if status != "stale" {
		t.Fatalf("changed model packet status = %q", status)
	}
}

func TestSemanticReviewSectionDigestPreservesModelApprovalForOperationChange(t *testing.T) {
	fixture := newSemanticReviewFixture(t)
	var scope, model map[string]any
	testutil.Call(t, testHandler.semanticCreateReviewPacket, fixture.agentRequest("POST", fixture.ConstructionID, reviewPacketBody(t, fixture.ConstructionID, ontologizer.ReviewGateScope))).Want(201).JSON(&scope)
	decideReviewPacket(t, scope, "approve").Want(200)
	testutil.Call(t, testHandler.semanticCreateReviewPacket, fixture.agentRequest("POST", fixture.ConstructionID, reviewPacketBody(t, fixture.ConstructionID, ontologizer.ReviewGateModel))).Want(201).JSON(&model)
	decideReviewPacket(t, model, "approve").Want(200)
	dbfx.Exec(t, `UPDATE semantic_ontology SET bundle=jsonb_set(bundle,'{native_artifact,definition,actions}', '[{"id":"cancel","label":"取消订单"}]'::jsonb) WHERE id=$1`, fixture.OntologyID)
	tx, err := testHandler.TxStarter.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err = testHandler.semanticInvalidateOntologyReviews(context.Background(), tx, testWorkspaceID, fixture.OntologyID); err == nil {
		err = tx.Commit(context.Background())
	} else {
		_ = tx.Rollback(context.Background())
	}
	if err != nil {
		t.Fatal(err)
	}
	var status string
	dbfx.QueryRow(t, `SELECT status FROM semantic_review_packet WHERE id=$1`, model["id"]).Scan(&status)
	if status != "approved" {
		t.Fatalf("operation-only change invalidated model approval: %q", status)
	}
}

func TestSemanticReviewSubjectHTTPProvidesServerDigestsAndRejectsChangedSubject(t *testing.T) {
	packetFromSubject := func(subject map[string]any) map[string]any {
		return map[string]any{
			"gate": subject["gate"], "artifact_digest": subject["artifact_digest"], "review_subject_digest": subject["review_subject_digest"],
			"packet": map[string]any{
				"title": "请确认范围", "summary": "确认本次要解决的业务问题",
				"groups": []any{map[string]any{"title": "范围", "items": []any{map[string]any{"label": "追溯范围", "value": "交付批次", "classification": "recommendation"}}}},
				"checks": []any{map[string]any{"label": "资料已读取", "status": "pass"}}, "unresolved": []any{}, "proposal": subject["subject"],
			},
		}
	}
	fixture := newSemanticReviewFixture(t)
	req := fixture.agentRequest("GET", fixture.ConstructionID, nil)
	req.URL.RawQuery = "gate=scope"
	var subject map[string]any
	testutil.Call(t, testHandler.semanticGetReviewSubject, req).Want(200).JSON(&subject)
	if subject["artifact_digest"] == "" || subject["review_subject_digest"] == "" || subject["subject"] == nil {
		t.Fatalf("review subject response is incomplete: %#v", subject)
	}
	testutil.Call(t, testHandler.semanticCreateReviewPacket, fixture.agentRequest("POST", fixture.ConstructionID, packetFromSubject(subject))).Want(201)

	changed := newSemanticReviewFixture(t)
	changedReq := changed.agentRequest("GET", changed.ConstructionID, nil)
	changedReq.URL.RawQuery = "gate=scope"
	var stale map[string]any
	testutil.Call(t, testHandler.semanticGetReviewSubject, changedReq).Want(200).JSON(&stale)
	dbfx.Exec(t, `UPDATE semantic_construction SET competency_questions='[{"question":"必须定位到单车吗？"}]'::jsonb WHERE id=$1`, changed.ConstructionID)
	testutil.Call(t, testHandler.semanticCreateReviewPacket, changed.agentRequest("POST", changed.ConstructionID, packetFromSubject(stale))).Want(409)
}

func TestSemanticConstructionEventPreservesPendingReviewWait(t *testing.T) {
	fixture := newSemanticReviewFixture(t)
	testutil.Call(t, testHandler.semanticCreateReviewPacket, fixture.agentRequest("POST", fixture.ConstructionID, reviewPacketBody(t, fixture.ConstructionID, ontologizer.ReviewGateScope))).Want(201)
	testutil.Call(t, testHandler.semanticConstructionEvent, fixture.agentRequest("POST", fixture.ConstructionID, map[string]any{
		"stage": "scope", "kind": "handoff", "message": "范围材料已交接", "data": map[string]any{"result": "ready"},
	})).Want(201)
	var status string
	var pending int
	dbfx.QueryRow(t, `SELECT status,(SELECT count(*) FROM semantic_review_packet p WHERE p.construction_id=c.id AND p.status='pending') FROM semantic_construction c WHERE id=$1`, fixture.ConstructionID).Scan(&status, &pending)
	if status != "awaiting_review" || pending != 1 {
		t.Fatalf("handoff after packet changed durable wait: status=%q pending_packets=%d", status, pending)
	}
}

func TestSemanticAuthoringRevisionConflictRestoresPersistedProposal(t *testing.T) {
	fixture := newSemanticReviewFixture(t)
	proposal := map[string]any{
		"expected_revision": 0,
		"interview": map[string]any{
			"status": "collecting", "round": 1,
			"questions": []any{map[string]any{
				"key": "business-boundary", "topic": "boundary", "prompt": "这次要覆盖哪些业务边界？", "why": "边界决定后续模型范围", "status": "unanswered",
			}},
		},
		"cards": []any{},
	}
	var saved map[string]any
	testutil.Call(t, testHandler.semanticPatchConstructionAuthoring, fixture.agentRequest("PATCH", fixture.ConstructionID, proposal)).Want(200).JSON(&saved)
	if saved["revision"] != float64(1) {
		t.Fatalf("saved authoring revision = %v, want 1", saved["revision"])
	}

	testutil.Call(t, testHandler.semanticPatchConstructionAuthoring, fixture.agentRequest("PATCH", fixture.ConstructionID, proposal)).Want(409)
	var restored map[string]any
	testutil.Call(t, testHandler.semanticGetConstructionAuthoring, fixture.agentRequest("GET", fixture.ConstructionID, nil)).Want(200).JSON(&restored)
	if restored["revision"] != float64(1) {
		t.Fatalf("restored authoring revision = %v, want 1", restored["revision"])
	}
	interview, ok := restored["interview"].(map[string]any)
	if !ok || len(interview["questions"].([]any)) != 1 {
		t.Fatalf("persisted interview was not restored: %#v", restored["interview"])
	}

	testutil.Call(t, testHandler.semanticRespondConstructionAuthoring, fixture.agentRequest("POST", fixture.ConstructionID, map[string]any{
		"expected_revision": 1, "answers": []any{map[string]any{"question_key": "business-boundary", "answer": "全部范围", "answer_kind": "answer"}},
	})).Want(403)
}

func TestSemanticAuthoringMemberResponseResumesRootCoordinator(t *testing.T) {
	fixture := newSemanticReviewFixture(t)
	proposal := map[string]any{
		"expected_revision": 0,
		"interview": map[string]any{"status": "collecting", "round": 1, "questions": []any{map[string]any{
			"key": "trace-granularity", "topic": "boundary", "prompt": "交付后先追到批次，还是必须定位每一辆车？", "why": "会改变追溯对象范围", "status": "unanswered",
		}}},
		"cards": []any{},
	}
	testutil.Call(t, testHandler.semanticPatchConstructionAuthoring, fixture.agentRequest("PATCH", fixture.ConstructionID, proposal)).Want(200)
	var response map[string]any
	testutil.Call(t, testHandler.semanticRespondConstructionAuthoring, semanticRequest("POST", fixture.ConstructionID, map[string]any{
		"expected_revision": 1,
		"answers":           []any{map[string]any{"question_key": "trace-granularity", "answer": "先追到客户和交付批次", "answer_kind": "answer"}},
	})).Want(200).JSON(&response)
	assertCoordinatorResume(t, fixture, response)

	var restored map[string]any
	testutil.Call(t, testHandler.semanticGetConstructionAuthoring, semanticRequest("GET", fixture.ConstructionID, nil)).Want(200).JSON(&restored)
	if restored["coordinator_resume"].(map[string]any)["comment_id"] != response["coordinator_resume"].(map[string]any)["comment_id"] {
		t.Fatalf("GET authoring did not restore durable coordinator resume: %#v", restored)
	}
}

func TestSemanticAuthoringMergePreservesQuestionsAndHumanCardDecisions(t *testing.T) {
	currentInterview := ontologizer.InterviewState{Status: "collecting", Round: 1, Questions: []ontologizer.InterviewQuestion{
		{Key: "boundary", Topic: "boundary", Prompt: "现有边界？", Why: "确认范围", Status: "unanswered"},
	}}
	mergedInterview, err := mergeInterviewProposal(currentInterview, ontologizer.InterviewState{Status: "ready", Round: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(mergedInterview.Questions) != 1 || mergedInterview.Questions[0].Key != "boundary" {
		t.Fatalf("agent proposal removed a durable interview question: %#v", mergedInterview.Questions)
	}

	currentCards := []ontologizer.CandidateCard{{
		Key: "order", Kind: "entity", Label: "订单", Description: "成员修正后的定义", Classification: "human_confirmation", Status: "corrected", DecisionID: uuid.NewString(), DecidedBy: testUserID,
	}}
	proposedCards := []ontologizer.CandidateCard{{
		Key: "order", Kind: "entity", Label: "Agent 覆盖", Description: "不应保存", Classification: "recommendation", Status: "proposed",
	}}
	mergedCards := mergeCandidateCardProposal(currentCards, proposedCards)
	if len(mergedCards) != 1 || mergedCards[0].Label != "订单" || mergedCards[0].DecisionID == "" {
		t.Fatalf("agent proposal overwrote a member card decision: %#v", mergedCards)
	}
}

func TestSemanticAuthoringAllowsLaterRoundsWhileCappingPendingQuestions(t *testing.T) {
	questions := func(prefix string) []ontologizer.InterviewQuestion {
		out := make([]ontologizer.InterviewQuestion, 0, 3)
		for index := 1; index <= 3; index++ {
			out = append(out, ontologizer.InterviewQuestion{Key: prefix + string(rune('0'+index)), Topic: "boundary", Prompt: "业务问题", Why: "会改变范围"})
		}
		return out
	}
	first, err := mergeInterviewProposal(
		ontologizer.InterviewState{Status: "collecting", Round: 0},
		ontologizer.InterviewState{Status: "collecting", Round: 1, Questions: questions("first-")},
	)
	if err != nil {
		t.Fatal(err)
	}
	for index := range first.Questions {
		first.Questions[index].Status = "answered"
		first.Questions[index].Answer = "已确认"
		first.Questions[index].AnswerKind = "human_confirmation"
		first.Questions[index].DecisionID = uuid.NewString()
	}
	second, err := mergeInterviewProposal(first, ontologizer.InterviewState{Status: "collecting", Round: 2, Questions: questions("second-")})
	if err != nil {
		t.Fatalf("later round with answered history was rejected: %v", err)
	}
	if len(second.Questions) != 6 {
		t.Fatalf("durable history plus later round = %d questions, want 6", len(second.Questions))
	}
	if _, err = mergeInterviewProposal(second, ontologizer.InterviewState{Status: "collecting", Round: 3, Questions: questions("third-")}); err == nil {
		t.Fatal("six simultaneously unanswered questions must be rejected")
	}
}

func TestSemanticHumanModelCorrectionInvalidatesApprovedModelAndBlocksPublication(t *testing.T) {
	fixture := newSemanticReviewFixture(t)
	proposal := map[string]any{
		"expected_revision": 0,
		"interview": map[string]any{"status": "collecting", "round": 1, "questions": []any{map[string]any{
			"key": "trace-granularity", "topic": "granularity", "prompt": "追溯需要到批次还是单车？", "why": "会改变业务对象粒度", "status": "unanswered",
		}}},
		"cards": []any{map[string]any{
			"key": "delivery-object", "kind": "entity", "label": "交付批次", "description": "一次交付所包含的批次", "classification": "recommendation", "status": "proposed",
		}},
	}
	testutil.Call(t, testHandler.semanticPatchConstructionAuthoring, fixture.agentRequest("PATCH", fixture.ConstructionID, proposal)).Want(200)
	for _, gate := range ontologizer.ReviewGates {
		var packet map[string]any
		testutil.Call(t, testHandler.semanticCreateReviewPacket, fixture.agentRequest("POST", fixture.ConstructionID, reviewPacketBody(t, fixture.ConstructionID, gate))).Want(201).JSON(&packet)
		decideReviewPacket(t, packet, "approve").Want(200)
	}

	testutil.Call(t, testHandler.semanticRespondConstructionAuthoring, semanticRequest("POST", fixture.ConstructionID, map[string]any{
		"expected_revision": 1,
		"answers":           []any{map[string]any{"question_key": "trace-granularity", "answer": "必须定位到每一辆车", "answer_kind": "answer"}},
		"card_decisions": []any{map[string]any{
			"card_key": "delivery-object", "decision": "correct", "rationale": "每辆车都是独立追溯对象", "correction": map[string]any{"label": "交付车辆", "description": "交付后可独立定位的一辆车"},
		}},
	})).Want(200)

	statuses := map[string]string{}
	rows, err := testHandler.DB.Query(context.Background(), `SELECT gate,status FROM semantic_review_packet WHERE construction_id=$1`, fixture.ConstructionID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var gate, status string
		if err = rows.Scan(&gate, &status); err != nil {
			t.Fatal(err)
		}
		statuses[gate] = status
	}
	if statuses["scope"] != "approved" || statuses["model"] != "stale" || statuses["operations"] != "stale" || statuses["release"] != "stale" {
		t.Fatalf("human model correction produced review states %#v", statuses)
	}
	tx, err := testHandler.TxStarter.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if err = testHandler.semanticRequireReleaseReview(context.Background(), tx, testWorkspaceID, fixture.OntologyID); err == nil {
		t.Fatal("publication accepted an artifact whose approved model conflicts with a newer human correction")
	}
}
