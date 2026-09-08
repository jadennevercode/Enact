// Package semanticapp validates immutable, self-contained application builds.
package semanticapp

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strings"
)

const MaxBundleBytes = 24 << 20

type Manifest struct {
	Version           int      `json:"version"`
	Entry             string   `json:"entry"`
	OntologyReleaseID string   `json:"ontology_release_id"`
	Queries           []string `json:"queries"`
	Actions           []string `json:"actions"`
}
type File struct {
	Content   string `json:"content"`
	MediaType string `json:"media_type"`
}
type Build struct {
	SourceFiles    map[string]string `json:"source_files"`
	SourceRevision string            `json:"source_revision"`
	Manifest       Manifest          `json:"manifest"`
	Files          map[string]File   `json:"files"`
	Report         map[string]any    `json:"report"`
}

// Validate checks a build independently of any claims in its build report.
// Reports remain author-supplied evidence for the human publication review.
func Validate(build Build, releaseID string) (string, error) {
	if build.SourceRevision == "" || len(build.SourceRevision) > 200 {
		return "", errors.New("source_revision is required (maximum 200 characters)")
	}
	if build.Manifest.Version != 1 || build.Manifest.Entry != "index.html" {
		return "", errors.New("manifest version 1 and index.html entry are required")
	}
	if build.Manifest.OntologyReleaseID != releaseID {
		return "", errors.New("build must use the application's pinned ontology release")
	}
	if len(build.Files) == 0 || len(build.Files) > 512 {
		return "", errors.New("build must contain 1 to 512 files")
	}
	if len(build.SourceFiles) == 0 {
		return "", errors.New("source_files are required for a reproducible application revision")
	}
	sourceHash, err := SourceDigest(build.SourceFiles)
	if err != nil {
		return "", err
	}
	if sourceHash != build.SourceRevision {
		return "", errors.New("source_revision does not match source_files")
	}
	total := 0
	for name, file := range build.Files {
		if name == "" || path.Clean(name) != name || strings.HasPrefix(name, "/") || strings.HasPrefix(name, ".") || strings.ContainsAny(name, "\\?#:") || strings.Contains(name, "../") {
			return "", fmt.Errorf("invalid asset path %q", name)
		}
		data, err := base64.StdEncoding.Strict().DecodeString(file.Content)
		if err != nil {
			return "", fmt.Errorf("invalid base64 for %s", name)
		}
		total += len(data)
		if total > MaxBundleBytes {
			return "", errors.New("build exceeds 24 MiB")
		}
		switch file.MediaType {
		case "text/html", "text/javascript", "application/javascript", "text/css", "image/png", "image/jpeg", "image/webp", "image/svg+xml", "font/woff2", "application/json":
		default:
			return "", fmt.Errorf("unsupported asset type for %s", name)
		}
	}
	entry, ok := build.Files[build.Manifest.Entry]
	if !ok || entry.MediaType != "text/html" {
		return "", errors.New("index.html is missing")
	}
	for _, ids := range [][]string{build.Manifest.Queries, build.Manifest.Actions} {
		seen := map[string]bool{}
		for _, id := range ids {
			if strings.TrimSpace(id) == "" || seen[id] {
				return "", errors.New("capability IDs must be non-empty and unique")
			}
			seen[id] = true
		}
	}
	encoded, err := json.Marshal(build)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

// SourceDigest verifies and identifies the exact source snapshot, including its lockfile.
func SourceDigest(files map[string]string) (string, error) {
	hashes := map[string]string{}
	total := 0
	for name, encoded := range files {
		if name == "" || path.Clean(name) != name || strings.HasPrefix(name, "/") || strings.Contains(name, "../") || strings.ContainsAny(name, "\\?#:") {
			return "", errors.New("invalid source path")
		}
		for _, part := range strings.Split(name, "/") {
			if strings.HasPrefix(part, ".env") || part == ".git" || part == "node_modules" || part == ".npmrc" || part == ".netrc" || part == ".pypirc" || part == ".ssh" || part == ".codex" || part == ".agents" {
				return "", errors.New("source snapshot contains private or generated files")
			}
		}
		raw, err := base64.StdEncoding.Strict().DecodeString(encoded)
		if err != nil {
			return "", errors.New("invalid source encoding")
		}
		total += len(raw)
		if total > 32<<20 {
			return "", errors.New("source exceeds 32 MiB")
		}
		sum := sha256.Sum256(raw)
		hashes[name] = hex.EncodeToString(sum[:])
	}
	if _, ok := files["package.json"]; !ok {
		return "", errors.New("source snapshot requires package.json")
	}
	raw, err := json.Marshal(hashes)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}
