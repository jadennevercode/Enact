package semantic

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSemanticOriginsAndPathIsolation(t *testing.T) {
	adapter := Adapter{AllowedOrigins: []string{"http://127.0.0.1:18000"}}
	for _, endpoint := range []string{"http://127.0.0.1:18000.evil.test", "http://127.0.0.1:18001", "http://user:password@127.0.0.1:18000", "http://127.0.0.1:18000?token=secret"} {
		if adapter.ValidateEndpoint(endpoint) == nil {
			t.Errorf("accepted %s", endpoint)
		}
	}
	if err := adapter.ValidateEndpoint("http://127.0.0.1:18000/api"); err != nil {
		t.Fatal(err)
	}
	got, err := ExpandPath("/cases/{case}/operations/{response.id}", map[string]any{"case": "a/b", "response": map[string]any{"id": "op-1"}})
	if err != nil || got != "/cases/a%2Fb/operations/op-1" {
		t.Fatalf("path=%s err=%v", got, err)
	}
	if _, err = ExpandPath("/cases/{id}", nil); err == nil {
		t.Fatal("missing path parameter accepted")
	}
}

func TestSemanticRESTRejectsRedirectAndReportsAccepted(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "http://169.254.169.254/latest", 302)
			return
		}
		if r.Header.Get("Authorization") != "Bearer caller" || r.Header.Get("Idempotency-Key") != "action-1" {
			t.Error("identity or idempotency was not forwarded")
		}
		w.WriteHeader(202)
		_, _ = w.Write([]byte(`{"id":"op-1","status":"pending"}`))
	}))
	defer upstream.Close()
	adapter := Adapter{AllowedOrigins: []string{upstream.URL}}
	c := Connection{Endpoint: upstream.URL}
	s := Secret{Headers: map[string]string{"Authorization": "Bearer caller"}}
	if _, err := adapter.REST(context.Background(), c, s, "GET", "/redirect", nil, ""); err == nil {
		t.Fatal("redirect accepted")
	}
	raw, status, err := adapter.RESTWithStatus(context.Background(), c, s, "POST", "/action", map[string]any{}, "action-1")
	if err != nil || status != 202 || !strings.Contains(string(raw), "pending") {
		t.Fatalf("status=%d raw=%s err=%v", status, raw, err)
	}
}

func TestSemanticCredentialSubjects(t *testing.T) {
	c := Connection{Config: map[string]any{}}
	s := Secret{Headers: map[string]string{"Authorization": "Bearer shared"}, UserCredentials: map[string]Credential{"alice": {Headers: map[string]string{"Authorization": "Bearer alice"}, Roles: []string{"PlantManager"}}}}
	actual, err := CredentialFor(c, s, "alice", "member", true)
	if err != nil || actual.Headers["Authorization"] != "Bearer alice" {
		t.Fatalf("wrong identity: %+v %v", actual, err)
	}
	if _, err = CredentialFor(c, s, "bob", "owner", true); err == nil {
		t.Fatal("workspace owner inherited Alice's business credential")
	}
	if _, err = CredentialFor(c, Secret{Headers: s.Headers}, "bob", "member", true); err == nil {
		t.Fatal("implicit shared write credential accepted")
	}
}

func TestSemanticActionContractsAndReadback(t *testing.T) {
	binding := Binding{ID: "freeze", ConnectionID: "connection", Method: "POST", Path: "/freeze", Authorization: Authorization{Mode: "confirm"}, Readback: &Readback{Path: "/stock/{id}", Expected: map[string]any{"state": "frozen"}}}
	if err := (Bindings{Actions: []Binding{binding}}).Validate(); err != nil {
		t.Fatal(err)
	}
	binding.Authorization.Mode = ""
	if (Bindings{Actions: []Binding{binding}}).Validate() == nil {
		t.Fatal("implicit authorization accepted")
	}
	if err := CheckReadback(json.RawMessage(`{"status":"pending"}`), map[string]any{"status": "succeeded"}, nil); err == nil {
		t.Fatal("pending readback marked succeeded")
	}
	if err := CheckReadback(json.RawMessage(`{"stock":{"state":"frozen"}}`), map[string]any{"stock.state": "{expected}"}, map[string]any{"expected": "frozen"}); err != nil {
		t.Fatal(err)
	}
}

func TestSemanticMCPHandshakeAndReadOnlyGate(t *testing.T) {
	calls := []string{}
	writes := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var message map[string]any
		_ = json.NewDecoder(r.Body).Decode(&message)
		method, _ := message["method"].(string)
		calls = append(calls, method)
		w.Header().Set("Content-Type", "application/json")
		switch method {
		case "initialize":
			w.Header().Set("Mcp-Session-Id", "session-1")
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": message["id"], "result": map[string]any{"protocolVersion": "2025-03-26"}})
		case "notifications/initialized":
			w.WriteHeader(202)
		case "tools/list":
			if r.Header.Get("Mcp-Session-Id") != "session-1" {
				t.Error("MCP session not retained")
			}
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":3,"result":{"tools":[{"name":"read","annotations":{"readOnlyHint":true}},{"name":"write","annotations":{"readOnlyHint":false}}]}}`))
		case "tools/call":
			parameters := message["params"].(map[string]any)
			if parameters["name"] == "write" {
				writes++
			}
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"actual data"}]}}`))
		}
	}))
	defer upstream.Close()
	adapter := Adapter{AllowedOrigins: []string{upstream.URL}}
	c := Connection{Kind: "mcp", Endpoint: upstream.URL}
	if _, err := adapter.Query(context.Background(), c, Secret{}, Binding{Tool: "read"}, nil); err != nil {
		t.Fatal(err)
	}
	if len(calls) != 4 || calls[0] != "initialize" {
		t.Fatalf("incomplete MCP handshake: %v", calls)
	}
	if _, err := adapter.Query(context.Background(), c, Secret{}, Binding{Tool: "write"}, nil); err == nil || writes != 0 {
		t.Fatal("data binding executed a write MCP tool")
	}
}

func TestSemanticActionBodyParameters(t *testing.T) {
	var received map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/plans/plan-1/approve" {
			t.Error("path parameter missing")
		}
		received = nil
		_ = json.NewDecoder(r.Body).Decode(&received)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer upstream.Close()
	adapter := Adapter{AllowedOrigins: []string{upstream.URL}}
	binding := Binding{Method: "POST", Path: "/plans/{id}/approve"}
	params := map[string]any{"id": "plan-1", "expectedVersion": float64(2), "justification": "reviewed"}
	if _, _, err := adapter.Action(context.Background(), Connection{Endpoint: upstream.URL}, Secret{}, binding, params, "k"); err != nil {
		t.Fatal(err)
	}
	if len(received) != 2 || received["id"] != nil || params["id"] != "plan-1" {
		t.Fatalf("body=%v original=%v", received, params)
	}
	empty := []string{}
	binding.BodyParameters = &empty
	if _, _, err := adapter.Action(context.Background(), Connection{Endpoint: upstream.URL}, Secret{}, binding, params, "k"); err != nil {
		t.Fatal(err)
	}
	if len(received) != 0 {
		t.Fatalf("explicit empty body=%v", received)
	}
}

func TestSemanticMCPActionPinsSchemaAndCarriesIdempotency(t *testing.T) {
	catalog := json.RawMessage(`{"tools":[{"name":"freeze","inputSchema":{"type":"object","properties":{"key":{"type":"string"}}},"annotations":{"idempotentHint":true}},{"name":"read","annotations":{"readOnlyHint":true}}]}`)
	binding := Binding{Tool: "freeze", IdempotencyParameter: "key", Readback: &Readback{Tool: "read", Arguments: map[string]any{"id": "{response.structuredContent.id}"}, Expected: map[string]any{"structuredContent.status": "succeeded"}}}
	if err := PinMCPBinding(&binding, catalog, true); err != nil {
		t.Fatal(err)
	}
	writes := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input map[string]any
		_ = json.NewDecoder(r.Body).Decode(&input)
		switch input["method"] {
		case "initialize":
			_, _ = w.Write([]byte(`{"result":{}}`))
		case "notifications/initialized":
			w.WriteHeader(202)
		case "tools/list":
			_ = json.NewEncoder(w).Encode(map[string]any{"result": catalog})
		case "tools/call":
			params := input["params"].(map[string]any)
			args := params["arguments"].(map[string]any)
			if params["name"] == "freeze" {
				writes++
				if args["key"] != "receipt-1" {
					t.Error("MCP write lost idempotency")
				}
				_, _ = w.Write([]byte(`{"result":{"structuredContent":{"id":"operation-1"}}}`))
			} else {
				if args["id"] != "operation-1" {
					t.Error("readback did not use operation receipt")
				}
				_, _ = w.Write([]byte(`{"result":{"structuredContent":{"status":"succeeded"}}}`))
			}
		}
	}))
	defer upstream.Close()
	adapter := Adapter{AllowedOrigins: []string{upstream.URL}}
	connection := Connection{Kind: "mcp", Endpoint: upstream.URL}
	response, _, err := adapter.Action(context.Background(), connection, Secret{}, binding, map[string]any{}, "receipt-1")
	if err != nil {
		t.Fatal(err)
	}
	var decoded any
	_ = json.Unmarshal(response, &decoded)
	params := map[string]any{"response": decoded}
	read, err := adapter.Readback(context.Background(), connection, Secret{}, *binding.Readback, params)
	if err != nil {
		t.Fatal(err)
	}
	if err = CheckReadback(read, binding.Readback.Expected, params); err != nil {
		t.Fatal(err)
	}
	binding.ToolSchemaDigest = "changed"
	if _, _, err = adapter.Action(context.Background(), connection, Secret{}, binding, nil, "receipt-2"); err == nil || writes != 1 {
		t.Fatal("schema drift executed a system write")
	}
}
