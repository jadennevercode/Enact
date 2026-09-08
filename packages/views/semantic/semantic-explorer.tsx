"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type Sigma from "sigma";
import { Focus, List, Minus, Network, Plus, Search, X } from "lucide-react";
import type { SemanticGraph, SemanticGraphNode, SemanticGraphEdge } from "@enact/core/semantic";
import { Button } from "@enact/ui/components/ui/button";
import { Input } from "@enact/ui/components/ui/input";
import { buildSmallGraphSeedPositions } from "./explorer/small-graph-layout";
import { createNodeHover } from "./explorer/node-hover";
import { isSourceConcept, nodeDescription, nodeLabel, nodeLayer, nodeSourceEvidence } from "./graph-presentation";
import { RecordView, StateBadge, useSemanticText } from "./shared";

const emptyGraph: SemanticGraph = { nodes: [], edges: [] };
type Selection = { node: SemanticGraphNode; edge?: never } | { node?: never; edge: SemanticGraphEdge } | undefined;

/** Scoped adaptation of Semantica Explorer's Sigma canvas; source attribution in explorer/README.md. */
export function SemanticExplorer({ graph = emptyGraph, onSelectNode, compact = false }: {
  graph?: SemanticGraph; onSelectNode?: (node: SemanticGraphNode | undefined) => void; compact?: boolean;
}) {
  const t = useSemanticText();
  const host = useRef<HTMLDivElement>(null), renderer = useRef<Sigma | null>(null);
  const refreshFocus = useRef<(() => void) | undefined>(undefined);
  const [selection, setSelection] = useState<Selection>(), [search, setSearch] = useState(""), [layer, setLayer] = useState("auto"), [neighbors, setNeighbors] = useState(false), [list, setList] = useState(false), [unavailable, setUnavailable] = useState(false);
  const selectedRef = useRef(selection); selectedRef.current = selection;
  const selectRef = useRef(onSelectNode); selectRef.current = onSelectNode;
  const layers = useMemo(() => [...new Set(graph.nodes.map(nodeLayer))], [graph]);
  const nativeSchema = graph.nodes.some(node => node.layer === "schema");
  const activeLayer = layer === "auto" ? nativeSchema ? "ontologyLayer" : "all" : layer;
  const nodeTypeLabel = (node: SemanticGraphNode) => t(isSourceConcept(node) ? "graphSourceConcept" : nodeLayer(node) === "ontologyLayer" ? node.kind === "class" ? "graphClass" : node.kind === "property" ? "graphProperty" : "graphSchemaTerm" : nodeLayer(node));
  const nodeTypeLabelRef = useRef(nodeTypeLabel); nodeTypeLabelRef.current = nodeTypeLabel;
  const neighborId = neighbors ? selection?.node?.id : undefined;
  const visible = useMemo(() => {
    const adjacent = new Set<string>();
    if (neighborId) {
      adjacent.add(neighborId);
      graph.edges.forEach(e => { if (e.source === neighborId) adjacent.add(e.target); if (e.target === neighborId) adjacent.add(e.source); });
    }
    const nodes = graph.nodes.filter(n => (activeLayer === "all" || nodeLayer(n) === activeLayer) && (!adjacent.size || adjacent.has(n.id)));
    const ids = new Set(nodes.map(n => n.id));
    return { nodes, edges: graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)) };
  }, [graph, activeLayer, neighborId]);
  const matches = visible.nodes.filter(n => `${nodeLabel(n)} ${n.id} ${n.type || ""}`.toLowerCase().includes(search.toLowerCase()));
  function select(node: SemanticGraphNode) {
    selectedRef.current = { node }; setSelection({ node }); selectRef.current?.(node);
    const current = renderer.current;
    if (current?.getGraph().hasNode(node.id)) {
      const position = current.getNodeDisplayData(node.id);
      if (position) current.getCamera().animate({ x: position.x, y: position.y, ratio: 0.6 }, { duration: 220 });
      refreshFocus.current?.();
    } else { setLayer(nodeLayer(node)); setNeighbors(false); }
  }
  function clearSelection() { selectedRef.current = undefined; setSelection(undefined); selectRef.current?.(undefined); refreshFocus.current?.(); }
  function selectEdge(edge: SemanticGraphEdge) { selectedRef.current = { edge }; setSelection({ edge }); selectRef.current?.(undefined); refreshFocus.current?.(); }

  useEffect(() => {
    if (!host.current || !visible.nodes.length) return;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    const element = host.current;
    setUnavailable(false);
    void Promise.all([import("sigma"), import("graphology"), import("graphology-layout-forceatlas2")]).then(([{ default: SigmaRenderer }, { default: Graph }, { default: forceAtlas2 }]) => {
      if (disposed) return;
      const styles = getComputedStyle(element);
      const color = (token: string) => styles.getPropertyValue(token).trim();
      const palette: Record<string, string> = { ontologyLayer: color("--chart-1"), knowledgeLayer: color("--chart-2"), ruleLayer: color("--chart-3"), bindingLayer: color("--chart-4"), traceLayer: color("--chart-5"), sourceLayer: color("--info") };
      const scoped = new Graph({ type: "directed", multi: true, allowSelfLoops: true });
      const positions = buildSmallGraphSeedPositions(visible.nodes.map(n => n.id), visible.edges);
      visible.nodes.forEach(n => { if (!scoped.hasNode(n.id)) scoped.addNode(n.id, { ...positions.get(n.id), label: nodeLabel(n), nodeType: nodeTypeLabelRef.current(n), size: /ontology|class/.test(String(n.type || n.kind || "").toLowerCase()) ? 9 : 6, color: palette[nodeLayer(n)], original: n }); });
      visible.edges.forEach((e, i) => scoped.addDirectedEdgeWithKey(`${e.id || "edge"}:${i}`, e.source, e.target, { label: e.label || e.type || e.kind || "", color: color("--border"), size: 1.4, type: "arrow", original: e }));
      if (scoped.order > 48 && scoped.order <= 700) forceAtlas2.assign(scoped, { iterations: 70, settings: { ...forceAtlas2.inferSettings(scoped), barnesHutOptimize: true, gravity: 1, scalingRatio: 8, slowDown: 4 } });
      const sigma = new SigmaRenderer(scoped, element, { defaultDrawNodeHover: createNodeHover({ background: color("--background"), border: color("--border"), text: color("--foreground"), muted: color("--muted-foreground"), font: styles.fontFamily }), renderEdgeLabels: true, enableEdgeEvents: true, labelColor: { color: color("--foreground") }, edgeLabelColor: { color: color("--muted-foreground") }, labelFont: styles.fontFamily, labelSize: 12, edgeLabelSize: 10, labelDensity: 0.4, labelGridCellSize: 70, labelRenderedSizeThreshold: 5, minCameraRatio: 0.05, maxCameraRatio: 5, defaultEdgeType: "arrow", stagePadding: 48, hideEdgesOnMove: scoped.order > 200 });
      renderer.current = sigma;
      let hovered: string | undefined;
      const focus = () => {
        const requested = hovered || selectedRef.current?.node?.id;
        const active = requested && scoped.hasNode(requested) ? requested : undefined;
        const adjacent = active && scoped.hasNode(active) ? new Set([active, ...scoped.neighbors(active)]) : undefined;
        sigma.setSetting("nodeReducer", (id, data) => ({ ...data, ...(adjacent && !adjacent.has(id) ? { color: color("--border"), label: "", zIndex: 0 } : { highlighted: id === active, forceLabel: adjacent?.has(id) || false, zIndex: id === active ? 2 : 1 }) }));
        sigma.setSetting("edgeReducer", (id, data) => ({ ...data, ...(active ? { hidden: !scoped.hasExtremity(id, active), size: 2.3, color: palette.bindingLayer } : {}) }));
      };
      refreshFocus.current = focus;
      sigma.on("enterNode", ({ node }) => { hovered = node; element.style.cursor = "pointer"; focus(); });
      sigma.on("leaveNode", () => { hovered = undefined; element.style.cursor = "grab"; focus(); });
      sigma.on("clickNode", ({ node }) => { const value = scoped.getNodeAttribute(node, "original") as SemanticGraphNode; selectedRef.current = { node: value }; setSelection({ node: value }); selectRef.current?.(value); focus(); });
      sigma.on("clickEdge", ({ edge }) => selectEdge(scoped.getEdgeAttribute(edge, "original") as SemanticGraphEdge));
      sigma.on("clickStage", () => { clearSelection(); hovered = undefined; focus(); });
      focus();
      observer = new ResizeObserver(() => sigma.resize()); observer.observe(element);
    }).catch(() => { if (!disposed) setUnavailable(true); });
    return () => { disposed = true; observer?.disconnect(); renderer.current?.kill(); renderer.current = null; refreshFocus.current = undefined; };
  }, [visible]);

  const relatedLabel = (id: string) => { const node = graph.nodes.find(n => n.id === id); return node ? nodeLabel(node) : id; };
  const selected = selection?.node;
  return <section className="overflow-hidden rounded-xl border border-border-soft bg-surface" aria-label={t("exploreGraph")}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft p-3">
      <div className="relative min-w-44 flex-1 sm:max-w-72"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label={t("searchGraph")} placeholder={t("searchGraph")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div>
      <div className="flex flex-wrap items-center gap-2"><select aria-label={t("allLayers")} value={activeLayer} onChange={e => { clearSelection(); setLayer(e.target.value); setNeighbors(false); }} className="h-9 rounded-md border bg-background px-2 text-caption"><option value="all">{t("allLayers")}</option>{layers.map(l => <option key={l} value={l}>{t(l)}</option>)}</select><Button variant={neighbors ? "secondary" : "ghost"} size="sm" disabled={!selected} onClick={() => setNeighbors(v => !v)}><Network className="size-4" />{t("neighbors")}</Button><Button variant={list ? "secondary" : "ghost"} size="icon" aria-label={t("graphList")} onClick={() => setList(v => !v)}><List className="size-4" /></Button></div>
    </div>
    {graph.truncated === true && <div className="border-b border-warning/25 bg-warning/5 px-4 py-3 text-caption leading-relaxed" role="status"><strong>{t("graphPartial")} · {graph.nodes.length} {t("graphNodes")} / {graph.edges.length} {t("relations")}</strong><p className="mt-1 text-muted-foreground">{t("graphPartialHelp")}</p></div>}
    {nativeSchema && <div className="flex flex-wrap gap-4 border-b border-border-soft px-4 py-2 text-caption text-muted-foreground"><span>{t("loadedScope")}</span><span>{t("ontologyLayer")} · {graph.nodes.filter(node => node.layer === "schema").length}</span><span>{t("knowledgeLayer")} · {graph.nodes.filter(node => node.layer === "instances").length}</span><span>{t("sourceLayer")} · {graph.nodes.filter(node => node.layer === "provenance").length}</span></div>}
    <div className={`grid ${compact ? "lg:grid-cols-[minmax(0,1fr)_280px]" : "xl:grid-cols-[minmax(0,1fr)_320px]"}`}>
      <div className="relative min-w-0 bg-background" style={{ backgroundImage: "radial-gradient(var(--border-soft) 1px, transparent 1px)", backgroundSize: "24px 24px" }}>
        <div ref={host} className={`${compact ? "h-[400px]" : "h-[540px]"} w-full`} role="img" aria-label={`${t("exploreGraph")}: ${visible.nodes.length} ${t("graphNodes")}, ${visible.edges.length} ${t("relations")}`} />
        {(!visible.nodes.length || unavailable) && <div className="absolute inset-0 flex items-center justify-center p-10 text-center text-body text-muted-foreground"><div><Network className="mx-auto mb-4 size-10 opacity-40" />{unavailable ? t("graphUnavailable") : t("graphEmpty")}</div></div>}
        {(search || list || unavailable) && <div className="absolute left-3 top-3 max-h-[340px] w-64 overflow-auto rounded-lg border bg-background p-1 shadow-sm">{matches.slice(0, 100).map(n => <button key={n.id} className="block w-full rounded-md px-3 py-2 text-left text-body hover:bg-muted focus-visible:outline-ring" onClick={() => select(n)}><span className="block truncate font-medium">{nodeLabel(n)}</span><span className="text-caption text-muted-foreground">{nodeTypeLabel(n)}</span></button>)}</div>}
        <div className="absolute bottom-3 left-3 flex gap-1 rounded-lg border bg-background p-1 shadow-sm"><Button variant="ghost" size="icon" aria-label={t("zoomIn")} onClick={() => renderer.current?.getCamera().animatedZoom({ duration: 180 })}><Plus className="size-4" /></Button><Button variant="ghost" size="icon" aria-label={t("zoomOut")} onClick={() => renderer.current?.getCamera().animatedUnzoom({ duration: 180 })}><Minus className="size-4" /></Button><Button variant="ghost" size="icon" aria-label={t("fitGraph")} onClick={() => renderer.current?.getCamera().animatedReset({ duration: 180 })}><Focus className="size-4" /></Button></div>
        <span className="absolute bottom-4 right-3 rounded bg-background/90 px-2 py-1 text-caption text-muted-foreground">{visible.nodes.length} {t("graphNodes")} · {visible.edges.length} {t("relations")}</span>
      </div>
      <aside className="max-h-[620px] space-y-4 overflow-auto border-t border-border-soft bg-surface p-4 xl:border-l xl:border-t-0">
        <div className="flex items-center justify-between"><h3 className="text-body font-semibold">{t("nodeInspector")}</h3>{selection && <Button variant="ghost" size="icon" aria-label={t("back")} onClick={clearSelection}><X className="size-4" /></Button>}</div>
        {selected ? <><StateBadge state={nodeTypeLabel(selected)} /><h4 className="break-words text-title font-semibold">{nodeLabel(selected)}</h4><p className="break-all font-mono text-caption text-muted-foreground">{selected.id}</p>{isSourceConcept(selected) && <p className="rounded-lg bg-info/5 p-3 text-caption leading-relaxed text-muted-foreground">{t("graphSourceConceptHelp")}</p>}<NodeSourceEvidence node={selected} />{nodeDescription(selected) && <p className="whitespace-pre-wrap text-body leading-relaxed">{nodeDescription(selected)}</p>}<details><summary className="cursor-pointer text-caption text-muted-foreground">{t("graphProperties")}</summary><RecordView value={selected.properties} /></details>{Object.keys(selected.metadata).length > 0 && <><h4 className="text-caption font-semibold">{t("metadata")}</h4><RecordView value={selected.metadata} /></>}<h4 className="text-caption font-semibold">{t("relations")}</h4>{graph.edges.filter(e => e.source === selected.id || e.target === selected.id).slice(0, 30).map((e, i) => <button key={e.id || i} onClick={() => selectEdge(e)} className="block w-full rounded-md border border-border-soft p-2 text-left text-caption hover:bg-muted"><span className="block font-medium">{e.label || e.type || e.kind}</span><span className="break-all text-muted-foreground">{e.source === selected.id ? "→ " + relatedLabel(e.target) : "← " + relatedLabel(e.source)}</span></button>)}</> : selection?.edge ? <><StateBadge state={selection.edge.type || selection.edge.kind || "relationship"} /><h4 className="text-title">{selection.edge.label}</h4>{[selection.edge.source, selection.edge.target].map((id, i) => <button key={`${id}:${i}`} className="block w-full break-all rounded-md border p-3 text-left text-body hover:bg-muted" onClick={() => { const n = graph.nodes.find(n => n.id === id); if (n) select(n); }}>{i ? "→ " : ""}{relatedLabel(id)}</button>)}<RecordView value={selection.edge.properties} /></> : <p className="text-body leading-relaxed text-muted-foreground">{t("selectNode")}</p>}
      </aside>
    </div><div className="border-t border-border-soft px-4 py-2 text-caption text-muted-foreground">{t("graphPowered")}</div>
  </section>;
}

function NodeSourceEvidence({ node }: { node: SemanticGraphNode }) {
  const t = useSemanticText();
  const evidence = nodeSourceEvidence(node);
  if (!evidence) return null;
  return <section className="space-y-3 rounded-lg border border-border-soft bg-background p-3" aria-label={t("graphSourceEvidence")}>
    <h4 className="text-caption font-semibold">{t("graphSourceEvidence")}</h4>
    {evidence.quote && <blockquote className="border-l-2 border-info/50 pl-3 text-body leading-relaxed">{evidence.quote}</blockquote>}
    <dl className="space-y-3 text-caption">
      {evidence.path && <div><dt className="text-muted-foreground">{t("graphSourceFile")}</dt><dd className="mt-1 break-all font-mono">{evidence.path}</dd></div>}
      {(evidence.start !== undefined || evidence.end !== undefined) && <div><dt className="text-muted-foreground">{t("graphSourceOffsets")}</dt><dd className="mt-1 font-mono">{evidence.start ?? "—"} – {evidence.end ?? "—"}</dd></div>}
      {evidence.hash && <div><dt className="text-muted-foreground">{t("graphSourceHash")}</dt><dd className="mt-1 break-all font-mono">{evidence.hash}</dd></div>}
    </dl>
  </section>;
}
