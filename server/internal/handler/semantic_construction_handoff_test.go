package handler

import (
	"context"
	"strings"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/google/uuid"
)

func newSemanticHandoffFixture(t *testing.T) (semanticReviewFixture, db.AgentTaskQueue, string) {
	t.Helper()
	f := newSemanticReviewFixture(t)
	dbfx.Exec(t, `UPDATE issue SET assignee_type='squad',assignee_id=$2,status='in_progress' WHERE id=$1`, f.IssueID, f.SquadID)
	dbfx.Exec(t, `UPDATE agent_task_queue SET status='completed' WHERE id=$1`, f.TaskID)
	runtimeID := dbfx.Runtime(t, "handoff runtime "+uuid.NewString()[:8], testutil.Cols{"provider": "codex"})
	agentID := dbfx.Agent(t, "handoff reviewer "+uuid.NewString()[:8], runtimeID)
	childID := dbfx.Issue(t, "独立检查行动规则", testutil.Cols{"parent_issue_id": f.IssueID, "status": "in_review"})
	taskID := dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": childID, "status": "completed", "originator_user_id": testUserID, "accountable_user_id": testUserID})
	eventID := dbfx.Insert(t, "semantic_construction_event", testutil.Cols{"id": uuid.NewString(), "workspace_id": testWorkspaceID, "construction_id": f.ConstructionID, "task_id": taskID, "actor_type": "agent", "actor_id": agentID, "stage": "scope", "kind": "handoff", "message": "检查有问题，需要修正", "data": []byte(`{}`)})
	dbfx.Cleanup(t, `DELETE FROM agent_task_queue WHERE issue_id=$1`, f.IssueID)
	dbfx.Cleanup(t, `DELETE FROM comment WHERE issue_id=$1`, f.IssueID)
	task, err := testHandler.Queries.GetAgentTask(context.Background(), parseUUID(taskID))
	if err != nil {
		t.Fatal(err)
	}
	return f, task, eventID
}

func TestSemanticConstructionHandoffResumesCoordinatorExactlyOnce(t *testing.T) {
	f, task, eventID := newSemanticHandoffFixture(t)
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		if err := testHandler.semanticReconcileConstructionHandoff(ctx, &task); err != nil {
			t.Fatal(err)
		}
	}
	var comments, tasks int
	var content, originator, delegated string
	dbfx.QueryRow(t, `SELECT count(*) FROM comment WHERE issue_id=$1 AND source_task_id=$2`, f.IssueID, task.ID).Scan(&comments)
	dbfx.QueryRow(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id=$1 AND id<>$2`, f.IssueID, f.TaskID).Scan(&tasks)
	if comments != 1 || tasks != 1 {
		t.Fatalf("comments=%d tasks=%d, want one durable handoff and one coordinator task", comments, tasks)
	}
	dbfx.QueryRow(t, `SELECT content FROM comment WHERE issue_id=$1 AND source_task_id=$2`, f.IssueID, task.ID).Scan(&content)
	if !strings.Contains(content, "不代表批准") || strings.Contains(content, task.ID.String()) {
		t.Fatalf("handoff must be readable and not an approval: %s", content)
	}
	dbfx.QueryRow(t, `SELECT originator_user_id::text,delegated_from_task_id::text FROM agent_task_queue WHERE issue_id=$1 AND id<>$2`, f.IssueID, f.TaskID).Scan(&originator, &delegated)
	if originator != testUserID || delegated != task.ID.String() {
		t.Fatalf("lost human/task attribution: %s %s", originator, delegated)
	}
	var storedComment string
	dbfx.QueryRow(t, `SELECT data #>> '{coordinator_handoff,comment_id}' FROM semantic_construction_event WHERE id=$1`, eventID).Scan(&storedComment)
	if storedComment == "" {
		t.Fatal("handoff dispatch evidence missing")
	}
	var decisions int
	dbfx.QueryRow(t, `SELECT count(*) FROM semantic_human_decision WHERE construction_id=$1`, f.ConstructionID).Scan(&decisions)
	if decisions != 0 {
		t.Fatal("handoff created a human decision")
	}
}

func TestSemanticConstructionHandoffRespectsHumanBoundaryAndScope(t *testing.T) {
	for _, scenario := range []string{"awaiting_review", "pending_packet", "parked_parent", "changed_assignee", "outside_family", "stale_stage", "running_task", "no_handoff"} {
		t.Run(scenario, func(t *testing.T) {
			f, task, eventID := newSemanticHandoffFixture(t)
			switch scenario {
			case "awaiting_review":
				dbfx.Exec(t, `UPDATE semantic_construction SET status='awaiting_review' WHERE id=$1`, f.ConstructionID)
			case "pending_packet":
				dbfx.Insert(t, "semantic_review_packet", testutil.Cols{"id": uuid.NewString(), "workspace_id": testWorkspaceID, "construction_id": f.ConstructionID, "gate": "scope", "artifact_digest": "fixture", "packet": []byte(`{}`), "status": "pending", "created_by_task_id": task.ID, "created_by_actor_id": task.AgentID, "sequence": 1, "review_subject_digest": "fixture"})
			case "parked_parent":
				dbfx.Exec(t, `UPDATE issue SET status='backlog' WHERE id=$1`, f.IssueID)
			case "changed_assignee":
				dbfx.Exec(t, `UPDATE issue SET assignee_type='member',assignee_id=$2 WHERE id=$1`, f.IssueID, testUserID)
			case "outside_family":
				dbfx.Exec(t, `UPDATE issue SET parent_issue_id=NULL WHERE id=$1`, task.IssueID)
			case "stale_stage":
				dbfx.Exec(t, `UPDATE semantic_construction_event SET stage='model' WHERE id=$1`, eventID)
			case "running_task":
				task.Status = "running"
			case "no_handoff":
				dbfx.Exec(t, `UPDATE semantic_construction_event SET kind='validation' WHERE id=$1`, eventID)
			}
			if err := testHandler.semanticReconcileConstructionHandoff(context.Background(), &task); err != nil {
				t.Fatal(err)
			}
			var n int
			dbfx.QueryRow(t, `SELECT count(*) FROM comment WHERE issue_id=$1 AND source_task_id=$2`, f.IssueID, task.ID).Scan(&n)
			if n != 0 {
				t.Fatalf("unexpected handoff for %s", scenario)
			}
		})
	}
}

func TestSemanticConstructionHandoffRetriesUnclaimedFailureButKeepsCancellation(t *testing.T) {
	for _, status := range []string{"failed", "cancelled"} {
		t.Run(status, func(t *testing.T) {
			f, task, _ := newSemanticHandoffFixture(t)
			if err := testHandler.semanticReconcileConstructionHandoff(context.Background(), &task); err != nil {
				t.Fatal(err)
			}
			dbfx.Exec(t, `UPDATE agent_task_queue SET status=$3,delivered_comment_ids='{}' WHERE issue_id=$1 AND id<>$2`, f.IssueID, f.TaskID, status)
			if err := testHandler.semanticReconcileConstructionHandoff(context.Background(), &task); err != nil {
				t.Fatal(err)
			}
			var n int
			dbfx.QueryRow(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id=$1 AND id<>$2`, f.IssueID, f.TaskID).Scan(&n)
			want := 2
			if status == "cancelled" {
				want = 1
			}
			if n != want {
				t.Fatalf("%s: tasks=%d want=%d", status, n, want)
			}
		})
	}
}

func TestSemanticConstructionHandoffDispatchFailureIsRetryable(t *testing.T) {
	f, task, _ := newSemanticHandoffFixture(t)
	var runtimeID string
	dbfx.QueryRow(t, `SELECT runtime_id::text FROM agent WHERE id=$1`, f.AgentID).Scan(&runtimeID)
	dbfx.Exec(t, `UPDATE agent SET runtime_id=NULL WHERE id=$1`, f.AgentID)
	if err := testHandler.semanticReconcileConstructionHandoff(context.Background(), &task); err == nil {
		t.Fatal("failed dispatch must request a completion callback retry")
	}
	dbfx.Exec(t, `UPDATE agent SET runtime_id=$2 WHERE id=$1`, f.AgentID, runtimeID)
	if err := testHandler.semanticReconcileConstructionHandoff(context.Background(), &task); err != nil {
		t.Fatal(err)
	}
	var n int
	dbfx.QueryRow(t, `SELECT count(*) FROM comment WHERE issue_id=$1 AND source_task_id=$2`, f.IssueID, task.ID).Scan(&n)
	if n != 1 {
		t.Fatalf("retry duplicated durable handoff comment: %d", n)
	}
}
