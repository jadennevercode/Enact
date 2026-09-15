package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

type semanticActionContinuationFixture struct {
	RuntimeID, AgentID, IssueID, OtherIssueID, TaskID, ReleaseID, RunID, ApprovalID string
}

func newSemanticActionContinuationFixture(t *testing.T, taskOnRunIssue bool) semanticActionContinuationFixture {
	t.Helper()
	_, releaseID, runID := semanticFixture(t, "https://quality.example.test", "confirm")
	dbfx.Exec(t, `UPDATE semantic_release
		SET artifact='{"definition":{"actions":[{"id":"freeze","label":"冻结批次"}]}}'::jsonb,
			binding_config=jsonb_set(binding_config,'{action_bindings,0,action_id}',to_jsonb('freeze'::text),true)
		WHERE id=$1`, releaseID)
	runtimeID := dbfx.Runtime(t, "action continuation runtime "+uuid.NewString()[:8])
	agentID := dbfx.Agent(t, "action continuation agent "+uuid.NewString()[:8], runtimeID)
	issueID := dbfx.Issue(t, "action continuation investigation")
	otherIssueID := dbfx.Issue(t, "unrelated investigation")
	taskIssueID := issueID
	if !taskOnRunIssue {
		taskIssueID = otherIssueID
	}
	taskID := dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": taskIssueID, "status": "running", "originator_user_id": testUserID, "accountable_user_id": testUserID})
	dbfx.Exec(t, "UPDATE agent_task_queue SET status='completed',completed_at=now() WHERE id=$1", taskID)
	dbfx.Exec(t, "UPDATE semantic_run SET actor_type='agent',issue_id=$2,actor_id=$3,task_id=$4,delegated_at=now() WHERE id=$1", runID, issueID, agentID, taskID)
	approvalID := dbfx.Insert(t, "semantic_approval", testutil.Cols{
		"workspace_id": testWorkspaceID, "run_id": runID, "binding_id": "freeze", "parameters": []byte(`{"target":"batch-1"}`), "digest": "action-continuation", "status": "pending", "requested_by": testUserID, "expires_at": time.Now().Add(15 * time.Minute), "actor_id": agentID, "task_id": taskID,
	})
	return semanticActionContinuationFixture{RuntimeID: runtimeID, AgentID: agentID, IssueID: issueID, OtherIssueID: otherIssueID, TaskID: taskID, ReleaseID: releaseID, RunID: runID, ApprovalID: approvalID}
}

func decideSemanticAction(t *testing.T, approvalID string, approve bool, reason string) map[string]any {
	t.Helper()
	var response map[string]any
	testutil.Call(t, testHandler.semanticDecide, semanticRequest("POST", approvalID, map[string]any{"approve": approve, "reason": reason})).Want(200).JSON(&response)
	return response
}

func actionContinuation(t *testing.T, response map[string]any) map[string]any {
	t.Helper()
	resume, ok := response["coordinator_resume"].(map[string]any)
	if !ok {
		t.Fatalf("missing coordinator_resume: %#v", response)
	}
	return resume
}

func TestSemanticActionDecisionQueuesOriginalIssueAgentOnce(t *testing.T) {
	fixture := newSemanticActionContinuationFixture(t, true)
	response := decideSemanticAction(t, fixture.ApprovalID, true, "批准按已核对参数执行")
	resume := actionContinuation(t, response)
	if resume["status"] != "queued" {
		t.Fatalf("resume status = %v, want queued: %#v", resume["status"], resume)
	}
	commentID, _ := resume["comment_id"].(string)
	var issueID, content string
	dbfx.QueryRow(t, "SELECT issue_id::text,content FROM comment WHERE id=$1", commentID).Scan(&issueID, &content)
	if issueID != fixture.IssueID || !strings.Contains(content, "mention://agent/"+fixture.AgentID) ||
		!strings.Contains(content, "成员已批准“冻结批次”") || !strings.Contains(content, "批准按已核对参数执行") {
		t.Fatalf("continuation did not preserve the business decision on its Issue: issue=%q content=%q", issueID, content)
	}
	for _, protocolValue := range []string{"run_id=", "approval_id=", "action_id=", fixture.RunID, fixture.ApprovalID} {
		if strings.Contains(content, protocolValue) {
			t.Fatalf("member-visible continuation leaked protocol value %q: %q", protocolValue, content)
		}
	}
	var queued int
	dbfx.QueryRow(t, "SELECT count(*) FROM agent_task_queue WHERE issue_id=$1 AND agent_id=$2 AND trigger_comment_id=$3", fixture.IssueID, fixture.AgentID, commentID).Scan(&queued)
	if queued != 1 {
		t.Fatalf("queued continuation tasks = %d, want 1", queued)
	}

	again := decideSemanticAction(t, fixture.ApprovalID, true, "批准按已核对参数执行")
	if actionContinuation(t, again)["comment_id"] != commentID {
		t.Fatalf("duplicate decision did not return the original continuation: %#v", again)
	}
	var comments int
	dbfx.QueryRow(t, "SELECT count(*) FROM comment WHERE issue_id=$1 AND content=$2", fixture.IssueID, content).Scan(&comments)
	if comments != 1 {
		t.Fatalf("duplicate decision created %d comments, want 1", comments)
	}
}

func TestSemanticRejectedActionResumesAgentWithoutExecutionInstruction(t *testing.T) {
	fixture := newSemanticActionContinuationFixture(t, true)
	response := decideSemanticAction(t, fixture.ApprovalID, false, "目标批次仍需业务复核")
	resume := actionContinuation(t, response)
	commentID, _ := resume["comment_id"].(string)
	var content string
	dbfx.QueryRow(t, "SELECT content FROM comment WHERE id=$1", commentID).Scan(&content)
	if !strings.Contains(content, "已拒绝") || !strings.Contains(content, "不要执行") || !strings.Contains(content, "后续处理") {
		t.Fatalf("rejection continuation did not preserve the safe next step: %q", content)
	}
	var status string
	dbfx.QueryRow(t, "SELECT status FROM semantic_approval WHERE id=$1", fixture.ApprovalID).Scan(&status)
	if status != "rejected" {
		t.Fatalf("approval status = %q, want rejected", status)
	}
}

func TestSemanticActionContinuationFailureRetriesTheSameComment(t *testing.T) {
	fixture := newSemanticActionContinuationFixture(t, true)
	dbfx.Exec(t, "UPDATE agent SET archived_at=now() WHERE id=$1", fixture.AgentID)
	first := actionContinuation(t, decideSemanticAction(t, fixture.ApprovalID, true, "批准，待协调者恢复后执行"))
	if first["status"] != "failed" {
		t.Fatalf("archived agent resume status = %v, want failed: %#v", first["status"], first)
	}
	commentID, _ := first["comment_id"].(string)
	if commentID == "" {
		t.Fatalf("failed dispatch did not retain its durable comment: %#v", first)
	}
	dbfx.Exec(t, "UPDATE agent SET archived_at=NULL WHERE id=$1", fixture.AgentID)
	second := actionContinuation(t, decideSemanticAction(t, fixture.ApprovalID, true, "批准，待协调者恢复后执行"))
	if second["status"] != "queued" || second["comment_id"] != commentID {
		t.Fatalf("retry did not enqueue from the original comment: first=%#v second=%#v", first, second)
	}
	var content string
	dbfx.QueryRow(t, "SELECT content FROM comment WHERE id=$1", commentID).Scan(&content)
	var comments int
	dbfx.QueryRow(t, "SELECT count(*) FROM comment WHERE issue_id=$1 AND content=$2", fixture.IssueID, content).Scan(&comments)
	if comments != 1 {
		t.Fatalf("recovery created %d comments, want 1", comments)
	}
}

func TestSemanticActionContinuationCannotCrossIssueTaskScope(t *testing.T) {
	fixture := newSemanticActionContinuationFixture(t, false)
	resume := actionContinuation(t, decideSemanticAction(t, fixture.ApprovalID, true, "批准当前调查中的行动"))
	if resume["status"] != "not_applicable" {
		t.Fatalf("mismatched task Issue resumed an agent: %#v", resume)
	}
	var comments int
	dbfx.QueryRow(t, "SELECT count(*) FROM comment WHERE (issue_id=$1 OR issue_id=$2) AND content LIKE $3", fixture.IssueID, fixture.OtherIssueID, "%批准当前调查中的行动%").Scan(&comments)
	if comments != 0 {
		t.Fatalf("cross-Issue continuation wrote %d comments, want 0", comments)
	}
}

func insertScopedActionDecision(t *testing.T, fixture semanticActionContinuationFixture, issueID, memberID string) (string, string) {
	t.Helper()
	taskID := dbfx.Task(t, fixture.AgentID, testutil.Cols{
		"runtime_id": fixture.RuntimeID, "issue_id": issueID, "status": "running",
		"originator_user_id": memberID, "accountable_user_id": memberID,
	})
	dbfx.Exec(t, "UPDATE agent_task_queue SET status='completed',completed_at=now() WHERE id=$1", taskID)
	runID := dbfx.Insert(t, "semantic_run", testutil.Cols{
		"workspace_id": testWorkspaceID, "release_id": fixture.ReleaseID, "requested_by": memberID,
		"actor_type": "agent", "issue_id": issueID, "actor_id": fixture.AgentID,
		"task_id": taskID, "delegated_at": time.Now(),
	})
	approvalID := dbfx.Insert(t, "semantic_approval", testutil.Cols{
		"workspace_id": testWorkspaceID, "run_id": runID, "binding_id": "freeze",
		"parameters": []byte(`{"target":"other"}`), "digest": "scoped-decision",
		"status": "approved", "requested_by": memberID, "approved_by": memberID,
		"reason": "other scoped decision", "decided_at": time.Now(),
		"expires_at": time.Now().Add(15 * time.Minute), "actor_id": fixture.AgentID, "task_id": taskID,
	})
	return runID, approvalID
}

func TestSemanticActionClaimInstructionsStayWithinIssueAgentAndMember(t *testing.T) {
	fixture := newSemanticActionContinuationFixture(t, true)
	otherIssueRun, otherIssueApproval := insertScopedActionDecision(t, fixture, fixture.OtherIssueID, testUserID)
	otherMember := dbfx.User(t, "other action reviewer", uuid.NewString()+"@example.com")
	otherMemberRun, otherMemberApproval := insertScopedActionDecision(t, fixture, fixture.IssueID, otherMember)

	response := decideSemanticAction(t, fixture.ApprovalID, true, "批准按当前证据执行")
	resume := actionContinuation(t, response)
	if resume["status"] != "queued" {
		t.Fatalf("resume status = %v, want queued: %#v", resume["status"], resume)
	}

	w := httptest.NewRecorder()
	req := newDaemonTokenRequest(http.MethodPost, "/api/daemon/runtimes/"+fixture.RuntimeID+"/tasks/claim", nil,
		testWorkspaceID, "action-decision-context")
	req = withURLParam(req, "runtimeId", fixture.RuntimeID)
	testHandler.ClaimTaskByRuntime(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("claim status = %d: %s", w.Code, w.Body.String())
	}
	var claim struct {
		Task *struct {
			ID    string `json:"id"`
			Agent *struct {
				Instructions string `json:"instructions"`
			} `json:"agent"`
		} `json:"task"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &claim); err != nil || claim.Task == nil || claim.Task.Agent == nil {
		t.Fatalf("invalid claim response: err=%v body=%s", err, w.Body.String())
	}
	instructions := claim.Task.Agent.Instructions
	for _, want := range []string{fixture.RunID, fixture.ReleaseID, fixture.ApprovalID, "\"action_id\":\"freeze\"", "\"status\":\"approved\""} {
		if !strings.Contains(instructions, want) {
			t.Fatalf("claim instructions missing scoped action value %q: %s", want, instructions)
		}
	}
	for _, forbidden := range []string{otherIssueRun, otherIssueApproval, otherMemberRun, otherMemberApproval} {
		if strings.Contains(instructions, forbidden) {
			t.Fatalf("claim instructions leaked out-of-scope action value %q: %s", forbidden, instructions)
		}
	}
}
