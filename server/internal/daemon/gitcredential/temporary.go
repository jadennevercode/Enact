package gitcredential

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// Temporary is a repository-scoped Git credential environment. The password
// exists only in a 0600 credential-store file and never appears in the remote
// URL, Git command arguments, or returned environment values.
type Temporary struct {
	dir string
	env []string
}

// New creates a short-lived credential helper configuration for one HTTPS
// repository. Call Cleanup as soon as the Git operation completes.
func New(repositoryURL, username, password, caPEM string) (*Temporary, error) {
	repositoryURL = strings.TrimSpace(repositoryURL)
	parsed, err := url.Parse(repositoryURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return nil, fmt.Errorf("repository URL must be absolute HTTPS")
	}
	if username == "" || password == "" {
		return nil, fmt.Errorf("Git username and password are required")
	}
	dir, err := os.MkdirTemp("", "enact-git-credential-")
	if err != nil {
		return nil, fmt.Errorf("create credential directory: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		os.RemoveAll(dir)
		return nil, fmt.Errorf("secure credential directory: %w", err)
	}
	temporary := &Temporary{dir: dir}
	fail := func(err error) (*Temporary, error) {
		temporary.Cleanup()
		return nil, err
	}

	credentialPath := filepath.Join(dir, "credentials")
	credentialURL := *parsed
	credentialURL.User = url.UserPassword(username, password)
	credentialURL.RawQuery = ""
	credentialURL.Fragment = ""
	if err := os.WriteFile(credentialPath, []byte(credentialURL.String()+"\n"), 0o600); err != nil {
		return fail(fmt.Errorf("write credential file: %w", err))
	}
	configPath := filepath.Join(dir, "gitconfig")
	config := "[credential]\n\thelper = \"store --file=" + escapeGitConfigValue(credentialPath) + "\"\n\tuseHttpPath = true\n"
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		return fail(fmt.Errorf("write Git config: %w", err))
	}
	temporary.env = []string{"GIT_CONFIG_GLOBAL=" + configPath}
	if strings.TrimSpace(caPEM) != "" {
		caPath := filepath.Join(dir, "ca.pem")
		if err := os.WriteFile(caPath, []byte(strings.TrimSpace(caPEM)+"\n"), 0o600); err != nil {
			return fail(fmt.Errorf("write CA file: %w", err))
		}
		temporary.env = append(temporary.env, "GIT_SSL_CAINFO="+caPath)
	}
	return temporary, nil
}

func escapeGitConfigValue(value string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(value)
}

// Env returns a copy suitable for appending to a Git subprocess environment.
func (t *Temporary) Env() []string { return append([]string(nil), t.env...) }

// Cleanup removes every temporary credential and CA file.
func (t *Temporary) Cleanup() error {
	if t == nil || t.dir == "" {
		return nil
	}
	err := os.RemoveAll(t.dir)
	t.dir = ""
	t.env = nil
	return err
}
