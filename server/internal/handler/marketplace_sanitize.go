package handler

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

// Publishing takes a workspace's own configuration and makes it readable by
// workspaces that are not its own. Everything in this file exists to decide
// what may cross that line.
//
// Two rules, applied in order:
//
//  1. Redact. `env` values, `headers` values and `url` never leave the
//     publishing workspace. They are replaced by the empty string and their
//     paths are recorded as required secrets, which the installing workspace
//     must supply before the entry becomes usable. A publisher who knows a
//     particular one is not a credential — a public SSE endpoint, say — marks
//     it public explicitly and it is published verbatim.
//
//  2. Refuse. A credential inline in `command` or `args` cannot be redacted
//     without rewriting the process invocation, and a silently rewritten argv
//     is a worse outcome than a failed publish. So a recognised secret there
//     fails the publish with a message naming the argument. The fix is to move
//     the value into `env`, which is where it belonged anyway.
//
// The scan runs again over the finished payload as a backstop, so a secret
// reaching a field this file has not thought about still stops the publish.

// mcpSecretFieldURL is the required-secret path for a server's URL. `env` and
// `headers` entries are named `env.NAME` and `headers.NAME`.
const mcpSecretFieldURL = "url"

// maxRequiredSecrets caps how many values one entry can demand at install
// time. An entry needing more than this is not a configuration an installer
// can reasonably complete, and the cap keeps a malformed publish from
// producing an install form with thousands of fields.
const maxRequiredSecrets = 64

// secretTokenPatterns are credential shapes specific enough that finding one
// in a published payload is a defect, not a false positive. They are the
// vendor-issued prefixes that appear verbatim in configuration.
var secretTokenPatterns = []*regexp.Regexp{
	regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{16,}`),           // OpenAI / Anthropic style
	regexp.MustCompile(`\bsk_(live|test)_[A-Za-z0-9]{16,}`), // Stripe
	regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9]{16,}`),      // GitHub tokens
	regexp.MustCompile(`\bgithub_pat_[A-Za-z0-9_]{20,}`),    // GitHub fine-grained PAT
	regexp.MustCompile(`\bglpat-[A-Za-z0-9_-]{16,}`),        // GitLab
	regexp.MustCompile(`\bxox[abposr]-[A-Za-z0-9-]{10,}`),   // Slack
	regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`),              // AWS access key id
	regexp.MustCompile(`\bAIza[0-9A-Za-z_-]{35}\b`),         // Google API key
	regexp.MustCompile(`\bya29\.[0-9A-Za-z_-]{20,}`),        // Google OAuth
	regexp.MustCompile(`\bhf_[A-Za-z0-9]{20,}`),             // Hugging Face
	regexp.MustCompile(`\bdop_v1_[a-f0-9]{32,}`),            // DigitalOcean
	regexp.MustCompile(`\bnpm_[A-Za-z0-9]{30,}`),            // npm
	regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----`),
}

// secretFlagPattern matches an argv flag whose value is a credential by name:
// `--api-key`, `-token`, `--password=hunter2`. The name is the signal, so this
// catches a secret whose shape none of the vendor patterns know.
var secretFlagPattern = regexp.MustCompile(`(?i)^--?[a-z0-9._-]*(api[._-]?key|key|token|secret|password|passwd|credential|auth)(=.*)?$`)

// containsSecretToken reports whether s carries a recognised credential shape.
func containsSecretToken(s string) bool {
	for _, pattern := range secretTokenPatterns {
		if pattern.MatchString(s) {
			return true
		}
	}
	return false
}

// scanArgsForSecrets returns a human-readable reason when argv carries a
// credential, or "" when it does not.
//
// Both halves of a split flag are covered: `--api-key sk-…` puts the value in
// the following element, so a bare credential-named flag condemns its
// successor. A flag with no value after it is harmless and is left alone.
func scanArgsForSecrets(args []string) string {
	for i, arg := range args {
		if containsSecretToken(arg) {
			return fmt.Sprintf("argument %d carries what looks like a credential", i+1)
		}
		if !secretFlagPattern.MatchString(arg) {
			continue
		}
		if idx := strings.Index(arg, "="); idx >= 0 {
			if strings.TrimSpace(arg[idx+1:]) != "" {
				return fmt.Sprintf("argument %d (%q) sets a credential inline", i+1, arg[:idx])
			}
			continue
		}
		if i+1 < len(args) && strings.TrimSpace(args[i+1]) != "" {
			return fmt.Sprintf("argument %d (%q) is followed by a credential value", i+1, arg)
		}
	}
	return ""
}

// sanitizedMcpEntry is one MCP server entry as it is published: the config
// with every credential removed, and the paths an installer must fill in.
type sanitizedMcpEntry struct {
	Config          json.RawMessage `json:"config"`
	RequiredSecrets []string        `json:"required_secrets"`
}

// sanitizeMcpEntryForPublish strips the credential-bearing fields of one MCP
// server entry and reports what the installer will have to supply.
//
// publicFields names the required-secret paths the publisher has explicitly
// declared non-secret; those are published verbatim. Everything else in `env`,
// `headers` and `url` is replaced by an empty string.
//
// It returns an error rather than a redacted result when the entry carries an
// inline credential in `command` or `args` — see the Refuse rule above.
func sanitizeMcpEntryForPublish(entry json.RawMessage, publicFields map[string]bool) (sanitizedMcpEntry, error) {
	var decoded map[string]any
	if err := json.Unmarshal(entry, &decoded); err != nil {
		return sanitizedMcpEntry{}, fmt.Errorf("the server entry is not a JSON object")
	}
	if decoded == nil {
		return sanitizedMcpEntry{}, fmt.Errorf("the server entry is empty")
	}

	required := map[string]bool{}

	if command, ok := decoded["command"].(string); ok {
		if containsSecretToken(command) {
			return sanitizedMcpEntry{}, fmt.Errorf("the command carries what looks like a credential; move it into env before publishing")
		}
	}
	if rawArgs, ok := decoded["args"].([]any); ok {
		args := make([]string, 0, len(rawArgs))
		for _, item := range rawArgs {
			args = append(args, fmt.Sprint(item))
		}
		if reason := scanArgsForSecrets(args); reason != "" {
			return sanitizedMcpEntry{}, fmt.Errorf("%s; move it into env before publishing", reason)
		}
	}

	// `env` and `headers` are maps of name to value. The names are part of the
	// configuration and describe what the installer must provide, so they stay;
	// only the values go.
	for _, container := range []string{"env", "environment", "headers"} {
		values, ok := decoded[container].(map[string]any)
		if !ok {
			continue
		}
		field := container
		if container == "environment" {
			field = "env"
		}
		redacted := make(map[string]any, len(values))
		for name, value := range values {
			path := field + "." + name
			if publicFields[path] {
				redacted[name] = value
				continue
			}
			redacted[name] = ""
			required[path] = true
		}
		decoded[container] = redacted
	}

	// A URL can be a bearer credential on its own — a Composio-style session
	// URL is the standing example — so it is withheld unless the publisher says
	// otherwise. The scheme and host survive as a hint in the manifest so an
	// installer can see what they are about to connect to.
	if raw, ok := decoded["url"].(string); ok && strings.TrimSpace(raw) != "" {
		if publicFields[mcpSecretFieldURL] {
			if containsSecretToken(raw) {
				return sanitizedMcpEntry{}, fmt.Errorf("the URL carries what looks like a credential and cannot be published publicly")
			}
		} else {
			decoded["url"] = ""
			required[mcpSecretFieldURL] = true
		}
	}

	sanitized, err := json.Marshal(decoded)
	if err != nil {
		return sanitizedMcpEntry{}, err
	}
	// Backstop: a credential in a field this function does not model still
	// stops the publish rather than shipping.
	if containsSecretToken(string(sanitized)) {
		return sanitizedMcpEntry{}, fmt.Errorf("the server entry still carries what looks like a credential after redaction; remove it before publishing")
	}
	if len(required) > maxRequiredSecrets {
		return sanitizedMcpEntry{}, fmt.Errorf("the server entry needs more than %d values at install time", maxRequiredSecrets)
	}

	return sanitizedMcpEntry{Config: sanitized, RequiredSecrets: sortedSecretPaths(required)}, nil
}

// restoreMcpEntrySecrets puts the installing workspace's own values back into a
// published entry. Missing values are left empty rather than rejected: an
// installer may legitimately want the server present and unconfigured, and the
// runtime reports the failure more usefully than an install-time error would.
func restoreMcpEntrySecrets(config json.RawMessage, secrets map[string]string) (json.RawMessage, error) {
	if len(secrets) == 0 {
		return config, nil
	}
	var decoded map[string]any
	if err := json.Unmarshal(config, &decoded); err != nil {
		return nil, fmt.Errorf("the published server entry is not a JSON object")
	}

	for _, container := range []string{"env", "environment", "headers"} {
		values, ok := decoded[container].(map[string]any)
		if !ok {
			continue
		}
		field := container
		if container == "environment" {
			field = "env"
		}
		for name := range values {
			if supplied, ok := secrets[field+"."+name]; ok {
				values[name] = supplied
			}
		}
		decoded[container] = values
	}
	if supplied, ok := secrets[mcpSecretFieldURL]; ok && strings.TrimSpace(supplied) != "" {
		if _, err := url.Parse(supplied); err != nil {
			return nil, fmt.Errorf("the supplied URL is not a valid URL")
		}
		decoded["url"] = supplied
	}

	return json.Marshal(decoded)
}

// mcpEndpointHint is the non-secret part of a withheld URL: scheme and host,
// so a reader can see which service an entry talks to without receiving the
// credential embedded in its path or query.
func mcpEndpointHint(entry json.RawMessage) string {
	var decoded struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(entry, &decoded); err != nil {
		return ""
	}
	raw := strings.TrimSpace(decoded.URL)
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

// sortedSecretPaths gives the required-secret list a stable order, so a
// republish of identical content produces an identical manifest and therefore
// an identical digest.
func sortedSecretPaths(set map[string]bool) []string {
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
