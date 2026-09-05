// Package skillversion appends immutable snapshots of a skill's content.
//
// It exists as its own package because both the HTTP handlers and the
// workspace-seeding service write skills, and a snapshot that only some write
// paths take is worse than none: the version list would show a history with
// silent gaps, and a rollback offered against "the current version" could
// restore text that was never recorded.
//
// Every function here takes a *db.Queries the caller has already bound to a
// transaction. Recording a version outside the transaction that changed the
// skill would leave the two able to disagree.
package skillversion

import (
	"context"
	"encoding/json"
	"errors"
	"sort"

	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/skillbundle"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Sources a version can come from. These mirror the CHECK constraint in
// migration 420 as amended by migration 440; adding one here without adding it
// there fails at write time.
const (
	SourceManual  = "manual"
	SourceImport  = "import"
	SourceRefresh = "refresh"
	// SourceRetrospect marks a version a Retrospect Agent wrote. It is what
	// makes an edit nobody typed legible in the version list, and what the
	// rollback affordance is for.
	SourceRetrospect = "retrospect"
	SourceRollback   = "rollback"
	SourceSeed       = "seed"
)

// File is one supporting file in a snapshot. Mirrors the JSONB shape stored in
// skill_version.files.
type File struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// Input is one snapshot to record. Skill carries the state that was just
// written; Files is the complete supporting file set at that moment, not a
// delta.
type Input struct {
	Skill   db.Skill
	Files   []File
	Source  string
	ActorID pgtype.UUID
	Summary string
}

// Record appends a snapshot of the skill and points skill.current_version_id at
// it. It returns the version now current and whether a new row was written.
//
// A write whose content matches the current version is not recorded: skill
// updates arrive from PATCH bodies that resend unchanged fields, from imports
// that re-fetch identical upstream text, and from label and file operations
// that touch the row without changing what it says. Recording those would bury
// the versions that mean something under versions that mean nothing.
//
// The comparison fails closed. A current version whose content_hash is empty —
// the rows migration 420 backfilled, which could not reproduce the Go
// construction in SQL — is treated as different, so the next real write
// snapshots rather than assuming.
func Record(ctx context.Context, q *db.Queries, input Input) (db.SkillVersion, bool, error) {
	if input.Source == "" {
		input.Source = SourceManual
	}

	files := append([]File(nil), input.Files...)
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })

	hash := skillbundle.ContentHash(
		input.Skill.Name,
		input.Skill.Description,
		input.Skill.Content,
		toBundleFiles(files),
	)

	if current, ok, err := currentVersion(ctx, q, input.Skill); err != nil {
		return db.SkillVersion{}, false, err
	} else if ok && current.ContentHash != "" && current.ContentHash == hash {
		return current, false, nil
	}

	encoded, err := json.Marshal(files)
	if err != nil {
		return db.SkillVersion{}, false, err
	}
	if len(files) == 0 {
		encoded = []byte("[]")
	}

	next, err := q.NextSkillVersionNumber(ctx, input.Skill.ID)
	if err != nil {
		return db.SkillVersion{}, false, err
	}

	version, err := q.CreateSkillVersion(ctx, db.CreateSkillVersionParams{
		SkillID:     input.Skill.ID,
		WorkspaceID: input.Skill.WorkspaceID,
		Version:     int32(next),
		Name:        input.Skill.Name,
		Description: input.Skill.Description,
		Content:     input.Skill.Content,
		Config:      input.Skill.Config,
		Files:       encoded,
		ContentHash: hash,
		Source:      input.Source,
		CreatedBy:   input.ActorID,
		Summary:     input.Summary,
	})
	if err != nil {
		return db.SkillVersion{}, false, err
	}

	if err := q.SetSkillCurrentVersion(ctx, db.SetSkillCurrentVersionParams{
		ID:               input.Skill.ID,
		CurrentVersionID: version.ID,
	}); err != nil {
		return db.SkillVersion{}, false, err
	}

	return version, true, nil
}

// Current returns the skill's current snapshot, if it has one. A skill created
// before version history existed and never written to since has none.
func Current(ctx context.Context, q *db.Queries, skill db.Skill) (db.SkillVersion, bool, error) {
	return currentVersion(ctx, q, skill)
}

func currentVersion(ctx context.Context, q *db.Queries, skill db.Skill) (db.SkillVersion, bool, error) {
	if !skill.CurrentVersionID.Valid {
		return db.SkillVersion{}, false, nil
	}
	version, err := q.GetSkillVersion(ctx, skill.CurrentVersionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.SkillVersion{}, false, nil
		}
		return db.SkillVersion{}, false, err
	}
	return version, true, nil
}

// DecodeFiles reads the file set out of a stored snapshot. A snapshot whose
// files column is unreadable yields no files rather than an error: the column
// is written by this package and a caller that cannot show supporting files
// should still be able to show the version.
func DecodeFiles(raw []byte) []File {
	if len(raw) == 0 {
		return nil
	}
	var files []File
	if err := json.Unmarshal(raw, &files); err != nil {
		return nil
	}
	return files
}

// FilesFromRows converts sqlc skill_file rows into snapshot files.
func FilesFromRows(rows []db.SkillFile) []File {
	files := make([]File, 0, len(rows))
	for _, row := range rows {
		files = append(files, File{Path: row.Path, Content: row.Content})
	}
	return files
}

func toBundleFiles(files []File) []skillbundle.File {
	out := make([]skillbundle.File, 0, len(files))
	for _, f := range files {
		out = append(out, skillbundle.File{Path: f.Path, Content: f.Content})
	}
	return out
}
