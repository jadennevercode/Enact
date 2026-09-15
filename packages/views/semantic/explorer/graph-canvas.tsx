"use client";

import { useEffect, useRef, useState } from "react";
import type Sigma from "sigma";
import type {
  SemanticGraph,
  SemanticGraphNode,
  SemanticGraphEdge,
} from "@enact/core/semantic";
import { graphologyGraph, neighborhoodDistances } from "./graph-scene";
import { buildSmallGraphSeedPositions } from "./small-graph-layout";
import { createNodeHover } from "./node-hover";
import { nodeLabel } from "../graph-presentation";
import { useSemanticText } from "../shared";
import { clickSelectionBehavior } from "./behaviors/clickSelectionBehavior";
import { hoverActivationBehavior } from "./behaviors/hoverActivationBehavior";
import { fitViewBehavior } from "./behaviors/fitViewBehavior";
import { focusCameraBehavior } from "./behaviors/focusCameraBehavior";
import { createPathHighlightBehavior } from "./behaviors/pathHighlightBehavior";
import type {
  GraphBehaviorContext,
  GraphInteractionState,
} from "./behaviors/types";

export interface GraphCanvasControls {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  focus: (id: string) => void;
}
interface Props {
  graph: SemanticGraph;
  selectedId?: string;
  activePath: string[];
  heatmap: boolean;
  layoutRunning: boolean;
  compact: boolean;
  label: string;
  onSelect: (node?: SemanticGraphNode) => void;
  onSelectEdge: (edge?: SemanticGraphEdge) => void;
  controls: React.RefObject<GraphCanvasControls | null>;
  onUnavailable: (value: boolean) => void;
}

// Semantica GraphCanvas/SceneAdapter lifecycle and original interaction behaviors,
// using a graph instance owned by this canvas rather than Explorer's singleton.
export function GraphCanvas(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    latest = useRef(props),
    refresh = useRef<(() => void) | null>(null);
  const worker = useRef<{
    start: () => void;
    stop: () => void;
    kill: () => void;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [settling, setSettling] = useState(false);
  const warming = useRef(false);
  const t = useSemanticText();
  latest.current = props;
  useEffect(() => {
    if (!host.current || !props.graph.nodes.length) return;
    let disposed = false,
      sigma: Sigma | undefined,
      observer: ResizeObserver | undefined,
      initialLayoutTimer: ReturnType<typeof setTimeout> | undefined;
    warming.current = true;
    setReady(false);
    let cleanup = () => {};
    const element = host.current;
    void Promise.all([
      import("sigma"),
      import("graphology-layout-forceatlas2"),
      import("graphology-layout-forceatlas2/worker"),
    ])
      .then(
        ([
          { default: SigmaRenderer },
          { default: forceAtlas2 },
          { default: LayoutWorker },
        ]) => {
          if (disposed) return;
          const graph = graphologyGraph(props.graph),
            styles = getComputedStyle(element);
          const color = (token: string) =>
            styles.getPropertyValue(token).trim();
          const colors = [
            color("--chart-1"),
            color("--chart-2"),
            color("--chart-3"),
            color("--chart-4"),
            color("--chart-5"),
          ];
          const positions = buildSmallGraphSeedPositions(
            props.graph.nodes.map((n) => n.id),
            props.graph.edges,
          );
          graph.forEachNode((id, attributes) => {
            const node = attributes.original as SemanticGraphNode,
              kind = String(node.kind || node.type || ""),
              index =
                kind === "policy"
                  ? 2
                  : kind === "action"
                    ? 1
                    : kind === "group"
                      ? 3
                      : 0;
            graph.mergeNodeAttributes(id, {
              ...positions.get(id),
              label: nodeLabel(node),
              nodeType: kind,
              color: colors[index],
              baseColor: colors[index],
              size:
                kind === "group"
                  ? Math.min(24, 10 + Number(node.metadata.memberCount || 0))
                  : kind === "entity" || kind === "class"
                    ? 10
                    : 7,
            });
          });
          graph.forEachEdge((id, attributes) => {
            const edge = attributes.original as SemanticGraphEdge;
            graph.mergeEdgeAttributes(id, {
              label: edge.label || "",
              color: color("--border"),
              size: 1.6,
              type: "arrow",
            });
          });
          sigma = new SigmaRenderer(graph, element, {
            defaultDrawNodeHover: createNodeHover({
              background: color("--background"),
              border: color("--border"),
              text: color("--foreground"),
              muted: color("--muted-foreground"),
              font: styles.fontFamily,
            }),
            renderEdgeLabels: true,
            enableEdgeEvents: true,
            labelColor: { color: color("--foreground") },
            edgeLabelColor: { color: color("--muted-foreground") },
            labelFont: styles.fontFamily,
            labelSize: 12,
            labelDensity: 0.4,
            labelGridCellSize: 70,
            labelRenderedSizeThreshold: 5,
            minCameraRatio: 0.05,
            maxCameraRatio: 5,
            defaultEdgeType: "arrow",
            stagePadding: 48,
            hideEdgesOnMove: graph.order > 200,
          });
          const renderer = sigma;
          let hoveredNodeId: string | null = null,
            hoveredEdgeId: string | null = null,
            selectedEdgeId: string | null = null;
          const reducedMotion = matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          const behaviors = [
            clickSelectionBehavior,
            hoverActivationBehavior,
            fitViewBehavior,
            focusCameraBehavior,
            ...(!reducedMotion ? [createPathHighlightBehavior()] : []),
          ];
          const state = (): GraphInteractionState => ({
            selectedNodeId: latest.current.selectedId || null,
            hoveredNodeId,
            selectedEdgeId,
            activePath: latest.current.activePath,
          });
          function focusNode(id: string) {
            if (!graph.hasNode(id)) return;
            // Reducer updates can temporarily leave display data in graph space
            // until Sigma processes its next frame. Convert the authoritative
            // graph coordinates through Sigma's public coordinate APIs instead.
            const position = renderer.viewportToFramedGraph(
              renderer.graphToViewport({
                x: Number(graph.getNodeAttribute(id, "x")),
                y: Number(graph.getNodeAttribute(id, "y")),
              }),
            );
            renderer.getCamera().animate(
              { x: position.x, y: position.y, ratio: 0.6 },
              {
                duration: matchMedia("(prefers-reduced-motion: reduce)").matches
                  ? 0
                  : 220,
              },
            );
          }
          const context: GraphBehaviorContext = {
            sigma: renderer,
            graph,
            displayGraph: graph,
            getInteractionState: state,
            setHoveredNodeId: (id) => {
              hoveredNodeId = id;
              refresh.current?.();
            },
            onNodeSelectionChange: (id) =>
              latest.current.onSelect(
                id && graph.hasNode(id)
                  ? graph.getNodeAttribute(id, "original")
                  : undefined,
              ),
            onEdgeSelectionChange: (id) => {
              selectedEdgeId = id || null;
              latest.current.onSelectEdge(
                id && graph.hasEdge(id)
                  ? graph.getEdgeAttribute(id, "original")
                  : undefined,
              );
            },
            focusNodeInView: focusNode,
            centerSelectionInView: focusNode,
            centerGroupedSelectionInView: focusNode,
            fitCurrentView: () =>
              renderer
                .getCamera()
                .animatedReset({ duration: reducedMotion ? 0 : 180 }),
            dispatchAction: (action) => {
              for (const behavior of behaviors)
                if (behavior.performAction?.(context, action)) break;
            },
          };
          refresh.current = () => {
            const active = hoveredNodeId || latest.current.selectedId,
              validActive =
                active && graph.hasNode(active) ? active : undefined;
            const adjacent = validActive
              ? new Set([validActive, ...graph.neighbors(validActive)])
              : undefined;
            const path = latest.current.activePath,
              pathIds = new Set(path),
              pathEdges = new Set(
                path.slice(1).map((id, i) => `${path[i]}:${id}`),
              );
            const distances =
              latest.current.heatmap && validActive
                ? neighborhoodDistances(graph, validActive)
                : undefined;
            renderer.setSetting("nodeReducer", (id, data) => ({
              ...data,
              color: pathIds.size
                ? pathIds.has(id)
                  ? color("--primary")
                  : color("--border")
                : distances
                  ? colors[Math.min(distances.get(id) ?? 4, 4)]
                  : adjacent && !adjacent.has(id)
                    ? color("--border")
                    : data.baseColor,
              label: pathIds.size
                ? pathIds.has(id)
                  ? data.label
                  : ""
                : adjacent && !adjacent.has(id) && !distances
                  ? ""
                  : data.label,
              // Sigma renders highlighted nodes with the hover-card painter.
              // Keep that card for actual pointer hover, not persistent selection.
              highlighted: false,
              size: id === validActive ? data.size * 1.2 : data.size,
              forceLabel: pathIds.has(id) || adjacent?.has(id) || false,
            }));
            renderer.setSetting("edgeReducer", (id, data) => {
              const onPath = pathEdges.has(
                `${graph.source(id)}:${graph.target(id)}`,
              );
              const readable =
                onPath ||
                id === selectedEdgeId ||
                id === hoveredEdgeId ||
                (!!validActive && graph.hasExtremity(id, validActive));
              return {
                ...data,
                // In the full overview, relationship text competes with business
                // objects. Reveal it only in the user's current reading context.
                label: readable ? data.label : "",
                forceLabel: readable,
                hidden: pathIds.size
                  ? !onPath
                  : adjacent
                    ? !graph.hasExtremity(id, validActive!)
                    : false,
                color: onPath ? color("--primary") : data.color,
                size: onPath ? 3 : data.size,
              };
            });
            behaviors.forEach((b) => b.onStateChange?.(context, state()));
          };
          props.controls.current = {
            zoomIn: () =>
              renderer
                .getCamera()
                .animatedZoom({ duration: reducedMotion ? 0 : 180 }),
            zoomOut: () =>
              renderer
                .getCamera()
                .animatedUnzoom({ duration: reducedMotion ? 0 : 180 }),
            fit: () => context.dispatchAction({ type: "fitView" }),
            focus: (id) =>
              context.dispatchAction({ type: "focusNode", nodeId: id }),
          };
          renderer.on("enterNode", ({ node }) =>
            behaviors.forEach((b) => b.onNodeEnter?.(context, node)),
          );
          renderer.on("leaveNode", ({ node }) =>
            behaviors.forEach((b) => b.onNodeLeave?.(context, node)),
          );
          renderer.on("clickNode", ({ node }) =>
            behaviors.forEach((b) => b.onNodeClick?.(context, node)),
          );
          renderer.on("enterEdge", ({ edge }) => {
            hoveredEdgeId = edge;
            refresh.current?.();
          });
          renderer.on("leaveEdge", () => {
            hoveredEdgeId = null;
            refresh.current?.();
          });
          renderer.on("clickEdge", ({ edge }) =>
            behaviors.forEach((b) => b.onEdgeClick?.(context, edge)),
          );
          renderer.on("clickStage", () =>
            behaviors.forEach((b) => b.onStageClick?.(context)),
          );
          behaviors.forEach((b) => b.attach(context));
          cleanup = () => behaviors.forEach((b) => b.detach(context));
          observer = new ResizeObserver(() => renderer.resize());
          observer.observe(element);
          if (graph.order > 1 && graph.size > 0)
            worker.current = new LayoutWorker(graph, {
              settings: {
                ...forceAtlas2.inferSettings(graph),
                barnesHutOptimize: true,
                gravity: 1,
                scalingRatio: 10,
                slowDown: 5,
              },
            });
          latest.current.onUnavailable(false);
          refresh.current();
          const reveal = () => {
            if (disposed) return;
            worker.current?.stop();
            warming.current = false;
            renderer.refresh();
            setReady(true);
          };
          // Native FA2 runs off the main thread before the static scene appears.
          // The explorer caps the scene at 500 nodes; the fixed time budget also
          // bounds dense graphs. Reduced-motion users never see nodes moving.
          if (worker.current) {
            worker.current.start();
            initialLayoutTimer = setTimeout(reveal, 1000);
          } else reveal();
        },
      )
      .catch(() => {
        if (!disposed) latest.current.onUnavailable(true);
      });
    return () => {
      disposed = true;
      setReady(false);
      warming.current = false;
      clearTimeout(initialLayoutTimer);
      cleanup();
      worker.current?.kill();
      worker.current = null;
      observer?.disconnect();
      sigma?.kill();
      refresh.current = null;
      latest.current.controls.current = null;
    };
  }, [props.graph, props.controls]);
  useEffect(() => {
    refresh.current?.();
  }, [props.selectedId, props.activePath, props.heatmap]);
  useEffect(() => {
    // A target can lie outside the previously focused neighborhood. Restore
    // the complete scene so both ends of the selected path remain visible.
    if (props.activePath.length > 1) props.controls.current?.fit();
  }, [props.activePath, props.controls]);
  useEffect(() => {
    if (!ready || warming.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reducedMotion = matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (props.layoutRunning && worker.current) {
      worker.current.start();
      if (reducedMotion) {
        setSettling(true);
        timer = setTimeout(() => {
          worker.current?.stop();
          setSettling(false);
        }, 1000);
      }
    } else {
      worker.current?.stop();
      setSettling(false);
    }
    return () => {
      clearTimeout(timer);
      worker.current?.stop();
    };
  }, [ready, props.layoutRunning]);
  return (
    <div className={`relative ${props.compact ? "h-[420px]" : "h-[560px]"}`}>
      {(!ready || settling) && (
        <div
          role="status"
          className="absolute inset-0 flex items-center justify-center text-caption text-muted-foreground"
        >
          {t("graphArranging")}
        </div>
      )}
      <div
        ref={host}
        className="size-full cursor-grab"
        style={{ opacity: ready && !settling ? 1 : 0 }}
        aria-busy={!ready || settling}
        role="img"
        aria-label={props.label}
      />
    </div>
  );
}
