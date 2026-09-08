package semantic

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const MaxResponseBytes = 8 << 20

type Adapter struct {
	AllowedOrigins []string
	Client         *http.Client
}

// ValidateEndpoint requires an operator-approved exact origin, including port.
// Connections never turn user-supplied URLs into an unrestricted SSRF proxy.
func (a Adapter) ValidateEndpoint(endpoint string) error {
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" || u.User != nil || u.Fragment != "" || u.RawQuery != "" {
		return errors.New("endpoint must have an origin and must not contain credentials, query or fragment")
	}
	if u.Scheme != "https" && u.Scheme != "http" && u.Scheme != "postgres" && u.Scheme != "postgresql" {
		return errors.New("unsupported endpoint scheme")
	}
	origin := u.Scheme + "://" + u.Host
	for _, allowed := range a.AllowedOrigins {
		if strings.TrimRight(strings.TrimSpace(allowed), "/") == origin {
			return nil
		}
	}
	return errors.New("connection origin is not approved by ENACT_SEMANTIC_ALLOWED_ORIGINS")
}

var placeholder = regexp.MustCompile(`\{([A-Za-z0-9_.]+)\}`)

func ExpandPath(path string, params map[string]any) (string, error) {
	var missing string
	result := placeholder.ReplaceAllStringFunc(path, func(token string) string {
		key := token[1 : len(token)-1]
		value, ok := Lookup(params, key)
		if !ok {
			missing = key
			return token
		}
		return url.PathEscape(fmt.Sprint(value))
	})
	if missing != "" {
		return "", fmt.Errorf("missing path parameter %s", missing)
	}
	if !strings.HasPrefix(result, "/") || strings.HasPrefix(result, "//") || strings.Contains(result, "..") {
		return "", errors.New("operation path must stay inside its connection")
	}
	return result, nil
}

func (a Adapter) REST(ctx context.Context, c Connection, secret Secret, method, path string, params map[string]any, key string) (json.RawMessage, error) {
	return a.rest(ctx, c, secret, method, path, params, params, key, nil)
}
func (a Adapter) RESTWithStatus(ctx context.Context, c Connection, secret Secret, method, path string, params map[string]any, key string) (json.RawMessage, int, error) {
	status := 0
	raw, err := a.rest(ctx, c, secret, method, path, params, params, key, &status)
	return raw, status, err
}
func (a Adapter) Action(ctx context.Context, c Connection, secret Secret, binding Binding, params map[string]any, key string) (json.RawMessage, int, error) {
	if c.Kind == "mcp" {
		if binding.ToolSchemaDigest == "" || binding.IdempotencyParameter == "" {
			return nil, 0, errors.New("MCP action requires a published schema and idempotency parameter")
		}
		args := map[string]any{}
		for name, value := range params {
			args[name] = value
		}
		args[binding.IdempotencyParameter] = key
		result, err := a.mcpSession(ctx, c, secret, "tools/call", map[string]any{"name": binding.Tool, "arguments": args}, binding.ToolSchemaDigest, true)
		return result, 0, err
	}
	body := map[string]any{}
	if binding.BodyParameters != nil {
		for _, name := range *binding.BodyParameters {
			if value, exists := params[name]; exists {
				body[name] = value
			}
		}
	} else {
		for name, value := range params {
			body[name] = value
		}
		for _, match := range placeholder.FindAllStringSubmatch(binding.Path, -1) {
			delete(body, strings.Split(match[1], ".")[0])
		}
	}
	status := 0
	raw, err := a.rest(ctx, c, secret, strings.ToUpper(binding.Method), binding.Path, params, body, key, &status)
	return raw, status, err
}
func (a Adapter) rest(ctx context.Context, c Connection, secret Secret, method, path string, params, bodyParams map[string]any, key string, statusOutput *int) (json.RawMessage, error) {
	if err := a.ValidateEndpoint(c.Endpoint); err != nil {
		return nil, err
	}
	expanded, err := ExpandPath(path, params)
	if err != nil {
		return nil, err
	}
	base, err := url.Parse(strings.TrimRight(c.Endpoint, "/") + expanded)
	if err != nil {
		return nil, errors.New("invalid operation path")
	}
	body := io.Reader(nil)
	if method != "GET" {
		raw, _ := json.Marshal(bodyParams)
		body = bytes.NewReader(raw)
	}
	request, err := http.NewRequestWithContext(ctx, method, base.String(), body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	for k, v := range secret.Headers {
		if strings.EqualFold(k, "Host") || strings.EqualFold(k, "Cookie") {
			return nil, errors.New("Host and Cookie credential headers are not supported")
		}
		request.Header.Set(k, v)
	}
	if key != "" {
		request.Header.Set("Idempotency-Key", key)
	}
	client := &http.Client{Timeout: 25 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("connector redirects are not allowed") }}
	if a.Client != nil {
		clone := *a.Client
		clone.CheckRedirect = client.CheckRedirect
		client = &clone
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, errors.New("connection request failed; operation outcome may be unknown")
	}
	defer response.Body.Close()
	if statusOutput != nil {
		*statusOutput = response.StatusCode
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, MaxResponseBytes+1))
	if err != nil {
		return nil, errors.New("connection response could not be read")
	}
	if len(raw) > MaxResponseBytes {
		return nil, errors.New("connection response exceeds size limit")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("connection returned HTTP %d", response.StatusCode)
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return json.RawMessage(`null`), nil
	}
	if !json.Valid(raw) {
		return nil, errors.New("connection returned invalid JSON")
	}
	return raw, nil
}

func (a Adapter) Query(ctx context.Context, c Connection, s Secret, b Binding, params map[string]any) (json.RawMessage, error) {
	if err := b.CheckParameters(params); err != nil {
		return nil, err
	}
	switch c.Kind {
	case "rest":
		return a.REST(ctx, c, s, "GET", b.Path, params, "")
	case "postgres":
		return a.postgres(ctx, c, s, b.SQL, b.Arguments, params)
	case "mcp":
		return a.mcpSession(ctx, c, s, "tools/call", map[string]any{"name": b.Tool, "arguments": params}, b.ToolSchemaDigest, false)
	default:
		return nil, errors.New("unsupported connection kind")
	}
}

func (a Adapter) Discover(ctx context.Context, c Connection, s Secret) (json.RawMessage, error) {
	switch c.Kind {
	case "rest":
		path, _ := c.Config["discovery_path"].(string)
		if path == "" {
			path = "/openapi.json"
		}
		return a.REST(ctx, c, s, "GET", path, map[string]any{}, "")
	case "postgres":
		return a.postgres(ctx, c, s, "SELECT table_schema, table_name, column_name, data_type FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema,table_name,ordinal_position", nil, nil)
	case "mcp":
		return a.mcp(ctx, c, s, "tools/list", map[string]any{})
	default:
		return nil, errors.New("unsupported connection kind")
	}
}

func (a Adapter) postgres(ctx context.Context, c Connection, s Secret, sql string, arguments []string, params map[string]any) (json.RawMessage, error) {
	if err := a.ValidateEndpoint(c.Endpoint); err != nil {
		return nil, err
	}
	if strings.TrimSpace(sql) == "" {
		return nil, errors.New("PostgreSQL binding requires a parameterized SQL statement")
	}
	config, err := pgx.ParseConfig(s.DSN)
	if err != nil {
		return nil, errors.New("invalid PostgreSQL credential")
	}
	endpoint, _ := url.Parse(c.Endpoint)
	host := config.Host
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if endpoint.Host != fmt.Sprintf("%s:%d", host, config.Port) {
		return nil, errors.New("PostgreSQL credential host must equal the approved endpoint including port")
	}
	for _, fallback := range config.Fallbacks {
		if fallback.Host != config.Host || fallback.Port != config.Port {
			return nil, errors.New("PostgreSQL fallback hosts must match the approved endpoint")
		}
	}
	connection, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		return nil, errors.New("PostgreSQL connection failed")
	}
	defer connection.Close(context.Background())
	tx, err := connection.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, "SET LOCAL statement_timeout = '10000ms'"); err != nil {
		return nil, err
	}
	args := make([]any, len(arguments))
	for i, key := range arguments {
		value, ok := params[key]
		if !ok {
			return nil, fmt.Errorf("missing SQL parameter %s", key)
		}
		args[i] = value
	}
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		return nil, errors.New("read-only PostgreSQL query failed")
	}
	defer rows.Close()
	columns := []string{}
	for _, field := range rows.FieldDescriptions() {
		columns = append(columns, field.Name)
	}
	result := []map[string]any{}
	truncated := false
	for rows.Next() {
		if len(result) >= 1000 {
			truncated = true
			break
		}
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}
		row := map[string]any{}
		for i, value := range values {
			row[columns[i]] = value
		}
		result = append(result, row)
	}
	if err = rows.Err(); err != nil {
		return nil, errors.New("read-only PostgreSQL query failed")
	}
	return json.Marshal(map[string]any{"columns": columns, "rows": result, "truncated": truncated})
}

// mcp speaks streamable HTTP with a per-call session. MCP data access is only
// allowed for tools whose server declares readOnlyHint=true at publication.
func (a Adapter) mcp(ctx context.Context, c Connection, s Secret, method string, params map[string]any) (json.RawMessage, error) {
	return a.mcpSession(ctx, c, s, method, params, "", false)
}

func (a Adapter) Readback(ctx context.Context, c Connection, s Secret, b Readback, params map[string]any) (json.RawMessage, error) {
	if c.Kind != "mcp" {
		return a.REST(ctx, c, s, "GET", b.Path, params, "")
	}
	args := map[string]any{}
	for name, value := range b.Arguments {
		if text, ok := value.(string); ok && strings.HasPrefix(text, "{") && strings.HasSuffix(text, "}") {
			resolved, exists := Lookup(params, text[1:len(text)-1])
			if !exists {
				return nil, fmt.Errorf("missing readback argument %s", text)
			}
			args[name] = resolved
		} else {
			args[name] = value
		}
	}
	return a.mcpSession(ctx, c, s, "tools/call", map[string]any{"name": b.Tool, "arguments": args}, b.ToolSchemaDigest, false)
}

func CheckReadback(raw json.RawMessage, expected map[string]any, params map[string]any) error {
	var response any
	if err := json.Unmarshal(raw, &response); err != nil {
		return err
	}
	for path, want := range expected {
		if str, ok := want.(string); ok && strings.HasPrefix(str, "{") && strings.HasSuffix(str, "}") {
			var exists bool
			want, exists = Lookup(params, str[1:len(str)-1])
			if !exists {
				return fmt.Errorf("readback expected parameter %s missing", str)
			}
		}
		got, ok := Lookup(response, path)
		if !ok || Digest(got) != Digest(want) {
			return fmt.Errorf("readback condition %s not satisfied", path)
		}
	}
	return nil
}
