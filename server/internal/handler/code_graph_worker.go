package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/enact-ai/enact/server/internal/codegraph"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	// codeGraphPollInterval is the recovery sweep. Builds are announced
	// through Notify, so this only has to catch rows queued by another
	// replica or left behind by a crash.
	codeGraphPollInterval = 30 * time.Second
	// codeGraphLease bounds how long a claimed build may run before another
	// worker may take it. It is longer than the client's build timeout so a
	// slow build is never claimed twice while it is still running.
	codeGraphLease = 20 * time.Minute
	// codeGraphMaxAttempts caps retries of one build row.
	codeGraphMaxAttempts = 3
	// codeGraphKeepBuilds is how many finished builds a resource keeps.
	codeGraphKeepBuilds = 5
	// codeGraphPushDebounce delays a build queued by a push, so a burst of
	// commits becomes one build rather than one per commit.
	codeGraphPushDebounce = 5 * time.Minute
	// codeGraphRefreshInterval is the fallback sweep for repositories whose
	// pushes never reach us (no webhook, or a delivery we missed).
	codeGraphRefreshInterval = 6 * time.Hour
)

// CodeGraphBuildWorker owns the durable code graph build queue. Like the
// webhook delivery worker, the queue and the lease live in Postgres, so a
// restart or a failover reclaims expired rows and the in-memory notification
// is only a latency hint.
//
// Concurrency is one: the container builds one repository at a time
// (CODEGRAPH_CONCURRENCY=1) and answers a second build with 409, so a second
// worker here would only burn attempts.
type CodeGraphBuildWorker struct {
	h      *Handler
	notify chan struct{}
	done   chan struct{}
	// refreshInterval is the head-commit sweep period; tests shorten it.
	refreshInterval time.Duration
}

func NewCodeGraphBuildWorker(h *Handler) *CodeGraphBuildWorker {
	return &CodeGraphBuildWorker{
		h:               h,
		notify:          make(chan struct{}, 1),
		done:            make(chan struct{}),
		refreshInterval: codeGraphRefreshInterval,
	}
}

// Notify wakes the worker after a local enqueue.
func (w *CodeGraphBuildWorker) Notify() {
	if w == nil {
		return
	}
	select {
	case w.notify <- struct{}{}:
	default:
	}
}

// Run drives the queue until ctx is cancelled. It is inert when no container
// is configured: the rows would be claimed and immediately fail, burning
// attempts on a deployment that simply does not have the feature.
func (w *CodeGraphBuildWorker) Run(ctx context.Context) {
	if w == nil {
		return
	}
	defer close(w.done)
	if w.h == nil || w.h.Queries == nil || !w.h.CodeGraph.Enabled() {
		return
	}
	go w.runRefreshLoop(ctx)

	ticker := time.NewTicker(codeGraphPollInterval)
	defer ticker.Stop()
	for {
		worked, err := w.ProcessNext(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			slog.Error("code graph worker: process build", "error", err)
		}
		if worked {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-w.notify:
		case <-ticker.C:
		}
	}
}

func (w *CodeGraphBuildWorker) WaitWithTimeout(timeout time.Duration) bool {
	if w == nil {
		return true
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-w.done:
		return true
	case <-timer.C:
		return false
	}
}

// ProcessNext claims and runs at most one build. It is exported to the
// package so tests drive the queue synchronously instead of racing a
// goroutine. The bool reports whether a row was claimed.
func (w *CodeGraphBuildWorker) ProcessNext(ctx context.Context) (bool, error) {
	build, err := w.h.Queries.ClaimQueuedCodeGraphBuild(ctx, pgInterval(codeGraphLease))
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim queued build: %w", err)
	}

	// The resource may have been deleted or opted out while the row waited.
	resource, err := w.h.Queries.GetWorkspaceResourceInWorkspace(ctx, db.GetWorkspaceResourceInWorkspaceParams{
		ID: build.ResourceID, WorkspaceID: build.WorkspaceID,
	})
	if err != nil || !codeGraphEnabled(resource) {
		return true, w.complete(ctx, build, codegraph.StateSkipped, codegraph.BuildResult{SkippedReason: "disabled"})
	}

	repoURL, ref := codeGraphRepoURLAndRef(resource)
	if repoURL == "" {
		return true, w.complete(ctx, build, codegraph.StateFailed, codegraph.BuildResult{Error: "the resource has no repository URL"})
	}

	token, err := w.h.codeGraphCloneToken(ctx, resource, repoURL)
	if err != nil {
		slog.Warn("code graph: no clone credential; trying an unauthenticated clone",
			"resource_id", uuidToString(resource.ID), "error", err)
	}

	result, err := w.h.CodeGraph.Build(ctx, build.ProjectKey, codegraph.BuildRequest{
		CloneURL: repoURL,
		Ref:      ref,
		Token:    token,
	})
	if err != nil {
		// Busy and unavailable are transient by construction: the container
		// is running someone else's build, or is restarting. Anything else
		// is reported as a failure the user can read.
		if errors.Is(err, codegraph.ErrBusy) || errors.Is(err, codegraph.ErrUnavailable) || errors.Is(err, codegraph.ErrDisabled) {
			return true, w.retryOrFail(ctx, build, err)
		}
		return true, w.complete(ctx, build, codegraph.StateFailed, codegraph.BuildResult{Error: err.Error()})
	}

	state := result.State
	switch state {
	case codegraph.StateReady, codegraph.StateSkipped, codegraph.StateFailed:
	default:
		state = codegraph.StateFailed
		result.Error = "the code graph service returned an unknown state " + result.State
	}
	if err := w.complete(ctx, build, state, result); err != nil {
		return true, err
	}
	if err := w.h.Queries.PruneCodeGraphBuilds(ctx, db.PruneCodeGraphBuildsParams{
		WorkspaceID: build.WorkspaceID, ResourceID: build.ResourceID, Offset: codeGraphKeepBuilds,
	}); err != nil {
		slog.Warn("code graph: pruning old builds failed", "resource_id", uuidToString(build.ResourceID), "error", err)
	}
	return true, nil
}

// complete records the container's verdict. A row no longer in `building`
// means a later claimant owns the outcome; that is not an error here.
func (w *CodeGraphBuildWorker) complete(ctx context.Context, build db.CodeGraphBuild, state string, result codegraph.BuildResult) error {
	params := db.CompleteCodeGraphBuildParams{ID: build.ID, State: state}
	if result.Commit != "" {
		params.Commit = pgtype.Text{String: result.Commit, Valid: true}
	}
	if result.SkippedReason != "" {
		params.SkippedReason = pgtype.Text{String: result.SkippedReason, Valid: true}
	}
	if result.Error != "" {
		params.Error = pgtype.Text{String: result.Error, Valid: true}
	}
	if len(result.Stats) > 0 {
		params.Stats = result.Stats
	}
	if len(result.Diff) > 0 {
		params.Diff = result.Diff
	}
	if result.ReportMD != "" {
		params.ReportMd = pgtype.Text{String: result.ReportMD, Valid: true}
	}
	if v := result.GraphifyVersion(); v != "" {
		params.GraphifyVersion = pgtype.Text{String: v, Valid: true}
	}
	// A successful build defines the head this resource is at, so a status
	// read right after it is not reported as stale against an older push.
	if state == codegraph.StateReady && result.Commit != "" {
		defer func() {
			_ = w.h.Queries.SetCodeGraphHeadCommit(ctx, db.SetCodeGraphHeadCommitParams{
				WorkspaceID: build.WorkspaceID, ResourceID: build.ResourceID,
				HeadCommit: pgtype.Text{String: result.Commit, Valid: true},
			})
		}()
	}
	_, err := w.h.Queries.CompleteCodeGraphBuild(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		slog.Debug("code graph worker: lease ownership changed", "build_id", uuidToString(build.ID))
		return nil
	}
	return err
}

// retryOrFail defers a transient failure, or records it once the attempt cap
// is reached so the row stops occupying the queue.
func (w *CodeGraphBuildWorker) retryOrFail(ctx context.Context, build db.CodeGraphBuild, cause error) error {
	if build.Attempts >= codeGraphMaxAttempts {
		return w.complete(ctx, build, codegraph.StateFailed, codegraph.BuildResult{Error: cause.Error()})
	}
	backoff := time.Minute * time.Duration(1<<min(int(build.Attempts), 4))
	_, err := w.h.Queries.RetryCodeGraphBuild(ctx, db.RetryCodeGraphBuildParams{
		ID:         build.ID,
		LeaseUntil: pgtype.Timestamptz{Time: time.Now().Add(backoff), Valid: true},
		Error:      pgtype.Text{String: cause.Error(), Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("retry build after %v: %w", cause, err)
	}
	slog.Warn("code graph worker: build deferred",
		"build_id", uuidToString(build.ID), "attempt", build.Attempts, "backoff", backoff, "error", cause)
	return nil
}

// runRefreshLoop is the fallback for repositories whose pushes never reach
// us. It asks the provider for the default branch head and enqueues when it
// moved; the enqueue guard makes a repeat harmless.
func (w *CodeGraphBuildWorker) runRefreshLoop(ctx context.Context) {
	ticker := time.NewTicker(w.refreshInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := w.RefreshHeads(ctx); err != nil && !errors.Is(err, context.Canceled) {
				slog.Warn("code graph worker: head refresh failed", "error", err)
			}
		}
	}
}

// RefreshHeads compares every enabled repository's recorded head with the
// provider's current default-branch head and enqueues the ones that moved.
func (w *CodeGraphBuildWorker) RefreshHeads(ctx context.Context) error {
	resources, err := w.h.Queries.ListCodeGraphEnabledResources(ctx)
	if err != nil {
		return err
	}
	for _, resource := range resources {
		head, err := w.h.codeGraphRemoteHead(ctx, resource)
		if err != nil || head == "" {
			continue
		}
		latest, err := w.h.Queries.GetLatestReadyCodeGraphBuild(ctx, db.GetLatestReadyCodeGraphBuildParams{
			WorkspaceID: resource.WorkspaceID, ResourceID: resource.ID,
		})
		if err == nil && latest.Commit.Valid && latest.Commit.String == head {
			continue
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		w.h.enqueueCodeGraphBuild(ctx, resource, head, time.Time{})
	}
	return nil
}

func pgInterval(d time.Duration) pgtype.Interval {
	return pgtype.Interval{Microseconds: d.Microseconds(), Valid: true}
}

// ── Credentials ──────────────────────────────────────────────────────────────

// codeGraphCloneToken mints a short-lived credential for the clone. A GitHub
// repository uses the workspace's App installation token (one hour, scoped to
// the installation); other providers use the stored VCS token. A public
// repository needs neither, so a missing credential is not an error here —
// the clone is simply attempted without one.
func (h *Handler) codeGraphCloneToken(ctx context.Context, resource db.WorkspaceResource, repoURL string) (string, error) {
	normalized := codegraph.NormalizeRepoURL(repoURL)
	host, _, _, ok := codegraph.SplitOwnerRepo(normalized)
	if !ok {
		return "", errors.New("code graph: repository URL is not owner/repo shaped")
	}
	if host == "github.com" {
		return h.codeGraphGitHubToken(ctx, resource.WorkspaceID)
	}
	return h.codeGraphVCSToken(ctx, resource.WorkspaceID, host)
}

func (h *Handler) codeGraphGitHubToken(ctx context.Context, workspaceID pgtype.UUID) (string, error) {
	installations, err := h.Queries.ListGitHubInstallationsByWorkspace(ctx, workspaceID)
	if err != nil {
		return "", err
	}
	if len(installations) == 0 {
		return "", errors.New("code graph: workspace has no GitHub installation")
	}
	appJWT, err := signGitHubAppJWT(time.Now())
	if err != nil {
		return "", err
	}
	if appJWT == "" {
		return "", errors.New("code graph: GitHub App credentials unavailable")
	}
	// Several installations can be bound to one workspace; the first that
	// mints wins. A token that cannot clone the repository fails inside the
	// container, which reports it as a build error the member can read.
	var lastErr error
	for _, installation := range installations {
		token, err := mintGitHubInstallationTokenForCodeGraph(ctx, appJWT, installation.InstallationID)
		if err == nil {
			return token, nil
		}
		lastErr = err
	}
	return "", lastErr
}

func mintGitHubInstallationTokenForCodeGraph(ctx context.Context, appJWT string, installationID int64) (string, error) {
	endpoint := fmt.Sprintf("%s/app/installations/%d/access_tokens",
		strings.TrimRight(githubAPIBase, "/"), installationID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint,
		strings.NewReader(`{"permissions":{"contents":"read","metadata":"read"}}`))
	if err != nil {
		return "", err
	}
	setGitHubAPIHeaders(req, appJWT)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		// Never echo the body: a token-mint failure can carry sensitive hints.
		return "", fmt.Errorf("code graph: installation token status %d", resp.StatusCode)
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", err
	}
	if body.Token == "" {
		return "", errors.New("code graph: empty installation token")
	}
	return body.Token, nil
}

// codeGraphVCSToken returns the workspace's stored token for a self-hosted
// provider instance whose host matches the repository's.
func (h *Handler) codeGraphVCSToken(ctx context.Context, workspaceID pgtype.UUID, host string) (string, error) {
	if h.VCSSecretBox == nil {
		return "", errors.New("code graph: vcs integration not configured")
	}
	connections, err := h.Queries.ListVCSConnectionsByWorkspace(ctx, workspaceID)
	if err != nil {
		return "", err
	}
	for _, connection := range connections {
		instance := codegraph.NormalizeRepoURL(connection.InstanceUrl)
		instanceHost := instance
		if idx := strings.Index(instance, "/"); idx > 0 {
			instanceHost = instance[:idx]
		}
		if instanceHost != host {
			continue
		}
		return h.openVCSSecret(connection.AccessTokenEncrypted)
	}
	return "", errors.New("code graph: no provider connection for " + host)
}

// codeGraphRemoteHead reads the current default-branch head of a repository,
// used by the fallback sweep. Only GitHub is supported; other providers rely
// on their webhook and on manual rebuilds.
func (h *Handler) codeGraphRemoteHead(ctx context.Context, resource db.WorkspaceResource) (string, error) {
	repoURL, ref := codeGraphRepoURLAndRef(resource)
	normalized := codegraph.NormalizeRepoURL(repoURL)
	host, owner, repo, ok := codegraph.SplitOwnerRepo(normalized)
	if !ok || host != "github.com" {
		return "", nil
	}
	token, err := h.codeGraphGitHubToken(ctx, resource.WorkspaceID)
	if err != nil {
		return "", err
	}
	branch := ref
	if branch == "" {
		branch, err = githubDefaultBranch(ctx, token, owner, repo)
		if err != nil {
			return "", err
		}
	}
	endpoint := fmt.Sprintf("%s/repos/%s/%s/commits/%s",
		strings.TrimRight(githubAPIBase, "/"), owner, repo, branch)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	setGitHubAPIHeaders(req, token)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("code graph: head lookup status %d", resp.StatusCode)
	}
	var body struct {
		SHA string `json:"sha"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", err
	}
	return body.SHA, nil
}

func githubDefaultBranch(ctx context.Context, token, owner, repo string) (string, error) {
	endpoint := fmt.Sprintf("%s/repos/%s/%s", strings.TrimRight(githubAPIBase, "/"), owner, repo)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	setGitHubAPIHeaders(req, token)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("code graph: repository lookup status %d", resp.StatusCode)
	}
	var body struct {
		DefaultBranch string `json:"default_branch"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", err
	}
	return body.DefaultBranch, nil
}

// ── Push trigger ─────────────────────────────────────────────────────────────

// ghPushPayload is the slice of GitHub's push event the code graph needs.
type ghPushPayload struct {
	Ref        string `json:"ref"`
	After      string `json:"after"`
	Deleted    bool   `json:"deleted"`
	Repository struct {
		Name          string `json:"name"`
		DefaultBranch string `json:"default_branch"`
		Owner         struct {
			Login string `json:"login"`
			Name  string `json:"name"`
		} `json:"owner"`
	} `json:"repository"`
	Installation struct {
		ID int64 `json:"id"`
	} `json:"installation"`
}

// handlePushEvent queues a code graph build when an enabled repository's
// default branch moves. Everything else about a push is ignored — Enact has
// no other use for the event.
//
// The build is delayed by codeGraphPushDebounce so a burst of commits
// produces one build rather than one per commit; the enqueue guard collapses
// the burst onto the single pending row.
func (h *Handler) handlePushEvent(ctx context.Context, body []byte) {
	var p ghPushPayload
	if err := json.Unmarshal(body, &p); err != nil {
		slog.Warn("github: bad push payload", "err", err)
		return
	}
	if p.Installation.ID == 0 || p.Deleted {
		return
	}
	branch := strings.TrimPrefix(p.Ref, "refs/heads/")
	if branch == p.Ref || branch == "" {
		// A tag or another ref; the graph tracks branches only.
		return
	}
	owner := p.Repository.Owner.Login
	if owner == "" {
		owner = p.Repository.Owner.Name
	}
	if owner == "" || p.Repository.Name == "" {
		return
	}
	pushed := "github.com/" + owner + "/" + p.Repository.Name

	installations, err := h.Queries.ListGitHubInstallationsByInstallationID(ctx, p.Installation.ID)
	if err != nil || len(installations) == 0 {
		return
	}
	for _, installation := range installations {
		resources, err := h.Queries.ListCodeGraphEnabledResourcesByWorkspace(ctx, installation.WorkspaceID)
		if err != nil {
			continue
		}
		for _, resource := range resources {
			repoURL, ref := codeGraphRepoURLAndRef(resource)
			if !strings.EqualFold(codegraph.NormalizeRepoURL(repoURL), pushed) {
				continue
			}
			// A resource pinned to a ref follows that ref; one without a pin
			// follows the repository's default branch.
			wanted := ref
			if wanted == "" {
				wanted = p.Repository.DefaultBranch
			}
			if wanted != "" && wanted != branch {
				continue
			}
			h.enqueueCodeGraphBuild(ctx, resource, p.After, time.Now().Add(codeGraphPushDebounce))
		}
	}
}
