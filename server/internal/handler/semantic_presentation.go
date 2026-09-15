package handler

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/enact-ai/enact/server/internal/semanticapp"
)

type semanticPresentationKey struct{}

// Filter at the server boundary: the same Issue can be presented by an app
// with fewer capabilities without disclosing unrelated historical reads.
func semanticPresentationRun(ctx context.Context, run map[string]any) map[string]any {
	manifest, restricted := ctx.Value(semanticPresentationKey{}).(semanticapp.Manifest)
	if !restricted {
		return run
	}
	visible := map[string]bool{}
	steps := []any{}
	allSteps, _ := run["steps"].([]any)
	for _, raw := range allSteps {
		step, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		input, _ := step["input"].(map[string]any)
		binding, _ := input["binding_id"].(string)
		allow := false
		switch step["kind"] {
		case "data_query":
			allow = applicationAllows(manifest.Queries, binding)
		case "ontology_query", "ontology_context":
			allow = applicationAllows(manifest.Queries, "@ontology")
		case "rule_evaluation", "policy_evaluation", "business_report":
			ids, _ := input["source_step_ids"].([]any)
			allow = len(ids) > 0
			for _, id := range ids {
				key, _ := id.(string)
				if !visible[key] {
					allow = false
				}
			}
		case "business_plan":
			allow = applicationAllows(manifest.Queries, "@ontology")
			plans, _ := input["steps"].([]any)
			for _, rawPlan := range plans {
				plan, _ := rawPlan.(map[string]any)
				bindings, _ := plan["binding_ids"].([]any)
				for _, rawBinding := range bindings {
					b, _ := rawBinding.(string)
					if !applicationAllows(manifest.Queries, b) && !applicationAllows(manifest.Actions, b) {
						allow = false
					}
				}
			}
		}
		if step["kind"] == "policy_evaluation" && allow {
			// A Site may only inspect policy outcomes whose concrete intents
			// stay inside its action capability list.
			output, _ := step["output"].(map[string]any)
			intents, _ := output["action_intents"].([]any)
			for _, rawIntent := range intents {
				intent, _ := rawIntent.(map[string]any)
				b, _ := intent["binding_id"].(string)
				if !applicationAllows(manifest.Actions, b) {
					allow = false
				}
			}
		}
		if allow {
			id, _ := step["id"].(string)
			visible[id] = true
			steps = append(steps, step)
		}
	}
	approvals := []any{}
	allApprovals, _ := run["approvals"].([]any)
	for _, raw := range allApprovals {
		approval, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		binding, _ := approval["binding_id"].(string)
		evaluation, _ := approval["evaluation_step_id"].(string)
		if applicationAllows(manifest.Actions, binding) && (evaluation == "" || visible[evaluation]) {
			id, _ := approval["id"].(string)
			visible["approval:"+id] = true
			approvals = append(approvals, approval)
		}
	}
	receipts := []any{}
	allReceipts, _ := run["receipts"].([]any)
	for _, raw := range allReceipts {
		receipt, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		approval, _ := receipt["approval_id"].(string)
		if visible["approval:"+approval] {
			receipts = append(receipts, receipt)
		}
	}
	run["steps"], run["approvals"], run["receipts"] = steps, approvals, receipts
	return run
}

func (h *Handler) semanticPresentationEvaluation(w http.ResponseWriter, r *http.Request, actor semanticActor, runID string, input map[string]any, manifest semanticapp.Manifest) bool {
	ids, _ := input["source_step_ids"].([]any)
	for _, raw := range ids {
		id, _ := raw.(string)
		if _, ok := parseUUIDOrBadRequest(w, id, "source_step_ids"); !ok {
			return false
		}
		var request json.RawMessage
		if err := h.DB.QueryRow(r.Context(), `SELECT input FROM semantic_step WHERE workspace_id=$1 AND run_id=$2 AND id=$3 AND kind='data_query' AND status='succeeded'`, actor.WorkspaceID, runID, id).Scan(&request); err != nil {
			writeError(w, 404, "source step not found")
			return false
		}
		var query struct {
			BindingID string `json:"binding_id"`
		}
		if json.Unmarshal(request, &query) != nil || !applicationAllows(manifest.Queries, query.BindingID) {
			writeError(w, 403, "source step is outside the application capabilities")
			return false
		}
	}
	return true
}
