#!/usr/bin/env bash
# Refresh the vendored Ontologizer skill bundle from an Ontologizer checkout.
#
# The skills are authored in the Ontologizer repository, which owns them along
# with the validators and the knowledge base. The server carries a copy because
# the Marketplace catalog publishes them: a listing has to ship the bytes it
# installs, and the catalog workspace is provisioned from the server binary on
# every boot. Nothing else reads this copy — a runtime still loads the skills
# from its own checkout through the Claude Code plugin.
#
# Usage:
#   scripts/sync-ontologizer-skills.sh [ONTOLOGIZER_CHECKOUT]
#
# With no argument the checkout recorded in ~/.enact/ontologizer.yaml is used,
# which is what `enact ontologizer setup` wrote.
#
# Run this whenever the upstream skills change, then commit the diff and bump
# service.CatalogVersion so the new bytes reach workspaces as an offered update.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$repo_root/server/internal/service/builtin_ontologizer/skills"

src="${1:-}"
if [ -z "$src" ]; then
  config="$HOME/.enact/ontologizer.yaml"
  if [ ! -f "$config" ]; then
    echo "No checkout given and $config does not exist." >&2
    echo "Pass the Ontologizer checkout path, or run 'enact ontologizer setup' first." >&2
    exit 1
  fi
  src="$(sed -n 's/^runtime_dir:[[:space:]]*//p' "$config" | head -1)"
fi

if [ -z "$src" ] || [ ! -d "$src/skills" ]; then
  echo "Not an Ontologizer checkout: ${src:-<empty>} (expected a skills/ directory)" >&2
  exit 1
fi

echo "==> Syncing from $src/skills"
rm -rf "$dest"
mkdir -p "$dest"

# SKILL.md plus references/ and templates/. evals/ is the upstream test suite
# and .DS_Store is noise; neither belongs in a published listing.
(cd "$src/skills" && find . -type f \( -name 'SKILL.md' -o -path './*/references/*' -o -path './*/templates/*' \) -print0) |
  while IFS= read -r -d '' rel; do
    rel="${rel#./}"
    mkdir -p "$dest/$(dirname "$rel")"
    cp "$src/skills/$rel" "$dest/$rel"
  done

count=$(find "$dest" -type f | wc -l | tr -d ' ')
skills=$(find "$dest" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
echo "==> $skills skills, $count files under server/internal/service/builtin_ontologizer/skills"
echo "    Bump service.CatalogVersion if the content changed."
