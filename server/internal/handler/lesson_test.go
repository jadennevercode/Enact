package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
)

// Lessons are the controlled path by which a skill changes itself. The tests
// here pin the four properties that make "controlled" mean anything:
//
//	a proposal names a version and a stale one cannot be approved;
//	a proposal states where it does not apply;
//	only a person decides;
//	approving and applying are the same event.
//
// Each of those has a cheap wrong implementation that passes a happy-path test.

// lessonTestSkill creates a skill with one supporting file and returns its id
// and the id of the version that creation recorded.
func lessonTestSkill(t *testing.T, name string) (skillID, versionID string) {
	t.Helper()

	body := map[string]any{
		"name":        name,
		"description": "seed",
		"content":     "# " + name + "\n\noriginal body\n",
		"files":       []map[string]string{{"path": "references/notes.md", "content": "original note"}},
	}
	var created map[string]any
	testutil.Call(t, testHandler.CreateSkill, newRequest(http.MethodPost, "/api/skills", body)).
		Want(http.StatusCreated).JSON(&created)

	skillID, _ = created["id"].(string)
	if skillID == "" {
		t.Fatal("skill create returned no id")
	}
	t.Cleanup(func() {
		dbfx.Exec(t, `DELETE FROM lesson_event WHERE lesson_id IN (SELECT id FROM lesson WHERE target_skill_id = $1)`, skillID)
		dbfx.Exec(t, `DELETE FROM lesson WHERE target_skill_id = $1`, skillID)
		dbfx.Exec(t, `DELETE FROM skill_version WHERE skill_id = $1`, skillID)
		dbfx.Exec(t, `DELETE FROM skill WHERE id = $1`, skillID)
	})

	dbfx.QueryRow(t, `SELECT current_version_id FROM skill WHERE id = $1`, skillID).Scan(&versionID)
	if versionID == "" {
		t.Fatal("skill creation recorded no version")
	}
	return skillID, versionID
}

func lessonProposalBody(skillID, versionID string) map[string]any {
	return map[string]any{
		"title":            "Always name the runtime in the handoff",
		"observation":      "Two runs in a row asked which machine to use.",
		"applies_when":     "Issues that touch a local repository.",
		"counterexample":   "Cloud-only work has one runtime; saying so is noise.",
		"change_summary":   "Add a line to the handoff checklist.",
		"target_skill_id":  skillID,
		"base_version_id":  versionID,
		"proposed_content": "# skill\n\noriginal body\n\nName the runtime.\n",
	}
}

func createTestLesson(t *testing.T, skillID, versionID string) map[string]any {
	t.Helper()
	var lesson map[string]any
	testutil.Call(t, testHandler.CreateLesson,
		newRequest(http.MethodPost, "/api/lessons", lessonProposalBody(skillID, versionID))).
		Want(http.StatusCreated).JSON(&lesson)
	id, _ := lesson["id"].(string)
	if id == "" {
		t.Fatal("lesson create returned no id")
	}
	t.Cleanup(func() {
		dbfx.Exec(t, `DELETE FROM lesson_event WHERE lesson_id = $1`, id)
		dbfx.Exec(t, `DELETE FROM lesson WHERE id = $1`, id)
	})
	return lesson
}

func TestSkillCreateRecordsFirstVersion(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	skillID, versionID := lessonTestSkill(t, "lesson-version-seed")

	var (
		number int32
		source string
		files  []byte
	)
	dbfx.QueryRow(t,
		`SELECT version, source, files FROM skill_version WHERE id = $1`, versionID,
	).Scan(&number, &source, &files)

	if number != 1 {
		t.Fatalf("first version = %d, want 1", number)
	}
	if source != "manual" {
		t.Fatalf("source = %q, want manual", source)
	}
	// The snapshot carries the supporting files, not just SKILL.md. A version
	// that records only the main body cannot answer what the reviewer saw.
	var decoded []map[string]string
	if err := json.Unmarshal(files, &decoded); err != nil {
		t.Fatalf("files column is not readable: %v", err)
	}
	if len(decoded) != 1 || decoded[0]["path"] != "references/notes.md" {
		t.Fatalf("version files = %v, want the one supporting file", decoded)
	}
	if got := dbfx.Count(t, `SELECT count(*) FROM skill_version WHERE skill_id = $1`, skillID); got != 1 {
		t.Fatalf("version count = %d, want 1", got)
	}
}

func TestSkillUpdateSkipsVersionWhenNothingChanged(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	skillID, _ := lessonTestSkill(t, "lesson-version-noop")

	// A PATCH that resends the current values. Clients do this constantly —
	// the edit form submits every field whether or not it was touched — and a
	// version per save would bury the versions that mean something.
	req := withURLParam(newRequest(http.MethodPut, "/api/skills/"+skillID, map[string]any{
		"description": "seed",
		"content":     "# lesson-version-noop\n\noriginal body\n",
	}), "id", skillID)
	testutil.Call(t, testHandler.UpdateSkill, req).Want(http.StatusOK)

	if got := dbfx.Count(t, `SELECT count(*) FROM skill_version WHERE skill_id = $1`, skillID); got != 1 {
		t.Fatalf("version count after a no-op update = %d, want 1", got)
	}

	// A real change does record one.
	req = withURLParam(newRequest(http.MethodPut, "/api/skills/"+skillID, map[string]any{
		"content": "# lesson-version-noop\n\nchanged body\n",
	}), "id", skillID)
	testutil.Call(t, testHandler.UpdateSkill, req).Want(http.StatusOK)

	if got := dbfx.Count(t, `SELECT count(*) FROM skill_version WHERE skill_id = $1`, skillID); got != 2 {
		t.Fatalf("version count after a real edit = %d, want 2", got)
	}
}

func TestCreateLessonRequiresABoundary(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	skillID, versionID := lessonTestSkill(t, "lesson-boundary")

	for _, field := range []string{"applies_when", "counterexample", "observation", "change_summary"} {
		body := lessonProposalBody(skillID, versionID)
		delete(body, field)
		resp := testutil.Call(t, testHandler.CreateLesson,
			newRequest(http.MethodPost, "/api/lessons", body)).Want(http.StatusBadRequest)
		if resp.Text() == "" {
			t.Fatalf("missing %s was refused without saying why", field)
		}
	}

	// A proposal that changes nothing is not a proposal.
	body := lessonProposalBody(skillID, versionID)
	delete(body, "proposed_content")
	testutil.Call(t, testHandler.CreateLesson,
		newRequest(http.MethodPost, "/api/lessons", body)).Want(http.StatusBadRequest)
}

func TestCreateLessonRefusesStaleBaseVersion(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	skillID, versionID := lessonTestSkill(t, "lesson-stale-base")

	// Someone edits the skill after the agent read it.
	req := withURLParam(newRequest(http.MethodPut, "/api/skills/"+skillID, map[string]any{
		"content": "# lesson-stale-base\n\nsomebody else changed this\n",
	}), "id", skillID)
	testutil.Call(t, testHandler.UpdateSkill, req).Want(http.StatusOK)

	// The proposal still names the version it read. Refusing now is the point:
	// the agent can re-read and rewrite, whereas a reviewer meeting a stale
	// diff later cannot.
	testutil.Call(t, testHandler.CreateLesson,
		newRequest(http.MethodPost, "/api/lessons", lessonProposalBody(skillID, versionID))).
		Want(http.StatusConflict)
}

func TestCreateLessonRefusesASecondOpenProposal(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	skillID, versionID := lessonTestSkill(t, "lesson-one-at-a-time")
	createTestLesson(t, skillID, versionID)

	// Two open proposals against one skill cannot both be approved against the
	// same base version, so the second is dead on arrival.
	testutil.Call(t, testHandler.CreateLesson,
		newRequest(http.MethodPost, "/api/lessons", lessonProposalBody(skillID, versionID))).
		Want(http.StatusConflict)
}

func TestApproveLessonRefusesAgentCredentials(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	skillID, versionID := lessonTestSkill(t, "lesson-agent-cannot-approve")
	lesson := createTestLesson(t, skillID, versionID)
	lessonID, _ := lesson["id"].(string)

	// An mat_ task token authenticates as the owning human, so X-User-ID alone
	// would let the agent process approve its own proposal. X-Actor-Source is
	// server-set and is the thing that tells them apart.
	req := withURLParam(testutil.WithHeaders(
		newRequest(http.MethodPost, "/api/lessons/"+lessonID+"/approve", map[string]any{}),
		"X-Actor-Source", "task_token",
	), "id", lessonID)
	testutil.Call(t, testHandler.ApproveLesson, req).Want(http.StatusForbidden)

	// The legacy path: a member token carrying an agent id and a matching task
	// id is attributed to the agent. Attribution and authorization are
	// different questions, and this endpoint cares about the second.
	agentID := createHandlerTestAgent(t, "Lesson approval agent", nil)
	taskID := dbfx.Task(t, agentID, testutil.Cols{
		"status":     "running",
		"runtime_id": handlerTestRuntimeID(t),
	})
	req = withURLParam(testutil.WithHeaders(
		newRequest(http.MethodPost, "/api/lessons/"+lessonID+"/approve", map[string]any{}),
		"X-Agent-ID", agentID, "X-Task-ID", taskID,
	), "id", lessonID)
	testutil.Call(t, testHandler.ApproveLesson, req).Want(http.StatusForbidden)

	var status string
	dbfx.QueryRow(t, `SELECT status FROM lesson WHERE id = $1`, lessonID).Scan(&status)
	if status != "proposed" {
		t.Fatalf("status after refused approvals = %q, want proposed", status)
	}
}

func TestApproveLessonPublishesInOneStep(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	skillID, versionID := lessonTestSkill(t, "lesson-approve-publishes")
	lesson := createTestLesson(t, skillID, versionID)
	lessonID, _ := lesson["id"].(string)

	req := withURLParam(newRequest(http.MethodPost, "/api/lessons/"+lessonID+"/approve",
		map[string]any{"reason": "seen twice, boundary is clear"}), "id", lessonID)
	var decided map[string]any
	testutil.Call(t, testHandler.ApproveLesson, req).Want(http.StatusOK).JSON(&decided)

	if got, _ := decided["status"].(string); got != "published" {
		t.Fatalf("status = %q, want published", got)
	}

	// The skill actually changed. An approval that records a decision without
	// applying it would leave two answers to "is this rule in force".
	var content string
	dbfx.QueryRow(t, `SELECT content FROM skill WHERE id = $1`, skillID).Scan(&content)
	if content != "# skill\n\noriginal body\n\nName the runtime.\n" {
		t.Fatalf("skill content after approval = %q", content)
	}

	// And the version that carries the change names the lesson that caused it.
	var (
		newVersionID string
		source       string
		lessonRef    *string
	)
	dbfx.QueryRow(t, `
		SELECT sv.id, sv.source, sv.lesson_id::text
		FROM skill_version sv
		JOIN skill s ON s.current_version_id = sv.id
		WHERE s.id = $1`, skillID).Scan(&newVersionID, &source, &lessonRef)
	if source != "lesson" {
		t.Fatalf("published version source = %q, want lesson", source)
	}
	if lessonRef == nil || *lessonRef != lessonID {
		t.Fatalf("published version lesson_id = %v, want %s", lessonRef, lessonID)
	}
	if newVersionID == versionID {
		t.Fatal("approval did not record a new version")
	}

	// Approving twice is not a way to apply it twice.
	req = withURLParam(newRequest(http.MethodPost, "/api/lessons/"+lessonID+"/approve", map[string]any{}), "id", lessonID)
	testutil.Call(t, testHandler.ApproveLesson, req).Want(http.StatusConflict)
}

func TestApproveLessonRefusesWhenSkillMovedAfterProposal(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	skillID, versionID := lessonTestSkill(t, "lesson-approve-stale")
	lesson := createTestLesson(t, skillID, versionID)
	lessonID, _ := lesson["id"].(string)

	// The skill moves between the proposal and the decision. The creation-time
	// check cannot catch this; only the check inside the publishing transaction
	// protects the reviewer.
	req := withURLParam(newRequest(http.MethodPut, "/api/skills/"+skillID, map[string]any{
		"content": "# lesson-approve-stale\n\nchanged out from under the reviewer\n",
	}), "id", skillID)
	testutil.Call(t, testHandler.UpdateSkill, req).Want(http.StatusOK)

	req = withURLParam(newRequest(http.MethodPost, "/api/lessons/"+lessonID+"/approve", map[string]any{}), "id", lessonID)
	testutil.Call(t, testHandler.ApproveLesson, req).Want(http.StatusConflict)

	var content string
	dbfx.QueryRow(t, `SELECT content FROM skill WHERE id = $1`, skillID).Scan(&content)
	if content != "# lesson-approve-stale\n\nchanged out from under the reviewer\n" {
		t.Fatalf("refused approval still wrote to the skill: %q", content)
	}
}

func TestDeprecateLessonRevertsOnlyWhatItStillOwns(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	skillID, versionID := lessonTestSkill(t, "lesson-withdraw-reverts")
	lesson := createTestLesson(t, skillID, versionID)
	lessonID, _ := lesson["id"].(string)

	req := withURLParam(newRequest(http.MethodPost, "/api/lessons/"+lessonID+"/approve", map[string]any{}), "id", lessonID)
	testutil.Call(t, testHandler.ApproveLesson, req).Want(http.StatusOK)

	req = withURLParam(newRequest(http.MethodPost, "/api/lessons/"+lessonID+"/deprecate",
		map[string]any{"reason": "it fired on cloud-only work too"}), "id", lessonID)
	var withdrawn map[string]any
	testutil.Call(t, testHandler.DeprecateLesson, req).Want(http.StatusOK).JSON(&withdrawn)

	if got, _ := withdrawn["status"].(string); got != "deprecated" {
		t.Fatalf("status = %q, want deprecated", got)
	}
	var content string
	dbfx.QueryRow(t, `SELECT content FROM skill WHERE id = $1`, skillID).Scan(&content)
	if content != "# lesson-withdraw-reverts\n\noriginal body\n" {
		t.Fatalf("withdrawal did not restore the previous text: %q", content)
	}
	if withdrawn["reverted_version_id"] == nil {
		t.Fatal("withdrawal reverted the skill but did not say which version it produced")
	}
}

func TestDeprecateLessonLeavesLaterWorkAlone(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	skillID, versionID := lessonTestSkill(t, "lesson-withdraw-keeps-later-work")
	lesson := createTestLesson(t, skillID, versionID)
	lessonID, _ := lesson["id"].(string)

	req := withURLParam(newRequest(http.MethodPost, "/api/lessons/"+lessonID+"/approve", map[string]any{}), "id", lessonID)
	testutil.Call(t, testHandler.ApproveLesson, req).Want(http.StatusOK)

	// Someone edits the skill after the lesson landed. Reverting now would
	// throw that edit away, which is a worse outcome than leaving a withdrawn
	// rule in place for someone to remove deliberately.
	later := "# lesson-withdraw-keeps-later-work\n\nsomeone kept working on this\n"
	req = withURLParam(newRequest(http.MethodPut, "/api/skills/"+skillID, map[string]any{"content": later}), "id", skillID)
	testutil.Call(t, testHandler.UpdateSkill, req).Want(http.StatusOK)

	req = withURLParam(newRequest(http.MethodPost, "/api/lessons/"+lessonID+"/deprecate",
		map[string]any{"reason": "superseded"}), "id", lessonID)
	var withdrawn map[string]any
	testutil.Call(t, testHandler.DeprecateLesson, req).Want(http.StatusOK).JSON(&withdrawn)

	var content string
	dbfx.QueryRow(t, `SELECT content FROM skill WHERE id = $1`, skillID).Scan(&content)
	if content != later {
		t.Fatalf("withdrawal discarded later work: %q", content)
	}
	if withdrawn["reverted_version_id"] != nil {
		t.Fatal("withdrawal claimed a revert it did not perform")
	}
}

func TestRestoreSkillVersionAppendsRatherThanRewinds(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	skillID, versionID := lessonTestSkill(t, "lesson-restore")

	req := withURLParam(newRequest(http.MethodPut, "/api/skills/"+skillID, map[string]any{
		"content": "# lesson-restore\n\nsecond\n",
	}), "id", skillID)
	testutil.Call(t, testHandler.UpdateSkill, req).Want(http.StatusOK)

	// Both params in one route context: withURLParam replaces the context each
	// call, so nesting it would silently drop the outer one.
	restore := testutil.WithURLParams(
		newRequest(http.MethodPost, "/api/skills/"+skillID+"/versions/"+versionID+"/restore", map[string]any{}),
		"id", skillID, "versionId", versionID)
	testutil.Call(t, testHandler.RestoreSkillVersion, restore).Want(http.StatusOK)

	var content string
	dbfx.QueryRow(t, `SELECT content FROM skill WHERE id = $1`, skillID).Scan(&content)
	if content != "# lesson-restore\n\noriginal body\n" {
		t.Fatalf("restore did not put the old text back: %q", content)
	}
	// Three versions, not one: history is appended so a restore can itself be
	// undone and the record never claims something that did not happen.
	if got := dbfx.Count(t, `SELECT count(*) FROM skill_version WHERE skill_id = $1`, skillID); got != 3 {
		t.Fatalf("version count after restore = %d, want 3", got)
	}
}
