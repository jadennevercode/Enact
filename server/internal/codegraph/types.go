package codegraph

import "encoding/json"

// Build states, shared with the code_graph_build table CHECK constraint.
const (
	StateQueued   = "queued"
	StateBuilding = "building"
	StateReady    = "ready"
	StateFailed   = "failed"
	StateSkipped  = "skipped"
)

// BuildRequest is the body of POST /v1/projects/{key}/build.
type BuildRequest struct {
	CloneURL string `json:"clone_url"`
	Ref      string `json:"ref"`
	// Token is used once in the clone URL and never persisted or logged.
	Token    string `json:"token,omitempty"`
	MaxFiles int    `json:"max_files,omitempty"`
	TimeoutS int    `json:"timeout_s,omitempty"`
}

// Stats is the container's build summary. Unknown fields are kept as raw
// JSON on the row; these are the ones the server reads.
type Stats struct {
	Files           int    `json:"files"`
	Nodes           int    `json:"nodes"`
	Edges           int    `json:"edges"`
	Communities     int    `json:"communities"`
	DurationMs      int64  `json:"duration_ms"`
	GraphifyVersion string `json:"graphify_version"`
	Incremental     bool   `json:"incremental"`
}

// BuildResult is the response of POST /v1/projects/{key}/build.
type BuildResult struct {
	State         string          `json:"state"`
	Commit        string          `json:"commit"`
	SkippedReason string          `json:"skipped_reason"`
	Error         string          `json:"error"`
	Stats         json.RawMessage `json:"stats"`
	Diff          json.RawMessage `json:"diff"`
	ReportMD      string          `json:"report_md"`
}

// GraphifyVersion reads stats.graphify_version, "" when absent.
func (r BuildResult) GraphifyVersion() string {
	var s Stats
	if len(r.Stats) == 0 || json.Unmarshal(r.Stats, &s) != nil {
		return ""
	}
	return s.GraphifyVersion
}

// Health is GET /healthz.
type Health struct {
	OK              bool   `json:"ok"`
	GraphifyVersion string `json:"graphify_version"`
}

// ProjectStatus is GET /v1/projects/{key}/status.
type ProjectStatus struct {
	Built   bool            `json:"built"`
	Commit  string          `json:"commit"`
	BuiltAt string          `json:"built_at"`
	Stats   json.RawMessage `json:"stats"`
}
