// Package codegraph is the Go server's client for the codegraph container:
// the service that clones a repository, builds its structure graph with
// graphify and answers graph queries. See docs/architecture/code-graph-contracts.md.
//
// The server never touches graph data itself. It decides which repositories
// get a graph, queues builds, stores their outcome, and proxies reads to the
// container behind workspace authorization.
package codegraph

import (
	"errors"
	"fmt"
	"regexp"
)

// projectKeyPattern is the only path segment the container accepts.
var projectKeyPattern = regexp.MustCompile(`^[0-9a-f-]{36}--[0-9a-f-]{36}$`)

// ProjectKey joins a workspace and a resource id into the container's project
// identifier. Both must be canonical lower-case UUID strings.
func ProjectKey(workspaceID, resourceID string) (string, error) {
	key := workspaceID + "--" + resourceID
	if !projectKeyPattern.MatchString(key) {
		return "", fmt.Errorf("codegraph: invalid project key %q", key)
	}
	return key, nil
}

// ErrDisabled is returned when the deployment has no container configured.
var ErrDisabled = errors.New("codegraph: service is not configured")

// ErrUnavailable is returned when the container cannot be reached or answers
// with a transport-level failure.
var ErrUnavailable = errors.New("codegraph: service is unavailable")

// ErrBusy is returned when the container is already running a build.
var ErrBusy = errors.New("codegraph: service is busy")

// ErrNotBuilt is returned when the project has no graph yet.
var ErrNotBuilt = errors.New("codegraph: project is not built")
