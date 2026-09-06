package repocache

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// A knowledge base is the first repository an agent is expected to WRITE to as
// a matter of course: the retrospect agent's whole output is a document
// committed back. Every other checkout this cache makes is read-mostly, so
// "can an agent push from a checkout this cache produced" had never been
// asserted anywhere.
//
// It is not obvious that it works. The checkout is derived from a bare mirror
// in the daemon's cache, not cloned from the remote, so its `origin` is
// whatever createIsolatedCheckout/setIsolatedCheckoutOrigin left behind rather
// than whatever `git clone` would have set. If that pointed at the local cache
// — the natural thing for a cache to do — a push would "succeed" into a
// directory nobody ever reads and the document would be silently lost.
//
// This test uses a local bare repository as the remote, so it verifies the
// wiring (does origin point at the real remote, does a push from the checkout
// land there) without needing credentials or a network. Credential resolution
// is the daemon's `gh` helper and is out of scope here.
func TestIsolatedCheckoutPushesBackToOrigin(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	root := t.TempDir()

	// The "remote": a bare repository with one commit on its default branch.
	remote := filepath.Join(root, "knowledge-remote.git")
	seed := filepath.Join(root, "seed")
	mustGit(t, root, "init", "--bare", "--initial-branch=main", remote)
	mustGit(t, root, "init", "--initial-branch=main", seed)
	mustGit(t, seed, "config", "user.email", "kb@example.com")
	mustGit(t, seed, "config", "user.name", "KB Test")
	writeFile(t, filepath.Join(seed, "README.md"), "# knowledge base\n")
	mustGit(t, seed, "add", ".")
	mustGit(t, seed, "commit", "-m", "seed")
	mustGit(t, seed, "remote", "add", "origin", remote)
	mustGit(t, seed, "push", "origin", "main")

	// The daemon's cache mirrors the remote, exactly as it does for any repo.
	cache := New(filepath.Join(root, "cache"), testLogger())
	if err := cache.Sync("ws-knowledge", []RepoInfo{{URL: remote}}); err != nil {
		t.Fatalf("cache sync: %v", err)
	}

	// The checkout an agent would get from `enact repo checkout`.
	res, err := cache.CreateWorktree(WorktreeParams{
		WorkspaceID:         "ws-knowledge",
		RepoURL:             remote,
		WorkDir:             filepath.Join(root, "task"),
		AgentName:           "retrospect",
		TaskID:              "task-1",
		IsolatedGitMetadata: true,
	})
	if err != nil {
		t.Fatalf("create worktree: %v", err)
	}

	// origin must be the remote, not the cache. This is the assertion the
	// whole write-back path rests on.
	origin := strings.TrimSpace(gitOut(t, res.Path, "remote", "get-url", "origin"))
	if !sameResolvedPath(origin, remote) {
		t.Fatalf("origin = %q, want the remote %q; a push would not reach the knowledge base", origin, remote)
	}

	// Write a knowledge document the way a retrospect would, and deliver it.
	mustGit(t, res.Path, "config", "user.email", "agent@example.com")
	mustGit(t, res.Path, "config", "user.name", "Retrospect Agent")
	docDir := filepath.Join(res.Path, "docs", "knowledge")
	if err := os.MkdirAll(docDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	writeFile(t, filepath.Join(docDir, "deploy-window.md"),
		"---\ntitle: Deploy window\ndescription: When releases may ship.\n---\n\nShip before 16:00.\n")
	mustGit(t, res.Path, "add", ".")
	mustGit(t, res.Path, "commit", "-m", "docs: deploy window")
	mustGit(t, res.Path, "push", "origin", "HEAD:refs/heads/knowledge-test")

	// The document is readable from the remote, which is the only proof that
	// the write actually left the machine's task directory.
	got := gitOut(t, remote, "show", "knowledge-test:docs/knowledge/deploy-window.md")
	if !strings.Contains(got, "title: Deploy window") {
		t.Fatalf("document not found on the remote after push; got %q", got)
	}
}

func mustGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	if out, err := gitCmd(dir, args...).CombinedOutput(); err != nil {
		t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, out)
	}
}

func gitOut(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := gitCmd(dir, args...).CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, out)
	}
	return string(out)
}

func gitCmd(dir string, args ...string) *exec.Cmd {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(gitEnv(),
		"GIT_AUTHOR_NAME=KB Test", "GIT_AUTHOR_EMAIL=kb@example.com",
		"GIT_COMMITTER_NAME=KB Test", "GIT_COMMITTER_EMAIL=kb@example.com",
	)
	return cmd
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
