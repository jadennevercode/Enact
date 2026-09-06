package handler

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/enact-ai/enact/server/internal/logger"
	"github.com/enact-ai/enact/server/internal/recommend"
	"github.com/enact-ai/enact/server/internal/workspaceprofile"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
)

// Recommending from the Marketplace.
//
// The ranking is computed on every request, against the directory as it is at
// that moment. Nothing is cached and nothing is precomputed, because the whole
// point is that the directory changes: a listing published this afternoon has
// to reach a workspace that was set up this morning, and a workspace that
// rewrites its profile has to see a different answer on its next page load.
//
// A per-deployment directory is hundreds of rows. Scoring them is a string
// pass over metadata the browse endpoint already reads, so "recompute every
// time" costs one query more than browsing does.
//
// What is NOT here: any model call. See internal/recommend for why.

// marketplaceOfficialPublisherSlug is the workspace whose listings are the
// product's own. It pairs with the catalog workspace the server provisions at
// boot; if that slug ever changes, this must change with it, and the only
// symptom of a mismatch would be official listings quietly losing their badge.
const marketplaceOfficialPublisherSlug = "enact"

// defaultRecommendationLimit is what the rail shows without asking. Small on
// purpose: a recommendation the member does not read is worse than no
// recommendation, and the full directory is one click away.
const defaultRecommendationLimit = 6

// maxRecommendationLimit bounds `?limit=`, so a caller cannot turn this into
// an unpaginated directory dump with a scoring pass attached.
const maxRecommendationLimit = 50

// MarketplaceRecommendationReason is one piece of evidence for a
// recommendation, on the wire.
type MarketplaceRecommendationReason struct {
	Kind string `json:"kind"`
	// Term is the profile value that matched. Empty for reasons that are not
	// about this workspace ("official", "featured", "popular").
	Term  string `json:"term,omitempty"`
	Field string `json:"field,omitempty"`
	Score int    `json:"score"`
}

// MarketplaceRecommendationResponse is one ranked listing.
//
// It embeds the same listing shape browse returns, so a client renders the
// rail with the card component it already has and the Install dialog it
// already has. What is added is only the verdict.
type MarketplaceRecommendationResponse struct {
	Listing MarketplaceListingResponse        `json:"listing"`
	Score   int                               `json:"score"`
	Reasons []MarketplaceRecommendationReason `json:"reasons"`
	// Matched is whether any reason came from this workspace's own profile.
	// A false here means "we do not know what fits you; this is what the
	// deployment ships", and the client must say so rather than presenting it
	// as a match.
	Matched bool `json:"matched"`
}

// MarketplaceRecommendationsResponse is the whole rail.
type MarketplaceRecommendationsResponse struct {
	Recommendations []MarketplaceRecommendationResponse `json:"recommendations"`
	// ProfileEmpty says the ranking had nothing to go on. The client turns
	// this into "tell us about your project" rather than into an empty rail,
	// which would read as "there is nothing for you here".
	ProfileEmpty bool `json:"profile_empty"`
	// Considered is how many listings were eligible before scoring — visible,
	// installable, not already installed, not dismissed. It is what makes an
	// empty rail explicable: nothing matched out of forty is a different
	// message from nothing matched out of zero.
	Considered int `json:"considered"`
}

// ListMarketplaceRecommendations ranks the directory for this workspace.
func (h *Handler) ListMarketplaceRecommendations(w http.ResponseWriter, r *http.Request) {
	wsUUID, member, ok := h.requireMarketplaceReader(w, r)
	if !ok {
		return
	}

	limit := defaultRecommendationLimit
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		limit = min(parsed, maxRecommendationLimit)
	}

	ws, err := h.Queries.GetWorkspace(r.Context(), wsUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	profile := workspaceprofile.Parse(ws.Profile)

	listings, err := h.Queries.ListVisibleMarketplaceListings(r.Context(), wsUUID)
	if err != nil {
		slog.Warn("list marketplace listings for recommendations failed",
			append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to read the directory")
		return
	}

	eligible, byID := h.eligibleRecommendationCandidates(r, wsUUID, listings)

	ranked := recommend.Rank(profile, eligible, limit)
	resp := MarketplaceRecommendationsResponse{
		Recommendations: make([]MarketplaceRecommendationResponse, 0, len(ranked)),
		ProfileEmpty:    profile.IsEmpty(),
		Considered:      len(eligible),
	}
	if len(ranked) == 0 {
		writeJSON(w, http.StatusOK, resp)
		return
	}

	surfaced := make([]db.MarketplaceListing, 0, len(ranked))
	versionIDs := make([]pgtype.UUID, 0, len(ranked))
	for _, scored := range ranked {
		listing := byID[scored.Candidate.ID]
		surfaced = append(surfaced, listing)
		versionIDs = append(versionIDs, listing.LatestVersionID)
	}
	publishers := h.marketplaceWorkspaceNames(r.Context(), surfaced)
	versionNames := h.marketplaceVersionNames(r.Context(), versionIDs)

	for i, scored := range ranked {
		listing := surfaced[i]
		reasons := make([]MarketplaceRecommendationReason, 0, len(scored.Reasons))
		for _, reason := range scored.Reasons {
			reasons = append(reasons, MarketplaceRecommendationReason{
				Kind:  string(reason.Kind),
				Term:  reason.Term,
				Field: reason.Field,
				Score: reason.Score,
			})
		}
		resp.Recommendations = append(resp.Recommendations, MarketplaceRecommendationResponse{
			Listing: marketplaceListingToResponse(
				listing, wsUUID, member,
				publishers[uuidToString(listing.WorkspaceID)],
				versionNames[uuidToString(listing.LatestVersionID)],
				// Eligibility already excluded everything this workspace has
				// installed, so there is no install to fold in.
				nil, "",
			),
			Score:   scored.Score,
			Reasons: reasons,
			Matched: scored.Matched,
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

// eligibleRecommendationCandidates narrows the directory to what this
// workspace could actually act on, and turns each row into a ranker candidate.
//
// Four exclusions, each for its own reason:
//
//   - not installable (draft, removed) — nothing to offer.
//   - deprecated — still installable for a workspace that depends on it, but
//     recommending one to a workspace that does not is pointing at a dead end.
//   - already installed — the workspace has it; the update prompt is browse's
//     job, not the rail's.
//   - dismissed at the current version — the member said no. Publishing a new
//     version puts it back, which is why the stored version is compared rather
//     than the row's mere existence.
func (h *Handler) eligibleRecommendationCandidates(
	r *http.Request,
	wsUUID pgtype.UUID,
	listings []db.MarketplaceListing,
) ([]recommend.Candidate, map[string]db.MarketplaceListing) {
	installed := h.marketplaceInstallState(r.Context(), wsUUID)
	dismissed := h.marketplaceDismissals(r, wsUUID)
	official := h.officialPublisherWorkspaceIDs(r, listings)

	candidates := make([]recommend.Candidate, 0, len(listings))
	byID := make(map[string]db.MarketplaceListing, len(listings))
	for _, listing := range listings {
		id := uuidToString(listing.ID)
		if listing.Status != marketplaceStatusPublished {
			continue
		}
		if _, ok := installed[id]; ok {
			continue
		}
		if version, ok := dismissed[id]; ok && version == uuidToString(listing.LatestVersionID) {
			continue
		}
		byID[id] = listing
		candidates = append(candidates, recommend.Candidate{
			ID:          id,
			Kind:        listing.Kind,
			Name:        listing.Name,
			Description: listing.Description,
			Category:    listing.Category,
			Tags:        listing.Tags,
			Featured:    listing.Featured,
			// A negative install_count is impossible (the column has a CHECK),
			// so this is a straight read.
			InstallCount: listing.InstallCount,
			Official:     official[uuidToString(listing.WorkspaceID)],
			// ExtraText is left empty on purpose. For a skill listing the
			// publish path already copies SKILL.md's description into the
			// listing description, which is the richest matching text there
			// is; for an agent template the remaining text is its
			// instructions, and reading one manifest per listing would turn a
			// two-query endpoint into a hundred-query one to weight a field at
			// one point.
		})
	}
	return candidates, byID
}

// marketplaceDismissals maps listing id → the version the workspace turned
// down. Advisory: a read failure yields no dismissals, which shows a member
// something they already declined rather than showing them nothing.
func (h *Handler) marketplaceDismissals(r *http.Request, wsUUID pgtype.UUID) map[string]string {
	out := map[string]string{}
	rows, err := h.Queries.ListMarketplaceRecommendationDecisions(r.Context(), wsUUID)
	if err != nil {
		slog.Warn("read marketplace dismissals failed", append(logger.RequestAttrs(r), "error", err)...)
		return out
	}
	for _, row := range rows {
		out[uuidToString(row.ListingID)] = uuidToString(row.VersionID)
	}
	return out
}

// officialPublisherWorkspaceIDs resolves which of the publishing workspaces is
// the product's own catalog. Resolved by slug rather than by a stored flag
// because the flag would be one more thing to keep true; the catalog is a
// workspace like any other, distinguished only by which one it is.
func (h *Handler) officialPublisherWorkspaceIDs(
	r *http.Request,
	listings []db.MarketplaceListing,
) map[string]bool {
	out := map[string]bool{}
	seen := map[string]bool{}
	for _, listing := range listings {
		id := uuidToString(listing.WorkspaceID)
		if seen[id] {
			continue
		}
		seen[id] = true
		ws, err := h.Queries.GetWorkspace(r.Context(), listing.WorkspaceID)
		if err != nil {
			continue
		}
		if ws.Slug == marketplaceOfficialPublisherSlug {
			out[id] = true
		}
	}
	return out
}

// DismissMarketplaceRecommendation records that this workspace does not want a
// listing recommended.
//
// It is scoped to the version the member was looking at, so this is "not this
// one" rather than "never". A new version of the same listing is a different
// proposition and comes back.
func (h *Handler) DismissMarketplaceRecommendation(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	wsUUID, _, ok := h.requireMarketplaceReader(w, r)
	if !ok {
		return
	}
	listingUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "listing id")
	if !ok {
		return
	}
	listing, err := h.Queries.GetMarketplaceListing(r.Context(), listingUUID)
	if err != nil {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}
	// The visibility gate is the same one browse applies: a workspace must not
	// be able to probe for the existence of another workspace's private
	// listing by dismissing ids.
	if !marketplaceVisibleTo(listing, wsUUID) {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}

	if _, err := h.Queries.UpsertMarketplaceRecommendationDecision(
		r.Context(),
		db.UpsertMarketplaceRecommendationDecisionParams{
			WorkspaceID: wsUUID,
			ListingID:   listing.ID,
			VersionID:   listing.LatestVersionID,
			DecidedBy:   parseUUID(userID),
		},
	); err != nil {
		slog.Warn("dismiss marketplace recommendation failed",
			append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to record the decision")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RestoreMarketplaceRecommendation undoes a dismissal, putting the listing
// back in the ranking immediately.
func (h *Handler) RestoreMarketplaceRecommendation(w http.ResponseWriter, r *http.Request) {
	wsUUID, _, ok := h.requireMarketplaceReader(w, r)
	if !ok {
		return
	}
	listingUUID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "listing id")
	if !ok {
		return
	}
	if err := h.Queries.DeleteMarketplaceRecommendationDecision(
		r.Context(),
		db.DeleteMarketplaceRecommendationDecisionParams{
			WorkspaceID: wsUUID,
			ListingID:   listingUUID,
		},
	); err != nil {
		slog.Warn("restore marketplace recommendation failed",
			append(logger.RequestAttrs(r), "error", err)...)
		writeError(w, http.StatusInternalServerError, "failed to clear the decision")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
