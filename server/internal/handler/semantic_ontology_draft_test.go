package handler

import (
	"encoding/json"
	"testing"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/enact-ai/enact/server/internal/testutil"
)

func TestSemanticDraftBindingsRejectMalformedStructureWithoutChangingDraft(t *testing.T) {
	config := json.RawMessage(`{"action_bindings":[{"id":"plan.create","authorization":{"mode":"confirm","roles":["QualityEngineer"]}}]}`)
	var original map[string]any
	testutil.Call(t, testHandler.semanticCreateOntology, semanticRequest("POST", "", map[string]any{"name": "original draft", "description": "reviewed scope", "bundle": map[string]any{"source_guidance": "preserve"}, "binding_config": config, "test_data": map[string]any{"format": "turtle", "content": "original"}})).Want(201).JSON(&original)
	id := original["id"].(string)
	dbfx.Cleanup(t, "DELETE FROM semantic_ontology WHERE id=$1", id)
	for _, malformed := range []string{
		`null`, `"[redacted]"`, `[]`, `true`,
		`{"action_bindings":[{"authorization":"[redacted]"}]}`,
		`{"action_bindings":[{"authorization":[]}]}`,
		`{"action_bindings":[{"authorization":{"mode":[],"roles":["QualityEngineer"]}}]}`,
		`{"action_bindings":[{"authorization":{"mode":"confirm","roles":"QualityEngineer"}}]}`,
		`{"data_bindings":"[redacted]"}`,
		`{"data_bindings":[{"required_parameters":{}}]}`,
	} {
		testutil.Call(t, testHandler.semanticUpdateOntology, semanticRequest("PUT", id, map[string]any{"name": "corrupted name", "description": "corrupted scope", "bundle": map[string]any{"changed": true}, "binding_config": json.RawMessage(malformed), "test_data": map[string]any{"content": "changed"}})).Want(400)
		var unchanged map[string]any
		testutil.Call(t, testHandler.semanticGetOntology, semanticRequest("GET", id, nil)).Want(200).JSON(&unchanged)
		if semantic.Digest(unchanged) != semantic.Digest(original) {
			t.Fatalf("malformed bindings changed the persisted draft: %s", malformed)
		}
	}
	// The create boundary follows the same explicit-null contract.
	testutil.Call(t, testHandler.semanticCreateOntology, semanticRequest("POST", "", map[string]any{"name": "invalid new draft", "bundle": map[string]any{}, "binding_config": nil})).Want(400)
}

func TestSemanticDraftBindingsAllowPartialContractsAndRetainOmittedConfiguration(t *testing.T) {
	var draft map[string]any
	testutil.Call(t, testHandler.semanticCreateOntology, semanticRequest("POST", "", map[string]any{"name": "partial draft", "bundle": map[string]any{}})).Want(201).JSON(&draft)
	id := draft["id"].(string)
	dbfx.Cleanup(t, "DELETE FROM semantic_ontology WHERE id=$1", id)
	config := json.RawMessage(`{"data_bindings":[{"id":"case.read"}],"action_bindings":[{"id":"plan.create","authorization":{"mode":"confirm","roles":["QualityEngineer","PlantManager"]}}]}`)
	var parsed semantic.Bindings
	if err := json.Unmarshal(config, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Validate() == nil {
		t.Fatal("fixture must be a structurally valid draft that is not publishable")
	}
	testutil.Call(t, testHandler.semanticUpdateOntology, semanticRequest("PUT", id, map[string]any{"name": "partial draft", "bundle": map[string]any{"revision": 1}, "binding_config": config})).Want(200).JSON(&draft)
	expected := semantic.Digest(draft["binding_config"])
	var authored map[string]any
	if err := json.Unmarshal(config, &authored); err != nil {
		t.Fatal(err)
	}
	if expected != semantic.Digest(authored) {
		t.Fatal("saved draft changed the mode, roles or incomplete binding fields")
	}
	testutil.Call(t, testHandler.semanticUpdateOntology, semanticRequest("PUT", id, map[string]any{"name": "revised description", "bundle": map[string]any{"revision": 2}})).Want(200).JSON(&draft)
	if semantic.Digest(draft["binding_config"]) != expected || draft["bundle"].(map[string]any)["revision"] != float64(2) {
		t.Fatal("omitting binding_config did not preserve the saved contract while updating the draft")
	}
	// An explicit empty object remains available for intentionally clearing a draft.
	testutil.Call(t, testHandler.semanticUpdateOntology, semanticRequest("PUT", id, map[string]any{"name": "empty binding draft", "bundle": map[string]any{}, "binding_config": map[string]any{}})).Want(200).JSON(&draft)
	if len(draft["binding_config"].(map[string]any)) != 0 {
		t.Fatal("explicit empty object did not clear the draft binding configuration")
	}
}
