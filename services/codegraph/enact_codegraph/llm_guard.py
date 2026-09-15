"""Keep every LLM path in graphify unreachable from this service.

graphify auto-detects a model backend from the environment (API keys, Ollama
hosts, AWS profiles) and, in its CLI, can fall back to a local `claude` binary.
The service only ever calls the AST/cluster/report functions, which never
touch `graphify.llm`, but a build subprocess still inherits the environment, so
we strip every variable that could select a backend and assert at startup that
`graphify.llm.detect_backend()` sees nothing.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

_LLM_ENV_PREFIXES = (
    "ANTHROPIC_",
    "OPENAI_",
    "GEMINI_",
    "GOOGLE_",
    "MOONSHOT_",
    "KIMI_",
    "DEEPSEEK_",
    "OLLAMA_",
    "AZURE_OPENAI_",
    "AWS_",
    "GRAPHIFY_",
)

# GRAPHIFY_* variables the service itself relies on and re-applies after stripping.
_GRAPHIFY_KEEP = {
    "GRAPHIFY_VIZ_NODE_LIMIT",
    "GRAPHIFY_NO_BACKUP",
    "GRAPHIFY_REBUILD_TIMEOUT",
    "GRAPHIFY_REBUILD_MEMORY_LIMIT_MB",
    "GRAPHIFY_MAX_GRAPH_BYTES",
}


def sanitized_env(base: dict[str, str] | None = None) -> dict[str, str]:
    """Copy of `base` (default: os.environ) without any backend-selecting variable."""
    source = dict(os.environ if base is None else base)
    env: dict[str, str] = {}
    for key, value in source.items():
        if key in _GRAPHIFY_KEEP:
            env[key] = value
            continue
        if key.startswith(_LLM_ENV_PREFIXES):
            continue
        env[key] = value
    # Never render graphify's vis.js HTML from a build subprocess.
    env.setdefault("GRAPHIFY_VIZ_NODE_LIMIT", "0")
    return env


_PROBE = (
    "import json, graphify.llm as m; "
    "print(json.dumps({'backend': m.detect_backend()}))"
)


def detect_backend_in_sanitized_env(timeout: float = 60.0) -> str | None:
    """Run graphify's backend detection in a child with the sanitized env."""
    proc = subprocess.run(
        [sys.executable, "-c", _PROBE],
        env=sanitized_env(),
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"backend probe failed: {proc.stderr.strip()[-400:]}")
    last = proc.stdout.strip().splitlines()[-1]
    return json.loads(last).get("backend")


def assert_no_llm_backend() -> None:
    backend = detect_backend_in_sanitized_env()
    if backend is not None:
        raise RuntimeError(
            f"graphify would select the {backend!r} LLM backend inside the service; "
            "remove the credential from the container environment"
        )
