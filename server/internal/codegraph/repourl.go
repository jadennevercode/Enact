package codegraph

import (
	"net/url"
	"strings"
)

// NormalizeRepoURL reduces the ways a repository can be written to one
// comparable form: lower-case host, owner/path as written, no scheme, no
// `.git`, no trailing slash. The three shapes GitHub's "Code" menu offers
// (https, ssh://, and the scp-like git@host:owner/repo.git) all collapse to
// the same string, which is how the CLI matches a checkout's origin against
// a workspace resource. Returns "" when nothing repository-like is found.
func NormalizeRepoURL(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	var host, path string
	if u, err := url.Parse(s); err == nil && u.Host != "" && u.Scheme != "" {
		host = u.Hostname()
		path = u.Path
	} else if at := strings.Index(s, "@"); !strings.Contains(s, "://") {
		// scp-like shorthand: [user@]host:path
		rest := s
		if at >= 0 {
			rest = s[at+1:]
		}
		colon := strings.Index(rest, ":")
		if colon <= 0 {
			return ""
		}
		host = rest[:colon]
		path = rest[colon+1:]
	} else {
		return ""
	}
	host = strings.ToLower(host)
	path = strings.Trim(path, "/")
	path = strings.TrimSuffix(path, ".git")
	path = strings.TrimSuffix(path, "/")
	if host == "" || path == "" {
		return ""
	}
	return host + "/" + path
}

// SplitOwnerRepo returns the owner and repository name of a normalized URL
// ("github.com/acme/backend" → "acme", "backend"). ok is false when the path
// does not have exactly an owner and a name.
func SplitOwnerRepo(normalized string) (host, owner, repo string, ok bool) {
	parts := strings.Split(normalized, "/")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}
