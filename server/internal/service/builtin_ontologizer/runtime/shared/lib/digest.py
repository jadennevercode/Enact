"""Content digests. Every immutability claim in this package rests on these."""

from __future__ import annotations

import hashlib
from pathlib import Path

ALGORITHM = "sha256"
SHORT = 12


def file_digest(path: str | Path) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            hasher.update(chunk)
    return f"{ALGORITHM}:{hasher.hexdigest()}"


def text_digest(text: str) -> str:
    return f"{ALGORITHM}:{hashlib.sha256(text.encode('utf-8')).hexdigest()}"


def tree_digest(root: str | Path, exclude: set[str] | None = None) -> dict[str, str]:
    """Digest every file under `root`, keyed by path relative to root.

    Directory order is not stable across filesystems, so the mapping is sorted
    before it is written; a digest map that reordered itself would read as a
    change in `semantic-diff` and in `audit`.
    """
    root = Path(root)
    exclude = exclude or set()
    result: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(root).as_posix()
        if any(relative == item or relative.startswith(item.rstrip("/") + "/") for item in exclude):
            continue
        result[relative] = file_digest(path)
    return dict(sorted(result.items()))


def combined(digests: dict[str, str]) -> str:
    """One digest standing for a whole tree, so a manifest can cite a single value."""
    hasher = hashlib.sha256()
    for key in sorted(digests):
        hasher.update(key.encode("utf-8"))
        hasher.update(b"\0")
        hasher.update(digests[key].encode("utf-8"))
        hasher.update(b"\n")
    return f"{ALGORITHM}:{hasher.hexdigest()}"


def short(digest: str) -> str:
    return digest.split(":", 1)[-1][:SHORT]
