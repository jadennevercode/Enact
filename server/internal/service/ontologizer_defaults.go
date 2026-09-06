package service

// Provisioning the Ontologizer bundle into a workspace.
//
// The bundle is the mirror image of the SDLC one, with two differences that
// come from where its content is authored.
//
// The skills are written in the Ontologizer repository, which owns them along
// with the validators and the knowledge base, and are vendored in here by
// scripts/sync-ontologizer-skills.sh. A published listing has to ship the bytes
// it installs, so the catalog needs a copy of them; a runtime still loads them
// from its own checkout through the Claude Code plugin, which is why the skill
// names carry the plugin's "ontologizer:" invocation-key namespace — the copy
// and the plugin's own import are the same skill, not two.
//
// The skills are prose that shells out to the package's scripts, so a listing
// that shipped only the prose would install instructions naming commands the
// runtime host does not have. The package (scripts/, shared/, tools/,
// knowledge/) is vendored once under runtime/ and attached to every skill at
// load time: the daemon writes a skill's files into the skill's own directory
// on the runtime host, so each installed skill directory is a complete package
// and the SKILL.md locator rule finds it there. That is possible because
// Ontologizer is standard-library Python with no install step; a package with
// compiled dependencies could not travel this way.
//
// The agent prompts come from internal/ontologizer, the same portfolio
// `enact ontologizer agent bootstrap` applies, so a workspace that installs the
// family from the Marketplace and a workspace that ran the CLI end up with the
// same five roles. Unlike the SDLC agents these carry their prompt in the agent
// row rather than in the system-instruction layer: the portfolio is the CLI's
// to apply against any deployment, and a prompt that only exists inside one
// server binary could not reach a workspace that bootstrapped itself.

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"strings"

	"github.com/enact-ai/enact/server/internal/ontologizer"
	"github.com/enact-ai/enact/server/internal/skillversion"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	ontologizerSkillsRoot  = "builtin_ontologizer/skills"
	ontologizerRuntimeRoot = "builtin_ontologizer/runtime"
	// OntologizerSquadSystemKey identifies the Agent Family across renames.
	OntologizerSquadSystemKey = "ontology:construction"
)

//go:embed all:builtin_ontologizer/skills all:builtin_ontologizer/runtime
var ontologizerBundleFS embed.FS

// ontologizerAgentIdentity is the stable server-side identity for one portfolio
// role: the key that survives a display-name change, and the role label the
// family shows beside the member.
//
// It lives here rather than in internal/portfolio because a system key is an
// Enact object identity and that package deliberately knows nothing about Enact.
// Keyed by the portfolio's own name constants so a rename upstream is a compile
// error here rather than a second agent in every catalog.
type ontologizerAgentIdentity struct {
	SystemKey string
	SquadRole string
}

var ontologizerAgentIdentities = map[string]ontologizerAgentIdentity{
	ontologizer.AgentNameOrchestrator:   {SystemKey: "ontology:orchestrator", SquadRole: "leader"},
	ontologizer.AgentNameDomainAnalyst:  {SystemKey: "ontology:domain-analyst", SquadRole: "Define：章程、证据与访谈"},
	ontologizer.AgentNameEngineer:       {SystemKey: "ontology:engineer", SquadRole: "Generate：生成与修订 revision"},
	ontologizer.AgentNameReviewer:       {SystemKey: "ontology:reviewer", SquadRole: "Review：四层审阅与胜任问题评估"},
	ontologizer.AgentNameReleaseSteward: {SystemKey: "ontology:release-steward", SquadRole: "Release：提交治理与打包"},
}

// LoadOntologizerDefaultSkills reads the vendored bundle. Names carry the
// plugin's invocation-key namespace so they match ontologizer.RuntimeSkillNames.
// Every skill carries the whole runtime package as supporting files; see the
// package comment for why.
func LoadOntologizerDefaultSkills() ([]AgentSkillData, error) {
	skills, err := loadBundledSkills(ontologizerBundleFS, ontologizerSkillsRoot, ontologizer.SkillPrefix)
	if err != nil {
		return nil, err
	}
	runtime, err := loadOntologizerRuntimeFiles()
	if err != nil {
		return nil, err
	}
	for i := range skills {
		skills[i].Files = append(skills[i].Files, runtime...)
	}
	return skills, nil
}

// loadOntologizerRuntimeFiles reads runtime/ as skill files whose paths are
// relative to the package root, so `scripts/state.py` in the checkout lands at
// `scripts/state.py` under the installed skill directory.
func loadOntologizerRuntimeFiles() ([]AgentSkillFileData, error) {
	var files []AgentSkillFileData
	err := fs.WalkDir(ontologizerBundleFS, ontologizerRuntimeRoot, func(filePath string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil || d.IsDir() {
			return walkErr
		}
		data, err := fs.ReadFile(ontologizerBundleFS, filePath)
		if err != nil {
			return err
		}
		files = append(files, AgentSkillFileData{
			Path:    strings.TrimPrefix(filePath, ontologizerRuntimeRoot+"/"),
			Content: string(data),
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("load ontologizer runtime: %w", err)
	}
	if len(files) == 0 {
		return nil, errors.New("load ontologizer runtime: no files under " + ontologizerRuntimeRoot)
	}
	return files, nil
}

func ontologizerSkillConfig(name string) []byte {
	config, _ := json.Marshal(map[string]any{
		"origin": map[string]any{
			"type":    OntologizerSkillOrigin,
			"key":     name,
			"version": CatalogVersion,
		},
	})
	return config
}

// OntologizerSkillOrigin marks a skill row this bundle wrote. The catalog
// publisher reads it to tell which bundle a listing belongs to.
const OntologizerSkillOrigin = "enact_builtin_ontologizer"

// OntologizerSystemKeyPrefix namespaces every agent and family this bundle
// provisions, and is what the catalog publisher groups them by.
const OntologizerSystemKeyPrefix = "ontology:"

// EnsureOntologizerDefaultsInTx provisions the bundle into one workspace. The
// caller must pass transaction-scoped queries and hold the concurrency guard
// for that workspace; the catalog seeder's advisory lock is what serves that
// role today.
//
// Idempotent: re-running converges the product-owned fields and adds a skill
// version only when the shipped bytes actually moved.
func EnsureOntologizerDefaultsInTx(ctx context.Context, q *db.Queries, workspaceID, ownerID, runtimeID pgtype.UUID) error {
	if !workspaceID.Valid || !ownerID.Valid {
		return errors.New("workspace and owner are required")
	}
	manifest := ontologizer.DefaultAgentManifest()

	skillIDs, err := ensureOntologizerSkills(ctx, q, workspaceID, ownerID)
	if err != nil {
		return err
	}
	agentIDs, err := ensureOntologizerAgents(ctx, q, workspaceID, ownerID, runtimeID, manifest, skillIDs)
	if err != nil {
		return err
	}
	return ensureOntologizerSquad(ctx, q, workspaceID, ownerID, manifest, agentIDs)
}

func ensureOntologizerSkills(
	ctx context.Context, q *db.Queries, workspaceID, ownerID pgtype.UUID,
) (map[string]pgtype.UUID, error) {
	skills, err := LoadOntologizerDefaultSkills()
	if err != nil {
		return nil, err
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
				Config:      ontologizerSkillConfig(skill.Name),
				CreatedBy:   ownerID,
			})
		} else if err == nil {
			// A workspace that imported the same skill from its own runtime
			// checkout holds the identical content under the identical name.
			// Converging that row is right; silently overwriting somebody's
			// unrelated "ontologizer:review" is not.
			if !isManagedOntologizerSkill(row) && strings.TrimSpace(row.Content) != strings.TrimSpace(skill.Content) {
				return nil, fmt.Errorf("skill %q already exists with non-Ontologizer content", skill.Name)
			}
			row, err = q.UpdateSkill(ctx, db.UpdateSkillParams{
				ID:          row.ID,
				Description: pgtype.Text{String: skill.Description, Valid: true},
				Content:     pgtype.Text{String: skill.Content, Valid: true},
				Config:      ontologizerSkillConfig(skill.Name),
			})
		}
		if err != nil {
			return nil, fmt.Errorf("upsert skill %s: %w", skill.Name, err)
		}
		if err := q.DeleteSkillFilesBySkill(ctx, row.ID); err != nil {
			return nil, fmt.Errorf("replace files for %s: %w", skill.Name, err)
		}
		versionFiles := make([]skillversion.File, 0, len(skill.Files))
		for _, file := range skill.Files {
			if _, err := q.UpsertSkillFile(ctx, db.UpsertSkillFileParams{
				SkillID: row.ID,
				Path:    file.Path,
				Content: file.Content,
			}); err != nil {
				return nil, fmt.Errorf("write %s/%s: %w", skill.Name, file.Path, err)
			}
			versionFiles = append(versionFiles, skillversion.File{Path: file.Path, Content: file.Content})
		}
		if _, _, err := skillversion.Record(ctx, q, skillversion.Input{
			Skill:   row,
			Files:   versionFiles,
			Source:  skillversion.SourceSeed,
			ActorID: ownerID,
			Summary: "Provisioned by Enact (catalog " + CatalogVersion + ")",
		}); err != nil {
			return nil, fmt.Errorf("record version for %s: %w", skill.Name, err)
		}
		skillIDs[skill.Name] = row.ID
	}
	return skillIDs, nil
}

func isManagedOntologizerSkill(skill db.Skill) bool {
	var config struct {
		Origin struct {
			Type string `json:"type"`
			Key  string `json:"key"`
		} `json:"origin"`
	}
	return json.Unmarshal(skill.Config, &config) == nil &&
		config.Origin.Type == OntologizerSkillOrigin &&
		config.Origin.Key == skill.Name
}

func ensureOntologizerAgents(
	ctx context.Context,
	q *db.Queries,
	workspaceID, ownerID, runtimeID pgtype.UUID,
	manifest ontologizer.AgentManifest,
	skillIDs map[string]pgtype.UUID,
) (map[string]pgtype.UUID, error) {
	agentIDs := make(map[string]pgtype.UUID, len(manifest.Agents))
	for _, spec := range manifest.Agents {
		identity, ok := ontologizerAgentIdentities[spec.Name]
		if !ok {
			return nil, fmt.Errorf("portfolio agent %q has no system key", spec.Name)
		}
		systemKey := pgtype.Text{String: identity.SystemKey, Valid: true}
		avatar := pgtype.Text{}

		agent, err := q.GetAgentBySystemKeyIncludingArchived(ctx, db.GetAgentBySystemKeyIncludingArchivedParams{
			WorkspaceID: workspaceID,
			SystemKey:   systemKey,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			agent, err = q.CreateSystemUserAgent(ctx, db.CreateSystemUserAgentParams{
				WorkspaceID:        workspaceID,
				Name:               spec.Name,
				Description:        spec.Description,
				AvatarUrl:          avatar,
				RuntimeMode:        "local",
				RuntimeID:          runtimeID,
				Visibility:         "workspace",
				PermissionMode:     "public_to",
				MaxConcurrentTasks: int32(spec.MaxConcurrentTasks),
				OwnerID:            ownerID,
				SystemKey:          systemKey,
			})
			if err != nil {
				return nil, fmt.Errorf("create agent %s: %w", spec.Name, err)
			}
		} else if err != nil {
			return nil, fmt.Errorf("find agent %s: %w", spec.Name, err)
		} else if agent.ArchivedAt.Valid {
			if agent, err = q.RestoreAgent(ctx, agent.ID); err != nil {
				return nil, fmt.Errorf("restore agent %s: %w", spec.Name, err)
			}
		}

		// Product-owned fields converge to the portfolio. The runtime binding is
		// preserved once a workspace has chosen one — an agent template names no
		// machine, and publishing strips the binding anyway.
		agent, err = q.UpdateAgent(ctx, db.UpdateAgentParams{
			ID:                 agent.ID,
			Name:               pgtype.Text{String: spec.Name, Valid: true},
			Description:        pgtype.Text{String: spec.Description, Valid: true},
			Instructions:       pgtype.Text{String: spec.Instructions, Valid: true},
			MaxConcurrentTasks: pgtype.Int4{Int32: int32(spec.MaxConcurrentTasks), Valid: spec.MaxConcurrentTasks > 0},
			Visibility:         pgtype.Text{String: "workspace", Valid: true},
			PermissionMode:     pgtype.Text{String: "public_to", Valid: true},
			RuntimeID:          runtimeID,
		})
		if err != nil {
			return nil, fmt.Errorf("apply agent %s: %w", spec.Name, err)
		}
		if err := q.CreateAgentInvocationTarget(ctx, db.CreateAgentInvocationTargetParams{
			AgentID:    agent.ID,
			TargetType: "workspace",
			TargetID:   workspaceID,
			CreatedBy:  ownerID,
		}); err != nil {
			return nil, fmt.Errorf("grant workspace access to %s: %w", spec.Name, err)
		}
		for _, skillName := range spec.SkillNames {
			skillID, ok := skillIDs[skillName]
			if !ok {
				return nil, fmt.Errorf("agent %s references unknown skill %s", spec.Name, skillName)
			}
			if err := q.AddAgentSkill(ctx, db.AddAgentSkillParams{AgentID: agent.ID, SkillID: skillID}); err != nil {
				return nil, fmt.Errorf("bind %s to %s: %w", skillName, spec.Name, err)
			}
		}
		agentIDs[spec.Name] = agent.ID
	}
	return agentIDs, nil
}

func ensureOntologizerSquad(
	ctx context.Context,
	q *db.Queries,
	workspaceID, ownerID pgtype.UUID,
	manifest ontologizer.AgentManifest,
	agentIDs map[string]pgtype.UUID,
) error {
	spec := manifest.Squad
	leaderID, ok := agentIDs[spec.LeaderName]
	if !ok {
		return fmt.Errorf("family leader %q is not one of its members", spec.LeaderName)
	}
	systemKey := pgtype.Text{String: OntologizerSquadSystemKey, Valid: true}

	squad, err := q.FindProductSquadForUpdate(ctx, db.FindProductSquadForUpdateParams{
		WorkspaceID: workspaceID,
		SystemKey:   systemKey,
		DefaultName: spec.Name,
		LeaderID:    leaderID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		squad, err = q.CreateSquad(ctx, db.CreateSquadParams{
			WorkspaceID: workspaceID,
			Name:        spec.Name,
			Description: spec.Description,
			LeaderID:    leaderID,
			CreatorID:   ownerID,
			SystemKey:   systemKey,
		})
	}
	if err != nil {
		return fmt.Errorf("find or create Ontologizer family: %w", err)
	}
	if squad.ArchivedAt.Valid {
		if squad, err = q.RestoreSquad(ctx, squad.ID); err != nil {
			return fmt.Errorf("restore Ontologizer family: %w", err)
		}
	}
	squad, err = q.UpdateSquad(ctx, db.UpdateSquadParams{
		ID:           squad.ID,
		Name:         pgtype.Text{String: spec.Name, Valid: true},
		Description:  pgtype.Text{String: spec.Description, Valid: true},
		LeaderID:     leaderID,
		Instructions: pgtype.Text{String: spec.Instructions, Valid: true},
		SystemKey:    systemKey,
	})
	if err != nil {
		return fmt.Errorf("apply Ontologizer family: %w", err)
	}
	for _, name := range spec.MemberNames {
		memberID, ok := agentIDs[name]
		if !ok {
			return fmt.Errorf("family member %q was not provisioned", name)
		}
		role := ontologizerAgentIdentities[name].SquadRole
		present, err := q.IsSquadMember(ctx, db.IsSquadMemberParams{
			SquadID:    squad.ID,
			MemberType: "agent",
			MemberID:   memberID,
		})
		if err != nil {
			return fmt.Errorf("check family member %s: %w", name, err)
		}
		if present {
			_, err = q.UpdateSquadMemberRole(ctx, db.UpdateSquadMemberRoleParams{
				SquadID:    squad.ID,
				MemberType: "agent",
				MemberID:   memberID,
				Role:       role,
			})
		} else {
			_, err = q.AddSquadMember(ctx, db.AddSquadMemberParams{
				SquadID:    squad.ID,
				MemberType: "agent",
				MemberID:   memberID,
				Role:       role,
			})
		}
		if err != nil {
			return fmt.Errorf("upsert family member %s: %w", name, err)
		}
	}
	return nil
}
