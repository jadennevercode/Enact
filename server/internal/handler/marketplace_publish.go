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
	skillpkg "github.com/enact-ai/enact/server/internal/skill"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
)

// Publishing a listing.
//
// The one structural decision here: the client names a workspace entity by id
// and the server reads it. The client never uploads the content it wants
// published. That is what makes the redaction in marketplace_sanitize.go
// trustworthy — there is no path by which a caller can hand us a manifest with
// a credential already inside it and have us store it verbatim.
//
// The second decision: a publish is idempotent per (workspace, kind, slug). A
// second publish under the same handle adds a version to the listing that is
// already there rather than minting a second identity, so the reader's link
// keeps working and the version history stays in one place.

// maxMarketplaceBundleBytes caps one version's file set. It matches the skill
// importer's own bundle cap, so a skill that could be imported can always be
// published and a skill that could not was never in the workspace to begin
// with.
const maxMarketplaceBundleBytes = 8 << 20

// maxMarketplaceEmbeddedSkills caps how many skills an agent template carries.
// Past this the template is a workspace, not a template.
const maxMarketplaceEmbeddedSkills = 32

// PublishMarketplaceListingRequest publishes a workspace entity, creating the
// listing on first publish and adding a version on every publish.
type PublishMarketplaceListingRequest struct {
	Kind string `json:"kind"`
	// SourceID is the workspace entity to snapshot: a skill id, an agent id, or
	// a workspace MCP server id.
	SourceID string `json:"source_id"`
	// Slug is the stable handle within this workspace. Derived from Name when
	// omitted.
	Slug        string   `json:"slug"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
	// Visibility defaults to 'workspace' — an internal library entry. Making
	// something public is an explicit act.
	Visibility string `json:"visibility"`
	Version    string `json:"version"`
	Changelog  string `json:"changelog"`
	// PublicFields names the required-secret paths the publisher declares are
	// not credentials, e.g. ["url"] for a public SSE endpoint. Everything not
	// named here is withheld. See marketplace_sanitize.go.
	PublicFields []string `json:"public_fields"`
}

// PublishMarketplaceListingResponse returns the listing and the version that
// was just created, so the client can link to both without a second read.
type PublishMarketplaceListingResponse struct {
	Listing MarketplaceListingResponse `json:"listing"`
	Version MarketplaceVersionResponse `json:"version"`
}

// requireMarketplacePublisher gates every write. Publishing is a human,
// admin-level decision about what leaves the workspace, so an agent actor is
// refused even when it runs under an owner's token — the same rule the
// workspace MCP library draws for the same reason.
func (h *Handler) requireMarketplacePublisher(w http.ResponseWriter, r *http.Request) (pgtype.UUID, db.Member, bool) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return pgtype.UUID{}, db.Member{}, false
	}
	if actorType, _ := h.resolveActor(r, requestUserID(r), workspaceID); actorType == "agent" {
		writeError(w, http.StatusForbidden, "agents cannot publish to the marketplace")
		return pgtype.UUID{}, db.Member{}, false
	}
	member, ok := h.workspaceMember(w, r, workspaceID)
	if !ok {
		return pgtype.UUID{}, db.Member{}, false
	}
	if !roleAllowed(member.Role, "owner", "admin") {
		writeError(w, http.StatusForbidden, "only a workspace owner or admin can publish to the marketplace")
		return pgtype.UUID{}, db.Member{}, false
	}
	return wsUUID, member, true
}

// marketplaceSnapshot is what a publish read out of the workspace: the manifest
// to store and the files that go with it.
type marketplaceSnapshot struct {
	Manifest    marketplaceManifest
	Files       []marketplaceFile
	DefaultName string
	DefaultDesc string
	DefaultSlug string
}

// PublishMarketplaceListing snapshots a workspace entity and publishes it.
func (h *Handler) PublishMarketplaceListing(w http.ResponseWriter, r *http.Request) {
	wsUUID, member, ok := h.requireMarketplacePublisher(w, r)
	if !ok {
		return
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	var req PublishMarketplaceListingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !validMarketplaceKind(req.Kind) {
		writeError(w, http.StatusBadRequest, "kind must be one of skill, agent, mcp, squad")
		return
	}
	sourceUUID, ok := parseUUIDOrBadRequest(w, strings.TrimSpace(req.SourceID), "source_id")
	if !ok {
		return
	}
	visibility := strings.TrimSpace(req.Visibility)
	if visibility == "" {
		visibility = marketplaceVisibilityWorkspace
	}
	if !validMarketplaceVisibility(visibility) {
		writeError(w, http.StatusBadRequest, "visibility must be one of public, workspace")
		return
	}
	version := strings.TrimSpace(req.Version)
	if version == "" {
		writeError(w, http.StatusBadRequest, "version is required")
		return
	}

	publicFields := map[string]bool{}
	for _, field := range req.PublicFields {
		publicFields[strings.TrimSpace(field)] = true
	}

	snapshot, err := h.buildMarketplaceSnapshot(r.Context(), req.Kind, wsUUID, sourceUUID, publicFields)
	if err != nil {
		writeError(w, marketplacePublishStatus(err), err.Error())
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = snapshot.DefaultName
	}
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	description := strings.TrimSpace(req.Description)
	if description == "" {
		description = snapshot.DefaultDesc
	}
	slug := marketplaceSlugify(req.Slug)
	if slug == "" {
		slug = snapshot.DefaultSlug
	}
	if slug == "" {
		slug = marketplaceSlugify(name)
	}
	if slug == "" {
		writeError(w, http.StatusBadRequest, "slug is required and could not be derived from the name")
		return
	}

	manifestJSON, err := json.Marshal(snapshot.Manifest)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to encode the manifest")
		return
	}
	digest, size, err := marketplaceVersionDigest(manifestJSON, snapshot.Files)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to hash the version")
		return
	}
	if size > maxMarketplaceBundleBytes {
		writeError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("this version is larger than the %d byte publish limit", maxMarketplaceBundleBytes))
		return
	}

	tags := normalizeMarketplaceTags(req.Tags)

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to publish")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	// Join the workspace teardown fence: these tables carry no foreign key, so
	// without the shared lock a publish committing after DeleteWorkspace swept
	// would leave a listing pointing at a workspace that no longer exists.
	if _, err := qtx.LockWorkspaceForChatSessionCreate(r.Context(), wsUUID); err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}

	listing, err := qtx.GetMarketplaceListingBySlug(r.Context(), db.GetMarketplaceListingBySlugParams{
		WorkspaceID: wsUUID,
		Kind:        req.Kind,
		Slug:        slug,
	})
	switch {
	case err == nil:
		// Republishing under an existing handle. Take the row exclusively so
		// two concurrent publishes serialize and the second sees the first's
		// version when it checks for a duplicate version string.
		if _, lockErr := qtx.LockMarketplaceListingForUpdate(r.Context(), listing.ID); lockErr != nil {
			writeError(w, http.StatusNotFound, "listing not found")
			return
		}
		updated, updateErr := qtx.UpdateMarketplaceListing(r.Context(), db.UpdateMarketplaceListingParams{
			ID:          listing.ID,
			Name:        pgtype.Text{String: name, Valid: true},
			Description: pgtype.Text{String: description, Valid: true},
			Category:    pgtype.Text{String: strings.TrimSpace(req.Category), Valid: true},
			Tags:        tags,
			Visibility:  pgtype.Text{String: visibility, Valid: true},
			// A republish of a taken-down listing does not un-remove it: a
			// takedown is an administrative decision, not a stale field.
			Status: pgtype.Text{String: marketplaceStatusPublished, Valid: listing.Status != marketplaceStatusRemoved},
		})
		if updateErr != nil {
			writeError(w, http.StatusInternalServerError, "failed to update the listing")
			return
		}
		listing = updated
	case marketplaceRowMissing(err):
		listing, err = qtx.CreateMarketplaceListing(r.Context(), db.CreateMarketplaceListingParams{
			Kind:        req.Kind,
			Slug:        slug,
			Name:        name,
			Description: description,
			Category:    strings.TrimSpace(req.Category),
			Tags:        tags,
			WorkspaceID: wsUUID,
			PublishedBy: parseUUID(userID),
			Visibility:  visibility,
			Status:      marketplaceStatusPublished,
		})
		if err != nil {
			if isUniqueViolation(err) {
				writeError(w, http.StatusConflict, "a listing with this slug already exists in this workspace")
				return
			}
			slog.Warn("create marketplace listing failed", append(logger.RequestAttrs(r), "error", err)...)
			writeError(w, http.StatusInternalServerError, "failed to publish")
			return
		}
	default:
		writeError(w, http.StatusInternalServerError, "failed to publish")
		return
	}

	created, err := qtx.CreateMarketplaceListingVersion(r.Context(), db.CreateMarketplaceListingVersionParams{
		ListingID:   listing.ID,
		Version:     version,
		Manifest:    manifestJSON,
		Changelog:   strings.TrimSpace(req.Changelog),
		Digest:      digest,
		SizeBytes:   size,
		PublishedBy: parseUUID(userID),
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict,
				"version "+version+" has already been published; a published version is never overwritten")
			return
		}
		slog.Warn("create marketplace version failed", append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to publish")
		return
	}

	for _, file := range snapshot.Files {
		if _, err := qtx.CreateMarketplaceListingFile(r.Context(), db.CreateMarketplaceListingFileParams{
			VersionID: created.ID,
			Path:      file.Path,
			Content:   file.Content,
			SizeBytes: int64(len(file.Content)),
			Sha256:    fileSHA256(file.Content),
		}); err != nil {
			slog.Warn("write marketplace file failed", append(logger.RequestAttrs(r), "error", err, "path", file.Path)...)
			writeError(w, http.StatusInternalServerError, "failed to publish")
			return
		}
	}

	listing, err = qtx.SetMarketplaceListingLatestVersion(r.Context(), db.SetMarketplaceListingLatestVersionParams{
		ID:              listing.ID,
		LatestVersionID: created.ID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to publish")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to publish")
		return
	}

	slog.Info("marketplace listing published", append(logger.RequestAttrs(r),
		"listing_id", uuidToString(listing.ID), "kind", listing.Kind, "slug", listing.Slug,
		"version", created.Version, "visibility", listing.Visibility)...)

	publishers := h.marketplaceWorkspaceNames(r.Context(), []db.MarketplaceListing{listing})
	writeJSON(w, http.StatusCreated, PublishMarketplaceListingResponse{
		Listing: marketplaceListingToResponse(listing, wsUUID, member,
			publishers[uuidToString(listing.WorkspaceID)], created.Version, nil, ""),
		Version: marketplaceVersionToResponse(created),
	})
}

// errMarketplaceSourceNotFound / errMarketplaceUnpublishable separate the two
// ways a snapshot can fail: the entity is not there, or it is there and must
// not be published as it stands.
var (
	errMarketplaceSourceNotFound = errors.New("the entity to publish was not found in this workspace")
)

func marketplacePublishStatus(err error) int {
	if errors.Is(err, errMarketplaceSourceNotFound) {
		return http.StatusNotFound
	}
	return http.StatusBadRequest
}

// buildMarketplaceSnapshot reads the workspace entity and produces the manifest
// and files a version ships.
func (h *Handler) buildMarketplaceSnapshot(ctx context.Context, kind string, workspaceID, sourceID pgtype.UUID, publicFields map[string]bool) (marketplaceSnapshot, error) {
	switch kind {
	case marketplaceKindSkill:
		return h.snapshotSkillForPublish(ctx, workspaceID, sourceID)
	case marketplaceKindAgent:
		return h.snapshotAgentForPublish(ctx, workspaceID, sourceID, publicFields)
	case marketplaceKindMcp:
		return h.snapshotMcpForPublish(ctx, workspaceID, sourceID, publicFields)
	case marketplaceKindSquad:
		return h.snapshotSquadForPublish(ctx, workspaceID, sourceID, publicFields)
	}
	return marketplaceSnapshot{}, errors.New("unsupported kind")
}

// snapshotSkillForPublish reads one workspace skill and its reference files.
//
// A skill body is prose, not configuration; it is published as written. What is
// dropped is the config blob: it holds the import provenance of the publishing
// workspace, which says nothing useful to a reader and would make a re-publish
// look like an import from somewhere it never came from.
func (h *Handler) snapshotSkillForPublish(ctx context.Context, workspaceID, skillID pgtype.UUID) (marketplaceSnapshot, error) {
	skill, err := h.Queries.GetSkillInWorkspace(ctx, db.GetSkillInWorkspaceParams{
		ID:          skillID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		return marketplaceSnapshot{}, errMarketplaceSourceNotFound
	}
	files, manifest, err := h.skillPublishFiles(ctx, skill, "")
	if err != nil {
		return marketplaceSnapshot{}, err
	}
	return marketplaceSnapshot{
		Manifest:    marketplaceManifest{Kind: marketplaceKindSkill, Skill: &manifest},
		Files:       files,
		DefaultName: skill.Name,
		DefaultDesc: skill.Description,
		DefaultSlug: marketplaceSlugify(skill.Name),
	}, nil
}

// skillPublishFiles turns one skill into a file set rooted at prefix ("" for a
// skill listing, "skills/<slug>/" for one embedded in an agent template).
func (h *Handler) skillPublishFiles(ctx context.Context, skill db.Skill, prefix string) ([]marketplaceFile, marketplaceSkillManifest, error) {
	rows, err := h.Queries.ListSkillFiles(ctx, skill.ID)
	if err != nil {
		return nil, marketplaceSkillManifest{}, errors.New("failed to read the skill's files")
	}
	files := []marketplaceFile{{Path: prefix + skillContentPath, Content: skill.Content}}
	paths := []string{}
	for _, row := range rows {
		// The importer already refuses these, but a skill can also be authored
		// through the API, so the guard is repeated where the bytes leave the
		// workspace rather than trusted from upstream.
		if !validateFilePath(row.Path) || skillpkg.IsReservedContentPath(row.Path) {
			continue
		}
		files = append(files, marketplaceFile{Path: prefix + row.Path, Content: row.Content})
		paths = append(paths, row.Path)
	}
	return files, marketplaceSkillManifest{
		Name:        skill.Name,
		Description: skill.Description,
		ContentPath: skillContentPath,
		FilePaths:   sortedStrings(paths),
	}, nil
}

// snapshotMcpForPublish reads one workspace MCP server and redacts it.
func (h *Handler) snapshotMcpForPublish(ctx context.Context, workspaceID, serverID pgtype.UUID, publicFields map[string]bool) (marketplaceSnapshot, error) {
	server, err := h.Queries.GetWorkspaceMcpServer(ctx, db.GetWorkspaceMcpServerParams{
		ID:          serverID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		return marketplaceSnapshot{}, errMarketplaceSourceNotFound
	}
	manifest, err := mcpManifestFor(server.Name, server.Config, publicFields)
	if err != nil {
		return marketplaceSnapshot{}, err
	}
	return marketplaceSnapshot{
		Manifest:    marketplaceManifest{Kind: marketplaceKindMcp, Mcp: &manifest},
		Files:       []marketplaceFile{},
		DefaultName: server.Name,
		DefaultSlug: marketplaceSlugify(server.Name),
	}, nil
}

// mcpManifestFor redacts one server entry and describes it. The endpoint hint
// is read from the original entry, before redaction empties the URL.
func mcpManifestFor(name string, config []byte, publicFields map[string]bool) (marketplaceMcpManifest, error) {
	sanitized, err := sanitizeMcpEntryForPublish(config, publicFields)
	if err != nil {
		return marketplaceMcpManifest{}, fmt.Errorf("%s: %w", name, err)
	}
	return marketplaceMcpManifest{
		Name:            name,
		Transport:       mcpTransportOf(config),
		EndpointHint:    mcpEndpointHint(config),
		Config:          sanitized.Config,
		RequiredSecrets: sanitized.RequiredSecrets,
	}, nil
}

// snapshotAgentForPublish reads an agent, the skills bound to it, and the
// workspace MCP servers bound to it, and produces a portable template.
//
// The fields that do not travel are listed on marketplaceAgentManifest, and
// the reason they cannot leak is that the type has nowhere to put them.
func (h *Handler) snapshotAgentForPublish(ctx context.Context, workspaceID, agentID pgtype.UUID, publicFields map[string]bool) (marketplaceSnapshot, error) {
	agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
		ID:          agentID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		return marketplaceSnapshot{}, errMarketplaceSourceNotFound
	}
	manifest, files, err := h.agentManifestFor(ctx, workspaceID, agent, agentSkillDirPrefix, publicFields)
	if err != nil {
		return marketplaceSnapshot{}, err
	}
	return marketplaceSnapshot{
		Manifest:    marketplaceManifest{Kind: marketplaceKindAgent, Agent: &manifest},
		Files:       files,
		DefaultName: agent.Name,
		DefaultDesc: agent.Description,
		DefaultSlug: marketplaceSlugify(agent.Name),
	}, nil
}

// agentManifestFor turns one agent into its portable template and the files
// its skills ship, with every skill rooted under skillDirPrefix. An agent
// listing roots them at "skills/"; a squad member roots them under its own
// member directory so two members' skills cannot collide.
func (h *Handler) agentManifestFor(ctx context.Context, workspaceID pgtype.UUID, agent db.Agent, skillDirPrefix string, publicFields map[string]bool) (marketplaceAgentManifest, []marketplaceFile, error) {
	var customArgs []string
	if len(agent.CustomArgs) > 0 {
		_ = json.Unmarshal(agent.CustomArgs, &customArgs)
	}
	if reason := scanArgsForSecrets(customArgs); reason != "" {
		return marketplaceAgentManifest{}, nil, fmt.Errorf("the agent's custom arguments cannot be published: %s; move the value into the agent's environment", reason)
	}

	manifest := marketplaceAgentManifest{
		Name:               agent.Name,
		Description:        agent.Description,
		Instructions:       agent.Instructions,
		MaxConcurrentTasks: agent.MaxConcurrentTasks,
		CustomArgs:         customArgs,
	}
	if agent.AvatarUrl.Valid && agent.AvatarUrl.String != "" {
		avatar := agent.AvatarUrl.String
		manifest.AvatarURL = &avatar
	}
	if agent.Model.Valid {
		manifest.Model = agent.Model.String
	}
	if agent.ThinkingLevel.Valid {
		manifest.ThinkingLevel = agent.ThinkingLevel.String
	}
	if agent.ServiceTier.Valid {
		manifest.ServiceTier = agent.ServiceTier.String
	}
	// The provider is a hint about what the instructions were written for. The
	// runtime itself is never published: it names a machine in this workspace.
	if runtime, err := h.Queries.GetAgentRuntimeForWorkspace(ctx, db.GetAgentRuntimeForWorkspaceParams{
		ID:          agent.RuntimeID,
		WorkspaceID: workspaceID,
	}); err == nil {
		manifest.RuntimeProvider = runtime.Provider
	}

	// The agent's own inline mcp_config, then the workspace servers bound to
	// it. Both are redacted the same way; a name collision between the two is
	// resolved in favour of the inline entry, matching ResolveAgentMcpConfig's
	// precedence on the claim path.
	seen := map[string]bool{}
	files := []marketplaceFile{}

	inline, err := publishableMcpEntries(agent.McpConfig)
	if err != nil {
		return marketplaceAgentManifest{}, nil, err
	}
	for _, entry := range inline {
		entryManifest, err := mcpManifestFor(entry.Name, entry.Config, publicFields)
		if err != nil {
			return marketplaceAgentManifest{}, nil, err
		}
		manifest.McpServers = append(manifest.McpServers, entryManifest)
		seen[entry.Name] = true
	}

	bound, err := h.Queries.ListAgentMcpServers(ctx, agent.ID)
	if err != nil {
		return marketplaceAgentManifest{}, nil, errors.New("failed to read the agent's MCP servers")
	}
	for _, server := range bound {
		if seen[server.Name] {
			continue
		}
		entryManifest, err := mcpManifestFor(server.Name, server.Config, publicFields)
		if err != nil {
			return marketplaceAgentManifest{}, nil, err
		}
		manifest.McpServers = append(manifest.McpServers, entryManifest)
		seen[server.Name] = true
	}

	skills, err := h.Queries.ListAgentSkills(ctx, agent.ID)
	if err != nil {
		return marketplaceAgentManifest{}, nil, errors.New("failed to read the agent's skills")
	}
	if len(skills) > maxMarketplaceEmbeddedSkills {
		return marketplaceAgentManifest{}, nil, fmt.Errorf("an agent template may carry at most %d skills", maxMarketplaceEmbeddedSkills)
	}
	usedDirs := map[string]bool{}
	for _, skill := range skills {
		// An ontology-backed skill is a projection of a Capability Hub domain,
		// not content this workspace authored. Publishing a copy would fork it
		// away from the catalog that owns it; the installing workspace attaches
		// the same domain instead.
		if skillConfigKind(skill.Config) == "ontology" {
			continue
		}
		dir := skillDirPrefix + uniqueMarketplaceDir(marketplaceSlugify(skill.Name), usedDirs)
		skillFiles, skillManifest, err := h.skillPublishFiles(ctx, skill, dir+"/")
		if err != nil {
			return marketplaceAgentManifest{}, nil, err
		}
		files = append(files, skillFiles...)
		manifest.Skills = append(manifest.Skills, marketplaceAgentSkillRef{
			Name:        skillManifest.Name,
			Description: skillManifest.Description,
			Dir:         dir,
		})
	}

	return manifest, files, nil
}

// snapshotSquadForPublish reads an Agent Family and every agent member of it,
// and produces a bundle of agent templates plus the squad that binds them.
//
// Human members are dropped rather than published: they name people in this
// workspace, and an install elsewhere has its own people. The leader is
// therefore required to be an agent member, which CreateSquad already
// guarantees, and is named by its member directory so the installer can
// resolve it to the agent it creates.
func (h *Handler) snapshotSquadForPublish(ctx context.Context, workspaceID, squadID pgtype.UUID, publicFields map[string]bool) (marketplaceSnapshot, error) {
	squad, err := h.Queries.GetSquadInWorkspace(ctx, db.GetSquadInWorkspaceParams{
		ID:          squadID,
		WorkspaceID: workspaceID,
	})
	if err != nil {
		return marketplaceSnapshot{}, errMarketplaceSourceNotFound
	}
	if squad.ArchivedAt.Valid {
		return marketplaceSnapshot{}, errors.New("an archived agent family cannot be published")
	}
	members, err := h.Queries.ListSquadMembers(ctx, squad.ID)
	if err != nil {
		return marketplaceSnapshot{}, errors.New("failed to read the agent family's members")
	}

	manifest := marketplaceSquadManifest{
		Name:         squad.Name,
		Description:  squad.Description,
		Instructions: squad.Instructions,
		Agents:       []marketplaceSquadAgentRef{},
	}
	if squad.AvatarUrl.Valid && squad.AvatarUrl.String != "" {
		avatar := squad.AvatarUrl.String
		manifest.AvatarURL = &avatar
	}

	// Leader first, then the rest in membership order, so the manifest reads
	// the way the squad page does and the installer creates the leader before
	// it needs its id.
	ordered := make([]db.SquadMember, 0, len(members))
	for _, member := range members {
		if member.MemberType == "agent" && member.MemberID == squad.LeaderID {
			ordered = append(ordered, member)
		}
	}
	for _, member := range members {
		if member.MemberType == "agent" && member.MemberID != squad.LeaderID {
			ordered = append(ordered, member)
		}
	}
	if len(ordered) == 0 || ordered[0].MemberID != squad.LeaderID {
		return marketplaceSnapshot{}, errors.New("the agent family's leader is not one of its agent members")
	}
	if len(ordered) > maxMarketplaceSquadAgents {
		return marketplaceSnapshot{}, fmt.Errorf("an agent family listing may carry at most %d agents", maxMarketplaceSquadAgents)
	}

	files := []marketplaceFile{}
	usedDirs := map[string]bool{}
	for _, member := range ordered {
		agent, err := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
			ID:          member.MemberID,
			WorkspaceID: workspaceID,
		})
		if err != nil {
			return marketplaceSnapshot{}, fmt.Errorf("an agent member of this family no longer exists in this workspace")
		}
		dir := squadAgentDirPrefix + uniqueMarketplaceDir(marketplaceSlugify(agent.Name), usedDirs)
		agentManifest, agentFiles, err := h.agentManifestFor(ctx, workspaceID, agent, dir+"/"+agentSkillDirPrefix, publicFields)
		if err != nil {
			return marketplaceSnapshot{}, fmt.Errorf("%s: %w", agent.Name, err)
		}
		files = append(files, agentFiles...)
		role := member.Role
		if member.MemberID == squad.LeaderID {
			manifest.LeaderDir = dir
			if role == "" {
				role = "leader"
			}
		}
		manifest.Agents = append(manifest.Agents, marketplaceSquadAgentRef{
			Dir:   dir,
			Role:  role,
			Agent: agentManifest,
		})
	}

	return marketplaceSnapshot{
		Manifest:    marketplaceManifest{Kind: marketplaceKindSquad, Squad: &manifest},
		Files:       files,
		DefaultName: squad.Name,
		DefaultDesc: squad.Description,
		DefaultSlug: marketplaceSlugify(squad.Name),
	}, nil
}

// namedMcpEntry is one entry of an `mcpServers` document.
type namedMcpEntry struct {
	Name   string
	Config json.RawMessage
}

// publishableMcpEntries reads an agent's inline mcp_config into named entries.
// It accepts both container spellings for the same reason
// ResolveAgentMcpConfig does: older clients wrote `mcp`.
func publishableMcpEntries(raw []byte) ([]namedMcpEntry, error) {
	if len(strings.TrimSpace(string(raw))) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var document map[string]json.RawMessage
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, errors.New("the agent's MCP configuration is not a JSON object")
	}
	for _, container := range []string{"mcpServers", "mcp"} {
		raw, ok := document[container]
		if !ok {
			continue
		}
		var servers map[string]json.RawMessage
		if err := json.Unmarshal(raw, &servers); err != nil {
			return nil, errors.New("the agent's MCP configuration is not a JSON object")
		}
		entries := make([]namedMcpEntry, 0, len(servers))
		for name, config := range servers {
			entries = append(entries, namedMcpEntry{Name: name, Config: config})
		}
		sortNamedMcpEntries(entries)
		return entries, nil
	}
	return nil, nil
}

func sortNamedMcpEntries(entries []namedMcpEntry) {
	for i := 1; i < len(entries); i++ {
		for j := i; j > 0 && entries[j].Name < entries[j-1].Name; j-- {
			entries[j], entries[j-1] = entries[j-1], entries[j]
		}
	}
}

// uniqueMarketplaceDir keeps two skills whose names slugify identically from
// writing into the same directory and silently overwriting each other.
func uniqueMarketplaceDir(base string, used map[string]bool) string {
	if base == "" {
		base = "skill"
	}
	candidate := base
	for suffix := 2; used[candidate]; suffix++ {
		candidate = fmt.Sprintf("%s-%d", base, suffix)
	}
	used[candidate] = true
	return candidate
}

// normalizeMarketplaceTags lowercases, trims, dedupes and sorts, so the facet
// counts on the browse page are counts of the same thing.
func normalizeMarketplaceTags(tags []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, tag := range tags {
		normalized := strings.ToLower(strings.TrimSpace(tag))
		if normalized == "" || seen[normalized] {
			continue
		}
		seen[normalized] = true
		out = append(out, normalized)
	}
	return sortedStrings(out)
}

// UpdateMarketplaceListingRequest edits a listing's metadata, visibility or
// status. Every field is optional; an omitted field is left alone.
type UpdateMarketplaceListingRequest struct {
	Name        *string   `json:"name"`
	Description *string   `json:"description"`
	Category    *string   `json:"category"`
	Tags        *[]string `json:"tags"`
	Visibility  *string   `json:"visibility"`
	Status      *string   `json:"status"`
}

// UpdateMarketplaceListing edits a listing the caller's workspace published.
func (h *Handler) UpdateMarketplaceListing(w http.ResponseWriter, r *http.Request) {
	wsUUID, member, ok := h.requireMarketplacePublisher(w, r)
	if !ok {
		return
	}
	listing, ok := h.loadMarketplaceListing(w, r, wsUUID)
	if !ok {
		return
	}
	if !canManageMarketplaceListing(listing, wsUUID, member) {
		writeError(w, http.StatusForbidden, "only the publishing workspace can change this listing")
		return
	}

	var req UpdateMarketplaceListingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	params := db.UpdateMarketplaceListingParams{ID: listing.ID}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			writeError(w, http.StatusBadRequest, "name cannot be empty")
			return
		}
		params.Name = pgtype.Text{String: name, Valid: true}
	}
	if req.Description != nil {
		params.Description = pgtype.Text{String: strings.TrimSpace(*req.Description), Valid: true}
	}
	if req.Category != nil {
		params.Category = pgtype.Text{String: strings.TrimSpace(*req.Category), Valid: true}
	}
	if req.Tags != nil {
		params.Tags = normalizeMarketplaceTags(*req.Tags)
	}
	if req.Visibility != nil {
		visibility := strings.TrimSpace(*req.Visibility)
		if !validMarketplaceVisibility(visibility) {
			writeError(w, http.StatusBadRequest, "visibility must be one of public, workspace")
			return
		}
		params.Visibility = pgtype.Text{String: visibility, Valid: true}
	}
	if req.Status != nil {
		status := strings.TrimSpace(*req.Status)
		if !validMarketplaceStatus(status) {
			writeError(w, http.StatusBadRequest, "status must be one of draft, published, deprecated, removed")
			return
		}
		// A listing that has never had a version cannot claim to be published.
		if status == marketplaceStatusPublished && !listing.LatestVersionID.Valid {
			writeError(w, http.StatusBadRequest, "publish a version before setting this listing to published")
			return
		}
		params.Status = pgtype.Text{String: status, Valid: true}
	}

	updated, err := h.Queries.UpdateMarketplaceListing(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update the listing")
		return
	}
	slog.Info("marketplace listing updated", append(logger.RequestAttrs(r),
		"listing_id", uuidToString(updated.ID), "status", updated.Status, "visibility", updated.Visibility)...)

	publishers := h.marketplaceWorkspaceNames(r.Context(), []db.MarketplaceListing{updated})
	latestName := ""
	if updated.LatestVersionID.Valid {
		latestName = h.marketplaceVersionNames(r.Context(), []pgtype.UUID{updated.LatestVersionID})[uuidToString(updated.LatestVersionID)]
	}
	writeJSON(w, http.StatusOK, marketplaceListingToResponse(updated, wsUUID, member,
		publishers[uuidToString(updated.WorkspaceID)], latestName, nil, ""))
}

// DeleteMarketplaceListing removes a listing that was never published. A
// listing with a published version is taken down by setting status to
// 'removed' instead, so the install records that name it keep naming something
// that exists.
func (h *Handler) DeleteMarketplaceListing(w http.ResponseWriter, r *http.Request) {
	wsUUID, member, ok := h.requireMarketplacePublisher(w, r)
	if !ok {
		return
	}
	listing, ok := h.loadMarketplaceListing(w, r, wsUUID)
	if !ok {
		return
	}
	if !canManageMarketplaceListing(listing, wsUUID, member) {
		writeError(w, http.StatusForbidden, "only the publishing workspace can delete this listing")
		return
	}
	if listing.LatestVersionID.Valid {
		writeErrorCode(w, http.StatusConflict, "listing_has_versions",
			"this listing has published versions; take it down by setting its status to removed")
		return
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete the listing")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	// Files hang off versions and versions off the listing, and neither carries
	// a foreign key, so both are swept explicitly in the same transaction.
	if err := qtx.DeleteMarketplaceListingFilesByListing(r.Context(), listing.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete the listing")
		return
	}
	if err := qtx.DeleteMarketplaceListingVersionsByListing(r.Context(), listing.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete the listing")
		return
	}
	rows, err := qtx.DeleteMarketplaceListing(r.Context(), db.DeleteMarketplaceListingParams{
		ID:          listing.ID,
		WorkspaceID: wsUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete the listing")
		return
	}
	if rows == 0 {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete the listing")
		return
	}
	slog.Info("marketplace listing deleted", append(logger.RequestAttrs(r), "listing_id", uuidToString(listing.ID))...)
	w.WriteHeader(http.StatusNoContent)
}
