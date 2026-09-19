# Enact code graph service. Builds graphify code graphs for workspace
# repositories and serves read models + agent queries over HTTP.
#
# Build:  docker build -t enact-codegraph services/codegraph
# Run:    docker run -p 8767:8767 -v codegraph_state:/data \
#             -e CODEGRAPH_SERVICE_KEY=... enact-codegraph
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml README.md ./
COPY enact_codegraph ./enact_codegraph
RUN pip install --no-cache-dir .

RUN useradd --create-home --uid 10001 codegraph \
 && mkdir -p /data \
 && chown codegraph:codegraph /data
USER codegraph

# graphify would otherwise write a vis.js graph.html on every rebuild; Enact
# renders the graph itself. GRAPHIFY_NO_BACKUP skips the dated backup/ copies
# that would double the volume footprint per build.
ENV GRAPHIFY_VIZ_NODE_LIMIT=0 \
    GRAPHIFY_NO_BACKUP=1 \
    CODEGRAPH_DATA_DIR=/data \
    PYTHONUNBUFFERED=1

EXPOSE 8767
CMD ["uvicorn", "enact_codegraph.app:production_app", "--factory", "--host", "0.0.0.0", "--port", "8767"]
