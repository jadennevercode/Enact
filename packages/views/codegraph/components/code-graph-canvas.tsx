"use client";

import { useEffect, useRef, useState } from "react";
import type Sigma from "sigma";
import { Focus, Minus, Plus } from "lucide-react";
import type { CodeGraphView, CodeGraphViewNode } from "@enact/core/codegraph";
import { Button } from "@enact/ui/components/ui/button";
import { buildSmallGraphSeedPositions } from "../../semantic/explorer/small-graph-layout";
import { createNodeHover } from "../../semantic/explorer/node-hover";
import { useT } from "../../i18n";

/**
 * Sigma canvas for a code graph projection.
 *
 * It reuses the two genuinely graph-shaped pieces of the ontology explorer —
 * the deterministic small-graph layout and the themed hover card — and keeps
 * its own renderer: the ontology explorer reads RDF layers, properties and
 * source evidence off every node, none of which a code node has.
 *
 * Colour is carried by the design system's chart tokens, cycled by community
 * so a subsystem keeps one colour across the meta graph and its own subgraph.
 * Nothing here uses graphify's palette.
 */
export function CodeGraphCanvas({
  view,
  selectedId,
  highlightIds,
  onSelectNode,
  onOpenNode,
  height = 520,
}: {
  view: CodeGraphView;
  selectedId?: string;
  highlightIds?: readonly string[];
  onSelectNode: (node: CodeGraphViewNode | undefined) => void;
  onOpenNode?: (node: CodeGraphViewNode) => void;
  height?: number;
}) {
  const { t } = useT("codegraph");
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<Sigma | null>(null);
  const refreshFocus = useRef<(() => void) | undefined>(undefined);
  const [unavailable, setUnavailable] = useState(false);

  // Refs, not deps: the sigma instance is built once per view and its event
  // handlers must see the current callbacks without tearing the graph down
  // every time a parent re-renders with new closures.
  const selectRef = useRef(onSelectNode);
  selectRef.current = onSelectNode;
  const openRef = useRef(onOpenNode);
  openRef.current = onOpenNode;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const highlightRef = useRef(highlightIds);
  highlightRef.current = highlightIds;

  const nodeCount = view.nodes.length;
  const edgeCount = view.edges.length;

  useEffect(() => {
    const element = host.current;
    if (!element || nodeCount === 0) return;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    setUnavailable(false);

    void Promise.all([
      import("sigma"),
      import("graphology"),
      import("graphology-layout-forceatlas2"),
    ])
      .then(([{ default: SigmaRenderer }, { default: Graph }, { default: forceAtlas2 }]) => {
        if (disposed) return;
        const styles = getComputedStyle(element);
        const color = (token: string) => styles.getPropertyValue(token).trim();
        const palette = [
          color("--chart-1"),
          color("--chart-2"),
          color("--chart-3"),
          color("--chart-4"),
          color("--chart-5"),
        ].filter(Boolean);
        const fallbackColor = color("--muted-foreground") || "#888";
        const colorFor = (node: CodeGraphViewNode) => {
          if (palette.length === 0) return fallbackColor;
          const key = node.community_id;
          if (typeof key !== "number") return palette[0] ?? fallbackColor;
          return palette[Math.abs(key) % palette.length] ?? fallbackColor;
        };

        const scoped = new Graph({ type: "directed", multi: true, allowSelfLoops: true });
        const positions = buildSmallGraphSeedPositions(
          view.nodes.map((n) => n.id),
          view.edges,
        );
        const maxSize = Math.max(1, ...view.nodes.map((n) => n.size ?? n.degree ?? 1));
        for (const node of view.nodes) {
          if (scoped.hasNode(node.id)) continue;
          const weight = node.size ?? node.degree ?? 1;
          scoped.addNode(node.id, {
            ...positions.get(node.id),
            label: node.label,
            nodeType:
              node.kind === "community"
                ? t(($) => $.graph.kind_community)
                : node.source_file || t(($) => $.graph.kind_code),
            // Area, not radius, tracks weight: a subsystem ten times the size
            // of another should not be a hundred times the ink.
            size: 5 + 9 * Math.sqrt(weight / maxSize),
            color: colorFor(node),
            original: node,
          });
        }
        view.edges.forEach((edge, index) => {
          if (!scoped.hasNode(edge.source) || !scoped.hasNode(edge.target)) return;
          scoped.addDirectedEdgeWithKey(
            `${edge.relation || "edge"}:${index}`,
            edge.source,
            edge.target,
            {
              label: edge.relation,
              color: color("--border"),
              size: edge.weight && edge.weight > 1 ? Math.min(4, 1 + Math.log2(edge.weight)) : 1.2,
              type: "arrow",
              // An inferred edge is drawn dashed so a reader never mistakes a
              // guess for something the parser actually found in the source.
              dashed: edge.confidence === "INFERRED" || edge.confidence === "AMBIGUOUS",
            },
          );
        });

        if (scoped.order > 48 && scoped.order <= 900) {
          forceAtlas2.assign(scoped, {
            iterations: 70,
            settings: {
              ...forceAtlas2.inferSettings(scoped),
              barnesHutOptimize: true,
              gravity: 1,
              scalingRatio: 8,
              slowDown: 4,
            },
          });
        }

        const sigma = new SigmaRenderer(scoped, element, {
          defaultDrawNodeHover: createNodeHover({
            background: color("--background"),
            border: color("--border"),
            text: color("--foreground"),
            muted: color("--muted-foreground"),
            font: styles.fontFamily,
          }),
          renderEdgeLabels: scoped.order <= 120,
          enableEdgeEvents: false,
          labelColor: { color: color("--foreground") },
          edgeLabelColor: { color: color("--muted-foreground") },
          labelFont: styles.fontFamily,
          labelSize: 12,
          edgeLabelSize: 10,
          labelDensity: 0.4,
          labelGridCellSize: 70,
          labelRenderedSizeThreshold: 6,
          minCameraRatio: 0.05,
          maxCameraRatio: 5,
          defaultEdgeType: "arrow",
          stagePadding: 48,
          hideEdgesOnMove: scoped.order > 200,
        });
        renderer.current = sigma;

        let hovered: string | undefined;
        const focus = () => {
          const requested = hovered || selectedRef.current;
          const active = requested && scoped.hasNode(requested) ? requested : undefined;
          const adjacent = active
            ? new Set([active, ...scoped.neighbors(active)])
            : undefined;
          const searchHits = highlightRef.current?.length
            ? new Set(highlightRef.current)
            : undefined;
          sigma.setSetting("nodeReducer", (id, data) => {
            if (adjacent && !adjacent.has(id)) {
              return { ...data, color: color("--border"), label: "", zIndex: 0 };
            }
            return {
              ...data,
              highlighted: id === active || searchHits?.has(id) === true,
              forceLabel: adjacent?.has(id) || searchHits?.has(id) || false,
              zIndex: id === active ? 2 : 1,
            };
          });
          sigma.setSetting("edgeReducer", (id, data) =>
            active
              ? { ...data, hidden: !scoped.hasExtremity(id, active) }
              : { ...data },
          );
        };
        refreshFocus.current = focus;

        sigma.on("enterNode", ({ node }) => {
          hovered = node;
          element.dataset.hoveredNode = "true";
          focus();
        });
        sigma.on("leaveNode", () => {
          hovered = undefined;
          delete element.dataset.hoveredNode;
          focus();
        });
        sigma.on("clickNode", ({ node }) => {
          const value = scoped.getNodeAttribute(node, "original") as CodeGraphViewNode;
          selectedRef.current = value.id;
          selectRef.current(value);
          focus();
        });
        sigma.on("doubleClickNode", ({ node }) => {
          const value = scoped.getNodeAttribute(node, "original") as CodeGraphViewNode;
          openRef.current?.(value);
        });
        sigma.on("clickStage", () => {
          selectedRef.current = undefined;
          selectRef.current(undefined);
          hovered = undefined;
          focus();
        });
        focus();

        observer = new ResizeObserver(() => sigma.resize());
        observer.observe(element);
      })
      .catch(() => {
        // Sigma needs a canvas; a browser that cannot give it one still has the
        // node list beside this canvas, so the tab degrades instead of failing.
        if (!disposed) setUnavailable(true);
      });

    return () => {
      disposed = true;
      delete element.dataset.hoveredNode;
      observer?.disconnect();
      renderer.current?.kill();
      renderer.current = null;
      refreshFocus.current = undefined;
    };
  }, [view, nodeCount, t]);

  // Selection changes from outside the canvas (the list, a deep link) have to
  // re-run the focus reducers without rebuilding the graph.
  useEffect(() => {
    refreshFocus.current?.();
  }, [selectedId, highlightIds]);

  const camera = () => renderer.current?.getCamera();

  return (
    <div className="relative min-w-0 bg-background [background-image:radial-gradient(var(--border-soft)_1px,transparent_1px)] [background-size:24px_24px]">
      <div
        ref={host}
        style={{ height }}
        className="w-full cursor-grab data-[hovered-node=true]:cursor-pointer"
        role="img"
        aria-label={t(($) => $.graph.canvas_label, { nodes: nodeCount, edges: edgeCount })}
      />
      {nodeCount === 0 || unavailable ? (
        <div className="absolute inset-0 flex items-center justify-center p-10 text-center text-body text-muted-foreground">
          {unavailable ? t(($) => $.graph.unavailable) : t(($) => $.graph.empty)}
        </div>
      ) : null}
      <div className="absolute bottom-3 left-3 flex gap-1 rounded-lg border bg-background p-1 shadow-sm">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t(($) => $.graph.zoom_in)}
          onClick={() => camera()?.animatedZoom({ duration: 180 })}
        >
          <Plus className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t(($) => $.graph.zoom_out)}
          onClick={() => camera()?.animatedUnzoom({ duration: 180 })}
        >
          <Minus className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t(($) => $.graph.fit)}
          onClick={() => camera()?.animatedReset({ duration: 180 })}
        >
          <Focus className="size-4" />
        </Button>
      </div>
      <span className="absolute bottom-4 right-3 rounded bg-background/90 px-2 py-1 text-caption text-muted-foreground">
        {t(($) => $.graph.nodes_edges, { nodes: nodeCount, edges: edgeCount })}
      </span>
    </div>
  );
}
