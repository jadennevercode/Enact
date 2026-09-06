package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/enact-ai/enact/server/internal/handler"
	"github.com/enact-ai/enact/server/internal/service"
	"github.com/enact-ai/enact/server/internal/util"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
)

// Seeding the product's own Marketplace catalog.
//
// This lives in the boot package rather than in service because it needs both
// halves: service owns the bundles and how they become workspace rows, and the
// publish itself is handler.PublishMarketplaceListingTx. handler already
// imports service, so the seeder that needs both can only sit above them.
//
// One transaction covers provisioning and publishing. That is not incidental —
// the publish snapshots the entities by reading them back, so it has to see
// rows the same transaction just wrote, and a half-seeded catalog offering a
// family whose members do not exist would be worse than none.

// A bundle is how the catalog's content is grouped for the directory: the tags
// a reader filters on, and the conditions that must hold on the installing side
// before a copy of it will actually run.
//
// The catalog publishes whatever it finds in the catalog workspace, so a listing
// is matched to its bundle by what provisioned it — a skill by the origin its
// config records, an agent or family by its system key namespace.
type catalogBundle struct {
	Tags          []string
	Prerequisites []string
}

// Tags are kept short: a facet with one member per listing is not a facet.
var (
	sdlcBundle = catalogBundle{Tags: []string{"sdlc", "delivery"}}

	// The Ontologizer skills ship the package they shell out to as their own
	// files (see service.LoadOntologizerDefaultSkills), so nothing has to be
	// provisioned on the runtime host beyond a Python interpreter. What is left
	// is what no install can do: put an interpreter on the machine, and put the
	// people who own the decision points in the family.
	ontologizerBundle = catalogBundle{
		Tags: []string{"ontology", "knowledge"},
		Prerequisites: []string{
			"运行这些 Agent 的 runtime 主机上要有 python3（3.11 或更新）。Skill 自带全部脚本，不依赖第三方包，也不需要额外安装步骤。",
			"本体构建的八个决策点由人裁决。安装后把承担这些角色的同事加进 Agent Family，家族里默认只有五个 Agent。",
		},
	}
)

// catalogBundleForSkill reads the origin the provisioner stamped on the skill's
// config. Anything unrecognised is SDLC, which was the only bundle before this
// grouping existed.
func catalogBundleForSkill(config []byte) catalogBundle {
	var parsed struct {
		Origin struct {
			Type string `json:"type"`
		} `json:"origin"`
	}
	if json.Unmarshal(config, &parsed) == nil && parsed.Origin.Type == service.OntologizerSkillOrigin {
		return ontologizerBundle
	}
	return sdlcBundle
}

// catalogBundleForSystemKey groups an agent or family by its system key
// namespace, which is the identity its provisioner writes.
func catalogBundleForSystemKey(systemKey pgtype.Text) catalogBundle {
	if strings.HasPrefix(systemKey.String, service.OntologizerSystemKeyPrefix) {
		return ontologizerBundle
	}
	return sdlcBundle
}

// catalogTxStarter is the narrow slice of *pgxpool.Pool this file needs, so a
// test can drive the seeder without one.
type catalogTxStarter interface {
	Begin(context.Context) (pgx.Tx, error)
}

// ensureMarketplaceCatalog provisions the catalog workspace and publishes every
// bundled skill, agent and family as a public listing.
//
// Idempotent by construction: re-running finds the same rows, and re-publishing
// a version string that already exists is refused by a unique index, which the
// seeder reads as "already current" rather than as a failure. Publishing a
// changed bundle is therefore a deliberate act — bump service.CatalogVersion.
func ensureMarketplaceCatalog(ctx context.Context, pool catalogTxStarter, h *handler.Handler, queries *db.Queries) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx)
	qtx := queries.WithTx(tx)

	catalog, err := service.EnsureCatalogWorkspaceInTx(ctx, qtx)
	if err != nil {
		return err
	}

	published, err := publishCatalogListings(ctx, tx, queries, h, catalog)
	if err != nil {
		return err
	}
	if err := featureCatalogFamilies(ctx, queries.WithTx(tx), catalog); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	slog.Info("marketplace catalog ready",
		"workspace", service.CatalogWorkspaceSlug, "version", service.CatalogVersion, "published", published)
	return nil
}

// publishCatalogListings publishes one listing per bundled entity and reports
// how many versions it actually created.
func publishCatalogListings(
	ctx context.Context,
	tx pgx.Tx,
	queries *db.Queries,
	h *handler.Handler,
	catalog service.CatalogWorkspace,
) (int, error) {
	q := queries.WithTx(tx)
	skills, err := q.ListSkillsByWorkspace(ctx, catalog.WorkspaceID)
	if err != nil {
		return 0, fmt.Errorf("list catalog skills: %w", err)
	}
	published := 0
	for _, skill := range skills {
		bundle := catalogBundleForSkill(skill.Config)
		added, err := publishCatalogEntity(ctx, tx, queries, h, catalog, handler.PublishMarketplaceListingRequest{
			Kind:          "skill",
			SourceID:      util.UUIDToString(skill.ID),
			Description:   skill.Description,
			Tags:          bundle.Tags,
			Prerequisites: bundle.Prerequisites,
		})
		if err != nil {
			return published, fmt.Errorf("publish skill %s: %w", skill.Name, err)
		}
		published += added
	}

	agents, err := q.ListAgents(ctx, catalog.WorkspaceID)
	if err != nil {
		return published, fmt.Errorf("list catalog agents: %w", err)
	}
	for _, agent := range agents {
		bundle := catalogBundleForSystemKey(agent.SystemKey)
		added, err := publishCatalogEntity(ctx, tx, queries, h, catalog, handler.PublishMarketplaceListingRequest{
			Kind:          "agent",
			SourceID:      util.UUIDToString(agent.ID),
			Description:   agent.Description,
			Tags:          bundle.Tags,
			Prerequisites: bundle.Prerequisites,
		})
		if err != nil {
			return published, fmt.Errorf("publish agent %s: %w", agent.Name, err)
		}
		published += added
	}

	squads, err := q.ListAllSquads(ctx, catalog.WorkspaceID)
	if err != nil {
		return published, fmt.Errorf("list catalog families: %w", err)
	}
	for _, squad := range squads {
		bundle := catalogBundleForSystemKey(squad.SystemKey)
		added, err := publishCatalogEntity(ctx, tx, queries, h, catalog, handler.PublishMarketplaceListingRequest{
			Kind:          "squad",
			SourceID:      util.UUIDToString(squad.ID),
			Description:   squad.Description,
			Tags:          bundle.Tags,
			Prerequisites: bundle.Prerequisites,
		})
		if err != nil {
			return published, fmt.Errorf("publish family %s: %w", squad.Name, err)
		}
		published += added
	}
	return published, nil
}

// featureCatalogFamilies marks the Agent Family listings featured and clears the
// flag from everything else the catalog publishes.
//
// A family is a bundle's entry point; its member agents and their skills are
// what the family is made of. Recommendation weights featured above official,
// so without this a workspace opening the Marketplace for the first time gets
// six of the catalog's thirty-odd listings in install-count order — most likely
// six individual skills, none of which is the thing to install first.
//
// Run after publishing rather than as part of it: the flag belongs to the
// listing, not to a version, and a boot where every version is already current
// still has to converge it.
func featureCatalogFamilies(ctx context.Context, q *db.Queries, catalog service.CatalogWorkspace) error {
	listings, err := q.ListMarketplaceListingsByWorkspace(ctx, catalog.WorkspaceID)
	if err != nil {
		return fmt.Errorf("list catalog listings: %w", err)
	}
	for _, listing := range listings {
		want := listing.Kind == "squad"
		if listing.Featured == want {
			continue
		}
		if _, err := q.UpdateMarketplaceListing(ctx, db.UpdateMarketplaceListingParams{
			ID:       listing.ID,
			Featured: pgtype.Bool{Bool: want, Valid: true},
		}); err != nil {
			return fmt.Errorf("feature listing %s: %w", listing.Slug, err)
		}
	}
	return nil
}

// publishCatalogEntity publishes one entity inside its own savepoint, treating
// "this version is already published" as success. Returns 1 when a version was
// created.
//
// The savepoint is what makes re-running cheap. Re-publishing an existing
// version string raises a unique violation, and in PostgreSQL that aborts the
// whole transaction — every later statement fails until it ends. Rolling back
// to a savepoint puts the transaction back to just before the attempt, so the
// remaining listings can still be considered on a boot where most content is
// unchanged.
func publishCatalogEntity(
	ctx context.Context,
	tx pgx.Tx,
	queries *db.Queries,
	h *handler.Handler,
	catalog service.CatalogWorkspace,
	req handler.PublishMarketplaceListingRequest,
) (int, error) {
	req.Visibility = "public"
	req.Version = service.CatalogVersion

	savepoint, err := tx.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("savepoint: %w", err)
	}

	_, _, publishErr := h.PublishMarketplaceListingTx(
		ctx, queries.WithTx(savepoint), catalog.WorkspaceID, catalog.OwnerID, req)
	if publishErr != nil {
		_ = savepoint.Rollback(ctx)
		if handler.MarketplacePublishStatus(publishErr) == http.StatusConflict {
			return 0, nil
		}
		return 0, publishErr
	}
	if err := savepoint.Commit(ctx); err != nil {
		return 0, fmt.Errorf("release savepoint: %w", err)
	}
	return 1, nil
}
