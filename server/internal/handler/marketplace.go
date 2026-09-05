package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/enact-ai/enact/server/pkg/db/generated"
)

// The Marketplace read surface: browsing the directory, opening one listing,
// and reading the files a version ships.
//
// Every route here resolves the caller's own workspace first and answers only
// what that workspace may see. A listing is visible when it is published (or
// deprecated) and public, or when the caller's workspace published it — in
// which case drafts and taken-down listings are visible too, because the
// publisher manages them from the same pages.

const (
	marketplaceStatusDraft      = "draft"
	marketplaceStatusPublished  = "published"
	marketplaceStatusDeprecated = "deprecated"
	marketplaceStatusRemoved    = "removed"

	marketplaceVisibilityPublic    = "public"
	marketplaceVisibilityWorkspace = "workspace"
)

func validMarketplaceVisibility(v string) bool {
	return v == marketplaceVisibilityPublic || v == marketplaceVisibilityWorkspace
}

func validMarketplaceStatus(s string) bool {
	switch s {
	case marketplaceStatusDraft, marketplaceStatusPublished, marketplaceStatusDeprecated, marketplaceStatusRemoved:
		return true
	}
	return false
}

// MarketplaceListingResponse is one card in the directory. It carries no file
// content and no manifest: a browse renders hundreds of these, and a skill's
// body alone can run to 200KB.
type MarketplaceListingResponse struct {
	ID          string   `json:"id"`
	Kind        string   `json:"kind"`
	Slug        string   `json:"slug"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
	Visibility  string   `json:"visibility"`
	Status      string   `json:"status"`
	Featured    bool     `json:"featured"`
	// InstallCount is how many workspaces have taken this listing. Advisory,
	// and deliberately not a rating: nobody has been asked to score anything.
	InstallCount int64 `json:"install_count"`
	// PublisherWorkspaceID / PublisherWorkspaceName say who is accountable for
	// what the reader is about to install.
	PublisherWorkspaceID   string `json:"publisher_workspace_id"`
	PublisherWorkspaceName string `json:"publisher_workspace_name"`
	// LatestVersion is empty on a listing that has never been published.
	LatestVersion   string `json:"latest_version"`
	LatestVersionID string `json:"latest_version_id,omitempty"`
	// CanManage is true when the caller may edit, publish to, or take down
	// this listing, so the client does not have to re-derive the rule.
	CanManage bool `json:"can_manage"`
	// Installed is whether this workspace holds a copy of this listing. It is
	// the same fact InstalledVersionID carries, stated as the boolean every
	// card and filter reads, so no client has to derive it from a version id.
	Installed bool `json:"installed"`
	// InstalledVersion is the version this workspace last installed, empty when
	// it never has. Drives the "installed" badge and the update prompt.
	InstalledVersion   string `json:"installed_version,omitempty"`
	InstalledVersionID string `json:"installed_version_id,omitempty"`
	CreatedAt          string `json:"created_at"`
	UpdatedAt          string `json:"updated_at"`
}

// MarketplaceVersionResponse is one published version. Manifest is returned
// verbatim; it is the installer's input and the reader's description.
type MarketplaceVersionResponse struct {
	ID          string          `json:"id"`
	ListingID   string          `json:"listing_id"`
	Version     string          `json:"version"`
	Changelog   string          `json:"changelog"`
	Digest      string          `json:"digest"`
	SizeBytes   int64           `json:"size_bytes"`
	Manifest    json.RawMessage `json:"manifest"`
	PublishedBy *string         `json:"published_by"`
	CreatedAt   string          `json:"created_at"`
}

// MarketplaceListingDetailResponse is the listing page: the card, the version
// the reader is looking at, and the paths that version ships. File contents are
// fetched one at a time, so opening a listing never pulls a whole bundle.
type MarketplaceListingDetailResponse struct {
	MarketplaceListingResponse
	Version   *MarketplaceVersionResponse `json:"version"`
	FilePaths []string                    `json:"file_paths"`
}

// MarketplaceCatalogResponse is the browse payload: the filtered listings plus
// the counts every filter chip needs. Facets are computed over the visible set
// before the kind/tag/text filters are applied, so choosing one filter does not
// make the others disappear.
type MarketplaceCatalogResponse struct {
	Count    int                          `json:"count"`
	Total    int                          `json:"total"`
	Listings []MarketplaceListingResponse `json:"listings"`
	Facets   MarketplaceFacets            `json:"facets"`
}

type MarketplaceFacets struct {
	Kinds      map[string]int `json:"kinds"`
	Categories map[string]int `json:"categories"`
	Tags       map[string]int `json:"tags"`
	// Installed counts the visible set by whether this workspace holds a copy,
	// under the keys "installed" and "not_installed", so the two filter chips
	// can show their counts before either is chosen.
	Installed map[string]int `json:"installed"`
}

const (
	marketplaceInstalledFilterInstalled    = "installed"
	marketplaceInstalledFilterNotInstalled = "not_installed"
)

// MarketplaceInstallResponse is one provenance record: what this workspace
// took, from where, and at which version.
type MarketplaceInstallResponse struct {
	ID         string `json:"id"`
	ListingID  string `json:"listing_id"`
	VersionID  string `json:"version_id"`
	Version    string `json:"version"`
	EntityKind string `json:"entity_kind"`
	EntityID   string `json:"entity_id"`
	CreatedAt  string `json:"created_at"`
}

// marketplaceVisibleTo reports whether a workspace may see a listing at all.
// The publisher sees everything it published; everyone else sees only what has
// actually been published publicly and not taken down.
func marketplaceVisibleTo(listing db.MarketplaceListing, workspaceID pgtype.UUID) bool {
	if listing.WorkspaceID == workspaceID {
		return true
	}
	if listing.Visibility != marketplaceVisibilityPublic {
		return false
	}
	return listing.Status == marketplaceStatusPublished || listing.Status == marketplaceStatusDeprecated
}

// marketplaceInstallable reports whether a listing may still be installed. A
// deprecated listing can: someone already depends on it and needs to be able to
// reinstall or move a copy. A removed one cannot, which is what a takedown is
// for.
func marketplaceInstallable(listing db.MarketplaceListing) bool {
	return listing.Status == marketplaceStatusPublished || listing.Status == marketplaceStatusDeprecated
}

// requireMarketplaceReader resolves the caller's workspace and membership. Every
// Marketplace route needs both: the workspace decides what is visible, the
// membership decides whether the caller may look at all.
func (h *Handler) requireMarketplaceReader(w http.ResponseWriter, r *http.Request) (pgtype.UUID, db.Member, bool) {
	workspaceID := h.resolveWorkspaceID(r)
	wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace id")
	if !ok {
		return pgtype.UUID{}, db.Member{}, false
	}
	member, ok := h.workspaceMember(w, r, workspaceID)
	if !ok {
		return pgtype.UUID{}, db.Member{}, false
	}
	return wsUUID, member, true
}

// canManageMarketplaceListing is the publish-side gate: an owner or admin of
// the workspace that published the listing. Agent actors are excluded by the
// caller, not here — publishing is a human decision about what leaves the
// workspace.
func canManageMarketplaceListing(listing db.MarketplaceListing, workspaceID pgtype.UUID, member db.Member) bool {
	if listing.WorkspaceID != workspaceID {
		return false
	}
	return roleAllowed(member.Role, "owner", "admin")
}

// loadMarketplaceListing resolves a listing by id and applies the visibility
// gate. A listing the caller may not see is reported as missing rather than
// forbidden: a 403 would confirm that a private listing with this id exists.
func (h *Handler) loadMarketplaceListing(w http.ResponseWriter, r *http.Request, workspaceID pgtype.UUID) (db.MarketplaceListing, bool) {
	listingUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "listing id")
	if !ok {
		return db.MarketplaceListing{}, false
	}
	listing, err := h.Queries.GetMarketplaceListing(r.Context(), listingUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "listing not found")
		return db.MarketplaceListing{}, false
	}
	if !marketplaceVisibleTo(listing, workspaceID) {
		writeError(w, http.StatusNotFound, "listing not found")
		return db.MarketplaceListing{}, false
	}
	return listing, true
}

// marketplaceInstallState folds this workspace's install records down to the
// version it currently holds per listing. The records are newest-first, so the
// first one seen for a listing is the current one.
func (h *Handler) marketplaceInstallState(ctx context.Context, workspaceID pgtype.UUID) map[string]db.MarketplaceInstall {
	installs, err := h.Queries.ListMarketplaceInstallsForWorkspace(ctx, workspaceID)
	if err != nil {
		// Advisory state only: a failed read costs the "installed" badge, not
		// the ability to browse.
		return map[string]db.MarketplaceInstall{}
	}
	state := make(map[string]db.MarketplaceInstall, len(installs))
	for _, install := range installs {
		key := uuidToString(install.ListingID)
		if _, seen := state[key]; !seen {
			state[key] = install
		}
	}
	return state
}

// marketplaceVersionNames resolves version ids to their version strings for a
// set of listings, so a card can show "installed 1.2.0" without the client
// making a request per row.
func (h *Handler) marketplaceVersionNames(ctx context.Context, ids []pgtype.UUID) map[string]string {
	names := make(map[string]string, len(ids))
	for _, id := range ids {
		if !id.Valid {
			continue
		}
		key := uuidToString(id)
		if _, seen := names[key]; seen {
			continue
		}
		version, err := h.Queries.GetMarketplaceListingVersion(ctx, id)
		if err != nil {
			continue
		}
		names[key] = version.Version
	}
	return names
}

// marketplaceWorkspaceNames resolves publisher workspace names. Listings come
// from few distinct workspaces even when there are many of them, so a cached
// lookup per distinct id is cheaper than a join that would have to cross the
// no-foreign-key rule anyway.
func (h *Handler) marketplaceWorkspaceNames(ctx context.Context, listings []db.MarketplaceListing) map[string]string {
	names := map[string]string{}
	for _, listing := range listings {
		key := uuidToString(listing.WorkspaceID)
		if _, seen := names[key]; seen {
			continue
		}
		workspace, err := h.Queries.GetWorkspace(ctx, listing.WorkspaceID)
		if err != nil {
			names[key] = ""
			continue
		}
		names[key] = workspace.Name
	}
	return names
}

func marketplaceListingToResponse(
	listing db.MarketplaceListing,
	workspaceID pgtype.UUID,
	member db.Member,
	publisherName string,
	latestVersion string,
	install *db.MarketplaceInstall,
	installedVersion string,
) MarketplaceListingResponse {
	tags := listing.Tags
	if tags == nil {
		tags = []string{}
	}
	resp := MarketplaceListingResponse{
		ID:                     uuidToString(listing.ID),
		Kind:                   listing.Kind,
		Slug:                   listing.Slug,
		Name:                   listing.Name,
		Description:            listing.Description,
		Category:               listing.Category,
		Tags:                   tags,
		Visibility:             listing.Visibility,
		Status:                 listing.Status,
		Featured:               listing.Featured,
		InstallCount:           listing.InstallCount,
		PublisherWorkspaceID:   uuidToString(listing.WorkspaceID),
		PublisherWorkspaceName: publisherName,
		LatestVersion:          latestVersion,
		CanManage:              canManageMarketplaceListing(listing, workspaceID, member),
		CreatedAt:              timestampToString(listing.CreatedAt),
		UpdatedAt:              timestampToString(listing.UpdatedAt),
	}
	if listing.LatestVersionID.Valid {
		resp.LatestVersionID = uuidToString(listing.LatestVersionID)
	}
	if install != nil {
		resp.Installed = true
		resp.InstalledVersionID = uuidToString(install.VersionID)
		resp.InstalledVersion = installedVersion
	}
	return resp
}

func marketplaceVersionToResponse(version db.MarketplaceListingVersion) MarketplaceVersionResponse {
	manifest := json.RawMessage(version.Manifest)
	if len(manifest) == 0 {
		manifest = json.RawMessage("{}")
	}
	return MarketplaceVersionResponse{
		ID:          uuidToString(version.ID),
		ListingID:   uuidToString(version.ListingID),
		Version:     version.Version,
		Changelog:   version.Changelog,
		Digest:      version.Digest,
		SizeBytes:   version.SizeBytes,
		Manifest:    manifest,
		PublishedBy: uuidToPtr(version.PublishedBy),
		CreatedAt:   timestampToString(version.CreatedAt),
	}
}

// matchesMarketplaceQuery is the free-text filter: a case-insensitive substring
// over the fields a reader would search by. Deliberately not a ranked search —
// the directory is small enough that "contains" is the honest behaviour, and a
// relevance score nobody can explain is worse than none.
func matchesMarketplaceQuery(listing db.MarketplaceListing, query string) bool {
	if query == "" {
		return true
	}
	haystack := strings.ToLower(strings.Join(append([]string{
		listing.Name, listing.Slug, listing.Description, listing.Category,
	}, listing.Tags...), "\n"))
	return strings.Contains(haystack, query)
}

// ListMarketplaceListings is the directory browse. Filters and facets are
// applied in Go over the workspace's visible set — see the note on
// ListVisibleMarketplaceListings for why that is the right shape here.
func (h *Handler) ListMarketplaceListings(w http.ResponseWriter, r *http.Request) {
	wsUUID, member, ok := h.requireMarketplaceReader(w, r)
	if !ok {
		return
	}

	listings, err := h.Queries.ListVisibleMarketplaceListings(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list marketplace listings")
		return
	}

	kind := strings.TrimSpace(r.URL.Query().Get("kind"))
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	tag := strings.TrimSpace(r.URL.Query().Get("tag"))
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	includeDeprecated := r.URL.Query().Get("include_deprecated") == "true"
	// A publisher managing their own listings asks for drafts explicitly;
	// browsing never mixes them into the directory.
	mine := r.URL.Query().Get("mine") == "true"
	// `installed=true|false` narrows to what this workspace already holds, or
	// to what it does not. Anything else means no narrowing.
	installedFilter := strings.TrimSpace(r.URL.Query().Get("installed"))
	if installedFilter != "true" && installedFilter != "false" {
		installedFilter = ""
	}

	visible := make([]db.MarketplaceListing, 0, len(listings))
	for _, listing := range listings {
		own := listing.WorkspaceID == wsUUID
		if mine && !own {
			continue
		}
		if !mine {
			// Someone else's listing is already filtered by the query; the
			// publisher's own drafts and takedowns are not, so drop them here
			// unless they asked to manage them.
			if own && listing.Status != marketplaceStatusPublished && listing.Status != marketplaceStatusDeprecated {
				continue
			}
			if listing.Status == marketplaceStatusDeprecated && !includeDeprecated {
				continue
			}
			// A workspace-visibility listing belongs to its own workspace's
			// library and never appears in another workspace's browse; the
			// query already guarantees that, and this keeps it true if the
			// query ever widens.
			if !own && listing.Visibility != marketplaceVisibilityPublic {
				continue
			}
		}
		visible = append(visible, listing)
	}

	// Install state is read before the facets: "installed" is a facet like any
	// other, counted over the visible set so its chip shows a number before it
	// is chosen.
	installState := h.marketplaceInstallState(r.Context(), wsUUID)

	facets := MarketplaceFacets{
		Kinds:      map[string]int{},
		Categories: map[string]int{},
		Tags:       map[string]int{},
		Installed: map[string]int{
			marketplaceInstalledFilterInstalled:    0,
			marketplaceInstalledFilterNotInstalled: 0,
		},
	}
	for _, listing := range visible {
		facets.Kinds[listing.Kind]++
		if listing.Category != "" {
			facets.Categories[listing.Category]++
		}
		for _, t := range listing.Tags {
			facets.Tags[t]++
		}
		if _, installed := installState[uuidToString(listing.ID)]; installed {
			facets.Installed[marketplaceInstalledFilterInstalled]++
		} else {
			facets.Installed[marketplaceInstalledFilterNotInstalled]++
		}
	}

	filtered := make([]db.MarketplaceListing, 0, len(visible))
	for _, listing := range visible {
		if kind != "" && listing.Kind != kind {
			continue
		}
		if installedFilter != "" {
			_, installed := installState[uuidToString(listing.ID)]
			if installed != (installedFilter == "true") {
				continue
			}
		}
		if category != "" && listing.Category != category {
			continue
		}
		if tag != "" && !hasMarketplaceTag(listing.Tags, tag) {
			continue
		}
		if !matchesMarketplaceQuery(listing, query) {
			continue
		}
		filtered = append(filtered, listing)
	}

	publishers := h.marketplaceWorkspaceNames(r.Context(), filtered)
	versionIDs := make([]pgtype.UUID, 0, len(filtered)*2)
	for _, listing := range filtered {
		versionIDs = append(versionIDs, listing.LatestVersionID)
		if install, ok := installState[uuidToString(listing.ID)]; ok {
			versionIDs = append(versionIDs, install.VersionID)
		}
	}
	versionNames := h.marketplaceVersionNames(r.Context(), versionIDs)

	resp := MarketplaceCatalogResponse{
		Count:    len(filtered),
		Total:    len(visible),
		Listings: make([]MarketplaceListingResponse, 0, len(filtered)),
		Facets:   facets,
	}
	for _, listing := range filtered {
		var install *db.MarketplaceInstall
		installedVersion := ""
		if found, ok := installState[uuidToString(listing.ID)]; ok {
			install = &found
			installedVersion = versionNames[uuidToString(found.VersionID)]
		}
		resp.Listings = append(resp.Listings, marketplaceListingToResponse(
			listing, wsUUID, member,
			publishers[uuidToString(listing.WorkspaceID)],
			versionNames[uuidToString(listing.LatestVersionID)],
			install, installedVersion,
		))
	}
	writeJSON(w, http.StatusOK, resp)
}

// GetMarketplaceListing opens one listing. `?version_id=` reads a specific
// version; without it the listing's latest is returned.
func (h *Handler) GetMarketplaceListing(w http.ResponseWriter, r *http.Request) {
	wsUUID, member, ok := h.requireMarketplaceReader(w, r)
	if !ok {
		return
	}
	listing, ok := h.loadMarketplaceListing(w, r, wsUUID)
	if !ok {
		return
	}

	version, ok := h.resolveMarketplaceVersion(w, r, listing)
	if !ok {
		return
	}

	publishers := h.marketplaceWorkspaceNames(r.Context(), []db.MarketplaceListing{listing})
	installState := h.marketplaceInstallState(r.Context(), wsUUID)
	latestName := ""
	if listing.LatestVersionID.Valid {
		latestName = h.marketplaceVersionNames(r.Context(), []pgtype.UUID{listing.LatestVersionID})[uuidToString(listing.LatestVersionID)]
	}

	var install *db.MarketplaceInstall
	installedVersion := ""
	if found, ok := installState[uuidToString(listing.ID)]; ok {
		install = &found
		installedVersion = h.marketplaceVersionNames(r.Context(), []pgtype.UUID{found.VersionID})[uuidToString(found.VersionID)]
	}

	detail := MarketplaceListingDetailResponse{
		MarketplaceListingResponse: marketplaceListingToResponse(
			listing, wsUUID, member,
			publishers[uuidToString(listing.WorkspaceID)],
			latestName, install, installedVersion,
		),
		FilePaths: []string{},
	}
	if version != nil {
		versionResp := marketplaceVersionToResponse(*version)
		detail.Version = &versionResp
		files, err := h.Queries.ListMarketplaceListingFiles(r.Context(), version.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read the version's files")
			return
		}
		for _, file := range files {
			detail.FilePaths = append(detail.FilePaths, file.Path)
		}
	}
	writeJSON(w, http.StatusOK, detail)
}

// resolveMarketplaceVersion picks the version a read is about: an explicit
// `?version_id=` belonging to this listing, or the listing's latest. A listing
// with no version at all yields (nil, true) — a draft nobody has published to
// is a legitimate thing to open.
func (h *Handler) resolveMarketplaceVersion(w http.ResponseWriter, r *http.Request, listing db.MarketplaceListing) (*db.MarketplaceListingVersion, bool) {
	requested := strings.TrimSpace(r.URL.Query().Get("version_id"))
	if requested == "" {
		if !listing.LatestVersionID.Valid {
			return nil, true
		}
		version, err := h.Queries.GetMarketplaceListingVersion(r.Context(), listing.LatestVersionID)
		if err != nil {
			return nil, true
		}
		return &version, true
	}
	versionUUID, ok := parseUUIDOrBadRequest(w, requested, "version_id")
	if !ok {
		return nil, false
	}
	version, err := h.Queries.GetMarketplaceListingVersion(r.Context(), versionUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "version not found")
		return nil, false
	}
	// A version id from another listing would read one listing's files through
	// another's visibility gate.
	if version.ListingID != listing.ID {
		writeError(w, http.StatusNotFound, "version not found")
		return nil, false
	}
	return &version, true
}

// ListMarketplaceListingVersions returns a listing's version history.
func (h *Handler) ListMarketplaceListingVersions(w http.ResponseWriter, r *http.Request) {
	wsUUID, _, ok := h.requireMarketplaceReader(w, r)
	if !ok {
		return
	}
	listing, ok := h.loadMarketplaceListing(w, r, wsUUID)
	if !ok {
		return
	}
	versions, err := h.Queries.ListMarketplaceListingVersions(r.Context(), listing.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list versions")
		return
	}
	resp := make([]MarketplaceVersionResponse, 0, len(versions))
	for _, version := range versions {
		resp = append(resp, marketplaceVersionToResponse(version))
	}
	writeJSON(w, http.StatusOK, resp)
}

// MarketplaceFileResponse is one file of a version, read on demand so opening a
// listing never pulls the whole bundle.
type MarketplaceFileResponse struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// GetMarketplaceListingFile returns one file's content by `?path=`.
func (h *Handler) GetMarketplaceListingFile(w http.ResponseWriter, r *http.Request) {
	wsUUID, _, ok := h.requireMarketplaceReader(w, r)
	if !ok {
		return
	}
	listing, ok := h.loadMarketplaceListing(w, r, wsUUID)
	if !ok {
		return
	}
	version, ok := h.resolveMarketplaceVersion(w, r, listing)
	if !ok {
		return
	}
	if version == nil {
		writeError(w, http.StatusNotFound, "this listing has no published version")
		return
	}
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	if path == "" {
		writeError(w, http.StatusBadRequest, "path is required")
		return
	}
	files, err := h.Queries.ListMarketplaceListingFiles(r.Context(), version.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read the version's files")
		return
	}
	for _, file := range files {
		if file.Path == path {
			writeJSON(w, http.StatusOK, MarketplaceFileResponse{Path: file.Path, Content: file.Content})
			return
		}
	}
	writeError(w, http.StatusNotFound, "file not found in this version")
}

// ListMarketplaceInstalls returns this workspace's provenance records, so the
// Skills and Agents pages can show where an entity came from and whether a
// newer version exists.
func (h *Handler) ListMarketplaceInstalls(w http.ResponseWriter, r *http.Request) {
	wsUUID, _, ok := h.requireMarketplaceReader(w, r)
	if !ok {
		return
	}
	installs, err := h.Queries.ListMarketplaceInstallsForWorkspace(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list marketplace installs")
		return
	}
	versionIDs := make([]pgtype.UUID, 0, len(installs))
	for _, install := range installs {
		versionIDs = append(versionIDs, install.VersionID)
	}
	names := h.marketplaceVersionNames(r.Context(), versionIDs)

	resp := make([]MarketplaceInstallResponse, 0, len(installs))
	for _, install := range installs {
		resp = append(resp, MarketplaceInstallResponse{
			ID:         uuidToString(install.ID),
			ListingID:  uuidToString(install.ListingID),
			VersionID:  uuidToString(install.VersionID),
			Version:    names[uuidToString(install.VersionID)],
			EntityKind: install.EntityKind,
			EntityID:   uuidToString(install.EntityID),
			CreatedAt:  timestampToString(install.CreatedAt),
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

// marketplaceListingVersionFiles reads a version's file set into the in-memory
// shape the installer works with.
func (h *Handler) marketplaceListingVersionFiles(ctx context.Context, versionID pgtype.UUID) ([]marketplaceFile, error) {
	rows, err := h.Queries.ListMarketplaceListingFiles(ctx, versionID)
	if err != nil {
		return nil, err
	}
	files := make([]marketplaceFile, 0, len(rows))
	for _, row := range rows {
		files = append(files, marketplaceFile{Path: row.Path, Content: row.Content})
	}
	return files, nil
}

// decodeMarketplaceManifest reads a stored manifest, rejecting one whose kind
// does not match the listing it hangs off. A mismatch means the installer would
// build the wrong kind of entity from it.
func decodeMarketplaceManifest(raw []byte, kind string) (marketplaceManifest, error) {
	var manifest marketplaceManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return marketplaceManifest{}, errors.New("the published manifest is malformed")
	}
	if manifest.Kind != kind {
		return marketplaceManifest{}, errors.New("the published manifest does not match this listing's kind")
	}
	return manifest, nil
}

func hasMarketplaceTag(tags []string, target string) bool {
	for _, tag := range tags {
		if tag == target {
			return true
		}
	}
	return false
}

// sortedStrings returns a sorted copy, so a manifest's file list and tag list
// are stable across publishes of identical content and the digest is too.
func sortedStrings(values []string) []string {
	out := make([]string, len(values))
	copy(out, values)
	sort.Strings(out)
	return out
}

// marketplaceRowMissing distinguishes "no such row" from a real read failure at
// the few call sites that care.
func marketplaceRowMissing(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
