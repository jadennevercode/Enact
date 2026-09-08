#!/usr/bin/env python3
"""Build an Enact application in isolation; never forward credentials to npm."""
import argparse
import base64
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request
from urllib.parse import urlparse

EXCLUDED = {"node_modules", ".git", ".env", ".env.local", ".npmrc", ".netrc", ".pypirc", ".ssh", ".codex", ".agents", "dist", "application-build.json"}
MAX_SOURCE = 32 * 1024 * 1024


def snapshot(source):
    files = {}
    total = 0
    for file in sorted(source.rglob("*")):
        relative = file.relative_to(source)
        if any(part in EXCLUDED or part.startswith(".env") for part in relative.parts):
            continue
        if file.is_symlink():
            raise ValueError(f"Source contains a symlink: {relative}")
        if not file.is_file():
            continue
        data = file.read_bytes()
        total += len(data)
        if total > MAX_SOURCE:
            raise ValueError("Source exceeds 32 MiB")
        files[relative.as_posix()] = data
    if "package.json" not in files:
        raise ValueError("Source requires package.json")
    return files


def source_digest(files):
    manifest = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    for character, escaped in [("&", r"\u0026"), ("<", r"\u003c"), (">", r"\u003e"), ("\u2028", r"\u2028"), ("\u2029", r"\u2029")]:
        canonical = canonical.replace(character, escaped)
    return hashlib.sha256(canonical.encode()).hexdigest()


def package_assets(directory):
    files = {}
    total = 0
    for file in sorted(directory.rglob("*")):
        if file.is_symlink():
            raise ValueError("Built assets cannot contain symlinks")
        if not file.is_file():
            continue
        data = file.read_bytes()
        total += len(data)
        if total > 24 * 1024 * 1024 or len(files) >= 512:
            raise ValueError("Built application exceeds the asset limit")
        mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        if file.suffix == ".js":
            mime = "text/javascript"
        files[file.relative_to(directory).as_posix()] = {"content": base64.b64encode(data).decode(), "media_type": mime}
    if "index.html" not in files:
        raise ValueError("Build did not produce dist/index.html")
    return files


def api_request(path, payload=None):
    server = os.environ.get("ENACT_SERVER_URL", "").rstrip("/")
    token = os.environ.get("ENACT_TOKEN", "")
    workspace = os.environ.get("ENACT_WORKSPACE_ID", "")
    parsed = urlparse(server)
    if parsed.scheme not in ("https", "http") or not parsed.netloc or not token or not workspace:
        raise ValueError("ENACT_SERVER_URL, ENACT_TOKEN and ENACT_WORKSPACE_ID are required")
    if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Remote Enact connections require HTTPS")
    request = urllib.request.Request(server + "/api/semantic" + path, data=json.dumps(payload).encode() if payload is not None else None, headers={"Content-Type": "application/json", "Authorization": "Bearer " + token, "X-Workspace-ID": workspace}, method="POST" if payload is not None else "GET")
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise ValueError("Enact API redirects are not accepted")
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=60) as response:
        raw = response.read(80 * 1024 * 1024 + 1)
        if len(raw) > 80 * 1024 * 1024:
            raise ValueError("Application response exceeds 80 MiB")
        return json.loads(raw)


def save_build(app_id, build):
    from urllib.parse import quote
    result = api_request("/apps/" + quote(app_id, safe="") + "/builds", build)
    return {key: result[key] for key in ("id", "digest", "source_revision")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--app-id", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--queries", default="@ontology")
    parser.add_argument("--actions", default="")
    parser.add_argument("--output", type=Path, default=Path.cwd())
    parser.add_argument("--save", action="store_true")
    parser.add_argument("--local", action="store_true", help="Run source explicitly trusted to execute on this machine")
    args = parser.parse_args()
    files = snapshot(args.source.resolve())
    package = json.loads(files["package.json"])
    if not package.get("scripts", {}).get("build"):
        raise ValueError("package.json requires a build script")
    commands = [["npm", "ci"] if "package-lock.json" in files else ["npm", "install", "--package-lock"]]
    if package.get("scripts", {}).get("test"):
        commands.append(["npm", "test"])
    commands.append(["npm", "run", "build"])
    logs = []
    with tempfile.TemporaryDirectory(prefix="enact-application-") as temp:
        root = Path(temp)
        for name, data in files.items():
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        for command in commands:
            if args.local:
                invocation = command
                env = {key: os.environ[key] for key in ("PATH", "SYSTEMROOT", "LANG", "TMPDIR") if key in os.environ}
                env.update({"HOME": temp, "npm_config_cache": str(root / ".npm-cache")})
            else:
                invocation = ["docker", "run", "--rm", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--read-only", "--tmpfs", "/tmp:rw,size=512m", "--memory=2g", "--cpus=2", "-e", "npm_config_cache=/tmp/npm-cache", "-v", f"{temp}:/work", "-w", "/work", "node:22-slim", *command]
                env = None
            result = subprocess.run(invocation, cwd=root, env=env, text=True, capture_output=True, timeout=600)
            logs.append({"command": command, "exit_code": result.returncode, "output": (result.stdout + result.stderr)[-16000:]})
            if result.returncode:
                raise RuntimeError(f"Build command failed: {' '.join(command)}\n{logs[-1]['output']}")
        assets = package_assets(root / "dist")
        lock = root / "package-lock.json"
        if lock.exists():
            files["package-lock.json"] = lock.read_bytes()
        build = {"source_revision": source_digest(files), "manifest": {"version": 1, "entry": "index.html", "ontology_release_id": args.release_id, "queries": [x for x in args.queries.split(",") if x], "actions": [x for x in args.actions.split(",") if x]}, "files": assets, "source_files": {name: base64.b64encode(data).decode() for name, data in files.items()}, "report": {"builder": "enact-application-building/v1", "isolation": "local-trusted" if args.local else "docker", "commands": logs, "tests_run": bool(package.get("scripts", {}).get("test"))}}
    args.output.mkdir(parents=True, exist_ok=True)
    output = args.output / "application-build.json"
    output.write_text(json.dumps(build, ensure_ascii=False, indent=2))
    print(json.dumps({"build_file": str(output.resolve()), "source_revision": build["source_revision"]}))
    if args.save:
        print(json.dumps(save_build(args.app_id, build)))


if __name__ == "__main__":
    main()
