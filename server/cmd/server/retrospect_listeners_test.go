package main

import (
	"testing"

	"github.com/enact-ai/enact/server/internal/handler"
	"github.com/enact-ai/enact/server/internal/service"
	db "github.com/enact-ai/enact/server/pkg/db/generated"
)

// An issue reaches the bus rendered two ways: handler.IssueResponse from the
// HTTP handlers, service.IssueToMap from everything outside them. A listener
// that understood only the first would silently skip whichever status writers
// grow into the second — the gap moving this feature onto the bus was meant to
// close.
func TestIssueIDIsReadFromEitherEventShape(t *testing.T) {
	id, issueUUID := mustUUID(t)

	got, ok := issueIDFromPayload(handler.IssueResponse{ID: id})
	if !ok || got != id {
		t.Errorf("handler.IssueResponse payload: got (%q, %v), want (%q, true)", got, ok, id)
	}

	asMap := service.IssueToMap(db.Issue{
		ID:          issueUUID,
		CreatorType: "member",
	}, "ENA")
	got, ok = issueIDFromPayload(asMap)
	if !ok || got != id {
		t.Errorf("service.IssueToMap payload: got (%q, %v), want (%q, true)", got, ok, id)
	}
}

func TestAPayloadWithNoIssueIsIgnored(t *testing.T) {
	for name, payload := range map[string]any{
		"nil":            nil,
		"wrong type":     "an issue, honest",
		"map without id": map[string]any{"title": "no id here"},
		"empty id":       handler.IssueResponse{},
	} {
		if _, ok := issueIDFromPayload(payload); ok {
			t.Errorf("%s: reported an issue id, want none — filing on a guessed id would attach a review to the wrong work", name)
		}
	}
}
