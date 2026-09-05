package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Per-agent knowledge base bindings.
//
// A knowledge base is a workspace resource (resource_type=knowledge_repo) that
// reaches a run only through the agent that claimed it. Attaching one here is
// the whole switch: an agent with no bindings gets no knowledge section in its
// brief and pays nothing for the feature, and detaching is how you turn it off.
// There is no workspace-level toggle beside it, for the same reason the
// Retrospect Agent has none — a flag and a binding can disagree, and then
// nobody can say why a run did or did not see the knowledge base.

// AgentKnowledgeSourceResponse is one binding as the UI and CLI see it.
//
// It carries the resource's own fields rather than a resource id the client
// would have to resolve, because every consumer wants the URL and the path:
// the settings tab renders them, and `enact agent knowledge list` prints them.
type AgentKnowledgeSourceResponse struct {
	ResourceID string  `json:"resource_id"`
	URL        string  `json:"url"`
	Ref        string  `json:"ref,omitempty"`
	Path       string  `json:"path,omitempty"`
	Delivery   string  `json:"delivery"`
	Label      *string `json:"label"`
}

func knowledgeResourceToResponse(row db.WorkspaceResource) AgentKnowledgeSourceResponse {
	var payload knowledgeRepoRef
	_ = json.Unmarshal(row.ResourceRef, &payload)
	return AgentKnowledgeSourceResponse{
		ResourceID: uuidToString(row.ID),
		URL:        strings.TrimSpace(payload.URL),
		Ref:        strings.TrimSpace(payload.Ref),
		Path:       payload.Path,
		Delivery:   knowledgeDelivery(row.ResourceRef),
		Label:      textToPtr(row.Label),
	}
}

// AttachAgentKnowledgeRequest is the body for POST /api/agents/{id}/knowledge.
type AttachAgentKnowledgeRequest struct {
	ResourceID string `json:"resource_id"`
}

// ListAgentKnowledge returns the knowledge bases bound to this agent.
func (h *Handler) ListAgentKnowledge(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.loadAgentForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return
	}
	rows, err := h.Queries.ListAgentResourcesOfType(r.Context(), db.ListAgentResourcesOfTypeParams{
		AgentID:      agent.ID,
		ResourceType: knowledgeRepoResourceType,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list agent knowledge bases")
		return
	}
	resp := make([]AgentKnowledgeSourceResponse, len(rows))
	for i, row := range rows {
		resp[i] = knowledgeResourceToResponse(row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"knowledge_sources": resp, "total": len(resp)})
}

// AttachAgentKnowledge binds a knowledge base to this agent.
func (h *Handler) AttachAgentKnowledge(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.loadAgentForUser(w, r, chi.URLParam(r, "id"))
	if !ok || !h.canManageAgent(w, r, agent) {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	var req AttachAgentKnowledgeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	resource, ok := h.loadKnowledgeResourceForAgent(w, r, agent, strings.TrimSpace(req.ResourceID))
	if !ok {
		return
	}
	creator, _ := h.parseUserUUIDOrZero(userID)
	if err := h.Queries.AddAgentResource(r.Context(), db.AddAgentResourceParams{
		AgentID:    agent.ID,
		ResourceID: resource.ID,
		CreatedBy:  creator,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to attach knowledge base")
		return
	}
	h.writeAgentKnowledgeList(w, r, agent)
}

// RemoveAgentKnowledge unbinds a knowledge base from this agent. The resource
// itself stays on the workspace — other agents may still be bound to it, and
// removing it entirely is a Settings action, not an agent one.
func (h *Handler) RemoveAgentKnowledge(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.loadAgentForUser(w, r, chi.URLParam(r, "id"))
	if !ok || !h.canManageAgent(w, r, agent) {
		return
	}
	resourceID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "resourceId"), "resource id")
	if !ok {
		return
	}
	if err := h.Queries.RemoveAgentResource(r.Context(), db.RemoveAgentResourceParams{
		AgentID:    agent.ID,
		ResourceID: resourceID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove knowledge base")
		return
	}
	h.writeAgentKnowledgeList(w, r, agent)
}

// loadKnowledgeResourceForAgent resolves a resource id from the request body
// and refuses anything that is not a knowledge base in this agent's workspace.
//
// Both halves matter. The workspace check is the authorization boundary — an
// id from another workspace must not become context in this one. The type
// check keeps the binding table meaning one thing: binding a github_repo here
// would create a code resource that reaches only some agents, which is exactly
// the split migration 438 removed.
func (h *Handler) loadKnowledgeResourceForAgent(w http.ResponseWriter, r *http.Request, agent db.Agent, resourceID string) (db.WorkspaceResource, bool) {
	if resourceID == "" {
		writeError(w, http.StatusBadRequest, "resource_id is required")
		return db.WorkspaceResource{}, false
	}
	parsed, ok := parseUUIDOrBadRequest(w, resourceID, "resource_id")
	if !ok {
		return db.WorkspaceResource{}, false
	}
	resource, err := h.Queries.GetWorkspaceResourceInWorkspace(r.Context(), db.GetWorkspaceResourceInWorkspaceParams{
		ID: parsed, WorkspaceID: agent.WorkspaceID,
	})
	if err != nil {
		writeError(w, http.StatusNotFound, "knowledge base not found")
		return db.WorkspaceResource{}, false
	}
	if resource.ResourceType != knowledgeRepoResourceType {
		writeError(w, http.StatusBadRequest, "resource is not a knowledge base")
		return db.WorkspaceResource{}, false
	}
	return resource, true
}

func (h *Handler) writeAgentKnowledgeList(w http.ResponseWriter, r *http.Request, agent db.Agent) {
	rows, err := h.Queries.ListAgentResourcesOfType(r.Context(), db.ListAgentResourcesOfTypeParams{
		AgentID:      agent.ID,
		ResourceType: knowledgeRepoResourceType,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list agent knowledge bases")
		return
	}
	resp := make([]AgentKnowledgeSourceResponse, len(rows))
	for i, row := range rows {
		resp[i] = knowledgeResourceToResponse(row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"knowledge_sources": resp, "total": len(resp)})
}

// agentKnowledgeSummaries is used by the agent detail response so the UI can
// show bindings without a second request.
func (h *Handler) agentKnowledgeSummaries(r *http.Request, agentID pgtype.UUID) []AgentKnowledgeSourceResponse {
	rows, err := h.Queries.ListAgentResourcesOfType(r.Context(), db.ListAgentResourcesOfTypeParams{
		AgentID:      agentID,
		ResourceType: knowledgeRepoResourceType,
	})
	if err != nil || len(rows) == 0 {
		return nil
	}
	out := make([]AgentKnowledgeSourceResponse, len(rows))
	for i, row := range rows {
		out[i] = knowledgeResourceToResponse(row)
	}
	return out
}
