// Package recommend ranks Marketplace listings against a workspace's project
// profile.
//
// The whole design follows from one requirement: the directory changes. A
// listing published tomorrow has to be able to reach a workspace that was set
// up today, and a workspace that changes what it says about itself has to see
// a different ranking on its next page load. So nothing here is precomputed
// and nothing is stored — the score is a pure function of (profile, listings
// as they are right now), evaluated per request.
//
// It is also deliberately free of any model call. A ranking that depends on an
// LLM would make the Marketplace page's latency and availability depend on a
// provider, would cost tokens per browse, and — worst — would be unexplainable
// when it got something wrong. Every score here decomposes into reasons the
// response carries, so a member can see that "go" in their stack matched a
// listing's tag, and disagree with it.
//
// What an agent adds on top is judgement, not ranking: which of these to
// install, and what to change after installing. That lives in a skill, reading
// this package's output through `enact marketplace recommend`.
package recommend

import (
	"math"
	"sort"
	"strings"
	"unicode"

	"github.com/enact-ai/enact/server/internal/workspaceprofile"
)

// ReasonKind names why a listing surfaced. The client renders these; they are
// a closed set so it can, rather than free text.
type ReasonKind string

const (
	// ReasonStack — something in the workspace's stack appears in the listing.
	ReasonStack ReasonKind = "stack"
	// ReasonWork — the listing matches a kind of work the workspace does.
	ReasonWork ReasonKind = "work"
	// ReasonDomain — the listing mentions the workspace's problem space.
	ReasonDomain ReasonKind = "domain"
	// ReasonOfficial — published by the deployment's own catalog workspace.
	ReasonOfficial ReasonKind = "official"
	// ReasonFeatured — the deployment marked it featured.
	ReasonFeatured ReasonKind = "featured"
	// ReasonPopular — installed by many workspaces here.
	ReasonPopular ReasonKind = "popular"
)

// Reason is one contribution to a score, with the evidence for it.
type Reason struct {
	Kind ReasonKind `json:"kind"`
	// Term is the profile value that matched, lowercased ("go", "ship_code").
	// Empty for the reasons that are not about the profile.
	Term string `json:"term,omitempty"`
	// Where the term was found: "tag", "category", "name", "description".
	// Empty for the reasons that are not about the profile.
	Field string `json:"field,omitempty"`
	Score int    `json:"score"`
}

// Candidate is one listing as the ranker sees it. The caller assembles it from
// the listing row plus whatever text the version carries, so this package
// never reads the database and can be tested with literals.
type Candidate struct {
	ID          string
	Kind        string
	Name        string
	Description string
	Category    string
	Tags        []string
	Featured    bool
	// InstallCount is how many times this listing has been installed across
	// the deployment.
	InstallCount int64
	// Official marks a listing published by the deployment's own catalog
	// workspace, which is a stronger signal than featured: featured is an
	// editorial flag anyone with the column could set, official means the
	// product itself ships it.
	Official bool
	// ExtraText is anything else worth matching against — a skill's SKILL.md
	// frontmatter description, an agent template's instructions. Kept separate
	// from Description so the caller decides how much to include, and weighted
	// below Name and Tags because it is long and matches easily.
	ExtraText string
}

// Scored is a candidate with its verdict.
type Scored struct {
	Candidate Candidate
	Score     int
	Reasons   []Reason
	// Matched is whether ANY reason came from the workspace's own profile.
	// A listing that scored only on being official or popular is a fallback,
	// not a match, and the two must not be presented as the same thing.
	Matched bool
}

// Weights. They are constants rather than tuning knobs because the ranking has
// to be explicable: a member reading "matched your stack: go" should be able
// to predict that a tag match outranks a mention in a paragraph.
const (
	weightTag         = 10
	weightCategory    = 6
	weightName        = 5
	weightDescription = 3
	weightExtraText   = 1
	// A work term is one word of a multi-word gloss, so it fires more often
	// than a stack term and is weighted accordingly.
	weightWorkTerm = 2
	// The cap keeps a listing that repeats one gloss's vocabulary from
	// outscoring one that actually matches the stack.
	maxWorkScore = 8

	weightOfficial = 3
	weightFeatured = 4
	// Popularity is bounded hard: it is the one signal that would otherwise
	// make the ranking self-reinforcing, recommending what is already
	// installed everywhere regardless of fit.
	maxPopularScore = 3
)

// stackAliases expands a profile's stack token to the spellings a publisher
// might have used. It is small and hand-maintained on purpose: a general
// stemmer would match "gopher" for "go", and the failure mode of a missing
// alias (one fewer reason) is much cheaper than the failure mode of a wrong
// one (a recommendation nobody can explain).
var stackAliases = map[string][]string{
	"go":           {"golang"},
	"golang":       {"go"},
	"typescript":   {"ts"},
	"ts":           {"typescript"},
	"javascript":   {"js", "node", "nodejs"},
	"js":           {"javascript"},
	"node":         {"nodejs", "node.js", "javascript"},
	"nodejs":       {"node", "node.js"},
	"python":       {"py"},
	"py":           {"python"},
	"postgres":     {"postgresql", "pg"},
	"postgresql":   {"postgres", "pg"},
	"kubernetes":   {"k8s"},
	"k8s":          {"kubernetes"},
	"nextjs":       {"next.js", "next"},
	"next.js":      {"nextjs", "next"},
	"react-native": {"react native", "rn"},
	"objective-c":  {"objc"},
	"c#":           {"csharp", "dotnet", ".net"},
	"csharp":       {"c#", "dotnet", ".net"},
	"dotnet":       {".net", "c#", "csharp"},
}

// Rank scores every candidate against the profile and returns them ordered
// best first, capped at limit.
//
// An empty profile returns the fallback ranking — official, featured, popular
// — rather than nothing. A workspace that has not said what it is still
// deserves to see what the deployment ships, and every one of those results is
// honestly labelled as not being about them.
func Rank(profile workspaceprofile.Profile, candidates []Candidate, limit int) []Scored {
	stackTerms := expandStack(profile.Stack)
	domainTerms := splitWords(strings.ToLower(profile.Domain))
	workTerms := workTermsFor(profile.TypicalWork)

	scored := make([]Scored, 0, len(candidates))
	for _, candidate := range candidates {
		result := score(candidate, stackTerms, domainTerms, workTerms)
		if result.Score > 0 {
			scored = append(scored, result)
		}
	}

	// Matched first, then score, then install count, then id. The last key is
	// what makes the order total: two listings with identical evidence must
	// not swap places between two reads of the same page.
	sort.SliceStable(scored, func(i, j int) bool {
		a, b := scored[i], scored[j]
		if a.Matched != b.Matched {
			return a.Matched
		}
		if a.Score != b.Score {
			return a.Score > b.Score
		}
		if a.Candidate.InstallCount != b.Candidate.InstallCount {
			return a.Candidate.InstallCount > b.Candidate.InstallCount
		}
		return a.Candidate.ID < b.Candidate.ID
	})

	if limit > 0 && len(scored) > limit {
		scored = scored[:limit]
	}
	return scored
}

// score evaluates one candidate. Reasons accumulate in a stable order —
// stack, domain, work, then the non-profile signals — so the response reads
// the same way every time.
func score(candidate Candidate, stackTerms map[string][]string, domainTerms, workTerms []string) Scored {
	fields := candidateFieldsOf(candidate)
	result := Scored{Candidate: candidate}

	for _, term := range sortedKeys(stackTerms) {
		if reason, ok := bestFieldMatch(fields, term, stackTerms[term], ReasonStack); ok {
			result.Reasons = append(result.Reasons, reason)
			result.Score += reason.Score
			result.Matched = true
		}
	}

	for _, term := range domainTerms {
		if reason, ok := bestFieldMatch(fields, term, nil, ReasonDomain); ok {
			result.Reasons = append(result.Reasons, reason)
			result.Score += reason.Score
			result.Matched = true
		}
	}

	workScore := 0
	workHits := map[string]bool{}
	for _, term := range workTerms {
		if workScore >= maxWorkScore {
			break
		}
		if _, ok := bestFieldMatch(fields, term, nil, ReasonWork); ok {
			if workHits[term] {
				continue
			}
			workHits[term] = true
			workScore += weightWorkTerm
		}
	}
	if workScore > 0 {
		if workScore > maxWorkScore {
			workScore = maxWorkScore
		}
		result.Reasons = append(result.Reasons, Reason{
			Kind:  ReasonWork,
			Term:  strings.Join(sortedSet(workHits), ", "),
			Score: workScore,
		})
		result.Score += workScore
		result.Matched = true
	}

	if candidate.Official {
		result.Reasons = append(result.Reasons, Reason{Kind: ReasonOfficial, Score: weightOfficial})
		result.Score += weightOfficial
	}
	if candidate.Featured {
		result.Reasons = append(result.Reasons, Reason{Kind: ReasonFeatured, Score: weightFeatured})
		result.Score += weightFeatured
	}
	if popular := popularityScore(candidate.InstallCount); popular > 0 {
		result.Reasons = append(result.Reasons, Reason{Kind: ReasonPopular, Score: popular})
		result.Score += popular
	}
	return result
}

// candidateFields is the searchable text of a listing, split by where it came
// from so a match can say where it landed.
type candidateFields struct {
	tags        map[string]bool
	category    string
	name        string
	description string
	extra       string
}

func candidateFieldsOf(c Candidate) candidateFields {
	tags := make(map[string]bool, len(c.Tags))
	for _, tag := range c.Tags {
		tags[strings.ToLower(strings.TrimSpace(tag))] = true
	}
	return candidateFields{
		tags:        tags,
		category:    strings.ToLower(strings.TrimSpace(c.Category)),
		name:        strings.ToLower(c.Name),
		description: strings.ToLower(c.Description),
		extra:       strings.ToLower(c.ExtraText),
	}
}

// bestFieldMatch finds the highest-weighted field the term or one of its
// aliases appears in, and reports the reason for it. Only the best field
// counts: a term in the name and again in the description is one match, not
// two, or a listing that repeats its own title in its description would
// outrank one that does not.
func bestFieldMatch(f candidateFields, term string, aliases []string, kind ReasonKind) (Reason, bool) {
	if term == "" {
		return Reason{}, false
	}
	forms := append([]string{term}, aliases...)
	for _, form := range forms {
		if f.tags[form] {
			return Reason{Kind: kind, Term: term, Field: "tag", Score: weightTag}, true
		}
	}
	for _, form := range forms {
		if f.category == form {
			return Reason{Kind: kind, Term: term, Field: "category", Score: weightCategory}, true
		}
	}
	for _, form := range forms {
		if containsTerm(f.name, form) {
			return Reason{Kind: kind, Term: term, Field: "name", Score: weightName}, true
		}
	}
	for _, form := range forms {
		if containsTerm(f.description, form) {
			return Reason{Kind: kind, Term: term, Field: "description", Score: weightDescription}, true
		}
	}
	for _, form := range forms {
		if containsTerm(f.extra, form) {
			return Reason{Kind: kind, Term: term, Field: "content", Score: weightExtraText}, true
		}
	}
	return Reason{}, false
}

// containsTerm reports whether haystack contains needle as a term.
//
// For a needle that is entirely non-Latin — Chinese, Japanese, Korean — that
// means a plain substring, because those scripts do not delimit words and a
// boundary check would never fire. For anything else the match is bounded on
// both sides by a non-word character, so "go" does not match "google" and
// "ts" does not match "tests". That distinction is the whole reason this is a
// function rather than a strings.Contains call.
func containsTerm(haystack, needle string) bool {
	if haystack == "" || needle == "" {
		return false
	}
	if !hasLatinOrDigit(needle) {
		return strings.Contains(haystack, needle)
	}
	from := 0
	for {
		idx := strings.Index(haystack[from:], needle)
		if idx < 0 {
			return false
		}
		start := from + idx
		end := start + len(needle)
		if isBoundary(haystack, start, -1) && isBoundary(haystack, end, 0) {
			return true
		}
		from = start + 1
		if from >= len(haystack) {
			return false
		}
	}
}

// isBoundary reports whether the position just outside a match is a
// non-word character. offset -1 looks at the byte before start; offset 0 at
// the byte at end. A match at the very edge of the string is bounded.
func isBoundary(s string, pos, offset int) bool {
	idx := pos + offset
	if idx < 0 || idx >= len(s) {
		return true
	}
	r := rune(s[idx])
	// Byte-wise is safe here: every multi-byte UTF-8 continuation byte has the
	// high bit set, which is neither a letter nor a digit in this check, so a
	// CJK character adjacent to a Latin term reads as a boundary — which is
	// what it is.
	if r >= 0x80 {
		return true
	}
	return !unicode.IsLetter(r) && !unicode.IsDigit(r)
}

func hasLatinOrDigit(s string) bool {
	for _, r := range s {
		if r < 0x80 && (unicode.IsLetter(r) || unicode.IsDigit(r)) {
			return true
		}
	}
	return false
}

// expandStack maps each stack entry to its aliases, dropping entries too short
// to match anything meaningfully. One- and two-character tokens other than
// known aliases are excluded: "c" would match every mention of the letter in a
// tag list, and the resulting reason would be indefensible.
func expandStack(stack []string) map[string][]string {
	out := make(map[string][]string, len(stack))
	for _, entry := range stack {
		term := strings.ToLower(strings.TrimSpace(entry))
		if term == "" {
			continue
		}
		aliases := stackAliases[term]
		if len([]rune(term)) < 2 && len(aliases) == 0 {
			continue
		}
		out[term] = aliases
	}
	return out
}

// workTermsFor turns the closed typical_work vocabulary into the words a
// listing might use. Deriving the words from the vocabulary's own gloss keeps
// one definition: adding a value in workspaceprofile teaches the recommender
// what it means without an edit here.
func workTermsFor(values []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, value := range values {
		gloss, ok := workspaceprofile.TypicalWorkVocabulary[value]
		if !ok {
			continue
		}
		for _, word := range splitWords(gloss) {
			if seen[word] {
				continue
			}
			seen[word] = true
			out = append(out, word)
		}
	}
	return out
}

// glossStopWords are the words a gloss uses to be a sentence rather than to
// mean anything. Matching on them would make every listing match every kind of
// work.
var glossStopWords = map[string]bool{
	"and": true, "the": true, "a": true, "an": true, "for": true, "of": true,
	"to": true, "on": true, "in": true, "with": true, "or": true, "that": true,
	"work": true, "build": true, "make": true, "use": true, "run": true,
}

// splitWords lowercases and splits on anything that is not a letter or digit,
// dropping stop words and anything shorter than three characters. CJK runs are
// kept whole: they carry meaning at a length Latin words do not.
func splitWords(s string) []string {
	fields := strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	var out []string
	for _, field := range fields {
		if glossStopWords[field] {
			continue
		}
		if hasLatinOrDigit(field) && len(field) < 3 {
			continue
		}
		out = append(out, field)
	}
	return out
}

// popularityScore compresses the install count logarithmically and caps it.
// Linear popularity would let one widely-installed listing dominate every
// ranking in the deployment, which is the opposite of recommending for a
// project.
func popularityScore(installs int64) int {
	if installs <= 0 {
		return 0
	}
	score := int(math.Round(math.Log10(float64(installs)+1) * 2))
	if score > maxPopularScore {
		return maxPopularScore
	}
	return score
}

func sortedKeys(m map[string][]string) []string {
	out := make([]string, 0, len(m))
	for key := range m {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

func sortedSet(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for key := range m {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}
