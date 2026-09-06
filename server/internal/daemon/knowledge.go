package daemon

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/enact-ai/enact/server/internal/daemon/execenv"
	"github.com/enact-ai/enact/server/internal/daemon/repocache"
)

// Materializing a knowledge base for a run.
//
// The checkout lives under the daemon's cache root, NOT in the task's working
// directory, and is shared by every task on this machine that reads the same
// base. Two reasons, and the first is not negotiable: a local_directory
// resource in in_place mode runs the agent inside the user's own directory,
// and Enact writing a knowledge checkout in there would put files the user
// never asked for into their working tree. The second is cost — a knowledge
// base is read-only context, so cloning it per task would pay for the same
// bytes on every run.
//
// A write goes somewhere else entirely: the agent runs `enact repo checkout`,
// which gives it a task-local checkout of its own on a branch. The brief says
// so explicitly, because the shared location is reset under it.

// knowledgeCheckoutRoot is where shared knowledge checkouts live, beside the
// bare caches they come from.
func (d *Daemon) knowledgeCheckoutRoot(workspaceID string) string {
	return filepath.Join(d.cfg.WorkspacesRoot, ".knowledge", workspaceID)
}

// prepareKnowledgeSources checks out and indexes every knowledge base bound to
// the claiming agent.
//
// Failure of any one base is contained: the run continues with that base
// marked unavailable, so a knowledge repository that has been deleted or whose
// credentials have lapsed degrades the brief instead of failing the task. The
// brief says which base is missing and why, because an agent shown an empty
// index would otherwise report that the workspace has written nothing down.
// Git invocations inside the cache carry their own timeouts, which is what
// bounds this; the repo-cache interface exposes only the non-context variants,
// as the `enact repo checkout` path in health.go also uses.
func (d *Daemon) prepareKnowledgeSources(workspaceID string, sources []KnowledgeSourceData) []execenv.KnowledgeContextForEnv {
	if len(sources) == 0 || d.repoCache == nil {
		return nil
	}
	root := d.knowledgeCheckoutRoot(workspaceID)
	if err := os.MkdirAll(root, 0o755); err != nil {
		d.logger.Warn("knowledge: cannot create checkout root; knowledge bases unavailable this run",
			"workspace_id", workspaceID, "error", err)
		return unavailableKnowledge(sources, "the runtime could not create its knowledge directory")
	}

	out := make([]execenv.KnowledgeContextForEnv, 0, len(sources))
	for _, src := range sources {
		out = append(out, d.prepareOneKnowledgeSource(workspaceID, root, src))
	}
	return out
}

func (d *Daemon) prepareOneKnowledgeSource(workspaceID, root string, src KnowledgeSourceData) execenv.KnowledgeContextForEnv {
	entry := execenv.KnowledgeContextForEnv{
		ID:       src.ID,
		Label:    src.Label,
		URL:      src.URL,
		Ref:      src.Ref,
		Path:     src.Path,
		Delivery: src.Delivery,
	}
	url := strings.TrimSpace(src.URL)
	if url == "" {
		entry.Unavailable = "the knowledge base has no repository URL"
		return entry
	}

	// Sync synchronously rather than reusing registerTaskRepos' background
	// sync: the index has to be built before the brief is rendered, and a
	// background clone would leave the first run of a newly attached base
	// reading an empty directory and reporting it as empty.
	if err := d.repoCache.Sync(workspaceID, []repocache.RepoInfo{{URL: url}}); err != nil {
		d.logger.Warn("knowledge: cache sync failed", "url", url, "error", err)
		entry.Unavailable = "the runtime could not fetch it (" + firstLine(err.Error()) + ")"
		return entry
	}

	// A stable id per resource keeps the checkout at one path across tasks, so
	// it is updated in place rather than re-cloned.
	res, err := d.repoCache.CreateWorktree(repocache.WorktreeParams{
		WorkspaceID:         workspaceID,
		RepoURL:             url,
		WorkDir:             root,
		Ref:                 src.Ref,
		AgentName:           "knowledge",
		TaskID:              knowledgeCheckoutKey(src),
		IsolatedGitMetadata: true,
	})
	if err != nil {
		d.logger.Warn("knowledge: checkout failed", "url", url, "error", err)
		entry.Unavailable = "the runtime could not check it out (" + firstLine(err.Error()) + ")"
		return entry
	}

	docRoot := res.Path
	if src.Path != "" {
		// The server has already rejected absolute paths and `..` segments, so
		// this join stays inside the checkout. Re-clean anyway: this is the
		// point where a bad value would escape onto the filesystem.
		docRoot = filepath.Join(res.Path, filepath.FromSlash(src.Path))
		if !isInside(res.Path, docRoot) {
			entry.Unavailable = "its configured path points outside the repository"
			return entry
		}
		if info, statErr := os.Stat(docRoot); statErr != nil || !info.IsDir() {
			entry.Unavailable = fmt.Sprintf("the directory %q does not exist in the repository", src.Path)
			return entry
		}
	}

	docs, dirs, total := execenv.ScanKnowledgeDocs(docRoot)
	entry.LocalPath = docRoot
	entry.Docs = docs
	entry.Dirs = dirs
	entry.TotalDocs = total
	execenv.ApplyKnowledgeIndexLimit(&entry)
	return entry
}

// knowledgeCheckoutKey is the per-resource segment of the checkout branch
// name. The resource id when there is one; otherwise the URL, so two knowledge
// bases in one workspace never share a checkout.
func knowledgeCheckoutKey(src KnowledgeSourceData) string {
	if strings.TrimSpace(src.ID) != "" {
		return src.ID
	}
	return src.URL
}

func unavailableKnowledge(sources []KnowledgeSourceData, reason string) []execenv.KnowledgeContextForEnv {
	out := make([]execenv.KnowledgeContextForEnv, 0, len(sources))
	for _, src := range sources {
		out = append(out, execenv.KnowledgeContextForEnv{
			ID:          src.ID,
			Label:       src.Label,
			URL:         src.URL,
			Ref:         src.Ref,
			Path:        src.Path,
			Delivery:    src.Delivery,
			Unavailable: reason,
		})
	}
	return out
}

// isInside reports whether child is at or under parent, after resolving both.
func isInside(parent, child string) bool {
	rel, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func firstLine(s string) string {
	if idx := strings.IndexByte(s, '\n'); idx >= 0 {
		s = s[:idx]
	}
	return strings.TrimSpace(s)
}
