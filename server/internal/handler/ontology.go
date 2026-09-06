package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/enact-ai/enact/server/internal/skillversion"
	"github.com/enact-ai/enact/server/internal/util"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	defaultCapHubAPIURL = "http://127.0.0.1:8000"
	defaultCapHubURL    = "http://127.0.0.1:13000"
	maxCapHubJSONBytes  = 8 << 20
	maxOntologyZipBytes = 32 << 20
)

type capHubDomainSummary struct {
	Name            string  `json:"name"`
	NameZh          *string `json:"name_zh"`
	Version         string  `json:"version"`
	Description     string  `json:"description"`
	DescriptionZh   *string `json:"description_zh"`
	EntityCount     int     `json:"entity_count"`
	ActionCount     int     `json:"action_count"`
	PolicyCount     int     `json:"policy_count"`
	IsLayered       bool    `json:"is_layered"`
	CapabilityCount int     `json:"capability_count"`
}

type capHubNamedItem struct {
	Name          string  `json:"name"`
	NameZh        *string `json:"name_zh"`
	Description   *string `json:"description"`
	DescriptionZh *string `json:"description_zh"`
}

type capHubDomainDetail struct {
	Name          string            `json:"name"`
	NameZh        *string           `json:"name_zh"`
	Version       string            `json:"version"`
	Description   string            `json:"description"`
	DescriptionZh *string           `json:"description_zh"`
	IsLayered     bool              `json:"is_layered"`
	Entities      []capHubNamedItem `json:"entities"`
	Actions       []capHubNamedItem `json:"actions"`
	Policies      []capHubNamedItem `json:"policies"`
	Capabilities  []capHubNamedItem `json:"capabilities"`
}

type OntologySummaryResponse struct {
	Name            string  `json:"name"`
	NameZh          *string `json:"name_zh,omitempty"`
	Version         string  `json:"version"`
	Description     string  `json:"description"`
	DescriptionZh   *string `json:"description_zh,omitempty"`
	EntityCount     int     `json:"entity_count"`
	ActionCount     int     `json:"action_count"`
	PolicyCount     int     `json:"policy_count"`
	IsLayered       bool    `json:"is_layered"`
	CapabilityCount int     `json:"capability_count"`
	CapHubURL       string  `json:"caphub_url"`
	// Attached is whether this workspace already holds a skill projected from
	// this domain — the ontology's equivalent of "installed" in the
	// Marketplace, where it sits beside listings that are.
	Attached bool `json:"attached"`
}

type OntologyDetailResponse struct {
	OntologySummaryResponse
	Entities     []capHubNamedItem `json:"entities"`
	Actions      []capHubNamedItem `json:"actions"`
	Policies     []capHubNamedItem `json:"policies"`
	Capabilities []capHubNamedItem `json:"capabilities"`
	Preview      string            `json:"preview"`
}

type capHubHTTPError struct {
	Status int
}

func (e capHubHTTPError) Error() string {
	return fmt.Sprintf("CapHub returned HTTP %d", e.Status)
}

func (h *Handler) capHubAPIURL() string {
	if value := strings.TrimRight(strings.TrimSpace(h.cfg.CapHubAPIURL), "/"); value != "" {
		return value
	}
	return defaultCapHubAPIURL
}

func (h *Handler) capHubURL() string {
	if value := strings.TrimRight(strings.TrimSpace(h.cfg.CapHubURL), "/"); value != "" {
		return value
	}
	return defaultCapHubURL
}

func (h *Handler) capHubDomainURL(domain string) string {
	joined, err := url.JoinPath(h.capHubURL(), "domains", domain)
	if err != nil {
		return h.capHubURL()
	}
	return joined
}

func (h *Handler) newCapHubRequest(ctx context.Context, route string) (*http.Request, error) {
	target, err := url.JoinPath(h.capHubAPIURL(), route)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	if h.cfg.CapHubAPIKey != "" {
		req.Header.Set("X-API-Key", h.cfg.CapHubAPIKey)
	}
	return req, nil
}

func (h *Handler) fetchCapHubJSON(ctx context.Context, route string, dst any) error {
	req, err := h.newCapHubRequest(ctx, route)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return capHubHTTPError{Status: resp.StatusCode}
	}
	return json.NewDecoder(io.LimitReader(resp.Body, maxCapHubJSONBytes)).Decode(dst)
}

func ontologySummary(domain capHubDomainSummary, capHubURL string) OntologySummaryResponse {
	return OntologySummaryResponse{
		Name:            domain.Name,
		NameZh:          domain.NameZh,
		Version:         domain.Version,
		Description:     domain.Description,
		DescriptionZh:   domain.DescriptionZh,
		EntityCount:     domain.EntityCount,
		ActionCount:     domain.ActionCount,
		PolicyCount:     domain.PolicyCount,
		IsLayered:       domain.IsLayered,
		CapabilityCount: domain.CapabilityCount,
		CapHubURL:       capHubURL,
	}
}

func (h *Handler) writeCapHubError(w http.ResponseWriter, err error) {
	var upstream capHubHTTPError
	if errors.As(err, &upstream) && upstream.Status == http.StatusNotFound {
		writeError(w, http.StatusNotFound, "ontology not found")
		return
	}
	writeJSON(w, http.StatusBadGateway, map[string]string{
		"code":  "caphub_unavailable",
		"error": "CapHub ontology catalog is unavailable",
	})
}

func (h *Handler) ListOntologies(w http.ResponseWriter, r *http.Request) {
	var domains []capHubDomainSummary
	if err := h.fetchCapHubJSON(r.Context(), "/api/domains", &domains); err != nil {
		h.writeCapHubError(w, err)
		return
	}
	attached := h.attachedOntologyDomains(r)
	out := make([]OntologySummaryResponse, len(domains))
	for i, domain := range domains {
		out[i] = ontologySummary(domain, h.capHubDomainURL(domain.Name))
		out[i].Attached = attached[domain.Name]
	}
	writeJSON(w, http.StatusOK, out)
}

// attachedOntologyDomains is the set of domains the caller's workspace has
// already projected into a skill, read once for the whole catalog. Advisory:
// a workspace that cannot be resolved, or whose skills cannot be read, gets a
// catalog with nothing marked rather than no catalog.
func (h *Handler) attachedOntologyDomains(r *http.Request) map[string]bool {
	attached := map[string]bool{}
	wsUUID, err := util.ParseUUID(h.resolveWorkspaceID(r))
	if err != nil {
		return attached
	}
	skills, err := h.Queries.ListSkillSummariesByWorkspace(r.Context(), wsUUID)
	if err != nil {
		return attached
	}
	for _, skill := range skills {
		config := parseStoredOntologyConfig(skill.Config)
		if config.Kind == "ontology" && config.Ontology.Domain != "" {
			attached[config.Ontology.Domain] = true
		}
	}
	return attached
}

func (h *Handler) GetOntology(w http.ResponseWriter, r *http.Request) {
	domainName := strings.TrimSpace(chi.URLParam(r, "domain"))
	if domainName == "" {
		writeError(w, http.StatusBadRequest, "ontology name is required")
		return
	}
	var domain capHubDomainDetail
	if err := h.fetchCapHubJSON(r.Context(), "/api/domains/"+url.PathEscape(domainName), &domain); err != nil {
		h.writeCapHubError(w, err)
		return
	}
	bundle, err := h.fetchOntologyBundle(r.Context(), domainName)
	if err != nil {
		h.writeCapHubError(w, err)
		return
	}
	summary := capHubDomainSummary{
		Name:            domain.Name,
		NameZh:          domain.NameZh,
		Version:         domain.Version,
		Description:     domain.Description,
		DescriptionZh:   domain.DescriptionZh,
		EntityCount:     len(domain.Entities),
		ActionCount:     len(domain.Actions),
		PolicyCount:     len(domain.Policies),
		IsLayered:       domain.IsLayered,
		CapabilityCount: len(domain.Capabilities),
	}
	writeJSON(w, http.StatusOK, OntologyDetailResponse{
		OntologySummaryResponse: ontologySummary(summary, h.capHubDomainURL(domain.Name)),
		Entities:                domain.Entities,
		Actions:                 domain.Actions,
		Policies:                domain.Policies,
		Capabilities:            domain.Capabilities,
		Preview:                 bundle.Content,
	})
}

type ontologyBundle struct {
	Content string
	Files   []CreateSkillFileRequest
}

func (h *Handler) fetchOntologyBundle(ctx context.Context, domain string) (ontologyBundle, error) {
	req, err := h.newCapHubRequest(ctx, "/api/domains/"+url.PathEscape(domain)+"/skill-package.zip")
	if err != nil {
		return ontologyBundle{}, err
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return ontologyBundle{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ontologyBundle{}, capHubHTTPError{Status: resp.StatusCode}
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxOntologyZipBytes+1))
	if err != nil {
		return ontologyBundle{}, err
	}
	if len(data) > maxOntologyZipBytes {
		return ontologyBundle{}, fmt.Errorf("ontology package exceeds %d bytes", maxOntologyZipBytes)
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return ontologyBundle{}, err
	}
	bundle := ontologyBundle{Files: []CreateSkillFileRequest{}}
	for _, file := range archive.File {
		if file.FileInfo().IsDir() {
			continue
		}
		clean := path.Clean(file.Name)
		parts := strings.Split(clean, "/")
		if len(parts) < 2 || strings.HasPrefix(clean, "../") {
			continue
		}
		relative := strings.Join(parts[1:], "/")
		if !validateFilePath(relative) {
			return ontologyBundle{}, fmt.Errorf("invalid ontology package path %q", relative)
		}
		reader, err := file.Open()
		if err != nil {
			return ontologyBundle{}, err
		}
		content, readErr := io.ReadAll(io.LimitReader(reader, maxImportFileSize+1))
		closeErr := reader.Close()
		if readErr != nil {
			return ontologyBundle{}, readErr
		}
		if closeErr != nil {
			return ontologyBundle{}, closeErr
		}
		if len(content) > maxImportFileSize {
			return ontologyBundle{}, fmt.Errorf("ontology file %q exceeds %d bytes", relative, maxImportFileSize)
		}
		if strings.EqualFold(relative, "SKILL.md") {
			bundle.Content = string(content)
			continue
		}
		bundle.Files = append(bundle.Files, CreateSkillFileRequest{Path: relative, Content: string(content)})
	}
	if bundle.Content == "" {
		return ontologyBundle{}, errors.New("ontology package has no entry document")
	}
	return bundle, nil
}

type storedOntologyConfig struct {
	Kind     string `json:"kind"`
	Ontology struct {
		Domain string `json:"domain"`
	} `json:"ontology"`
}

func parseStoredOntologyConfig(config []byte) storedOntologyConfig {
	var parsed storedOntologyConfig
	_ = json.Unmarshal(config, &parsed)
	return parsed
}

func skillConfigKind(config []byte) string {
	return parseStoredOntologyConfig(config).Kind
}

func skillConfigOntologyDomain(config []byte) string {
	return parseStoredOntologyConfig(config).Ontology.Domain
}

func ontologySkillConfig(domain capHubDomainDetail, capHubURL string) map[string]any {
	return map[string]any{
		"kind": "ontology",
		"ontology": map[string]any{
			"provider": "caphub",
			"domain":   domain.Name,
			"version":  domain.Version,
			"url":      capHubURL,
		},
	}
}

func ontologySkillName(domain string) string {
	normalized := strings.NewReplacer("_", "-", " ", "-").Replace(strings.ToLower(domain))
	return "ontology-" + normalized
}

func (h *Handler) findOntologySkill(ctx context.Context, workspaceID pgtype.UUID, domain string) (pgtype.UUID, bool, error) {
	skills, err := h.Queries.ListSkillSummariesByWorkspace(ctx, workspaceID)
	if err != nil {
		return pgtype.UUID{}, false, err
	}
	for _, skill := range skills {
		config := parseStoredOntologyConfig(skill.Config)
		if config.Kind == "ontology" && config.Ontology.Domain == domain {
			return skill.ID, true, nil
		}
	}
	return pgtype.UUID{}, false, nil
}

func (h *Handler) AttachAgentOntology(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.loadAgentForUser(w, r, chi.URLParam(r, "id"))
	if !ok || !h.canManageAgent(w, r, agent) {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	domainName := strings.TrimSpace(chi.URLParam(r, "domain"))
	var domain capHubDomainDetail
	if err := h.fetchCapHubJSON(r.Context(), "/api/domains/"+url.PathEscape(domainName), &domain); err != nil {
		h.writeCapHubError(w, err)
		return
	}
	bundle, err := h.fetchOntologyBundle(r.Context(), domainName)
	if err != nil {
		h.writeCapHubError(w, err)
		return
	}
	config := ontologySkillConfig(domain, h.capHubDomainURL(domain.Name))
	skillID, exists, err := h.findOntologySkill(r.Context(), agent.WorkspaceID, domain.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load workspace ontologies")
		return
	}
	if exists {
		if _, err := h.overwriteSkillWithFiles(r.Context(), skillOverwriteInput{
			WorkspaceID:    agent.WorkspaceID,
			TargetSkillID:  skillID,
			UserID:         userID,
			AllowOverwrite: func(string, db.Skill) bool { return true },
			Description:    domain.Description,
			Content:        bundle.Content,
			Config:         config,
			Files:          bundle.Files,
			Source:         skillversion.SourceImport,
			ActorID:        parseUUID(userID),
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to sync ontology")
			return
		}
		if err := h.Queries.AddAgentSkill(r.Context(), db.AddAgentSkillParams{AgentID: agent.ID, SkillID: skillID}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to attach ontology")
			return
		}
	} else {
		tx, err := h.TxStarter.Begin(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to start transaction")
			return
		}
		defer tx.Rollback(r.Context())
		qtx := h.Queries.WithTx(tx)
		created, err := createSkillWithFilesInTx(r.Context(), qtx, skillCreateInput{
			WorkspaceID: agent.WorkspaceID,
			CreatorID:   parseUUID(userID),
			Name:        ontologySkillName(domain.Name),
			Description: domain.Description,
			Content:     bundle.Content,
			Config:      config,
			Files:       bundle.Files,
			Source:      skillversion.SourceImport,
		})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to import ontology")
			return
		}
		skillID = parseUUID(created.ID)
		if err := qtx.AddAgentSkill(r.Context(), db.AddAgentSkillParams{AgentID: agent.ID, SkillID: skillID}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to attach ontology")
			return
		}
		if err := tx.Commit(r.Context()); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to commit ontology attachment")
			return
		}
	}
	h.writeUpdatedAgentSkills(w, r, agent)
}

func (h *Handler) loadAgentOntologySkill(w http.ResponseWriter, r *http.Request, agent db.Agent) (db.Skill, bool) {
	skillID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "skillId"), "ontology id")
	if !ok {
		return db.Skill{}, false
	}
	skill, err := h.Queries.GetSkillInWorkspace(r.Context(), db.GetSkillInWorkspaceParams{
		ID: skillID, WorkspaceID: agent.WorkspaceID,
	})
	if err != nil || skillConfigKind(skill.Config) != "ontology" {
		writeError(w, http.StatusNotFound, "ontology not found")
		return db.Skill{}, false
	}
	return skill, true
}

func (h *Handler) SetAgentOntologyEnabled(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.loadAgentForUser(w, r, chi.URLParam(r, "id"))
	if !ok || !h.canManageAgent(w, r, agent) {
		return
	}
	skill, ok := h.loadAgentOntologySkill(w, r, agent)
	if !ok {
		return
	}
	var req struct {
		Enabled *bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Enabled == nil {
		writeError(w, http.StatusBadRequest, "enabled is required")
		return
	}
	rows, err := h.Queries.SetAgentSkillEnabled(r.Context(), db.SetAgentSkillEnabledParams{
		AgentID: agent.ID, SkillID: skill.ID, Enabled: *req.Enabled,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update ontology")
		return
	}
	if rows == 0 {
		writeError(w, http.StatusNotFound, "agent ontology not found")
		return
	}
	h.writeUpdatedAgentSkills(w, r, agent)
}

func (h *Handler) RemoveAgentOntology(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.loadAgentForUser(w, r, chi.URLParam(r, "id"))
	if !ok || !h.canManageAgent(w, r, agent) {
		return
	}
	skill, ok := h.loadAgentOntologySkill(w, r, agent)
	if !ok {
		return
	}
	if err := h.Queries.RemoveAgentSkill(r.Context(), db.RemoveAgentSkillParams{AgentID: agent.ID, SkillID: skill.ID}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove ontology")
		return
	}
	h.writeUpdatedAgentSkills(w, r, agent)
}
