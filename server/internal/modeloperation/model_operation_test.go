package modeloperation

import (
	"encoding/json"
	"testing"
)

func TestModelOperationSchemaValidatesStructuredResult(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{"count":{"type":"integer","minimum":1}},"required":["count"],"additionalProperties":false}`)
	for _, test := range []struct {
		value string
		valid bool
	}{{`{"count":2}`, true}, {`{"count":"two"}`, false}, {`{"count":0}`, false}, {`{"other":3}`, false}, {"not json", false}, {`{"count":2} {"count":3}`, false}} {
		err := ValidateResult(schema, json.RawMessage(test.value))
		if (err == nil) != test.valid {
			t.Errorf("%s: error=%v", test.value, err)
		}
	}
}

func TestModelOperationSchemaRejectsExternalReferences(t *testing.T) {
	for _, ref := range []string{"file:///etc/passwd", "http://127.0.0.1:8080/private-schema"} {
		if _, err := CompileSchema(json.RawMessage(`{"$ref":"` + ref + `"}`)); err == nil {
			t.Errorf("external reference accepted: %s", ref)
		}
	}
	if _, err := CompileSchema(json.RawMessage(`{"$defs":{"answer":{"type":"string"}},"$ref":"#/$defs/answer"}`)); err != nil {
		t.Fatal(err)
	}
}
