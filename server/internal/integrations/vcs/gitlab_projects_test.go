package vcs

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListGitLabProjectsPreservesEnterpriseRepositoryMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v4/projects" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.Header.Get("PRIVATE-TOKEN") != "api-token" {
			t.Fatal("missing private token")
		}
		if r.URL.Query().Get("membership") != "true" || r.URL.Query().Get("search") != "service" {
			t.Fatalf("query = %s", r.URL.RawQuery)
		}
		w.Header().Set("X-Total", "2")
		w.Header().Set("X-Next-Page", "2")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{
			"id":42,
			"path_with_namespace":"platform/payments/service",
			"http_url_to_repo":"https://gitlab.corp/platform/payments/service.git",
			"web_url":"https://gitlab.corp/platform/payments/service",
			"visibility":"private",
			"archived":false,
			"default_branch":"trunk",
			"permissions":{"group_access":{"access_level":30}}
		}]`))
	}))
	defer server.Close()

	page, err := ListGitLabProjects(context.Background(), server.Client(), server.URL, "api-token", "service", 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Projects) != 1 || page.Projects[0].PathWithNamespace != "platform/payments/service" {
		t.Fatalf("projects = %#v", page.Projects)
	}
	if page.Projects[0].DefaultBranch != "trunk" || page.Projects[0].Visibility != "private" {
		t.Fatalf("project metadata = %#v", page.Projects[0])
	}
	if page.Projects[0].Permissions.GroupAccess == nil || page.Projects[0].Permissions.GroupAccess.AccessLevel != 30 {
		t.Fatalf("permissions = %#v", page.Projects[0].Permissions)
	}
	if page.Total != 2 || page.NextPage == nil || *page.NextPage != 2 {
		t.Fatalf("pagination = %#v", page)
	}
}

func TestListGitLabProjectsClassifiesForbiddenSeparately(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusForbidden) }))
	defer server.Close()
	_, err := ListGitLabProjects(context.Background(), server.Client(), server.URL, "bad", "", 1, 50)
	if err != ErrForbidden {
		t.Fatalf("err = %v", err)
	}
}

func TestInspectGitLabTokenReturnsServerReportedScopeAndExpiry(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v4/personal_access_tokens/self" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if got := r.Header.Get("PRIVATE-TOKEN"); got != "git-token" {
			t.Fatalf("PRIVATE-TOKEN = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"name":"enact-git","scopes":["write_repository"],"active":true,"revoked":false,"expires_at":"2030-12-31"}`))
	}))
	defer server.Close()

	metadata, err := InspectGitLabToken(context.Background(), server.Client(), server.URL, "git-token")
	if err != nil {
		t.Fatalf("InspectGitLabToken: %v", err)
	}
	if metadata.Name != "enact-git" || metadata.ExpiresAt != "2030-12-31" || len(metadata.Scopes) != 1 || metadata.Scopes[0] != "write_repository" {
		t.Fatalf("metadata = %#v", metadata)
	}
}

func TestInspectGitLabTokenRejectsInactiveToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"scopes":["api"],"active":false,"revoked":true,"expires_at":"2030-12-31"}`))
	}))
	defer server.Close()

	_, err := InspectGitLabToken(context.Background(), server.Client(), server.URL, "revoked")
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("error = %v, want ErrUnauthorized", err)
	}
}
