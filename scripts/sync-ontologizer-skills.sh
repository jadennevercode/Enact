#!/usr/bin/env bash
# Refresh the vendored Ontologizer bundle from an Ontologizer checkout.
#
# The skills are authored in the Ontologizer repository
# (https://github.com/jadennevercode/Ontologizer-Skill), which owns them along
# with the validators and the knowledge base. The server carries a copy because
# the Marketplace catalog publishes them: a listing has to ship the bytes it
# installs, and the catalog workspace is provisioned from the server binary on
# every boot.
#
# Two trees are synced:
#
#   skills/   SKILL.md plus references/ and templates/, one directory per skill
#   runtime/  scripts/, shared/, tools/ and knowledge/ — the package the skills
#             shell out to. It is stored once here; the catalog attaches it to
#             every skill listing at publish time so an installed skill's
#             directory is a complete package on the runtime host, with no
#             host-level setup. Ontologizer is standard-library Python, which is
#             what makes shipping it as skill files possible.
#
# A runtime that installed Ontologizer as a Claude Code plugin still loads the
# skills from its own checkout; the SKILL.md locator rule covers both layouts.
#
# Usage:
#   scripts/sync-ontologizer-skills.sh [ONTOLOGIZER_CHECKOUT]
#
# With no argument the checkout recorded in ~/.enact/ontologizer.yaml is used,
# which is what `enact ontologizer setup` wrote.
#
# Run this whenever the upstream changes, then commit the diff and bump
# service.CatalogVersion so the new bytes reach workspaces as an offered update.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest_root="$repo_root/server/internal/service/builtin_ontologizer"
dest_skills="$dest_root/skills"
dest_runtime="$dest_root/runtime"

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

if [ -z "$src" ] || [ ! -d "$src/skills" ] || [ ! -f "$src/scripts/state.py" ]; then
  echo "Not an Ontologizer checkout: ${src:-<empty>} (expected skills/ and scripts/state.py)" >&2
  exit 1
fi

# Neither tree ships caches, editor droppings or the upstream test suite.
is_noise() {
  case "$1" in
    *__pycache__*|*.pyc|*.DS_Store|*/evals/*) return 0 ;;
    *) return 1 ;;
  esac
}

echo "==> Syncing compatibility resources from $src/skills (Enact native skill entrypoints are preserved)"
mkdir -p "$dest_skills"
(cd "$src/skills" && find . -type f \( -name 'SKILL.md' -o -path './*/references/*' -o -path './*/templates/*' \) -print0) |
  while IFS= read -r -d '' rel; do
    rel="${rel#./}"
    is_noise "$rel" && continue
    # SKILL.md is the Enact-native adapter, maintained in this repository.
    # Upstream package instructions must not replace its release contract.
    [[ "$rel" == */SKILL.md ]] && continue
    mkdir -p "$dest_skills/$(dirname "$rel")"
    cp "$src/skills/$rel" "$dest_skills/$rel"
  done

echo "==> Syncing runtime from $src/{scripts,shared,tools,knowledge}"
mkdir -p "$dest_runtime"
for tree in scripts shared tools knowledge; do
  if [ ! -d "$src/$tree" ]; then
    echo "Checkout has no $tree/ directory; the skills reference it." >&2
    exit 1
  fi
  (cd "$src" && find "$tree" -type f -print0) |
    while IFS= read -r -d '' rel; do
      is_noise "$rel" && continue
      # These documents define the Enact/native boundary and are not upstream
      # standalone-package resources.
      case "$rel" in shared/semantic-native.md|shared/conventions.md|shared/manifests/stages.yaml) continue ;; esac
      mkdir -p "$dest_runtime/$(dirname "$rel")"
      cp "$src/$rel" "$dest_runtime/$rel"
    done
done

skills=$(find "$dest_skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
skill_files=$(find "$dest_skills" -type f | wc -l | tr -d ' ')
runtime_files=$(find "$dest_runtime" -type f | wc -l | tr -d ' ')
runtime_bytes=$(find "$dest_runtime" -type f -print0 | xargs -0 wc -c | tail -1 | awk '{print $1}')
echo "==> $skills skills, $skill_files skill files; runtime $runtime_files files, $runtime_bytes bytes"
echo "    Bump service.CatalogVersion if the content changed."
