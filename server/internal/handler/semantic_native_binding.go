package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/enact-ai/enact/server/internal/semantic"
)

func semanticNativeArtifact(raw json.RawMessage) bool {
	var artifact struct {
		Manifest struct {
			SourceKind string `json:"source_kind"`
		} `json:"manifest"`
	}
	return json.Unmarshal(raw, &artifact) == nil && artifact.Manifest.SourceKind == "semantica-native"
}

// Derived transport pins do not change the authored ontology contract. Every
// rule mapping, parameter, permission and operation remains part of that contract.
func semanticAuthoredBindings(bindings []semantic.Binding) string {
	copy := make([]semantic.Binding, len(bindings))
	for i, binding := range bindings {
		binding.ToolSchemaDigest = ""
		binding.CatalogRevisionID = ""
		if binding.Readback != nil {
			readback := *binding.Readback
			readback.ToolSchemaDigest = ""
			binding.Readback = &readback
		}
		copy[i] = binding
	}
	return semantic.Digest(copy)
}

func (h *Handler) semanticNativeCatalog(r *http.Request, actor semanticActor, c semantic.Connection, secret semantic.Secret) (semanticDiscoveredCatalog, error) {
	var catalog semanticDiscoveredCatalog
	if err := semanticValidateSourceEndpoint(c.Kind, c.Endpoint); err != nil {
		return catalog, err
	}
	raw, err := semanticService(r.Context(), "sources/discover", semanticSourcePayload(actor, c, secret))
	if err != nil {
		return catalog, err
	}
	if json.Unmarshal(raw, &catalog) != nil || len(catalog.Entries) == 0 || catalog.SourceDigest == "" {
		return catalog, errors.New("native discovery returned an invalid catalog")
	}
	return catalog, nil
}

func semanticCheckNativeBinding(binding *semantic.Binding, catalog semanticDiscoveredCatalog, action bool) error {
	if binding.CatalogEntryID == "" || binding.CatalogDigest == "" {
		return errors.New("native bindings require a discovered catalog entry and source digest")
	}
	if binding.CatalogDigest != catalog.SourceDigest {
		return errors.New("source catalog changed; rediscover and review the ontology binding before publishing or querying")
	}
	var entries []map[string]any
	if json.Unmarshal(catalog.Entries, &entries) != nil {
		return errors.New("invalid catalog entries")
	}
	var entry map[string]any
	tools := []any{}
	for _, candidate := range entries {
		if candidate["id"] == binding.CatalogEntryID {
			entry = candidate
		}
		if candidate["kind"] == "tool" {
			if metadata, ok := candidate["metadata"].(map[string]any); ok {
				tools = append(tools, metadata["descriptor"])
			}
		}
	}
	if entry == nil {
		return errors.New("binding entry is no longer visible to this connection principal")
	}
	want := "data"
	if action {
		want = "actions"
	}
	capabilities, _ := entry["capabilities"].([]any)
	allowed := false
	for _, capability := range capabilities {
		if capability == want {
			allowed = true
		}
	}
	if !allowed {
		return errors.New("catalog entry does not support this binding capability")
	}
	if entry["kind"] == "operation" {
		method := strings.ToUpper(binding.Method)
		if method == "" {
			method = "GET"
		}
		if entry["path"] != binding.Path || entry["method"] != method {
			return errors.New("binding path and method must match the discovered operation")
		}
	}
	if binding.Tool != "" {
		if entry["name"] != binding.Tool {
			return errors.New("binding tool must match the discovered tool")
		}
		if err := semantic.PinMCPBinding(binding, semanticMarshal(map[string]any{"tools": tools}), action); err != nil {
			return err
		}
	}
	return nil
}

func (h *Handler) semanticNativeRead(r *http.Request, actor semanticActor, release semanticRelease, runID string, c semantic.Connection, secret semantic.Secret, binding semantic.Binding, parameters map[string]any) (json.RawMessage, error) {
	if err := binding.CheckParameters(parameters); err != nil {
		return nil, err
	}
	catalog, err := h.semanticNativeCatalog(r, actor, c, secret)
	if err != nil {
		return nil, err
	}
	if err = semanticCheckNativeBinding(&binding, catalog, false); err != nil {
		return nil, err
	}
	payload := semanticSourcePayload(actor, c, secret)
	payload["scope"] = semanticRunScope(actor, release, runID)
	payload["binding"], payload["parameters"] = binding, parameters
	payload["entry_id"], payload["limit"] = binding.CatalogEntryID, 100
	raw, err := semanticService(r.Context(), "sources/read", payload)
	if err != nil {
		return nil, err
	}
	var result struct {
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(raw, &result) != nil || len(result.Data) == 0 {
		return nil, errors.New("native connector did not return query data")
	}
	return result.Data, nil
}
