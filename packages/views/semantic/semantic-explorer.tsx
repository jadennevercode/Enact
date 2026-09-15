"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Focus,
  GitBranch,
  Layers,
  List,
  Minus,
  Network,
  Pause,
  Play,
  Plus,
  Route,
  Search,
  X,
} from "lucide-react";
import type {
  SemanticGraph,
  SemanticGraphNode,
  SemanticGraphEdge,
} from "@enact/core/semantic";
import { Button } from "@enact/ui/components/ui/button";
import { Input } from "@enact/ui/components/ui/input";
import {
  nodeDescription,
  nodeLabel,
  nodeLayer,
  nodeSourceEvidence,
} from "./graph-presentation";
import { GraphCanvas, type GraphCanvasControls } from "./explorer/graph-canvas";
import {
  directedPath,
  graphologyGraph,
  groupedGraph,
  neighborhoodDistances,
} from "./explorer/graph-scene";
import { useSemanticText } from "./shared";

const emptyGraph: SemanticGraph = { nodes: [], edges: [] };
export function SemanticExplorer({
  graph = emptyGraph,
  onSelectNode,
  compact = false,
}: {
  graph?: SemanticGraph;
  onSelectNode?: (node: SemanticGraphNode | undefined) => void;
  compact?: boolean;
}) {
  const t = useSemanticText(),
    controls = useRef<GraphCanvasControls | null>(null);
  const [selected, setSelected] = useState<SemanticGraphNode>(),
    [selectedEdge, setSelectedEdge] = useState<SemanticGraphEdge>(),
    [search, setSearch] = useState("");
  const [mode, setMode] = useState<"full" | "grouped" | "focused">("full"),
    [kind, setKind] = useState("all"),
    [depth, setDepth] = useState(1),
    [layer, setLayer] = useState("auto");
  const [list, setList] = useState(false),
    [unavailable, setUnavailable] = useState(false),
    [layoutRunning, setLayoutRunning] = useState(false),
    [heatmap, setHeatmap] = useState(false),
    [target, setTarget] = useState("");
  const onSelectRef = useRef(onSelectNode);
  onSelectRef.current = onSelectNode;
  const business = graph.projection === "business",
    nativeSchema = graph.nodes.some((n) => n.layer === "schema");
  const activeLayer =
    layer === "auto"
      ? business
        ? "all"
        : nativeSchema
          ? "ontologyLayer"
          : "all"
      : layer;
  const layers = useMemo(
    () => [...new Set(graph.nodes.map(nodeLayer))],
    [graph],
  );
  const filtered = useMemo<SemanticGraph>(() => {
    const nodes = graph.nodes.filter(
      (n) =>
        (activeLayer === "all" || nodeLayer(n) === activeLayer) &&
        (kind === "all" || n.kind === kind),
    );
    const ids = new Set(nodes.map((n) => n.id));
    return {
      ...graph,
      nodes,
      edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    };
  }, [graph, activeLayer, kind]);
  const dataGraph = useMemo(() => graphologyGraph(filtered), [filtered]);
  const distances = useMemo(
    () =>
      selected
        ? neighborhoodDistances(dataGraph, selected.id)
        : new Map<string, number>(),
    [dataGraph, selected],
  );
  const path = useMemo(
    () =>
      selected && target ? directedPath(dataGraph, selected.id, target) : [],
    [dataGraph, selected, target],
  );
  const grouped = useMemo(
    () => (mode === "grouped" ? groupedGraph(filtered) : filtered),
    [filtered, mode],
  );
  const display = useMemo<SemanticGraph>(() => {
    if (mode === "grouped") return grouped;
    if (mode !== "focused" || !selected || selected.kind === "group")
      return filtered;
    const nodes = filtered.nodes.filter(
        (n) => (distances.get(n.id) ?? Infinity) <= depth,
      ),
      ids = new Set(nodes.map((n) => n.id));
    return {
      ...filtered,
      nodes,
      edges: filtered.edges.filter(
        (e) => ids.has(e.source) && ids.has(e.target),
      ),
    };
  }, [filtered, grouped, mode, selected, distances, depth]);
  const boundedDisplay = useMemo<SemanticGraph>(() => {
    if (display.nodes.length <= 500 && display.edges.length <= 1500)
      return display;
    const priority = new Set([...(selected ? [selected.id] : []), ...path]);
    const ordered = [
      ...display.nodes.filter((n) => priority.has(n.id)),
      ...display.nodes.filter((n) => !priority.has(n.id)),
    ];
    const nodes = ordered.slice(0, 500),
      ids = new Set(nodes.map((n) => n.id));
    const edges = display.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .slice(0, 1500);
    return {
      ...display,
      nodes,
      edges,
      truncated:
        display.truncated === true ||
        nodes.length < display.nodes.length ||
        edges.length < display.edges.length,
    };
  }, [display, selected, path]);
  const matches = filtered.nodes.filter((n) =>
    `${nodeLabel(n)} ${nodeDescription(n)} ${Array.isArray(n.metadata.aliases) ? n.metadata.aliases.join(" ") : ""}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  const selectedMembers = Array.isArray(selected?.metadata.members)
    ? selected.metadata.members.filter(
        (id): id is string => typeof id === "string",
      )
    : [];
  const label = (id: string) => {
    const node = graph.nodes.find((n) => n.id === id);
    return node ? nodeLabel(node) : id;
  };
  const kindLabel = (node: SemanticGraphNode) =>
    t(
      node.kind === "entity" || node.kind === "class"
        ? "graphEntities"
        : node.kind === "action"
          ? "graphActions"
          : node.kind === "policy"
            ? "graphPolicies"
            : node.kind === "group"
              ? "graphGrouped"
              : "graphProperties",
    );
  const clear = useCallback(() => {
    setSelected(undefined);
    setSelectedEdge(undefined);
    setTarget("");
    onSelectRef.current?.(undefined);
  }, []);
  function select(node?: SemanticGraphNode) {
    setSelected(node);
    setSelectedEdge(undefined);
    setTarget("");
    onSelectNode?.(node?.kind === "group" ? undefined : node);
  }
  function focus(node: SemanticGraphNode) {
    setMode("full");
    select(node);
    requestAnimationFrame(() => controls.current?.focus(node.id));
  }
  useEffect(() => {
    clear();
    setMode("full");
  }, [graph, clear]);
  useEffect(() => {
    if (!layoutRunning) return;
    const timer = setTimeout(() => setLayoutRunning(false), 8000);
    return () => clearTimeout(timer);
  }, [layoutRunning]);
  const evidence = selected && nodeSourceEvidence(selected);
  const relationshipEdges = selected
    ? graph.edges.filter(
        (e) => e.source === selected.id || e.target === selected.id,
      )
    : [];
  return (
    <section
      className="overflow-hidden rounded-2xl border border-border-soft bg-surface"
      aria-label={t(business ? "businessGraph" : "exploreGraph")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft p-4">
        <div className="relative min-w-44 flex-1 lg:max-w-sm">
          <Search
            className="absolute left-3 top-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="min-h-11 pl-10"
            aria-label={t("searchGraph")}
            placeholder={t("searchGraph")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1" aria-label={t("businessGraph")}>
          {(
            [
              { value: "full", label: "graphFull", icon: Layers },
              { value: "grouped", label: "graphGrouped", icon: GitBranch },
              { value: "focused", label: "graphFocused", icon: Focus },
            ] as const
          ).map((item) => (
            <Button
              key={item.value}
              variant={mode === item.value ? "secondary" : "ghost"}
              className="min-h-11"
              aria-pressed={mode === item.value}
              disabled={
                item.value === "focused" &&
                (!selected || selected.kind === "group")
              }
              onClick={() => {
                setMode(item.value);
                setTarget("");
              }}
            >
              <item.icon className="size-4" aria-hidden="true" />
              {t(item.label)}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border-soft px-4 py-3">
        <label className="flex items-center gap-2 text-caption text-muted-foreground">
          {t(business ? "graphKinds" : "allLayers")}
          <select
            className="min-h-11 rounded-lg border border-border-soft bg-background px-3 text-body text-foreground"
            value={business ? kind : activeLayer}
            onChange={(e) => {
              clear();
              setMode("full");
              if (business) setKind(e.target.value);
              else setLayer(e.target.value);
            }}
          >
            <option value="all">
              {t(business ? "graphAllKinds" : "allLayers")}
            </option>
            {business
              ? (
                  [
                    ["entity", "graphEntities"],
                    ["action", "graphActions"],
                    ["policy", "graphPolicies"],
                  ] as const
                ).map(([value, key]) => (
                  <option key={value} value={value}>
                    {t(key)}
                  </option>
                ))
              : layers.map((value) => (
                  <option key={value} value={value}>
                    {t(value)}
                  </option>
                ))}
          </select>
        </label>
        {mode === "focused" && (
          <label className="flex items-center gap-2 text-caption text-muted-foreground">
            {t("graphDepth")}
            <select
              className="min-h-11 rounded-lg border bg-background px-3 text-body"
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          variant={heatmap ? "secondary" : "ghost"}
          className="min-h-11"
          disabled={!selected || selected.kind === "group"}
          aria-pressed={heatmap}
          onClick={() => setHeatmap((v) => !v)}
        >
          {t("graphHeatmap")}
        </Button>
        <Button
          variant="ghost"
          className="min-h-11"
          onClick={() => setLayoutRunning((v) => !v)}
        >
          {layoutRunning ? (
            <Pause className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
          {t(layoutRunning ? "graphPauseLayout" : "graphRunLayout")}
        </Button>
        <Button
          variant={list ? "secondary" : "ghost"}
          className="ml-auto min-h-11"
          aria-pressed={list}
          onClick={() => setList((v) => !v)}
        >
          <List className="size-4" aria-hidden="true" />
          {t("graphList")}
        </Button>
      </div>
      {boundedDisplay.truncated === true && (
        <p
          className="border-b border-warning/30 bg-warning/5 px-4 py-3 text-caption"
          role="status"
        >
          {t("graphPartial")} · {boundedDisplay.nodes.length} /{" "}
          {filtered.nodes.length} {t("graphNodes")}. {t("graphPartialHelp")}
        </p>
      )}
      <div
        className={`grid ${compact ? "lg:grid-cols-[minmax(0,1fr)_280px]" : "xl:grid-cols-[minmax(0,1fr)_340px]"}`}
      >
        <div className="relative min-w-0 bg-background [background-image:radial-gradient(var(--border-soft)_1px,transparent_1px)] [background-size:24px_24px]">
          <GraphCanvas
            graph={boundedDisplay}
            selectedId={selected?.id}
            activePath={path}
            heatmap={heatmap}
            layoutRunning={layoutRunning}
            compact={compact}
            label={`${t("exploreGraph")}: ${boundedDisplay.nodes.length} ${t("graphNodes")}`}
            onSelect={select}
            onSelectEdge={(edge) => {
              setSelectedEdge(edge);
              if (edge) {
                setSelected(undefined);
                onSelectNode?.(undefined);
              }
            }}
            controls={controls}
            onUnavailable={setUnavailable}
          />
          {(!boundedDisplay.nodes.length || unavailable) && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center text-body text-muted-foreground">
              <div>
                <Network
                  className="mx-auto mb-3 size-10 opacity-40"
                  aria-hidden="true"
                />
                {t(unavailable ? "graphUnavailable" : "graphEmpty")}
              </div>
            </div>
          )}
          {(search || list || unavailable) && (
            <div
              className="absolute left-3 top-3 max-h-80 w-[min(280px,calc(100%-24px))] overflow-auto rounded-xl border border-border-soft bg-background p-2 shadow-lg"
              aria-label={t("graphMatches")}
            >
              {matches.slice(0, 100).map((n) => (
                <button
                  key={n.id}
                  className="block min-h-11 w-full rounded-lg px-3 py-2 text-left hover:bg-muted focus-visible:outline-ring"
                  onClick={() => focus(n)}
                >
                  <span className="block truncate text-body font-medium">
                    {nodeLabel(n)}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {kindLabel(n)}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="absolute bottom-3 left-3 flex gap-1 rounded-xl border bg-background p-1 shadow-sm">
            <Button
              variant="ghost"
              className="size-11"
              aria-label={t("zoomIn")}
              onClick={() => controls.current?.zoomIn()}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              variant="ghost"
              className="size-11"
              aria-label={t("zoomOut")}
              onClick={() => controls.current?.zoomOut()}
            >
              <Minus className="size-4" />
            </Button>
            <Button
              variant="ghost"
              className="size-11"
              aria-label={t("fitGraph")}
              onClick={() => controls.current?.fit()}
            >
              <Focus className="size-4" />
            </Button>
          </div>
          <span className="absolute bottom-4 right-3 rounded-lg bg-background/90 px-2 py-1 text-caption text-muted-foreground">
            {boundedDisplay.nodes.length} {t("graphNodes")} ·{" "}
            {boundedDisplay.edges.length} {t("relations")}
          </span>
        </div>
        <aside className="max-h-[700px] space-y-5 overflow-auto border-t border-border-soft bg-surface p-5 xl:border-l xl:border-t-0">
          <div className="flex items-center justify-between">
            <h3 className="text-body font-semibold">{t("nodeInspector")}</h3>
            {(selected || selectedEdge) && (
              <Button
                variant="ghost"
                className="size-11"
                aria-label={t("back")}
                onClick={clear}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
          {selected ? (
            <>
              <div>
                <p className="text-caption font-medium text-primary">
                  {kindLabel(selected)}
                </p>
                <h4 className="mt-2 break-words text-title font-semibold">
                  {nodeLabel(selected)}
                </h4>
                {nodeDescription(selected) && (
                  <p className="mt-3 whitespace-pre-wrap text-body leading-relaxed text-muted-foreground">
                    {nodeDescription(selected)}
                  </p>
                )}
              </div>
              {selectedMembers.length > 0 ? (
                <section className="space-y-2">
                  <h5 className="text-caption font-semibold text-muted-foreground">
                    {t("graphGroupMembers")} · {selectedMembers.length}
                  </h5>
                  {selectedMembers.map((id) => (
                    <button
                      key={id}
                      className="block min-h-11 w-full rounded-lg bg-muted/30 px-3 py-2 text-left text-body hover:bg-muted"
                      onClick={() => {
                        const node = graph.nodes.find((n) => n.id === id);
                        if (node) {
                          select(node);
                          setMode("focused");
                        }
                      }}
                    >
                      {label(id)}
                    </button>
                  ))}
                </section>
              ) : (
                <>
                  <section className="space-y-2">
                    <h5 className="text-caption font-semibold text-muted-foreground">
                      {t("relations")}
                    </h5>
                    {relationshipEdges.map((edge, i) => (
                      <button
                        key={edge.id || i}
                        className="flex min-h-11 w-full items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-left text-body hover:bg-muted"
                        onClick={() => {
                          const node = graph.nodes.find(
                            (n) =>
                              n.id ===
                              (edge.source === selected.id
                                ? edge.target
                                : edge.source),
                          );
                          if (node) focus(node);
                        }}
                      >
                        <ArrowRight
                          className="size-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <span>
                          {edge.label ||
                            t(
                              edge.kind === "governs"
                                ? "applicablePolicies"
                                : "actionTargets",
                            )}{" "}
                          ·{" "}
                          {label(
                            edge.source === selected.id
                              ? edge.target
                              : edge.source,
                          )}
                        </span>
                      </button>
                    ))}
                  </section>
                  <section className="space-y-3">
                    <h5 className="flex items-center gap-2 text-body font-medium">
                      <Route
                        className="size-4 text-primary"
                        aria-hidden="true"
                      />
                      {t("graphPath")}
                    </h5>
                    <label className="block text-caption text-muted-foreground">
                      {t("graphPathTarget")}
                      <select
                        aria-label={t("graphPathTarget")}
                        className="mt-2 min-h-11 w-full rounded-lg border bg-background px-3 text-body text-foreground"
                        value={target}
                        onChange={(e) => {
                          setMode("full");
                          setTarget(e.target.value);
                        }}
                      >
                        <option value="">{t("graphPathTarget")}</option>
                        {filtered.nodes
                          .filter((n) => n.id !== selected.id)
                          .map((n) => (
                            <option key={n.id} value={n.id}>
                              {nodeLabel(n)}
                            </option>
                          ))}
                      </select>
                    </label>
                    {target && (
                      <p className="text-caption leading-relaxed text-muted-foreground">
                        {path.length
                          ? path.map(label).join(" → ")
                          : t("graphPathEmpty")}
                      </p>
                    )}
                    {target && (
                      <Button variant="ghost" onClick={() => setTarget("")}>
                        {t("graphClearPath")}
                      </Button>
                    )}
                  </section>
                </>
              )}
              {evidence && (
                <details>
                  <summary className="cursor-pointer text-caption text-muted-foreground">
                    {t("modelEvidence")}
                  </summary>
                  <div className="mt-3 space-y-2">
                    {evidence.quote && (
                      <blockquote className="border-l-2 border-primary/30 pl-3 text-body">
                        {evidence.quote}
                      </blockquote>
                    )}
                    {evidence.path && (
                      <p className="break-words text-caption">
                        {evidence.path}
                      </p>
                    )}
                  </div>
                </details>
              )}
              <details className="rounded-lg border border-border-soft p-3">
                <summary className="cursor-pointer text-caption text-muted-foreground">
                  {t("developerDetails")}
                </summary>
                <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-caption">
                  {JSON.stringify(selected, null, 2)}
                </pre>
              </details>
            </>
          ) : selectedEdge ? (
            <>
              <h4 className="text-title font-semibold">
                {selectedEdge.label || t("relations")}
              </h4>
              <p className="text-body">
                {label(selectedEdge.source)} → {label(selectedEdge.target)}
              </p>
              <details>
                <summary className="text-caption text-muted-foreground">
                  {t("developerDetails")}
                </summary>
                <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words text-caption">
                  {JSON.stringify(selectedEdge, null, 2)}
                </pre>
              </details>
            </>
          ) : (
            <p className="text-body leading-relaxed text-muted-foreground">
              {t("graphSelectionHelp")}
            </p>
          )}
        </aside>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft px-4 py-3 text-caption text-muted-foreground">
        <span>{business ? t("graphNoSourceDefault") : t("graphPowered")}</span>
        <span>{t("graphPowered")}</span>
      </footer>
    </section>
  );
}
