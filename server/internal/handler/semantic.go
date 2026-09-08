package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/enact-ai/enact/server/internal/util/secretbox"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type semanticActor struct {
	WorkspaceID string
	UserID      string
	Role        string
	ActorType   string
	ActorID     string
	TaskID      *string
}

// semanticScope deliberately rechecks membership on every call. An App, agent,
// or an old browser tab does not keep access after membership is revoked.
func (h *Handler) semanticScope(w http.ResponseWriter, r *http.Request, admin bool) (semanticActor, bool) {
	user, ok := requireUserID(w, r)
	if !ok {
		return semanticActor{}, false
	}
	ws := h.resolveWorkspaceID(r)
	if _, err := uuid.Parse(ws); err != nil {
		writeError(w, 400, "workspace is required")
		return semanticActor{}, false
	}
	member, ok := h.requireWorkspaceMember(w, r, ws, "workspace not found")
	if !ok {
		return semanticActor{}, false
	}
	actorType, actorID := h.resolveActor(r, user, ws)
	if r.Header.Get("X-Actor-Source") == "cloud_pat" {
		writeError(w, 403, "semantic operations require a human or a delegated task identity")
		return semanticActor{}, false
	}
	if admin && (isMachineCredentialActor(r) || actorType == "agent" || !roleAllowed(member.Role, "owner", "admin")) {
		writeError(w, 403, "a workspace owner or admin must manage semantic configuration")
		return semanticActor{}, false
	}
	var taskID *string
	if r.Header.Get("X-Actor-Source") == "task_token" {
		value := r.Header.Get("X-Task-ID")
		if _, err := uuid.Parse(value); err != nil {
			writeError(w, 403, "task identity unavailable")
			return semanticActor{}, false
		}
		taskID = &value
	}
	return semanticActor{WorkspaceID: ws, UserID: user, Role: member.Role, ActorType: actorType, ActorID: actorID, TaskID: taskID}, true
}

func semanticDecode(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 12<<20)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(dst); err != nil {
		writeError(w, 400, "invalid JSON request")
		return false
	}
	if decoder.Decode(new(any)) != io.EOF {
		writeError(w, 400, "request must contain one JSON value")
		return false
	}
	return true
}

func semanticParam(w http.ResponseWriter, r *http.Request, name string) (string, bool) {
	value := chi.URLParam(r, name)
	if _, err := uuid.Parse(value); err != nil {
		writeError(w, 400, "invalid "+name)
		return "", false
	}
	return value, true
}
func semanticMarshal(value any) json.RawMessage { raw, _ := json.Marshal(value); return raw }

func (h *Handler) RegisterSemanticRoutes(r chi.Router) {
	r.Route("/api/semantic", func(r chi.Router) {
		h.RegisterSemanticFamilyRoutes(r)
		r.Get("/connectors", h.semanticConnectors)
		r.Get("/connections", h.semanticConnections)
		r.Post("/connections", h.semanticCreateConnection)
		r.Put("/connections/{id}", h.semanticUpdateConnection)
		r.Post("/connections/{id}/test", h.semanticTestConnection)
		r.Post("/connections/{id}/disable", h.semanticDisableConnection)
		r.Post("/connections/{id}/discover", h.semanticDiscoverSource)
		r.Get("/connections/{id}/catalog", h.semanticSourceCatalog)
		r.Post("/connections/{id}/preview", h.semanticPreviewSource)
		r.Get("/connections/{id}/snapshots", h.semanticSourceSnapshots)
		r.Post("/connections/{id}/snapshots", h.semanticCreateSourceSnapshot)
		r.Get("/ontologies", h.semanticOntologies)
		r.Post("/ontologies", h.semanticCreateOntology)
		r.Get("/ontologies/{id}", h.semanticGetOntology)
		r.Put("/ontologies/{id}", h.semanticUpdateOntology)
		r.Post("/ontologies/{id}/native", h.semanticNativeOntology)
		r.Get("/ontologies/{id}/revisions", h.semanticOntologyRevisions)
		r.Post("/ontologies/{id}/preview", h.semanticPreviewOntology)
		r.Post("/ontologies/{id}/query", h.semanticDraftQuery)
		r.Post("/ontologies/{id}/evaluate", h.semanticDraftEvaluate)
		r.Post("/ontologies/{id}/graph", h.semanticDraftGraph)
		r.Get("/ontologies/{id}/releases", h.semanticReleases)
		r.Post("/ontologies/{id}/releases", h.semanticPublishRelease)
		r.Post("/releases/{id}/retire", h.semanticRetireRelease)
		r.Get("/runs", h.semanticRuns)
		r.Post("/runs", h.semanticCreateRun)
		r.Get("/runs/{id}", h.semanticGetRun)
		r.Get("/runs/{id}/trace", h.semanticRunTrace)
		r.Post("/runs/{id}/delegate", h.semanticDelegateRun)
		r.Post("/runs/{id}/query", h.semanticQuery)
		r.Post("/runs/{id}/evaluate", h.semanticEvaluate)
		r.Post("/runs/{id}/steps/{stepID}/resume", h.semanticResumeStep)
		r.Post("/runs/{id}/actions", h.semanticPrepareAction)
		r.Post("/approvals/{id}/decide", h.semanticDecide)
		r.Post("/approvals/{id}/execute", h.semanticExecute)
		r.Get("/receipts/{id}", h.semanticGetReceipt)
		r.Post("/receipts/{id}/reconcile", h.semanticReconcile)
		h.registerSemanticApplicationRoutes(r)
	})
}

func (h *Handler) semanticRows(w http.ResponseWriter, r *http.Request, sql string, args ...any) {
	rows, err := h.DB.Query(r.Context(), sql, args...)
	if err != nil {
		writeError(w, 500, "failed to load semantic records")
		return
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var raw json.RawMessage
		if err = rows.Scan(&raw); err != nil {
			writeError(w, 500, "failed to read semantic record")
			return
		}
		out = append(out, raw)
	}
	if rows.Err() != nil {
		writeError(w, 500, "failed to read semantic records")
		return
	}
	writeJSON(w, 200, out)
}

func (h *Handler) semanticRow(w http.ResponseWriter, r *http.Request, status int, sql string, args ...any) {
	var raw json.RawMessage
	var err error
	if strings.HasPrefix(strings.TrimSpace(sql), "SELECT") {
		err = h.DB.QueryRow(r.Context(), sql, args...).Scan(&raw)
	} else {
		var tx pgx.Tx
		tx, err = h.TxStarter.Begin(r.Context())
		if err == nil {
			defer tx.Rollback(r.Context())
			var workspace string
			if len(args) == 0 {
				err = errors.New("workspace is required")
			} else {
				err = tx.QueryRow(r.Context(), "SELECT id::text FROM workspace WHERE id=$1 FOR SHARE", args[0]).Scan(&workspace)
			}
			if err == nil {
				err = tx.QueryRow(r.Context(), sql, args...).Scan(&raw)
			}
			if err == nil {
				err = tx.Commit(r.Context())
			}
		}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 404, "semantic record not found")
		return
	}
	if err != nil {
		writeError(w, 500, "failed to save or load semantic record")
		return
	}
	writeJSON(w, status, raw)
}

func semanticAdapter() semantic.Adapter {
	return semantic.Adapter{AllowedOrigins: strings.Split(os.Getenv("ENACT_SEMANTIC_ALLOWED_ORIGINS"), ",")}
}
func semanticBox() (*secretbox.Box, error) {
	key, err := secretbox.LoadKey("ENACT_SEMANTIC_SECRET_KEY")
	if err != nil {
		return nil, errors.New("semantic credential encryption is not configured")
	}
	return secretbox.New(key)
}

func (h *Handler) semanticConnection(ctx context.Context, ws, id string) (semantic.Connection, semantic.Secret, error) {
	var c semantic.Connection
	var raw []byte
	var encrypted []byte
	var capabilities []byte
	err := h.DB.QueryRow(ctx, "SELECT id::text,workspace_id::text,name,kind,endpoint,config,secret,capabilities FROM semantic_connection WHERE workspace_id=$1 AND id=$2 AND enabled", ws, id).Scan(&c.ID, &c.WorkspaceID, &c.Name, &c.Kind, &c.Endpoint, &raw, &encrypted, &capabilities)
	if err != nil {
		return c, semantic.Secret{}, errors.New("connection not found in this workspace")
	}
	_ = json.Unmarshal(raw, &c.Config)
	_ = json.Unmarshal(capabilities, &c.Capabilities)
	var secret semantic.Secret
	if len(encrypted) > 0 {
		box, err := semanticBox()
		if err != nil {
			return c, secret, err
		}
		plain, err := box.Open(encrypted)
		if err != nil {
			return c, secret, errors.New("connection credential is unavailable")
		}
		if json.Unmarshal(plain, &secret) != nil {
			return c, secret, errors.New("connection credential is invalid")
		}
	}
	c.CredentialRevision = semantic.Digest(map[string]any{"secret": secret, "endpoint": c.Endpoint, "config": c.Config, "kind": c.Kind})
	return c, secret, nil
}

func (h *Handler) semanticConnections(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	h.semanticRows(w, r, "SELECT to_jsonb(c)-'secret'-'created_by' FROM semantic_connection c WHERE workspace_id=$1 ORDER BY created_at DESC", actor.WorkspaceID)
}

type semanticConnectionRequest struct {
	Name         string           `json:"name"`
	Kind         string           `json:"kind"`
	Endpoint     string           `json:"endpoint"`
	Config       map[string]any   `json:"config"`
	Secret       *semantic.Secret `json:"secret"`
	Enabled      *bool            `json:"enabled"`
	Capabilities []string         `json:"capabilities"`
}

func (h *Handler) semanticSaveConnection(w http.ResponseWriter, r *http.Request, update bool) {
	actor, ok := h.semanticScope(w, r, true)
	if !ok {
		return
	}
	var input semanticConnectionRequest
	if !semanticDecode(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Name) == "" {
		writeError(w, 400, "name is required")
		return
	}
	if !semanticConnectorKnown(input.Kind) {
		writeError(w, 400, "kind must identify an installed source connector")
		return
	}
	if err := semanticValidateSourceEndpoint(input.Kind, input.Endpoint); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	var encrypted []byte
	if input.Secret != nil {
		box, err := semanticBox()
		if err != nil {
			writeError(w, 503, err.Error())
			return
		}
		encrypted, err = box.Seal(semanticMarshal(input.Secret))
		if err != nil {
			writeError(w, 500, "failed to encrypt connection credential")
			return
		}
	}
	if input.Config == nil {
		input.Config = map[string]any{}
	}
	if !h.semanticValidateLinkedResource(w, r, actor.WorkspaceID, input.Config) {
		return
	}
	if len(input.Capabilities) == 0 {
		input.Capabilities = semanticDefaultCapabilities(input.Kind)
	}
	for _, capability := range input.Capabilities {
		if capability != "knowledge" && capability != "data" && capability != "actions" {
			writeError(w, 400, "unknown source capability")
			return
		}
	}
	if update {
		id, ok := semanticParam(w, r, "id")
		if !ok {
			return
		}
		h.semanticRow(w, r, 200, "UPDATE semantic_connection SET name=$3,kind=$4,endpoint=$5,config=$6,secret=COALESCE($7,secret),enabled=COALESCE($8,enabled),capabilities=$9 WHERE workspace_id=$1 AND id=$2 RETURNING to_jsonb(semantic_connection)-'secret'-'created_by'", actor.WorkspaceID, id, input.Name, input.Kind, input.Endpoint, semanticMarshal(input.Config), encrypted, input.Enabled, semanticMarshal(input.Capabilities))
		return
	}
	h.semanticRow(w, r, 201, "INSERT INTO semantic_connection(workspace_id,name,kind,endpoint,config,secret,created_by,capabilities) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING to_jsonb(semantic_connection)-'secret'-'created_by'", actor.WorkspaceID, input.Name, input.Kind, input.Endpoint, semanticMarshal(input.Config), encrypted, actor.UserID, semanticMarshal(input.Capabilities))
}
func (h *Handler) semanticCreateConnection(w http.ResponseWriter, r *http.Request) {
	h.semanticSaveConnection(w, r, false)
}
func (h *Handler) semanticUpdateConnection(w http.ResponseWriter, r *http.Request) {
	h.semanticSaveConnection(w, r, true)
}
func (h *Handler) semanticTestConnection(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, true)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok {
		return
	}
	c, s, err := h.semanticConnection(r.Context(), actor.WorkspaceID, id)
	if err != nil {
		writeError(w, 404, err.Error())
		return
	}
	s, err = semantic.CredentialFor(c, s, actor.UserID, actor.Role, false)
	if err != nil {
		writeError(w, 403, err.Error())
		return
	}
	result, err := semanticService(r.Context(), "sources/discover", semanticSourcePayload(actor, c, s))
	if err != nil {
		writeError(w, 502, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "discovery": result, "checked_at": time.Now().UTC()})
}

func semanticService(ctx context.Context, operation string, payload any) (json.RawMessage, error) {
	return semanticServiceRequest(ctx, http.MethodPost, operation, payload)
}

func semanticServiceRequest(ctx context.Context, method, operation string, payload any) (json.RawMessage, error) {
	base := strings.TrimRight(os.Getenv("ENACT_SEMANTIC_SERVICE_URL"), "/")
	if base == "" {
		return nil, errors.New("ENACT_SEMANTIC_SERVICE_URL is not configured")
	}
	request, err := http.NewRequestWithContext(ctx, method, base+"/v1/"+operation, bytes.NewReader(semanticMarshal(payload)))
	if err != nil {
		return nil, errors.New("semantic service URL is invalid")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Semantic-Service-Key", os.Getenv("ENACT_SEMANTIC_SERVICE_KEY"))
	client := &http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error {
		return errors.New("semantic service redirects are not allowed")
	}}
	response, err := client.Do(request)
	if err != nil {
		return nil, errors.New("semantic service is unavailable")
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, (12<<20)+1))
	if err != nil {
		return nil, errors.New("semantic service response could not be read")
	}
	if len(raw) > 12<<20 {
		return nil, errors.New("semantic service response exceeds size limit")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, errors.New("semantic service rejected the request: " + string(raw))
	}
	if !json.Valid(raw) {
		return nil, errors.New("semantic service returned invalid JSON")
	}
	return raw, nil
}
