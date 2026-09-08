#!/usr/bin/env python3
"""Restore an immutable Enact application source revision into an empty directory."""
import argparse
import base64
from pathlib import Path, PurePosixPath
from urllib.parse import quote
from build import EXCLUDED, MAX_SOURCE, api_request, source_digest


def restore(build, destination):
    files = {}
    total = 0
    for name, encoded in build.get("source_files", {}).items():
        path = PurePosixPath(name)
        if path.is_absolute() or str(path) != name or any(part in EXCLUDED or part in ("..", ".") or part.startswith(".env") for part in path.parts) or any(c in name for c in "\\?#:"):
            raise ValueError("Unsafe source path in saved build")
        data = base64.b64decode(encoded, validate=True)
        total += len(data)
        if total > MAX_SOURCE:
            raise ValueError("Source snapshot exceeds 32 MiB")
        files[name] = data
    if "package.json" not in files or source_digest(files) != build.get("source_revision"):
        raise ValueError("Source snapshot does not match its revision")
    if destination.is_symlink() or destination.exists() and any(destination.iterdir()):
        raise ValueError("Restore requires an empty destination directory")
    destination.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return len(files)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--app-id", required=True)
    parser.add_argument("--build-id", required=True)
    args = parser.parse_args()
    build = api_request("/apps/" + quote(args.app_id, safe="") + "/builds/" + quote(args.build_id, safe=""))
    count = restore(build, args.destination)
    print(f"Restored {count} files at revision {build['source_revision']}")


if __name__ == "__main__":
    main()
