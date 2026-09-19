package codegraph

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	// EnvServiceURL is the internal base URL of the codegraph container.
	// Empty disables the feature.
	EnvServiceURL = "ENACT_CODEGRAPH_SERVICE_URL"
	// EnvServiceKey is sent as X-Codegraph-Service-Key.
	EnvServiceKey = "ENACT_CODEGRAPH_SERVICE_KEY"

	serviceKeyHeader = "X-Codegraph-Service-Key"

	// buildTimeout bounds one synchronous build call; the container's own
	// timeout is shorter, so this only fires when the container hangs.
	buildTimeout = 15 * time.Minute
	// readTimeout bounds every non-build call.
	readTimeout = 30 * time.Second
	// maxResponseBytes caps what the server will buffer from the container.
	// A monorepo report is a few hundred KB; graph projections are bounded by
	// the container's node limits.
	maxResponseBytes = 64 << 20
	// maxForwardBodyBytes caps a client body proxied to the container.
	maxForwardBodyBytes = 1 << 20
)

// Client talks to one codegraph container.
type Client struct {
	baseURL string
	key     string
	http    *http.Client
}

// NewFromEnv builds a client from the environment; a client whose URL is
// empty is disabled and every call returns ErrDisabled.
func NewFromEnv() *Client {
	return New(os.Getenv(EnvServiceURL), os.Getenv(EnvServiceKey))
}

// New builds a client for baseURL. Redirects are refused: the container is an
// internal service and a redirect would be a misconfiguration, not a hop.
func New(baseURL, key string) *Client {
	return &Client{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		key:     strings.TrimSpace(key),
		http: &http.Client{
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return errors.New("codegraph service redirects are not allowed")
			},
		},
	}
}

// Enabled reports whether a container is configured.
func (c *Client) Enabled() bool { return c != nil && c.baseURL != "" }

// Health calls GET /healthz.
func (c *Client) Health(ctx context.Context) (Health, error) {
	var out Health
	err := c.call(ctx, http.MethodGet, "/healthz", nil, readTimeout, &out)
	return out, err
}

// Build runs a synchronous build for the project.
func (c *Client) Build(ctx context.Context, key string, req BuildRequest) (BuildResult, error) {
	var out BuildResult
	err := c.call(ctx, http.MethodPost, "/v1/projects/"+url.PathEscape(key)+"/build", req, buildTimeout, &out)
	return out, err
}

// Delete removes the project's checkout and graph. Idempotent.
func (c *Client) Delete(ctx context.Context, key string) error {
	return c.call(ctx, http.MethodDelete, "/v1/projects/"+url.PathEscape(key), nil, readTimeout, nil)
}

// Status reads the project's build status from the container.
func (c *Client) Status(ctx context.Context, key string) (ProjectStatus, error) {
	var out ProjectStatus
	err := c.call(ctx, http.MethodGet, "/v1/projects/"+url.PathEscape(key)+"/status", nil, readTimeout, &out)
	return out, err
}

// call performs one JSON request. Container errors are mapped onto the
// sentinel errors; the container's own error message is never surfaced to
// callers, only the class.
func (c *Client) call(ctx context.Context, method, path string, body any, timeout time.Duration, out any) error {
	if !c.Enabled() {
		return ErrDisabled
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("codegraph: encode request: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return fmt.Errorf("codegraph: build request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set(serviceKeyHeader, c.key)
	resp, err := c.http.Do(req)
	if err != nil {
		return ErrUnavailable
	}
	defer resp.Body.Close()
	raw, err := readCapped(resp.Body)
	if err != nil {
		return err
	}
	if err := classify(resp.StatusCode); err != nil {
		return err
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("codegraph: decode response: %w", err)
	}
	return nil
}

func readCapped(r io.Reader) ([]byte, error) {
	raw, err := io.ReadAll(io.LimitReader(r, maxResponseBytes+1))
	if err != nil {
		return nil, ErrUnavailable
	}
	if len(raw) > maxResponseBytes {
		return nil, errors.New("codegraph: response exceeds size limit")
	}
	return raw, nil
}

// classify maps a container status onto a sentinel. 2xx is nil.
func classify(status int) error {
	switch {
	case status >= 200 && status < 300:
		return nil
	case status == http.StatusNotFound:
		return ErrNotBuilt
	case status == http.StatusConflict:
		return ErrBusy
	case status == http.StatusUnauthorized:
		return fmt.Errorf("codegraph: service key rejected")
	case status >= 500:
		return ErrUnavailable
	default:
		return fmt.Errorf("codegraph: service returned status %d", status)
	}
}

// Forward proxies one read request to the container and copies the JSON
// response to w with the container's status. Only the query string and, for
// POST, a size-capped JSON body travel; client headers do not. Transport
// failures are written as 503 so the browser and the CLI see one shape.
func (c *Client) Forward(w http.ResponseWriter, r *http.Request, method, path string) {
	if !c.Enabled() {
		writeJSONError(w, http.StatusServiceUnavailable, "code graph service is not configured")
		return
	}
	var reader io.Reader
	if method == http.MethodPost {
		body, err := io.ReadAll(io.LimitReader(r.Body, maxForwardBodyBytes+1))
		if err != nil || len(body) > maxForwardBodyBytes {
			writeJSONError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		if len(body) == 0 {
			body = []byte("{}")
		}
		reader = bytes.NewReader(body)
	}
	target := c.baseURL + path
	if raw := r.URL.RawQuery; raw != "" {
		target += "?" + raw
	}
	ctx, cancel := context.WithTimeout(r.Context(), readTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "code graph request could not be built")
		return
	}
	if reader != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set(serviceKeyHeader, c.key)
	resp, err := c.http.Do(req)
	if err != nil {
		writeJSONError(w, http.StatusServiceUnavailable, "code graph service is unavailable")
		return
	}
	defer resp.Body.Close()
	raw, err := readCapped(resp.Body)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "code graph response could not be read")
		return
	}
	if resp.StatusCode >= 500 {
		writeJSONError(w, http.StatusServiceUnavailable, "code graph service failed")
		return
	}
	if resp.StatusCode == http.StatusUnauthorized {
		writeJSONError(w, http.StatusServiceUnavailable, "code graph service key rejected")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(raw)
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
