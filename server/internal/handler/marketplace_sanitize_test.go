// @vitest-environment is a TypeScript concept; the Go equivalent of "this
// needs no database" is simply not touching one. Everything in this file is a
// pure function, which is where the redaction rules are decided — the handler
// tests in marketplace_test.go check that the publish path calls into them, not
// what they do.
package handler

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestSanitizeMcpEntryForPublishWithholdsCredentials(t *testing.T) {
	tests := []struct {
		name         string
		entry        string
		publicFields map[string]bool
		wantSecrets  []string
		// wantAbsent are substrings that must not survive into the published
		// config. This is the assertion that matters: a leak here is the whole
		// class of bug this file exists to prevent.
		wantAbsent []string
		wantErr    string
	}{
		{
			name:        "env values are withheld and their names become required secrets",
			entry:       `{"command":"npx","args":["-y","server"],"env":{"GITHUB_TOKEN":"ghp_abcdefghijklmnopqrstuvwxyz","REGION":"eu"}}`,
			wantSecrets: []string{"env.GITHUB_TOKEN", "env.REGION"},
			wantAbsent:  []string{"ghp_abcdefghijklmnopqrstuvwxyz", "eu"},
		},
		{
			name:        "header values are withheld",
			entry:       `{"url":"https://mcp.example.com/sse","headers":{"Authorization":"Bearer squirrel"}}`,
			wantSecrets: []string{"headers.Authorization", "url"},
			wantAbsent:  []string{"squirrel", "mcp.example.com"},
		},
		{
			// A session URL is a bearer credential on its own, which is why the
			// default is to withhold it rather than to publish it and hope.
			name:        "a url is withheld by default",
			entry:       `{"url":"https://mcp.composio.dev/abc123def456/sse"}`,
			wantSecrets: []string{"url"},
			wantAbsent:  []string{"abc123def456"},
		},
		{
			name:         "a publisher can declare a url public",
			entry:        `{"url":"https://mcp.example.com/sse","type":"sse"}`,
			publicFields: map[string]bool{"url": true},
			wantSecrets:  []string{},
		},
		{
			name:         "a publisher can declare one env value public and the rest stay withheld",
			entry:        `{"command":"srv","env":{"REGION":"eu","TOKEN":"secret-value-here"}}`,
			publicFields: map[string]bool{"env.REGION": true},
			wantSecrets:  []string{"env.TOKEN"},
			wantAbsent:   []string{"secret-value-here"},
		},
		{
			// Redacting argv would mean rewriting the process invocation, so the
			// publish is refused instead and the message says what to do.
			name:    "an inline credential in args refuses the publish",
			entry:   `{"command":"npx","args":["--api-key=hunter2hunter2hunter2"]}`,
			wantErr: "sets a credential inline",
		},
		{
			name:    "a credential-named flag with a following value refuses the publish",
			entry:   `{"command":"npx","args":["--token","hunter2hunter2hunter2"]}`,
			wantErr: "is followed by a credential value",
		},
		{
			name:    "a vendor-shaped token anywhere in args refuses the publish",
			entry:   `{"command":"npx","args":["--config","github_pat_11ABCDEFG0123456789abcdef"]}`,
			wantErr: "carries what looks like a credential",
		},
		{
			name:    "a credential in the command itself refuses the publish",
			entry:   `{"command":"run --with sk-abcdefghijklmnopqrst"}`,
			wantErr: "the command carries what looks like a credential",
		},
		{
			name:         "a url declared public that carries a token is still refused",
			entry:        `{"url":"https://api.example.com/?key=AIzaSyA12345678901234567890123456789012"}`,
			publicFields: map[string]bool{"url": true},
			wantErr:      "cannot be published publicly",
		},
		{
			name:    "a non-object entry is refused",
			entry:   `"just a string"`,
			wantErr: "not a JSON object",
		},
		{
			name:        "the legacy environment spelling is redacted under the env path",
			entry:       `{"command":"srv","environment":{"TOKEN":"legacy-secret"}}`,
			wantSecrets: []string{"env.TOKEN"},
			wantAbsent:  []string{"legacy-secret"},
		},
		{
			name:        "a bare stdio server needs nothing at install time",
			entry:       `{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"]}`,
			wantSecrets: []string{},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := sanitizeMcpEntryForPublish(json.RawMessage(tc.entry), tc.publicFields)
			if tc.wantErr != "" {
				if err == nil {
					t.Fatalf("expected a refusal containing %q, got config %s", tc.wantErr, got.Config)
				}
				if !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("refusal was %q, expected it to contain %q", err.Error(), tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("sanitize failed: %v", err)
			}
			if !reflect.DeepEqual(got.RequiredSecrets, tc.wantSecrets) {
				t.Errorf("required secrets = %v, want %v", got.RequiredSecrets, tc.wantSecrets)
			}
			for _, absent := range tc.wantAbsent {
				if strings.Contains(string(got.Config), absent) {
					t.Errorf("published config leaked %q: %s", absent, got.Config)
				}
			}
		})
	}
}

func TestSanitizeMcpEntryKeepsTheShapeAnInstallerNeeds(t *testing.T) {
	// Redaction removes values, never the structure: an installer has to be
	// able to see which variables the server expects before it can supply them.
	got, err := sanitizeMcpEntryForPublish(
		json.RawMessage(`{"command":"npx","args":["-y","srv"],"env":{"TOKEN":"s3cret-value","REGION":"eu"}}`),
		nil,
	)
	if err != nil {
		t.Fatalf("sanitize failed: %v", err)
	}
	var decoded struct {
		Command string            `json:"command"`
		Args    []string          `json:"args"`
		Env     map[string]string `json:"env"`
	}
	if err := json.Unmarshal(got.Config, &decoded); err != nil {
		t.Fatalf("published config is not decodable: %v", err)
	}
	if decoded.Command != "npx" {
		t.Errorf("command = %q, want npx", decoded.Command)
	}
	if !reflect.DeepEqual(decoded.Args, []string{"-y", "srv"}) {
		t.Errorf("args = %v, want [-y srv]", decoded.Args)
	}
	if len(decoded.Env) != 2 {
		t.Fatalf("env should keep both names, got %v", decoded.Env)
	}
	for name, value := range decoded.Env {
		if value != "" {
			t.Errorf("env %q kept the value %q; every withheld value must be empty", name, value)
		}
	}
}

func TestRestoreMcpEntrySecretsFillsWhatThePublisherWithheld(t *testing.T) {
	published := json.RawMessage(`{"command":"npx","env":{"TOKEN":"","REGION":""},"headers":{"X-Key":""},"url":""}`)

	restored, err := restoreMcpEntrySecrets(published, map[string]string{
		"env.TOKEN":     "installer-token",
		"headers.X-Key": "installer-key",
		"url":           "https://installer.example.com/sse",
	})
	if err != nil {
		t.Fatalf("restore failed: %v", err)
	}
	var decoded struct {
		Env     map[string]string `json:"env"`
		Headers map[string]string `json:"headers"`
		URL     string            `json:"url"`
	}
	if err := json.Unmarshal(restored, &decoded); err != nil {
		t.Fatalf("restored config is not decodable: %v", err)
	}
	if decoded.Env["TOKEN"] != "installer-token" {
		t.Errorf("env.TOKEN = %q, want installer-token", decoded.Env["TOKEN"])
	}
	// An unsupplied value stays empty rather than failing the install: the
	// server is installed and unconfigured, which the runtime reports better
	// than an install-time error would.
	if decoded.Env["REGION"] != "" {
		t.Errorf("env.REGION = %q, want it left empty", decoded.Env["REGION"])
	}
	if decoded.Headers["X-Key"] != "installer-key" {
		t.Errorf("headers.X-Key = %q, want installer-key", decoded.Headers["X-Key"])
	}
	if decoded.URL != "https://installer.example.com/sse" {
		t.Errorf("url = %q, want the installer's own", decoded.URL)
	}
}

func TestRestoreMcpEntrySecretsIgnoresPathsTheEntryDoesNotDeclare(t *testing.T) {
	// A secret map is client input. A key naming a variable the published entry
	// never declared must not introduce it — that would let an installer inject
	// arbitrary environment into a server someone else described.
	restored, err := restoreMcpEntrySecrets(
		json.RawMessage(`{"command":"npx","env":{"TOKEN":""}}`),
		map[string]string{"env.LD_PRELOAD": "/tmp/evil.so"},
	)
	if err != nil {
		t.Fatalf("restore failed: %v", err)
	}
	if strings.Contains(string(restored), "LD_PRELOAD") {
		t.Fatalf("restore invented an undeclared variable: %s", restored)
	}
}

func TestScopedSecretsSplitsAnAgentTemplatesFlatMap(t *testing.T) {
	secrets := map[string]string{
		"github/env.TOKEN": "gh-value",
		"linear/env.TOKEN": "linear-value",
		"env.SHARED":       "shared-value",
	}
	got := scopedSecrets(secrets, "github")
	want := map[string]string{"env.TOKEN": "gh-value", "env.SHARED": "shared-value"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("scoped secrets = %v, want %v", got, want)
	}
}

func TestMcpEndpointHintKeepsOnlySchemeAndHost(t *testing.T) {
	tests := []struct {
		entry string
		want  string
	}{
		{`{"url":"https://mcp.composio.dev/abc123secret/sse?key=v"}`, "https://mcp.composio.dev"},
		{`{"command":"npx"}`, ""},
		{`{"url":"not a url at all"}`, ""},
	}
	for _, tc := range tests {
		if got := mcpEndpointHint(json.RawMessage(tc.entry)); got != tc.want {
			t.Errorf("endpoint hint for %s = %q, want %q", tc.entry, got, tc.want)
		}
	}
}

func TestScanArgsForSecretsLeavesOrdinaryArgumentsAlone(t *testing.T) {
	// The refusal has to be narrow enough that ordinary servers stay
	// publishable; a false positive here blocks a legitimate publish.
	ordinary := [][]string{
		{"-y", "@modelcontextprotocol/server-filesystem", "/srv/data"},
		{"--port", "8080"},
		{"--verbose"},
		{"--api-key"}, // a bare flag with no value after it
		{"run", "--config", "./config.json"},
	}
	for _, args := range ordinary {
		if reason := scanArgsForSecrets(args); reason != "" {
			t.Errorf("args %v were refused with %q; they carry no credential", args, reason)
		}
	}
}

func TestMarketplaceSlugify(t *testing.T) {
	tests := map[string]string{
		"Code Review":      "code-review",
		"  Spaced   Out  ": "spaced-out",
		"MiXeD_Case.Name":  "mixed-case-name",
		"already-a-slug":   "already-a-slug",
		"符号":               "",
		"":                 "",
		"---":              "",
		"path/like/name":   "path-like-name",
	}
	for input, want := range tests {
		if got := marketplaceSlugify(input); got != want {
			t.Errorf("slugify(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestMarketplaceVersionDigestIsStableAndContentSensitive(t *testing.T) {
	manifest := []byte(`{"kind":"skill","skill":{"name":"a","description":"b"}}`)
	files := []marketplaceFile{
		{Path: "SKILL.md", Content: "body"},
		{Path: "references/one.md", Content: "one"},
	}

	first, size, err := marketplaceVersionDigest(manifest, files)
	if err != nil {
		t.Fatalf("digest failed: %v", err)
	}
	// File order is an accident of how the publish path assembled them, so it
	// must not change the digest.
	reordered := []marketplaceFile{files[1], files[0]}
	second, _, err := marketplaceVersionDigest(manifest, reordered)
	if err != nil {
		t.Fatalf("digest failed: %v", err)
	}
	if first != second {
		t.Errorf("digest changed when the file order did: %s vs %s", first, second)
	}
	if size != int64(len(`{"kind":"skill","skill":{"description":"b","name":"a"}}`)+len("body")+len("one")) {
		t.Errorf("size = %d, which does not account for the canonical manifest plus every file", size)
	}

	// A change to one byte of one file has to change the digest, or the digest
	// cannot be used to confirm two people are looking at the same version.
	changed := []marketplaceFile{{Path: "SKILL.md", Content: "body!"}, files[1]}
	third, _, err := marketplaceVersionDigest(manifest, changed)
	if err != nil {
		t.Fatalf("digest failed: %v", err)
	}
	if third == first {
		t.Error("digest did not change when a file's content did")
	}

	// Splitting the same bytes differently across files must not collide.
	a, _, _ := marketplaceVersionDigest(manifest, []marketplaceFile{{Path: "a", Content: "xy"}, {Path: "b", Content: "z"}})
	b, _, _ := marketplaceVersionDigest(manifest, []marketplaceFile{{Path: "a", Content: "x"}, {Path: "b", Content: "yz"}})
	if a == b {
		t.Error("two different file splits of the same bytes produced the same digest")
	}
}

func TestMarketplaceSkillFilesSplitsBodyFromReferences(t *testing.T) {
	files := []marketplaceFile{
		{Path: "skills/reviewer/SKILL.md", Content: "the body"},
		{Path: "skills/reviewer/references/checklist.md", Content: "the checklist"},
		{Path: "skills/other/SKILL.md", Content: "someone else's body"},
	}
	body, refs := marketplaceSkillFiles(files, "skills/reviewer/", skillContentPath)
	if body != "the body" {
		t.Errorf("body = %q, want the reviewer's own", body)
	}
	if len(refs) != 1 || refs[0].Path != "references/checklist.md" {
		t.Fatalf("references = %v, want one entry relative to the skill's directory", refs)
	}
	if refs[0].Content != "the checklist" {
		t.Errorf("reference content = %q", refs[0].Content)
	}
}

func TestMarketplaceSkillFilesRejectsAnEscapingPath(t *testing.T) {
	// A published path decides where a file lands on a runtime's disk and comes
	// from another workspace, so it is re-validated at install rather than
	// trusted because the publish path checked it.
	_, refs := marketplaceSkillFiles([]marketplaceFile{
		{Path: "SKILL.md", Content: "body"},
		{Path: "../../etc/passwd", Content: "nope"},
		{Path: "/absolute", Content: "nope"},
	}, "", skillContentPath)
	if len(refs) != 0 {
		t.Fatalf("escaping paths were accepted: %v", refs)
	}
}

func TestNormalizeMarketplaceTagsMakesFacetsCountTheSameThing(t *testing.T) {
	got := normalizeMarketplaceTags([]string{"Review", "  review ", "TESTING", "", "  "})
	want := []string{"review", "testing"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("tags = %v, want %v", got, want)
	}
}
