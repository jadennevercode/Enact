package skillbundle

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
)

// ContentHash digests what a skill says, ignoring which skill is saying it.
//
// BuildManifest already hashes a skill, but it folds the skill's id and source
// into the digest because its job is cache identity on the daemon: two skills
// with identical text are still two different things to materialise. Version
// history asks the opposite question — did this skill's text change — and for
// that the id is noise. Hashing it would make every snapshot unique and the
// no-op check useless.
//
// The construction is the same length-prefixed framing BuildManifest uses, so
// no pair of distinct field values can collide by running together, and files
// are sorted by path so file ordering is not part of the answer.
//
// An empty result is never returned: callers compare against stored hashes
// where the empty string means "not computed" (rows written by the migration
// that introduced version history) and must fail closed on it.
func ContentHash(name, description, content string, files []File) string {
	sorted := append([]File(nil), files...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Path < sorted[j].Path })

	h := sha256.New()
	writeHashPart(h, "content-v1")
	writeHashPart(h, name)
	writeHashPart(h, description)
	writeHashPart(h, content)
	for _, file := range sorted {
		writeHashPart(h, file.Path)
		writeHashPart(h, file.Content)
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil))
}
