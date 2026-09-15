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


ACTION_CONFLICT_DIAGNOSTICS = {
    "action evidence is older than five minutes; refresh the queries and review the updated action": (
        "action_evidence_stale",
        {"prepare", "execute"},
        "The stored action evidence is older than five minutes. Do not execute this approval. Re-run the exact required data queries with the same business parameters, evaluate the applicable Policy from the new query step IDs, prepare the replacement action with the exact parameters, and obtain a new human review before execute.",
    ),
    "action review was superseded by refreshed evidence": (
        "action_review_superseded",
        {"decide", "execute"},
        "This action review was replaced by a draft based on newer evidence. Do not decide or execute the old approval. Read the scoped run to locate the current approval, inspect its parameters and Policy evaluation, and continue only from that current review.",
    ),
    "action review expired; prepare a current action": (
        "action_review_expired",
        {"decide"},
        "This action review expired. Re-run the required queries, evaluate the applicable Policy, prepare a current action with the exact parameters, and obtain a new human review.",
    ),
    "action is not approved or its approval expired": (
        "action_review_not_current",
        {"execute"},
        "This action has no current approval. Do not retry execute. Read the scoped run and receipt state; if no receipt exists, refresh the required queries and Policy evaluation, prepare a current action, and obtain a new human review.",
    ),
    "action configuration or credential changed; prepare and authorize again": (
        "action_configuration_changed",
        {"execute"},
        "The reviewed action no longer matches the current connection configuration or credential revision. Do not retry execute. Re-query through the current bindings, evaluate the applicable Policy, prepare the exact action again, and obtain a new human review.",
    ),
}


def _action_conflict_stage(method, path):
    if method != "POST" or "?" in path or "#" in path:
        return None
    parts = path.split("/")
    if len(parts) != 6 or parts[1:3] != ["api", "semantic"] or not parts[4]:
        return None
    if parts[3] == "runs" and parts[5] == "actions":
        return "prepare"
    if parts[3] == "approvals" and parts[5] in {"decide", "execute"}:
        return parts[5]
    return None


def safe_action_conflict(raw, method, path):
    # Only exact server-owned action conflicts become static recovery guidance.
    if len(raw) > 64 * 1024:
        return None
    stage = _action_conflict_stage(method, path)
    if stage is None:
        return None
    try:
        payload = json.loads(raw)
        error = payload.get("error") if isinstance(payload, dict) else None
        known = ACTION_CONFLICT_DIAGNOSTICS.get(error) if isinstance(error, str) else None
        if known is None or stage not in known[1]:
            return None
        return "[" + known[0] + "] " + known[2]
    except (ValueError, UnicodeError, RecursionError):
        return None


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
        path_without_query, separator, query = path.partition("?")
        report_format_allowed = (
            method == "GET"
            and separator == "?"
            and query in {"format=html", "format=jsonl"}
            and path_without_query.startswith("/api/semantic/runs/")
            and path_without_query.endswith("/report")
            and len(path_without_query.split("/")) == 6
            and bool(path_without_query.split("/")[4])
        )
        if (
            not path.startswith("/api/semantic/")
            or ".." in path
            or (separator and not report_format_allowed)
            or "#" in path
        ):
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
                if report_format_allowed:
                    return raw.decode("utf-8")
                return json.loads(raw)
        except HTTPError as exc:
            message = "Enact semantic request failed with HTTP " + str(exc.code)
            try:
                raw = exc.read(64 * 1024 + 1)
                diagnostic = safe_action_conflict(raw, method, path) if exc.code == 409 else safe_native_diagnostic(raw, path)
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


def action_review_summary(run, approval_id):
    """Return only the current action review inputs and freshness metadata."""
    if not isinstance(run, dict) or not isinstance(run.get("approvals"), list):
        raise SemanticClientError("Enact returned an invalid scoped run")
    approval = next((item for item in run["approvals"] if isinstance(item, dict) and item.get("id") == approval_id), None)
    if approval is None:
        raise SemanticClientError("The approval is not present in the scoped run")

    allowed_approval = (
        "id", "status", "binding_id", "parameters", "evaluation_step_id", "created_at", "expires_at",
        "supersedes_approval_id", "superseded_by",
    )
    summary = {
        "run_id": run.get("id"),
        "approval": {key: approval.get(key) for key in allowed_approval},
    }
    steps = run.get("steps") if isinstance(run.get("steps"), list) else []
    evaluation_id = approval.get("evaluation_step_id")
    evaluation = next((item for item in steps if isinstance(item, dict) and item.get("id") == evaluation_id), None)
    source_ids = []
    if evaluation is not None:
        evaluation_input = evaluation.get("input") if isinstance(evaluation.get("input"), dict) else {}
        source_ids = evaluation_input.get("source_step_ids") if isinstance(evaluation_input.get("source_step_ids"), list) else []
        evaluation_output = evaluation.get("output") if isinstance(evaluation.get("output"), dict) else {}
        summary["policy_evaluation"] = {
            "id": evaluation.get("id"),
            "status": evaluation.get("status"),
            "created_at": evaluation.get("created_at"),
            "finished_at": evaluation.get("finished_at"),
            "source_step_ids": source_ids,
            "decision": evaluation_output.get("decision"),
            "reason": evaluation_output.get("reason"),
        }
    else:
        summary["policy_evaluation"] = None

    source_set = {value for value in source_ids if isinstance(value, str)}
    summary["source_queries"] = [
        {
            "id": item.get("id"),
            "binding_id": item.get("input", {}).get("binding_id") if isinstance(item.get("input"), dict) else None,
            "parameters": item.get("input", {}).get("parameters") if isinstance(item.get("input"), dict) else None,
            "status": item.get("status"),
            "created_at": item.get("created_at"),
            "finished_at": item.get("finished_at"),
        }
        for item in steps
        if isinstance(item, dict) and item.get("id") in source_set and item.get("kind") == "data_query"
    ]
    receipts = run.get("receipts") if isinstance(run.get("receipts"), list) else []
    summary["receipts"] = [
        {key: item.get(key) for key in ("id", "status", "created_at", "updated_at")}
        for item in receipts
        if isinstance(item, dict) and item.get("approval_id") == approval_id
    ]
    return summary


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
    review = commands.add_parser("review", help="Read one action review without printing the full run or source results")
    review.add_argument("run_id")
    review.add_argument("approval_id")
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
        elif command == "review":
            run = client.request("GET", "/api/semantic/runs/" + _id(args.run_id))
            result = action_review_summary(run, args.approval_id)
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
        redacted = redact(result, client.token)
        if isinstance(redacted, str):
            print(redacted, end="" if redacted.endswith("\n") else "\n")
        else:
            print(json.dumps(redacted, ensure_ascii=False, indent=2))
        return 0
    except (SemanticClientError, OSError, ValueError) as exc:
        # Configuration tokens are never accepted on argv or printed in errors.
        print(json.dumps({"error": redact(str(exc), os.environ.get("ENACT_TOKEN", ""))}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
