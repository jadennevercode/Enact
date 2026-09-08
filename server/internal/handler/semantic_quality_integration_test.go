package handler

// This opt-in test uses the actual Semantica HTTP service, PostgreSQL, and the
// QualityTraceability reference runtime. Business mutations are never mocked.
// Run only against an isolated, seeded QT development database.
import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

type qualityGateway struct {
	t             *testing.T
	workspace     string
	users         map[string]string
	runs          map[string]string
	qtURL         string
	applicationID string
	buildID       string
}
type qualityObject = map[string]any

func (g *qualityGateway) request(method, id, principal string, input any) *http.Request {
	return testutil.WithHeaders(semanticRequest(method, id, input), "X-Workspace-ID", g.workspace, "X-User-ID", g.users[principal])
}
func (g *qualityGateway) call(handler http.HandlerFunc, method, id, principal string, input any, status int) qualityObject {
	g.t.Helper()
	var out qualityObject
	testutil.Call(g.t, handler, g.request(method, id, principal, input)).Want(status).JSON(&out)
	return out
}
func (g *qualityGateway) query(binding string, parameters qualityObject) (qualityObject, string) {
	g.t.Helper()
	var step qualityObject
	if g.applicationID != "" {
		step = g.invokeApplication("engineer", "query", qualityObject{"run_id": g.runs["engineer"], "binding_id": binding, "parameters": parameters}, 200)
	} else {
		step = g.call(testHandler.semanticQuery, "POST", g.runs["engineer"], "engineer", qualityObject{"binding_id": binding, "parameters": parameters}, 200)
	}
	return step["output"].(map[string]any), step["step_id"].(string)
}
func (g *qualityGateway) action(principal, binding string, parameters qualityObject, source qualityObject, want string) (qualityObject, qualityObject) {
	g.t.Helper()
	input := qualityObject{"binding_id": binding, "parameters": parameters}
	for k, v := range source {
		input[k] = v
	}
	if g.applicationID != "" {
		input["run_id"] = g.runs[principal]
		approval := g.invokeApplication(principal, "action.prepare", input, 201)
		id := approval["id"].(string)
		g.invokeApplication(principal, "action.execute", qualityObject{"approval_id": id}, 409)
		g.invokeApplication(principal, "approval.get", qualityObject{"approval_id": id}, 200)
		g.invokeApplication(principal, "approval.decide", qualityObject{"approval_id": id, "approve": true, "reason": "Explicit integration-test human decision for this exact operation"}, 200)
		receipt := g.invokeApplication(principal, "action.execute", qualityObject{"approval_id": id}, 200)
		if receipt["status"] != want {
			g.t.Fatalf("application %s status=%v error=%v", binding, receipt["status"], receipt["error"])
		}
		repeated := g.invokeApplication(principal, "action.execute", qualityObject{"approval_id": id}, 200)
		if repeated["id"] != receipt["id"] {
			g.t.Fatal("application retried a system write")
		}
		response, _ := receipt["response"].(map[string]any)
		return response, receipt
	}
	approval := g.call(testHandler.semanticPrepareAction, "POST", g.runs[principal], principal, input, 201)
	id := approval["id"].(string)
	testutil.Call(g.t, testHandler.semanticExecute, testutil.WithHeaders(g.request("POST", id, principal, nil), "Idempotency-Key", uuid.NewString())).Want(409)
	g.call(testHandler.semanticDecide, "POST", id, principal, qualityObject{"approve": true, "reason": "Explicit integration-test human decision for this exact operation"}, 200)
	var receipt qualityObject
	testutil.Call(g.t, testHandler.semanticExecute, testutil.WithHeaders(g.request("POST", id, principal, nil), "Idempotency-Key", uuid.NewString())).Want(200).JSON(&receipt)
	if receipt["status"] != want {
		g.t.Fatalf("%s receipt status=%v error=%v response=%v", binding, receipt["status"], receipt["error"], receipt["response"])
	}
	var repeated qualityObject
	testutil.Call(g.t, testHandler.semanticExecute, testutil.WithHeaders(g.request("POST", id, principal, nil), "Idempotency-Key", uuid.NewString())).Want(200).JSON(&repeated)
	if repeated["id"] != receipt["id"] {
		g.t.Fatal("duplicate execute created a second receipt")
	}
	response, _ := receipt["response"].(map[string]any)
	return response, receipt
}

// devCall only configures a reference actuator fault or records inspection
// evidence. Every business operation still traverses the Enact gateway.
func (g *qualityGateway) devCall(method, path string, body qualityObject) qualityObject {
	g.t.Helper()
	req, err := http.NewRequest(method, g.qtURL+"/api/v1/dev/"+path, bytes.NewReader(semanticMarshal(body)))
	if err != nil {
		g.t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer qt-dev-admin")
	req.Header.Set("Idempotency-Key", uuid.NewString())
	req.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		g.t.Fatal(err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		g.t.Fatal(err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		g.t.Fatalf("reference fixture %s returned %d: %s", path, response.StatusCode, raw)
	}
	var out qualityObject
	if err = json.Unmarshal(raw, &out); err != nil {
		g.t.Fatal(err)
	}
	return out
}

func TestSemanticQualityTraceabilityEndToEnd(t *testing.T) {
	if os.Getenv("ENACT_QUALITY_E2E") != "1" {
		t.Skip("set ENACT_QUALITY_E2E=1 for isolated real-service integration")
	}
	qtURL := strings.TrimRight(os.Getenv("ENACT_QUALITY_E2E_URL"), "/")
	parsed, err := url.Parse(qtURL)
	if err != nil || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
		t.Fatal("ENACT_QUALITY_E2E_URL must name an isolated loopback QT development runtime")
	}
	if os.Getenv("ENACT_SEMANTIC_SERVICE_URL") == "" || os.Getenv("ENACT_SEMANTIC_SERVICE_KEY") == "" {
		t.Fatal("configure real semantic service URL and key")
	}
	fixtureDir := os.Getenv("ENACT_QUALITY_E2E_FIXTURES")
	if fixtureDir == "" {
		t.Fatal("set ENACT_QUALITY_E2E_FIXTURES to QualityTraceability/runtime/ontology")
	}
	read := func(name string) []byte {
		t.Helper()
		raw, e := os.ReadFile(filepath.Join(fixtureDir, name))
		if e != nil {
			t.Fatal(e)
		}
		return raw
	}
	candidate := qualityObject{}
	if err = json.Unmarshal(read("candidate.json"), &candidate); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"process", "evidence", "alignment"} {
		var doc any
		if err = json.Unmarshal(read(name+".json"), &doc); err != nil {
			t.Fatal(err)
		}
		candidate[name] = doc
	}
	t.Setenv("ENACT_SEMANTIC_ALLOWED_ORIGINS", qtURL)
	t.Setenv("ENACT_SEMANTIC_SECRET_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	ws := dbfx.Workspace(t, "Quality gateway integration", "quality-e2e-"+uuid.NewString())
	g := qualityGateway{t: t, workspace: ws, users: map[string]string{}, runs: map[string]string{}, qtURL: qtURL}
	credentials := map[string]semantic.Credential{}
	principals := map[string]struct{ token, role string }{"engineer": {"qt-dev-engineer", "QualityEngineer"}, "sqm": {"qt-dev-sqm-at01", "SupplierQualityManager"}, "pm-at01": {"qt-dev-pm-at01", "PlantManager"}, "pm-cn03": {"qt-dev-pm-cn03", "PlantManager"}}
	for name, p := range principals {
		user := dbfx.User(t, "Quality "+name, uuid.NewString()+"@example.com")
		dbfx.Member(t, ws, user, "owner")
		g.users[name] = user
		credentials[user] = semantic.Credential{Headers: map[string]string{"Authorization": "Bearer " + p.token}, Roles: []string{p.role}}
	}
	for _, table := range []string{"semantic_connection", "semantic_ontology", "semantic_release", "semantic_run", "semantic_step", "semantic_approval", "semantic_receipt"} {
		dbfx.Cleanup(t, "DELETE FROM "+table+" WHERE workspace_id=$1", ws)
	}
	connection := g.call(testHandler.semanticCreateConnection, "POST", "", "engineer", qualityObject{"name": "QT real reference REST", "kind": "rest", "endpoint": qtURL, "secret": semantic.Secret{UserCredentials: credentials}}, 201)
	rawBindings := bytes.ReplaceAll(read("binding_config.template.json"), []byte("__QT_CONNECTION_ID__"), []byte(connection["id"].(string)))
	var bindings any
	if err = json.Unmarshal(rawBindings, &bindings); err != nil {
		t.Fatal(err)
	}
	data := qualityObject{"content": string(read("test_data.ttl")), "format": "turtle"}
	ontology := g.call(testHandler.semanticCreateOntology, "POST", "", "engineer", qualityObject{"name": "Quality Traceability E2E", "bundle": candidate, "binding_config": bindings, "test_data": data}, 201)
	ontologyID := ontology["id"].(string)
	preview := g.call(testHandler.semanticPreviewOntology, "POST", ontologyID, "engineer", qualityObject{"test_data": data}, 200)
	if !semanticValidationPassed(semanticMarshal(preview["validation"])) {
		t.Fatalf("real preview failed: %v", preview["validation"])
	}
	// An empty data set must never earn a runtime release.
	g.call(testHandler.semanticPublishRelease, "POST", ontologyID, "engineer", qualityObject{"version": "empty-" + uuid.NewString(), "binding_config": bindings, "test_data": qualityObject{"content": "", "format": "turtle"}}, 422)
	release := g.call(testHandler.semanticPublishRelease, "POST", ontologyID, "engineer", qualityObject{"version": "e2e-" + uuid.NewString(), "binding_config": bindings, "test_data": data}, 201)
	releaseID := release["id"].(string)
	for name := range principals {
		run := g.call(testHandler.semanticCreateRun, "POST", "", name, qualityObject{"release_id": releaseID, "question": "Trace critical lot exposure, contain both plants, verify CAPA and independently approve closure"}, 201)
		g.runs[name] = run["id"].(string)
	}
	g.installApplication(releaseID)
	schema := g.call(testHandler.semanticQuery, "POST", g.runs["engineer"], "engineer", qualityObject{"query": "SELECT ?entity WHERE { ?entity a <http://www.w3.org/2002/07/owl#Class> }"}, 200)
	if len(schema["output"].(map[string]any)["rows"].([]any)) != 12 {
		t.Fatal("published ontology does not expose the twelve QT classes")
	}
	created, _ := g.action("engineer", "bind.qt.case.create", qualityObject{"supplierId": "100482", "title": "Critical gateway E2E " + uuid.NewString(), "severity": "CRITICAL", "affectedMaterials": []any{qualityObject{"materialNumber": "7735-220", "batchNumbers": []string{"88213"}}}, "affectedPlants": []string{"AT01", "CN03"}, "leadPlant": "AT01", "customerImpactAssessment": "Two-plant exposure independently verified"}, nil, "succeeded")
	caseID := created["id"].(string)
	currentCase := func() qualityObject { out, _ := g.query("bind.qt.case", qualityObject{"caseId": caseID}); return out }
	_, caseStep := g.query("bind.qt.case", qualityObject{"caseId": caseID})
	_, exposureStep := g.query("bind.qt.exposure", qualityObject{"batchId": "88213"})
	_, stockStep := g.query("bind.qt.stock", qualityObject{"stockId": "STOCK-AT01-88213"})
	evaluation := g.call(testHandler.semanticEvaluate, "POST", g.runs["engineer"], "engineer", qualityObject{"source_step_ids": []string{caseStep, exposureStep, stockStep}, "facts": qualityObject{"untrusted": "must not replace recorded outputs"}}, 200)
	evaluated := evaluation["output"].(map[string]any)
	intents := evaluated["action_intents"].([]any)
	if len(intents) != 1 || evaluated["executed"] != false {
		t.Fatalf("real facts did not produce one proposed intent: %v", evaluated)
	}
	intent := intents[0].(map[string]any)
	if intent["intent_id"] == nil {
		t.Fatal("rule intent has no stable recorded identity")
	}
	intentSource := qualityObject{"evaluation_step_id": evaluation["step_id"], "intent_id": intent["intent_id"]}
	intentParams := intent["parameters"].(map[string]any)
	tampered := qualityObject{}
	for key, value := range intentParams {
		tampered[key] = value
	}
	tampered["caseId"] = "UNRELATED-CASE"
	g.call(testHandler.semanticPrepareAction, "POST", g.runs["engineer"], "engineer", qualityObject{"binding_id": intent["binding_id"], "parameters": tampered, "evaluation_step_id": evaluation["step_id"], "intent_id": intent["intent_id"]}, 409)
	g.call(testHandler.semanticEvaluate, "POST", g.runs["engineer"], "engineer", qualityObject{"source_step_ids": []string{uuid.NewString()}}, 400)
	t.Log("Published validated ontology; queried live case and batch; recorded rule evidence and action intent")

	type target struct{ plant, id, query, key, action, state, restore string }
	targets := []target{{"AT01", "STOCK-AT01-88213", "bind.qt.stock", "stockId", "FREEZE_STOCK", "FROZEN", "RELEASE_STOCK"}, {"CN03", "STOCK-CN03-88213", "bind.qt.stock", "stockId", "FREEZE_STOCK", "FROZEN", "RELEASE_STOCK"}, {"AT01", "LINE-AT01-01", "bind.qt.line", "lineId", "STOP_PRODUCTION", "STOPPED", "RESUME_PRODUCTION"}, {"CN03", "LINE-CN03-01", "bind.qt.line", "lineId", "STOP_PRODUCTION", "STOPPED", "RESUME_PRODUCTION"}}
	readTarget := func(target target) qualityObject {
		out, _ := g.query(target.query, qualityObject{target.key: target.id})
		return out
	}
	// Pending mode changes only the actuator behavior in this dedicated fixture.
	pendingTarget := readTarget(targets[3])
	g.devCall("PATCH", "targets/"+targets[3].id, qualityObject{"expectedVersion": pendingTarget["version"], "actuatorMode": "pending"})
	buildPlan := func(restore bool) qualityObject {
		actions := []any{}
		for _, target := range targets {
			if !restore && target.id == targets[0].id {
				continue // The unchanged recorded rule intent already contains this stock.
			}
			live := readTarget(target)
			kind := target.action
			if restore {
				kind = target.restore
			}
			actions = append(actions, qualityObject{"plantCode": target.plant, "actionType": kind, "targetId": target.id, "expectedTargetVersion": live["version"], "reason": "Concrete scope reviewed against current stock and production data"})
		}
		return qualityObject{"caseId": caseID, "leadPlant": "AT01", "scopeDescription": "Two-plant stock and line scope reviewed by the human operator", "ontologyVersion": release["version"], "actions": actions}
	}
	executePlan := func(params qualityObject, allowPending bool, source qualityObject) {
		plan, _ := g.action("engineer", "bind.qt.plan.create", params, source, "succeeded")
		g.action("sqm", "bind.qt.plan.approve", qualityObject{"planId": plan["id"], "expectedVersion": plan["version"], "justification": "Lead plant independently approves containment scope"}, nil, "succeeded")
		for _, entry := range plan["actions"].([]any) {
			action := entry.(map[string]any)
			approved, _ := g.action("pm-"+strings.ToLower(action["plantCode"].(string)), "bind.qt.action.approve", qualityObject{"actionId": action["id"], "expectedVersion": action["version"], "justification": "Local plant independently approves this target"}, nil, "succeeded")
			want := "succeeded"
			if allowPending && action["targetId"] == targets[3].id {
				want = "unknown"
			}
			operation, receipt := g.action("engineer", "bind.qt.action.execute", qualityObject{"actionId": action["id"], "expectedVersion": approved["version"], "expectedTargetVersion": action["expectedTargetVersion"]}, nil, want)
			if want == "unknown" {
				if operation["verified"] != false || operation["state"] != "PENDING" {
					t.Fatal("accepted operation was falsely completed")
				}
				g.action("engineer", "bind.qt.operation.reconcile", qualityObject{"operationId": operation["id"], "expectedVersion": operation["version"]}, nil, "succeeded")
				reconciled := g.call(testHandler.semanticReconcile, "POST", receipt["id"].(string), "engineer", qualityObject{}, 200)
				if reconciled["status"] != "succeeded" {
					t.Fatalf("receipt reconciliation failed: %v", reconciled)
				}
			}
		}
	}
	executePlan(intentParams, false, intentSource)
	executePlan(buildPlan(false), true, nil)
	for _, target := range targets {
		if readTarget(target)["state"] != target.state {
			t.Fatalf("target %s not contained", target.id)
		}
	}
	t.Log("Both plants frozen/stopped through real approvals and execution; HTTP 202 remained unknown until source reconciliation and independent gateway readback")
	// Restore using a new authorized plan; never reset state behind the gateway.
	pendingTarget = readTarget(targets[3])
	g.devCall("PATCH", "targets/"+targets[3].id, qualityObject{"expectedVersion": pendingTarget["version"], "actuatorMode": "normal"})
	executePlan(buildPlan(true), false, nil)
	for _, target := range targets {
		expected := "AVAILABLE"
		if target.query == "bind.qt.line" {
			expected = "RUNNING"
		}
		if readTarget(target)["state"] != expected {
			t.Fatalf("target %s was not restored", target.id)
		}
	}
	g.action("engineer", "bind.qt.case.submit", qualityObject{"caseId": caseID, "expectedVersion": currentCase()["version"]}, nil, "succeeded")
	g.action("engineer", "bind.qt.case.acknowledge", qualityObject{"caseId": caseID, "expectedVersion": currentCase()["version"], "justification": "Supplier acknowledged measured defect"}, nil, "succeeded")
	evidence, _ := g.action("engineer", "bind.qt.evidence.create", qualityObject{"caseId": caseID, "type": "COMPLETION_REPORT", "title": "Verified repair evidence", "content": "Reference engineering maintenance record with a persisted digest"}, nil, "succeeded")
	capa, _ := g.action("engineer", "bind.qt.capa.create", qualityObject{"caseId": caseID, "title": "Repair root cause", "owner": "engineer", "dueAt": time.Now().UTC().Add(5 * 24 * time.Hour).Format(time.RFC3339Nano), "verificationMethod": "THREE_SUBSEQUENT_LOTS"}, nil, "succeeded")
	completed, _ := g.action("engineer", "bind.qt.capa.complete", qualityObject{"actionId": capa["id"], "expectedVersion": capa["version"], "evidenceIds": []any{evidence["id"]}}, nil, "succeeded")
	inspectionIDs := []any{}
	for _, plant := range []string{"AT01", "CN03"} {
		for index := 0; index < 3; index++ {
			stamp := time.Now().UTC().Format(time.RFC3339Nano)
			record := g.devCall("POST", "inspections", qualityObject{"caseId": caseID, "batchId": "E2E-" + uuid.NewString(), "plantCode": plant, "result": "PASS", "manufacturedAt": stamp, "inspectedAt": stamp})
			inspectionIDs = append(inspectionIDs, record["id"])
		}
	}
	g.action("engineer", "bind.qt.capa.verify", qualityObject{"actionId": capa["id"], "expectedVersion": completed["version"], "result": "PASS", "inspectionIds": inspectionIDs, "justification": "Three persisted subsequent lots per affected plant conform"}, nil, "succeeded")
	pending, _ := g.action("engineer", "bind.qt.case.request-closure", qualityObject{"caseId": caseID, "expectedVersion": currentCase()["version"]}, nil, "succeeded")
	first, _ := g.action("pm-at01", "bind.qt.case.approve", qualityObject{"caseId": caseID, "expectedVersion": pending["version"], "role": "PlantManager", "justification": "Lead plant confirms complete closure evidence"}, nil, "succeeded")
	second, _ := g.action("sqm", "bind.qt.case.approve", qualityObject{"caseId": caseID, "expectedVersion": first["caseVersion"], "role": "SupplierQualityManager", "justification": "Independent supplier-quality approval of critical closure"}, nil, "succeeded")
	closed, _ := g.action("engineer", "bind.qt.case.close", qualityObject{"caseId": caseID, "expectedVersion": second["caseVersion"], "closureSummary": "Both plants restored, CAPA verified by six subsequent lot inspections, two independent human approvers"}, nil, "succeeded")
	if closed["state"] != "CLOSED" {
		t.Fatal("critical case did not close")
	}
	audit, _ := g.query("bind.qt.audit", qualityObject{"caseId": caseID})
	if len(audit["items"].([]any)) == 0 {
		t.Fatal("business audit trail is empty")
	}
	restoredHandler := *testHandler
	persisted := g.call(restoredHandler.semanticGetRun, "GET", g.runs["engineer"], "engineer", nil, 200)
	if len(persisted["steps"].([]any)) < 10 || len(persisted["receipts"].([]any)) < 10 {
		t.Fatal("run history was not persisted")
	}
	t.Logf("Actual E2E complete: case=%s release=%s steps=%d receipts=%d; six inspection records and independent Critical closure approvals", caseID, releaseID, len(persisted["steps"].([]any)), len(persisted["receipts"].([]any)))
}
