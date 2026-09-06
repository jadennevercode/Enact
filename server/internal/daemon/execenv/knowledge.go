package execenv

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// Knowledge bases reach an agent as an INDEX, not as content.
//
// The distinction is the whole design. A workspace repo is listed in the brief
// as a URL because a task that needs the code has an obvious reason to fetch
// it. A knowledge base has no such trigger: the agent cannot know whether a
// document about the deploy window is relevant without opening it, so a URL
// alone means the knowledge is read approximately never. Pasting every
// document into the brief is the other failure — it spends the context budget
// of every run on documents that run does not need.
//
// So the daemon checks the repository out and renders one line per document:
// title, one-sentence description, relative path. The agent reads the index in
// every run and opens the one or two documents that matter with its ordinary
// file tools. That is the same progressive-disclosure shape a provider's own
// skills use (descriptions resident, bodies on demand), expressed as files so
// it works identically on Claude, Codex and OpenClaw.

// maxIndexedKnowledgeDocs bounds what reaches the brief.
//
// Past this the index stops being a table of contents and becomes the cost it
// was meant to avoid: at ~20 tokens a line, 60 documents is a little over a
// thousand tokens paid by every run of every bound agent. Beyond it the brief
// carries directory counts instead, which keeps the section a fixed size and
// still tells the agent where to look — and is the point at which a workspace
// wants retrieval rather than a listing.
const maxIndexedKnowledgeDocs = 60

// maxKnowledgeDescriptionLen truncates an over-long description so one
// undisciplined document cannot claim the whole section.
const maxKnowledgeDescriptionLen = 200

// KnowledgeDocForEnv is one document as the index sees it.
type KnowledgeDocForEnv struct {
	// RelPath is relative to the knowledge base's own root (the resource's
	// `path` subdirectory), which is what the agent needs to open it.
	RelPath     string `json:"rel_path"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
}

// KnowledgeDirForEnv is one directory and how many documents are under it.
// Only used when the base is too large to list document by document.
type KnowledgeDirForEnv struct {
	Path  string `json:"path"`
	Count int    `json:"count"`
}

// KnowledgeContextForEnv is one knowledge base, checked out and indexed.
type KnowledgeContextForEnv struct {
	ID    string `json:"id"`
	Label string `json:"label,omitempty"`
	URL   string `json:"url"`
	Ref   string `json:"ref,omitempty"`
	// Path is the subdirectory inside the repository the documents live in.
	Path string `json:"path,omitempty"`
	// LocalPath is the absolute directory the agent reads. Empty when the
	// checkout failed, in which case the brief degrades to naming the URL.
	LocalPath string `json:"local_path,omitempty"`
	// Delivery is how a write reaches the default branch: pull_request or
	// commit. Rendered into the brief because an agent that writes a document
	// must know whether to open a PR or push.
	Delivery string               `json:"delivery,omitempty"`
	Docs     []KnowledgeDocForEnv `json:"docs,omitempty"`
	Dirs     []KnowledgeDirForEnv `json:"dirs,omitempty"`
	// TotalDocs is every document found, which can exceed len(Docs).
	TotalDocs int `json:"total_docs"`
	// Truncated says the index lists directories instead of documents.
	Truncated bool `json:"truncated,omitempty"`
	// Unavailable carries why the checkout did not happen. An agent told the
	// base is unreachable can say so; an agent shown an empty index would
	// report, wrongly, that the workspace knows nothing about the subject.
	Unavailable string `json:"unavailable,omitempty"`
}

// ScanKnowledgeDocs walks a checked-out knowledge base and builds its index.
//
// total is every document found, which may exceed len(docs): past
// maxIndexedKnowledgeDocs the caller renders dirs instead. Returning both
// rather than deciding here keeps this function a pure description of what is
// on disk.
func ScanKnowledgeDocs(root string) (docs []KnowledgeDocForEnv, dirs []KnowledgeDirForEnv, total int) {
	if strings.TrimSpace(root) == "" {
		return nil, nil, 0
	}
	perDir := map[string]int{}
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// An unreadable subtree is not a reason to lose the rest of the
			// index; the documents we can see are still worth listing.
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			// .git is the checkout's own machinery, and a dot-directory is
			// tooling config in every convention we care about. Neither is
			// knowledge, and .git in particular would flood the index.
			if path != root && strings.HasPrefix(d.Name(), ".") {
				return fs.SkipDir
			}
			return nil
		}
		if !isMarkdownFile(d.Name()) {
			return nil
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		title, description := readKnowledgeFrontmatter(path)
		if title == "" {
			title = titleFromFilename(rel)
		}
		docs = append(docs, KnowledgeDocForEnv{
			RelPath:     rel,
			Title:       title,
			Description: description,
		})
		dir := filepath.ToSlash(filepath.Dir(rel))
		if dir == "." {
			dir = ""
		}
		perDir[dir]++
		return nil
	})

	sort.Slice(docs, func(i, j int) bool { return docs[i].RelPath < docs[j].RelPath })
	total = len(docs)

	dirs = make([]KnowledgeDirForEnv, 0, len(perDir))
	for path, count := range perDir {
		dirs = append(dirs, KnowledgeDirForEnv{Path: path, Count: count})
	}
	sort.Slice(dirs, func(i, j int) bool { return dirs[i].Path < dirs[j].Path })
	return docs, dirs, total
}

// ApplyKnowledgeIndexLimit trims a scanned base to what the brief will carry.
// Past the limit the documents are dropped in favour of the directory summary,
// so the section's size stops growing with the knowledge base.
func ApplyKnowledgeIndexLimit(src *KnowledgeContextForEnv) {
	if src == nil {
		return
	}
	if src.TotalDocs <= maxIndexedKnowledgeDocs {
		src.Dirs = nil
		src.Truncated = false
		return
	}
	src.Docs = nil
	src.Truncated = true
}

func isMarkdownFile(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasSuffix(lower, ".md") || strings.HasSuffix(lower, ".markdown")
}

// readKnowledgeFrontmatter pulls `title` and `description` out of a document.
//
// Only the head of the file is read: an index needs two short strings, and a
// knowledge base can hold documents far larger than anything worth loading to
// find them.
func readKnowledgeFrontmatter(path string) (title, description string) {
	f, err := os.Open(path)
	if err != nil {
		return "", ""
	}
	defer f.Close()
	head := make([]byte, 8192)
	n, _ := f.Read(head)
	if n <= 0 {
		return "", ""
	}
	content := string(head[:n])

	fmBody, body, ok := frontmatterParts(content)
	if ok {
		var meta struct {
			Title       string `yaml:"title"`
			Description string `yaml:"description"`
		}
		if yaml.Unmarshal([]byte(fmBody), &meta) == nil {
			title = strings.TrimSpace(meta.Title)
			description = truncateDescription(strings.TrimSpace(meta.Description))
		}
	} else {
		body = content
	}
	if title == "" {
		title = firstMarkdownHeading(body)
	}
	return title, description
}

// firstMarkdownHeading is the fallback title for a document with no
// front-matter. A knowledge base is meant to carry it, but a document written
// by hand and committed straight in should still be findable rather than
// listed under its filename.
func firstMarkdownHeading(body string) string {
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "# ") {
			return strings.TrimSpace(strings.TrimPrefix(trimmed, "# "))
		}
	}
	return ""
}

func titleFromFilename(rel string) string {
	base := filepath.Base(rel)
	base = strings.TrimSuffix(base, filepath.Ext(base))
	base = strings.ReplaceAll(base, "-", " ")
	base = strings.ReplaceAll(base, "_", " ")
	return strings.TrimSpace(base)
}

func truncateDescription(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) <= maxKnowledgeDescriptionLen {
		return s
	}
	return strings.TrimSpace(s[:maxKnowledgeDescriptionLen]) + "…"
}
