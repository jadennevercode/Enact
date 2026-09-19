package vcs

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// githubProvider implements Provider for a token-authenticated GitHub: either
// GitHub.com or a GitHub Enterprise Server instance. It exists alongside the
// GitHub App integration in server/internal/handler/github.go rather than
// replacing it, because the two answer different questions. An App is the
// better credential where it can be installed — short-lived, single-repository
// tokens and webhooks registered for you — but creating one is a deployment
// task, and it cannot reach an Enterprise Server behind a company network. A
// token connection is configuration a workspace admin can complete alone,
// which is the whole point of this provider.
//
// The App path keeps its own handler because installation tokens, the
// check_suite CI model and the install redirect have no analogue here. What
// this adapter contributes is the part that is genuinely the same as every
// other token provider: validate a credential, list repositories, verify a
// webhook, and normalize the payloads.
type githubProvider struct{}

func init() { register(githubProvider{}) }

func (githubProvider) Kind() Kind { return KindGitHub }

// GitHubAPIBase maps an instance URL onto its REST root. GitHub.com serves its
// API from a separate hostname while Enterprise Server mounts it under /api/v3
// on the instance itself, so every caller must go through this rather than
// concatenating a path onto the instance URL.
func GitHubAPIBase(instanceURL string) string {
	normalized := NormalizeInstanceURL(instanceURL)
	if normalized == "" {
		return "https://api.github.com"
	}
	parsed, err := url.Parse(normalized)
	if err != nil || parsed.Host == "" {
		return "https://api.github.com"
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "github.com" || host == "www.github.com" || host == "api.github.com" {
		return "https://api.github.com"
	}
	return normalized + "/api/v3"
}

// IsGitHubDotCom reports whether the instance URL addresses the public GitHub
// rather than an Enterprise Server. Repository-host validation needs the
// distinction: github.com is fixed, an Enterprise host is whatever the
// operator runs.
func IsGitHubDotCom(instanceURL string) bool {
	parsed, err := url.Parse(NormalizeInstanceURL(instanceURL))
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "github.com" || host == "www.github.com" || host == "api.github.com"
}

func setGitHubHeaders(req *http.Request, token string) {
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
}

// GitHubTokenMetadata is what a token says about itself. Scopes are present
// only for classic personal access tokens, which announce them in a response
// header; a fine-grained token carries per-repository permissions that are not
// enumerable this way and comes back with an empty list. Callers must treat
// empty as "unknown", never as "none" — see ProbeGitHubTokenCapabilities.
type GitHubTokenMetadata struct {
	Login  string
	Scopes []string
	// FineGrained reports that GitHub answered without a scope header, which
	// is how a fine-grained or GitHub App token presents.
	FineGrained bool
}

// ValidateToken confirms the token authenticates against the instance and
// returns the account it belongs to.
func (githubProvider) ValidateToken(ctx context.Context, instanceURL, token string) (Account, error) {
	metadata, err := InspectGitHubToken(ctx, nil, instanceURL, token)
	if err != nil {
		return Account{}, err
	}
	return Account{Login: metadata.Login}, nil
}

// InspectGitHubToken authenticates the token and reports what GitHub will say
// about it. A 401 is a rejected credential; a 403 is authenticated but barred,
// which for a token usually means SAML SSO authorization is missing.
func InspectGitHubToken(ctx context.Context, client *http.Client, instanceURL, token string) (GitHubTokenMetadata, error) {
	if client == nil {
		client = httpClient
	}
	endpoint := GitHubAPIBase(instanceURL) + "/user"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return GitHubTokenMetadata{}, fmt.Errorf("github: build user request: %w", err)
	}
	setGitHubHeaders(req, token)
	resp, err := client.Do(req)
	if err != nil {
		return GitHubTokenMetadata{}, fmt.Errorf("github: user request: %w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return GitHubTokenMetadata{}, ErrUnauthorized
	case http.StatusForbidden:
		return GitHubTokenMetadata{}, ErrForbidden
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return GitHubTokenMetadata{}, fmt.Errorf("github: GET /user: status %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var account struct {
		Login string `json:"login"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&account); err != nil {
		return GitHubTokenMetadata{}, fmt.Errorf("github: decode user: %w", err)
	}
	raw := strings.TrimSpace(resp.Header.Get("X-OAuth-Scopes"))
	metadata := GitHubTokenMetadata{Login: account.Login, FineGrained: raw == ""}
	for _, scope := range strings.Split(raw, ",") {
		if scope = strings.TrimSpace(scope); scope != "" {
			metadata.Scopes = append(metadata.Scopes, scope)
		}
	}
	return metadata, nil
}

// GitHubRepository is the repository-picker shape, deliberately the same
// fields the GitLab picker returns so one UI serves both.
type GitHubRepository struct {
	ID            int64  `json:"id"`
	FullName      string `json:"full_name"`
	HTMLURL       string `json:"html_url"`
	CloneURL      string `json:"clone_url"`
	Description   string `json:"description"`
	Private       bool   `json:"private"`
	Archived      bool   `json:"archived"`
	DefaultBranch string `json:"default_branch"`
	Permissions   struct {
		Push  bool `json:"push"`
		Admin bool `json:"admin"`
	} `json:"permissions"`
}

type GitHubRepositoriesPage struct {
	Repositories []GitHubRepository
	NextPage     *int
}

// ListGitHubRepositories pages through everything the token can reach. Search
// is applied client-side over the page because GitHub's repository search is a
// different endpoint with its own ranking and rate limit; filtering what the
// user is already looking at keeps one code path and one set of permissions.
func ListGitHubRepositories(ctx context.Context, client *http.Client, instanceURL, token, search string, page, perPage int) (GitHubRepositoriesPage, error) {
	if client == nil {
		client = httpClient
	}
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 50
	}
	q := url.Values{}
	q.Set("affiliation", "owner,collaborator,organization_member")
	q.Set("sort", "full_name")
	q.Set("direction", "asc")
	q.Set("page", strconv.Itoa(page))
	q.Set("per_page", strconv.Itoa(perPage))
	endpoint := GitHubAPIBase(instanceURL) + "/user/repos?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return GitHubRepositoriesPage{}, fmt.Errorf("github: build repositories request: %w", err)
	}
	setGitHubHeaders(req, token)
	resp, err := client.Do(req)
	if err != nil {
		return GitHubRepositoriesPage{}, fmt.Errorf("github: repositories request: %w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return GitHubRepositoriesPage{}, ErrUnauthorized
	case http.StatusForbidden:
		return GitHubRepositoriesPage{}, ErrForbidden
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return GitHubRepositoriesPage{}, fmt.Errorf("github: GET /user/repos: status %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var repositories []GitHubRepository
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&repositories); err != nil {
		return GitHubRepositoriesPage{}, fmt.Errorf("github: decode repositories: %w", err)
	}
	out := GitHubRepositoriesPage{Repositories: repositories}
	// A full page implies there may be another. GitHub also sends a Link
	// header, but it is absent on some proxies and on the last page, and the
	// page-size test is right in both cases.
	if len(repositories) == perPage {
		next := page + 1
		out.NextPage = &next
	}
	if term := strings.ToLower(strings.TrimSpace(search)); term != "" {
		filtered := out.Repositories[:0]
		for _, repository := range out.Repositories {
			if strings.Contains(strings.ToLower(repository.FullName), term) {
				filtered = append(filtered, repository)
			}
		}
		out.Repositories = filtered
	}
	return out, nil
}

// ProbeGitHubRepositoryAccess answers the question a fine-grained token's
// scope list cannot: whether this credential can actually read the repository
// and whether it may push. Reading the repository record is the cheapest call
// that returns both, and it reports per-repository permission regardless of
// which token flavour asked.
func ProbeGitHubRepositoryAccess(ctx context.Context, client *http.Client, instanceURL, token, fullName string) (canRead, canPush bool, err error) {
	if client == nil {
		client = httpClient
	}
	endpoint := GitHubAPIBase(instanceURL) + "/repos/" + strings.Trim(fullName, "/")
	req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if reqErr != nil {
		return false, false, fmt.Errorf("github: build repository request: %w", reqErr)
	}
	setGitHubHeaders(req, token)
	resp, doErr := client.Do(req)
	if doErr != nil {
		return false, false, fmt.Errorf("github: repository request: %w", doErr)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return false, false, ErrUnauthorized
	case http.StatusForbidden, http.StatusNotFound:
		// GitHub returns 404 rather than 403 for a repository the credential
		// cannot see, so the two are one answer: no read access.
		return false, false, ErrForbidden
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return false, false, fmt.Errorf("github: GET /repos/%s: status %d: %s", fullName, resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var repository GitHubRepository
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&repository); err != nil {
		return false, false, fmt.Errorf("github: decode repository: %w", err)
	}
	return true, repository.Permissions.Push, nil
}

// EventKind classifies an inbound GitHub delivery. check_suite is deliberately
// absent: a suite carries no conclusion until its runs finish, so recording it
// would write a pending status that the matching check_run event immediately
// supersedes.
func (githubProvider) EventKind(h http.Header) EventKind {
	switch h.Get("X-GitHub-Event") {
	case "pull_request":
		return EventPullRequest
	case "check_run", "status":
		return EventCIStatus
	default:
		return EventOther
	}
}

// VerifySignature checks the X-Hub-Signature-256 HMAC over the raw body. An
// empty stored secret never validates, so a connection whose webhook was never
// configured cannot be driven by an unsigned request.
func (githubProvider) VerifySignature(secret string, h http.Header, body []byte) bool {
	if secret == "" {
		return false
	}
	got := strings.TrimSpace(h.Get("X-Hub-Signature-256"))
	if !strings.HasPrefix(got, "sha256=") {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	want := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(strings.TrimPrefix(got, "sha256=")), []byte(want))
}

type ghWebhookPullRequest struct {
	Action     string `json:"action"`
	Repository struct {
		FullName string `json:"full_name"`
	} `json:"repository"`
	PullRequest struct {
		Number int32  `json:"number"`
		Title  string `json:"title"`
		Body   string `json:"body"`
		State  string `json:"state"`
		Draft  bool   `json:"draft"`
		Merged bool   `json:"merged"`
		// MergedAt carries the merge even when `merged` is absent, which is
		// how a closed-then-merged redelivery presents.
		MergedAt string `json:"merged_at"`
		ClosedAt string `json:"closed_at"`
		HTMLURL  string `json:"html_url"`
		Head     struct {
			Ref string `json:"ref"`
			SHA string `json:"sha"`
		} `json:"head"`
		User struct {
			Login     string `json:"login"`
			AvatarURL string `json:"avatar_url"`
		} `json:"user"`
		Additions    int32  `json:"additions"`
		Deletions    int32  `json:"deletions"`
		ChangedFiles int32  `json:"changed_files"`
		CreatedAt    string `json:"created_at"`
		UpdatedAt    string `json:"updated_at"`
	} `json:"pull_request"`
}

func (githubProvider) ParsePullRequest(body []byte) (PullRequestEvent, error) {
	var d ghWebhookPullRequest
	if err := json.Unmarshal(body, &d); err != nil {
		return PullRequestEvent{}, err
	}
	owner, name := splitNamespace(d.Repository.FullName)
	pr := d.PullRequest
	merged := pr.Merged || strings.TrimSpace(pr.MergedAt) != ""
	return PullRequestEvent{
		Action:          d.Action,
		RepoOwner:       owner,
		RepoName:        name,
		Number:          pr.Number,
		Title:           pr.Title,
		Body:            pr.Body,
		State:           derivePRState(pr.State, pr.Draft, merged),
		HTMLURL:         pr.HTMLURL,
		Branch:          pr.Head.Ref,
		HeadSHA:         pr.Head.SHA,
		AuthorLogin:     pr.User.Login,
		AuthorAvatarURL: pr.User.AvatarURL,
		Additions:       pr.Additions,
		Deletions:       pr.Deletions,
		ChangedFiles:    pr.ChangedFiles,
		MergedAt:        normalizeGitHubTime(pr.MergedAt),
		ClosedAt:        normalizeGitHubTime(pr.ClosedAt),
		CreatedAt:       normalizeGitHubTime(pr.CreatedAt),
		UpdatedAt:       normalizeGitHubTime(pr.UpdatedAt),
	}, nil
}

type ghWebhookCIStatus struct {
	// Commit status shape.
	SHA         string `json:"sha"`
	State       string `json:"state"`
	Context     string `json:"context"`
	TargetURL   string `json:"target_url"`
	Description string `json:"description"`
	UpdatedAt   string `json:"updated_at"`
	Repository  struct {
		FullName string `json:"full_name"`
	} `json:"repository"`
	// Check-run shape.
	CheckRun struct {
		Name        string `json:"name"`
		HeadSHA     string `json:"head_sha"`
		Status      string `json:"status"`
		Conclusion  string `json:"conclusion"`
		HTMLURL     string `json:"html_url"`
		CompletedAt string `json:"completed_at"`
		StartedAt   string `json:"started_at"`
	} `json:"check_run"`
}

func (githubProvider) ParseCIStatus(body []byte) (CIStatusEvent, error) {
	var d ghWebhookCIStatus
	if err := json.Unmarshal(body, &d); err != nil {
		return CIStatusEvent{}, err
	}
	owner, name := splitNamespace(d.Repository.FullName)
	// A check_run delivery carries a head_sha; a commit status carries sha.
	// Which one is populated is what tells the two payloads apart.
	if d.CheckRun.HeadSHA != "" {
		updatedAt := d.CheckRun.CompletedAt
		if updatedAt == "" {
			updatedAt = d.CheckRun.StartedAt
		}
		return CIStatusEvent{
			RepoOwner: owner,
			RepoName:  name,
			SHA:       d.CheckRun.HeadSHA,
			Context:   d.CheckRun.Name,
			State:     normalizeGitHubCheckRunState(d.CheckRun.Status, d.CheckRun.Conclusion),
			TargetURL: d.CheckRun.HTMLURL,
			UpdatedAt: normalizeGitHubTime(updatedAt),
		}, nil
	}
	return CIStatusEvent{
		RepoOwner:   owner,
		RepoName:    name,
		SHA:         d.SHA,
		Context:     d.Context,
		State:       normalizeGitHubStatusState(d.State),
		TargetURL:   d.TargetURL,
		Description: d.Description,
		UpdatedAt:   normalizeGitHubTime(d.UpdatedAt),
	}, nil
}

// normalizeGitHubCheckRunState collapses (status, conclusion) into the shared
// passed/failed/pending vocabulary. A run that has not completed has no
// conclusion yet, and the conclusions that are neither success nor failure
// (cancelled, timed_out, action_required) are reported as failures because
// each one leaves the commit unverified.
func normalizeGitHubCheckRunState(status, conclusion string) string {
	if status != "completed" {
		return "pending"
	}
	switch conclusion {
	case "success":
		return "passed"
	case "neutral", "skipped":
		// Neither ran nor failed; treating these as passing matches how
		// GitHub's own merge gate counts them.
		return "passed"
	default:
		return "failed"
	}
}

func normalizeGitHubStatusState(state string) string {
	switch state {
	case "success":
		return "passed"
	case "pending":
		return "pending"
	default: // failure, error
		return "failed"
	}
}

// normalizeGitHubTime passes through GitHub's RFC3339 timestamps and turns
// anything unrecognized into "", which the handler reads as "use ingestion
// time" rather than as a zero date.
func normalizeGitHubTime(s string) string {
	if strings.TrimSpace(s) == "" {
		return ""
	}
	for _, layout := range []string{time.RFC3339, time.RFC3339Nano} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC().Format(time.RFC3339Nano)
		}
	}
	return ""
}
