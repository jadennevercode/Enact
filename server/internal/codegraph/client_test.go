package codegraph

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProjectKey(t *testing.T) {
	ws := "11111111-1111-1111-1111-111111111111"
	res := "22222222-2222-2222-2222-222222222222"
	key, err := ProjectKey(ws, res)
	if err != nil {
		t.Fatalf("ProjectKey: %v", err)
	}
	if key != ws+"--"+res {
		t.Fatalf("key = %q", key)
	}
	if _, err := ProjectKey("not-a-uuid", res); err == nil {
		t.Fatal("expected error for a non-UUID workspace id")
	}
	if _, err := ProjectKey("AAAAAAAA-1111-1111-1111-111111111111", res); err == nil {
		t.Fatal("expected error for an upper-case UUID")
	}
}

func TestDisabledClientReturnsErrDisabled(t *testing.T) {
	c := New("", "k")
	if c.Enabled() {
		t.Fatal("empty URL must be disabled")
	}
	if _, err := c.Build(context.Background(), "k", BuildRequest{}); !errors.Is(err, ErrDisabled) {
		t.Fatalf("err = %v, want ErrDisabled", err)
	}
}

func TestBuildSendsKeyAndDecodesResult(t *testing.T) {
	var gotKey, gotPath string
	var gotReq BuildRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("X-Codegraph-Service-Key")
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotReq)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"state": "ready", "commit": "abc", "stats": map[string]any{"nodes": 3, "graphify_version": "0.9.61"},
			"report_md": "# r",
		})
	}))
	defer srv.Close()
	c := New(srv.URL+"/", "secret")
	out, err := c.Build(context.Background(), "ws--res", BuildRequest{CloneURL: "https://x/y.git", Ref: "main", Token: "t"})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if gotKey != "secret" || gotPath != "/v1/projects/ws--res/build" {
		t.Fatalf("key=%q path=%q", gotKey, gotPath)
	}
	if gotReq.Token != "t" || gotReq.Ref != "main" {
		t.Fatalf("request not forwarded: %+v", gotReq)
	}
	if out.State != StateReady || out.Commit != "abc" || out.GraphifyVersion() != "0.9.61" || out.ReportMD != "# r" {
		t.Fatalf("result = %+v", out)
	}
}

func TestStatusMapping(t *testing.T) {
	cases := map[int]error{409: ErrBusy, 404: ErrNotBuilt, 500: ErrUnavailable, 503: ErrUnavailable}
	for status, want := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"error":"x"}`))
		}))
		c := New(srv.URL, "k")
		_, err := c.Build(context.Background(), "k", BuildRequest{})
		srv.Close()
		if !errors.Is(err, want) {
			t.Errorf("status %d: err = %v, want %v", status, err, want)
		}
	}
}

func TestUnreachableIsUnavailable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	srv.Close()
	c := New(srv.URL, "k")
	if _, err := c.Status(context.Background(), "k"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("err = %v, want ErrUnavailable", err)
	}
}

func TestForwardCopiesStatusBodyAndQuery(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Codegraph-Service-Key") != "k" {
			w.WriteHeader(401)
			return
		}
		if r.Method == http.MethodPost {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["question"] != "q" {
				w.WriteHeader(400)
				return
			}
		}
		w.WriteHeader(404)
		_, _ = w.Write([]byte(`{"error":"not_built","q":"` + r.URL.RawQuery + `"}`))
	}))
	defer srv.Close()
	c := New(srv.URL, "k")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x?level=community", nil)
	req.Header.Set("Authorization", "Bearer leak")
	c.Forward(rec, req, http.MethodGet, "/v1/projects/p/graph")
	if rec.Code != 404 || !strings.Contains(rec.Body.String(), `"q":"level=community"`) {
		t.Fatalf("GET forward: code=%d body=%s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`{"question":"q"}`))
	c.Forward(rec, req, http.MethodPost, "/v1/projects/p/query")
	if rec.Code != 404 {
		t.Fatalf("POST forward: code=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestForwardUnavailableIs503(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	srv.Close()
	c := New(srv.URL, "k")
	rec := httptest.NewRecorder()
	c.Forward(rec, httptest.NewRequest(http.MethodGet, "/", nil), http.MethodGet, "/v1/projects/p/stats")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("code = %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	New("", "").Forward(rec, httptest.NewRequest(http.MethodGet, "/", nil), http.MethodGet, "/x")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("disabled code = %d", rec.Code)
	}
}
