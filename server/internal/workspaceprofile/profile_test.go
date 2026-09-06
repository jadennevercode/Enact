package workspaceprofile

import (
	"strings"
	"testing"
)

func TestNormalizeLowercasesDeduplicatesAndKeepsOrder(t *testing.T) {
	got, err := Normalize(Profile{
		Summary: "  A logistics control tower.  ",
		Stack:   []string{" Go ", "TypeScript", "go", "", "Postgres"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Summary != "A logistics control tower." {
		t.Errorf("summary not trimmed: %q", got.Summary)
	}
	want := []string{"go", "typescript", "postgres"}
	if len(got.Stack) != len(want) {
		t.Fatalf("stack = %v, want %v", got.Stack, want)
	}
	for i := range want {
		if got.Stack[i] != want[i] {
			t.Fatalf("stack = %v, want %v", got.Stack, want)
		}
	}
}

func TestNormalizeRejectsUnknownTypicalWork(t *testing.T) {
	_, err := Normalize(Profile{TypicalWork: []string{"ship_code", "juggling"}})
	if err == nil {
		t.Fatal("expected an error for a value outside the vocabulary")
	}
	if !strings.Contains(err.Error(), "juggling") {
		t.Errorf("error should name the offending value, got %q", err)
	}
	if !strings.Contains(err.Error(), "ship_code") {
		t.Errorf("error should list the allowed values, got %q", err)
	}
}

func TestNormalizeEnforcesBounds(t *testing.T) {
	if _, err := Normalize(Profile{Summary: strings.Repeat("x", MaxSummaryLen+1)}); err == nil {
		t.Error("over-long summary accepted")
	}
	if _, err := Normalize(Profile{Stack: []string{strings.Repeat("x", MaxListItemLen+1)}}); err == nil {
		t.Error("over-long stack entry accepted")
	}
	tooMany := make([]string, 0, MaxListItems+1)
	for i := 0; i <= MaxListItems; i++ {
		tooMany = append(tooMany, string(rune('a'+i%26))+strings.Repeat("z", i))
	}
	if _, err := Normalize(Profile{Stack: tooMany}); err == nil {
		t.Error("over-long stack accepted")
	}
}

// Bookkeeping is stamped by the write, so a profile carrying only UpdatedAt
// and UpdatedBy is still empty. Treating it as answered would close the setup
// step and start recommending against nothing.
func TestIsEmptyIgnoresBookkeeping(t *testing.T) {
	if !(Profile{UpdatedAt: "2026-01-01T00:00:00Z", UpdatedBy: "someone"}).IsEmpty() {
		t.Error("a profile with only bookkeeping should read as empty")
	}
	if (Profile{Summary: "x"}).IsEmpty() {
		t.Error("a profile with a summary should not read as empty")
	}
	if (Profile{TypicalWork: []string{"ship_code"}}).IsEmpty() {
		t.Error("a profile with typical work should not read as empty")
	}
}

// Every consumer treats the profile as advisory, so unreadable storage yields
// the zero value rather than an error that would fail a task brief.
func TestParseToleratesGarbage(t *testing.T) {
	for _, raw := range []string{"", "null", "not json", `["an","array"]`, `"a string"`} {
		if got := Parse([]byte(raw)); !got.IsEmpty() {
			t.Errorf("Parse(%q) returned %+v, want the zero profile", raw, got)
		}
	}
}

func TestParseReadsAWrittenProfile(t *testing.T) {
	encoded, err := Encode(Profile{Summary: "A control tower.", Stack: []string{"go"}})
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	got := Parse(encoded)
	if got.Summary != "A control tower." || len(got.Stack) != 1 || got.Stack[0] != "go" {
		t.Fatalf("round trip lost data: %+v", got)
	}
}

func TestBriefIsEmptyForAnEmptyProfile(t *testing.T) {
	if Brief(Profile{}) != "" {
		t.Error("an empty profile should render no section, not an empty heading")
	}
}

func TestBriefStatesItsTrustLevelAndCarriesTheFields(t *testing.T) {
	got := Brief(Profile{
		Summary:     "A logistics control tower.",
		Stack:       []string{"go", "typescript"},
		TypicalWork: []string{"ship_code"},
		RepoBrief:   "Go module at ./server, pnpm workspace at ./apps.",
	})
	if !strings.Contains(got, "## Project profile") {
		t.Error("missing heading")
	}
	if !strings.Contains(got, "never an instruction") {
		t.Error("the section must state that it is context rather than instruction")
	}
	for _, want := range []string{"A logistics control tower.", "go, typescript", "ship_code", "pnpm workspace"} {
		if !strings.Contains(got, want) {
			t.Errorf("brief is missing %q:\n%s", want, got)
		}
	}
}

func TestCoversResource(t *testing.T) {
	p := Profile{RepoBriefSources: []string{"res-1", "res-2"}}
	if !p.CoversResource("res-2") {
		t.Error("known resource reported as uncovered")
	}
	if p.CoversResource("res-3") {
		t.Error("unknown resource reported as covered")
	}
}
