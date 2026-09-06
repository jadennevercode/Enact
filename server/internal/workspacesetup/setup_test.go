package workspacesetup

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Every shipped language must carry copy for every step. Without this, adding
// a step means a Chinese workspace silently files an issue with an empty
// title, which no other test would catch — the filer would succeed.
func TestEveryLanguageCoversEveryStep(t *testing.T) {
	for _, lang := range Languages {
		c, ok := copies[lang]
		if !ok {
			t.Fatalf("language %q has no copy", lang)
		}
		if strings.TrimSpace(c.InboxTitle) == "" || strings.TrimSpace(c.InboxBody) == "" {
			t.Errorf("language %q: inbox copy is blank", lang)
		}
		if !strings.Contains(c.ParentTitle, "%s") {
			t.Errorf("language %q: parent title %q does not take the workspace name", lang, c.ParentTitle)
		}
		if strings.TrimSpace(c.ParentBody) == "" {
			t.Errorf("language %q: parent body is blank", lang)
		}
		for _, step := range Steps {
			if strings.TrimSpace(c.StepTitles[step]) == "" {
				t.Errorf("language %q: step %q has no title", lang, step)
			}
			if strings.TrimSpace(c.StepBodies[step]) == "" {
				t.Errorf("language %q: step %q has no body", lang, step)
			}
		}
		if len(c.StepTitles) != len(Steps) {
			t.Errorf("language %q: %d step titles for %d steps — a removed step left its copy behind",
				lang, len(c.StepTitles), len(Steps))
		}
	}
}

// The workspace name is interpolated into a title, so a workspace called
// "100%" must not turn the title into a formatting error.
func TestParentTitleSurvivesAPercentInTheName(t *testing.T) {
	got := For("en").ParentTitleFor("100% Coverage")
	if strings.Contains(got, "%!") {
		t.Fatalf("formatting verb leaked: %q", got)
	}
	if !strings.Contains(got, "100% Coverage") {
		t.Fatalf("workspace name lost: %q", got)
	}
}

func TestNormalizeLanguage(t *testing.T) {
	cases := map[string]string{
		"":        "en",
		"en":      "en",
		"EN":      "en",
		"zh":      "zh",
		"zh-Hans": "zh",
		"zh_CN":   "zh",
		"ja-JP":   "ja",
		"ko":      "ko",
		"de":      "en",
		"  zh  ":  "zh",
	}
	for input, want := range cases {
		if got := NormalizeLanguage(input); got != want {
			t.Errorf("NormalizeLanguage(%q) = %q, want %q", input, got, want)
		}
	}
}

// The derived id is the once-only guarantee: migration 447's unique index is
// on (workspace_id, origin_id), so two callers computing it for the same step
// must land on the same value, and two different steps must not collide.
func TestStepOriginIDIsStableAndDistinct(t *testing.T) {
	ws := uuid.MustParse("3f2504e0-4f89-41d3-9a0c-0305e82c3301")
	other := uuid.MustParse("3f2504e0-4f89-41d3-9a0c-0305e82c3302")

	first := StepOriginID(ws, StepRuntime)
	if second := StepOriginID(ws, StepRuntime); first != second {
		t.Fatalf("not deterministic: %s then %s", first, second)
	}
	if StepOriginID(ws, StepRuntime) == StepOriginID(ws, StepProfile) {
		t.Fatal("two steps of one workspace share an origin id")
	}
	if StepOriginID(ws, StepRuntime) == StepOriginID(other, StepRuntime) {
		t.Fatal("the same step in two workspaces shares an origin id")
	}
	// The parent shares the index with the steps, so it must not collide with
	// any of them either.
	for _, step := range Steps {
		if ParentOriginID(ws) == StepOriginID(ws, step) {
			t.Fatalf("step %q collides with the parent origin id", step)
		}
	}
}
