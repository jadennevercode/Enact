package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestIssueCollectionProjectionsIncludePositiveRevision(t *testing.T) {
	if testHandler == nil {
		t.Skip("database not available")
	}

	ctx := context.Background()
	suffix := time.Now().UnixNano()
	// A per-run metadata tag narrows the REST list and a per-run label
	// narrows the table query — between them both projections see exactly
	// this one seeded row now that there is no project to scope them by.
	scope := fmt.Sprintf("revision-projection-%d", suffix)
	labelID := seedIssueTableLabel(t, scope)

	var issueNumber int
	if err := testPool.QueryRow(ctx, `
		UPDATE workspace
		SET issue_counter = GREATEST(
			issue_counter,
			(SELECT COALESCE(MAX(number), 0) FROM issue WHERE workspace_id = $1)
		) + 1
		WHERE id = $1
		RETURNING issue_counter
	`, testWorkspaceID).Scan(&issueNumber); err != nil {
		t.Fatalf("reserve issue number: %v", err)
	}

	title := fmt.Sprintf("revision-projection-%d", suffix)
	var issueID string
	if err := testPool.QueryRow(ctx, `
		INSERT INTO issue (
			workspace_id, title, status, priority, creator_type, creator_id,
			position, number, metadata, revision
		)
		VALUES ($1, $2, 'in_review', 'none', 'member', $3, 1, $4, jsonb_build_object('scope', $5::text), 7)
		RETURNING id
	`, testWorkspaceID, title, testUserID, issueNumber, scope).Scan(&issueID); err != nil {
		t.Fatalf("seed issue: %v", err)
	}
	if _, err := testPool.Exec(ctx,
		`INSERT INTO issue_to_label (issue_id, label_id) VALUES ($1, $2)`, issueID, labelID); err != nil {
		t.Fatalf("label seeded issue: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM issue WHERE id = $1`, issueID)
	})

	groupKey := "status:in_review"
	tableRecorder := httptest.NewRecorder()
	testHandler.ListIssueTableRows(tableRecorder, newRequest(http.MethodPost, "/api/issues/table/rows", issueTableRowsRequest{
		Query: issueTableQuerySpec{
			Scope:   issueTableScope{Kind: "workspace"},
			Filters: issueTableFiltersRequest{LabelIDs: []string{labelID}},
			Sort:    issueTableSortRequest{Field: "position", Direction: "asc"},
		},
		Group:     issueTableGroupSpec{Kind: "status"},
		GroupKey:  &groupKey,
		Hierarchy: issueTableHierarchyRequest{Enabled: false},
		Page:      issueTablePageRequest{Limit: 10},
	}))
	if tableRecorder.Code != http.StatusOK {
		t.Fatalf("table rows status = %d: %s", tableRecorder.Code, tableRecorder.Body.String())
	}
	var tableResponse issueTableRowsResponse
	if err := json.NewDecoder(tableRecorder.Body).Decode(&tableResponse); err != nil {
		t.Fatalf("decode table rows: %v", err)
	}
	if len(tableResponse.Rows) != 1 || tableResponse.Rows[0].Issue.ID != issueID {
		t.Fatalf("table rows = %+v, want issue %s", tableResponse.Rows, issueID)
	}
	if tableResponse.Rows[0].Issue.Revision != 7 {
		t.Fatalf("table row revision = %d, want 7", tableResponse.Rows[0].Issue.Revision)
	}

	listRecorder := httptest.NewRecorder()
	testHandler.ListIssues(listRecorder, newRequest(http.MethodGet,
		"/api/issues?metadata="+url.QueryEscape(fmt.Sprintf(`{"scope":%q}`, scope)), nil))
	if listRecorder.Code != http.StatusOK {
		t.Fatalf("list issues status = %d: %s", listRecorder.Code, listRecorder.Body.String())
	}
	var listResponse struct {
		Issues []IssueResponse `json:"issues"`
	}
	if err := json.NewDecoder(listRecorder.Body).Decode(&listResponse); err != nil {
		t.Fatalf("decode issue list: %v", err)
	}
	if len(listResponse.Issues) != 1 || listResponse.Issues[0].ID != issueID || listResponse.Issues[0].Revision != 7 {
		t.Fatalf("list projection = %+v, want issue %s at revision 7", listResponse.Issues, issueID)
	}

	searchRecorder := httptest.NewRecorder()
	testHandler.SearchIssues(searchRecorder, newRequest(http.MethodGet, "/api/issues/search?q="+url.QueryEscape(title), nil))
	if searchRecorder.Code != http.StatusOK {
		t.Fatalf("search issues status = %d: %s", searchRecorder.Code, searchRecorder.Body.String())
	}
	var searchResponse struct {
		Issues []IssueResponse `json:"issues"`
	}
	if err := json.NewDecoder(searchRecorder.Body).Decode(&searchResponse); err != nil {
		t.Fatalf("decode issue search: %v", err)
	}
	if len(searchResponse.Issues) != 1 || searchResponse.Issues[0].ID != issueID || searchResponse.Issues[0].Revision != 7 {
		t.Fatalf("search projection = %+v, want issue %s at revision 7", searchResponse.Issues, issueID)
	}
}
