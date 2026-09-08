#!/usr/bin/env python3
"""Enact semantic API client for an injected agent task; standard library only."""

import argparse
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class SemanticClientError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward task credentials to a redirect target.
        return None


def redact(value, token=""):
    sensitive = {"authorization", "token", "password", "api_key", "client_secret", "secret"}
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            # Binding authorization is a typed business policy, not an HTTP
            # credential. Preserve it so a draft GET/PUT remains lossless.
            binding_policy = (
                str(key).lower() == "authorization"
                and isinstance(value.get("id"), str)
                and isinstance(value.get("connection_id"), str)
                and isinstance(item, dict)
                and set(item).issubset({"mode", "roles"})
                and item.get("mode", "") in ("", "allow", "confirm", "role")
                and isinstance(item.get("roles", []), list)
                and all(isinstance(role, str) for role in item.get("roles", []))
            )
            result[key] = redact(item, token) if binding_policy or str(key).lower() not in sensitive else "[redacted]"
        return result
    if isinstance(value, list):
        return [redact(item, token) for item in value]
    if isinstance(value, str) and token:
        return value.replace(token, "[redacted]")
    return value


NATIVE_DIAGNOSTICS = {
    'native_undeclared_entity_property': ('export', 'An extracted entity property is absent from ontology.properties. Declare its property name/IRI and datatype or object range, or move extraction-only annotations into metadata. Preserve source anchors and replay completed model operations after repairing the schema.'),
    'native_invalid_property_value': ('export', 'An entity property value does not match its declared datatype or object range. Use a scalar or typed literal for datatype properties and a stable entity ID or IRI for object properties; then replay completed extraction results.'),
    'native_source_snapshot_mismatch': ('parse', 'Source IDs and hashes must match the selected immutable snapshots. Reload the scoped snapshot documents and preserve their original content, IDs and hashes.'),
    'native_extraction_source_mismatch': ('semantic_extract', 'Extraction evidence does not match the selected source text. Use an existing source ID and exact quote/start/end offsets; resolve ambiguous mentions without inventing source text. Replay completed model results when available.'),
    'native_extraction_entity_identity': ('semantic_extract', 'Extracted entities need unique stable IDs. Resolve duplicate or missing IDs and update every relationship endpoint consistently before rebuilding.'),
    'native_extraction_relationship_endpoint': ('semantic_extract', 'A relationship references an entity absent from the extraction. Match source and target IDs to extracted entities supported by the same source evidence.'),
    'native_rule_contract': ('reasoning', 'Native rules need unique IDs, safe predicate atoms and variables bound by their premises. Action intents must reference an existing action binding and use only bound proof variables.'),
    'native_model_operation_pending': ('semantic_extract', 'A model operation is still running. Inspect its existing operation ID in the construction record; wait for completion and replay the completed result instead of submitting another model call.'),
    'native_model_operation_failed': ('semantic_extract', 'The assigned model operation did not complete successfully. Inspect its recorded status and repair the runtime or extraction request before retrying; reuse any completed operations.'),
    'native_replay_mismatch': ('semantic_extract', 'Replay must use authorized completed operation IDs with the original source selection, extraction prompt and schema. Omit supplied extractions and keep the selected document/chunk scope unchanged.'),
    'native_service_unavailable': ('pipeline', 'The native semantic service is unavailable or unconfigured. Restore the configured service before retrying and check existing model operations before starting new extraction.'),
    'native_build_failed': ('pipeline', 'The native build failed without a recognized safe diagnostic. Inspect the construction findings and completed model operations. Repair the request before retrying; no ontology revision was saved.'),
}


def safe_native_diagnostic(raw, path):
    # Accept only native-build diagnostics, and never trust a response message.
    if len(raw) > 64 * 1024 or not path.startswith("/api/semantic/ontologies/") or not path.endswith("/native") or len(path.split("/")) != 6:
        return None
    try:
        payload = json.loads(raw)
        diagnostic = payload.get("diagnostic") if isinstance(payload, dict) else None
        if not isinstance(diagnostic, dict) or not isinstance(diagnostic.get("code"), str):
            return None
        known = NATIVE_DIAGNOSTICS.get(diagnostic["code"])
        if known is None or diagnostic.get("stage") != known[0]:
            return None
        return "[" + diagnostic["code"] + " at " + known[0] + "] " + known[1]
    except (ValueError, UnicodeError, RecursionError):
        return None


class Client:
    def __init__(self, environ=None, timeout=30):
        env = os.environ if environ is None else environ
        self.url = env.get("ENACT_SERVER_URL", "").rstrip("/")
        self.token = env.get("ENACT_TOKEN", "")
        self.workspace_id = env.get("ENACT_WORKSPACE_ID", "")
        if not self.url or not self.token or not self.workspace_id:
            raise SemanticClientError("ENACT_SERVER_URL, ENACT_TOKEN and ENACT_WORKSPACE_ID must be injected by the Enact task")
        parsed = urlsplit(self.url)
        if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise SemanticClientError("ENACT_SERVER_URL must be an HTTP(S) server base URL without credentials, query or fragment")
        self.timeout = timeout
        self.headers = {"Authorization": "Bearer " + self.token, "X-Workspace-ID": self.workspace_id,
                        "Accept": "application/json", "Content-Type": "application/json"}
        for env_name, header in (("ENACT_AGENT_ID", "X-Agent-ID"), ("ENACT_TASK_ID", "X-Task-ID")):
            if env.get(env_name):
                self.headers[header] = env[env_name]
        self.opener = build_opener(NoRedirect())

    def request(self, method, path, payload=None, *, idempotency_key=None):
        if not path.startswith("/api/semantic/") or ".." in path or "?" in path or "#" in path:
            raise SemanticClientError("Only Enact semantic API paths are accepted")
        body = None if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        headers = dict(self.headers)
        if idempotency_key is not None:
            if not idempotency_key.strip() or len(idempotency_key) > 200 or any(char in idempotency_key for char in "\r\n"):
                raise SemanticClientError("An idempotency key must contain 1 to 200 characters without newlines")
            headers["Idempotency-Key"] = idempotency_key
        request = Request(self.url + path, data=body, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(12 * 1024 * 1024 + 1)
                if len(raw) > 12 * 1024 * 1024:
                    raise SemanticClientError("Enact response exceeds the 12 MB limit")
                return json.loads(raw)
        except HTTPError as exc:
            message = "Enact semantic request failed with HTTP " + str(exc.code)
            try:
                diagnostic = safe_native_diagnostic(exc.read(64 * 1024 + 1), path)
                if diagnostic:
                    message += " " + diagnostic
            except (OSError, ValueError):
                pass
            # Arbitrary bodies and server-supplied diagnostic messages stay hidden.
            raise SemanticClientError(message) from None
        except (URLError, TimeoutError, OSError):
            raise SemanticClientError("Enact request did not complete; inspect the existing run or receipt before retrying an action") from None
        except (ValueError, UnicodeError):
            raise SemanticClientError("Enact returned an invalid JSON response") from None


def _file(path):
    if not path:
        return {}
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _id(value):
    return quote(value, safe="")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    call = commands.add_parser("call", help="Call a scoped semantic API endpoint")
    call.add_argument("method", choices=("GET", "POST", "PUT"))
    call.add_argument("path")
    call.add_argument("--body-file")
    call.add_argument("--timeout", type=int, default=600)
    commands.add_parser("ontologies")
    for name in ("ontology", "releases", "run", "receipt", "reconcile"):
        commands.add_parser(name).add_argument("id")
    create = commands.add_parser("start")
    create.add_argument("--release-id", required=True)
    create.add_argument("--question", required=True)
    create.add_argument("--issue-id")
    query = commands.add_parser("query")
    query.add_argument("run_id")
    source = query.add_mutually_exclusive_group(required=True)
    source.add_argument("--binding-id")
    source.add_argument("--sparql-file")
    query.add_argument("--params-file")
    evaluate = commands.add_parser("evaluate")
    evaluate.add_argument("run_id")
    evaluate.add_argument("--source-step", action="append", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("run_id")
    prepare.add_argument("--binding-id", required=True)
    prepare.add_argument("--params-file", required=True)
    prepare.add_argument("--evaluation-step-id")
    prepare.add_argument("--intent-id")
    execute = commands.add_parser("execute")
    execute.add_argument("approval_id")
    execute.add_argument("--idempotency-key", required=True)
    args = parser.parse_args(argv)
    try:
        client = Client()
        command = args.command
        if command == "call":
            client.timeout = max(1, min(args.timeout, 660))
            result = client.request(args.method, args.path, _file(args.body_file) if args.method != "GET" else None)
        elif command == "ontologies":
            result = client.request("GET", "/api/semantic/ontologies")
        elif command in {"ontology", "releases"}:
            path = "/api/semantic/ontologies/" + _id(args.id)
            result = client.request("GET", path + ("/releases" if command == "releases" else ""))
        elif command == "run":
            result = client.request("GET", "/api/semantic/runs/" + _id(args.id))
        elif command in {"receipt", "reconcile"}:
            path = "/api/semantic/receipts/" + _id(args.id)
            result = client.request("POST" if command == "reconcile" else "GET", path + ("/reconcile" if command == "reconcile" else ""))
        elif command == "start":
            payload = {"release_id": args.release_id, "question": args.question}
            issue_id = args.issue_id or os.environ.get("ENACT_ISSUE_ID")
            if issue_id:
                payload["issue_id"] = issue_id
            result = client.request("POST", "/api/semantic/runs", payload)
        elif command == "query":
            payload = {"binding_id": args.binding_id, "parameters": _file(args.params_file)} if args.binding_id else {"query": Path(args.sparql_file).read_text(encoding="utf-8")}
            result = client.request("POST", "/api/semantic/runs/" + _id(args.run_id) + "/query", payload)
        elif command == "evaluate":
            result = client.request("POST", "/api/semantic/runs/" + _id(args.run_id) + "/evaluate", {"source_step_ids": args.source_step})
        elif command == "prepare":
            payload = {"binding_id": args.binding_id, "parameters": _file(args.params_file)}
            if args.evaluation_step_id or args.intent_id:
                if not args.evaluation_step_id or not args.intent_id:
                    raise SemanticClientError("Both evaluation-step-id and intent-id are required for a rule-derived action")
                payload.update(evaluation_step_id=args.evaluation_step_id, intent_id=args.intent_id)
            result = client.request("POST", "/api/semantic/runs/" + _id(args.run_id) + "/actions", payload)
        else:
            result = client.request("POST", "/api/semantic/approvals/" + _id(args.approval_id) + "/execute", {}, idempotency_key=args.idempotency_key)
        print(json.dumps(redact(result, client.token), ensure_ascii=False, indent=2))
        return 0
    except (SemanticClientError, OSError, ValueError) as exc:
        # Configuration tokens are never accepted on argv or printed in errors.
        print(json.dumps({"error": redact(str(exc), os.environ.get("ENACT_TOKEN", ""))}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
