"""Authenticated Enact draft adapter; no direct Semantica service credentials.

The adapter reads immutable revision documents and records server-side previews
outside those directories. Cypher generation and existing machine gates retain
their original contracts. Draft evaluations never execute operational actions.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "shared" / "lib"))
import yamlio  # noqa: E402


class AdapterUnavailable(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class SemanticGraphAdapter:
    def __init__(self, environ=None, timeout=30):
        env = os.environ if environ is None else environ
        self.base = env.get("ENACT_SERVER_URL", "").rstrip("/")
        self.token = env.get("ENACT_TOKEN", "")
        self.workspace_id = env.get("ENACT_WORKSPACE_ID", "")
        if not self.base or not self.token or not self.workspace_id:
            raise AdapterUnavailable("Enact task URL, token and workspace are not configured; graph-answer tests remain unsupported")
        url = urlsplit(self.base)
        if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise AdapterUnavailable("ENACT_SERVER_URL must be an HTTP(S) base URL without embedded credentials")
        self.headers = {"Authorization": "Bearer " + self.token, "X-Workspace-ID": self.workspace_id,
                        "Content-Type": "application/json", "Accept": "application/json"}
        for name, header in (("ENACT_AGENT_ID", "X-Agent-ID"), ("ENACT_TASK_ID", "X-Task-ID")):
            if env.get(name):
                self.headers[header] = env[name]
        self.timeout = timeout
        self.opener = build_opener(NoRedirect())

    def _request(self, method, suffix, payload=None):
        request = Request(self.base + "/api/semantic/ontologies" + suffix,
                          data=None if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode(),
                          headers=self.headers, method=method)
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                body = response.read(12 * 1024 * 1024 + 1)
                if len(body) > 12 * 1024 * 1024:
                    raise AdapterUnavailable("Enact semantic preview exceeded the response limit")
                return json.loads(body)
        except HTTPError as exc:
            raise AdapterUnavailable("Enact semantic preview returned HTTP " + str(exc.code)) from None
        except (OSError, URLError, ValueError):
            raise AdapterUnavailable("Enact semantic preview did not return a complete JSON result") from None

    def available(self):
        try:
            self._request("GET", "")
            return True
        except AdapterUnavailable:
            return False

    def save_revision(self, workspace, revision, ontology_id=None):
        if not re.fullmatch(r"r\d{4,}", revision):
            raise ValueError("revision must be a stable rNNNN identifier")
        directory = Path(workspace).resolve() / "revisions" / revision
        if not directory.is_dir():
            raise ValueError("Requested revision directory does not exist")
        document = yamlio.load_path(directory / "candidate.yaml")
        if not isinstance(document, dict) or not isinstance(document.get("bundle"), dict):
            raise ValueError("candidate.yaml must retain its bundle wrapper")
        # Keep evidence/process/alignment as siblings, never inside declarations.
        envelope = dict(document)
        for field, filename in (("process", "process_ir.yaml"), ("evidence", "evidential_ir.yaml"), ("alignment", "alignment.yaml")):
            path = directory / filename
            if not path.is_file():
                raise ValueError("The selected revision is missing " + filename)
            envelope[field] = yamlio.load_path(path)
        payload = {"name": document["bundle"].get("domain", {}).get("name", revision), "bundle": envelope}
        suffix = "/" + quote(ontology_id, safe="") if ontology_id else ""
        return self._request("PUT" if ontology_id else "POST", suffix, payload)

    def preview(self, ontology_id, data=None):
        return self._request("POST", "/" + quote(ontology_id, safe="") + "/preview", {"test_data": data or {}})

    def answer(self, ontology_id, query, data=None):
        return self._request("POST", "/" + quote(ontology_id, safe="") + "/query", {"query": query, "data": data or {}})

    def evaluate(self, ontology_id, facts):
        return self._request("POST", "/" + quote(ontology_id, safe="") + "/evaluate", {"facts": facts})

    def graph(self, ontology_id):
        return self._request("POST", "/" + quote(ontology_id, safe="") + "/graph", {})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("available")
    save = commands.add_parser("save")
    save.add_argument("workspace")
    save.add_argument("revision")
    save.add_argument("--ontology-id")
    for name in ("preview", "query", "evaluate", "graph"):
        command = commands.add_parser(name)
        command.add_argument("ontology_id")
        if name in {"preview", "query"}:
            command.add_argument("--data-file")
        if name == "query":
            command.add_argument("--query-file", required=True)
        if name == "evaluate":
            command.add_argument("--facts-file", required=True)
    args = parser.parse_args(argv)
    try:
        adapter = SemanticGraphAdapter()
        def json_file(path):
            return json.loads(Path(path).read_text(encoding="utf-8")) if path else {}
        if args.command == "available":
            result = {"available": adapter.available()}
        elif args.command == "save":
            result = adapter.save_revision(args.workspace, args.revision, args.ontology_id)
        elif args.command == "preview":
            result = adapter.preview(args.ontology_id, json_file(args.data_file))
        elif args.command == "query":
            result = adapter.answer(args.ontology_id, Path(args.query_file).read_text(encoding="utf-8"), json_file(args.data_file))
        elif args.command == "evaluate":
            result = adapter.evaluate(args.ontology_id, json_file(args.facts_file))
        else:
            result = adapter.graph(args.ontology_id)
        # Mask an echoed task token even if an unexpected upstream body contains it.
        output = json.dumps(result, ensure_ascii=False, indent=2)
        print(output.replace(adapter.token, "[redacted]"))
        return 0
    except (AdapterUnavailable, OSError, ValueError) as exc:
        token = os.environ.get("ENACT_TOKEN", "")
        error = str(exc).replace(token, "[redacted]") if token else str(exc)
        print(json.dumps({"status": "unsupported", "error": error}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
