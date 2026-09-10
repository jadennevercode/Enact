package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/enact-ai/enact/server/internal/semantic"
	"github.com/enact-ai/enact/server/internal/testutil"
	"github.com/google/uuid"
)

type semanticReleaseInstallFixture struct {
	SourceWorkspaceID     string
	SourceOntologyID      string
	SourceReleaseID       string
	SourceReleaseDigest   string
	SourceTestData        json.RawMessage
	SourceTestDataDigest  string
	SourceConnectionID    string
	TargetWorkspaceID     string
	TargetConnectionID    string
	TargetCatalogDigest   *atomic.Value
	TargetRequiresFixture *atomic.Bool
	TargetDiscoveryCount  *atomic.Int32
	TargetDriftOnCall     *atomic.Int32
}

func newSemanticReleaseInstallFixture(t *testing.T) semanticReleaseInstallFixture {
	t.Helper()
	targetCatalogDigest := &atomic.Value{}
	targetCatalogDigest.Store("sha256:target-catalog-v1")
	targetRequiresFixture := &atomic.Bool{}
	targetDiscoveryCount := &atomic.Int32{}
	targetDriftOnCall := &atomic.Int32{}
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&payload)
		}
		switch r.URL.Path {
		case "/v1/sources/discover":
			endpoint, _ := payload["endpoint"].(string)
			digest := "sha256:source-catalog-v1"
			if strings.HasSuffix(endpoint, "/target") {
				digest = targetCatalogDigest.Load().(string)
				call := targetDiscoveryCount.Add(1)
				if threshold := targetDriftOnCall.Load(); threshold > 0 && call >= threshold {
					digest = "sha256:target-catalog-drift"
				}
			}
			writeJSON(w, 200, map[string]any{
				"state": "ready", "source_digest": digest, "source_revision": "revision-1",
				"entries":  []any{map[string]any{"id": "qualityCases", "kind": "operation", "path": "/quality/cases/{case_id}", "method": "GET", "capabilities": []string{"data"}}},
				"warnings": []any{}, "metadata": map[string]any{"connector": "test"},
			})
		case "/v1/compile":
			bundle, _ := payload["bundle"].(map[string]any)
			artifact, _ := bundle["native_artifact"].(map[string]any)
			scope, _ := payload["scope"].(map[string]any)
			manifest, _ := artifact["manifest"].(map[string]any)
			for _, key := range []string{"workspace_id", "ontology_id", "release_id"} {
				manifest[key] = scope[key]
			}
			writeJSON(w, 200, map[string]any{"artifact": artifact})
		case "/v1/native/adopt":
			sourceScope, _ := payload["source_scope"].(map[string]any)
			targetScope, _ := payload["scope"].(map[string]any)
			artifact, _ := payload["artifact"].(map[string]any)
			bindings, _ := payload["bindings"].([]any)
			manifest, _ := artifact["manifest"].(map[string]any)
			if sourceScope["workspace_id"] != manifest["workspace_id"] || sourceScope["ontology_id"] != manifest["ontology_id"] || sourceScope["release_id"] != manifest["release_id"] {
				t.Errorf("adopt source scope did not match the immutable source artifact: scope=%#v manifest=%#v", sourceScope, manifest)
			}
			manifest["workspace_id"] = targetScope["workspace_id"]
			manifest["ontology_id"] = targetScope["ontology_id"]
			manifest["release_id"] = targetScope["release_id"]
			artifact["bindings"] = bindings
			definition, _ := artifact["definition"].(map[string]any)
			for _, binding := range bindings {
				item := binding.(map[string]any)
				field := map[string]string{"data": "data_bindings", "action": "action_bindings"}[item["kind"].(string)]
				for _, candidate := range definition[field].([]any) {
					target := candidate.(map[string]any)
					if target["id"] == item["id"] {
						for _, key := range []string{"connection_id", "catalog_digest", "catalog_revision_id", "tool_schema_digest"} {
							if value, exists := item[key]; exists {
								target[key] = value
							} else {
								delete(target, key)
							}
						}
					}
				}
			}
			writeJSON(w, 200, map[string]any{"artifact": artifact})
		case "/v1/validate":
			valid := true
			if targetRequiresFixture.Load() {
				data, _ := payload["data"].(map[string]any)
				valid = len(data) > 0
			}
			writeJSON(w, 200, map[string]any{
				"valid": valid, "conforms": valid,
				"coverage": map[string]any{"target_count": 1, "covered_targets": 1, "targeted_instances": 1},
				"checks":   []any{map[string]any{"id": "target-native", "status": map[bool]string{true: "pass", false: "fail"}[valid]}},
			})
		default:
			t.Errorf("unexpected semantic service request: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(service.Close)
	t.Setenv("ENACT_SEMANTIC_SERVICE_URL", service.URL)
	t.Setenv("ENACT_SEMANTIC_ALLOWED_ORIGINS", service.URL)

	sourceConnectionID := dbfx.Insert(t, "semantic_connection", testutil.Cols{
		"workspace_id": testWorkspaceID, "name": "source quality API", "kind": "openapi",
		"endpoint": service.URL + "/source", "created_by": testUserID, "capabilities": []byte(`["data"]`),
	})
	sourceBinding := map[string]any{
		"id": "quality-cases", "entity_id": "QualityCase", "connection_id": sourceConnectionID,
		"catalog_entry_id": "qualityCases", "catalog_digest": "sha256:source-catalog-v1",
		"path": "/quality/cases/{case_id}", "method": "GET", "required_parameters": []string{"case_id"},
		"x-authored-extension": map[string]any{"business_owner": "Quality"},
	}
	artifactBinding := semanticCloneMap(sourceBinding)
	artifactBinding["kind"] = "data"
	artifact := map[string]any{
		"manifest": map[string]any{"source_kind": "semantica-native", "artifact_digest": "sha256:source-native"},
		"definition": map[string]any{
			"schema_version": 2, "entities": []any{map[string]any{"id": "QualityCase", "label": "质量问题"}},
			"attributes": []any{}, "relationships": []any{}, "actions": []any{}, "policies": []any{},
			"data_bindings": []any{semanticCloneMap(sourceBinding)}, "action_bindings": []any{},
		},
		"native_rules": []any{}, "bindings": []any{artifactBinding},
	}
	bindingConfig := map[string]any{"data_bindings": []any{sourceBinding}, "action_bindings": []any{}}
	sourceOntologyID := dbfx.Insert(t, "semantic_ontology", testutil.Cols{
		"workspace_id": testWorkspaceID, "name": "质量追溯", "description": "受治理的质量追溯本体",
		"bundle": semanticMarshal(map[string]any{"native_artifact": artifact}), "binding_config": semanticMarshal(bindingConfig),
		"test_data": []byte(`{"format":"turtle","content":"@prefix qt: <urn:quality:> .\n<urn:fixture:case1> a qt:QualityCase .","facts":{"fixture_kind":"synthetic_positive_schema_coverage","live_business_data":false}}`), "created_by": testUserID,
	})
	dbfx.Cleanup(t, `DELETE FROM semantic_release WHERE ontology_id=$1`, sourceOntologyID)
	runtimeID := dbfx.Runtime(t, "release install runtime "+uuid.NewString()[:8], testutil.Cols{"provider": "codex"})
	agentID := dbfx.Agent(t, "release install reviewer "+uuid.NewString()[:8], runtimeID)
	squadID := dbfx.Squad(t, "release install family "+uuid.NewString()[:8], agentID)
	issueID := dbfx.Issue(t, "governed release installation")
	constructionID := publicationConstruction(t, testWorkspaceID, sourceOntologyID, issueID, squadID, testUserID, time.Now())
	approvePublicationFixture(t, constructionID, sourceOntologyID, agentID, runtimeID, issueID)
	var sourceRelease map[string]any
	testutil.Call(t, testHandler.semanticPublishRelease, semanticRequest("POST", sourceOntologyID, map[string]any{"version": "1.0.0"})).Want(201).JSON(&sourceRelease)
	var sourceTestData json.RawMessage
	dbfx.QueryRow(t, `SELECT test_data FROM semantic_release WHERE id=$1`, sourceRelease["id"]).Scan(&sourceTestData)

	targetWorkspaceID := dbfx.Workspace(t, "target release install "+uuid.NewString()[:8], testUserID)
	dbfx.Member(t, targetWorkspaceID, testUserID, "admin")
	targetConnectionID := dbfx.Insert(t, "semantic_connection", testutil.Cols{
		"workspace_id": targetWorkspaceID, "name": "target quality API", "kind": "openapi",
		"endpoint": service.URL + "/target", "created_by": testUserID, "capabilities": []byte(`["data"]`),
	})
	dbfx.Cleanup(t, `DELETE FROM semantic_ontology WHERE workspace_id=$1`, targetWorkspaceID)
	dbfx.Cleanup(t, `DELETE FROM semantic_release WHERE workspace_id=$1`, targetWorkspaceID)
	dbfx.Cleanup(t, `DELETE FROM semantic_release_installation WHERE workspace_id=$1`, targetWorkspaceID)
	dbfx.Cleanup(t, `DELETE FROM semantic_catalog_revision WHERE workspace_id=$1`, targetWorkspaceID)
	return semanticReleaseInstallFixture{
		SourceWorkspaceID: testWorkspaceID, SourceOntologyID: sourceOntologyID,
		SourceReleaseID: sourceRelease["id"].(string), SourceReleaseDigest: sourceRelease["digest"].(string),
		SourceTestData: sourceTestData, SourceTestDataDigest: semantic.Digest(semanticCanonicalJSONValue(sourceTestData)),
		SourceConnectionID: sourceConnectionID, TargetWorkspaceID: targetWorkspaceID,
		TargetConnectionID: targetConnectionID, TargetCatalogDigest: targetCatalogDigest,
		TargetRequiresFixture: targetRequiresFixture, TargetDiscoveryCount: targetDiscoveryCount, TargetDriftOnCall: targetDriftOnCall,
	}
}

func (f semanticReleaseInstallFixture) input(previewDigest string) map[string]any {
	input := map[string]any{
		"source_workspace_id": f.SourceWorkspaceID, "expected_source_release_digest": f.SourceReleaseDigest,
		"connection_mapping": map[string]string{f.SourceConnectionID: f.TargetConnectionID},
	}
	if previewDigest != "" {
		input["preview_digest"] = previewDigest
		input["rationale"] = "目标质量团队采用该已发布本体；仅使用本工作区重新验证的连接和权限。"
	}
	return input
}

func (f semanticReleaseInstallFixture) inputWithTestData(previewDigest string) map[string]any {
	input := f.input(previewDigest)
	input["include_test_data"] = true
	input["expected_test_data_digest"] = f.SourceTestDataDigest
	return input
}

func (f semanticReleaseInstallFixture) request(method string, input any) *http.Request {
	return testutil.WithHeaders(semanticRequest(method, f.SourceReleaseID, input), "X-Workspace-ID", f.TargetWorkspaceID)
}

func TestSemanticReleaseInstallPreservesExtensionsAndRecordsAdoption(t *testing.T) {
	fixture := newSemanticReleaseInstallFixture(t)
	var preview map[string]any
	testutil.Call(t, testHandler.semanticPreviewReleaseInstall, fixture.request("POST", fixture.input(""))).Want(200).JSON(&preview)
	previewDigest, _ := preview["preview_digest"].(string)
	bindings := preview["binding_config"].(map[string]any)["data_bindings"].([]any)
	binding := bindings[0].(map[string]any)
	if previewDigest == "" || binding["connection_id"] != fixture.TargetConnectionID || binding["catalog_digest"] != fixture.TargetCatalogDigest.Load().(string) {
		t.Fatalf("preview did not bind the exact target catalog: %#v", preview)
	}
	if binding["catalog_revision_id"] != nil || binding["x-authored-extension"].(map[string]any)["business_owner"] != "Quality" {
		t.Fatalf("preview exposed a random pin or lost an authored extension: %#v", binding)
	}
	if raw, _ := json.Marshal(preview); string(raw) == "" || json.Valid(raw) == false {
		t.Fatal("preview is not valid JSON")
	}

	var installed map[string]any
	testutil.Call(t, testHandler.semanticInstallRelease, fixture.request("POST", fixture.input(previewDigest))).Want(201).JSON(&installed)
	var repeated map[string]any
	testutil.Call(t, testHandler.semanticInstallRelease, fixture.request("POST", fixture.input(previewDigest))).Want(200).JSON(&repeated)
	if installed["idempotent"] != false || repeated["idempotent"] != true {
		t.Fatalf("unexpected idempotency results: first=%#v second=%#v", installed, repeated)
	}
	installedRelease := installed["release"].(map[string]any)
	repeatedRelease := repeated["release"].(map[string]any)
	if installedRelease["id"] != repeatedRelease["id"] || installedRelease["id"] == fixture.SourceReleaseID {
		t.Fatal("retry did not return the same new target release")
	}
	var installs, releases, ontologies, catalogs int
	dbfx.QueryRow(t, `SELECT
		(SELECT count(*) FROM semantic_release_installation WHERE workspace_id=$1),
		(SELECT count(*) FROM semantic_release WHERE workspace_id=$1),
		(SELECT count(*) FROM semantic_ontology WHERE workspace_id=$1),
		(SELECT count(*) FROM semantic_catalog_revision WHERE workspace_id=$1)`, fixture.TargetWorkspaceID).Scan(&installs, &releases, &ontologies, &catalogs)
	if installs != 1 || releases != 1 || ontologies != 1 || catalogs != 1 {
		t.Fatalf("install counts = lineage:%d release:%d ontology:%d catalogs:%d", installs, releases, ontologies, catalogs)
	}
	var bundle, persistedBindings, governance json.RawMessage
	dbfx.QueryRow(t, `SELECT o.bundle,r.binding_config,i.source_governance FROM semantic_release_installation i
		JOIN semantic_ontology o ON o.id=i.ontology_id AND o.workspace_id=i.workspace_id
		JOIN semantic_release r ON r.id=i.release_id AND r.workspace_id=i.workspace_id WHERE i.workspace_id=$1`, fixture.TargetWorkspaceID).Scan(&bundle, &persistedBindings, &governance)
	var bundleDocument map[string]any
	var bindingDocument map[string]any
	var governanceDocument map[string]any
	_ = json.Unmarshal(bundle, &bundleDocument)
	_ = json.Unmarshal(persistedBindings, &bindingDocument)
	_ = json.Unmarshal(governance, &governanceDocument)
	storedBinding := bindingDocument["data_bindings"].([]any)[0].(map[string]any)
	if bundleDocument["distribution"].(map[string]any)["kind"] != "adopted_published_release" ||
		storedBinding["catalog_revision_id"] == nil || storedBinding["x-authored-extension"].(map[string]any)["business_owner"] != "Quality" ||
		governanceDocument["decision"] != "approve" || governanceDocument["rationale"] == "" {
		t.Fatal("persisted adoption lost its distribution, catalog pin, authored extension or source decision")
	}
}

func TestSemanticReleaseInstallRejectsUngovernedAndChangedSources(t *testing.T) {
	fixture := newSemanticReleaseInstallFixture(t)
	var preview map[string]any
	testutil.Call(t, testHandler.semanticPreviewReleaseInstall, fixture.request("POST", fixture.input(""))).Want(200).JSON(&preview)
	previewDigest := preview["preview_digest"].(string)
	dbfx.Exec(t, `DELETE FROM semantic_construction_event WHERE workspace_id=$1 AND kind='published' AND data->>'release_id'=$2`, fixture.SourceWorkspaceID, fixture.SourceReleaseID)
	testutil.Call(t, testHandler.semanticPreviewReleaseInstall, fixture.request("POST", fixture.input(""))).Want(409)
	testutil.Call(t, testHandler.semanticInstallRelease, fixture.request("POST", fixture.input(previewDigest))).Want(409)
}

func TestSemanticReleaseInstallRejectsReleaseWithoutFrozenFixture(t *testing.T) {
	fixture := newSemanticReleaseInstallFixture(t)
	dbfx.Exec(t, `UPDATE semantic_release SET test_data='{}'::jsonb WHERE workspace_id=$1 AND id=$2`, fixture.SourceWorkspaceID, fixture.SourceReleaseID)
	testutil.Call(t, testHandler.semanticPreviewReleaseInstall, fixture.request("POST", fixture.input(""))).Want(404)
}

func TestSemanticReleaseInstallRejectsTargetCatalogDriftAndNonAdmin(t *testing.T) {
	fixture := newSemanticReleaseInstallFixture(t)
	var preview map[string]any
	testutil.Call(t, testHandler.semanticPreviewReleaseInstall, fixture.request("POST", fixture.input(""))).Want(200).JSON(&preview)
	fixture.TargetCatalogDigest.Store("sha256:target-catalog-v2")
	testutil.Call(t, testHandler.semanticInstallRelease, fixture.request("POST", fixture.input(preview["preview_digest"].(string)))).Want(409)

	dbfx.Exec(t, `UPDATE member SET role='member' WHERE workspace_id=$1 AND user_id=$2`, fixture.TargetWorkspaceID, testUserID)
	testutil.Call(t, testHandler.semanticPreviewReleaseInstall, fixture.request("POST", fixture.input(""))).Want(403)
}

func TestSemanticReleaseInstallRechecksCatalogBeforeAtomicCommit(t *testing.T) {
	fixture := newSemanticReleaseInstallFixture(t)
	var preview map[string]any
	testutil.Call(t, testHandler.semanticPreviewReleaseInstall, fixture.request("POST", fixture.input(""))).Want(200).JSON(&preview)
	fixture.TargetDriftOnCall.Store(fixture.TargetDiscoveryCount.Load() + 2)
	testutil.Call(t, testHandler.semanticInstallRelease, fixture.request("POST", fixture.input(preview["preview_digest"].(string)))).Want(409)
	var installs int
	dbfx.QueryRow(t, `SELECT count(*) FROM semantic_release_installation WHERE workspace_id=$1`, fixture.TargetWorkspaceID).Scan(&installs)
	if installs != 0 {
		t.Fatal("catalog drift left a partial installation")
	}
}

func TestSemanticReleaseInstallRequiresSourceMembership(t *testing.T) {
	fixture := newSemanticReleaseInstallFixture(t)
	outsider := dbfx.User(t, "target-only release adopter", uuid.NewString()+"@example.com")
	dbfx.Member(t, fixture.TargetWorkspaceID, outsider, "admin")
	request := testutil.WithHeaders(fixture.request("POST", fixture.input("")), "X-User-ID", outsider)
	testutil.Call(t, testHandler.semanticPreviewReleaseInstall, request).Want(404)
}

func TestSemanticReleaseInstallDoesNotBypassTargetFixtureValidation(t *testing.T) {
	fixture := newSemanticReleaseInstallFixture(t)
	fixture.TargetRequiresFixture.Store(true)
	testutil.Call(t, testHandler.semanticPreviewReleaseInstall, fixture.request("POST", fixture.input(""))).Want(422)
}

func TestSemanticReleaseInstallExplicitlyTransfersFrozenSyntheticFixture(t *testing.T) {
	fixture := newSemanticReleaseInstallFixture(t)
	fixture.TargetRequiresFixture.Store(true)

	var preview map[string]any
	testutil.Call(t, testHandler.semanticPreviewReleaseInstall, fixture.request("POST", fixture.inputWithTestData(""))).Want(200).JSON(&preview)
	testDataSummary := preview["test_data"].(map[string]any)
	if testDataSummary["included"] != true || testDataSummary["digest"] != fixture.SourceTestDataDigest ||
		testDataSummary["subject_count"] != float64(1) || testDataSummary["typed_target_count"] != float64(1) {
		t.Fatalf("preview did not expose the reviewed synthetic fixture scope: %#v", testDataSummary)
	}
	if _, leaked := testDataSummary["content"]; leaked {
		t.Fatal("preview exposed synthetic fixture content")
	}
	classification := testDataSummary["classification"].(map[string]any)
	if classification["fixture_kind"] != "synthetic_positive_schema_coverage" || classification["live_business_data"] != false {
		t.Fatalf("preview lost synthetic-only classification: %#v", classification)
	}

	previewDigest := preview["preview_digest"].(string)
	var installed map[string]any
	testutil.Call(t, testHandler.semanticInstallRelease, fixture.request("POST", fixture.inputWithTestData(previewDigest))).Want(201).JSON(&installed)
	installedReleaseID := installed["release"].(map[string]any)["id"].(string)
	installedOntologyID := installed["ontology"].(map[string]any)["id"].(string)
	var ontologyTestData, releaseTestData, bundle json.RawMessage
	dbfx.QueryRow(t, `SELECT o.test_data,r.test_data,o.bundle FROM semantic_ontology o JOIN semantic_release r ON r.ontology_id=o.id AND r.workspace_id=o.workspace_id WHERE o.workspace_id=$1 AND o.id=$2 AND r.id=$3`,
		fixture.TargetWorkspaceID, installedOntologyID, installedReleaseID).Scan(&ontologyTestData, &releaseTestData, &bundle)
	if semantic.Digest(semanticCanonicalJSONValue(ontologyTestData)) != fixture.SourceTestDataDigest ||
		semantic.Digest(semanticCanonicalJSONValue(releaseTestData)) != fixture.SourceTestDataDigest {
		t.Fatal("target ontology and release did not freeze the authorized source fixture")
	}
	var bundleDocument map[string]any
	_ = json.Unmarshal(bundle, &bundleDocument)
	distributionSummary := bundleDocument["distribution"].(map[string]any)["test_data"].(map[string]any)
	if distributionSummary["digest"] != fixture.SourceTestDataDigest || distributionSummary["included"] != true {
		t.Fatalf("target distribution did not retain fixture transfer audit: %#v", distributionSummary)
	}
}

func TestSemanticReleaseInstallFixtureTransferRequiresFlagAndExactDigest(t *testing.T) {
	fixture := newSemanticReleaseInstallFixture(t)

	missingDigest := fixture.input("")
	missingDigest["include_test_data"] = true
	testutil.Call(t, testHandler.semanticPreviewReleaseInstall, fixture.request("POST", missingDigest)).Want(400)

	withoutFlag := fixture.input("")
	withoutFlag["expected_test_data_digest"] = fixture.SourceTestDataDigest
	testutil.Call(t, testHandler.semanticPreviewReleaseInstall, fixture.request("POST", withoutFlag)).Want(400)

	wrongDigest := fixture.inputWithTestData("")
	wrongDigest["expected_test_data_digest"] = "sha256:wrong"
	testutil.Call(t, testHandler.semanticPreviewReleaseInstall, fixture.request("POST", wrongDigest)).Want(409)
}

func TestSemanticReleaseInstallRejectsFixtureThatIsNotSyntheticOnly(t *testing.T) {
	fixture := newSemanticReleaseInstallFixture(t)
	var source semanticPublishedRelease
	dbfx.QueryRow(t, `SELECT workspace_id::text,ontology_id::text,id::text,version,digest,test_data,validation FROM semantic_release WHERE id=$1`, fixture.SourceReleaseID).Scan(
		&source.WorkspaceID, &source.OntologyID, &source.ReleaseID, &source.Version, &source.Digest, &source.TestData, &source.Validation,
	)
	var document map[string]any
	_ = json.Unmarshal(source.TestData, &document)
	document["facts"].(map[string]any)["live_business_data"] = true
	source.TestData = semanticMarshal(document)
	input := semanticReleaseInstallInput{IncludeTestData: true, ExpectedTestDataDigest: semantic.Digest(semanticCanonicalJSONValue(source.TestData))}
	if _, _, err := semanticReleaseInstallSelectTestData(source, input); err == nil || !strings.Contains(err.Error(), "synthetic-only") {
		t.Fatalf("live business fixture was not rejected: %v", err)
	}
}

func TestSemanticPublishedReleaseFreezesValidationFixtureInDigest(t *testing.T) {
	fixture := newSemanticReleaseInstallFixture(t)
	var artifact, bindings, testData, validation json.RawMessage
	var digest string
	dbfx.QueryRow(t, `SELECT artifact,binding_config,test_data,validation,digest FROM semantic_release WHERE workspace_id=$1 AND id=$2`, fixture.SourceWorkspaceID, fixture.SourceReleaseID).Scan(&artifact, &bindings, &testData, &validation, &digest)
	wantDigest := semanticReleaseDigest(artifact, bindings, testData, validation)
	if digest != wantDigest || !strings.Contains(string(testData), "synthetic_positive_schema_coverage") {
		t.Fatalf("published release did not freeze its validated fixture: digest=%q want=%q data=%s", digest, wantDigest, testData)
	}
	dbfx.Exec(t, `UPDATE semantic_ontology SET test_data='{"content":"mutable later draft"}'::jsonb WHERE id=$1`, fixture.SourceOntologyID)
	var after json.RawMessage
	dbfx.QueryRow(t, `SELECT test_data FROM semantic_release WHERE id=$1`, fixture.SourceReleaseID).Scan(&after)
	if semantic.Digest(after) != semantic.Digest(testData) {
		t.Fatal("editing the source draft changed the immutable release fixture")
	}
}

func TestSemanticReleaseInstallConcurrentConfirmIsIdempotent(t *testing.T) {
	fixture := newSemanticReleaseInstallFixture(t)
	var preview map[string]any
	testutil.Call(t, testHandler.semanticPreviewReleaseInstall, fixture.request("POST", fixture.input(""))).Want(200).JSON(&preview)
	input := fixture.input(preview["preview_digest"].(string))
	responses := make(chan map[string]any, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			var response map[string]any
			testutil.Call(t, testHandler.semanticInstallRelease, fixture.request("POST", input)).WantOneOf(200, 201).JSON(&response)
			responses <- response
		}()
	}
	wait.Wait()
	close(responses)
	releaseIDs := map[string]bool{}
	for response := range responses {
		releaseIDs[response["release"].(map[string]any)["id"].(string)] = true
	}
	if len(releaseIDs) != 1 {
		t.Fatalf("concurrent confirmation created different releases: %#v", releaseIDs)
	}
	var installs, releases int
	dbfx.QueryRow(t, `SELECT (SELECT count(*) FROM semantic_release_installation WHERE workspace_id=$1),(SELECT count(*) FROM semantic_release WHERE workspace_id=$1)`, fixture.TargetWorkspaceID).Scan(&installs, &releases)
	if installs != 1 || releases != 1 {
		t.Fatalf("concurrent confirmation created lineage=%d releases=%d", installs, releases)
	}
}

func TestSemanticReleaseInstallRequiresExactConnectionMapping(t *testing.T) {
	connectionID := uuid.NewString()
	bindings := map[string]map[string]any{"data:cases": {"connection_id": connectionID}}
	if err := semanticValidateReleaseInstallMapping(bindings, map[string]string{}); err == nil {
		t.Fatal("missing source connection mapping was accepted")
	}
	if err := semanticValidateReleaseInstallMapping(bindings, map[string]string{connectionID: uuid.NewString(), uuid.NewString(): uuid.NewString()}); err == nil {
		t.Fatal("extra source connection mapping was accepted")
	}
	if err := semanticValidateReleaseInstallMapping(bindings, map[string]string{connectionID: uuid.NewString()}); err != nil {
		t.Fatalf("exact source connection mapping rejected: %v", err)
	}
}
