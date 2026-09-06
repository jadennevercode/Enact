package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/enact-ai/enact/server/internal/skillversion"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// The catalog workspace.
//
// Marketplace listings belong to a workspace — the schema has no notion of a
// listing the deployment itself published, and browse resolves a publisher name
// for every row. So the product's own catalog needs a workspace to stand
// behind it, and this is it: one workspace per deployment, holding the product's
// own bundles as ordinary skills, agents and families, published as public
// listings that every other workspace can install.
//
// Two bundles live here: SDLC and Ontologizer. MMM was considered and left out:
// its skills are prose that shells out to a Python analysis engine and a Node
// report generator installed on the runtime host, so a copied listing would
// arrive describing commands the installing machine does not have, and there is
// no supported way to put them there from an install. `enact mmm setup` remains
// its way in.
//
// Ontologizer clears that bar because it is standard-library Python: the whole
// package travels as skill files (LoadOntologizerDefaultSkills), and the
// runtime host needs nothing but an interpreter, which is what its listings
// declare as a prerequisite.
//
// Nobody is a member of it. Workspace access is membership-gated throughout, so
// having no members is what keeps it out of every person's workspace list and
// off /enact — no special case anywhere else has to know it exists. Its owner
// is a user row that cannot receive mail (.invalid is reserved for exactly
// this by RFC 2606), so no sign-in flow can be pointed at it.
const (
	CatalogWorkspaceSlug = "enact"
	CatalogWorkspaceName = "Enact Official"
	catalogWorkspaceDesc = "Skills, agents and Agent Families published by Enact."
	catalogIssuePrefix   = "CAT"
	catalogUserName      = "Enact"
	catalogUserEmail     = "catalog@enact.invalid"
)

// CatalogVersion is the version string the seeder publishes under. A published
// version is never overwritten, so bumping this is how a changed bundle reaches
// workspaces: it adds a version to each listing, and anyone who installed the
// old one is offered the update.
const CatalogVersion = "1.2.0"

// CatalogWorkspace is what the seeder found or created.
type CatalogWorkspace struct {
	WorkspaceID pgtype.UUID
	OwnerID     pgtype.UUID
}

// EnsureCatalogWorkspaceInTx finds or creates the catalog workspace and brings
// its content up to the shipped bundles. It is idempotent: re-running keeps
// existing rows and converges their product-owned fields.
//
// The caller must pass transaction-scoped queries. The advisory lock is keyed
// on the catalog rather than on a workspace because two booting replicas race
// on creating the workspace itself.
func EnsureCatalogWorkspaceInTx(ctx context.Context, q *db.Queries) (CatalogWorkspace, error) {
	var catalog CatalogWorkspace

	if err := q.AcquireCatalogLock(ctx); err != nil {
		return catalog, fmt.Errorf("lock catalog: %w", err)
	}

	owner, err := q.GetUserByEmail(ctx, catalogUserEmail)
	if errors.Is(err, pgx.ErrNoRows) {
		owner, err = q.CreateUser(ctx, db.CreateUserParams{
			Name:  catalogUserName,
			Email: catalogUserEmail,
		})
	}
	if err != nil {
		return catalog, fmt.Errorf("catalog owner: %w", err)
	}

	workspace, err := q.GetWorkspaceBySlug(ctx, CatalogWorkspaceSlug)
	if errors.Is(err, pgx.ErrNoRows) {
		workspace, err = q.CreateWorkspace(ctx, db.CreateWorkspaceParams{
			Name:        CatalogWorkspaceName,
			Slug:        CatalogWorkspaceSlug,
			Description: pgtype.Text{String: catalogWorkspaceDesc, Valid: true},
			IssuePrefix: catalogIssuePrefix,
		})
	}
	if err != nil {
		return catalog, fmt.Errorf("catalog workspace: %w", err)
	}

	catalog = CatalogWorkspace{WorkspaceID: workspace.ID, OwnerID: owner.ID}

	// Both bundles are already expressed as provisioners; the catalog is now the
	// one workspace they run against. No runtime is bound: an agent template
	// names no machine, and publishing strips the binding anyway.
	if err := EnsureSDLCDefaultsInTx(ctx, q, catalog.WorkspaceID, catalog.OwnerID, pgtype.UUID{}); err != nil {
		return catalog, fmt.Errorf("provision SDLC bundle: %w", err)
	}
	if err := EnsureOntologizerDefaultsInTx(ctx, q, catalog.WorkspaceID, catalog.OwnerID, pgtype.UUID{}); err != nil {
		return catalog, fmt.Errorf("provision Ontologizer bundle: %w", err)
	}
	return catalog, nil
}

// upsertCatalogSkill writes one bundled skill and its files, replacing the file
// set so a file dropped upstream disappears here too, and records a version the
// way every other skill write does.
func upsertCatalogSkill(
	ctx context.Context,
	q *db.Queries,
	catalog CatalogWorkspace,
	skill AgentSkillData,
	config []byte,
) (pgtype.UUID, error) {
	row, err := q.GetSkillByWorkspaceAndName(ctx, db.GetSkillByWorkspaceAndNameParams{
		WorkspaceID: catalog.WorkspaceID,
		Name:        skill.Name,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		row, err = q.CreateSkill(ctx, db.CreateSkillParams{
			WorkspaceID: catalog.WorkspaceID,
			Name:        skill.Name,
			Description: skill.Description,
			Content:     skill.Content,
			Config:      config,
			CreatedBy:   catalog.OwnerID,
		})
	} else if err == nil {
		row, err = q.UpdateSkill(ctx, db.UpdateSkillParams{
			ID:          row.ID,
			Description: pgtype.Text{String: skill.Description, Valid: true},
			Content:     pgtype.Text{String: skill.Content, Valid: true},
			Config:      config,
		})
	}
	if err != nil {
		return pgtype.UUID{}, fmt.Errorf("upsert skill %s: %w", skill.Name, err)
	}

	if err := q.DeleteSkillFilesBySkill(ctx, row.ID); err != nil {
		return pgtype.UUID{}, fmt.Errorf("replace files for %s: %w", skill.Name, err)
	}
	versionFiles := make([]skillversion.File, 0, len(skill.Files))
	for _, file := range skill.Files {
		if _, err := q.UpsertSkillFile(ctx, db.UpsertSkillFileParams{
			SkillID: row.ID,
			Path:    file.Path,
			Content: file.Content,
		}); err != nil {
			return pgtype.UUID{}, fmt.Errorf("write %s/%s: %w", skill.Name, file.Path, err)
		}
		versionFiles = append(versionFiles, skillversion.File{Path: file.Path, Content: file.Content})
	}
	if _, _, err := skillversion.Record(ctx, q, skillversion.Input{
		Skill:   row,
		Files:   versionFiles,
		Source:  skillversion.SourceSeed,
		ActorID: catalog.OwnerID,
		Summary: "Provisioned by Enact (catalog " + CatalogVersion + ")",
	}); err != nil {
		return pgtype.UUID{}, fmt.Errorf("record version for %s: %w", skill.Name, err)
	}
	return row.ID, nil
}
