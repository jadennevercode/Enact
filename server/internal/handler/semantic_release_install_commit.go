package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/jackc/pgx/v5"
)

func (h *Handler) semanticCommitReleaseInstall(r *http.Request, actor semanticActor, prepared semanticPreparedReleaseInstall, adoptionRationale string) (int, map[string]any, error) {
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback(r.Context())
	workspaceIDs := []string{actor.WorkspaceID, prepared.Source.WorkspaceID}
	sort.Strings(workspaceIDs)
	for _, workspaceID := range workspaceIDs {
		if err = semanticLockWorkspace(r.Context(), tx, workspaceID); err != nil {
			return 0, nil, semanticInstallNotFound("source or target workspace is no longer available")
		}
	}
	var targetRole string
	if err = tx.QueryRow(r.Context(), `SELECT role FROM member WHERE workspace_id=$1 AND user_id=$2 FOR SHARE`, actor.WorkspaceID, actor.UserID).Scan(&targetRole); err != nil || !roleAllowed(targetRole, "owner", "admin") {
		return 0, nil, semanticInstallForbidden("a current target workspace owner or admin must install a release")
	}
	currentSource, err := semanticLoadPublishedRelease(r.Context(), tx, prepared.Source.WorkspaceID, prepared.Source.ReleaseID, actor.UserID, prepared.Source.Digest, true)
	if err != nil {
		return 0, nil, err
	}
	if currentSource.Name != prepared.Source.Name || currentSource.Description != prepared.Source.Description || currentSource.Version != prepared.Source.Version ||
		semantic.Digest(currentSource.Artifact) != semantic.Digest(prepared.Source.Artifact) || semantic.Digest(currentSource.Bindings) != semantic.Digest(prepared.Source.Bindings) ||
		semantic.Digest(currentSource.TestData) != semantic.Digest(prepared.Source.TestData) || semantic.Digest(currentSource.Validation) != semantic.Digest(prepared.Source.Validation) {
		return 0, nil, semanticInstallConflict("source release changed during installation")
	}
	currentGovernance, err := semanticLoadReleaseGovernance(r.Context(), tx, currentSource)
	if err != nil {
		return 0, nil, err
	}
	if semantic.Digest(currentGovernance) != semantic.Digest(prepared.Governance) {
		return 0, nil, semanticInstallConflict("source publication lineage changed during installation")
	}
	for targetConnectionID, expected := range prepared.Catalogs {
		connection, _, connectionErr := semanticLoadReleaseInstallConnection(r.Context(), tx, actor.WorkspaceID, targetConnectionID, true)
		if connectionErr != nil || connection.CredentialRevision != expected.CredentialRevision {
			return 0, nil, semanticInstallConflict("target connection changed during installation")
		}
	}

	targetCatalogs := make([]map[string]any, 0, len(prepared.Catalogs))
	for _, summary := range prepared.CatalogSummary {
		catalog := prepared.Catalogs[summary.TargetConnectionID]
		targetCatalogs = append(targetCatalogs, map[string]any{
			"source_connection_id": summary.SourceConnectionID, "target_connection_id": summary.TargetConnectionID,
			"catalog_revision_id": catalog.RevisionID, "catalog_digest": summary.SourceDigest,
			"source_revision": summary.SourceRevision, "contract_digest": summary.ContractDigest,
		})
	}
	var adoption json.RawMessage
	err = tx.QueryRow(r.Context(), `INSERT INTO semantic_release_installation(
		workspace_id,ontology_id,release_id,source_workspace_id,source_ontology_id,source_release_id,source_release_digest,
		source_governance,connection_mapping,target_catalogs,preview_digest,adoption_rationale,adopted_by
	) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
	ON CONFLICT (workspace_id,source_workspace_id,source_release_id,source_release_digest,preview_digest) DO NOTHING
	RETURNING to_jsonb(semantic_release_installation)`, actor.WorkspaceID, prepared.TargetOntologyID, prepared.TargetReleaseID,
		prepared.Source.WorkspaceID, prepared.Source.OntologyID, prepared.Source.ReleaseID, prepared.Source.Digest,
		semanticMarshal(prepared.Governance), semanticMarshal(prepared.Mapping), semanticMarshal(targetCatalogs), prepared.PreviewDigest, adoptionRationale, actor.UserID).Scan(&adoption)
	if errors.Is(err, pgx.ErrNoRows) {
		_ = tx.Rollback(r.Context())
		response, loadErr := h.semanticExistingReleaseInstall(r.Context(), actor.WorkspaceID, prepared)
		return http.StatusOK, response, loadErr
	}
	if err != nil {
		return 0, nil, err
	}
	for _, catalog := range prepared.Catalogs {
		_, err = tx.Exec(r.Context(), `INSERT INTO semantic_catalog_revision(
			id,workspace_id,connection_id,principal_id,credential_revision,source_digest,source_revision,state,entries,warnings,metadata
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, catalog.RevisionID, actor.WorkspaceID, catalog.TargetConnectionID, actor.UserID,
			catalog.CredentialRevision, catalog.Catalog.SourceDigest, catalog.Catalog.SourceRevision, catalog.Catalog.State,
			catalog.Catalog.Entries, catalog.Catalog.Warnings, semanticMarshal(catalog.Catalog.Metadata))
		if err != nil {
			return 0, nil, err
		}
	}
	distribution := map[string]any{
		"kind": "adopted_published_release", "source_workspace_id": prepared.Source.WorkspaceID,
		"source_ontology_id": prepared.Source.OntologyID, "source_release_id": prepared.Source.ReleaseID,
		"source_release_digest": prepared.Source.Digest, "preview_digest": prepared.PreviewDigest,
		"source_governance": prepared.Governance, "connection_mapping": prepared.Mapping, "target_catalogs": targetCatalogs,
		"test_data": prepared.TestDataSummary,
	}
	bundle := semanticMarshal(map[string]any{"native_artifact": json.RawMessage(prepared.Artifact), "distribution": distribution})
	var ontology json.RawMessage
	err = tx.QueryRow(r.Context(), `INSERT INTO semantic_ontology(id,workspace_id,name,description,bundle,created_by,binding_config,test_data)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING to_jsonb(semantic_ontology)`, prepared.TargetOntologyID, actor.WorkspaceID,
		prepared.Source.Name, prepared.Source.Description, bundle, actor.UserID, prepared.Bindings, prepared.TestData).Scan(&ontology)
	if err != nil {
		return 0, nil, err
	}
	var release json.RawMessage
	err = tx.QueryRow(r.Context(), `INSERT INTO semantic_release(id,workspace_id,ontology_id,version,digest,artifact,binding_config,test_data,published_by,validation)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING to_jsonb(semantic_release)`, prepared.TargetReleaseID, actor.WorkspaceID,
		prepared.TargetOntologyID, prepared.Source.Version, prepared.ReleaseDigest, prepared.Artifact, prepared.Bindings, prepared.TestData, actor.UserID, prepared.Validation).Scan(&release)
	if err != nil {
		return 0, nil, err
	}
	if err = tx.Commit(r.Context()); err != nil {
		return 0, nil, err
	}
	return http.StatusCreated, map[string]any{"installed": true, "idempotent": false, "ontology": ontology, "release": release, "adoption": adoption}, nil
}

func (h *Handler) semanticExistingReleaseInstall(ctx context.Context, targetWorkspaceID string, prepared semanticPreparedReleaseInstall) (map[string]any, error) {
	var ontology, release, adoption json.RawMessage
	err := h.DB.QueryRow(ctx, `SELECT to_jsonb(o),to_jsonb(r),to_jsonb(i)
		FROM semantic_release_installation i
		JOIN semantic_ontology o ON o.workspace_id=i.workspace_id AND o.id=i.ontology_id
		JOIN semantic_release r ON r.workspace_id=i.workspace_id AND r.id=i.release_id AND r.ontology_id=i.ontology_id
		WHERE i.workspace_id=$1 AND i.source_workspace_id=$2 AND i.source_release_id=$3 AND i.source_release_digest=$4 AND i.preview_digest=$5`,
		targetWorkspaceID, prepared.Source.WorkspaceID, prepared.Source.ReleaseID, prepared.Source.Digest, prepared.PreviewDigest).Scan(&ontology, &release, &adoption)
	if err != nil {
		return nil, err
	}
	return map[string]any{"installed": true, "idempotent": true, "ontology": ontology, "release": release, "adoption": adoption}, nil
}

func semanticLoadReleaseInstallConnection(ctx context.Context, q semanticReleaseInstallQuerier, workspaceID, connectionID string, lock bool) (semantic.Connection, semantic.Secret, error) {
	var connection semantic.Connection
	var config, encrypted, capabilities []byte
	query := `SELECT id::text,workspace_id::text,name,kind,endpoint,config,secret,capabilities FROM semantic_connection WHERE workspace_id=$1 AND id=$2 AND enabled`
	if lock {
		query += " FOR SHARE"
	}
	err := q.QueryRow(ctx, query, workspaceID, connectionID).Scan(&connection.ID, &connection.WorkspaceID, &connection.Name, &connection.Kind, &connection.Endpoint, &config, &encrypted, &capabilities)
	if err != nil {
		return connection, semantic.Secret{}, err
	}
	_ = json.Unmarshal(config, &connection.Config)
	_ = json.Unmarshal(capabilities, &connection.Capabilities)
	var secret semantic.Secret
	if len(encrypted) > 0 {
		box, boxErr := semanticBox()
		if boxErr != nil {
			return connection, secret, boxErr
		}
		plain, openErr := box.Open(encrypted)
		if openErr != nil || json.Unmarshal(plain, &secret) != nil {
			return connection, secret, errors.New("target connection credential is unavailable")
		}
	}
	connection.CredentialRevision = semantic.Digest(map[string]any{"secret": secret, "endpoint": connection.Endpoint, "config": connection.Config, "kind": connection.Kind})
	return connection, secret, nil
}
