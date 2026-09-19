package contextstate

import "encoding/json"

// Envelope records exactly the versioned input delivered to this execution.
// Completeness is scoped to Issue records; external resources still need reads.
type Envelope struct {
	ScopeType      string          `json:"scope_type"`
	Chat           json.RawMessage `json:"chat,omitempty"`
	Protocol       string          `json:"protocol"`
	SourceRevision string          `json:"source_revision"`
	Complete       bool            `json:"complete"`
	Gap            string          `json:"gap,omitempty"`
	Issue          json.RawMessage `json:"issue,omitempty"`
	Comments       []Input         `json:"comments"`
	Deleted        []string        `json:"deleted,omitempty"`
	Checkpoint     *Checkpoint     `json:"checkpoint,omitempty"`
}
type Input struct {
	ID         string `json:"id"`
	Revision   int64  `json:"revision"`
	ParentID   string `json:"parent_id,omitempty"`
	AuthorType string `json:"author_type"`
	Content    string `json:"content"`
}
type Checkpoint struct {
	ID             string         `json:"id,omitempty"`
	SourceTaskID   string         `json:"source_task_id"`
	SourceRevision string         `json:"source_revision"`
	Summary        string         `json:"summary"`
	Decisions      []string       `json:"decisions"`
	Pending        []string       `json:"pending"`
	Evidence       []string       `json:"evidence"`
	Processed      []InputVersion `json:"processed"`
}
type InputVersion struct {
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
}
