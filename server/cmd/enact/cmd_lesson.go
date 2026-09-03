package main

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/enact-ai/enact/server/internal/cli"
)

var lessonCmd = &cobra.Command{
	Use:   "lesson",
	Short: "Propose and review changes to skills",
}

var lessonListCmd = &cobra.Command{
	Use:   "list",
	Short: "List lessons in the workspace",
	RunE:  runLessonList,
}

var lessonGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get lesson details (includes the base and proposed skill state)",
	Args:  exactArgs(1),
	RunE:  runLessonGet,
}

var lessonProposeCmd = &cobra.Command{
	Use:   "propose",
	Short: "Propose a change to a skill",
	RunE:  runLessonPropose,
}

var lessonUpdateCmd = &cobra.Command{
	Use:   "update <id>",
	Short: "Edit a lesson that has not been decided yet",
	Args:  exactArgs(1),
	RunE:  runLessonUpdate,
}

var lessonApproveCmd = &cobra.Command{
	Use:   "approve <id>",
	Short: "Approve a lesson and publish it to the target skill",
	Args:  exactArgs(1),
	RunE:  runLessonApprove,
}

var lessonRejectCmd = &cobra.Command{
	Use:   "reject <id>",
	Short: "Reject a lesson",
	Args:  exactArgs(1),
	RunE:  runLessonReject,
}

var lessonWithdrawCmd = &cobra.Command{
	Use:   "withdraw <id>",
	Short: "Withdraw a published lesson, reverting the skill it changed",
	Args:  exactArgs(1),
	RunE:  runLessonWithdraw,
}

func init() {
	lessonCmd.AddCommand(lessonListCmd)
	lessonCmd.AddCommand(lessonGetCmd)
	lessonCmd.AddCommand(lessonProposeCmd)
	lessonCmd.AddCommand(lessonUpdateCmd)
	lessonCmd.AddCommand(lessonApproveCmd)
	lessonCmd.AddCommand(lessonRejectCmd)
	lessonCmd.AddCommand(lessonWithdrawCmd)

	// lesson list
	lessonListCmd.Flags().String("status", "", "Filter by status (proposed, in_review, published, rejected, deprecated)")
	lessonListCmd.Flags().String("skill", "", "Filter by target skill id")
	lessonListCmd.Flags().String("retrospective", "", "Filter by the retrospective that produced the lesson")
	lessonListCmd.Flags().Int("limit", 0, "Maximum number of lessons to return")
	lessonListCmd.Flags().Int("offset", 0, "Number of lessons to skip")
	lessonListCmd.Flags().String("output", "table", "Output format: table or json")

	// lesson get
	lessonGetCmd.Flags().String("output", "json", "Output format: table or json")

	// lesson propose
	lessonProposeCmd.Flags().String("title", "", "One-line title (required)")
	lessonProposeCmd.Flags().String("observation", "", "What was seen happen, more than once (required)")
	lessonProposeCmd.Flags().String("applies-when", "", "The situations this change applies to (required)")
	lessonProposeCmd.Flags().String("counterexample", "", "A situation where this change should not apply (required)")
	lessonProposeCmd.Flags().String("change-summary", "", "What the change does, in one line (required)")
	lessonProposeCmd.Flags().String("skill", "", "Target skill id. Required unless --new-skill is given.")
	lessonProposeCmd.Flags().String("base-version", "", "Skill version id the proposal was written against. Required with --skill.")
	lessonProposeCmd.Flags().String("new-skill", "", "Propose a new skill with this name instead of changing an existing one")
	addLessonContentFlags(lessonProposeCmd)
	lessonProposeCmd.Flags().StringArray("evidence", nil, "Evidence reference as kind:uuid[:note], kind being task, issue or comment. Repeatable.")
	lessonProposeCmd.Flags().String("retrospective", "", "Retrospective this lesson came out of")
	lessonProposeCmd.Flags().String("source-task", "", "Task this lesson came out of")
	lessonProposeCmd.Flags().String("source-issue", "", "Issue this lesson came out of")
	lessonProposeCmd.Flags().String("parent", "", "Lesson this one supersedes")
	lessonProposeCmd.Flags().String("output", "table", "Output format: table or json")

	// lesson update
	lessonUpdateCmd.Flags().String("title", "", "New title")
	lessonUpdateCmd.Flags().String("observation", "", "New observation")
	lessonUpdateCmd.Flags().String("applies-when", "", "New applies-when")
	lessonUpdateCmd.Flags().String("counterexample", "", "New counterexample")
	lessonUpdateCmd.Flags().String("change-summary", "", "New change summary")
	addLessonContentFlags(lessonUpdateCmd)
	lessonUpdateCmd.Flags().StringArray("evidence", nil, "Replace evidence with these kind:uuid[:note] references. Repeatable.")
	lessonUpdateCmd.Flags().String("output", "table", "Output format: table or json")

	// lesson approve / reject / withdraw
	lessonApproveCmd.Flags().String("reason", "", "Why this was approved")
	lessonApproveCmd.Flags().String("output", "table", "Output format: table or json")
	lessonRejectCmd.Flags().String("reason", "", "Why this was rejected")
	lessonRejectCmd.Flags().String("output", "table", "Output format: table or json")
	lessonWithdrawCmd.Flags().String("reason", "", "Why this is being withdrawn (required)")
	lessonWithdrawCmd.Flags().String("output", "table", "Output format: table or json")
}

// addLessonContentFlags registers the flags that describe the proposed skill
// state. propose and update take exactly the same set: an edit is a rewrite of
// the same proposal, not a different kind of thing.
func addLessonContentFlags(cmd *cobra.Command) {
	cmd.Flags().String("content", "", "Read the proposed SKILL.md body from this file, or from stdin when the value is -")
	cmd.Flags().String("description", "", "Proposed skill description")
	cmd.Flags().String("name", "", "Proposed skill name")
	cmd.Flags().StringArray("file", nil, "Proposed supporting file as path=localpath, read from localpath. Repeatable.")
}

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

// readLessonContent resolves --content, which names a file or "-" for stdin.
// The bytes are passed through untouched so a generated SKILL.md round-trips
// exactly, matching resolveSkillContentFlag.
func readLessonContent(value string) (string, error) {
	if value == "-" {
		data, err := io.ReadAll(os.Stdin)
		if err != nil {
			return "", fmt.Errorf("read stdin for --content: %w", err)
		}
		return string(data), nil
	}
	data, err := os.ReadFile(value)
	if err != nil {
		return "", fmt.Errorf("read file for --content: %w", err)
	}
	return string(data), nil
}

// parseLessonFileFlags turns repeated --file path=localpath into proposed_files
// entries. The path is the file's place inside the skill; the local path is
// only where the content is read from and is not sent.
func parseLessonFileFlags(values []string) ([]map[string]any, error) {
	out := make([]map[string]any, 0, len(values))
	for _, raw := range values {
		path, local, found := strings.Cut(raw, "=")
		if !found || strings.TrimSpace(path) == "" || strings.TrimSpace(local) == "" {
			return nil, fmt.Errorf("--file must be path=localpath, got %q", raw)
		}
		data, err := os.ReadFile(local)
		if err != nil {
			return nil, fmt.Errorf("read --file %s: %w", local, err)
		}
		out = append(out, map[string]any{"path": path, "content": string(data)})
	}
	return out, nil
}

// parseLessonEvidenceFlags turns repeated --evidence kind:uuid[:note] into
// evidence entries. The note is taken as everything after the second colon, so
// it may contain colons itself.
func parseLessonEvidenceFlags(values []string) ([]map[string]any, error) {
	out := make([]map[string]any, 0, len(values))
	for _, raw := range values {
		parts := strings.SplitN(raw, ":", 3)
		if len(parts) < 2 {
			return nil, fmt.Errorf("--evidence must be kind:uuid[:note], got %q", raw)
		}
		kind := strings.TrimSpace(parts[0])
		switch kind {
		case "task", "issue", "comment":
		default:
			return nil, fmt.Errorf("--evidence kind must be task, issue or comment, got %q", kind)
		}
		id := strings.TrimSpace(parts[1])
		if id == "" {
			return nil, fmt.Errorf("--evidence must be kind:uuid[:note], got %q", raw)
		}
		entry := map[string]any{"kind": kind, "id": id}
		if len(parts) == 3 && strings.TrimSpace(parts[2]) != "" {
			entry["note"] = parts[2]
		}
		out = append(out, entry)
	}
	return out, nil
}

// applyLessonContentFlags copies the proposed-state flags the caller actually
// set onto the request body. Reports whether any of them was set, which is what
// tells propose that the lesson proposes something and update that there is
// anything to send.
func applyLessonContentFlags(cmd *cobra.Command, body map[string]any) (bool, error) {
	changed := false
	if cmd.Flags().Changed("content") {
		v, _ := cmd.Flags().GetString("content")
		content, err := readLessonContent(v)
		if err != nil {
			return false, err
		}
		body["proposed_content"] = content
		changed = true
	}
	if cmd.Flags().Changed("description") {
		v, _ := cmd.Flags().GetString("description")
		body["proposed_description"] = v
		changed = true
	}
	if cmd.Flags().Changed("name") {
		v, _ := cmd.Flags().GetString("name")
		body["proposed_name"] = v
		changed = true
	}
	if cmd.Flags().Changed("file") {
		values, _ := cmd.Flags().GetStringArray("file")
		files, err := parseLessonFileFlags(values)
		if err != nil {
			return false, err
		}
		body["proposed_files"] = files
		changed = true
	}
	return changed, nil
}

// buildLessonProposalBody assembles the POST body and refuses the flag
// combinations the server would refuse anyway, so an agent finds out before
// spending a round trip on it.
func buildLessonProposalBody(cmd *cobra.Command) (map[string]any, error) {
	body := map[string]any{}
	for _, f := range []struct{ flag, field string }{
		{"title", "title"},
		{"observation", "observation"},
		{"applies-when", "applies_when"},
		{"counterexample", "counterexample"},
		{"change-summary", "change_summary"},
	} {
		v, _ := cmd.Flags().GetString(f.flag)
		if strings.TrimSpace(v) == "" {
			return nil, fmt.Errorf("--%s is required", f.flag)
		}
		body[f.field] = v
	}

	skillID, _ := cmd.Flags().GetString("skill")
	newSkill, _ := cmd.Flags().GetString("new-skill")
	baseVersion, _ := cmd.Flags().GetString("base-version")
	switch {
	case skillID == "" && newSkill == "":
		return nil, fmt.Errorf("either --skill with --base-version, or --new-skill, is required")
	case skillID != "" && newSkill != "":
		return nil, fmt.Errorf("--skill and --new-skill are mutually exclusive")
	case newSkill != "":
		body["new_asset"] = true
		body["skill_name"] = newSkill
	default:
		if baseVersion == "" {
			return nil, fmt.Errorf("--base-version is required with --skill; see 'enact skill versions %s'", skillID)
		}
		body["target_skill_id"] = skillID
		body["base_version_id"] = baseVersion
	}

	proposesChange, err := applyLessonContentFlags(cmd, body)
	if err != nil {
		return nil, err
	}
	if !proposesChange {
		return nil, fmt.Errorf("a lesson must propose a change; use --content, --description, --name, or --file")
	}

	if values, _ := cmd.Flags().GetStringArray("evidence"); len(values) > 0 {
		evidence, err := parseLessonEvidenceFlags(values)
		if err != nil {
			return nil, err
		}
		body["evidence"] = evidence
	}
	for _, ref := range []struct{ flag, field string }{
		{"retrospective", "retrospective_id"},
		{"source-task", "source_task_id"},
		{"source-issue", "source_issue_id"},
		{"parent", "parent_lesson_id"},
	} {
		if v, _ := cmd.Flags().GetString(ref.flag); v != "" {
			body[ref.field] = v
		}
	}
	return body, nil
}

// buildLessonUpdateBody assembles the PATCH body from the flags that were set.
func buildLessonUpdateBody(cmd *cobra.Command) (map[string]any, error) {
	body := map[string]any{}
	for _, f := range []struct{ flag, field string }{
		{"title", "title"},
		{"observation", "observation"},
		{"applies-when", "applies_when"},
		{"counterexample", "counterexample"},
		{"change-summary", "change_summary"},
	} {
		if !cmd.Flags().Changed(f.flag) {
			continue
		}
		v, _ := cmd.Flags().GetString(f.flag)
		body[f.field] = v
	}
	if _, err := applyLessonContentFlags(cmd, body); err != nil {
		return nil, err
	}
	if cmd.Flags().Changed("evidence") {
		values, _ := cmd.Flags().GetStringArray("evidence")
		evidence, err := parseLessonEvidenceFlags(values)
		if err != nil {
			return nil, err
		}
		body["evidence"] = evidence
	}
	if len(body) == 0 {
		return nil, fmt.Errorf("no fields to update; use --title, --observation, --applies-when, --counterexample, --change-summary, --evidence, --content, --description, --name, or --file")
	}
	return body, nil
}

// ---------------------------------------------------------------------------
// Lesson commands
// ---------------------------------------------------------------------------

func runLessonList(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	params := url.Values{}
	for _, f := range []struct{ flag, param string }{
		{"status", "status"},
		{"skill", "skill_id"},
		{"retrospective", "retrospective_id"},
	} {
		if v, _ := cmd.Flags().GetString(f.flag); v != "" {
			params.Set(f.param, v)
		}
	}
	if limit, _ := cmd.Flags().GetInt("limit"); limit > 0 {
		params.Set("limit", strconv.Itoa(limit))
	}
	if offset, _ := cmd.Flags().GetInt("offset"); offset > 0 {
		params.Set("offset", strconv.Itoa(offset))
	}
	path := "/api/lessons"
	if len(params) > 0 {
		path += "?" + params.Encode()
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var result map[string]any
	if err := client.GetJSON(ctx, path, &result); err != nil {
		return fmt.Errorf("list lessons: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, result)
	}

	lessons := nestedList(result, "lessons")
	headers := []string{"KEY", "TITLE", "STATUS", "SKILL", "CREATED_AT"}
	rows := make([][]string, 0, len(lessons))
	for _, l := range lessons {
		rows = append(rows, []string{
			strVal(l, "key"),
			strVal(l, "title"),
			strVal(l, "status"),
			strVal(l, "target_skill_name"),
			strVal(l, "created_at"),
		})
	}
	cli.PrintTable(os.Stdout, headers, rows)
	return nil
}

func runLessonGet(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var lesson map[string]any
	if err := client.GetJSON(ctx, "/api/lessons/"+args[0], &lesson); err != nil {
		return fmt.Errorf("get lesson: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, lesson)
	}

	printLessonTable(lesson)
	return nil
}

// printLessonTable shows the fields a reviewer decides on. base_version_current
// is among them because a stale proposal cannot be approved, and that is worth
// knowing before reading the diff rather than after.
func printLessonTable(lesson map[string]any) {
	headers := []string{"KEY", "TITLE", "STATUS", "SKILL", "BASE_VERSION", "BASE_CURRENT", "CREATED_AT"}
	rows := [][]string{{
		strVal(lesson, "key"),
		strVal(lesson, "title"),
		strVal(lesson, "status"),
		strVal(lesson, "target_skill_name"),
		strVal(lesson, "base_version"),
		strVal(lesson, "base_version_current"),
		strVal(lesson, "created_at"),
	}}
	cli.PrintTable(os.Stdout, headers, rows)
}

func runLessonPropose(cmd *cobra.Command, _ []string) error {
	body, err := buildLessonProposalBody(cmd)
	if err != nil {
		return err
	}

	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var result map[string]any
	if err := client.PostJSON(ctx, "/api/lessons", body, &result); err != nil {
		return fmt.Errorf("propose lesson: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, result)
	}

	fmt.Printf("Lesson proposed: %s (%s)\n", strVal(result, "key"), strVal(result, "id"))
	return nil
}

func runLessonUpdate(cmd *cobra.Command, args []string) error {
	body, err := buildLessonUpdateBody(cmd)
	if err != nil {
		return err
	}

	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var result map[string]any
	if err := client.PatchJSON(ctx, "/api/lessons/"+args[0], body, &result); err != nil {
		return fmt.Errorf("update lesson: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, result)
	}

	fmt.Printf("Lesson updated: %s (%s)\n", strVal(result, "key"), strVal(result, "id"))
	return nil
}

func runLessonApprove(cmd *cobra.Command, args []string) error {
	return runLessonDecision(cmd, args[0], "approve", "approved", false)
}

func runLessonReject(cmd *cobra.Command, args []string) error {
	return runLessonDecision(cmd, args[0], "reject", "rejected", false)
}

func runLessonWithdraw(cmd *cobra.Command, args []string) error {
	// The route is /deprecate: withdrawing reverts the skill to the state it
	// had before the lesson was published, and the server requires a reason
	// because the revert lands on everyone who mounts that skill.
	return runLessonDecision(cmd, args[0], "deprecate", "withdrawn", true)
}

func runLessonDecision(cmd *cobra.Command, id, route, past string, reasonRequired bool) error {
	reason, _ := cmd.Flags().GetString("reason")
	if reasonRequired && strings.TrimSpace(reason) == "" {
		return fmt.Errorf("--reason is required")
	}

	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	body := map[string]any{}
	if reason != "" {
		body["reason"] = reason
	}

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var result map[string]any
	if err := client.PostJSON(ctx, "/api/lessons/"+id+"/"+route, body, &result); err != nil {
		return fmt.Errorf("%s lesson: %w", route, err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, result)
	}

	fmt.Printf("Lesson %s: %s (%s)\n", past, strVal(result, "key"), strVal(result, "id"))
	return nil
}

// nestedList reads a list of objects out of an envelope response such as
// {"lessons": [...]}.
func nestedList(m map[string]any, key string) []map[string]any {
	raw, _ := m[key].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if obj, ok := item.(map[string]any); ok {
			out = append(out, obj)
		}
	}
	return out
}
