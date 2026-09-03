package service

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"path"
	"strings"

	"github.com/enact-ai/enact/server/internal/skillversion"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// The Lesson Learner: one agent per workspace, mounting one skill.
//
// It is provisioned the way the SDLC bundle is — embedded, versioned, and
// reconciled at boot — but separately, because the two ship on their own
// schedules and a workspace can legitimately be current on one and behind on
// the other.
//
// Why one dedicated agent rather than giving every agent the ability to file a
// lesson: the signal that justifies a rule is a pattern across runs — the same
// question asked twice, rework landing repeatedly in one place — and none of
// that is visible from inside a single run. An agent hired to do one job, asked
// to also judge whether its own run implies a durable rule, has neither the
// view nor the distance. Concentrating it here also means the standard for
// "worth a rule" is written once, in one skill, and can be raised or lowered in
// one place.

// LessonsDefaultsVersion is persisted per workspace after the Lesson Learner
// bundle has been provisioned. Bump it whenever the skill text or the agent's
// instructions change so existing deployments re-apply them.
const LessonsDefaultsVersion int32 = 1

const (
	lessonsSkillsRoot = "builtin_lessons/skills"
	// LessonsLearnerSystemKey must match handler.LessonLearnerSystemKey, which
	// is what the retrospective endpoint resolves the agent by. The display
	// name is owner-editable, so nothing may key off it.
	LessonsLearnerSystemKey = "lessons:learner"
	lessonsSkillName        = "enact-lessons"
)

//go:embed all:builtin_lessons/skills
var lessonsSkillsFS embed.FS

var lessonsLearnerAgent = SDLCAgentSpec{
	SystemKey:   LessonsLearnerSystemKey,
	Name:        "Lesson Learner",
	Description: "Reviews finished work and proposes changes to skills. Proposes only; a person approves.",
	AvatarURL:   "emoji:🔭",
	Instructions: "Use enact-lessons. Read work that is already finished and propose changes to the skills this workspace's agents run on. " +
		"File a lesson only for something you saw happen more than once, and only when you can state where it does not apply; " +
		"a proposal without a counterexample is not ready and will be refused. Read a skill immediately before proposing against it, " +
		"because a proposal names the version it was written against and a stale one is rejected. " +
		"Never approve, reject or withdraw a lesson, including your own — only a person decides, and the API will refuse your credentials. " +
		"Never edit a skill directly; that defeats the mechanism you exist to run. Do not change product code or issues. " +
		"Finding nothing worth filing is a normal outcome: say so plainly rather than filing something to have filed something. " +
		"Report what you filed and what you considered and rejected as a comment on the retrospective issue, then leave it open for a person.",
	SkillNames: []string{lessonsSkillName},
}

// LessonsLearnerAgentSpec exposes the shipped spec for tests and tooling.
func LessonsLearnerAgentSpec() SDLCAgentSpec { return lessonsLearnerAgent }

// LoadLessonsDefaultSkills reads the embedded bundle.
func LoadLessonsDefaultSkills() ([]AgentSkillData, error) {
	entries, err := fs.ReadDir(lessonsSkillsFS, lessonsSkillsRoot)
	if err != nil {
		return nil, err
	}
	skills := make([]AgentSkillData, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := path.Join(lessonsSkillsRoot, entry.Name())
		content, err := fs.ReadFile(lessonsSkillsFS, path.Join(dir, "SKILL.md"))
		if err != nil {
			return nil, fmt.Errorf("load %s/SKILL.md: %w", entry.Name(), err)
		}
		description, err := skillFrontmatterDescription(content)
		if err != nil {
			return nil, fmt.Errorf("load %s frontmatter: %w", entry.Name(), err)
		}
		skill := AgentSkillData{
			Name:        entry.Name(),
			Description: description,
			Content:     string(content),
		}
		err = fs.WalkDir(lessonsSkillsFS, dir, func(filePath string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil || d.IsDir() {
				return walkErr
			}
			rel := strings.TrimPrefix(filePath, dir+"/")
			if rel == "SKILL.md" {
				return nil
			}
			data, err := fs.ReadFile(lessonsSkillsFS, filePath)
			if err != nil {
				return err
			}
			skill.Files = append(skill.Files, AgentSkillFileData{Path: rel, Content: string(data)})
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("load %s files: %w", entry.Name(), err)
		}
		skills = append(skills, skill)
	}
	return skills, nil
}

func lessonsSkillConfig(name string) []byte {
	config, _ := json.Marshal(map[string]any{
		"origin": map[string]any{
			"type":    "enact_builtin_lessons",
			"key":     name,
			"version": LessonsDefaultsVersion,
		},
	})
	return config
}

func isManagedLessonsSkill(skill db.Skill) bool {
	var config struct {
		Origin struct {
			Type string `json:"type"`
			Key  string `json:"key"`
		} `json:"origin"`
	}
	return json.Unmarshal(skill.Config, &config) == nil &&
		config.Origin.Type == "enact_builtin_lessons" &&
		config.Origin.Key == skill.Name
}

// EnsureLessonsDefaultsInTx provisions the Lesson Learner into one workspace.
// The caller must pass transaction-scoped queries.
//
// It shares the SDLC advisory lock rather than taking its own: both provisioners
// write the same skill and agent tables in the same workspace, and two locks
// that protect overlapping rows protect nothing.
func EnsureLessonsDefaultsInTx(ctx context.Context, q *db.Queries, workspaceID, ownerID, runtimeID pgtype.UUID) error {
	if !workspaceID.Valid || !ownerID.Valid {
		return errors.New("workspace and owner are required")
	}
	if err := q.AcquireSDLCDefaultsLock(ctx, workspaceID); err != nil {
		return fmt.Errorf("lock workspace defaults: %w", err)
	}

	skills, err := LoadLessonsDefaultSkills()
	if err != nil {
		return err
	}
	skillIDs := make(map[string]pgtype.UUID, len(skills))
	for _, skill := range skills {
		row, err := q.GetSkillByWorkspaceAndName(ctx, db.GetSkillByWorkspaceAndNameParams{
			WorkspaceID: workspaceID,
			Name:        skill.Name,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			row, err = q.CreateSkill(ctx, db.CreateSkillParams{
				WorkspaceID: workspaceID,
				Name:        skill.Name,
				Description: skill.Description,
				Content:     skill.Content,
				Config:      lessonsSkillConfig(skill.Name),
				CreatedBy:   ownerID,
			})
		} else if err == nil {
			// A workspace that already has a skill by this name and did not get
			// it from us keeps it. Overwriting someone's own work because it
			// shares a name is the one failure a provisioner must never have.
			if !isManagedLessonsSkill(row) && strings.TrimSpace(row.Content) != strings.TrimSpace(skill.Content) {
				return fmt.Errorf("skill %q already exists with non-Enact content", skill.Name)
			}
			row, err = q.UpdateSkill(ctx, db.UpdateSkillParams{
				ID:          row.ID,
				Description: pgtype.Text{String: skill.Description, Valid: true},
				Content:     pgtype.Text{String: skill.Content, Valid: true},
				Config:      lessonsSkillConfig(skill.Name),
			})
		}
		if err != nil {
			return fmt.Errorf("upsert skill %s: %w", skill.Name, err)
		}
		if err := q.DeleteSkillFilesBySkill(ctx, row.ID); err != nil {
			return fmt.Errorf("replace files for %s: %w", skill.Name, err)
		}
		versionFiles := make([]skillversion.File, 0, len(skill.Files))
		for _, file := range skill.Files {
			if _, err := q.UpsertSkillFile(ctx, db.UpsertSkillFileParams{
				SkillID: row.ID,
				Path:    file.Path,
				Content: file.Content,
			}); err != nil {
				return fmt.Errorf("write %s/%s: %w", skill.Name, file.Path, err)
			}
			versionFiles = append(versionFiles, skillversion.File{Path: file.Path, Content: file.Content})
		}
		if _, _, err := skillversion.Record(ctx, q, skillversion.Input{
			Skill:   row,
			Files:   versionFiles,
			Source:  skillversion.SourceSeed,
			ActorID: ownerID,
			Summary: fmt.Sprintf("Provisioned by Enact (lessons bundle v%d)", LessonsDefaultsVersion),
		}); err != nil {
			return fmt.Errorf("record version for %s: %w", skill.Name, err)
		}
		skillIDs[skill.Name] = row.ID
	}

	spec := lessonsLearnerAgent
	agent, err := q.GetAgentBySystemKey(ctx, db.GetAgentBySystemKeyParams{
		WorkspaceID: workspaceID,
		SystemKey:   pgtype.Text{String: spec.SystemKey, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		agent, err = q.CreateSystemUserAgent(ctx, db.CreateSystemUserAgentParams{
			WorkspaceID:        workspaceID,
			Name:               spec.Name,
			Description:        spec.Description,
			AvatarUrl:          pgtype.Text{String: spec.AvatarURL, Valid: true},
			RuntimeMode:        "local",
			RuntimeID:          runtimeID,
			Visibility:         "workspace",
			PermissionMode:     "public_to",
			MaxConcurrentTasks: 1,
			OwnerID:            ownerID,
			SystemKey:          pgtype.Text{String: spec.SystemKey, Valid: true},
		})
	}
	if err != nil {
		return fmt.Errorf("find or create %s: %w", spec.Name, err)
	}
	// ApplySDLCDefaultAgent is the shared "re-assert the shipped description,
	// avatar, runtime and instructions" write. It is named for the bundle it
	// was written for, but it edits nothing bundle-specific.
	agent, err = q.ApplySDLCDefaultAgent(ctx, db.ApplySDLCDefaultAgentParams{
		ID:                 agent.ID,
		SystemKey:          pgtype.Text{String: spec.SystemKey, Valid: true},
		Name:               spec.Name,
		Description:        spec.Description,
		AvatarUrl:          pgtype.Text{String: spec.AvatarURL, Valid: true},
		RuntimeID:          runtimeID,
		LegacyInstructions: spec.Instructions,
	})
	if err != nil {
		return fmt.Errorf("apply %s: %w", spec.Name, err)
	}
	// Anyone in the workspace may ask for a retrospective, so the Learner is
	// invocable by the workspace.
	if err := q.CreateAgentInvocationTarget(ctx, db.CreateAgentInvocationTargetParams{
		AgentID:    agent.ID,
		TargetType: "workspace",
		TargetID:   workspaceID,
		CreatedBy:  ownerID,
	}); err != nil {
		return fmt.Errorf("grant workspace access to %s: %w", spec.Name, err)
	}
	for _, skillName := range spec.SkillNames {
		skillID, ok := skillIDs[skillName]
		if !ok {
			return fmt.Errorf("agent %s references unknown skill %s", spec.Name, skillName)
		}
		if err := q.AddAgentSkill(ctx, db.AddAgentSkillParams{AgentID: agent.ID, SkillID: skillID}); err != nil {
			return fmt.Errorf("bind %s to %s: %w", skillName, spec.Name, err)
		}
	}

	if err := q.SetWorkspaceLessonsDefaultsVersion(ctx, db.SetWorkspaceLessonsDefaultsVersionParams{
		ID:                     workspaceID,
		LessonsDefaultsVersion: LessonsDefaultsVersion,
	}); err != nil {
		return fmt.Errorf("mark lessons defaults version: %w", err)
	}
	return nil
}

// EnsureLessonsDefaultsForAllWorkspaces upgrades every workspace behind the
// embedded bundle. One conflicting workspace does not stop the rest from being
// repaired; callers receive an errors.Join summary to log.
func EnsureLessonsDefaultsForAllWorkspaces(ctx context.Context, txStarter SDLCTxStarter, q *db.Queries) error {
	targets, err := q.ListWorkspacesNeedingLessonsDefaults(ctx, LessonsDefaultsVersion)
	if err != nil {
		return fmt.Errorf("list workspaces needing lessons defaults: %w", err)
	}
	var failures []error
	for _, target := range targets {
		tx, err := txStarter.Begin(ctx)
		if err != nil {
			failures = append(failures, fmt.Errorf("workspace %v: begin: %w", target.WorkspaceID.Bytes, err))
			continue
		}
		qtx := q.WithTx(tx)
		err = EnsureLessonsDefaultsInTx(ctx, qtx, target.WorkspaceID, target.OwnerID, target.RuntimeID)
		if err == nil {
			err = tx.Commit(ctx)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			failures = append(failures, fmt.Errorf("workspace %v: %w", target.WorkspaceID.Bytes, err))
		}
	}
	return errors.Join(failures...)
}
