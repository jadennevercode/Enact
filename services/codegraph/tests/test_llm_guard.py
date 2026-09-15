from __future__ import annotations

import pytest

from enact_codegraph import llm_guard


def test_sanitized_env_strips_backend_selectors() -> None:
    env = llm_guard.sanitized_env(
        {
            "PATH": "/usr/bin",
            "HOME": "/home/x",
            "ANTHROPIC_API_KEY": "a",
            "OPENAI_API_KEY": "b",
            "GEMINI_API_KEY": "c",
            "GOOGLE_API_KEY": "d",
            "MOONSHOT_API_KEY": "e",
            "DEEPSEEK_API_KEY": "f",
            "OLLAMA_BASE_URL": "http://x",
            "OLLAMA_HOST": "x",
            "AZURE_OPENAI_API_KEY": "g",
            "AWS_PROFILE": "p",
            "AWS_REGION": "r",
            "GRAPHIFY_ALLOW_LOCAL_PROVIDERS": "1",
            "GRAPHIFY_CLAUDE_CLI_MODEL": "m",
            "GRAPHIFY_NO_BACKUP": "1",
            "GRAPHIFY_REBUILD_TIMEOUT": "600",
        }
    )
    assert set(env) == {"PATH", "HOME", "GRAPHIFY_NO_BACKUP", "GRAPHIFY_REBUILD_TIMEOUT", "GRAPHIFY_VIZ_NODE_LIMIT"}
    assert env["GRAPHIFY_VIZ_NODE_LIMIT"] == "0"


def test_detect_backend_is_none_in_service_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    # Whatever the developer machine has configured, the service must see nothing.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "leak")
    monkeypatch.setenv("OLLAMA_HOST", "http://127.0.0.1:11434")
    assert llm_guard.detect_backend_in_sanitized_env() is None
    llm_guard.assert_no_llm_backend()


def test_service_never_calls_llm_labelers() -> None:
    """Call sites, not mentions: docstrings may explain why these are avoided."""
    import inspect
    import re

    from enact_codegraph import build, build_worker, graphs, queries, views

    forbidden = re.compile(r"\b(generate_community_labels|label_communities|detect_backend|extract_corpus_parallel|extract_files_direct)\s*\(")
    for module in (build, build_worker, graphs, queries, views):
        source = inspect.getsource(module)
        assert not forbidden.search(source), module.__name__
        assert "graphify.llm" not in source, module.__name__
