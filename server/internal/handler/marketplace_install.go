package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/enact-ai/enact/server/internal/logger"
	agentpkg "github.com/enact-ai/enact/server/pkg/agent"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
	"github.com/enact-ai/enact/server/pkg/protocol"
)

// Installing a listing.
//
// An install is a copy, not a subscription. The skill, agent or MCP server that
// lands in the installing workspace is an ordinary row from that moment on: it
// is edited through the same editors as anything else, and a later version of
// the listing changes nothing until someone installs it. What the install
// leaves behind is a provenance record, which is what lets the product say "a
// newer version is available" without pretending to a live link that would
// overwrite local edits.
//
// Conflict handling reuses the skill importer's four strategies verbatim, for
// the same reason it has them: a workspace that installs the same listing twice
// is doing something ordinary and deserves a choice rather than an error.

// MarketplaceInstallRequest asks for one listing to be installed into the
// caller's workspace.
type MarketplaceInstallRequest struct {
	// VersionID picks a specific version; the listing's latest when omitted.
	VersionID string `json:"version_id"`
	// OnConflict mirrors the skill importer: fail | overwrite | rename | skip.
	OnConflict string `json:"on_conflict"`
	// Name overrides the published name. A workspace that already has a
	// "code-review" skill can install someone else's under its own name.
	Name string `json:"name"`
	// RuntimeID is required for an agent listing: a template names no machine,
	// so the installer picks one from its own workspace.
	RuntimeID string `json:"runtime_id"`
	// Secrets fills the values the publisher withheld, keyed by the paths in
	// the manifest's required_secrets — "env.GITHUB_TOKEN", "headers.X-Key",
	// "url". For an agent template, a server's paths are prefixed with its
	// name: "github/env.GITHUB_TOKEN".
	Secrets map[string]string `json:"secrets"`
}

// MarketplaceInstallResult is the outcome, shaped like SkillImportResult so the
// client can reuse the conflict dialog it already has.
type MarketplaceInstallResult struct {
	Status     string `json:"status"`
	Reason     string `json:"reason,omitempty"`
	EntityKind string `json:"entity_kind,omitempty"`
	EntityID   string `json:"entity_id,omitempty"`
	// Exactly one of these is populated, matching EntityKind.
	Skill     *SkillWithFilesResponse     `json:"skill,omitempty"`
	Agent     *AgentResponse              `json:"agent,omitempty"`
	McpServer *WorkspaceMcpServerResponse `json:"mcp_server,omitempty"`
	// ExistingSkill describes what an unresolved skill collision hit, so the
	// client can offer overwrite / rename / skip.
	ExistingSkill *ExistingSkillIdentity `json:"existing_skill,omitempty"`
}

// InstallMarketplaceListing copies a published listing into the caller's
// workspace.
func (h *Handler) InstallMarketplaceListing(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return
	}
	if actorType, _ := h.resolveActor(r, requestUserID(r), workspaceID); actorType == "agent" {
		writeError(w, http.StatusForbidden, "agents cannot install from the marketplace")
		return
	}
	member, ok := h.workspaceMember(w, r, workspaceID)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	listing, ok := h.loadMarketplaceListing(w, r, wsUUID)
	if !ok {
		return
	}
	if !marketplaceInstallable(listing) {
		writeError(w, http.StatusConflict, "this listing is not available to install")
		return
	}

	var req MarketplaceInstallRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	strategy := strings.TrimSpace(req.OnConflict)
	if strategy == "" {
		strategy = importOnConflictFail
	}
	if !validImportOnConflict(strategy) {
		writeError(w, http.StatusBadRequest, "on_conflict must be one of fail, overwrite, rename, skip")
		return
	}

	version, ok := h.resolveMarketplaceVersion(w, r, listing)
	if !ok {
		return
	}
	if req.VersionID != "" {
		versionUUID, parsed := parseUUIDOrBadRequest(w, strings.TrimSpace(req.VersionID), "version_id")
		if !parsed {
			return
		}
		found, err := h.Queries.GetMarketplaceListingVersion(r.Context(), versionUUID)
		if err != nil || found.ListingID != listing.ID {
			writeError(w, http.StatusNotFound, "version not found")
			return
		}
		version = &found
	}
	if version == nil {
		writeError(w, http.StatusConflict, "this listing has no published version")
		return
	}

	manifest, err := decodeMarketplaceManifest(version.Manifest, listing.Kind)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	files, err := h.marketplaceListingVersionFiles(r.Context(), version.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read the version's files")
		return
	}

	switch listing.Kind {
	case marketplaceKindSkill:
		h.installMarketplaceSkill(w, r, listing, *version, manifest, files, req, strategy, wsUUID, userID)
	case marketplaceKindMcp:
		h.installMarketplaceMcp(w, r, listing, *version, manifest, req, wsUUID, userID)
	case marketplaceKindAgent:
		h.installMarketplaceAgent(w, r, listing, *version, manifest, files, req, wsUUID, member, userID)
	default:
		writeError(w, http.StatusUnprocessableEntity, "this listing's kind cannot be installed")
	}
}

// marketplaceSkillOrigin is the provenance written into an installed skill's
// config. It is deliberately not one of the refreshable origin types: a
// marketplace update is an install of a chosen version, not a re-fetch of
// whatever a URL serves today, so `POST /skills/{id}/refresh` correctly
// declines it and the client offers the version picker instead.
func marketplaceSkillOrigin(listing db.MarketplaceListing, version db.MarketplaceListingVersion) map[string]any {
	return map[string]any{
		"type":       "marketplace",
		"listing_id": uuidToString(listing.ID),
		"version_id": uuidToString(version.ID),
		"version":    version.Version,
		"name":       listing.Name,
	}
}

// marketplaceSkillFiles splits a version's file set for one skill rooted at
// prefix: the SKILL.md body, and everything else as reference files.
func marketplaceSkillFiles(files []marketplaceFile, prefix, contentPath string) (string, []CreateSkillFileRequest) {
	if contentPath == "" {
		contentPath = skillContentPath
	}
	body := ""
	refs := []CreateSkillFileRequest{}
	for _, file := range files {
		if !strings.HasPrefix(file.Path, prefix) {
			continue
		}
		relative := strings.TrimPrefix(file.Path, prefix)
		if relative == contentPath {
			body = file.Content
			continue
		}
		// A published path is data from another workspace; it decides where a
		// file lands on a runtime's disk, so it is re-validated here rather
		// than trusted because the publish path checked it.
		if !validateFilePath(relative) {
			continue
		}
		refs = append(refs, CreateSkillFileRequest{Path: relative, Content: file.Content})
	}
	return body, refs
}

func (h *Handler) installMarketplaceSkill(
	w http.ResponseWriter, r *http.Request,
	listing db.MarketplaceListing, version db.MarketplaceListingVersion,
	manifest marketplaceManifest, files []marketplaceFile,
	req MarketplaceInstallRequest, strategy string,
	wsUUID pgtype.UUID, userID string,
) {
	if manifest.Skill == nil {
		writeError(w, http.StatusUnprocessableEntity, "the published manifest carries no skill")
		return
	}
	name := sanitizeNullBytes(strings.TrimSpace(req.Name))
	if name == "" {
		name = sanitizeNullBytes(manifest.Skill.Name)
	}
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	body, refs := marketplaceSkillFiles(files, "", manifest.Skill.ContentPath)
	config := map[string]any{"origin": marketplaceSkillOrigin(listing, version)}
	creatorUUID := parseUUID(userID)
	workspaceID := uuidToString(wsUUID)

	existing, found, err := h.lookupSkillByName(r.Context(), wsUUID, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check for an existing skill")
		return
	}
	if found {
		identity := existingSkillIdentity(existing, userID)
		switch strategy {
		case importOnConflictSkip:
			writeJSON(w, http.StatusOK, MarketplaceInstallResult{
				Status: "skipped", Reason: "a skill with this name already exists",
				ExistingSkill: &identity,
			})
			return
		case importOnConflictOverwrite:
			// Installing over a skill is the same act as re-importing over it,
			// so it follows the same creator-only rule (ENA-2701): a workspace
			// admin cannot replace someone else's skill by installing a listing
			// that happens to share its name.
			if !canOverwriteSkillByLocalImport(userID, existing) {
				writeJSON(w, http.StatusForbidden, MarketplaceInstallResult{
					Status: "failed", Reason: "only the skill creator can overwrite this skill",
					ExistingSkill: &identity,
				})
				return
			}
			resp, err := h.overwriteSkillWithFiles(r.Context(), skillOverwriteInput{
				WorkspaceID:   wsUUID,
				TargetSkillID: existing.ID,
				UserID:        userID,
				ExpectedName:  name,
				Description:   manifest.Skill.Description,
				Content:       body,
				Config:        config,
				Files:         refs,
			})
			if err != nil {
				status, reason := skillImportOverwriteFailure(err)
				writeJSON(w, status, MarketplaceInstallResult{Status: "failed", Reason: reason, ExistingSkill: &identity})
				return
			}
			h.recordMarketplaceInstall(r, listing, version, wsUUID, marketplaceKindSkill, parseUUID(resp.ID), userID)
			actorType, actorID := h.resolveActor(r, userID, workspaceID)
			h.publish(protocol.EventSkillUpdated, workspaceID, actorType, actorID, map[string]any{"skill": resp})
			writeJSON(w, http.StatusOK, MarketplaceInstallResult{
				Status: "updated", EntityKind: marketplaceKindSkill, EntityID: resp.ID, Skill: &resp,
			})
			return
		case importOnConflictRename:
			imported := &importedSkill{name: name, description: manifest.Skill.Description, content: body}
			resp, err := h.createRenamedImportedSkill(r.Context(), wsUUID, creatorUUID, name, imported, config, refs)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, MarketplaceInstallResult{
					Status: "failed", Reason: "failed to create a renamed skill: " + err.Error(),
					ExistingSkill: &identity,
				})
				return
			}
			h.recordMarketplaceInstall(r, listing, version, wsUUID, marketplaceKindSkill, parseUUID(resp.ID), userID)
			actorType, actorID := h.resolveActor(r, userID, workspaceID)
			h.publish(protocol.EventSkillCreated, workspaceID, actorType, actorID, map[string]any{"skill": resp})
			writeJSON(w, http.StatusCreated, MarketplaceInstallResult{
				Status: "created", Reason: "renamed to avoid an existing skill",
				EntityKind: marketplaceKindSkill, EntityID: resp.ID, Skill: &resp, ExistingSkill: &identity,
			})
			return
		default:
			writeJSON(w, http.StatusConflict, MarketplaceInstallResult{
				Status: "conflict", Reason: "a skill with this name already exists",
				ExistingSkill: &identity,
			})
			return
		}
	}

	resp, err := h.createSkillWithFiles(r.Context(), skillCreateInput{
		WorkspaceID: wsUUID,
		CreatorID:   creatorUUID,
		Name:        name,
		Description: manifest.Skill.Description,
		Content:     body,
		Config:      config,
		Files:       refs,
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeJSON(w, http.StatusConflict, MarketplaceInstallResult{
				Status: "conflict", Reason: "a skill with this name already exists",
			})
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to install the skill: "+err.Error())
		return
	}
	h.recordMarketplaceInstall(r, listing, version, wsUUID, marketplaceKindSkill, parseUUID(resp.ID), userID)
	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	h.publish(protocol.EventSkillCreated, workspaceID, actorType, actorID, map[string]any{"skill": resp})
	writeJSON(w, http.StatusCreated, MarketplaceInstallResult{
		Status: "created", EntityKind: marketplaceKindSkill, EntityID: resp.ID, Skill: &resp,
	})
}

func (h *Handler) installMarketplaceMcp(
	w http.ResponseWriter, r *http.Request,
	listing db.MarketplaceListing, version db.MarketplaceListingVersion,
	manifest marketplaceManifest, req MarketplaceInstallRequest,
	wsUUID pgtype.UUID, userID string,
) {
	if manifest.Mcp == nil {
		writeError(w, http.StatusUnprocessableEntity, "the published manifest carries no MCP server")
		return
	}
	// Adding a shared MCP server is an admin action wherever it happens, so
	// installing one is too — otherwise the marketplace would be a way around
	// requireWorkspaceMcpWriter.
	member, ok := h.workspaceMember(w, r, uuidToString(wsUUID))
	if !ok {
		return
	}
	if !roleAllowed(member.Role, "owner", "admin") {
		writeError(w, http.StatusForbidden, "only a workspace owner or admin can install an MCP server")
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = manifest.Mcp.Name
	}
	if err := validateWorkspaceMcpServerName(name); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	config, err := restoreMcpEntrySecrets(manifest.Mcp.Config, req.Secrets)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := validateWorkspaceMcpServerEntry(config); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	server, err := h.Queries.CreateWorkspaceMcpServer(r.Context(), db.CreateWorkspaceMcpServerParams{
		WorkspaceID: wsUUID,
		Name:        name,
		Config:      config,
		CreatedBy:   parseUUID(userID),
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeJSON(w, http.StatusConflict, MarketplaceInstallResult{
				Status: "conflict",
				Reason: "an MCP server named \"" + name + "\" already exists in this workspace",
			})
			return
		}
		slog.Warn("install marketplace mcp server failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to install the MCP server")
		return
	}
	h.recordMarketplaceInstall(r, listing, version, wsUUID, marketplaceKindMcp, server.ID, userID)
	resp := workspaceMcpServerToResponse(server)
	slog.Info("marketplace mcp server installed", append(logger.RequestAttrs(r),
		"listing_id", uuidToString(listing.ID), "server_id", uuidToString(server.ID), "name", server.Name)...)
	writeJSON(w, http.StatusCreated, MarketplaceInstallResult{
		Status: "created", EntityKind: marketplaceKindMcp, EntityID: resp.ID, McpServer: &resp,
	})
}

// installMarketplaceAgent materializes a template: the agent, the skills it
// carries, and the MCP servers it expects, in one transaction. A partially
// installed template — an agent whose skills failed to land — would look
// configured and behave wrongly, so nothing becomes visible until all of it
// does.
func (h *Handler) installMarketplaceAgent(
	w http.ResponseWriter, r *http.Request,
	listing db.MarketplaceListing, version db.MarketplaceListingVersion,
	manifest marketplaceManifest, files []marketplaceFile,
	req MarketplaceInstallRequest, wsUUID pgtype.UUID, member db.Member, userID string,
) {
	if manifest.Agent == nil {
		writeError(w, http.StatusUnprocessableEntity, "the published manifest carries no agent")
		return
	}
	template := manifest.Agent

	runtimeUUID, ok := parseUUIDOrBadRequest(w, strings.TrimSpace(req.RuntimeID), "runtime_id")
	if !ok {
		return
	}
	runtime, err := h.Queries.GetAgentRuntimeForWorkspace(r.Context(), db.GetAgentRuntimeForWorkspaceParams{
		ID:          runtimeUUID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid runtime_id")
		return
	}
	if !canUseRuntimeForAgent(member, runtime) {
		writeError(w, http.StatusForbidden, "this runtime is private; only its owner can create agents on it")
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = template.Name
	}
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	// A template written for one provider may name a model, effort level or
	// service tier the installer's runtime has never heard of. Dropping the
	// unsupported value installs a working agent the user can then tune;
	// refusing would make a Claude Code template uninstallable on Codex for a
	// field nobody chose. The response says what was dropped.
	dropped := []string{}
	thinking := template.ThinkingLevel
	if thinking != "" && !agentpkg.IsKnownThinkingValue(runtime.Provider, thinking) {
		dropped = append(dropped, "thinking level")
		thinking = ""
	}
	serviceTier := template.ServiceTier
	if serviceTier != "" && !agentpkg.IsKnownServiceTier(runtime.Provider, serviceTier) {
		dropped = append(dropped, "service tier")
		serviceTier = ""
	}

	avatarURL, ok := h.newAgentAvatar(w, r, template.AvatarURL)
	if !ok {
		return
	}
	customArgs, err := json.Marshal(template.CustomArgs)
	if err != nil || template.CustomArgs == nil {
		customArgs = []byte("[]")
	}
	maxConcurrent := template.MaxConcurrentTasks
	if maxConcurrent <= 0 {
		maxConcurrent = 1
	}

	// Every withheld value is restored before the transaction opens, so a bad
	// secret path fails the install without having written anything.
	type resolvedServer struct {
		Name   string
		Config []byte
	}
	servers := make([]resolvedServer, 0, len(template.McpServers))
	for _, entry := range template.McpServers {
		if err := validateWorkspaceMcpServerName(entry.Name); err != nil {
			writeError(w, http.StatusUnprocessableEntity,
				fmt.Sprintf("the template's MCP server %q has an unusable name: %s", entry.Name, err.Error()))
			return
		}
		config, err := restoreMcpEntrySecrets(entry.Config, scopedSecrets(req.Secrets, entry.Name))
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("%s: %s", entry.Name, err.Error()))
			return
		}
		if err := validateWorkspaceMcpServerEntry(config); err != nil {
			writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf("%s: %s", entry.Name, err.Error()))
			return
		}
		servers = append(servers, resolvedServer{Name: entry.Name, Config: config})
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to install the agent")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	if _, err := qtx.LockWorkspaceForChatSessionCreate(r.Context(), wsUUID); err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}

	// An installed agent is private to whoever installed it. The template's own
	// permission targets named members of another workspace and were never
	// published; starting private is the only answer that cannot over-share.
	created, err := qtx.CreateAgent(r.Context(), db.CreateAgentParams{
		WorkspaceID:        wsUUID,
		Name:               name,
		Description:        template.Description,
		Instructions:       template.Instructions,
		AvatarUrl:          avatarURL,
		RuntimeMode:        runtime.RuntimeMode,
		RuntimeConfig:      []byte("{}"),
		RuntimeID:          runtime.ID,
		Visibility:         "private",
		PermissionMode:     "private",
		MaxConcurrentTasks: maxConcurrent,
		OwnerID:            parseUUID(userID),
		CustomEnv:          []byte("{}"),
		CustomArgs:         customArgs,
		Model:              pgtype.Text{String: template.Model, Valid: template.Model != ""},
		ThinkingLevel:      pgtype.Text{String: thinking, Valid: thinking != ""},
		ServiceTier:        pgtype.Text{String: serviceTier, Valid: serviceTier != ""},
	})
	if err != nil {
		slog.Warn("install marketplace agent failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to install the agent")
		return
	}

	installedSkills := 0
	usedNames := map[string]bool{}
	for _, ref := range template.Skills {
		body, refs := marketplaceSkillFiles(files, ref.Dir+"/", skillContentPath)
		skillName, err := h.availableSkillName(r.Context(), qtx, wsUUID, sanitizeNullBytes(ref.Name), usedNames)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to install the template's skills")
			return
		}
		skill, err := createSkillWithFilesInTx(r.Context(), qtx, skillCreateInput{
			WorkspaceID: wsUUID,
			CreatorID:   parseUUID(userID),
			Name:        skillName,
			Description: ref.Description,
			Content:     body,
			Config:      map[string]any{"origin": marketplaceSkillOrigin(listing, version)},
			Files:       refs,
		})
		if err != nil {
			slog.Warn("install marketplace template skill failed",
				append(logger.RequestAttrs(r), "error", err, "skill", ref.Name)...)
			writeError(w, http.StatusInternalServerError, "failed to install the template's skills")
			return
		}
		if err := qtx.AddAgentSkill(r.Context(), db.AddAgentSkillParams{
			AgentID: created.ID,
			SkillID: parseUUID(skill.ID),
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to attach the template's skills")
			return
		}
		installedSkills++
	}

	installedServers := 0
	for _, server := range servers {
		name, err := h.availableMcpServerName(r.Context(), qtx, wsUUID, server.Name)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to install the template's MCP servers")
			return
		}
		row, err := qtx.CreateWorkspaceMcpServer(r.Context(), db.CreateWorkspaceMcpServerParams{
			WorkspaceID: wsUUID,
			Name:        name,
			Config:      server.Config,
			CreatedBy:   parseUUID(userID),
		})
		if err != nil {
			slog.Warn("install marketplace template mcp server failed",
				append(logger.RequestAttrs(r), "error", err, "server", server.Name)...)
			writeError(w, http.StatusInternalServerError, "failed to install the template's MCP servers")
			return
		}
		if err := qtx.AddAgentMcpServer(r.Context(), db.AddAgentMcpServerParams{
			AgentID:  created.ID,
			ServerID: row.ID,
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to attach the template's MCP servers")
			return
		}
		installedServers++
	}

	if _, err := qtx.CreateMarketplaceInstall(r.Context(), db.CreateMarketplaceInstallParams{
		ListingID:   listing.ID,
		VersionID:   version.ID,
		WorkspaceID: wsUUID,
		EntityKind:  marketplaceKindAgent,
		EntityID:    created.ID,
		InstalledBy: parseUUID(userID),
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to record the install")
		return
	}
	if err := qtx.IncrementMarketplaceInstallCount(r.Context(), listing.ID); err != nil {
		slog.Warn("increment marketplace install count failed", append(logger.RequestAttrs(r), "error", err)...)
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to install the agent")
		return
	}

	slog.Info("marketplace agent installed", append(logger.RequestAttrs(r),
		"listing_id", uuidToString(listing.ID), "agent_id", uuidToString(created.ID),
		"skills", installedSkills, "mcp_servers", installedServers)...)

	workspaceID := uuidToString(wsUUID)
	resp := h.agentToResponse(created)
	actorType, actorID := h.resolveActor(r, userID, workspaceID)
	h.publish(protocol.EventAgentCreated, workspaceID, actorType, actorID, map[string]any{"agent": resp})

	result := MarketplaceInstallResult{
		Status: "created", EntityKind: marketplaceKindAgent, EntityID: uuidToString(created.ID), Agent: &resp,
	}
	if len(dropped) > 0 {
		result.Reason = fmt.Sprintf("the template's %s is not supported by this runtime and was left unset",
			strings.Join(dropped, " and "))
	}
	writeJSON(w, http.StatusCreated, result)
}

// scopedSecrets narrows an agent template's flat secret map to one server. The
// caller keys them as "<server name>/<path>"; a bare path is accepted too, so a
// template with a single server does not force the prefix.
func scopedSecrets(secrets map[string]string, server string) map[string]string {
	scoped := map[string]string{}
	prefix := server + "/"
	for key, value := range secrets {
		switch {
		case strings.HasPrefix(key, prefix):
			scoped[strings.TrimPrefix(key, prefix)] = value
		case !strings.Contains(key, "/"):
			scoped[key] = value
		}
	}
	return scoped
}

// availableSkillName finds a free name for a template's skill. A template
// installed into a workspace that already has a "code-review" skill must not
// fail wholesale, and must not overwrite the existing one either — the two are
// different skills that happen to share a name.
func (h *Handler) availableSkillName(ctx context.Context, qtx *db.Queries, workspaceID pgtype.UUID, name string, used map[string]bool) (string, error) {
	if name == "" {
		name = "skill"
	}
	candidate := name
	for suffix := 2; suffix < maxImportRenameAttempts+2; suffix++ {
		if !used[candidate] {
			_, err := qtx.GetSkillByWorkspaceAndName(ctx, db.GetSkillByWorkspaceAndNameParams{
				WorkspaceID: workspaceID,
				Name:        candidate,
			})
			if marketplaceRowMissing(err) {
				used[candidate] = true
				return candidate, nil
			}
			if err != nil {
				return "", err
			}
		}
		candidate = fmt.Sprintf("%s-%d", name, suffix)
	}
	return "", errors.New("no available skill name")
}

// availableMcpServerName is the same rule for the MCP library, which is unique
// on (workspace_id, name) for the same reason: the name is what an agent's
// runtime sees.
func (h *Handler) availableMcpServerName(ctx context.Context, qtx *db.Queries, workspaceID pgtype.UUID, name string) (string, error) {
	servers, err := h.Queries.ListWorkspaceMcpServers(ctx, workspaceID)
	if err != nil {
		return "", err
	}
	taken := map[string]bool{}
	for _, server := range servers {
		taken[server.Name] = true
	}
	candidate := name
	for suffix := 2; taken[candidate]; suffix++ {
		candidate = fmt.Sprintf("%s-%d", name, suffix)
		if suffix > maxImportRenameAttempts {
			return "", errors.New("no available MCP server name")
		}
	}
	return candidate, nil
}

// recordMarketplaceInstall writes the provenance record and bumps the counter.
// Neither is load-bearing for the install itself, so a failure here is logged
// and the install still reports success: the entity is in the workspace either
// way, and refusing it to protect a counter would be the wrong trade.
func (h *Handler) recordMarketplaceInstall(
	r *http.Request, listing db.MarketplaceListing, version db.MarketplaceListingVersion,
	workspaceID pgtype.UUID, entityKind string, entityID pgtype.UUID, userID string,
) {
	if _, err := h.Queries.CreateMarketplaceInstall(r.Context(), db.CreateMarketplaceInstallParams{
		ListingID:   listing.ID,
		VersionID:   version.ID,
		WorkspaceID: workspaceID,
		EntityKind:  entityKind,
		EntityID:    entityID,
		InstalledBy: parseUUID(userID),
	}); err != nil {
		slog.Warn("record marketplace install failed", append(logger.RequestAttrs(r), "error", err)...)
		return
	}
	if err := h.Queries.IncrementMarketplaceInstallCount(r.Context(), listing.ID); err != nil {
		slog.Warn("increment marketplace install count failed", append(logger.RequestAttrs(r), "error", err)...)
	}
}
