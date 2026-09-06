#!/usr/bin/env bash
# Remove workspaces and pull request rows left behind by ghsnapshot tests.
#
# The tests in server/internal/integrations/ghsnapshot held `defer pool.Close()`,
# which runs when the test function returns — before t.Cleanup fires. Every
# fixture DELETE therefore ran against a closed pool, failed, and was swallowed
# by its ignored error. github_pull_request holds a foreign key to workspace, so
# the leaked PR row then blocked seedWorkspace's own delete too, and a workspace
# and a PR row leaked per seed on every run since August.
#
# The leak itself is fixed (closing the pool is now a cleanup registered before
# any fixture's, so the DELETEs run while the pool is still open). This clears
# what earlier runs left.
#
# Only workspaces whose slug starts with 'ghsnap-' are touched: that prefix is
# written by seedWorkspace and by nothing a person would create.
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_input="${1:-.env}"

if [[ "$env_input" = /* ]]; then
  env_file="$env_input"
else
  env_file="$PWD/$env_input"
fi

if [ ! -f "$env_file" ]; then
  echo "Missing env file: $env_input" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

POSTGRES_DB="${POSTGRES_DB:-}"
POSTGRES_USER="${POSTGRES_USER:-enact}"
DATABASE_URL="${DATABASE_URL:-}"

if [ -z "$POSTGRES_DB" ]; then
  echo "Refusing to run: POSTGRES_DB is empty in $env_input." >&2
  exit 1
fi

# Test residue is a local-development problem. A remote host is somebody's
# deployment, where a 'ghsnap-' workspace could be a real one.
case "$DATABASE_URL" in
  "" | *@localhost:* | *@localhost/* | *@127.0.0.1:* | *@127.0.0.1/* | *@\[::1\]:* | *@\[::1\]/*) ;;
  *)
    echo "Refusing to sweep '$POSTGRES_DB': DATABASE_URL points at a remote host." >&2
    exit 1
    ;;
esac

cd "$root_dir"

run_sql() {
  docker compose exec -T postgres \
    psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --quiet --no-align --tuples-only --command "$1"
}

before="$(run_sql "SELECT count(*) FROM workspace WHERE slug LIKE 'ghsnap-%';")"
echo "Database:           $POSTGRES_DB"
echo "ghsnap-* workspaces: $before"

if [ "$before" = "0" ]; then
  echo "Nothing to sweep."
  exit 0
fi

if [ "${ASSUME_YES:-0}" != "1" ]; then
  printf "Delete these workspaces and their pull request and check run rows? [y/N] "
  if ! IFS= read -r answer; then
    answer=""
  fi
  case "$answer" in
    y | Y) ;;
    *)
      echo "Cancelled."
      # Callers distinguish an intentional cancellation from an execution error.
      exit 2
      ;;
  esac
fi

# Children first: github_pull_request holds a foreign key to workspace, and the
# check runs hang off the pull request, so the workspace can only go last.
run_sql "
BEGIN;
DELETE FROM github_pull_request_check_run WHERE pr_id IN (
  SELECT p.id FROM github_pull_request p
  JOIN workspace w ON w.id = p.workspace_id
  WHERE w.slug LIKE 'ghsnap-%');
DELETE FROM github_pull_request WHERE workspace_id IN (
  SELECT id FROM workspace WHERE slug LIKE 'ghsnap-%');
DELETE FROM workspace WHERE slug LIKE 'ghsnap-%';
COMMIT;
" > /dev/null

after="$(run_sql "SELECT count(*) FROM workspace WHERE slug LIKE 'ghsnap-%';")"
echo "Removed $((before - after)) workspaces; $after remain."
