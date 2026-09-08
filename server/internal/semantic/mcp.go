package semantic

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

func (a Adapter) mcpSession(ctx context.Context, c Connection, secret Secret, method string, params map[string]any, expectedDigest string, allowWrite bool) (json.RawMessage, error) {
	if err := a.ValidateEndpoint(c.Endpoint); err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 25 * time.Second}
	if a.Client != nil {
		copy := *a.Client
		client = &copy
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("MCP redirects are not allowed") }
	session := ""
	sequence := 0
	call := func(name string, parameters any, notification bool) (json.RawMessage, error) {
		sequence++
		payload := map[string]any{"jsonrpc": "2.0", "method": name, "params": parameters}
		if !notification {
			payload["id"] = sequence
		}
		raw, _ := json.Marshal(payload)
		request, err := http.NewRequestWithContext(ctx, "POST", c.Endpoint, bytes.NewReader(raw))
		if err != nil {
			return nil, err
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Accept", "application/json, text/event-stream")
		request.Header.Set("MCP-Protocol-Version", "2025-03-26")
		for key, value := range secret.Headers {
			if strings.EqualFold(key, "Host") || strings.EqualFold(key, "Cookie") {
				return nil, errors.New("unsupported MCP credential header")
			}
			request.Header.Set(key, value)
		}
		if session != "" {
			request.Header.Set("Mcp-Session-Id", session)
		}
		response, err := client.Do(request)
		if err != nil {
			return nil, errors.New("MCP service is unavailable")
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return nil, errors.New("MCP request was rejected")
		}
		if next := response.Header.Get("Mcp-Session-Id"); next != "" {
			session = next
		}
		body, err := io.ReadAll(io.LimitReader(response.Body, MaxResponseBytes+1))
		if err != nil || len(body) > MaxResponseBytes {
			return nil, errors.New("MCP response could not be read within the size limit")
		}
		if notification {
			return nil, nil
		}
		if strings.Contains(response.Header.Get("Content-Type"), "text/event-stream") {
			scanner := bufio.NewScanner(bytes.NewReader(body))
			scanner.Buffer(make([]byte, 4096), MaxResponseBytes)
			found := false
			for scanner.Scan() {
				line := scanner.Text()
				if strings.HasPrefix(line, "data:") {
					candidate := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
					if json.Valid([]byte(candidate)) {
						body = []byte(candidate)
						found = true
						break
					}
				}
			}
			if !found {
				return nil, errors.New("MCP event stream contained no JSON response")
			}
		}
		var envelope struct {
			Result json.RawMessage `json:"result"`
			Error  json.RawMessage `json:"error"`
		}
		if json.Unmarshal(body, &envelope) != nil || len(envelope.Error) > 0 || len(envelope.Result) == 0 {
			return nil, errors.New("MCP returned an invalid or failed response")
		}
		return envelope.Result, nil
	}
	if _, err := call("initialize", map[string]any{"protocolVersion": "2025-03-26", "capabilities": map[string]any{}, "clientInfo": map[string]string{"name": "enact-semantic", "version": "1"}}, false); err != nil {
		return nil, err
	}
	if _, err := call("notifications/initialized", map[string]any{}, true); err != nil {
		return nil, err
	}
	discovered, err := call("tools/list", map[string]any{}, false)
	if err != nil {
		return nil, err
	}
	if method == "tools/list" {
		return discovered, nil
	}
	selected, _ := params["name"].(string)
	tool, err := mcpDescriptor(discovered, selected)
	if err != nil {
		return nil, err
	}
	annotations, _ := tool["annotations"].(map[string]any)
	if allowWrite {
		if annotations["idempotentHint"] != true {
			return nil, errors.New("MCP action tool no longer declares idempotency")
		}
	} else if annotations["readOnlyHint"] != true {
		return nil, errors.New("MCP reads require a discovered tool with readOnlyHint=true")
	}
	if expectedDigest != "" && Digest(tool) != expectedDigest {
		return nil, errors.New("MCP tool schema changed; publish and authorize a new ontology release")
	}
	result, err := call(method, params, false)
	if err != nil {
		return nil, err
	}
	var outcome struct {
		IsError bool `json:"isError"`
	}
	if json.Unmarshal(result, &outcome) == nil && outcome.IsError {
		return nil, errors.New("MCP tool reported an error")
	}
	return result, nil
}
