package handler

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

// The AI-SDLC preset and the suite's own role vocabulary are one contract seen
// from two sides: the preset CREATES the roles, and the suite's scripts RESOLVE
// reviewers by their keys. A key renamed on one side and not the other leaves
// every gate unstaffed, which shows up as "nobody can sign this" long after the
// change that caused it.
//
// Reads the shipped script rather than duplicating the list, so the test fails
// on the drift itself instead of on a third copy of the truth.
func TestAISDLCPresetMatchesSuiteRoleKeys(t *testing.T) {
	path := filepath.Join("..", "service", "builtin_sdlc", "skills", "sdlc-core", "scripts", "_common.py")
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read suite role vocabulary: %v", err)
	}

	block := regexp.MustCompile(`(?s)TEAM_ROLE_KEYS\s*=\s*\{(.*?)\}`).FindSubmatch(source)
	if block == nil {
		t.Fatal("TEAM_ROLE_KEYS not found in _common.py; the suite resolves reviewers by these keys")
	}
	suiteKeys := map[string]struct{}{}
	for _, match := range regexp.MustCompile(`"([a-z0-9_]+)"\s*,`).FindAllSubmatch(block[1], -1) {
		suiteKeys[string(match[1])] = struct{}{}
	}
	if len(suiteKeys) == 0 {
		t.Fatal("parsed no keys out of TEAM_ROLE_KEYS")
	}

	presetKeys := map[string]struct{}{}
	for _, entry := range teamRolePresets["aisdlc"] {
		presetKeys[entry.Key] = struct{}{}
	}

	for key := range suiteKeys {
		if _, ok := presetKeys[key]; !ok {
			t.Errorf("suite routes reviews to %q but the aisdlc preset never creates it", key)
		}
	}
	for key := range presetKeys {
		if _, ok := suiteKeys[key]; !ok {
			t.Errorf("preset creates %q but the suite never routes anything to it", key)
		}
	}
}

// Every preset entry must be complete in every language the product ships, or
// an admin importing in their own locale gets a blank role name.
func TestTeamRolePresetsAreFullyLocalized(t *testing.T) {
	for preset, entries := range teamRolePresets {
		for _, entry := range entries {
			for _, locale := range []string{"en", "zh-hans", "ja", "ko"} {
				name, description := entry.localized(locale)
				if name == "" {
					t.Errorf("%s/%s has no name in %s", preset, entry.Key, locale)
				}
				if description == "" {
					t.Errorf("%s/%s has no description in %s", preset, entry.Key, locale)
				}
			}
			// An unknown locale must still produce a usable role rather than a
			// blank row: the header is whatever the browser sent.
			if name, _ := entry.localized("pt-BR"); name == "" {
				t.Errorf("%s/%s falls back to an empty name for an unknown locale", preset, entry.Key)
			}
		}
	}
}
