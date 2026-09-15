package codegraph

import "testing"

func TestNormalizeRepoURL(t *testing.T) {
	cases := map[string]string{
		"https://github.com/Acme/Backend.git":    "github.com/Acme/Backend",
		"https://GitHub.com/acme/backend/":       "github.com/acme/backend",
		"git@github.com:acme/backend.git":        "github.com/acme/backend",
		"ssh://git@github.com/acme/backend":      "github.com/acme/backend",
		"http://gitlab.example.com:8443/g/r.git": "gitlab.example.com/g/r",
		"not a url":                              "",
		"":                                       "",
	}
	for in, want := range cases {
		if got := NormalizeRepoURL(in); got != want {
			t.Errorf("NormalizeRepoURL(%q) = %q, want %q", in, got, want)
		}
	}
	host, owner, repo, ok := SplitOwnerRepo("github.com/acme/backend")
	if !ok || host != "github.com" || owner != "acme" || repo != "backend" {
		t.Fatalf("SplitOwnerRepo = %q %q %q %v", host, owner, repo, ok)
	}
	if _, _, _, ok := SplitOwnerRepo("gitlab.example.com/group/sub/repo"); ok {
		t.Fatal("nested group path must not split as owner/repo")
	}
}
