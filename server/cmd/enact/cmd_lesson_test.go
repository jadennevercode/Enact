package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

func newLessonProposeTestCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "propose"}
	cmd.Flags().String("server-url", "", "")
	cmd.Flags().String("workspace-id", "", "")
	cmd.Flags().String("profile", "", "")
	cmd.Flags().String("title", "", "")
	cmd.Flags().String("observation", "", "")
	cmd.Flags().String("applies-when", "", "")
	cmd.Flags().String("counterexample", "", "")
	cmd.Flags().String("change-summary", "", "")
	cmd.Flags().String("skill", "", "")
	cmd.Flags().String("base-version", "", "")
	cmd.Flags().String("new-skill", "", "")
	addLessonContentFlags(cmd)
	cmd.Flags().StringArray("evidence", nil, "")
	cmd.Flags().String("retrospective", "", "")
	cmd.Flags().String("source-task", "", "")
	cmd.Flags().String("source-issue", "", "")
	cmd.Flags().String("parent", "", "")
	cmd.Flags().String("output", "table", "")
	return cmd
}

func newLessonUpdateTestCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "update"}
	cmd.Flags().String("server-url", "", "")
	cmd.Flags().String("workspace-id", "", "")
	cmd.Flags().String("profile", "", "")
	cmd.Flags().String("title", "", "")
	cmd.Flags().String("observation", "", "")
	cmd.Flags().String("applies-when", "", "")
	cmd.Flags().String("counterexample", "", "")
	cmd.Flags().String("change-summary", "", "")
	addLessonContentFlags(cmd)
	cmd.Flags().StringArray("evidence", nil, "")
	cmd.Flags().String("output", "table", "")
	return cmd
}

// setRequiredLessonProseFlags fills the five fields every proposal must carry,
// so each test only has to set what it is about.
func setRequiredLessonProseFlags(cmd *cobra.Command) {
	_ = cmd.Flags().Set("title", "Always run the migration check")
	_ = cmd.Flags().Set("observation", "Two PRs shipped an index without CONCURRENTLY")
	_ = cmd.Flags().Set("applies-when", "Any migration that creates an index")
	_ = cmd.Flags().Set("counterexample", "A migration on an empty new table in a test fixture")
	_ = cmd.Flags().Set("change-summary", "Add the concurrent-index rule to the migration section")
}

func writeTempFile(t *testing.T, name, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	return path
}

func TestBuildLessonProposalBodyForExistingSkill(t *testing.T) {
	contentPath := writeTempFile(t, "SKILL.md", "# Migrations\n\nUse CONCURRENTLY.\n")
	filePath := writeTempFile(t, "checklist.md", "- [ ] index is concurrent\n")

	cmd := newLessonProposeTestCmd()
	setRequiredLessonProseFlags(cmd)
	_ = cmd.Flags().Set("skill", "skill-123")
	_ = cmd.Flags().Set("base-version", "version-456")
	_ = cmd.Flags().Set("content", contentPath)
	_ = cmd.Flags().Set("description", "How we write migrations")
	_ = cmd.Flags().Set("name", "migrations")
	_ = cmd.Flags().Set("file", "references/checklist.md="+filePath)
	_ = cmd.Flags().Set("retrospective", "retro-1")
	_ = cmd.Flags().Set("source-task", "task-1")
	_ = cmd.Flags().Set("source-issue", "issue-1")
	_ = cmd.Flags().Set("parent", "lesson-1")

	body, err := buildLessonProposalBody(cmd)
	if err != nil {
		t.Fatalf("buildLessonProposalBody: %v", err)
	}

	for field, want := range map[string]string{
		"title":                "Always run the migration check",
		"applies_when":         "Any migration that creates an index",
		"counterexample":       "A migration on an empty new table in a test fixture",
		"change_summary":       "Add the concurrent-index rule to the migration section",
		"target_skill_id":      "skill-123",
		"base_version_id":      "version-456",
		"proposed_content":     "# Migrations\n\nUse CONCURRENTLY.\n",
		"proposed_description": "How we write migrations",
		"proposed_name":        "migrations",
		"retrospective_id":     "retro-1",
		"source_task_id":       "task-1",
		"source_issue_id":      "issue-1",
		"parent_lesson_id":     "lesson-1",
	} {
		if got := body[field]; got != want {
			t.Errorf("body[%q] = %v, want %v", field, got, want)
		}
	}
	if _, ok := body["new_asset"]; ok {
		t.Errorf("body must not set new_asset for an existing skill: %#v", body)
	}

	files, ok := body["proposed_files"].([]map[string]any)
	if !ok || len(files) != 1 {
		t.Fatalf("proposed_files = %#v", body["proposed_files"])
	}
	if files[0]["path"] != "references/checklist.md" {
		t.Errorf("file path = %v, want references/checklist.md", files[0]["path"])
	}
	if files[0]["content"] != "- [ ] index is concurrent\n" {
		t.Errorf("file content = %q", files[0]["content"])
	}
}

func TestBuildLessonProposalBodyForNewSkill(t *testing.T) {
	contentPath := writeTempFile(t, "SKILL.md", "# New skill\n")

	cmd := newLessonProposeTestCmd()
	setRequiredLessonProseFlags(cmd)
	_ = cmd.Flags().Set("new-skill", "release-checklist")
	_ = cmd.Flags().Set("content", contentPath)

	body, err := buildLessonProposalBody(cmd)
	if err != nil {
		t.Fatalf("buildLessonProposalBody: %v", err)
	}
	if body["new_asset"] != true {
		t.Errorf("new_asset = %v, want true", body["new_asset"])
	}
	if body["skill_name"] != "release-checklist" {
		t.Errorf("skill_name = %v", body["skill_name"])
	}
	if _, ok := body["target_skill_id"]; ok {
		t.Errorf("body must not set target_skill_id for a new skill: %#v", body)
	}
	if _, ok := body["base_version_id"]; ok {
		t.Errorf("body must not set base_version_id for a new skill: %#v", body)
	}
}

func TestBuildLessonProposalBodyReadsContentFromStdin(t *testing.T) {
	content := "# From stdin\n\nliteral \\n stays literal\n"

	cmd := newLessonProposeTestCmd()
	setRequiredLessonProseFlags(cmd)
	_ = cmd.Flags().Set("new-skill", "release-checklist")
	_ = cmd.Flags().Set("content", "-")

	var body map[string]any
	pipeStdin(t, content, func() {
		var err error
		body, err = buildLessonProposalBody(cmd)
		if err != nil {
			t.Fatalf("buildLessonProposalBody: %v", err)
		}
	})
	if body["proposed_content"] != content {
		t.Fatalf("proposed_content = %q, want verbatim %q", body["proposed_content"], content)
	}
}

func TestBuildLessonProposalBodyRefusesBadFlagCombinations(t *testing.T) {
	contentPath := writeTempFile(t, "SKILL.md", "# body\n")

	cases := []struct {
		name    string
		set     func(*cobra.Command)
		wantErr string
	}{
		{
			name:    "no title",
			set:     func(cmd *cobra.Command) { _ = cmd.Flags().Set("new-skill", "x") },
			wantErr: "--title is required",
		},
		{
			name: "neither skill nor new-skill",
			set: func(cmd *cobra.Command) {
				setRequiredLessonProseFlags(cmd)
				_ = cmd.Flags().Set("content", contentPath)
			},
			wantErr: "--new-skill, is required",
		},
		{
			name: "skill and new-skill together",
			set: func(cmd *cobra.Command) {
				setRequiredLessonProseFlags(cmd)
				_ = cmd.Flags().Set("skill", "skill-123")
				_ = cmd.Flags().Set("new-skill", "release-checklist")
				_ = cmd.Flags().Set("content", contentPath)
			},
			wantErr: "mutually exclusive",
		},
		{
			name: "skill without base-version",
			set: func(cmd *cobra.Command) {
				setRequiredLessonProseFlags(cmd)
				_ = cmd.Flags().Set("skill", "skill-123")
				_ = cmd.Flags().Set("content", contentPath)
			},
			wantErr: "--base-version is required",
		},
		{
			name: "proposes nothing",
			set: func(cmd *cobra.Command) {
				setRequiredLessonProseFlags(cmd)
				_ = cmd.Flags().Set("skill", "skill-123")
				_ = cmd.Flags().Set("base-version", "version-456")
			},
			wantErr: "must propose a change",
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			cmd := newLessonProposeTestCmd()
			tt.set(cmd)
			_, err := buildLessonProposalBody(cmd)
			if err == nil {
				t.Fatalf("expected an error mentioning %q", tt.wantErr)
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %v, want it to mention %q", err, tt.wantErr)
			}
		})
	}
}

func TestParseLessonEvidenceFlags(t *testing.T) {
	got, err := parseLessonEvidenceFlags([]string{
		"task:11111111-1111-1111-1111-111111111111",
		"issue:22222222-2222-2222-2222-222222222222:asked twice: once here, once there",
		"comment:33333333-3333-3333-3333-333333333333:",
	})
	if err != nil {
		t.Fatalf("parseLessonEvidenceFlags: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}
	if got[0]["kind"] != "task" || got[0]["id"] != "11111111-1111-1111-1111-111111111111" {
		t.Errorf("first entry = %#v", got[0])
	}
	if _, ok := got[0]["note"]; ok {
		t.Errorf("first entry must have no note: %#v", got[0])
	}
	if got[1]["note"] != "asked twice: once here, once there" {
		t.Errorf("note = %v, want the colons kept", got[1]["note"])
	}
	if _, ok := got[2]["note"]; ok {
		t.Errorf("an empty note must be omitted: %#v", got[2])
	}
}

func TestParseLessonEvidenceFlagsRejectsMalformedInput(t *testing.T) {
	cases := []struct {
		name    string
		value   string
		wantErr string
	}{
		{name: "no id", value: "task", wantErr: "kind:uuid"},
		{name: "empty id", value: "task:", wantErr: "kind:uuid"},
		{name: "unknown kind", value: "pull-request:11111111-1111-1111-1111-111111111111", wantErr: "must be task, issue or comment"},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parseLessonEvidenceFlags([]string{tt.value})
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %v, want it to mention %q", err, tt.wantErr)
			}
		})
	}
}

func TestParseLessonFileFlagsRejectsMalformedInput(t *testing.T) {
	if _, err := parseLessonFileFlags([]string{"references/checklist.md"}); err == nil ||
		!strings.Contains(err.Error(), "path=localpath") {
		t.Fatalf("missing '=' error = %v", err)
	}
	if _, err := parseLessonFileFlags([]string{"=/tmp/x"}); err == nil ||
		!strings.Contains(err.Error(), "path=localpath") {
		t.Fatalf("empty path error = %v", err)
	}
	if _, err := parseLessonFileFlags([]string{"a.md=" + filepath.Join(t.TempDir(), "missing.md")}); err == nil ||
		!strings.Contains(err.Error(), "read --file") {
		t.Fatalf("unreadable local file error = %v", err)
	}
}

func TestBuildLessonUpdateBodyOnlySendsChangedFlags(t *testing.T) {
	cmd := newLessonUpdateTestCmd()
	_ = cmd.Flags().Set("change-summary", "Narrow the rule to index migrations")
	_ = cmd.Flags().Set("evidence", "task:11111111-1111-1111-1111-111111111111")

	body, err := buildLessonUpdateBody(cmd)
	if err != nil {
		t.Fatalf("buildLessonUpdateBody: %v", err)
	}
	if len(body) != 2 {
		t.Fatalf("body = %#v, want only change_summary and evidence", body)
	}
	if body["change_summary"] != "Narrow the rule to index migrations" {
		t.Errorf("change_summary = %v", body["change_summary"])
	}
	if _, ok := body["evidence"].([]map[string]any); !ok {
		t.Errorf("evidence = %#v", body["evidence"])
	}
}

func TestBuildLessonUpdateBodyRefusesEmptyUpdate(t *testing.T) {
	cmd := newLessonUpdateTestCmd()
	_, err := buildLessonUpdateBody(cmd)
	if err == nil || !strings.Contains(err.Error(), "no fields to update") {
		t.Fatalf("error = %v, want 'no fields to update'", err)
	}
}

func TestRunLessonProposePostsBodyAndPrintsKey(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/api/lessons" {
			t.Fatalf("path = %q, want /api/lessons", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "lesson-1", "key": "LP-3"})
	}))
	defer srv.Close()
	setSkillServerEnv(t, srv.URL)

	cmd := newLessonProposeTestCmd()
	setRequiredLessonProseFlags(cmd)
	_ = cmd.Flags().Set("skill", "skill-123")
	_ = cmd.Flags().Set("base-version", "version-456")
	_ = cmd.Flags().Set("content", writeTempFile(t, "SKILL.md", "# body\n"))
	_ = cmd.Flags().Set("evidence", "issue:22222222-2222-2222-2222-222222222222:seen twice")

	out, err := captureStdout(t, func() error { return runLessonPropose(cmd, nil) })
	if err != nil {
		t.Fatalf("runLessonPropose: %v", err)
	}
	if !strings.Contains(out, "LP-3") || !strings.Contains(out, "lesson-1") {
		t.Fatalf("output %q must name the lesson key and id", out)
	}

	evidence, ok := gotBody["evidence"].([]any)
	if !ok || len(evidence) != 1 {
		t.Fatalf("evidence = %#v", gotBody["evidence"])
	}
	entry, _ := evidence[0].(map[string]any)
	if entry["kind"] != "issue" || entry["note"] != "seen twice" {
		t.Fatalf("evidence entry = %#v", entry)
	}
}

func TestRunLessonWithdrawRequiresReason(t *testing.T) {
	setSkillServerEnv(t, "http://127.0.0.1:1")

	cmd := &cobra.Command{Use: "withdraw"}
	cmd.Flags().String("server-url", "", "")
	cmd.Flags().String("workspace-id", "", "")
	cmd.Flags().String("profile", "", "")
	cmd.Flags().String("reason", "", "")
	cmd.Flags().String("output", "table", "")

	if err := runLessonWithdraw(cmd, []string{"lesson-1"}); err == nil ||
		!strings.Contains(err.Error(), "--reason is required") {
		t.Fatalf("error = %v, want '--reason is required'", err)
	}
}

func TestRunLessonWithdrawPostsToDeprecateRoute(t *testing.T) {
	var gotPath string
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "lesson-1", "key": "LP-3"})
	}))
	defer srv.Close()
	setSkillServerEnv(t, srv.URL)

	cmd := &cobra.Command{Use: "withdraw"}
	cmd.Flags().String("server-url", "", "")
	cmd.Flags().String("workspace-id", "", "")
	cmd.Flags().String("profile", "", "")
	cmd.Flags().String("reason", "It made the wrong call on hotfixes", "")
	cmd.Flags().String("output", "table", "")
	_ = cmd.Flags().Set("reason", "It made the wrong call on hotfixes")

	if _, err := captureStdout(t, func() error { return runLessonWithdraw(cmd, []string{"lesson-1"}) }); err != nil {
		t.Fatalf("runLessonWithdraw: %v", err)
	}
	if gotPath != "/api/lessons/lesson-1/deprecate" {
		t.Fatalf("path = %q, want /api/lessons/lesson-1/deprecate", gotPath)
	}
	if gotBody["reason"] != "It made the wrong call on hotfixes" {
		t.Fatalf("reason = %v", gotBody["reason"])
	}
}

func TestRunLessonListSendsFiltersAndPrintsTable(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		_ = json.NewEncoder(w).Encode(map[string]any{
			"lessons": []any{map[string]any{
				"key":               "LP-3",
				"title":             "Always run the migration check",
				"status":            "proposed",
				"target_skill_name": "migrations",
				"created_at":        "2026-09-01T00:00:00Z",
			}},
			"counts": map[string]any{"proposed": 1},
		})
	}))
	defer srv.Close()
	setSkillServerEnv(t, srv.URL)

	cmd := &cobra.Command{Use: "list"}
	cmd.Flags().String("server-url", "", "")
	cmd.Flags().String("workspace-id", "", "")
	cmd.Flags().String("profile", "", "")
	cmd.Flags().String("status", "", "")
	cmd.Flags().String("skill", "", "")
	cmd.Flags().String("retrospective", "", "")
	cmd.Flags().Int("limit", 0, "")
	cmd.Flags().Int("offset", 0, "")
	cmd.Flags().String("output", "table", "")
	_ = cmd.Flags().Set("status", "proposed")
	_ = cmd.Flags().Set("skill", "skill-123")
	_ = cmd.Flags().Set("limit", "10")

	out, err := captureStdout(t, func() error { return runLessonList(cmd, nil) })
	if err != nil {
		t.Fatalf("runLessonList: %v", err)
	}
	for _, want := range []string{"status=proposed", "skill_id=skill-123", "limit=10"} {
		if !strings.Contains(gotQuery, want) {
			t.Errorf("query %q missing %q", gotQuery, want)
		}
	}
	if strings.Contains(gotQuery, "offset") {
		t.Errorf("query %q must omit an unset offset", gotQuery)
	}
	if !strings.Contains(out, "LP-3") || !strings.Contains(out, "migrations") {
		t.Fatalf("table output %q must contain the key and skill name", out)
	}
}
