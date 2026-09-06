package daemon

import (
	"testing"
)

// Knowledge bases ride in the same wire field as code repos so they land in
// the checkout allowlist, which is what lets an agent check one out to write a
// document back. The brief must still keep them apart: a knowledge base listed
// under Repositories invites the agent to fetch what it can already read, and
// the checkout it would make is a second copy on a branch nobody merges.
func TestConvertReposForEnvExcludesKnowledge(t *testing.T) {
	repos := []RepoData{
		{URL: "https://github.com/acme/app.git", Description: "The product"},
		{URL: "https://github.com/acme/kb.git", Description: "Handbook", Kind: RepoKindKnowledge},
		{URL: "https://github.com/acme/infra.git", Kind: RepoKindCode},
	}
	got := convertReposForEnv(repos)
	if len(got) != 2 {
		t.Fatalf("repos in brief = %d, want 2: %+v", len(got), got)
	}
	for _, r := range got {
		if r.URL == "https://github.com/acme/kb.git" {
			t.Fatalf("knowledge base leaked into the Repositories section: %+v", r)
		}
	}
}

// A workspace whose only repo is a knowledge base has no Repositories section
// at all, rather than an empty heading.
func TestConvertReposForEnvNilWhenOnlyKnowledge(t *testing.T) {
	got := convertReposForEnv([]RepoData{
		{URL: "https://github.com/acme/kb.git", Kind: RepoKindKnowledge},
	})
	if got != nil {
		t.Fatalf("want nil, got %+v", got)
	}
}

// The allowlist is the other half: `enact repo checkout` on a knowledge base
// has to be accepted, or an agent could read the index and then fail to write
// anything back.
func TestRepoAllowlistIncludesKnowledge(t *testing.T) {
	allowed := repoAllowlist([]RepoData{
		{URL: "https://github.com/acme/app.git"},
		{URL: "https://github.com/acme/kb.git", Kind: RepoKindKnowledge},
	})
	if _, ok := allowed["https://github.com/acme/kb.git"]; !ok {
		t.Fatal("knowledge base is not checkout-allowed; write-back would be refused")
	}
}

// Every source is reported, even when nothing could be prepared. Dropping them
// would leave the brief silent about knowledge the agent was told it has.
func TestUnavailableKnowledgePreservesEverySource(t *testing.T) {
	got := unavailableKnowledge([]KnowledgeSourceData{
		{ID: "a", URL: "https://github.com/acme/one.git", Label: "One"},
		{ID: "b", URL: "https://github.com/acme/two.git"},
	}, "disk full")
	if len(got) != 2 {
		t.Fatalf("sources = %d, want 2", len(got))
	}
	for _, entry := range got {
		if entry.Unavailable != "disk full" {
			t.Fatalf("entry %+v lost its reason", entry)
		}
		if entry.LocalPath != "" {
			t.Fatalf("an unavailable base must not claim a local path: %+v", entry)
		}
	}
}

// The checkout path is per resource. Two knowledge bases sharing a workspace
// must not share a checkout directory, or the second would overwrite the first
// and both would index the wrong documents.
func TestKnowledgeCheckoutKeyIsPerResource(t *testing.T) {
	a := knowledgeCheckoutKey(KnowledgeSourceData{ID: "res-a", URL: "https://github.com/acme/kb.git"})
	b := knowledgeCheckoutKey(KnowledgeSourceData{ID: "res-b", URL: "https://github.com/acme/kb.git"})
	if a == b {
		t.Fatal("two resources produced the same checkout key")
	}
	// An id-less source still has to be distinguishable.
	c := knowledgeCheckoutKey(KnowledgeSourceData{URL: "https://github.com/acme/one.git"})
	d := knowledgeCheckoutKey(KnowledgeSourceData{URL: "https://github.com/acme/two.git"})
	if c == d {
		t.Fatal("two id-less sources produced the same checkout key")
	}
}

// The join that turns a resource's in-repo path into a directory on disk is
// the one place a bad value would escape the checkout.
func TestIsInsideRejectsEscape(t *testing.T) {
	cases := []struct {
		parent, child string
		want          bool
	}{
		{"/a/b", "/a/b", true},
		{"/a/b", "/a/b/docs", true},
		{"/a/b", "/a/b/docs/deep", true},
		{"/a/b", "/a", false},
		{"/a/b", "/a/c", false},
		{"/a/b", "/a/bb", false},
	}
	for _, tc := range cases {
		if got := isInside(tc.parent, tc.child); got != tc.want {
			t.Fatalf("isInside(%q, %q) = %v, want %v", tc.parent, tc.child, got, tc.want)
		}
	}
}
