"""HTTP surface of the code graph service (see docs/architecture/code-graph-contracts.md)."""

from __future__ import annotations

import hmac
import logging
from typing import Awaitable, Callable

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import build as build_mod
from . import queries, views
from .config import Settings, graphify_version
from .errors import ApiError
from .graphs import GraphStore
from .llm_guard import assert_no_llm_backend
from .projects import BuildLock, ProjectPaths, project_paths

log = logging.getLogger("codegraph")

SERVICE_KEY_HEADER = "x-codegraph-service-key"


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status)


def _authorize(request: Request) -> None:
    settings: Settings = request.app.state.settings
    supplied = request.headers.get(SERVICE_KEY_HEADER, "")
    if not settings.service_key or not supplied or not hmac.compare_digest(supplied, settings.service_key):
        raise ApiError(401, "unauthorized", "missing or invalid service key")


def _paths(request: Request) -> ProjectPaths:
    return project_paths(request.app.state.settings, request.path_params["key"])


async def _json_body(request: Request) -> dict:
    try:
        body = await request.json()
    except ValueError as exc:
        raise ApiError(400, "invalid_request", "body must be JSON") from exc
    if not isinstance(body, dict):
        raise ApiError(400, "invalid_request", "body must be a JSON object")
    return body


Handler = Callable[[Request], Awaitable[Response]]


def guarded(fn: Handler) -> Handler:
    async def wrapper(request: Request) -> Response:
        try:
            _authorize(request)
            return await fn(request)
        except ApiError as exc:
            return _error(exc.status, exc.code, exc.message)
        except Exception as exc:  # noqa: BLE001
            log.exception("unhandled error")
            return _error(500, "internal", str(exc)[:400])

    return wrapper


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------

async def healthz(request: Request) -> Response:
    return JSONResponse({"ok": True, "graphify_version": graphify_version()})


@guarded
async def build(request: Request) -> Response:
    settings: Settings = request.app.state.settings
    paths = _paths(request)
    req = build_mod.BuildRequest.from_json(await _json_body(request), settings)
    store: GraphStore = request.app.state.store
    result = await run_in_threadpool(
        build_mod.run_build, settings, paths, req, request.app.state.build_lock, store.warm
    )
    return JSONResponse(result)


@guarded
async def delete_project(request: Request) -> Response:
    paths = _paths(request)
    await run_in_threadpool(build_mod.delete_project, paths)
    return Response(status_code=204)


@guarded
async def status(request: Request) -> Response:
    return JSONResponse(await run_in_threadpool(views.status, _paths(request)))


@guarded
async def stats(request: Request) -> Response:
    return JSONResponse(await run_in_threadpool(views.stats, _paths(request)))


@guarded
async def report(request: Request) -> Response:
    return JSONResponse(await run_in_threadpool(views.report, _paths(request)))


@guarded
async def communities(request: Request) -> Response:
    return JSONResponse(await run_in_threadpool(views.communities_view, request.app.state.store, _paths(request)))


@guarded
async def god_nodes(request: Request) -> Response:
    top = views.parse_int(request.query_params.get("top"), 10, "top")
    return JSONResponse(
        await run_in_threadpool(views.god_nodes_view, request.app.state.store, _paths(request), min(top, 100))
    )


@guarded
async def graph(request: Request) -> Response:
    store: GraphStore = request.app.state.store
    paths = _paths(request)
    q = request.query_params
    if q.get("level") == "community":
        limit = views.parse_limit(q.get("limit"), views.COMMUNITY_LEVEL_DEFAULT_LIMIT)
        return JSONResponse(await run_in_threadpool(views.community_meta_view, store, paths, limit))
    limit = views.parse_limit(q.get("limit"))
    if q.get("community") not in (None, ""):
        cid = views.parse_int(q.get("community"), 0, "community", minimum=0)
        return JSONResponse(await run_in_threadpool(views.community_subgraph_view, store, paths, cid, limit))
    if q.get("focus"):
        depth = views.parse_int(q.get("depth"), 2, "depth")
        return JSONResponse(
            await run_in_threadpool(views.focus_view, store, paths, q["focus"], min(depth, 6), limit)
        )
    raise ApiError(400, "invalid_request", "specify level=community, community=<id> or focus=<node>")


@guarded
async def tree(request: Request) -> Response:
    max_children = views.parse_int(request.query_params.get("max_children"), views.DEFAULT_TREE_MAX_CHILDREN, "max_children")
    return JSONResponse(await run_in_threadpool(views.tree_view, _paths(request), min(max_children, 2000)))


@guarded
async def callflow(request: Request) -> Response:
    lang = request.query_params.get("lang", "auto")
    return JSONResponse(await run_in_threadpool(views.callflow_view, _paths(request), lang))


@guarded
async def wiki(request: Request) -> Response:
    return JSONResponse(await run_in_threadpool(views.wiki_index, request.app.state.store, _paths(request)))


@guarded
async def wiki_article(request: Request) -> Response:
    return JSONResponse(await run_in_threadpool(views.wiki_article, _paths(request), request.path_params["slug"]))


def _query_route(fn):
    @guarded
    async def handler(request: Request) -> Response:
        body = await _json_body(request)
        return JSONResponse(await run_in_threadpool(fn, request.app.state.store, _paths(request), body))

    return handler


def create_app(settings: Settings | None = None, *, check_llm: bool = False) -> Starlette:
    settings = settings or Settings.from_env()
    if check_llm:
        assert_no_llm_backend()
    p = "/v1/projects/{key}"
    routes = [
        Route("/healthz", healthz, methods=["GET"]),
        Route(f"{p}/build", build, methods=["POST"]),
        Route(p, delete_project, methods=["DELETE"]),
        Route(f"{p}/status", status, methods=["GET"]),
        Route(f"{p}/stats", stats, methods=["GET"]),
        Route(f"{p}/report", report, methods=["GET"]),
        Route(f"{p}/communities", communities, methods=["GET"]),
        Route(f"{p}/god-nodes", god_nodes, methods=["GET"]),
        Route(f"{p}/graph", graph, methods=["GET"]),
        Route(f"{p}/tree", tree, methods=["GET"]),
        Route(f"{p}/callflow", callflow, methods=["GET"]),
        Route(f"{p}/wiki", wiki, methods=["GET"]),
        Route(f"{p}/wiki/{{slug}}", wiki_article, methods=["GET"]),
        Route(f"{p}/query", _query_route(queries.query), methods=["POST"]),
        Route(f"{p}/path", _query_route(queries.path), methods=["POST"]),
        Route(f"{p}/explain", _query_route(queries.explain), methods=["POST"]),
        Route(f"{p}/affected", _query_route(queries.affected), methods=["POST"]),
    ]
    app = Starlette(routes=routes)
    app.state.settings = settings
    app.state.build_lock = BuildLock()
    app.state.store = GraphStore(settings.max_contexts)
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    if not settings.service_key:
        log.warning("CODEGRAPH_SERVICE_KEY is empty; every request except /healthz will be refused")
    return app


def production_app() -> Starlette:
    """uvicorn factory: `uvicorn enact_codegraph.app:production_app --factory`.

    Asserts at startup that graphify cannot select any LLM backend in this
    environment before serving a single request.
    """
    logging.basicConfig(level=logging.INFO)
    return create_app(check_llm=True)
