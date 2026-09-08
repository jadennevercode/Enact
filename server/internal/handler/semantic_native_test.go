package handler

import (
	"encoding/json"
	"testing"
)

func TestSemanticNativeExtractionPreservesBoundedSelectionWithoutCallerCredentials(t *testing.T) {
	var input map[string]any
	_ = json.Unmarshal([]byte(`{"source_ids":["stakeholders.md"],"chunk_ids":["chunk-1"],"max_model_operations":4,"server_url":"https://untrusted.example","task_token":"caller-supplied","operation_id":"caller-supplied"}`), &input)
	selection, err := semanticNativeExtractionSelection(input)
	if err != nil {
		t.Fatal(err)
	}
	if selection["max_model_operations"] != 4 || selection["source_ids"].([]string)[0] != "stakeholders.md" || selection["chunk_ids"].([]string)[0] != "chunk-1" {
		t.Fatal("native extraction lost its selected document scope or budget")
	}
	for _, key := range []string{"server_url", "task_token", "operation_id"} {
		if _, exists := selection[key]; exists {
			t.Fatalf("caller-controlled %s must not be forwarded", key)
		}
	}
	for _, invalid := range []string{`{"source_ids":[]}`, `{"source_ids":[4]}`, `{"max_model_operations":0}`, `{"max_model_operations":1.5}`, `{"max_model_operations":2001}`} {
		var value map[string]any
		_ = json.Unmarshal([]byte(invalid), &value)
		if _, err := semanticNativeExtractionSelection(value); err == nil {
			t.Fatalf("accepted invalid extraction selection: %s", invalid)
		}
	}
}
