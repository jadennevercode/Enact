// The Ontologizer listings are the one bundle whose skills carry an executable
// package as supporting files, so they are the one bundle that can grow into
// the skill importer's caps. An installed copy is written to the runtime host
// by the same daemon path an imported archive takes, which is why the caps
// checked here are the importer's own constants rather than numbers repeated.
//
// What the bundle must *contain* is asserted in internal/service, next to the
// loader; this file is only about size. Like marketplace_sanitize_test.go it
// touches no database — the bundle is read from the embedded filesystem.
package handler

import (
	"testing"

	"github.com/enact-ai/enact/server/internal/service"
)

func TestOntologizerSkillsStayWithinSkillImportCaps(t *testing.T) {
	skills, err := service.LoadOntologizerDefaultSkills()
	if err != nil {
		t.Fatalf("load bundle: %v", err)
	}
	if len(skills) == 0 {
		t.Fatal("bundle is empty")
	}

	for _, skill := range skills {
		var total int
		for _, f := range skill.Files {
			if len(f.Content) > maxImportFileSize {
				t.Errorf("%s: %s is %d bytes, over the %d-byte per-file cap",
					skill.Name, f.Path, len(f.Content), maxImportFileSize)
			}
			total += len(f.Content)
		}
		if len(skill.Files) > maxImportFileCount {
			t.Errorf("%s ships %d files, over the %d-file cap",
				skill.Name, len(skill.Files), maxImportFileCount)
		}
		if total > maxImportTotalSize {
			t.Errorf("%s ships %d bytes, over the %d-byte bundle cap",
				skill.Name, total, maxImportTotalSize)
		}
	}
}
