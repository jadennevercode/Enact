package agent

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestModelOperationClaudeDisablesToolsAndIgnoresCustomArguments(t *testing.T) {
	args := buildClaudeArgs(ExecOptions{ModelOperation: true, ResponseSchema: json.RawMessage(`{"type":"object"}`), ExtraArgs: []string{"--tools", "Bash"}, CustomArgs: []string{"--resume", "other-task"}}, slog.Default())
	joined := strings.Join(args, "|")
	for _, required := range []string{"--tools||", "--safe-mode", "--strict-mcp-config", "--disable-slash-commands", "--json-schema"} {
		if !strings.Contains(joined, required) {
			t.Errorf("missing %s in %s", required, joined)
		}
	}
	if strings.Contains(joined, "Bash") || strings.Contains(joined, "--resume") || strings.Contains(joined, "bypassPermissions") {
		t.Fatal("task capabilities leaked into model operation")
	}
}

func TestModelOperationClaudeUsesStructuredOutputAndStripsTaskEnvironment(t *testing.T) {
	if os.PathSeparator == '\\' {
		t.Skip("shell fixture")
	}
	t.Setenv("ENACT_TOKEN", "test-parent-token")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-aws-key")
	t.Setenv("DATABASE_URL", "test-database-credential")
	path := filepath.Join(t.TempDir(), "fake-claude")
	script := `#!/bin/sh
read request
if [ -n "$ENACT_TOKEN$AWS_SECRET_ACCESS_KEY$DATABASE_URL" ]; then exit 9; fi
printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"result":"wrong unstructured output","structured_output":{"answer":42},"num_turns":1}'
`
	if err := os.WriteFile(path, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	result, err := ExecuteModelOperation(context.Background(), "claude", Config{ExecutablePath: path}, "return answer", ExecOptions{ResponseSchema: json.RawMessage(`{"type":"object"}`), Timeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" || result.Output != `{"answer":42}` {
		t.Fatalf("result=%+v", result)
	}
}

func TestModelOperationRejectsUnsupportedAndWrappedRuntimes(t *testing.T) {
	for _, test := range []struct {
		provider string
		cfg      Config
	}{{"unsupported", Config{}}, {"codex", Config{LaunchPrefix: []string{"wrapper"}}}} {
		if _, err := ExecuteModelOperation(context.Background(), test.provider, test.cfg, "prompt", ExecOptions{}); err == nil {
			t.Fatal("unsupported execution path accepted")
		}
	}
}

func TestModelOperationCodexEnvelopePreservesOpenMetadataAndOriginalSchema(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{"entities":{"type":"array","items":{"$ref":"#/$defs/Entity"}}},"$defs":{"Entity":{"type":"object","properties":{"text":{"type":"string"},"metadata":{"type":"object","additionalProperties":true}},"required":["text"]}}}`)
	before := string(schema)
	prompt := codexModelEnvelopePrompt("Extract source entities", schema)
	if !strings.Contains(prompt, before) || string(schema) != before {
		t.Fatal("transport changed the original operation schema")
	}
	value := `{"entities":[{"text":"Alice","metadata":{"source":"document","nested":{"confidence":0.95}}}]}`
	wire, _ := json.Marshal(map[string]string{"json_output": value})
	decoded, err := decodeCodexModelEnvelope(string(wire))
	if err != nil || decoded != value {
		t.Fatalf("metadata or optional semantics lost: %q %v", decoded, err)
	}
	for _, invalid := range []string{`{}`, `{"json_output":"not JSON"}`, `{"json_output":{}}`} {
		if _, err := decodeCodexModelEnvelope(invalid); err == nil {
			t.Fatalf("invalid envelope accepted: %s", invalid)
		}
	}
}
