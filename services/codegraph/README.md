# enact-codegraph

Internal service that turns a workspace repository into a code graph with
[graphify](https://github.com/safishamsi/graphify) and serves it to the Enact
server. Code-only: tree-sitter AST extraction, Leiden communities, hub-derived
community names. No LLM is ever called from this service.

The wire contract lives in `docs/architecture/code-graph-contracts.md`.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `CODEGRAPH_SERVICE_KEY` | *(required)* | expected `X-Codegraph-Service-Key`; empty refuses every request except `/healthz` |
| `CODEGRAPH_DATA_DIR` | `/data` | `{key}/src` checkouts and `{key}/graphify-out` outputs |
| `CODEGRAPH_ALLOWED_HOSTS` | `github.com` | comma-separated clone hosts |
| `CODEGRAPH_MAX_FILES` | `20000` | code files above this → `skipped` / `too_large` |
| `CODEGRAPH_BUILD_TIMEOUT_S` | `900` | hard build timeout |
| `CODEGRAPH_MAX_CONTEXTS` | `8` | graphs kept warm in memory |

## Run

```sh
uv sync
CODEGRAPH_SERVICE_KEY=dev CODEGRAPH_DATA_DIR=/tmp/codegraph uv run uvicorn enact_codegraph.app:production_app --factory --port 8767
```

Or with the repository compose overlay: `docker compose -f docker-compose.selfhost.yml -f docker-compose.codegraph.yml up -d`.

## Test

```sh
uv sync
uv run pytest
```

Tests build a real graph from a small fixture repository (six Python files)
through `file://` clones; production defaults reject `file://`.
