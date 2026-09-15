"""Project keys, on-disk layout and the single-flight build lock."""

from __future__ import annotations

import re
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .config import Settings
from .errors import ApiError

# `{workspace_id}--{resource_id}`: two UUIDs. This is the only path segment the
# container accepts, which keeps every filesystem path under CODEGRAPH_DATA_DIR
# by construction.
PROJECT_KEY_RE = re.compile(r"^[0-9a-f-]{36}--[0-9a-f-]{36}$")

# graphify's own output directory name. The service passes it to graphify as an
# absolute GRAPHIFY_OUT, so graphify never guesses relative to the checkout.
GRAPHIFY_OUT_DIRNAME = "graphify-out"


@dataclass(frozen=True)
class ProjectPaths:
    key: str
    root: Path

    @property
    def src(self) -> Path:
        return self.root / "src"

    @property
    def out(self) -> Path:
        return self.root / GRAPHIFY_OUT_DIRNAME

    @property
    def graph_json(self) -> Path:
        return self.out / "graph.json"

    @property
    def report_md(self) -> Path:
        return self.out / "GRAPH_REPORT.md"

    @property
    def labels_json(self) -> Path:
        return self.out / ".graphify_labels.json"

    @property
    def wiki_dir(self) -> Path:
        return self.out / "wiki"

    # Kept outside graphify-out so graphify never mistakes them for its own files.
    @property
    def prev_graph_json(self) -> Path:
        return self.root / "graph.prev.json"

    @property
    def build_json(self) -> Path:
        return self.root / "build.json"

    def is_built(self) -> bool:
        return self.graph_json.is_file()


def project_paths(settings: Settings, key: str) -> ProjectPaths:
    if not PROJECT_KEY_RE.match(key):
        raise ApiError(400, "invalid_project_key", "project key must be '{workspace_id}--{resource_id}'")
    root = (settings.data_dir / key).resolve()
    if root.parent != settings.data_dir.resolve():
        raise ApiError(400, "invalid_project_key", "project key escapes the data directory")
    return ProjectPaths(key=key, root=root)


class BuildLock:
    """One build at a time per container; a second caller gets 409 busy."""

    def __init__(self) -> None:
        self._lock = threading.Lock()

    @contextmanager
    def try_acquire(self) -> Iterator[bool]:
        got = self._lock.acquire(blocking=False)
        try:
            yield got
        finally:
            if got:
                self._lock.release()

    def acquire(self) -> None:
        self._lock.acquire()

    def release(self) -> None:
        self._lock.release()
