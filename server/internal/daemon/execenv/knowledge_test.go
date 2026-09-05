package execenv

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeDoc(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
}

// The index is what every bound run pays for and reads, so what lands in it is
// the whole contract: a title and a description per document, and nothing else
// from the file.
func TestScanKnowledgeDocsBuildsIndex(t *testing.T) {
	root := t.TempDir()
	writeDoc(t, root, "deploy-window.md",
		"---\ntitle: Deploy window\ndescription: When releases may ship.\n---\n\nShip before 16:00 on weekdays.\n")
	writeDoc(t, root, "domain/pricing.md",
		"---\ntitle: Pricing model\ndescription: How the tiers are priced.\n---\n\nBody.\n")
	// No front-matter: the heading is the fallback title.
	writeDoc(t, root, "heading-only.md", "# Escalation policy\n\nCall the on-call.\n")
	// Neither: the filename is the last resort, so the document is still
	// findable rather than invisible.
	writeDoc(t, root, "bare_notes.md", "just prose\n")
	// Not markdown, and not knowledge.
	writeDoc(t, root, "data.json", `{"a":1}`)
	// The checkout's own machinery must never reach the index.
	writeDoc(t, root, ".git/HEAD.md", "# not knowledge\n")

	docs, dirs, total := ScanKnowledgeDocs(root)
	if total != 4 {
		t.Fatalf("total = %d, want 4 (json and .git excluded); got %+v", total, docs)
	}

	byPath := map[string]KnowledgeDocForEnv{}
	for _, d := range docs {
		byPath[d.RelPath] = d
	}
	if got := byPath["deploy-window.md"]; got.Title != "Deploy window" || got.Description != "When releases may ship." {
		t.Fatalf("front-matter doc = %+v", got)
	}
	if got := byPath["domain/pricing.md"]; got.Title != "Pricing model" {
		t.Fatalf("nested doc = %+v", got)
	}
	if got := byPath["heading-only.md"]; got.Title != "Escalation policy" {
		t.Fatalf("heading fallback = %+v", got)
	}
	if got := byPath["bare_notes.md"]; got.Title != "bare notes" {
		t.Fatalf("filename fallback = %+v", got)
	}

	// Documents are ordered so two runs over an unchanged base render the same
	// brief; map iteration order would make the prompt prefix unstable.
	for i := 1; i < len(docs); i++ {
		if docs[i-1].RelPath > docs[i].RelPath {
			t.Fatalf("index is not sorted: %q before %q", docs[i-1].RelPath, docs[i].RelPath)
		}
	}

	var domain KnowledgeDirForEnv
	for _, d := range dirs {
		if d.Path == "domain" {
			domain = d
		}
	}
	if domain.Count != 1 {
		t.Fatalf("dirs = %+v, want domain with 1 document", dirs)
	}
}

// Past the cap the section stops listing documents. Without this the index
// grows without bound and becomes the context cost it exists to avoid.
func TestKnowledgeIndexLimitSwitchesToDirectories(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < maxIndexedKnowledgeDocs+5; i++ {
		writeDoc(t, root, fmt.Sprintf("area/doc-%03d.md", i),
			fmt.Sprintf("---\ntitle: Doc %d\ndescription: d\n---\n\nbody\n", i))
	}
	docs, dirs, total := ScanKnowledgeDocs(root)
	entry := KnowledgeContextForEnv{Docs: docs, Dirs: dirs, TotalDocs: total}
	ApplyKnowledgeIndexLimit(&entry)

	if !entry.Truncated {
		t.Fatal("a base past the cap must be truncated")
	}
	if len(entry.Docs) != 0 {
		t.Fatalf("truncated index still lists %d documents", len(entry.Docs))
	}
	if len(entry.Dirs) == 0 {
		t.Fatal("a truncated index must still say where the documents are")
	}
	if entry.TotalDocs != maxIndexedKnowledgeDocs+5 {
		t.Fatalf("TotalDocs = %d, want %d", entry.TotalDocs, maxIndexedKnowledgeDocs+5)
	}
}

// Under the cap the directory summary is dropped: it would repeat what the
// document list already says.
func TestKnowledgeIndexUnderLimitKeepsDocuments(t *testing.T) {
	root := t.TempDir()
	writeDoc(t, root, "one.md", "---\ntitle: One\n---\nbody\n")
	docs, dirs, total := ScanKnowledgeDocs(root)
	entry := KnowledgeContextForEnv{Docs: docs, Dirs: dirs, TotalDocs: total}
	ApplyKnowledgeIndexLimit(&entry)
	if entry.Truncated || len(entry.Docs) != 1 || len(entry.Dirs) != 0 {
		t.Fatalf("small base rendered wrong: %+v", entry)
	}
}

// A runaway description would claim the space the rest of the index needs.
func TestKnowledgeDescriptionTruncated(t *testing.T) {
	root := t.TempDir()
	writeDoc(t, root, "long.md",
		"---\ntitle: Long\ndescription: "+strings.Repeat("word ", 200)+"\n---\nbody\n")
	docs, _, _ := ScanKnowledgeDocs(root)
	if len(docs) != 1 {
		t.Fatalf("docs = %d, want 1", len(docs))
	}
	if len(docs[0].Description) > maxKnowledgeDescriptionLen+4 {
		t.Fatalf("description not truncated: %d chars", len(docs[0].Description))
	}
}

func TestWriteKnowledgeRendersIndexNotContent(t *testing.T) {
	var b strings.Builder
	writeKnowledge(&b, TaskContextForEnv{KnowledgeSources: []KnowledgeContextForEnv{{
		Label:     "Domain handbook",
		URL:       "https://github.com/acme/kb.git",
		Ref:       "main",
		LocalPath: "/runtime/.knowledge/ws/kb/docs",
		Delivery:  "pull_request",
		TotalDocs: 2,
		Docs: []KnowledgeDocForEnv{
			{RelPath: "deploy-window.md", Title: "Deploy window", Description: "When releases may ship."},
			{RelPath: "pricing.md", Title: "Pricing model"},
		},
	}}})
	out := b.String()

	for _, want := range []string{
		"## Knowledge",
		"Domain handbook",
		"/runtime/.knowledge/ws/kb/docs",
		"**Deploy window** — When releases may ship. (`deploy-window.md`)",
		"**Pricing model** (`pricing.md`)",
		// The instruction that makes this progressive rather than exhaustive.
		"do not read a base end to end",
		// Writing goes through a checkout of the agent's own, never the shared
		// indexed location.
		"enact repo checkout https://github.com/acme/kb.git",
		"opening a pull request",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("brief missing %q:\n%s", want, out)
		}
	}
}

// Delivery decides what the agent is told to do with a finished document, so
// the two modes must not render the same instruction.
func TestWriteKnowledgeCommitDelivery(t *testing.T) {
	var b strings.Builder
	writeKnowledge(&b, TaskContextForEnv{KnowledgeSources: []KnowledgeContextForEnv{{
		URL: "https://github.com/acme/kb.git", LocalPath: "/kb", Delivery: "commit", TotalDocs: 0,
	}}})
	out := b.String()
	if !strings.Contains(out, "committing and pushing") {
		t.Fatalf("commit delivery not rendered:\n%s", out)
	}
	if strings.Contains(out, "opening a pull request") {
		t.Fatalf("commit delivery must not ask for a pull request:\n%s", out)
	}
}

// An unreachable base must be named as unreachable. An agent handed a silently
// empty index reports that the workspace knows nothing, which is worse than
// reporting that it could not look.
func TestWriteKnowledgeReportsUnavailable(t *testing.T) {
	var b strings.Builder
	writeKnowledge(&b, TaskContextForEnv{KnowledgeSources: []KnowledgeContextForEnv{{
		Label: "Handbook", URL: "https://github.com/acme/kb.git",
		Unavailable: "the runtime could not fetch it (auth failed)",
	}}})
	out := b.String()
	if !strings.Contains(out, "Not available for this run") ||
		!strings.Contains(out, "auth failed") ||
		!strings.Contains(out, "do not conclude the knowledge base is empty") {
		t.Fatalf("unavailable base rendered wrong:\n%s", out)
	}
}

// No bindings, no section. The feature costs a workspace that never used it
// nothing at all.
func TestWriteKnowledgeSilentWithoutSources(t *testing.T) {
	var b strings.Builder
	writeKnowledge(&b, TaskContextForEnv{})
	if b.String() != "" {
		t.Fatalf("unbound agent got a Knowledge section: %q", b.String())
	}
}
