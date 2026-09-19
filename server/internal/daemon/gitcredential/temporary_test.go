package gitcredential

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTemporaryCredentialFilesArePrivateAndRemoved(t *testing.T) {
	const token = "glpat-secret-value"
	temporary, err := New("https://gitlab.example/acme/service.git", "oauth2", token, "test-ca")
	if err != nil {
		t.Fatal(err)
	}
	dir := temporary.dir
	for _, name := range []string{"credentials", "gitconfig", "ca.pem"} {
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("%s mode = %o, want 0600", name, info.Mode().Perm())
		}
	}
	for _, value := range temporary.Env() {
		if strings.Contains(value, token) {
			t.Fatal("token leaked into Git environment")
		}
	}
	if err := temporary.Cleanup(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("credential directory still exists: %v", err)
	}
}

func TestTemporaryRejectsNonHTTPSRepository(t *testing.T) {
	if _, err := New("ssh://git@gitlab.example/acme/service.git", "oauth2", "secret", ""); err == nil {
		t.Fatal("expected non-HTTPS URL to be rejected")
	}
}
