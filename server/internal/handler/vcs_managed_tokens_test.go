package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestInspectGitLabManagedTokensUsesActualScopesAndEarliestExpiry(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Header.Get("PRIVATE-TOKEN") {
		case "api-token":
			_, _ = w.Write([]byte(`{"scopes":["api"],"active":true,"revoked":false,"expires_at":"2030-12-31"}`))
		case "git-token":
			_, _ = w.Write([]byte(`{"scopes":["write_repository"],"active":true,"revoked":false,"expires_at":"2030-06-30"}`))
		default:
			w.WriteHeader(http.StatusUnauthorized)
		}
	}))
	defer server.Close()

	scopes, expiry, err := inspectGitLabManagedTokens(context.Background(), server.Client(), server.URL, "api-token", "git-token")
	if err != nil {
		t.Fatalf("inspectGitLabManagedTokens: %v", err)
	}
	if len(scopes) != 2 || scopes[0] != "api" || scopes[1] != "write_repository" {
		t.Fatalf("scopes = %#v", scopes)
	}
	if expiry != "2030-06-30T00:00:00Z" {
		t.Fatalf("expiry = %q", expiry)
	}
}

func TestInspectGitLabManagedTokensRejectsMisdeclaredGitScope(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		scope := "api"
		if r.Header.Get("PRIVATE-TOKEN") == "git-token" {
			scope = "read_repository"
		}
		_, _ = w.Write([]byte(`{"scopes":["` + scope + `"],"active":true,"revoked":false,"expires_at":"2030-12-31"}`))
	}))
	defer server.Close()

	_, _, err := inspectGitLabManagedTokens(context.Background(), server.Client(), server.URL, "api-token", "git-token")
	if err == nil {
		t.Fatal("expected write_repository scope validation error")
	}
}
