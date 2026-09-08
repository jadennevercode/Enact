// Package modeloperation defines the structured model boundary shared by the
// semantic API and the daemon. It has no dependency on task dispatch or tools.
package modeloperation

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

type Operation struct {
	ID             string          `json:"id"`
	WorkspaceID    string          `json:"workspace_id"`
	TaskID         string          `json:"task_id"`
	RuntimeID      string          `json:"runtime_id"`
	Provider       string          `json:"provider"`
	Model          string          `json:"model"`
	Prompt         string          `json:"prompt"`
	ResponseSchema json.RawMessage `json:"response_schema"`
	TimeoutSeconds int             `json:"timeout_seconds"`
	Status         string          `json:"status"`
	LeaseToken     string          `json:"lease_token,omitempty"`
}

type denyLoader struct{}

func (denyLoader) Load(url string) (any, error) {
	return nil, fmt.Errorf("external schema references are forbidden")
}

// CompileSchema supports local definitions, but never fetches network URLs or
// filesystem references supplied by a caller.
func CompileSchema(raw json.RawMessage) (*jsonschema.Schema, error) {
	if len(raw) == 0 || len(raw) > 256<<10 {
		return nil, fmt.Errorf("response_schema is required and must be at most 256 KiB")
	}
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	if _, ok := doc.(map[string]any); !ok {
		return nil, fmt.Errorf("response_schema must be an object")
	}
	c := jsonschema.NewCompiler()
	c.UseLoader(denyLoader{})
	const uri = "https://enact.invalid/model-operation.schema.json"
	if err := c.AddResource(uri, doc); err != nil {
		return nil, err
	}
	return c.Compile(uri)
}

func ValidateResult(schema, result json.RawMessage) error {
	s, err := CompileSchema(schema)
	if err != nil {
		return err
	}
	if len(result) > 8<<20 {
		return fmt.Errorf("model result exceeds 8 MiB")
	}
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(result))
	if err != nil {
		return fmt.Errorf("model output is not JSON: %w", err)
	}
	return s.Validate(value)
}
