package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func semanticConnectorKnown(kind string) bool {
	switch kind {
	case "file", "cloud", "web", "git", "postgres", "mysql", "sqlite", "sql", "database", "rest", "openapi", "parquet", "databricks", "snowflake", "sap", "mcp", "email", "stream", "feed", "public_api", "arrow", "xml", "salesforce", "mongodb", "duckdb", "elasticsearch", "gdrive", "huggingface", "pandas":
		return true
	default:
		return false
	}
}

func semanticDefaultCapabilities(kind string) []string {
	switch kind {
	case "git", "file", "cloud", "web", "email":
		return []string{"knowledge"}
	case "rest", "openapi", "mcp":
		return []string{"data", "actions"}
	default:
		return []string{"data"}
	}
}

func semanticValidateSourceEndpoint(kind, endpoint string) error {
	u, err := url.Parse(endpoint)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("source endpoint must not contain credentials, query or fragment")
	}
	if kind == "file" || kind == "parquet" || kind == "sqlite" || (kind == "git" && u.Scheme == "file") {
		if u.Scheme != "file" || u.Host != "" || !filepath.IsAbs(u.Path) {
			return errors.New("local sources require an approved absolute file URL")
		}
		resolved, err := filepath.EvalSymlinks(u.Path)
		if err != nil {
			return errors.New("source path is unavailable on the server")
		}
		for _, root := range filepath.SplitList(os.Getenv("ENACT_SEMANTIC_ALLOWED_PATHS")) {
			allowed, err := filepath.EvalSymlinks(root)
			if err != nil {
				continue
			}
			rel, err := filepath.Rel(allowed, resolved)
			if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				return nil
			}
		}
		return errors.New("source path is outside ENACT_SEMANTIC_ALLOWED_PATHS")
	}
	if u.Scheme == "" || u.Host == "" {
		return errors.New("source endpoint requires a scheme and host")
	}
	switch u.Scheme {
	case "http", "https", "postgres", "postgresql", "mysql", "mariadb", "mssql", "oracle", "snowflake", "databricks", "imap", "imaps", "pop3", "pop3s", "kafka", "amqp", "amqps", "pulsar", "s3", "gs", "azure":
	default:
		return errors.New("unsupported source endpoint scheme")
	}
	origin := u.Scheme + "://" + u.Host
	for _, allowed := range strings.Split(os.Getenv("ENACT_SEMANTIC_ALLOWED_ORIGINS"), ",") {
		if strings.TrimRight(strings.TrimSpace(allowed), "/") == origin {
			return nil
		}
	}
	return errors.New("source origin is not approved by ENACT_SEMANTIC_ALLOWED_ORIGINS")
}

func (h *Handler) semanticSourceActor(w http.ResponseWriter, r *http.Request, admin bool) (semanticActor, bool) {
	actor, ok := h.semanticScope(w, r, admin)
	if ok && actor.ActorType == "agent" {
		ok = h.semanticTaskPrincipal(w, r, &actor)
	}
	return actor, ok
}

func (h *Handler) semanticSourceConnection(w http.ResponseWriter, r *http.Request, actor semanticActor) (semantic.Connection, semantic.Secret, bool) {
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return semantic.Connection{}, semantic.Secret{}, false
	}
	c, s, err := h.semanticConnection(r.Context(), actor.WorkspaceID, id)
	if err != nil {
		writeError(w, 404, err.Error())
		return c, s, false
	}
	if err = semanticValidateSourceEndpoint(c.Kind, c.Endpoint); err != nil {
		writeError(w, 403, err.Error())
		return c, s, false
	}
	s, err = semantic.CredentialFor(c, s, actor.UserID, actor.Role, false)
	if err != nil {
		writeError(w, 403, err.Error())
		return c, s, false
	}
	return c, s, true
}

func semanticSourcePayload(actor semanticActor, c semantic.Connection, s semantic.Secret) map[string]any {
	credentials := map[string]any{}
	for key, value := range s.Credentials {
		credentials[key] = value
	}
	if len(s.Headers) > 0 {
		credentials["headers"] = s.Headers
	}
	if s.DSN != "" {
		credentials["dsn"] = s.DSN
	}
	allowedOrigins := strings.Split(os.Getenv("ENACT_SEMANTIC_ALLOWED_ORIGINS"), ",")
	for _, root := range filepath.SplitList(os.Getenv("ENACT_SEMANTIC_ALLOWED_PATHS")) {
		if root != "" {
			allowedOrigins = append(allowedOrigins, (&url.URL{Scheme: "file", Path: root}).String())
		}
	}
	return map[string]any{
		"scope":        map[string]string{"workspace_id": actor.WorkspaceID, "ontology_id": c.ID, "release_id": "catalog"},
		"connector_id": c.Kind, "endpoint": c.Endpoint, "config": c.Config, "credentials": credentials,
		"allowed_origins": allowedOrigins,
	}
}

func (h *Handler) semanticConnectors(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.semanticScope(w, r, false); !ok {
		return
	}
	raw, err := semanticServiceRequest(r.Context(), http.MethodGet, "connectors", nil)
	if err != nil {
		writeError(w, 502, err.Error())
		return
	}
	writeJSON(w, 200, raw)
}

type semanticDiscoveredCatalog struct {
	Entries        json.RawMessage `json:"entries"`
	Warnings       json.RawMessage `json:"warnings"`
	SourceDigest   string          `json:"source_digest"`
	SourceRevision string          `json:"source_revision"`
	State          string          `json:"state"`
	NativeModule   string          `json:"native_module"`
	Metadata       map[string]any  `json:"metadata"`
}

func (h *Handler) semanticDiscoverSource(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticSourceActor(w, r, false)
	if !ok {
		return
	}
	c, s, ok := h.semanticSourceConnection(w, r, actor)
	if !ok {
		return
	}
	raw, err := semanticService(r.Context(), "sources/discover", semanticSourcePayload(actor, c, s))
	if err != nil {
		writeError(w, 422, err.Error())
		return
	}
	var result semanticDiscoveredCatalog
	if json.Unmarshal(raw, &result) != nil || len(result.Entries) == 0 || (result.State != "ready" && result.State != "partial") {
		writeError(w, 502, "connector returned an invalid discovery result")
		return
	}
	if result.SourceDigest == "" {
		result.SourceDigest = semantic.Digest(result.Entries)
	}
	if len(result.Warnings) == 0 {
		result.Warnings = json.RawMessage(`[]`)
	}
	if result.Metadata == nil {
		result.Metadata = map[string]any{}
	}
	result.Metadata["native_module"] = result.NativeModule
	h.semanticRow(w, r, 201, `INSERT INTO semantic_catalog_revision(workspace_id,connection_id,principal_id,credential_revision,source_digest,source_revision,state,entries,warnings,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING to_jsonb(semantic_catalog_revision)-'credential_revision'-'principal_id'`, actor.WorkspaceID, c.ID, actor.UserID, c.CredentialRevision, result.SourceDigest, result.SourceRevision, result.State, result.Entries, result.Warnings, semanticMarshal(result.Metadata))
}

func (h *Handler) semanticSourceCatalog(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticSourceActor(w, r, false)
	if !ok {
		return
	}
	c, _, ok := h.semanticSourceConnection(w, r, actor)
	if !ok {
		return
	}
	var raw json.RawMessage
	err := h.DB.QueryRow(r.Context(), `SELECT to_jsonb(c)-'credential_revision'-'principal_id' || jsonb_build_object('stale',false) FROM semantic_catalog_revision c WHERE workspace_id=$1 AND connection_id=$2 AND principal_id=$3 AND credential_revision=$4 ORDER BY created_at DESC LIMIT 1`, actor.WorkspaceID, c.ID, actor.UserID, c.CredentialRevision).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, 200, map[string]any{"state": "undiscovered", "entries": []any{}, "warnings": []any{}})
			return
		}
		writeError(w, 500, "failed to load source catalog")
		return
	}
	writeJSON(w, 200, raw)
}

func (h *Handler) semanticPreviewSource(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticSourceActor(w, r, false)
	if !ok {
		return
	}
	c, s, ok := h.semanticSourceConnection(w, r, actor)
	if !ok {
		return
	}
	var input struct {
		EntryID    string         `json:"entry_id"`
		Limit      int            `json:"limit"`
		Parameters map[string]any `json:"parameters"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	if input.Limit == 0 {
		input.Limit = 20
	}
	if input.EntryID == "" || input.Limit < 1 || input.Limit > 100 {
		writeError(w, 400, "entry_id and a limit between 1 and 100 are required")
		return
	}
	var entries []map[string]any
	var raw json.RawMessage
	err := h.DB.QueryRow(r.Context(), `SELECT entries FROM semantic_catalog_revision WHERE workspace_id=$1 AND connection_id=$2 AND principal_id=$3 AND credential_revision=$4 ORDER BY created_at DESC LIMIT 1`, actor.WorkspaceID, c.ID, actor.UserID, c.CredentialRevision).Scan(&raw)
	if err != nil || json.Unmarshal(raw, &entries) != nil {
		writeError(w, 409, "discover the current source catalog before previewing")
		return
	}
	var entry map[string]any
	for _, item := range entries {
		if item["id"] == input.EntryID {
			entry = item
			break
		}
	}
	if entry == nil {
		writeError(w, 404, "catalog entry not found")
		return
	}
	if entry["kind"] == "action" {
		writeError(w, 400, "system actions are described in the catalog and cannot be previewed as reads")
		return
	}
	payload := semanticSourcePayload(actor, c, s)
	payload["entry_id"], payload["limit"], payload["parameters"] = input.EntryID, input.Limit, input.Parameters
	result, err := semanticService(r.Context(), "sources/preview", payload)
	if err != nil {
		writeError(w, 422, err.Error())
		return
	}
	writeJSON(w, 200, result)
}

func (h *Handler) semanticSourceSnapshots(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticSourceActor(w, r, false)
	if !ok {
		return
	}
	c, _, ok := h.semanticSourceConnection(w, r, actor)
	if !ok {
		return
	}
	h.semanticRows(w, r, `SELECT to_jsonb(s)-'credential_revision'-'principal_id' FROM semantic_source_snapshot s WHERE workspace_id=$1 AND connection_id=$2 AND principal_id=$3 ORDER BY created_at DESC LIMIT 50`, actor.WorkspaceID, c.ID, actor.UserID)
}

func (h *Handler) semanticCreateSourceSnapshot(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticSourceActor(w, r, false)
	if !ok {
		return
	}
	c, s, ok := h.semanticSourceConnection(w, r, actor)
	if !ok {
		return
	}
	var input struct {
		Paths []string `json:"paths"`
		Ref   string   `json:"ref"`
	}
	if !semanticDecode(w, r, &input) {
		return
	}
	config := map[string]any{}
	for key, value := range c.Config {
		config[key] = value
	}
	if len(input.Paths) > 0 {
		config["paths"] = input.Paths
	}
	if input.Ref != "" {
		config["ref"] = input.Ref
	}
	c.Config = config
	raw, err := semanticService(r.Context(), "sources/ingest", semanticSourcePayload(actor, c, s))
	if err != nil {
		writeError(w, 422, err.Error())
		return
	}
	var result struct {
		Documents      []map[string]any `json:"documents"`
		SourceDigest   string           `json:"source_digest"`
		SourceRevision string           `json:"source_revision"`
		Metadata       map[string]any   `json:"metadata"`
	}
	if json.Unmarshal(raw, &result) != nil || len(result.Documents) == 0 || result.SourceDigest == "" {
		writeError(w, 422, "source ingestion produced no versioned documents")
		return
	}
	if result.Metadata == nil {
		result.Metadata = map[string]any{}
	}
	h.semanticRow(w, r, 201, `INSERT INTO semantic_source_snapshot(workspace_id,connection_id,principal_id,credential_revision,source_digest,source_revision,documents,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING to_jsonb(semantic_source_snapshot)-'credential_revision'-'principal_id'`, actor.WorkspaceID, c.ID, actor.UserID, c.CredentialRevision, result.SourceDigest, result.SourceRevision, semanticMarshal(result.Documents), semanticMarshal(result.Metadata))
}

func (h *Handler) semanticValidateLinkedResource(w http.ResponseWriter, r *http.Request, ws string, config map[string]any) bool {
	ref, _ := config["resource_id"].(string)
	if ref == "" {
		return true
	}
	if _, err := uuid.Parse(ref); err != nil {
		writeError(w, 400, "resource_id must be a UUID")
		return false
	}
	var exists bool
	if err := h.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM workspace_resource WHERE workspace_id=$1 AND id=$2 AND resource_type='knowledge_repo')`, ws, ref).Scan(&exists); err != nil || !exists {
		writeError(w, 404, "knowledge source not found in this workspace")
		return false
	}
	return true
}
