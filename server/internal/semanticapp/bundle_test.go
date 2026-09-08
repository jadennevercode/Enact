package semanticapp

import (
	"encoding/base64"
	"testing"
)

func TestValidateApplicationBuild(t *testing.T) {
	valid := func() Build {
		files := map[string]string{"package.json": base64.StdEncoding.EncodeToString([]byte(`{"scripts":{"build":"test"}}`))}
		digest, _ := SourceDigest(files)
		return Build{SourceFiles: files, SourceRevision: digest, Manifest: Manifest{Version: 1, Entry: "index.html", OntologyReleaseID: "r1"}, Files: map[string]File{"index.html": {Content: base64.StdEncoding.EncodeToString([]byte("<div id=\"root\"></div>")), MediaType: "text/html"}}}
	}
	b := valid()
	a, err := Validate(b, "r1")
	if err != nil || a == "" {
		t.Fatal(a, err)
	}
	b.Files["index.html"] = File{Content: base64.StdEncoding.EncodeToString([]byte("changed")), MediaType: "text/html"}
	c, _ := Validate(b, "r1")
	if a == c {
		t.Fatal("modified build retained digest")
	}
	for _, name := range []string{"../escape.js", "/absolute.js", "assets/../../escape.js", "assets\\escape.js", "https://external/script.js"} {
		b = valid()
		b.Files[name] = File{Content: "", MediaType: "text/javascript"}
		if _, err := Validate(b, "r1"); err == nil {
			t.Fatalf("accepted %s", name)
		}
	}
	b = valid()
	if _, err := Validate(b, "other-release"); err == nil {
		t.Fatal("accepted release mismatch")
	}
	b = valid()
	b.Manifest.Actions = []string{"freeze", "freeze"}
	if _, err := Validate(b, "r1"); err == nil {
		t.Fatal("accepted duplicate capability")
	}
}

func TestSourceSnapshotRejectsCredentialFiles(t *testing.T) {
	for _, name := range []string{".npmrc", "nested/.netrc", ".pypirc", ".ssh/key", ".codex/config.toml", ".agents/credentials", ".env.local"} {
		files := map[string]string{"package.json": base64.StdEncoding.EncodeToString([]byte(`{}`)), name: base64.StdEncoding.EncodeToString([]byte("credential"))}
		if _, err := SourceDigest(files); err == nil {
			t.Fatalf("accepted credential path %s", name)
		}
	}
}
