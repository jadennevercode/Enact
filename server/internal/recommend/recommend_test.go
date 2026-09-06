package recommend

import (
	"testing"

	"github.com/enact-ai/enact/server/internal/workspaceprofile"
)

func idsOf(scored []Scored) []string {
	out := make([]string, len(scored))
	for i, s := range scored {
		out[i] = s.Candidate.ID
	}
	return out
}

func find(t *testing.T, scored []Scored, id string) Scored {
	t.Helper()
	for _, s := range scored {
		if s.Candidate.ID == id {
			return s
		}
	}
	t.Fatalf("%q is not in the ranking %v", id, idsOf(scored))
	return Scored{}
}

func reasonFor(s Scored, kind ReasonKind) (Reason, bool) {
	for _, r := range s.Reasons {
		if r.Kind == kind {
			return r, true
		}
	}
	return Reason{}, false
}

// The point of the whole package: a listing that matches the project outranks
// one that is merely popular and official.
func TestProfileMatchOutranksPopularity(t *testing.T) {
	profile := workspaceprofile.Profile{Stack: []string{"go", "postgres"}}
	ranked := Rank(profile, []Candidate{
		{ID: "popular", Name: "Weekly Digest", Description: "Posts a summary.",
			Official: true, Featured: true, InstallCount: 5000},
		{ID: "fits", Name: "Go Review Checklist", Tags: []string{"go", "review"}},
	}, 0)

	if got := idsOf(ranked); got[0] != "fits" {
		t.Fatalf("ranking = %v, want the stack match first", got)
	}
	if !find(t, ranked, "fits").Matched {
		t.Error("a stack match should be marked as matched")
	}
	if find(t, ranked, "popular").Matched {
		t.Error("official + featured + popular is not a match on the profile")
	}
}

// A member has to be able to see why something surfaced, and disagree with it.
// An unexplained ranking is one nobody can correct.
func TestEveryProfileMatchCarriesItsEvidence(t *testing.T) {
	profile := workspaceprofile.Profile{
		Stack:       []string{"typescript"},
		Domain:      "logistics",
		TypicalWork: []string{"review_code"},
	}
	ranked := Rank(profile, []Candidate{{
		ID:          "one",
		Name:        "Logistics helper",
		Description: "Review code for a TypeScript service.",
		Tags:        []string{"typescript"},
	}}, 0)

	s := find(t, ranked, "one")
	stack, ok := reasonFor(s, ReasonStack)
	if !ok {
		t.Fatal("no stack reason")
	}
	if stack.Term != "typescript" || stack.Field != "tag" {
		t.Errorf("stack reason = %+v, want the typescript tag", stack)
	}
	if _, ok := reasonFor(s, ReasonDomain); !ok {
		t.Error("no domain reason for a listing naming the domain")
	}
	if _, ok := reasonFor(s, ReasonWork); !ok {
		t.Error("no work reason for a listing describing code review")
	}
}

// A tag is a publisher's deliberate claim; a mention in a paragraph is not.
func TestATagOutranksAMentionInProse(t *testing.T) {
	profile := workspaceprofile.Profile{Stack: []string{"python"}}
	ranked := Rank(profile, []Candidate{
		{ID: "prose", Name: "Helper", Description: "Works well with python projects."},
		{ID: "tagged", Name: "Helper", Tags: []string{"python"}},
	}, 0)
	if got := idsOf(ranked); got[0] != "tagged" {
		t.Fatalf("ranking = %v, want the tagged listing first", got)
	}
}

// The failure this guards is the one that makes a ranking indefensible: "go"
// matching "google", "ts" matching "tests".
func TestShortTermsDoNotMatchInsideLongerWords(t *testing.T) {
	profile := workspaceprofile.Profile{Stack: []string{"go", "ts"}}
	ranked := Rank(profile, []Candidate{
		{ID: "false-positive", Name: "Google Sheets", Description: "Runs tests against a sheet."},
	}, 0)
	for _, s := range ranked {
		if s.Matched {
			t.Fatalf("%q matched on a substring: %+v", s.Candidate.ID, s.Reasons)
		}
	}
}

func TestAliasesMatchAPublishersSpelling(t *testing.T) {
	profile := workspaceprofile.Profile{Stack: []string{"golang", "postgres"}}
	ranked := Rank(profile, []Candidate{
		{ID: "go-listing", Name: "Review helper", Tags: []string{"go"}},
		{ID: "pg-listing", Name: "Query helper", Tags: []string{"postgresql"}},
	}, 0)
	if s := find(t, ranked, "go-listing"); !s.Matched {
		t.Error("golang did not match a listing tagged go")
	}
	if s := find(t, ranked, "pg-listing"); !s.Matched {
		t.Error("postgres did not match a listing tagged postgresql")
	}
}

// Chinese has no word boundaries, so the boundary check that protects "go"
// must not silently make every non-Latin term unmatchable.
func TestCJKTermsMatchAsSubstrings(t *testing.T) {
	profile := workspaceprofile.Profile{Domain: "物流"}
	ranked := Rank(profile, []Candidate{
		{ID: "zh", Name: "物流异常处理", Description: "处理运输过程中的异常。"},
	}, 0)
	if s := find(t, ranked, "zh"); !s.Matched {
		t.Fatalf("a Chinese domain term did not match Chinese listing text: %+v", s.Reasons)
	}
}

// A workspace that has not said what it is still deserves to see what the
// deployment ships — honestly labelled as not being about them.
func TestAnEmptyProfileFallsBackToOfficialAndFeatured(t *testing.T) {
	ranked := Rank(workspaceprofile.Profile{}, []Candidate{
		{ID: "official", Name: "SDLC Delivery", Official: true, Featured: true},
		{ID: "nothing", Name: "Someone's experiment"},
	}, 0)

	if len(ranked) != 1 || ranked[0].Candidate.ID != "official" {
		t.Fatalf("ranking = %v, want only the official listing", idsOf(ranked))
	}
	if ranked[0].Matched {
		t.Error("a fallback result must not claim to match the profile")
	}
}

// Popularity is the one signal that would make the ranking self-reinforcing.
func TestPopularityIsCapped(t *testing.T) {
	huge := popularityScore(10_000_000)
	if huge > maxPopularScore {
		t.Fatalf("popularity score %d exceeds the cap %d", huge, maxPopularScore)
	}
	if popularityScore(0) != 0 {
		t.Error("an uninstalled listing should score no popularity")
	}
	if popularityScore(10) >= popularityScore(100000) {
		t.Error("popularity should still be monotonic below the cap")
	}
}

// Two listings with identical evidence must not swap places between two reads
// of the same page.
func TestOrderIsTotalAndStable(t *testing.T) {
	profile := workspaceprofile.Profile{Stack: []string{"go"}}
	candidates := []Candidate{
		{ID: "b", Name: "B", Tags: []string{"go"}},
		{ID: "a", Name: "A", Tags: []string{"go"}},
		{ID: "c", Name: "C", Tags: []string{"go"}},
	}
	first := idsOf(Rank(profile, candidates, 0))
	for i := 0; i < 5; i++ {
		got := idsOf(Rank(profile, candidates, 0))
		for j := range first {
			if got[j] != first[j] {
				t.Fatalf("ranking is unstable: %v then %v", first, got)
			}
		}
	}
	if first[0] != "a" {
		t.Fatalf("tie broken by %v, want id order", first)
	}
}

// The directory changes; that is the requirement the whole package exists for.
// Adding a listing must change the answer with no other input changing.
func TestANewListingChangesTheAnswer(t *testing.T) {
	profile := workspaceprofile.Profile{Stack: []string{"rust"}}
	before := Rank(profile, []Candidate{{ID: "old", Name: "Helper", Tags: []string{"go"}}}, 0)
	if len(before) != 0 {
		t.Fatalf("nothing should match a rust workspace yet, got %v", idsOf(before))
	}
	after := Rank(profile, []Candidate{
		{ID: "old", Name: "Helper", Tags: []string{"go"}},
		{ID: "new", Name: "Rust review", Tags: []string{"rust"}},
	}, 0)
	if len(after) != 1 || after[0].Candidate.ID != "new" {
		t.Fatalf("a newly published matching listing did not surface: %v", idsOf(after))
	}
}

// The gloss is how a vocabulary value reaches listing text. If glosses stopped
// producing terms, every work-based recommendation would silently vanish.
func TestWorkTermsComeFromTheVocabularyGloss(t *testing.T) {
	terms := workTermsFor([]string{"knowledge_modeling"})
	if len(terms) == 0 {
		t.Fatal("knowledge_modeling produced no terms")
	}
	found := false
	for _, term := range terms {
		if term == "ontologies" || term == "ontology" {
			found = true
		}
	}
	if !found {
		t.Fatalf("knowledge_modeling terms %v do not include the ontology vocabulary", terms)
	}
	if len(workTermsFor([]string{"not_a_value"})) != 0 {
		t.Error("an unknown vocabulary value should contribute no terms")
	}
}

func TestLimitTruncatesFromTheTop(t *testing.T) {
	profile := workspaceprofile.Profile{Stack: []string{"go"}}
	ranked := Rank(profile, []Candidate{
		{ID: "weak", Name: "Something", Description: "Mentions go once."},
		{ID: "strong", Name: "Go helper", Tags: []string{"go"}},
	}, 1)
	if len(ranked) != 1 || ranked[0].Candidate.ID != "strong" {
		t.Fatalf("limit kept %v, want the strongest", idsOf(ranked))
	}
}
