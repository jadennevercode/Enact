package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type semanticReleaseInstallInput struct {
	SourceWorkspaceID      string            `json:"source_workspace_id"`
	SourceReleaseDigest    string            `json:"expected_source_release_digest"`
	ConnectionMapping      map[string]string `json:"connection_mapping"`
	IncludeTestData        bool              `json:"include_test_data"`
	ExpectedTestDataDigest string            `json:"expected_test_data_digest"`
	PreviewDigest          string            `json:"preview_digest"`
	Rationale              string            `json:"rationale"`
}

type semanticPublishedRelease struct {
	WorkspaceID string
	OntologyID  string
	ReleaseID   string
	Version     string
	Digest      string
	Name        string
	Description string
	Artifact    json.RawMessage
	Bindings    json.RawMessage
	TestData    json.RawMessage
	Validation  json.RawMessage
}

type semanticReleaseGovernance struct {
	ConstructionID      string          `json:"construction_id"`
	ReviewPacketID      string          `json:"review_packet_id"`
	HumanDecisionID     string          `json:"human_decision_id"`
	PublishedEventID    string          `json:"published_event_id"`
	ArtifactDigest      string          `json:"artifact_digest"`
	ReviewSubjectDigest string          `json:"review_subject_digest"`
	Decision            string          `json:"decision"`
	Rationale           string          `json:"rationale"`
	DecidedBy           string          `json:"decided_by"`
	DecidedAt           time.Time       `json:"decided_at"`
	PublishedBy         string          `json:"published_by"`
	PublishedAt         time.Time       `json:"published_at"`
	Publication         json.RawMessage `json:"publication"`
}

type semanticReleaseInstallCatalog struct {
	RevisionID         string
	TargetConnectionID string
	CredentialRevision string
	Catalog            semanticDiscoveredCatalog
}

type semanticReleaseInstallCatalogSummary struct {
	SourceConnectionID string `json:"source_connection_id"`
	TargetConnectionID string `json:"target_connection_id"`
	SourceDigest       string `json:"catalog_digest"`
	SourceRevision     string `json:"source_revision,omitempty"`
	ContractDigest     string `json:"contract_digest"`
}

type semanticPreparedReleaseInstall struct {
	Source           semanticPublishedRelease
	Governance       semanticReleaseGovernance
	TargetOntologyID string
	TargetReleaseID  string
	Artifact         json.RawMessage
	Bindings         json.RawMessage
	Validation       json.RawMessage
	TestData         json.RawMessage
	TestDataSummary  semanticReleaseInstallTestDataSummary
	ReleaseDigest    string
	PreviewDigest    string
	Mapping          map[string]string
	Catalogs         map[string]semanticReleaseInstallCatalog
	CatalogSummary   []semanticReleaseInstallCatalogSummary
}

type semanticReleaseInstallQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (h *Handler) semanticPreviewReleaseInstall(w http.ResponseWriter, r *http.Request) {
	actor, releaseID, input, ok := h.semanticReleaseInstallRequest(w, r, false)
	if !ok {
		return
	}
	prepared, err := h.semanticPrepareReleaseInstall(r, actor, releaseID, input)
	if err != nil {
		semanticReleaseInstallError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, semanticReleaseInstallPreview(prepared, actor.WorkspaceID))
}

func (h *Handler) semanticInstallRelease(w http.ResponseWriter, r *http.Request) {
	actor, releaseID, input, ok := h.semanticReleaseInstallRequest(w, r, true)
	if !ok {
		return
	}
	prepared, err := h.semanticPrepareReleaseInstall(r, actor, releaseID, input)
	if err != nil {
		semanticReleaseInstallError(w, err)
		return
	}
	if input.PreviewDigest == "" || input.PreviewDigest != prepared.PreviewDigest {
		writeError(w, http.StatusConflict, "installation preview changed; review the current mapping before installing")
		return
	}
	if err = h.semanticRecheckReleaseInstallCatalogs(r, actor, prepared); err != nil {
		semanticReleaseInstallError(w, err)
		return
	}
	status, response, err := h.semanticCommitReleaseInstall(r, actor, prepared, strings.TrimSpace(input.Rationale))
	if err != nil {
		semanticReleaseInstallError(w, err)
		return
	}
	writeJSON(w, status, response)
}

func (h *Handler) semanticReleaseInstallRequest(w http.ResponseWriter, r *http.Request, requirePreview bool) (semanticActor, string, semanticReleaseInstallInput, bool) {
	actor, ok := h.semanticScope(w, r, true)
	if !ok {
		return semanticActor{}, "", semanticReleaseInstallInput{}, false
	}
	releaseID, ok := semanticParam(w, r, "id")
	if !ok {
		return semanticActor{}, "", semanticReleaseInstallInput{}, false
	}
	var input semanticReleaseInstallInput
	if !semanticDecode(w, r, &input) {
		return semanticActor{}, "", input, false
	}
	if _, err := uuid.Parse(input.SourceWorkspaceID); err != nil || input.SourceWorkspaceID == actor.WorkspaceID {
		writeError(w, http.StatusBadRequest, "source_workspace_id must identify another workspace")
		return semanticActor{}, "", input, false
	}
	if strings.TrimSpace(input.SourceReleaseDigest) == "" || input.ConnectionMapping == nil {
		writeError(w, http.StatusBadRequest, "expected_source_release_digest and connection_mapping are required")
		return semanticActor{}, "", input, false
	}
	if input.IncludeTestData && strings.TrimSpace(input.ExpectedTestDataDigest) == "" {
		writeError(w, http.StatusBadRequest, "expected_test_data_digest is required when include_test_data is true")
		return semanticActor{}, "", input, false
	}
	if !input.IncludeTestData && strings.TrimSpace(input.ExpectedTestDataDigest) != "" {
		writeError(w, http.StatusBadRequest, "expected_test_data_digest requires include_test_data=true")
		return semanticActor{}, "", input, false
	}
	if requirePreview && strings.TrimSpace(input.PreviewDigest) == "" {
		writeError(w, http.StatusBadRequest, "preview_digest is required")
		return semanticActor{}, "", input, false
	}
	if requirePreview && (len(strings.TrimSpace(input.Rationale)) < 1 || len(strings.TrimSpace(input.Rationale)) > 5000) {
		writeError(w, http.StatusBadRequest, "rationale must contain between 1 and 5000 characters")
		return semanticActor{}, "", input, false
	}
	return actor, releaseID, input, true
}

func (h *Handler) semanticPrepareReleaseInstall(r *http.Request, actor semanticActor, releaseID string, input semanticReleaseInstallInput) (semanticPreparedReleaseInstall, error) {
	source, err := semanticLoadPublishedRelease(r.Context(), h.DB, input.SourceWorkspaceID, releaseID, actor.UserID, input.SourceReleaseDigest, false)
	if err != nil {
		return semanticPreparedReleaseInstall{}, err
	}
	if !semanticNativeArtifact(source.Artifact) {
		return semanticPreparedReleaseInstall{}, semanticInstallConflict("only native published releases can be installed")
	}
	governance, err := semanticLoadReleaseGovernance(r.Context(), h.DB, source)
	if err != nil {
		return semanticPreparedReleaseInstall{}, err
	}
	testData, testDataSummary, err := semanticReleaseInstallSelectTestData(source, input)
	if err != nil {
		return semanticPreparedReleaseInstall{}, err
	}
	bindings, sourceBindings, err := semanticReleaseInstallBindingDocument(source.Bindings)
	if err != nil {
		return semanticPreparedReleaseInstall{}, semanticInstallConflict(err.Error())
	}
	if err = semanticValidateReleaseInstallMapping(sourceBindings, input.ConnectionMapping); err != nil {
		return semanticPreparedReleaseInstall{}, semanticInstallBadRequest(err.Error())
	}

	prepared := semanticPreparedReleaseInstall{
		Source: source, Governance: governance, TargetOntologyID: uuid.NewString(), TargetReleaseID: uuid.NewString(),
		Mapping: semanticCopyStringMap(input.ConnectionMapping), Catalogs: map[string]semanticReleaseInstallCatalog{},
		TestData: testData, TestDataSummary: testDataSummary,
	}
	targetConnections := map[string]semantic.Connection{}
	for sourceConnectionID, targetConnectionID := range input.ConnectionMapping {
		catalog, exists := prepared.Catalogs[targetConnectionID]
		if !exists {
			connection, secret, connectionErr := h.semanticConnection(r.Context(), actor.WorkspaceID, targetConnectionID)
			if connectionErr != nil {
				return semanticPreparedReleaseInstall{}, semanticInstallBadRequest("target connection mapping is unavailable")
			}
			secret, connectionErr = semantic.CredentialFor(connection, secret, actor.UserID, actor.Role, false)
			if connectionErr != nil {
				return semanticPreparedReleaseInstall{}, semanticInstallForbidden(connectionErr.Error())
			}
			discovered, connectionErr := h.semanticNativeCatalog(r, actor, connection, secret)
			if connectionErr != nil {
				return semanticPreparedReleaseInstall{}, semanticInstallUnprocessable("target binding discovery failed: " + connectionErr.Error())
			}
			if discovered.State != "ready" && discovered.State != "partial" {
				return semanticPreparedReleaseInstall{}, semanticInstallUnprocessable("target binding discovery did not produce a usable catalog")
			}
			if len(discovered.Warnings) == 0 {
				discovered.Warnings = json.RawMessage(`[]`)
			}
			if discovered.Metadata == nil {
				discovered.Metadata = map[string]any{}
			}
			catalog = semanticReleaseInstallCatalog{RevisionID: uuid.NewString(), TargetConnectionID: targetConnectionID, CredentialRevision: connection.CredentialRevision, Catalog: discovered}
			prepared.Catalogs[targetConnectionID] = catalog
			targetConnections[targetConnectionID] = connection
		}
		prepared.CatalogSummary = append(prepared.CatalogSummary, semanticReleaseInstallCatalogSummary{
			SourceConnectionID: sourceConnectionID, TargetConnectionID: targetConnectionID,
			SourceDigest: catalog.Catalog.SourceDigest, SourceRevision: catalog.Catalog.SourceRevision,
			ContractDigest: semantic.Digest(semanticCanonicalJSONValue(catalog.Catalog.Entries)),
		})
	}
	sort.Slice(prepared.CatalogSummary, func(i, j int) bool {
		return prepared.CatalogSummary[i].SourceConnectionID < prepared.CatalogSummary[j].SourceConnectionID
	})
	targetBindings, targetByKey, err := semanticRemapReleaseInstallBindings(bindings, sourceBindings, prepared.Mapping, prepared.Catalogs, targetConnections)
	if err != nil {
		return semanticPreparedReleaseInstall{}, semanticInstallUnprocessable(err.Error())
	}
	targetArtifact, err := semanticRemapReleaseInstallArtifact(source.Artifact, sourceBindings, targetByKey)
	if err != nil {
		return semanticPreparedReleaseInstall{}, semanticInstallConflict(err.Error())
	}
	prepared.Bindings = semanticMarshal(targetBindings)

	scope := map[string]string{"workspace_id": actor.WorkspaceID, "ontology_id": prepared.TargetOntologyID, "release_id": prepared.TargetReleaseID}
	sourceScope := map[string]string{"workspace_id": source.WorkspaceID, "ontology_id": source.OntologyID, "release_id": source.ReleaseID}
	adopted, err := semanticService(r.Context(), "native/adopt", map[string]any{
		"source_scope": sourceScope, "scope": scope, "artifact": json.RawMessage(source.Artifact), "bindings": targetArtifact["bindings"],
	})
	if err != nil {
		return semanticPreparedReleaseInstall{}, semanticInstallUnprocessable(err.Error())
	}
	var adoptedOutput struct {
		Artifact json.RawMessage `json:"artifact"`
	}
	if json.Unmarshal(adopted, &adoptedOutput) != nil || len(adoptedOutput.Artifact) == 0 || !semanticNativeArtifact(adoptedOutput.Artifact) {
		return semanticPreparedReleaseInstall{}, semanticInstallUnprocessable("semantic service did not return an adopted native artifact")
	}
	if err = semanticVerifyReleaseInstallScope(adoptedOutput.Artifact, scope); err != nil {
		return semanticPreparedReleaseInstall{}, semanticInstallUnprocessable(err.Error())
	}
	if err = semanticVerifyCompiledReleaseInstallBindings(adoptedOutput.Artifact, targetByKey); err != nil {
		return semanticPreparedReleaseInstall{}, semanticInstallUnprocessable(err.Error())
	}
	validation, err := semanticService(r.Context(), "validate", map[string]any{"scope": scope, "artifact": adoptedOutput.Artifact, "data": json.RawMessage(prepared.TestData)})
	if err != nil {
		return semanticPreparedReleaseInstall{}, semanticInstallUnprocessable(err.Error())
	}
	if !semanticValidationPassed(validation) {
		return semanticPreparedReleaseInstall{}, semanticInstallUnprocessable("installed release failed target validation")
	}
	prepared.Artifact = adoptedOutput.Artifact
	prepared.Validation = validation
	prepared.ReleaseDigest = semanticReleaseDigest(adoptedOutput.Artifact, prepared.Bindings, prepared.TestData, validation)
	prepared.PreviewDigest = semantic.Digest(map[string]any{
		"schema_version": 2, "source_workspace_id": source.WorkspaceID, "source_ontology_id": source.OntologyID,
		"source_release_id": source.ReleaseID, "source_release_digest": source.Digest,
		"target_workspace_id": actor.WorkspaceID, "target_name": source.Name, "target_version": source.Version,
		"connection_mapping": prepared.Mapping, "target_catalogs": prepared.CatalogSummary,
		"binding_config":    semanticReleaseInstallReviewedBindings(prepared.Bindings),
		"test_data":         prepared.TestDataSummary,
		"source_governance": governance,
	})
	return prepared, nil
}

func semanticLoadPublishedRelease(ctx context.Context, q semanticReleaseInstallQuerier, sourceWorkspaceID, releaseID, userID, expectedDigest string, lock bool) (semanticPublishedRelease, error) {
	var result semanticPublishedRelease
	query := `SELECT r.workspace_id::text,r.ontology_id::text,r.id::text,r.version,r.digest,o.name,o.description,r.artifact,r.binding_config,r.test_data,r.validation
		FROM semantic_release r JOIN semantic_ontology o ON o.workspace_id=r.workspace_id AND o.id=r.ontology_id
		JOIN member m ON m.workspace_id=r.workspace_id AND m.user_id=$3
		WHERE r.workspace_id=$1 AND r.id=$2 AND r.digest=$4 AND r.retired_at IS NULL
			AND jsonb_typeof(r.test_data)='object' AND r.test_data<>'{}'::jsonb`
	if lock {
		query += " FOR SHARE OF r,o,m"
	}
	err := q.QueryRow(ctx, query, sourceWorkspaceID, releaseID, userID, expectedDigest).Scan(
		&result.WorkspaceID, &result.OntologyID, &result.ReleaseID, &result.Version, &result.Digest, &result.Name, &result.Description, &result.Artifact, &result.Bindings, &result.TestData, &result.Validation,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, semanticInstallNotFound("active source release was not found or is not readable by this member")
	}
	if err != nil {
		return result, err
	}
	if semanticReleaseDigest(result.Artifact, result.Bindings, result.TestData, result.Validation) != result.Digest {
		return result, semanticInstallConflict("source release digest does not match its immutable contents")
	}
	return result, nil
}

func semanticLoadReleaseGovernance(ctx context.Context, q semanticReleaseInstallQuerier, source semanticPublishedRelease) (semanticReleaseGovernance, error) {
	var result semanticReleaseGovernance
	err := q.QueryRow(ctx, `SELECT c.id::text,p.id::text,d.id::text,e.id::text,p.artifact_digest,p.review_subject_digest,
		d.decision,d.rationale,d.decided_by::text,d.created_at,r.published_by::text,r.created_at,e.data
		FROM semantic_release r
		JOIN semantic_construction_event e ON e.workspace_id=r.workspace_id AND e.kind='published'
			AND e.data->>'release_id'=r.id::text AND e.data->>'digest'=r.digest
		JOIN semantic_construction c ON c.workspace_id=e.workspace_id AND c.id=e.construction_id
			AND c.ontology_id=r.ontology_id AND c.stage='release' AND c.status='completed'
		JOIN semantic_review_packet p ON p.workspace_id=c.workspace_id AND p.construction_id=c.id AND p.gate='release'
		JOIN semantic_human_decision d ON d.workspace_id=p.workspace_id AND d.construction_id=p.construction_id
			AND d.review_packet_id=p.id AND d.gate='release' AND d.decision='approve'
			AND d.artifact_digest=p.artifact_digest AND d.review_subject_digest=p.review_subject_digest
		WHERE r.workspace_id=$1 AND r.id=$2 AND r.digest=$3 AND r.retired_at IS NULL
			AND d.created_at<=r.created_at AND r.created_at<=e.created_at
		ORDER BY d.created_at DESC LIMIT 1`, source.WorkspaceID, source.ReleaseID, source.Digest).Scan(
		&result.ConstructionID, &result.ReviewPacketID, &result.HumanDecisionID, &result.PublishedEventID,
		&result.ArtifactDigest, &result.ReviewSubjectDigest, &result.Decision, &result.Rationale,
		&result.DecidedBy, &result.DecidedAt, &result.PublishedBy, &result.PublishedAt, &result.Publication,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, semanticInstallConflict("source release has no verifiable governed publication lineage")
	}
	if err != nil {
		return result, err
	}
	return result, nil
}

func semanticReleaseInstallBindingDocument(raw json.RawMessage) (map[string]any, map[string]map[string]any, error) {
	var document map[string]any
	if json.Unmarshal(raw, &document) != nil || document == nil {
		return nil, nil, errors.New("source release binding configuration is invalid")
	}
	var typed semantic.Bindings
	if json.Unmarshal(raw, &typed) != nil || typed.Validate() != nil {
		return nil, nil, errors.New("source release binding configuration is invalid")
	}
	bindings := map[string]map[string]any{}
	for _, spec := range []struct{ field, kind string }{{"data_bindings", "data"}, {"action_bindings", "action"}} {
		list, exists := document[spec.field]
		if !exists {
			continue
		}
		items, ok := list.([]any)
		if !ok {
			return nil, nil, fmt.Errorf("source release %s must be an array", spec.field)
		}
		for _, item := range items {
			binding, ok := item.(map[string]any)
			if !ok {
				return nil, nil, errors.New("source release contains an invalid binding")
			}
			id, _ := binding["id"].(string)
			connectionID, _ := binding["connection_id"].(string)
			key := spec.kind + ":" + id
			if id == "" || connectionID == "" || bindings[key] != nil {
				return nil, nil, errors.New("source release contains an invalid or duplicate binding")
			}
			bindings[key] = binding
		}
	}
	return document, bindings, nil
}

func semanticValidateReleaseInstallMapping(bindings map[string]map[string]any, mapping map[string]string) error {
	required := map[string]bool{}
	for _, binding := range bindings {
		connectionID, _ := binding["connection_id"].(string)
		required[connectionID] = true
	}
	if len(required) != len(mapping) {
		return errors.New("connection_mapping must map every and only source release connection")
	}
	for sourceID := range required {
		targetID, exists := mapping[sourceID]
		if !exists {
			return errors.New("connection_mapping must map every and only source release connection")
		}
		if _, err := uuid.Parse(sourceID); err != nil {
			return errors.New("source release contains an invalid connection ID")
		}
		if _, err := uuid.Parse(targetID); err != nil {
			return errors.New("connection_mapping target IDs must be UUIDs")
		}
	}
	for sourceID := range mapping {
		if !required[sourceID] {
			return errors.New("connection_mapping must map every and only source release connection")
		}
	}
	return nil
}

func semanticRemapReleaseInstallBindings(document map[string]any, source map[string]map[string]any, mapping map[string]string, catalogs map[string]semanticReleaseInstallCatalog, connections map[string]semantic.Connection) (map[string]any, map[string]map[string]any, error) {
	target := semanticCloneMap(document)
	targetByKey := map[string]map[string]any{}
	for _, spec := range []struct {
		field, kind string
		action      bool
	}{{"data_bindings", "data", false}, {"action_bindings", "action", true}} {
		items, _ := target[spec.field].([]any)
		for _, item := range items {
			binding := item.(map[string]any)
			id, _ := binding["id"].(string)
			key := spec.kind + ":" + id
			sourceBinding := source[key]
			sourceConnectionID, _ := sourceBinding["connection_id"].(string)
			targetConnectionID := mapping[sourceConnectionID]
			catalog := catalogs[targetConnectionID]
			connection := connections[targetConnectionID]
			binding["connection_id"] = targetConnectionID
			binding["catalog_digest"] = catalog.Catalog.SourceDigest
			binding["catalog_revision_id"] = catalog.RevisionID
			delete(binding, "tool_schema_digest")
			if readback, ok := binding["readback"].(map[string]any); ok {
				delete(readback, "tool_schema_digest")
			}
			var typed semantic.Binding
			if json.Unmarshal(semanticMarshal(binding), &typed) != nil {
				return nil, nil, errors.New("remapped binding is invalid")
			}
			if err := semanticCheckNativeBinding(&typed, catalog.Catalog, spec.action); err != nil {
				return nil, nil, fmt.Errorf("binding %s: %w", id, err)
			}
			if typed.SQL != "" && connection.Kind != "postgres" || typed.Tool != "" && connection.Kind != "mcp" {
				return nil, nil, fmt.Errorf("binding %s transport does not match its target connection", id)
			}
			if spec.action && connection.Kind != "rest" && connection.Kind != "openapi" && connection.Kind != "mcp" {
				return nil, nil, fmt.Errorf("action binding %s requires a REST, OpenAPI or MCP target connection", id)
			}
			semanticMergeReleaseInstallPins(binding, typed)
			targetByKey[key] = binding
		}
	}
	var typed semantic.Bindings
	if json.Unmarshal(semanticMarshal(target), &typed) != nil {
		return nil, nil, errors.New("remapped binding configuration is invalid")
	}
	if err := typed.Validate(); err != nil {
		return nil, nil, err
	}
	return target, targetByKey, nil
}

func semanticMergeReleaseInstallPins(raw map[string]any, typed semantic.Binding) {
	raw["connection_id"] = typed.ConnectionID
	raw["catalog_digest"] = typed.CatalogDigest
	raw["catalog_revision_id"] = typed.CatalogRevisionID
	if typed.ToolSchemaDigest == "" {
		delete(raw, "tool_schema_digest")
	} else {
		raw["tool_schema_digest"] = typed.ToolSchemaDigest
	}
	if typed.Readback != nil {
		readback, _ := raw["readback"].(map[string]any)
		if readback != nil {
			if typed.Readback.ToolSchemaDigest == "" {
				delete(readback, "tool_schema_digest")
			} else {
				readback["tool_schema_digest"] = typed.Readback.ToolSchemaDigest
			}
		}
	}
}

func semanticPinnedBindingConfig(raw json.RawMessage, typed semantic.Bindings) (json.RawMessage, error) {
	var document map[string]any
	if json.Unmarshal(raw, &document) != nil || document == nil {
		return nil, errors.New("binding configuration is invalid")
	}
	for _, spec := range []struct {
		field string
		items []semantic.Binding
	}{{"data_bindings", typed.Data}, {"action_bindings", typed.Actions}} {
		value, exists := document[spec.field]
		if !exists && len(spec.items) == 0 {
			continue
		}
		rawItems, ok := value.([]any)
		if !ok || len(rawItems) != len(spec.items) {
			return nil, errors.New("binding configuration changed shape")
		}
		byID := make(map[string]semantic.Binding, len(spec.items))
		for _, binding := range spec.items {
			byID[binding.ID] = binding
		}
		for _, item := range rawItems {
			binding, ok := item.(map[string]any)
			id, _ := binding["id"].(string)
			typedBinding, exists := byID[id]
			if !ok || !exists {
				return nil, errors.New("binding configuration changed shape")
			}
			semanticMergeReleaseInstallPins(binding, typedBinding)
			delete(byID, id)
		}
		if len(byID) != 0 {
			return nil, errors.New("binding configuration changed shape")
		}
	}
	return semanticMarshal(document), nil
}

func semanticRemapReleaseInstallArtifact(raw json.RawMessage, source, target map[string]map[string]any) (map[string]any, error) {
	var artifact map[string]any
	if json.Unmarshal(raw, &artifact) != nil || artifact == nil {
		return nil, errors.New("source native artifact is invalid")
	}
	if definition, ok := artifact["definition"].(map[string]any); ok {
		if err := semanticRemapReleaseInstallArtifactList(definition, "data_bindings", "data", source, target); err != nil {
			return nil, err
		}
		if err := semanticRemapReleaseInstallArtifactList(definition, "action_bindings", "action", source, target); err != nil {
			return nil, err
		}
	}
	if value, exists := artifact["bindings"]; exists {
		items, ok := value.([]any)
		if !ok {
			return nil, errors.New("source native artifact bindings are invalid")
		}
		seen := map[string]bool{}
		for _, item := range items {
			binding, ok := item.(map[string]any)
			kind, _ := binding["kind"].(string)
			id, _ := binding["id"].(string)
			key := kind + ":" + id
			if !ok || source[key] == nil || seen[key] {
				return nil, errors.New("source native artifact bindings do not match its release contract")
			}
			if err := semanticRemapReleaseInstallArtifactBinding(binding, source[key], target[key]); err != nil {
				return nil, err
			}
			seen[key] = true
		}
		if len(seen) != len(source) {
			return nil, errors.New("source native artifact bindings do not match its release contract")
		}
	}
	return artifact, nil
}

func semanticRemapReleaseInstallArtifactList(parent map[string]any, field, kind string, source, target map[string]map[string]any) error {
	value, exists := parent[field]
	if !exists {
		return nil
	}
	items, ok := value.([]any)
	if !ok {
		return errors.New("source native definition bindings are invalid")
	}
	seen := map[string]bool{}
	for _, item := range items {
		binding, ok := item.(map[string]any)
		id, _ := binding["id"].(string)
		key := kind + ":" + id
		if !ok || source[key] == nil || seen[key] {
			return errors.New("source native definition bindings do not match its release contract")
		}
		if err := semanticRemapReleaseInstallArtifactBinding(binding, source[key], target[key]); err != nil {
			return err
		}
		seen[key] = true
	}
	expected := 0
	for key := range source {
		if strings.HasPrefix(key, kind+":") {
			expected++
		}
	}
	if len(seen) != expected {
		return errors.New("source native definition bindings do not match its release contract")
	}
	return nil
}

func semanticRemapReleaseInstallArtifactBinding(artifact, source, target map[string]any) error {
	if artifact["connection_id"] != source["connection_id"] || artifact["catalog_entry_id"] != source["catalog_entry_id"] {
		return errors.New("source native artifact binding selector does not match its release contract")
	}
	for _, key := range []string{"connection_id", "catalog_digest", "catalog_revision_id", "tool_schema_digest"} {
		if value, exists := target[key]; exists {
			artifact[key] = value
		} else {
			delete(artifact, key)
		}
	}
	if targetReadback, ok := target["readback"].(map[string]any); ok {
		if artifactReadback, ok := artifact["readback"].(map[string]any); ok {
			if value, exists := targetReadback["tool_schema_digest"]; exists {
				artifactReadback["tool_schema_digest"] = value
			} else {
				delete(artifactReadback, "tool_schema_digest")
			}
		}
	}
	return nil
}

func semanticVerifyCompiledReleaseInstallBindings(raw json.RawMessage, expected map[string]map[string]any) error {
	var artifact map[string]any
	if json.Unmarshal(raw, &artifact) != nil || artifact == nil {
		return errors.New("compiled target artifact is invalid")
	}
	value, exists := artifact["bindings"]
	items, ok := value.([]any)
	if !exists || !ok || len(items) != len(expected) {
		return errors.New("compiled target artifact lost its remapped binding contract")
	}
	seen := map[string]bool{}
	for _, item := range items {
		binding, ok := item.(map[string]any)
		kind, _ := binding["kind"].(string)
		id, _ := binding["id"].(string)
		key := kind + ":" + id
		want := expected[key]
		if !ok || want == nil || seen[key] {
			return errors.New("compiled target artifact changed its remapped binding identity")
		}
		for _, field := range []string{"connection_id", "catalog_entry_id", "catalog_digest", "catalog_revision_id", "path", "tool"} {
			if binding[field] != want[field] {
				return fmt.Errorf("compiled target artifact changed binding %s field %s", id, field)
			}
		}
		method, _ := binding["method"].(string)
		wantMethod, _ := want["method"].(string)
		if method == "" {
			method = "GET"
		}
		if wantMethod == "" {
			wantMethod = "GET"
		}
		if strings.ToUpper(method) != strings.ToUpper(wantMethod) {
			return fmt.Errorf("compiled target artifact changed binding %s field method", id)
		}
		seen[key] = true
	}
	return nil
}

func semanticVerifyReleaseInstallScope(raw json.RawMessage, expected map[string]string) error {
	var artifact struct {
		Manifest map[string]any `json:"manifest"`
	}
	if json.Unmarshal(raw, &artifact) != nil || artifact.Manifest == nil {
		return errors.New("adopted target artifact has no native manifest")
	}
	for _, key := range []string{"workspace_id", "ontology_id", "release_id"} {
		if artifact.Manifest[key] != expected[key] {
			return errors.New("adopted target artifact scope does not match the installation target")
		}
	}
	return nil
}

func semanticReleaseInstallReviewedBindings(raw json.RawMessage) any {
	var document map[string]any
	_ = json.Unmarshal(raw, &document)
	for _, field := range []string{"data_bindings", "action_bindings"} {
		items, _ := document[field].([]any)
		for _, item := range items {
			if binding, ok := item.(map[string]any); ok {
				delete(binding, "catalog_revision_id")
			}
		}
	}
	return document
}

func (h *Handler) semanticRecheckReleaseInstallCatalogs(r *http.Request, actor semanticActor, prepared semanticPreparedReleaseInstall) error {
	for targetConnectionID, expected := range prepared.Catalogs {
		connection, secret, err := h.semanticConnection(r.Context(), actor.WorkspaceID, targetConnectionID)
		if err != nil || connection.CredentialRevision != expected.CredentialRevision {
			return semanticInstallConflict("target connection changed after compilation")
		}
		secret, err = semantic.CredentialFor(connection, secret, actor.UserID, actor.Role, false)
		if err != nil {
			return semanticInstallForbidden(err.Error())
		}
		catalog, err := h.semanticNativeCatalog(r, actor, connection, secret)
		if err != nil {
			return semanticInstallUnprocessable("target binding rediscovery failed: " + err.Error())
		}
		if semanticReleaseInstallCatalogDigest(catalog) != semanticReleaseInstallCatalogDigest(expected.Catalog) {
			return semanticInstallConflict("target catalog changed during installation; preview again")
		}
	}
	return nil
}

func semanticReleaseInstallCatalogDigest(catalog semanticDiscoveredCatalog) string {
	return semantic.Digest(map[string]any{"source_digest": catalog.SourceDigest, "source_revision": catalog.SourceRevision, "entries": semanticCanonicalJSONValue(catalog.Entries)})
}

func semanticReleaseInstallPreview(prepared semanticPreparedReleaseInstall, targetWorkspaceID string) map[string]any {
	return map[string]any{
		"preview_digest":     prepared.PreviewDigest,
		"source":             map[string]any{"workspace_id": prepared.Source.WorkspaceID, "ontology_id": prepared.Source.OntologyID, "release_id": prepared.Source.ReleaseID, "version": prepared.Source.Version, "digest": prepared.Source.Digest},
		"target":             map[string]any{"workspace_id": targetWorkspaceID, "name": prepared.Source.Name, "version": prepared.Source.Version},
		"connection_mapping": prepared.Mapping, "catalogs": prepared.CatalogSummary,
		"binding_config": semanticReleaseInstallReviewedBindings(prepared.Bindings), "validation": prepared.Validation,
		"test_data":         prepared.TestDataSummary,
		"source_governance": prepared.Governance,
	}
}

func semanticCloneMap(value map[string]any) map[string]any {
	var clone map[string]any
	_ = json.Unmarshal(semanticMarshal(value), &clone)
	return clone
}

func semanticCopyStringMap(value map[string]string) map[string]string {
	copy := make(map[string]string, len(value))
	for key, item := range value {
		copy[key] = item
	}
	return copy
}

type semanticInstallHTTPError struct {
	status  int
	message string
}

func (e semanticInstallHTTPError) Error() string { return e.message }
func semanticInstallBadRequest(message string) error {
	return semanticInstallHTTPError{http.StatusBadRequest, message}
}
func semanticInstallForbidden(message string) error {
	return semanticInstallHTTPError{http.StatusForbidden, message}
}
func semanticInstallNotFound(message string) error {
	return semanticInstallHTTPError{http.StatusNotFound, message}
}
func semanticInstallConflict(message string) error {
	return semanticInstallHTTPError{http.StatusConflict, message}
}
func semanticInstallUnprocessable(message string) error {
	return semanticInstallHTTPError{http.StatusUnprocessableEntity, message}
}
func semanticReleaseInstallError(w http.ResponseWriter, err error) {
	var httpErr semanticInstallHTTPError
	if errors.As(err, &httpErr) {
		writeError(w, httpErr.status, httpErr.message)
		return
	}
	writeError(w, http.StatusInternalServerError, "failed to install ontology release")
}
