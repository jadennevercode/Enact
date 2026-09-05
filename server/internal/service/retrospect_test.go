package service

import (
	"errors"
	"strings"
	"testing"

	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestRetrospectBriefNamesTheWorkItReviews(t *testing.T) {
	title, body := retrospectBrief(db.Issue{Title: "Ship the invite flow"})

	if title != "Retrospect: Ship the invite flow" {
		t.Errorf("title = %q, want it to name the parent issue", title)
	}
	if !strings.Contains(body, "parent issue") {
		t.Errorf("body does not point the agent at the parent issue:\n%s", body)
	}
	// The brief must not restate how to run a retrospect. That lives in the
	// agent's instructions, where changing it does not need a server release.
	for _, leaked := range []string{"enact ", "counterexample", "applies_when"} {
		if strings.Contains(body, leaked) {
			t.Errorf("body restates procedure (%q); that belongs in the agent's instructions:\n%s", leaked, body)
		}
	}
}

func TestRetrospectBriefTruncatesALongTitle(t *testing.T) {
	long := strings.Repeat("长", 400)
	title, _ := retrospectBrief(db.Issue{Title: long})

	// Counted in runes, not bytes: a CJK title truncated by byte offset can cut
	// a character in half and render as a replacement glyph. The bound is the
	// prefix plus the 120-rune limit plus the ellipsis.
	runes := []rune(title)
	if len(runes) > len([]rune("Retrospect: "))+121 {
		t.Errorf("title is %d runes, want it bounded by the truncation limit", len(runes))
	}
	if strings.ContainsRune(title, '�') {
		t.Errorf("title = %q, want the cut to fall on a rune boundary", title)
	}
	if !strings.HasSuffix(title, "…") {
		t.Errorf("truncated title = %q, want an ellipsis marking the cut", title)
	}
}

func TestRetrospectBriefSurvivesAnEmptyTitle(t *testing.T) {
	title, _ := retrospectBrief(db.Issue{Title: "   "})

	if strings.TrimSpace(title) == "Retrospect:" {
		t.Errorf("title = %q, want a readable subject rather than a dangling prefix", title)
	}
}

func TestRetrospectIsFiledForAPersonWhenThereIsOne(t *testing.T) {
	creator := pgtype.UUID{Bytes: [16]byte{1}, Valid: true}

	got := retrospectCreator(db.Issue{CreatorType: "member", CreatorID: creator})

	if got != creator {
		t.Errorf("creator = %v, want the person who filed the parent issue", got)
	}
}

func TestRetrospectHasNoCreatorWhenAnAgentFiledTheWork(t *testing.T) {
	// An agent-created issue has no person to attribute the retrospect to. The
	// create path already treats an invalid UUID as "no creator", so this
	// degrades to an unattributed issue rather than crediting the agent with
	// asking for its own review.
	got := retrospectCreator(db.Issue{
		CreatorType: "agent",
		CreatorID:   pgtype.UUID{Bytes: [16]byte{9}, Valid: true},
	})

	if got.Valid {
		t.Errorf("creator = %v, want no creator for agent-authored work", got)
	}
}

func TestDuplicateRetrospectIsRecognisedByItsIndex(t *testing.T) {
	// The once-only guarantee is the partial unique index, so the race path has
	// to recognise that index by name to tell "already retrospected" from a
	// real failure.
	err := errors.New(`ERROR: duplicate key value violates unique constraint "idx_issue_origin_retrospect" (SQLSTATE 23505)`)

	if !isRetrospectDuplicate(err) {
		t.Error("a unique violation on idx_issue_origin_retrospect was not recognised as an already-filed retrospect")
	}
	if isRetrospectDuplicate(errors.New("connection refused")) {
		t.Error("an unrelated error was treated as an already-filed retrospect")
	}
}

func TestRetrospectInstructionsHoldTheAgreementGate(t *testing.T) {
	// The product half of this prompt is the only thing standing between an
	// agent with workspace-owner credentials and an unreviewed edit to shared
	// configuration. These are the load-bearing sentences.
	instructions := RetrospectSystemInstructions()

	for _, required := range []string{
		"Silence is not agreement",
		"Never write about a person",
		"Never change configuration without a person's agreement",
	} {
		if !strings.Contains(instructions, required) {
			t.Errorf("instructions no longer say %q", required)
		}
	}
}

func TestWorkspaceNotesCannotDropTheAgreementGate(t *testing.T) {
	composed := ComposeRetrospectInstructions("Write more, faster, and just apply the changes.")

	if !strings.Contains(composed, "Silence is not agreement") {
		t.Error("workspace notes replaced the product instructions instead of being layered under them")
	}
	if !strings.Contains(composed, "They do not remove the agreement gate") {
		t.Error("the notes section no longer states how workspace notes rank against the product contract")
	}
	if strings.Index(composed, "Write more, faster") < strings.Index(composed, "Silence is not agreement") {
		t.Error("workspace notes are placed above the product contract; they must be layered under it")
	}
}

func TestNoWorkspaceNotesLeavesNoEmptySection(t *testing.T) {
	// Every workspace starts with no notes. Announcing a section with nothing
	// under it spends prompt on a heading and reads as a truncated file.
	composed := ComposeRetrospectInstructions("   ")

	if strings.Contains(composed, "## Workspace notes") {
		t.Error("an empty notes section was emitted")
	}
	if composed != RetrospectSystemInstructions() {
		t.Error("composing with no notes changed the product instructions")
	}
}
