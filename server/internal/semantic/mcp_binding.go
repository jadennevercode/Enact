package semantic

import (
	"encoding/json"
	"errors"
)

func mcpDescriptor(raw json.RawMessage, name string) (map[string]any, error) {
	var catalog struct {
		Tools []map[string]any `json:"tools"`
	}
	if json.Unmarshal(raw, &catalog) != nil {
		return nil, errors.New("invalid MCP tool catalog")
	}
	for _, tool := range catalog.Tools {
		if tool["name"] == name {
			return tool, nil
		}
	}
	return nil, errors.New("MCP binding tool is absent from discovery")
}

// Publication freezes tool semantics. Runtime rediscovery rejects schema drift
// before executing either an action or its independent readback.
func PinMCPBinding(binding *Binding, discovery json.RawMessage, action bool) error {
	tool, err := mcpDescriptor(discovery, binding.Tool)
	if err != nil {
		return err
	}
	annotations, _ := tool["annotations"].(map[string]any)
	if !action {
		if annotations["readOnlyHint"] != true {
			return errors.New("MCP data binding must declare readOnlyHint=true")
		}
		binding.ToolSchemaDigest = Digest(tool)
		return nil
	}
	if annotations["idempotentHint"] != true {
		return errors.New("MCP action must declare idempotentHint=true")
	}
	schema, _ := tool["inputSchema"].(map[string]any)
	properties, _ := schema["properties"].(map[string]any)
	if _, exists := properties[binding.IdempotencyParameter]; !exists {
		return errors.New("MCP action schema must expose its idempotency_parameter")
	}
	binding.ToolSchemaDigest = Digest(tool)
	read, err := mcpDescriptor(discovery, binding.Readback.Tool)
	if err != nil {
		return err
	}
	readAnnotations, _ := read["annotations"].(map[string]any)
	if readAnnotations["readOnlyHint"] != true {
		return errors.New("MCP readback tool must declare readOnlyHint=true")
	}
	binding.Readback.ToolSchemaDigest = Digest(read)
	return nil
}
