"""Service settings read from the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

DEFAULT_ALLOWED_HOSTS = frozenset({"github.com"})
DEFAULT_MAX_FILES = 20_000
DEFAULT_BUILD_TIMEOUT_S = 900
DEFAULT_MAX_CONTEXTS = 8


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    service_key: str
    data_dir: Path
    allowed_hosts: frozenset[str]
    max_files: int = DEFAULT_MAX_FILES
    build_timeout_s: int = DEFAULT_BUILD_TIMEOUT_S
    max_contexts: int = DEFAULT_MAX_CONTEXTS

    @classmethod
    def from_env(cls) -> "Settings":
        hosts_raw = os.environ.get("CODEGRAPH_ALLOWED_HOSTS", "").strip()
        hosts = (
            frozenset(h.strip().lower() for h in hosts_raw.split(",") if h.strip())
            if hosts_raw
            else DEFAULT_ALLOWED_HOSTS
        )
        return cls(
            service_key=os.environ.get("CODEGRAPH_SERVICE_KEY", "").strip(),
            data_dir=Path(os.environ.get("CODEGRAPH_DATA_DIR", "/data")).resolve(),
            allowed_hosts=hosts,
            max_files=_int_env("CODEGRAPH_MAX_FILES", DEFAULT_MAX_FILES),
            build_timeout_s=_int_env("CODEGRAPH_BUILD_TIMEOUT_S", DEFAULT_BUILD_TIMEOUT_S),
            max_contexts=_int_env("CODEGRAPH_MAX_CONTEXTS", DEFAULT_MAX_CONTEXTS),
        )


def graphify_version() -> str:
    """Installed graphifyy distribution version (the package exposes no __version__)."""
    try:
        return version("graphifyy")
    except PackageNotFoundError:  # pragma: no cover - broken install
        return "unknown"
