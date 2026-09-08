package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type semanticOntologyInput struct {
	Name              string          `json:"name"`
	Description       string          `json:"description"`
	Bundle            json.RawMessage `json:"bundle"`
	BindingConfig     json.RawMessage `json:"binding_config"`
	TestData          json.RawMessage `json:"test_data"`
	ExpectedUpdatedAt *time.Time      `json:"expected_updated_at"`
}

func (h *Handler) semanticOntologies(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	h.semanticRows(w, r, "SELECT to_jsonb(o) FROM semantic_ontology o WHERE workspace_id=$1 ORDER BY updated_at DESC", actor.WorkspaceID)
}
func (h *Handler) semanticGetOntology(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	h.semanticRow(w, r, 200, "SELECT to_jsonb(o) FROM semantic_ontology o WHERE workspace_id=$1 AND id=$2", actor.WorkspaceID, id)
}
func (h *Handler) semanticSaveOntology(w http.ResponseWriter, r *http.Request, update bool) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	var input semanticOntologyInput
	if !semanticDecode(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Name) == "" || len(input.Bundle) == 0 || string(input.Bundle) == "null" {
		writeError(w, 400, "name and canonical bundle are required")
		return
	}
	var bundle map[string]any
	if json.Unmarshal(input.Bundle, &bundle) != nil {
		writeError(w, 400, "bundle must be a canonical ontology object")
		return
	}
	if len(input.BindingConfig) > 0 {
		var object map[string]json.RawMessage
		var bindings semantic.Bindings
		// Drafts may omit executable details, but malformed JSON shapes must not
		// overwrite a valid contract. Omission retains bindings; null is invalid.
		if json.Unmarshal(input.BindingConfig, &object) != nil || object == nil || json.Unmarshal(input.BindingConfig, &bindings) != nil {
			writeError(w, 400, "binding_config must be an object with valid binding field types; omit it to retain the saved configuration")
			return
		}
	}
	if update {
		id, ok := semanticParam(w, r, "id")
		if !ok {
			return
		}
		tx, err := h.TxStarter.Begin(r.Context())
		if err != nil {
			writeError(w, 500, "failed to save ontology")
			return
		}
		defer tx.Rollback(r.Context())
		if err = semanticLockWorkspace(r.Context(), tx, actor.WorkspaceID); err != nil {
			writeError(w, 404, "workspace not found")
			return
		}
		var current time.Time
		if err = tx.QueryRow(r.Context(), "SELECT updated_at FROM semantic_ontology WHERE workspace_id=$1 AND id=$2 FOR UPDATE", actor.WorkspaceID, id).Scan(&current); err != nil {
			writeError(w, 404, "ontology not found")
			return
		}
		if input.ExpectedUpdatedAt != nil && !current.Equal(*input.ExpectedUpdatedAt) {
			writeError(w, 409, "ontology was updated by another author; reload before saving")
			return
		}
		var saved json.RawMessage
		err = tx.QueryRow(r.Context(), "UPDATE semantic_ontology SET name=$3,description=$4,bundle=$5,binding_config=COALESCE($6,binding_config),test_data=COALESCE($7,test_data),updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING to_jsonb(semantic_ontology)", actor.WorkspaceID, id, input.Name, input.Description, input.Bundle, input.BindingConfig, input.TestData).Scan(&saved)
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			writeError(w, 500, "failed to save ontology")
			return
		}
		writeJSON(w, 200, saved)
		return
	}
	h.semanticRow(w, r, 201, "INSERT INTO semantic_ontology(workspace_id,name,description,bundle,created_by,binding_config,test_data) VALUES($1,$2,$3,$4,$5,COALESCE($6,'{}'::jsonb),COALESCE($7,'{}'::jsonb)) RETURNING to_jsonb(semantic_ontology)", actor.WorkspaceID, input.Name, input.Description, input.Bundle, actor.UserID, input.BindingConfig, input.TestData)
}
func (h *Handler) semanticCreateOntology(w http.ResponseWriter, r *http.Request) {
	h.semanticSaveOntology(w, r, false)
}
func (h *Handler) semanticUpdateOntology(w http.ResponseWriter, r *http.Request) {
	h.semanticSaveOntology(w, r, true)
}
func (h *Handler) semanticReleases(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	h.semanticRows(w, r, "SELECT to_jsonb(v) FROM semantic_release v WHERE workspace_id=$1 AND ontology_id=$2 ORDER BY created_at DESC", actor.WorkspaceID, id)
}

func (h *Handler) semanticPublishRelease(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, true)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	var input struct {
		Version  string             `json:"version"`
		Bindings *semantic.Bindings `json:"binding_config"`
		TestData json.RawMessage    `json:"test_data"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Version) == "" {
		writeError(w, 400, "version is required")
		return
	}
	var bundle, savedBindings, savedTestData json.RawMessage
	if err := h.DB.QueryRow(r.Context(), "SELECT bundle,binding_config,test_data FROM semantic_ontology WHERE workspace_id=$1 AND id=$2", actor.WorkspaceID, id).Scan(&bundle, &savedBindings, &savedTestData); err != nil {
		writeError(w, 404, "ontology not found")
		return
	}
	if input.Bindings == nil {
		input.Bindings = &semantic.Bindings{}
		if json.Unmarshal(savedBindings, input.Bindings) != nil {
			writeError(w, 400, "saved binding configuration is invalid")
			return
		}
	}
	if len(input.TestData) == 0 {
		input.TestData = savedTestData
	}
	if err := input.Bindings.Validate(); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	var nativeBundle struct {
		Artifact json.RawMessage `json:"native_artifact"`
	}
	_ = json.Unmarshal(bundle, &nativeBundle)
	native := semanticNativeArtifact(nativeBundle.Artifact)
	if native {
		var artifact struct {
			Bindings []semantic.Binding `json:"bindings"`
		}
		if json.Unmarshal(nativeBundle.Artifact, &artifact) != nil || semanticAuthoredBindings(artifact.Bindings) != semanticAuthoredBindings(semanticNativeBindings(*input.Bindings)) {
			writeError(w, 409, "ontology bindings changed; rebuild and validate the native artifact before publishing")
			return
		}
	}
	// Verify every backing connection belongs to the workspace and is reachable.
	// Unsupported transports fail here rather than yielding an apparently runnable release.
	checked := map[string]json.RawMessage{}
	nativeCatalogs := map[string]semanticDiscoveredCatalog{}
	for listIndex, list := range [][]semantic.Binding{input.Bindings.Data, input.Bindings.Actions} {
		for bindingIndex := range list {
			binding := &list[bindingIndex]
			if _, err := uuid.Parse(binding.ConnectionID); err != nil {
				writeError(w, 400, "binding connection_id must be a UUID")
				return
			}
			c, s, err := h.semanticConnection(r.Context(), actor.WorkspaceID, binding.ConnectionID)
			if err != nil {
				writeError(w, 400, err.Error())
				return
			}
			if native {
				catalog, exists := nativeCatalogs[c.ID]
				if !exists {
					if s, err = semantic.CredentialFor(c, s, actor.UserID, actor.Role, false); err == nil {
						catalog, err = h.semanticNativeCatalog(r, actor, c, s)
					}
					if err != nil {
						writeError(w, 422, "binding discovery failed: "+err.Error())
						return
					}
					nativeCatalogs[c.ID] = catalog
				}
				if err = semanticCheckNativeBinding(binding, catalog, listIndex == 1); err != nil {
					writeError(w, 422, err.Error())
					return
				}
				continue
			}
			if _, exists := checked[c.ID]; !exists {
				if s, err = semantic.CredentialFor(c, s, actor.UserID, actor.Role, false); err != nil {
					writeError(w, 403, err.Error())
					return
				}
				var discovery json.RawMessage
				if discovery, err = semanticAdapter().Discover(r.Context(), c, s); err != nil {
					writeError(w, 422, "binding discovery failed: "+err.Error())
					return
				}
				checked[c.ID] = discovery
			}
			if binding.SQL != "" && c.Kind != "postgres" || binding.Tool != "" && c.Kind != "mcp" {
				writeError(w, 400, "binding transport does not match its connection")
				return
			}
			if c.Kind == "mcp" {
				if err := semantic.PinMCPBinding(binding, checked[c.ID], listIndex == 1); err != nil {
					writeError(w, 422, err.Error())
					return
				}
			}
		}
	}
	for _, binding := range input.Bindings.Actions {
		c, _, _ := h.semanticConnection(r.Context(), actor.WorkspaceID, binding.ConnectionID)
		if c.Kind != "rest" && c.Kind != "openapi" && c.Kind != "mcp" {
			writeError(w, 422, "action bindings require a REST or explicitly idempotent MCP system operation API")
			return
		}
	}
	releaseID := uuid.NewString()
	scope := map[string]string{"workspace_id": actor.WorkspaceID, "ontology_id": id, "release_id": releaseID}
	compiled, err := semanticService(r.Context(), "compile", map[string]any{"scope": scope, "bundle": bundle})
	if err != nil {
		writeError(w, 422, err.Error())
		return
	}
	var output struct {
		Artifact json.RawMessage `json:"artifact"`
	}
	if json.Unmarshal(compiled, &output) != nil || len(output.Artifact) == 0 {
		writeError(w, 502, "semantic compiler did not return an artifact")
		return
	}
	validation, err := semanticService(r.Context(), "validate", map[string]any{"scope": scope, "artifact": output.Artifact, "data": input.TestData})
	if err != nil {
		writeError(w, 422, err.Error())
		return
	}
	if !semanticValidationPassed(validation) {
		writeJSON(w, 422, map[string]any{"error": "ontology release failed its validation gate", "validation": validation})
		return
	}
	digest := semantic.Digest(map[string]any{"artifact": output.Artifact, "binding_config": input.Bindings, "validation": validation})
	// Recheck the draft under lock after potentially slow compilation. The exact
	// bytes validated must be the bytes the publisher releases.
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "failed to start release publication")
		return
	}
	defer tx.Rollback(r.Context())
	if err = semanticLockWorkspace(r.Context(), tx, actor.WorkspaceID); err != nil {
		writeError(w, 404, "workspace not found")
		return
	}
	var current, currentBindings, currentTestData json.RawMessage
	if err = tx.QueryRow(r.Context(), "SELECT bundle,binding_config,test_data FROM semantic_ontology WHERE workspace_id=$1 AND id=$2 FOR UPDATE", actor.WorkspaceID, id).Scan(&current, &currentBindings, &currentTestData); err != nil {
		writeError(w, 404, "ontology not found")
		return
	}
	if semantic.Digest(current) != semantic.Digest(bundle) || semantic.Digest(currentBindings) != semantic.Digest(savedBindings) || semantic.Digest(currentTestData) != semantic.Digest(savedTestData) {
		writeError(w, 409, "ontology changed while release was being validated")
		return
	}
	var published json.RawMessage
	err = tx.QueryRow(r.Context(), "INSERT INTO semantic_release(id,workspace_id,ontology_id,version,digest,artifact,binding_config,published_by,validation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING to_jsonb(semantic_release)", releaseID, actor.WorkspaceID, id, input.Version, digest, output.Artifact, semanticMarshal(input.Bindings), actor.UserID, validation).Scan(&published)
	if err != nil {
		writeError(w, 409, "release version already exists or publication failed")
		return
	}
	var artifactMetadata struct {
		Manifest struct {
			ArtifactDigest *string `json:"artifact_digest"`
		} `json:"manifest"`
	}
	_ = json.Unmarshal(output.Artifact, &artifactMetadata)
	publication := semanticMarshal(map[string]any{"release_id": releaseID, "version": input.Version, "digest": digest, "artifact_digest": artifactMetadata.Manifest.ArtifactDigest})
	// An ontology can have several construction sessions. Complete only its
	// latest session, atomically with publication; legacy releases may have none.
	_, err = tx.Exec(r.Context(), `WITH completed AS (
		UPDATE semantic_construction SET stage='release',status='completed',updated_at=now()
		WHERE workspace_id=$1 AND id=(SELECT id FROM semantic_construction WHERE workspace_id=$1 AND ontology_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE)
		RETURNING id
	) INSERT INTO semantic_construction_event(id,workspace_id,construction_id,actor_type,actor_id,stage,kind,message,data)
		SELECT $3,$1,id,$4,$5,'release','published','Ontology release published',$6 FROM completed`, actor.WorkspaceID, id, uuid.NewString(), actor.ActorType, actor.ActorID, publication)
	if err != nil {
		writeError(w, 500, "failed to record construction publication")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		writeError(w, 500, "failed to commit release")
		return
	}
	writeJSON(w, 201, published)
}

func semanticValidationPassed(raw json.RawMessage) bool {
	var result struct {
		Valid       bool `json:"valid"`
		Conforms    bool `json:"conforms"`
		Unsupported []struct {
			Severity string `json:"severity"`
		} `json:"unsupported"`
	}
	if json.Unmarshal(raw, &result) != nil || !result.Valid || !result.Conforms {
		return false
	}
	for _, item := range result.Unsupported {
		if item.Severity == "error" {
			return false
		}
	}
	return true
}

type semanticRelease struct {
	ID         string            `json:"id"`
	OntologyID string            `json:"ontology_id"`
	Artifact   json.RawMessage   `json:"artifact"`
	Bindings   semantic.Bindings `json:"binding_config"`
}

func (h *Handler) semanticLoadRelease(r *http.Request, ws, id string) (semanticRelease, error) {
	return h.semanticLoadReleaseRecord(r, ws, id, false)
}
func (h *Handler) semanticLoadReleaseRecord(r *http.Request, ws, id string, allowRetired bool) (semanticRelease, error) {
	var release semanticRelease
	var bindings json.RawMessage
	err := h.DB.QueryRow(r.Context(), "SELECT id::text,ontology_id::text,artifact,binding_config FROM semantic_release WHERE workspace_id=$1 AND id=$2 AND (retired_at IS NULL OR $3)", ws, id, allowRetired).Scan(&release.ID, &release.OntologyID, &release.Artifact, &bindings)
	if errors.Is(err, pgx.ErrNoRows) {
		return release, errors.New("release not found in this workspace")
	}
	if err != nil {
		return release, err
	}
	err = json.Unmarshal(bindings, &release.Bindings)
	return release, err
}
