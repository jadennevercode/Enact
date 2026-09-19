package vcs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// ErrWebhookRegistrationForbidden means the credential authenticated but is not
// allowed to manage this repository's hooks. It is the one registration failure
// that is not a defect: a fine-grained token without the Webhooks permission,
// or a GitLab member below Maintainer, is a perfectly usable credential for
// everything else. Callers fall back to asking the operator to register the
// hook by hand rather than refusing the connection.
var ErrWebhookRegistrationForbidden = errors.New("vcs: not permitted to manage repository webhooks")

// gitHubWebhookEvents is what Enact actually consumes. Subscribing to more
// would spend the provider's delivery budget on payloads the mirror discards.
var gitHubWebhookEvents = []string{"pull_request", "check_run", "status"}

type gitHubHook struct {
	ID     int64 `json:"id"`
	Config struct {
		URL string `json:"url"`
	} `json:"config"`
}

// EnsureGitHubRepositoryWebhook makes the repository deliver to webhookURL,
// creating the hook or updating the existing one that already points there.
// It is idempotent because attaching the same repository twice, or rotating a
// webhook secret, must not leave a repository fanning out duplicate deliveries.
func EnsureGitHubRepositoryWebhook(ctx context.Context, client *http.Client, instanceURL, token, fullName, webhookURL, secret string) error {
	if client == nil {
		client = httpClient
	}
	base := GitHubAPIBase(instanceURL) + "/repos/" + strings.Trim(fullName, "/") + "/hooks"

	existing, err := gitHubExistingHookID(ctx, client, base, token, webhookURL)
	if err != nil {
		return err
	}
	payload := map[string]any{
		"name":   "web",
		"active": true,
		"events": gitHubWebhookEvents,
		"config": map[string]any{
			"url":          webhookURL,
			"content_type": "json",
			"secret":       secret,
			"insecure_ssl": "0",
		},
	}
	method, endpoint := http.MethodPost, base
	if existing != 0 {
		method, endpoint = http.MethodPatch, fmt.Sprintf("%s/%d", base, existing)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("github: encode hook payload: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("github: build hook request: %w", err)
	}
	setGitHubHeaders(req, token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("github: hook request: %w", err)
	}
	defer resp.Body.Close()
	return interpretWebhookWriteStatus("github", resp)
}

func gitHubExistingHookID(ctx context.Context, client *http.Client, base, token, webhookURL string) (int64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"?per_page=100", nil)
	if err != nil {
		return 0, fmt.Errorf("github: build hook list request: %w", err)
	}
	setGitHubHeaders(req, token)
	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("github: hook list request: %w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return 0, ErrUnauthorized
	case http.StatusForbidden, http.StatusNotFound:
		return 0, ErrWebhookRegistrationForbidden
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return 0, fmt.Errorf("github: GET hooks: status %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var hooks []gitHubHook
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&hooks); err != nil {
		return 0, fmt.Errorf("github: decode hooks: %w", err)
	}
	for _, hook := range hooks {
		if strings.EqualFold(hook.Config.URL, webhookURL) {
			return hook.ID, nil
		}
	}
	return 0, nil
}

type gitLabHook struct {
	ID  int64  `json:"id"`
	URL string `json:"url"`
}

// EnsureGitLabProjectWebhook is the GitLab equivalent. GitLab authenticates a
// delivery with a plaintext token header rather than an HMAC, so the secret is
// sent as `token` here and compared on receipt.
func EnsureGitLabProjectWebhook(ctx context.Context, client *http.Client, instanceURL, token, projectID, webhookURL, secret string) error {
	if client == nil {
		client = httpClient
	}
	base := NormalizeInstanceURL(instanceURL) + "/api/v4/projects/" + url.PathEscape(projectID) + "/hooks"

	existing, err := gitLabExistingHookID(ctx, client, base, token, webhookURL)
	if err != nil {
		return err
	}
	payload := map[string]any{
		"url":                     webhookURL,
		"token":                   secret,
		"merge_requests_events":   true,
		"pipeline_events":         true,
		"push_events":             false,
		"enable_ssl_verification": true,
	}
	method, endpoint := http.MethodPost, base
	if existing != 0 {
		method, endpoint = http.MethodPut, fmt.Sprintf("%s/%d", base, existing)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("gitlab: encode hook payload: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("gitlab: build hook request: %w", err)
	}
	req.Header.Set("PRIVATE-TOKEN", token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("gitlab: hook request: %w", err)
	}
	defer resp.Body.Close()
	return interpretWebhookWriteStatus("gitlab", resp)
}

func gitLabExistingHookID(ctx context.Context, client *http.Client, base, token, webhookURL string) (int64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"?per_page=100", nil)
	if err != nil {
		return 0, fmt.Errorf("gitlab: build hook list request: %w", err)
	}
	req.Header.Set("PRIVATE-TOKEN", token)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("gitlab: hook list request: %w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return 0, ErrUnauthorized
	case http.StatusForbidden, http.StatusNotFound:
		return 0, ErrWebhookRegistrationForbidden
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return 0, fmt.Errorf("gitlab: GET hooks: status %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var hooks []gitLabHook
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&hooks); err != nil {
		return 0, fmt.Errorf("gitlab: decode hooks: %w", err)
	}
	for _, hook := range hooks {
		if strings.EqualFold(hook.URL, webhookURL) {
			return hook.ID, nil
		}
	}
	return 0, nil
}

func interpretWebhookWriteStatus(provider string, resp *http.Response) error {
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return ErrUnauthorized
	case http.StatusForbidden, http.StatusNotFound:
		return ErrWebhookRegistrationForbidden
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("%s: write hook: status %d: %s", provider, resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return nil
}
