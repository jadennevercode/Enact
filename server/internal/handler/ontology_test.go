package handler

import (
	"archive/zip"
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/enact-ai/enact/server/internal/testutil"
)

func ontologyPackage(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	for name, content := range files {
		writer, err := archive.Create("example/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestListOntologiesProxiesCapHubCatalog(t *testing.T) {
	var receivedKey string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedKey = r.Header.Get("X-API-Key")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{
			"name":"order_management","name_zh":"订单管理","version":"1.0.0",
			"description":"Orders","description_zh":"订单", "entity_count":2,
			"action_count":3,"policy_count":1,"is_layered":true,"capability_count":4
		}]`))
	}))
	defer upstream.Close()

	h := &Handler{cfg: Config{
		CapHubAPIURL: upstream.URL,
		CapHubURL:    "https://caphub.example",
		CapHubAPIKey: "secret-key",
	}}
	req := httptest.NewRequest(http.MethodGet, "/api/ontologies", nil)
	var response []OntologySummaryResponse
	testutil.Call(t, h.ListOntologies, req).Want(http.StatusOK).JSON(&response)

	if receivedKey != "secret-key" {
		t.Fatalf("X-API-Key = %q, want secret-key", receivedKey)
	}
	if len(response) != 1 || response[0].Name != "order_management" {
		t.Fatalf("unexpected response: %#v", response)
	}
	if response[0].CapHubURL != "https://caphub.example/domains/order_management" {
		t.Fatalf("caphub_url = %q", response[0].CapHubURL)
	}
}

func TestGetOntologyReturnsDetailAndOntologyPreview(t *testing.T) {
	packageBytes := ontologyPackage(t, map[string]string{
		"SKILL.md":      "# order_management\n\nOntology body",
		"references.md": "# Reference",
	})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/domains/order_management":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"name":"order_management","version":"1.0.0","description":"Orders",
				"is_layered":true,"entities":[{"name":"Order"}],"actions":[],
				"policies":[],"capabilities":[{"name":"approve_order"}]
			}`))
		case "/api/domains/order_management/skill-package.zip":
			w.Header().Set("Content-Type", "application/zip")
			_, _ = w.Write(packageBytes)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	h := &Handler{cfg: Config{CapHubAPIURL: upstream.URL}}
	req := httptest.NewRequest(http.MethodGet, "/api/ontologies/order_management", nil)
	req = testutil.WithURLParams(req, "domain", "order_management")
	var response OntologyDetailResponse
	testutil.Call(t, h.GetOntology, req).Want(http.StatusOK).JSON(&response)

	if response.Preview != "# order_management\n\nOntology body" {
		t.Fatalf("preview = %q", response.Preview)
	}
	if response.EntityCount != 1 || response.CapabilityCount != 1 {
		t.Fatalf("unexpected counts: %#v", response.OntologySummaryResponse)
	}
}

func TestSkillConfigOntologyMetadata(t *testing.T) {
	config := []byte(`{"kind":"ontology","ontology":{"domain":"order_management"}}`)
	if got := skillConfigKind(config); got != "ontology" {
		t.Fatalf("kind = %q", got)
	}
	if got := skillConfigOntologyDomain(config); got != "order_management" {
		t.Fatalf("domain = %q", got)
	}
}
