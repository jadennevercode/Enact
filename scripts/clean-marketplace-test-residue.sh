#!/usr/bin/env bash
# Remove marketplace rows left behind by handler tests.
#
# The publish fixtures in server/internal/handler/marketplace_*_test.go used to
# register their cleanup with t.Context(), which Go cancels before cleanup
# functions run, so their DELETEs never executed. The marketplace tables carry
# no foreign keys, so dropping the test workspaces did not take the listings
# with them either — and the listings are published as 'public', which browse
# shows to every workspace in the deployment.
#
# The leak itself is fixed (the cleanups use context.Background(), and TestMain
# fails the suite if the row count grows). This clears what earlier runs left.
# Only rows whose listing slug starts with 'mp-' are touched: that prefix is
# owned by the handler test fixtures and by nothing a person would publish.
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
# deployment, where an 'mp-' listing could be a real one.
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

before="$(run_sql "SELECT count(*) FROM marketplace_listing WHERE slug LIKE 'mp-%';")"
echo "Database:      $POSTGRES_DB"
echo "mp-* listings: $before"

if [ "$before" = "0" ]; then
  echo "Nothing to sweep."
  exit 0
fi

if [ "${ASSUME_YES:-0}" != "1" ]; then
  printf "Delete these listings and their versions, files and install records? [y/N] "
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

# Children first: the file sweep reaches its rows through the version table, so
# versions have to still be there when it runs.
run_sql "
BEGIN;
DELETE FROM marketplace_listing_file WHERE version_id IN (
  SELECT v.id FROM marketplace_listing_version v
  JOIN marketplace_listing l ON l.id = v.listing_id
  WHERE l.slug LIKE 'mp-%');
DELETE FROM marketplace_listing_version WHERE listing_id IN (
  SELECT id FROM marketplace_listing WHERE slug LIKE 'mp-%');
DELETE FROM marketplace_install WHERE listing_id IN (
  SELECT id FROM marketplace_listing WHERE slug LIKE 'mp-%');
DELETE FROM marketplace_listing WHERE slug LIKE 'mp-%';
COMMIT;
" > /dev/null

after="$(run_sql "SELECT count(*) FROM marketplace_listing WHERE slug LIKE 'mp-%';")"
echo "Removed $((before - after)) listings; $after remain."
