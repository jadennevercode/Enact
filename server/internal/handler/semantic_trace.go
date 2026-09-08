package handler

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/enact-ai/enact/server/internal/semantic"
)

// semanticExecutionTrace projects durable execution evidence. It never asks a
// model to reconstruct a proof or treats a graph association as a fired rule.
func semanticExecutionTrace(run map[string]any) map[string]any {
	nodes := []map[string]any{}
	edges := []map[string]any{}
	seen := map[string]bool{}
	addNode := func(id, label, kind, status string, metadata any) {
		if seen[id] {
			return
		}
		seen[id] = true
		nodes = append(nodes, map[string]any{"id": id, "label": label, "type": kind, "kind": kind, "layer": "execution", "status": status, "metadata": metadata})
	}
	addEdge := func(source, target, label string) {
		edges = append(edges, map[string]any{"id": semantic.Digest([]string{source, target, label}), "source": source, "target": target, "label": label, "type": label})
	}
	text := func(value any) string {
		if value == nil {
			return ""
		}
		return fmt.Sprint(value)
	}
	releaseID := text(run["release_id"])
	addNode("release:"+releaseID, "Pinned ontology release", "ontology", "published", map[string]any{"release_id": releaseID})
	steps, _ := run["steps"].([]any)
	for _, raw := range steps {
		step, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id := "step:" + text(step["id"])
		kind, status := text(step["kind"]), text(step["status"])
		input, _ := step["input"].(map[string]any)
		label := kind
		if binding := text(input["binding_id"]); binding != "" {
			label = binding
		}
		addNode(id, label, kind, status, step)
		addEdge("release:"+releaseID, id, "governs")
		if sourceIDs, ok := input["source_step_ids"].([]any); ok {
			for _, source := range sourceIDs {
				addEdge("step:"+text(source), id, "provides evidence")
			}
		}
		output, _ := step["output"].(map[string]any)
		derivations, _ := output["derivations"].([]any)
		for _, rawDerivation := range derivations {
			derivation, ok := rawDerivation.(map[string]any)
			if !ok {
				continue
			}
			rule := text(derivation["rule_id"])
			if rule == "" {
				rule = text(derivation["rule_used"])
			}
			ruleID := id + ":rule:" + semantic.Digest(derivation)
			addNode(ruleID, rule, "rule", status, derivation)
			addEdge(id, ruleID, "evaluated")
			premises, _ := derivation["premises"].([]any)
			for _, premise := range premises {
				factID := id + ":fact:" + semantic.Digest(premise)
				addNode(factID, text(premise), "fact", status, map[string]any{"statement": premise, "step_id": step["id"]})
				addEdge(factID, ruleID, "premise")
			}
			if conclusion := derivation["conclusion"]; conclusion != nil {
				factID := id + ":fact:" + semantic.Digest(conclusion)
				addNode(factID, text(conclusion), "conclusion", status, map[string]any{"statement": conclusion, "step_id": step["id"]})
				addEdge(ruleID, factID, "derived")
			}
		}
	}
	approvals, _ := run["approvals"].([]any)
	for _, raw := range approvals {
		approval, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id := "approval:" + text(approval["id"])
		addNode(id, text(approval["binding_id"]), "approval", text(approval["status"]), approval)
		if evaluation := text(approval["evaluation_step_id"]); evaluation != "" {
			addEdge("step:"+evaluation, id, "authorizes intent")
		} else {
			addEdge("release:"+releaseID, id, "defines action")
		}
	}
	receipts, _ := run["receipts"].([]any)
	for _, raw := range receipts {
		receipt, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id := "receipt:" + text(receipt["id"])
		addNode(id, text(receipt["binding_id"]), "receipt", text(receipt["status"]), receipt)
		addEdge("approval:"+text(receipt["approval_id"]), id, "execution receipt")
	}
	return map[string]any{"run_id": run["id"], "release_id": releaseID, "nodes": nodes, "edges": edges, "steps": run["steps"], "approvals": run["approvals"], "receipts": run["receipts"], "source": "execution-events"}
}

func (h *Handler) semanticRunTrace(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return
	}
	id, ok := semanticParam(w, r, "id")
	if !ok || !h.semanticOwnRun(w, r, &actor, id) {
		return
	}
	var raw json.RawMessage
	err := h.DB.QueryRow(r.Context(), `SELECT to_jsonb(x) || jsonb_build_object(
 'steps',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY created_at,id) FROM semantic_step s WHERE s.workspace_id=x.workspace_id AND s.run_id=x.id),'[]'::jsonb),
 'approvals',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY created_at,id) FROM semantic_approval a WHERE a.workspace_id=x.workspace_id AND a.run_id=x.id),'[]'::jsonb),
 'receipts',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY created_at,id) FROM semantic_receipt p WHERE p.workspace_id=x.workspace_id AND p.run_id=x.id),'[]'::jsonb))
 FROM semantic_run x WHERE workspace_id=$1 AND id=$2 AND requested_by=$3`, actor.WorkspaceID, id, actor.UserID).Scan(&raw)
	var run map[string]any
	if err != nil || json.Unmarshal(raw, &run) != nil {
		writeError(w, 500, "failed to load execution evidence")
		return
	}
	writeJSON(w, 200, semanticExecutionTrace(semanticPresentationRun(r.Context(), run)))
}
