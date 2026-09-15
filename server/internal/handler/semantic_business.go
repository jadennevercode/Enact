package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"strings"
	"time"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/enact-ai/enact/server/internal/semanticapp"
	"github.com/google/uuid"
)

func (h *Handler) semanticBusinessRun(w http.ResponseWriter, r *http.Request) (semanticActor, string, semanticRelease, bool) {
	actor, ok := h.semanticScope(w, r, false)
	if !ok {
		return actor, "", semanticRelease{}, false
	}
	id, ok := semanticParam(w, r, "id")
	if !ok || !h.semanticOwnRun(w, r, &actor, id) {
		return actor, id, semanticRelease{}, false
	}
	release, err := h.semanticRunRelease(r, actor.WorkspaceID, id)
	if err != nil {
		writeError(w, 404, err.Error())
		return actor, id, release, false
	}
	return actor, id, release, true
}

func (h *Handler) semanticBusinessContext(w http.ResponseWriter, r *http.Request) {
	actor, id, release, ok := h.semanticBusinessRun(w, r)
	if !ok {
		return
	}
	if !h.semanticRunCapability(w, r, actor, id, "@ontology", false) {
		return
	}
	var input struct {
		Question  string   `json:"question"`
		EntityIDs []string `json:"entity_ids"`
		Hops      int      `json:"hops"`
	}
	input.Hops = 2
	if !semanticDecode(w, r, &input) {
		return
	}
	if input.EntityIDs == nil {
		input.EntityIDs = []string{}
	}
	if strings.TrimSpace(input.Question) == "" || len(input.Question) > 10000 || input.Hops < 0 || input.Hops > 5 || len(input.EntityIDs) > 100 {
		writeError(w, 400, "provide a question, zero to five hops, and at most one hundred entity types")
		return
	}
	var artifact struct {
		Definition struct {
			Entities []struct {
				ID string `json:"id"`
			} `json:"entities"`
		} `json:"definition"`
	}
	_ = json.Unmarshal(release.Artifact, &artifact)
	known := map[string]bool{}
	for _, entity := range artifact.Definition.Entities {
		known[entity.ID] = true
	}
	seen := map[string]bool{}
	for _, entity := range input.EntityIDs {
		if !known[entity] || seen[entity] {
			writeError(w, 400, "context focus must contain distinct entity types from this release")
			return
		}
		seen[entity] = true
	}
	h.semanticStep(w, r, actor, id, "ontology_context", input, func() (json.RawMessage, error) {
		return semanticService(r.Context(), "native/context", map[string]any{"scope": semanticRunScope(actor, release, id), "artifact": release.Artifact, "question": input.Question, "entity_ids": input.EntityIDs, "hops": input.Hops})
	})
}

// Evidence is reconstructed from successful queries in the same run. Callers
// cannot inject role claims, system facts, or results from a different release.
func (h *Handler) semanticEvidence(r *http.Request, actor semanticActor, runID string, ids []string, fresh bool) (map[string]any, error) {
	if len(ids) == 0 || len(ids) > 100 {
		return nil, errors.New("select between one and one hundred evidence queries")
	}
	observations := map[string][]map[string]any{}
	facts := map[string]any{"bindings": map[string]any{}, "steps": map[string]any{}, "binding_step_ids": map[string]any{}, "binding_observations": observations}
	seen := map[string]bool{}
	for _, id := range ids {
		if _, err := uuid.Parse(id); err != nil || seen[id] {
			return nil, errors.New("evidence IDs must be distinct UUIDs")
		}
		seen[id] = true
		var request, output json.RawMessage
		var finished *time.Time
		err := h.DB.QueryRow(r.Context(), "SELECT input,output,finished_at FROM semantic_step WHERE workspace_id=$1 AND run_id=$2 AND id=$3 AND kind='data_query' AND status='succeeded'", actor.WorkspaceID, runID, id).Scan(&request, &output, &finished)
		if err != nil {
			return nil, errors.New("evidence is not a successful data query in this investigation")
		}
		if fresh && (finished == nil || time.Since(*finished) > 5*time.Minute) {
			return nil, errors.New("action evidence is older than five minutes; refresh the queries and review the updated action")
		}
		var query struct {
			BindingID  string         `json:"binding_id"`
			Parameters map[string]any `json:"parameters"`
		}
		var value any
		if json.Unmarshal(request, &query) != nil || json.Unmarshal(output, &value) != nil {
			return nil, errors.New("stored query evidence is invalid")
		}
		if m, restricted := r.Context().Value(semanticPresentationKey{}).(semanticapp.Manifest); restricted && !applicationAllows(m.Queries, query.BindingID) {
			return nil, errors.New("evidence is outside this application's capabilities")
		}
		facts["bindings"].(map[string]any)[query.BindingID] = value
		facts["steps"].(map[string]any)[id] = value
		observations[query.BindingID] = append(observations[query.BindingID], map[string]any{"step_id": id, "parameters": query.Parameters, "output": value})
		prior, _ := facts["binding_step_ids"].(map[string]any)[query.BindingID].([]string)
		facts["binding_step_ids"].(map[string]any)[query.BindingID] = append(prior, id)
	}
	return facts, nil
}

type semanticPolicyInput struct {
	ActionID      string         `json:"action_id"`
	Parameters    map[string]any `json:"parameters"`
	SourceStepIDs []string       `json:"source_step_ids"`
}

func (h *Handler) semanticPolicyResult(r *http.Request, actor semanticActor, runID string, release semanticRelease, input semanticPolicyInput, fresh bool) (json.RawMessage, error) {
	facts, err := h.semanticEvidence(r, actor, runID, input.SourceStepIDs, fresh)
	if err != nil {
		return nil, err
	}
	return semanticService(r.Context(), "native/policies", map[string]any{"scope": semanticRunScope(actor, release, runID), "artifact": release.Artifact, "action_id": input.ActionID, "parameters": input.Parameters, "source_step_ids": input.SourceStepIDs, "principal": map[string]any{"user_id": actor.UserID, "workspace_role": actor.Role}, "data": map[string]any{"facts": facts}})
}

func (h *Handler) semanticEvaluatePolicies(w http.ResponseWriter, r *http.Request) {
	actor, id, release, ok := h.semanticBusinessRun(w, r)
	if !ok {
		return
	}
	var input semanticPolicyInput
	if !semanticDecode(w, r, &input) {
		return
	}
	// Ontology access is needed to inspect business policies; action capability
	// is checked separately when producing or consuming a concrete intent.
	if !h.semanticRunCapability(w, r, actor, id, "@ontology", false) {
		return
	}
	h.semanticStep(w, r, actor, id, "policy_evaluation", input, func() (json.RawMessage, error) {
		raw, err := h.semanticPolicyResult(r, actor, id, release, input, true)
		if err != nil {
			return nil, err
		}
		var result map[string]any
		if json.Unmarshal(raw, &result) != nil {
			return nil, errors.New("invalid policy evaluation")
		}
		intents := []any{}
		if result["decision"] == "allow" || result["decision"] == "needs_approval" {
			for _, b := range release.Bindings.Actions {
				if b.ActionID != input.ActionID {
					continue
				}
				if m, restricted := r.Context().Value(semanticPresentationKey{}).(semanticapp.Manifest); restricted && !applicationAllows(m.Actions, b.ID) {
					continue
				}
				intent := map[string]any{"action_id": input.ActionID, "binding_id": b.ID, "parameters": input.Parameters, "source_step_ids": input.SourceStepIDs}
				intent["intent_id"] = semantic.Digest(intent)
				intents = append(intents, intent)
			}
		}
		result["action_intents"] = intents
		return semanticMarshal(result), nil
	})
}

func semanticHasDefinition(release semanticRelease) bool {
	var a struct {
		Definition json.RawMessage `json:"definition"`
	}
	_ = json.Unmarshal(release.Artifact, &a)
	return len(a.Definition) > 0 && string(a.Definition) != "null"
}

func (h *Handler) semanticCheckActionPolicy(r *http.Request, actor semanticActor, runID string, release semanticRelease, binding semantic.Binding, parameters map[string]any, stepID *string) error {
	if !semanticHasDefinition(release) {
		return nil
	}
	if binding.ActionID == "" || stepID == nil {
		return errors.New("this business action requires a persisted Policy evaluation")
	}
	var raw json.RawMessage
	err := h.DB.QueryRow(r.Context(), "SELECT input FROM semantic_step WHERE workspace_id=$1 AND run_id=$2 AND id=$3 AND kind='policy_evaluation' AND status='succeeded'", actor.WorkspaceID, runID, *stepID).Scan(&raw)
	if err != nil {
		return errors.New("a successful Policy evaluation from this investigation is required")
	}
	var input semanticPolicyInput
	if json.Unmarshal(raw, &input) != nil || input.ActionID != binding.ActionID || semantic.Digest(input.Parameters) != semantic.Digest(parameters) {
		return errors.New("Policy evaluation does not cover this action and its exact parameters")
	}
	raw, err = h.semanticPolicyResult(r, actor, runID, release, input, true)
	if err != nil {
		return err
	}
	var result struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	if json.Unmarshal(raw, &result) != nil || (result.Decision != "allow" && result.Decision != "needs_approval") {
		return fmt.Errorf("Policy does not permit this action: %s", result.Reason)
	}
	return nil
}

type semanticPlanStep struct {
	Label      string   `json:"label"`
	Purpose    string   `json:"purpose"`
	ObjectIDs  []string `json:"object_ids"`
	BindingIDs []string `json:"binding_ids"`
}
type semanticBusinessPlan struct {
	Summary   string             `json:"summary"`
	Steps     []semanticPlanStep `json:"steps"`
	Questions []string           `json:"questions"`
}

func semanticBusinessObjects(release semanticRelease) map[string]bool {
	var a struct {
		Definition map[string]json.RawMessage `json:"definition"`
	}
	_ = json.Unmarshal(release.Artifact, &a)
	ids := map[string]bool{}
	for _, kind := range []string{"entities", "attributes", "relationships", "actions", "policies"} {
		var items []struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(a.Definition[kind], &items)
		for _, item := range items {
			ids[item.ID] = true
		}
	}
	return ids
}
func (h *Handler) semanticSavePlan(w http.ResponseWriter, r *http.Request) {
	actor, id, release, ok := h.semanticBusinessRun(w, r)
	if !ok {
		return
	}
	var input semanticBusinessPlan
	if !semanticDecode(w, r, &input) {
		return
	}
	if len(input.Summary) < 1 || len(input.Summary) > 3000 || len(input.Steps) < 1 || len(input.Steps) > 12 || len(input.Questions) > 5 {
		writeError(w, 400, "a plan needs a readable summary, one to twelve steps and at most five questions")
		return
	}
	if !semanticReadableLines(input.Questions, 2000) {
		writeError(w, 400, "plan questions must be nonempty and at most two thousand characters each")
		return
	}
	objects := semanticBusinessObjects(release)
	for _, step := range input.Steps {
		if strings.TrimSpace(step.Label) == "" || len(step.Label) > 160 || strings.TrimSpace(step.Purpose) == "" || len(step.Purpose) > 2000 || len(step.ObjectIDs) > 100 || len(step.BindingIDs) > 100 {
			writeError(w, 400, "each plan step needs a short business label and purpose")
			return
		}
		for _, obj := range step.ObjectIDs {
			if !objects[obj] {
				writeError(w, 400, "plan references an object outside the pinned business ontology")
				return
			}
		}
		for _, binding := range step.BindingIDs {
			if _, e := release.Bindings.Find(binding, false); e != nil {
				if _, e = release.Bindings.Find(binding, true); e != nil {
					writeError(w, 400, e.Error())
					return
				}
			}
		}
	}
	h.semanticStep(w, r, actor, id, "business_plan", input, func() (json.RawMessage, error) { return semanticMarshal(input), nil })
}

type semanticBusinessFinding struct {
	Label           string   `json:"label"`
	Detail          string   `json:"detail"`
	Classification  string   `json:"classification"`
	EvidenceStepIDs []string `json:"evidence_step_ids"`
	ObjectIDs       []string `json:"object_ids"`
}
type semanticBusinessReport struct {
	Summary     string                    `json:"summary"`
	Findings    []semanticBusinessFinding `json:"findings"`
	NextSteps   []string                  `json:"next_steps"`
	Limitations []string                  `json:"limitations"`
}

func (h *Handler) semanticSaveReport(w http.ResponseWriter, r *http.Request) {
	actor, id, release, ok := h.semanticBusinessRun(w, r)
	if !ok {
		return
	}
	var input semanticBusinessReport
	if !semanticDecode(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Summary) == "" || len(input.Summary) > 5000 || len(input.Findings) < 1 || len(input.Findings) > 30 || len(input.NextSteps) > 12 || len(input.Limitations) > 20 {
		writeError(w, 400, "a report needs a readable summary and one to thirty findings")
		return
	}
	if !semanticReadableLines(input.NextSteps, 2000) || !semanticReadableLines(input.Limitations, 2000) {
		writeError(w, 400, "next steps and limitations must be nonempty and at most two thousand characters each")
		return
	}
	objects := semanticBusinessObjects(release)
	evidence := []string{}
	seen := map[string]bool{}
	for _, f := range input.Findings {
		if strings.TrimSpace(f.Label) == "" || len(f.Label) > 160 || strings.TrimSpace(f.Detail) == "" || len(f.Detail) > 5000 || len(f.EvidenceStepIDs) > 100 {
			writeError(w, 400, "each finding needs a short label and explanation")
			return
		}
		switch f.Classification {
		case "fact", "inference":
			if len(f.EvidenceStepIDs) == 0 {
				writeError(w, 400, "facts and inferences require persisted evidence")
				return
			}
		case "recommendation", "unknown":
		default:
			writeError(w, 400, "classify each finding as fact, inference, recommendation or unknown")
			return
		}
		for _, obj := range f.ObjectIDs {
			if !objects[obj] {
				writeError(w, 400, "finding references an unknown ontology object")
				return
			}
		}
		for _, stepID := range f.EvidenceStepIDs {
			if _, ok := parseUUIDOrBadRequest(w, stepID, "evidence_step_id"); !ok {
				return
			}
			var valid bool
			err := h.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM semantic_step WHERE workspace_id=$1 AND run_id=$2 AND id=$3 AND kind IN ('data_query','ontology_query','ontology_context','rule_evaluation','policy_evaluation') AND status='succeeded')", actor.WorkspaceID, id, stepID).Scan(&valid)
			if err != nil || !valid {
				writeError(w, 400, "finding evidence must be a successful inspection in this investigation")
				return
			}
			if !seen[stepID] {
				evidence = append(evidence, stepID)
				seen[stepID] = true
			}
		}
	}
	h.semanticStep(w, r, actor, id, "business_report", map[string]any{"report": input, "source_step_ids": evidence}, func() (json.RawMessage, error) { return semanticMarshal(input), nil })
}

func semanticReportClassificationLabel(classification string) string {
	switch classification {
	case "fact":
		return "已查询事实"
	case "inference":
		return "有依据的推断"
	case "recommendation", "proposal":
		return "处置建议"
	case "unknown":
		return "仍需确认"
	default:
		return "仍需确认"
	}
}

var semanticReportTemplate = template.Must(template.New("report").Funcs(template.FuncMap{"classificationLabel": semanticReportClassificationLabel}).Parse(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本体调查报告</title><style>body{font:16px/1.7 system-ui,sans-serif;color:#182431;background:#f4f6f8;margin:0}main{max-width:1000px;margin:auto;padding:40px 24px}header,article{background:white;padding:24px;border-radius:16px;margin-bottom:20px}h1{font-size:30px}h2{font-size:21px}small{color:#546478}.kind{font-size:13px;padding:4px 8px;background:#e8eff8;border-radius:5px}details{margin-top:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#2455a4}</style><main><header><small>ONTOLOGY · INVESTIGATION</small><h1>{{.Question}}</h1><p>{{.Summary}}</p><small>报告保留事实、推断、建议和待确认事项的区别。行动是否完成，以系统执行回执和回读结果为准。</small></header>{{range .Findings}}<article><span class="kind">{{classificationLabel .Classification}}</span><h2>{{.Label}}</h2><p>{{.Detail}}</p>{{if .EvidenceStepIDs}}<details><summary>查看依据</summary><ul>{{range .EvidenceStepIDs}}<li><a href="#evidence-{{.}}">对应的检查记录</a></li>{{end}}</ul></details>{{end}}</article>{{end}}<article><h2>下一步</h2><ul>{{range .NextSteps}}<li>{{.}}</li>{{end}}</ul><h2>仍需确认</h2><ul>{{range .Limitations}}<li>{{.}}</li>{{end}}</ul></article><details><summary>执行日志与本体版本</summary><p>版本 {{.ReleaseID}} · 调查 {{.RunID}}</p>{{range .Evidence}}<section id="evidence-{{.ID}}"><h3>{{.Kind}}</h3><pre>{{.JSON}}</pre></section>{{end}}</details></main></html>`))

func (h *Handler) semanticGetBusinessReport(w http.ResponseWriter, r *http.Request) {
	actor, id, release, ok := h.semanticBusinessRun(w, r)
	if !ok {
		return
	}
	var raw json.RawMessage
	err := h.DB.QueryRow(r.Context(), `SELECT to_jsonb(x)||jsonb_build_object('steps',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY created_at,id) FROM semantic_step s WHERE s.workspace_id=x.workspace_id AND s.run_id=x.id),'[]'::jsonb),'approvals',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY created_at,id) FROM semantic_approval a WHERE a.workspace_id=x.workspace_id AND a.run_id=x.id),'[]'::jsonb),'receipts',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY created_at,id) FROM semantic_receipt p WHERE p.workspace_id=x.workspace_id AND p.run_id=x.id),'[]'::jsonb)) FROM semantic_run x WHERE workspace_id=$1 AND id=$2 AND requested_by=$3`, actor.WorkspaceID, id, actor.UserID).Scan(&raw)
	var run map[string]any
	if err != nil || json.Unmarshal(raw, &run) != nil {
		writeError(w, 500, "failed to load report evidence")
		return
	}
	run = semanticPresentationRun(r.Context(), run)
	steps, _ := run["steps"].([]any)
	var report semanticBusinessReport
	found := false
	type evidenceRow struct{ ID, Kind, JSON string }
	evidence := []evidenceRow{}
	for _, s := range steps {
		step, _ := s.(map[string]any)
		if step["kind"] == "business_report" && step["status"] == "succeeded" {
			if json.Unmarshal(semanticMarshal(step["output"]), &report) == nil {
				found = true
			}
		}
		id, _ := step["id"].(string)
		kind, _ := step["kind"].(string)
		formatted, _ := json.MarshalIndent(step, "", "  ")
		evidence = append(evidence, evidenceRow{id, kind, string(formatted)})
	}
	if !found {
		writeError(w, 404, "this investigation has no completed business report yet")
		return
	}
	format := r.URL.Query().Get("format")
	if format == "html" {
		var body bytes.Buffer
		question, _ := run["question"].(string)
		data := struct {
			semanticBusinessReport
			Question, ReleaseID, RunID string
			Evidence                   []evidenceRow
		}{report, question, release.ID, id, evidence}
		if semanticReportTemplate.Execute(&body, data) != nil {
			writeError(w, 500, "failed to render report")
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox")
		w.WriteHeader(200)
		_, _ = w.Write(body.Bytes())
		return
	}
	if format == "jsonl" {
		w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
		encoder := json.NewEncoder(w)
		_ = encoder.Encode(map[string]any{"kind": "investigation", "run_id": id, "release_id": release.ID, "issue_id": run["issue_id"], "question": run["question"]})
		for _, collection := range []string{"steps", "approvals", "receipts"} {
			rows, _ := run[collection].([]any)
			for _, row := range rows {
				if encoder.Encode(map[string]any{"collection": collection, "record": row}) != nil {
					return
				}
			}
		}
		return
	}
	writeJSON(w, 200, map[string]any{"report": report, "run": run, "release_id": release.ID, "run_id": id, "issue_id": run["issue_id"]})
}

func (h *Handler) semanticIssueTarget(w http.ResponseWriter, r *http.Request) {
	actor, id, _, ok := h.semanticBusinessRun(w, r)
	if !ok {
		return
	}
	var issueID *string
	if err := h.DB.QueryRow(r.Context(), "SELECT issue_id::text FROM semantic_run WHERE workspace_id=$1 AND id=$2", actor.WorkspaceID, id).Scan(&issueID); err != nil || issueID == nil {
		writeError(w, 404, "this investigation is not attached to an Issue")
		return
	}
	issue, ok := h.loadIssueForUser(w, r, *issueID)
	if !ok {
		return
	}
	if uuidToString(issue.WorkspaceID) != actor.WorkspaceID {
		writeError(w, 404, "Issue not found")
		return
	}
	writeJSON(w, 200, map[string]any{"issue_id": uuidToString(issue.ID), "run_id": id})
}

func (h *Handler) semanticGetPlan(w http.ResponseWriter, r *http.Request) {
	actor, id, _, ok := h.semanticBusinessRun(w, r)
	if !ok {
		return
	}
	rows, err := h.DB.Query(r.Context(), "SELECT to_jsonb(s) FROM semantic_step s WHERE workspace_id=$1 AND run_id=$2 AND kind='business_plan' AND status='succeeded' ORDER BY created_at,id", actor.WorkspaceID, id)
	if err != nil {
		writeError(w, 500, "failed to load investigation plan")
		return
	}
	defer rows.Close()
	steps := []any{}
	for rows.Next() {
		var raw json.RawMessage
		var step map[string]any
		if rows.Scan(&raw) != nil || json.Unmarshal(raw, &step) != nil {
			writeError(w, 500, "invalid recorded plan")
			return
		}
		steps = append(steps, step)
	}
	if rows.Err() != nil {
		writeError(w, 500, "failed to load investigation plan")
		return
	}
	run := semanticPresentationRun(r.Context(), map[string]any{"steps": steps})
	visible, _ := run["steps"].([]any)
	if len(visible) == 0 {
		writeError(w, 404, "no plan has been recorded for this investigation")
		return
	}
	writeJSON(w, 200, visible[len(visible)-1])
}

func semanticReadableLines(lines []string, limit int) bool {
	for _, line := range lines {
		if strings.TrimSpace(line) == "" || len(line) > limit {
			return false
		}
	}
	return true
}

// This view is reached after the application capability/evidence projection.
func (h *Handler) semanticApprovalPresentation(w http.ResponseWriter, r *http.Request, actor semanticActor, id string) {
	var raw json.RawMessage
	err := h.DB.QueryRow(r.Context(), `SELECT to_jsonb(a)||jsonb_build_object('ontology_version',release.version,'business_action',(SELECT action FROM jsonb_array_elements(COALESCE(release.artifact->'definition'->'actions','[]'::jsonb)) action WHERE action->>'id'=(SELECT binding->>'action_id' FROM jsonb_array_elements(COALESCE(release.binding_config->'action_bindings','[]'::jsonb)) binding WHERE binding->>'id'=a.binding_id LIMIT 1) LIMIT 1),'policy_evaluation',(SELECT output FROM semantic_step s WHERE s.workspace_id=a.workspace_id AND s.run_id=a.run_id AND s.id=a.evaluation_step_id AND s.kind='policy_evaluation' AND s.status='succeeded')) FROM semantic_approval a JOIN semantic_run run ON run.id=a.run_id AND run.workspace_id=a.workspace_id JOIN semantic_release release ON release.id=run.release_id AND release.workspace_id=run.workspace_id WHERE a.workspace_id=$1 AND a.id=$2`, actor.WorkspaceID, id).Scan(&raw)
	if err != nil {
		writeError(w, 404, "action review not found")
		return
	}
	writeJSON(w, 200, raw)
}
