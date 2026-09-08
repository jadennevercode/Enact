// Package semantic supplies the bounded execution adapters for Enact's semantic control plane.
// Ontology artifacts are immutable inputs; no adapter mutates the ontology or invents facts.
package semantic

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type Secret struct {
	Credentials     map[string]any        `json:"credentials,omitempty"`
	Headers         map[string]string     `json:"headers,omitempty"`
	DSN             string                `json:"dsn,omitempty"`
	Roles           []string              `json:"roles,omitempty"`
	UserCredentials map[string]Credential `json:"user_credentials,omitempty"`
}
type Credential struct {
	Credentials map[string]any    `json:"credentials,omitempty"`
	Headers     map[string]string `json:"headers,omitempty"`
	DSN         string            `json:"dsn,omitempty"`
	Roles       []string          `json:"roles,omitempty"`
}

func CredentialFor(c Connection, s Secret, user, workspaceRole string, write bool) (Secret, error) {
	if credential, ok := s.UserCredentials[user]; ok {
		return Secret{Credentials: credential.Credentials, Headers: credential.Headers, DSN: credential.DSN, Roles: credential.Roles}, nil
	}
	if len(s.UserCredentials) > 0 {
		return Secret{}, errors.New("no connection credential is assigned to this user")
	}
	if write {
		if c.Config["credential_mode"] != "service" || c.Config["service_actions_allowed"] != true {
			return Secret{}, errors.New("a user credential or explicit service action authorization is required")
		}
		allowed := false
		if roles, ok := c.Config["service_roles"].([]any); ok {
			for _, role := range roles {
				if role == workspaceRole {
					allowed = true
				}
			}
		}
		if !allowed {
			return Secret{}, errors.New("this workspace role may not use the service action credential")
		}
	}
	return s, nil
}

type Connection struct {
	ID                 string         `json:"id"`
	WorkspaceID        string         `json:"workspace_id"`
	Name               string         `json:"name"`
	Kind               string         `json:"kind"`
	Endpoint           string         `json:"endpoint"`
	Config             map[string]any `json:"config"`
	Capabilities       []string       `json:"capabilities"`
	CreatedAt          string         `json:"created_at,omitempty"`
	CredentialRevision string         `json:"-"`
}

type Authorization struct {
	Mode  string   `json:"mode"`
	Roles []string `json:"roles,omitempty"`
}

type Readback struct {
	Path             string         `json:"path,omitempty"`
	Tool             string         `json:"tool,omitempty"`
	Arguments        map[string]any `json:"arguments,omitempty"`
	ToolSchemaDigest string         `json:"tool_schema_digest,omitempty"`
	// Expected compares response fields to literal values after parameter substitution.
	Expected map[string]any `json:"expected,omitempty"`
}

type Binding struct {
	ID                   string           `json:"id"`
	Kind                 string           `json:"kind,omitempty"`
	ConnectionID         string           `json:"connection_id"`
	Method               string           `json:"method,omitempty"`
	Path                 string           `json:"path,omitempty"`
	SQL                  string           `json:"sql,omitempty"`
	Arguments            []string         `json:"arguments,omitempty"`
	Tool                 string           `json:"tool,omitempty"`
	ToolSchemaDigest     string           `json:"tool_schema_digest,omitempty"`
	IdempotencyParameter string           `json:"idempotency_parameter,omitempty"`
	Description          string           `json:"description,omitempty"`
	Authorization        Authorization    `json:"authorization,omitempty"`
	Readback             *Readback        `json:"readback,omitempty"`
	RequiredParameters   []string         `json:"required_parameters,omitempty"`
	AllowedRoles         []string         `json:"allowed_roles,omitempty"`
	BodyParameters       *[]string        `json:"body_parameters,omitempty"`
	OntologyIRI          string           `json:"ontology_iri,omitempty"`
	CatalogEntryID       string           `json:"catalog_entry_id,omitempty"`
	CatalogRevisionID    string           `json:"catalog_revision_id,omitempty"`
	CatalogDigest        string           `json:"catalog_digest,omitempty"`
	ResultMapping        map[string]any   `json:"result_mapping,omitempty"`
	FactMappings         []map[string]any `json:"fact_mappings,omitempty"`
}

type Bindings struct {
	Data    []Binding `json:"data_bindings"`
	Actions []Binding `json:"action_bindings"`
}

func (b Bindings) Find(id string, action bool) (Binding, error) {
	list := b.Data
	if action {
		list = b.Actions
	}
	for _, item := range list {
		if item.ID == id {
			return item, nil
		}
	}
	return Binding{}, errors.New("binding is not present in the pinned ontology release")
}

func (b Bindings) Validate() error {
	seen := map[string]bool{}
	for _, list := range [][]Binding{b.Data, b.Actions} {
		for _, item := range list {
			if strings.TrimSpace(item.ID) == "" || strings.TrimSpace(item.ConnectionID) == "" {
				return errors.New("each binding requires id and connection_id")
			}
			if seen[item.ID] {
				return fmt.Errorf("duplicate binding %s", item.ID)
			}
			seen[item.ID] = true
			if item.Path != "" && (!strings.HasPrefix(item.Path, "/") || strings.HasPrefix(item.Path, "//") || strings.Contains(item.Path, "..")) {
				return fmt.Errorf("binding %s path must stay inside its connection", item.ID)
			}
		}
	}
	for _, item := range b.Data {
		if item.Method != "" && strings.ToUpper(item.Method) != "GET" {
			return errors.New("data bindings require GET; writes must be action bindings")
		}
	}
	for _, item := range b.Actions {
		if item.SQL != "" {
			return errors.New("PostgreSQL action bindings are not supported; use a system operation API")
		}
		if item.Readback == nil || len(item.Readback.Expected) == 0 {
			return fmt.Errorf("action %s requires explicit readback completion conditions", item.ID)
		}
		switch item.Authorization.Mode {
		case "allow", "confirm":
		case "role":
			if len(item.Authorization.Roles) == 0 {
				return errors.New("role authorization requires roles")
			}
		default:
			return fmt.Errorf("action %s requires explicit allow, confirm or role authorization", item.ID)
		}
		if item.Tool != "" {
			if item.Path != "" || item.IdempotencyParameter == "" || item.Readback == nil || item.Readback.Tool == "" || len(item.Readback.Expected) == 0 {
				return fmt.Errorf("MCP action %s requires idempotency_parameter and a readback tool with completion conditions", item.ID)
			}
			continue
		}
		if item.Readback == nil || !strings.HasPrefix(item.Readback.Path, "/") || strings.HasPrefix(item.Readback.Path, "//") || strings.Contains(item.Readback.Path, "..") {
			return fmt.Errorf("action %s requires a connection-relative readback path", item.ID)
		}
		switch strings.ToUpper(item.Method) {
		case "POST", "PUT", "PATCH", "DELETE":
		default:
			return fmt.Errorf("action %s requires an explicit write method", item.ID)
		}
	}
	return nil
}

func HasRole(roles []string, role string) bool {
	for _, r := range roles {
		if r == role {
			return true
		}
	}
	return false
}
func (b Binding) CheckParameters(params map[string]any) error {
	for _, key := range b.RequiredParameters {
		value, ok := params[key]
		empty := !ok || value == nil
		if text, isString := value.(string); isString && text == "" {
			empty = true
		}
		if empty {
			return fmt.Errorf("parameter %s is required", key)
		}
	}
	return nil
}
func Digest(value any) string {
	raw, _ := json.Marshal(value)
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func Lookup(value any, path string) (any, bool) {
	current := value
	for _, part := range strings.Split(path, ".") {
		object, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		current, ok = object[part]
		if !ok {
			return nil, false
		}
	}
	return current, true
}
