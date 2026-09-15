package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

type semanticNativeDiagnostic struct {
	Code    string `json:"code"`
	Stage   string `json:"stage"`
	Message string `json:"message"`
}

// Only static catalog entries cross this boundary. Downstream exception text
// can contain extracted source data, property names, callback tokens or URLs.
var semanticNativeDiagnostics = map[string]semanticNativeDiagnostic{
	"native_invalid_business_definition":      {"native_invalid_business_definition", "model", "The version-2 business definition is structurally invalid. The definition and every Entity, Attribute, Relationship, Action and Policy need nonempty id, label and description fields. Attributes also need a supported data_type and an existing entity_id; relationships need existing source/target entity IDs and nonnegative min/max cardinalities. Repair references and required fields in definition before rebuilding."},
	"native_binding_definition_mismatch":      {"native_binding_definition_mismatch", "operations", "Execution bindings differ from the bindings in the authoritative version-2 definition. Build both views from the same definition without dropping explicit empty fields or connector metadata; no ontology revision was saved."},
	"native_undeclared_entity_property":       {"native_undeclared_entity_property", "export", "An extracted entity property is absent from the version-2 business definition. Declare a scalar field in definition.attributes or an object link in definition.relationships, or move extraction-only annotations into metadata. Preserve source anchors and replay completed model operations after repairing the definition."},
	"native_invalid_property_value":           {"native_invalid_property_value", "export", "An entity property value does not match its declared datatype or object range. Use a scalar or typed literal for datatype properties and a stable entity ID or IRI for object properties; then replay completed extraction results."},
	"native_source_snapshot_mismatch":         {"native_source_snapshot_mismatch", "parse", "Source IDs and hashes must match the selected immutable snapshots. Reload the scoped snapshot documents and preserve their original content, IDs and hashes."},
	"native_extraction_source_mismatch":       {"native_extraction_source_mismatch", "semantic_extract", "Extraction evidence does not match the selected source text. Use an existing source ID and exact quote/start/end offsets; resolve ambiguous mentions without inventing source text. Replay completed model results when available."},
	"native_extraction_entity_identity":       {"native_extraction_entity_identity", "semantic_extract", "Extracted entities need unique stable IDs. Resolve duplicate or missing IDs and update every relationship endpoint consistently before rebuilding."},
	"native_extraction_relationship_endpoint": {"native_extraction_relationship_endpoint", "semantic_extract", "A relationship references an entity absent from the extraction. Match source and target IDs to extracted entities supported by the same source evidence."},
	"native_rule_contract":                    {"native_rule_contract", "reasoning", "Native rules need unique IDs, safe predicate atoms and variables bound by their premises. Action intents must reference an existing action binding and use only bound proof variables."},
	"native_model_operation_pending":          {"native_model_operation_pending", "semantic_extract", "A model operation is still running. Inspect its existing operation ID in the construction record; wait for completion and replay the completed result instead of submitting another model call."},
	"native_model_operation_failed":           {"native_model_operation_failed", "semantic_extract", "The assigned model operation did not complete successfully. Inspect its recorded status and repair the runtime or extraction request before retrying; reuse any completed operations."},
	"native_replay_mismatch":                  {"native_replay_mismatch", "semantic_extract", "Replay must use authorized completed operation IDs with the original source selection, extraction prompt and schema. Omit supplied extractions and keep the selected document/chunk scope unchanged."},
	"native_extraction_work_limit":            {"native_extraction_work_limit", "semantic_extract", "Runtime extraction exceeds its explicit model-operation budget. Select only relevant exact source_ids or chunk_ids, or set max_model_operations within the allowed limit after estimating two operations per selected chunk. If the reviewed definition only needs technical compilation, omit runtime extraction and retain schema-only coverage; do not silently increase the budget or claim unprocessed sources were extracted."},
	"native_service_unavailable":              {"native_service_unavailable", "pipeline", "The native semantic service is unavailable or unconfigured. Restore the configured service before retrying and check existing model operations before starting new extraction."},
	"native_build_failed":                     {"native_build_failed", "pipeline", "The native build failed without a recognized safe diagnostic. Inspect the construction findings and completed model operations. Repair the request before retrying; no ontology revision was saved."},
}

func semanticClassifyNativeFailure(err error) semanticNativeDiagnostic {
	code := "native_build_failed"
	if err == nil {
		return semanticNativeDiagnostics[code]
	}
	text := err.Error()
	if text == "semantic service is unavailable" || text == "ENACT_SEMANTIC_SERVICE_URL is not configured" {
		return semanticNativeDiagnostics["native_service_unavailable"]
	}
	const prefix = "semantic service rejected the request: "
	if !strings.HasPrefix(text, prefix) || len(text) > 64<<10 {
		return semanticNativeDiagnostics[code]
	}
	var response struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal([]byte(strings.TrimPrefix(text, prefix)), &response) != nil || response.Error.Code != "invalid_semantic_request" {
		return semanticNativeDiagnostics[code]
	}
	message := response.Error.Message
	contains := func(values ...string) bool {
		for _, value := range values {
			if strings.Contains(message, value) {
				return true
			}
		}
		return false
	}
	switch {
	case contains("A business definition requires schema_version 2", "Business declaration IDs must be unique across all five types", "Aliases must be an array of strings", "Declaration status must be draft, active or disabled", "Attribute requires a supported data_type", "Relationship cardinality must contain min and max bounds", "Relationship cardinality declarations disagree", "Relationship cardinalities must be nonnegative integers", "Relationship minimum exceeds its maximum cardinality", "Action identity_parameters must name at most twenty input fields", "Action target identity must reference declared input parameters", "Policy requires permission, prohibition, obligation or constraint", "Policy priority must be an integer", "Bindings must be an array of at most 1000 declarations", "Bindings require distinct nonempty IDs", "Data binding requires a business target"):
		code = "native_invalid_business_definition"
	case strings.HasPrefix(message, "Definition requires ") || strings.HasPrefix(message, "Each ") && strings.Contains(message, " declaration requires ") || strings.HasPrefix(message, "Unknown ") && strings.Contains(message, " reference: ") || strings.HasPrefix(message, "Action ") && strings.Contains(message, " is not a valid JSON Schema") || strings.HasPrefix(message, "Policy effective"):
		code = "native_invalid_business_definition"
	case contains("Entity property ") && contains("needs an explicit ontology property term"):
		code = "native_undeclared_entity_property"
	case contains("requires an entity identifier or IRI", "requires a scalar or explicit typed literal", "contains an unsupported value", "has an invalid lexical value"):
		code = "native_invalid_property_value"
	case contains("Source hash does not match immutable source content", "Every source requires a unique id and textual content"):
		code = "native_source_snapshot_mismatch"
	case contains("Extraction provenance references an unknown source snapshot", "Ambiguous extraction provenance requires exact candidate source spans", "Extraction candidate span does not match its immutable source", "Extraction has invalid source offsets", "Extraction quote does not match its source offsets", "Extracted entity text is absent from the immutable source chunk", "Native chunk offsets do not identify the exact source slice"):
		code = "native_extraction_source_mismatch"
	case contains("Extracted entities need unique stable IDs"):
		code = "native_extraction_entity_identity"
	case contains("A relationship endpoint is absent from the extracted entities", "Extracted relation endpoint was not found in the same source chunk"):
		code = "native_extraction_relationship_endpoint"
	case contains("Native rules fail the reviewed rule/intent contract", "Native rules require safe predicate atoms", "Native rule conditions and conclusion require safe predicate atoms", "Native rule IDs must be non-empty and unique", "Conclusion references variables absent from native rule premises", "Native rule action requires an existing action binding", "Native action parameters must be an object using only bound proof variables"):
		code = "native_rule_contract"
	case contains("Definition bindings and execution bindings must match; rebuild from one definition"):
		code = "native_binding_definition_mismatch"
	case contains("Enact model operation is still running"):
		code = "native_model_operation_pending"
	case contains("Enact model operation did not complete successfully"):
		code = "native_model_operation_failed"
	case contains("Replay requires exactly one authorized completed operation", "Replay requires server-resolved completed model operation records", "Replay model operation IDs must be unique", "Replay contains unused operations outside the selected extraction"):
		code = "native_replay_mismatch"
	case contains("Runtime extraction needs ") && contains("model operations for ", "select source_ids/chunk_ids or explicitly increase max_model_operations"):
		code = "native_extraction_work_limit"
	case contains("Runtime max_model_operations must be an integer from 2 to 200"):
		code = "native_extraction_work_limit"
	}
	return semanticNativeDiagnostics[code]
}

func (h *Handler) semanticNativeFailure(w http.ResponseWriter, r *http.Request, actor semanticActor, ontologyID string, err error) {
	diagnostic := semanticClassifyNativeFailure(err)
	recorded := h.semanticRecordNativeFailure(actor, ontologyID, diagnostic)
	writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "Native ontology build failed", "diagnostic": diagnostic, "finding_recorded": recorded})
}

func (h *Handler) semanticRecordNativeFailure(actor semanticActor, ontologyID string, diagnostic semanticNativeDiagnostic) bool {
	if actor.ActorType != "agent" || actor.TaskID == nil {
		return false
	}
	// Re-resolve the task's actual Issue ancestry. A task on another Issue must
	// not write diagnostics into an unrelated construction of the same ontology.
	ctx, cancel := semanticPersistContext()
	defer cancel()
	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return false
	}
	defer tx.Rollback(ctx)
	if semanticLockWorkspace(ctx, tx, actor.WorkspaceID) != nil {
		return false
	}
	stage := "model"
	if diagnostic.Stage == "parse" || diagnostic.Stage == "semantic_extract" {
		stage = "evidence"
	} else if diagnostic.Stage == "reasoning" {
		stage = "review"
	}
	result, err := tx.Exec(ctx, `WITH RECURSIVE ancestry AS (
 SELECT i.id,i.parent_issue_id FROM issue i JOIN agent_task_queue t ON t.issue_id=i.id
 WHERE i.workspace_id=$1 AND t.id=$2 AND t.agent_id=$3 AND t.originator_user_id=$4 AND t.status='running'
 UNION SELECT i.id,i.parent_issue_id FROM issue i JOIN ancestry a ON a.parent_issue_id=i.id WHERE i.workspace_id=$1
), matched AS (
 SELECT c.id FROM semantic_construction c JOIN ancestry a ON a.id=c.issue_id
 WHERE c.workspace_id=$1 AND c.ontology_id=$5 ORDER BY c.created_at DESC LIMIT 1
)
 INSERT INTO semantic_construction_event(id,workspace_id,construction_id,task_id,actor_type,actor_id,stage,kind,message,data)
 SELECT $6,$1,id,$2,$7,$3,$8,'finding',$9,$10 FROM matched`, actor.WorkspaceID, *actor.TaskID, actor.ActorID, actor.UserID, ontologyID, uuid.NewString(), actor.ActorType, stage, diagnostic.Message, semanticMarshal(map[string]any{"diagnostic": diagnostic, "revision_saved": false}))
	if err != nil || result.RowsAffected() != 1 {
		return false
	}
	return tx.Commit(ctx) == nil
}
