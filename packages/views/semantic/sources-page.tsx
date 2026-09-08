"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronRight, Database, FileText, FolderGit2, Folder, KeyRound, Layers, LoaderCircle, Plus, RefreshCw, Search, ShieldCheck, Table2, Zap } from "lucide-react";
import { useWorkspaceId } from "@enact/core/hooks";
import { useWorkspacePaths } from "@enact/core/paths";
import { workspaceResourcesOptions } from "@enact/core/resources";
import { catalogApi, catalogOptions, connectorOptions, snapshotOptions, semanticApi, semanticOptions, useSemanticMutation, type Connection, type Connector, type CatalogEntry } from "@enact/core/semantic";
import { Button } from "@enact/ui/components/ui/button";
import { Input } from "@enact/ui/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@enact/ui/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@enact/ui/components/ui/tabs";
import { CollectionPageHeader } from "../layout/collection-page";
import { ResourcesPage as WorkspaceResourcesPage } from "../resources/components/resources-page";
import { useNavigation } from "../navigation";
import { useSemanticText, TextField, TextArea, Field, Failure, StateBadge, RecordView } from "./shared";
import { SchemaFields } from "./schema-fields";

const capLabel = { knowledge: "knowledge", data: "dataSources", actions: "systemActions" } as const;
function caps(connection: Connection, connectors?: Connector[]) { return connection.capabilities.length ? connection.capabilities : connectors?.find(c => c.id === connection.kind)?.capabilities || []; }
function SourceIcon({ capabilities }: { capabilities: string[] }) { const Icon = capabilities.includes("actions") ? Zap : capabilities.includes("data") ? Database : BookOpen; return <Icon className="size-4 shrink-0" />; }

export function SourcesPage() {
  const t = useSemanticText(), wsId = useWorkspaceId(), nav = useNavigation(), paths = useWorkspacePaths();
  const list = useQuery(semanticOptions(wsId).connections), registry = useQuery(connectorOptions(wsId));
  const [filter, setFilter] = useState("all"), [search, setSearch] = useState(""), [open, setOpen] = useState(false), [editing, setEditing] = useState<Connection>(), [discoveryError, setDiscoveryError] = useState<unknown>();
  const connections = list.data || [];
  const filtered = connections.filter(c => (filter === "all" || caps(c, registry.data?.connectors).includes(filter)) && `${c.name} ${c.kind} ${c.endpoint}`.toLowerCase().includes(search.toLowerCase()));
  const current = filtered.find(c => c.id === nav.searchParams.get("source")) || filtered[0];
  const select = (id: string) => nav.replace(`${paths.resources()}?source=${encodeURIComponent(id)}`);
  return <div className="flex min-h-0 flex-1 flex-col">
    <CollectionPageHeader icon={Layers} title={t("sourcesTitle")} description={t("sourcesSubtitle")} actions={<Button onClick={() => { setEditing(undefined); setOpen(true); }}><Plus className="size-4" />{t("addSource")}</Button>} />
    <div className="flex flex-wrap gap-1 border-b border-border-soft px-6 py-2" role="tablist" aria-label={t("sourcesTitle")}>
      {([['all', 'allSources', Layers], ['knowledge', 'knowledge', BookOpen], ['data', 'dataSources', Database], ['actions', 'systemActions', Zap], ['code', 'codeFolders', FolderGit2]] as const).map(([id, key, Icon]) => <Button key={id} role="tab" aria-selected={filter === id} variant={filter === id ? "secondary" : "ghost"} onClick={() => setFilter(id)} size="sm"><Icon className="size-4" />{t(key)}{id !== "code" && <span className="ml-1 text-caption text-muted-foreground">{connections.filter(c => id === "all" || caps(c, registry.data?.connectors).includes(id)).length}</span>}</Button>)}
    </div>
    <Failure error={discoveryError} />
    {filter === "code" ? <WorkspaceResourcesPage /> : <div className="grid min-h-0 flex-1 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="border-b border-border-soft p-3 lg:overflow-auto lg:border-b-0 lg:border-r"><div className="relative mb-3"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label={t("allSources")} placeholder={t("allSources")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div><Failure error={list.error || registry.error} retry={() => { void list.refetch(); void registry.refetch(); }} />{list.isPending && <p className="p-3 text-body text-muted-foreground">{t("loading")}</p>}{filtered.map(c => <button key={c.id} onClick={() => select(c.id)} className={`mb-1 flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-muted ${current?.id === c.id ? "bg-surface-selected" : ""}`}><span className="mt-1 rounded-md border border-border-soft bg-background p-2 text-primary"><SourceIcon capabilities={caps(c, registry.data?.connectors)} /></span><span className="min-w-0 flex-1"><span className="block truncate text-body font-medium">{c.name}</span><span className="mt-1 block text-caption text-muted-foreground">{registry.data?.connectors.find(x => x.id === c.kind)?.name || c.kind}</span><span className={`mt-1 block text-caption ${c.enabled ? "text-success" : "text-muted-foreground"}`}>{c.enabled ? t("connected") : t("disable")}</span></span><ChevronRight className="mt-3 size-3 shrink-0 text-muted-foreground" /></button>)}</aside>
      <main className="min-w-0 overflow-auto">{current ? <SourceDetail key={current.id} connection={current} connector={registry.data?.connectors.find(c => c.id === current.kind)} onEdit={() => { setEditing(current); setOpen(true); }} /> : <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-8 py-20 text-center"><Layers className="size-12 text-muted-foreground/40" /><h2 className="text-title font-semibold">{t("addSource")}</h2><p className="text-body leading-relaxed text-muted-foreground">{t("discoveryHelp")}</p><Button onClick={() => setOpen(true)}><Plus className="size-4" />{t("addSource")}</Button></div>}</main>
    </div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[88vh] overflow-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{editing ? t("edit") : t("addSource")}</DialogTitle><DialogDescription>{t("chooseConnector")}</DialogDescription></DialogHeader>{open && <SourceForm key={editing?.id || "new"} connection={editing} connectors={registry.data?.connectors || []} onSaved={(id, error) => { setOpen(false); setFilter("all"); select(id); setDiscoveryError(error); }} />}</DialogContent></Dialog>
  </div>;
}

function SourceForm({ connection, connectors, onSaved }: { connection?: Connection; connectors: Connector[]; onSaved: (id: string, error?: unknown) => void }) {
  const t = useSemanticText(), wsId = useWorkspaceId(), resources = useQuery(workspaceResourcesOptions(wsId));
  const [name, setName] = useState(connection?.name || ""), [kind, setKind] = useState(connection?.kind || connectors.find(c => c.available)?.id || "postgres"), [endpoint, setEndpoint] = useState(connection?.endpoint || ""), [config, setConfig] = useState(JSON.stringify(connection?.config || {}, null, 2)), [credentials, setCredentials] = useState<Record<string, string>>({}), [error, setError] = useState<unknown>();
  const connector = connectors.find(c => c.id === kind);
  const [capabilities, setCapabilities] = useState(connection?.capabilities || connector?.capabilities || []);
  const authFields = connector?.authFields.map(f => typeof f === "string" ? { name: f, label: f } : { name: String(f.name || f.key || "token"), label: String(f.label || f.name || f.key || "token") }) || [];
  let configValue: Record<string, unknown> = {}; try { configValue = JSON.parse(config); } catch { /* Validated at save. */ }
  function updateConfig(key: string, value: string) { setConfig(JSON.stringify({ ...configValue, [key]: value }, null, 2)); }
  const save = useSemanticMutation(wsId, async () => {
    const secret: Record<string, unknown> = {}, values = Object.fromEntries(Object.entries(credentials).filter(([, value]) => value));
    if (values.dsn) { secret.dsn = values.dsn; delete values.dsn; }
    if (Object.keys(values).length) secret.credentials = values;
    const body = { name, kind, endpoint, capabilities, config: JSON.parse(config), ...(Object.keys(secret).length ? { secret } : {}) };
    const saved = connection ? await semanticApi.updateConnection(connection.id, body) : await semanticApi.createConnection(body);
    // Discovery failure leaves the saved connection available for correction and retry.
    let discoveryError: unknown;
    try { await catalogApi.discover(saved.id); } catch (error) { discoveryError = error; }
    onSaved(saved.id, discoveryError); return saved;
  });
  return <form className="space-y-5" onSubmit={e => { e.preventDefault(); setError(undefined); void save.mutateAsync().catch(setError); }}>
    <Field label={t("connector")}><select className="rounded-md border bg-background p-2.5" value={kind} disabled={!!connection} onChange={e => { setKind(e.target.value); setCapabilities(connectors.find(c => c.id === e.target.value)?.capabilities || []); setCredentials({}); setConfig("{}"); }}>{connectors.map(c => <option key={c.id} value={c.id}>{c.name}{c.available ? "" : ` · ${t("connectorUnavailable")}`}</option>)}{connection && !connectors.some(c => c.id === connection.kind) && <option value={connection.kind}>{connection.kind}</option>}</select></Field>
    {connector && <div className="rounded-lg bg-muted/40 p-3 text-caption text-muted-foreground"><p>{t(/git|repo/.test(kind) ? "connectorGitHelp" : /postgres|database/.test(kind) ? "connectorDatabaseHelp" : /api|rest|mcp/.test(kind) ? "connectorApiHelp" : "connectorSourceHelp")}</p><div className="mt-2 flex flex-wrap gap-2">{connector.features.map(f => <StateBadge key={f} state={f} />)}</div>{!connector.available && <p className="mt-2 text-warning">{t("connectorUnavailable")}: {connector.dependencyStatus}</p>}</div>}
    <TextField label={t("name")} value={name} onChange={setName} required /><TextField label={t("sourceAddress")} value={endpoint} onChange={setEndpoint} required />
    <div className="flex flex-wrap gap-4">{Object.entries(capLabel).map(([cap, label]) => <label key={cap} className="flex items-center gap-2 text-body"><input type="checkbox" checked={capabilities.includes(cap)} disabled={!connector?.capabilities.includes(cap)} onChange={e => setCapabilities(v => e.target.checked ? [...v, cap] : v.filter(c => c !== cap))} />{t(label)}</label>)}</div>
    {/git|repo/.test(kind) && <><TextField label={t("sourceRevision")} value={String(configValue.ref || "")} onChange={v => updateConfig("ref", v)} /><Field label={t("linkedKnowledgeResource")}><select className="rounded-md border bg-background p-2" value={String(configValue.resource_id || "")} onChange={e => { const r = resources.data?.find(r => r.id === e.target.value); updateConfig("resource_id", e.target.value); if (r) setEndpoint(String((r.resource_ref as Record<string, unknown>).url || (r.resource_ref as Record<string, unknown>).path || "")); }}><option value="">{t("unlinkedKnowledgeResource")}</option>{resources.data?.filter(r => r.resource_type === "knowledge_repo").map(r => <option key={r.id} value={r.id}>{r.label || String((r.resource_ref as Record<string, unknown>).url || r.id)}</option>)}</select></Field></>}
    {/postgres|database/.test(kind) && <div className="grid gap-3 sm:grid-cols-2"><TextField label={t("databaseName")} value={String(configValue.database || "")} onChange={v => updateConfig("database", v)} /><TextField label={t("databaseSchema")} value={String(configValue.schema || "")} onChange={v => updateConfig("schema", v)} /></div>}
    {/api|rest/.test(kind) && <TextField label={t("discoveryPath")} value={String(configValue.discovery_path || "")} onChange={v => updateConfig("discovery_path", v)} />}
    <div className="space-y-3 rounded-lg border border-border-soft p-4"><p className="flex items-center gap-2 text-caption text-muted-foreground"><ShieldCheck className="size-4" />{t("credentialsHelp")}</p><div className="grid gap-3 sm:grid-cols-2">{authFields.map(f => <TextField key={f.name} label={f.name === "dsn" ? t("databaseDsn") : f.name === "token" ? t("bearerToken") : f.name === "username" ? t("username") : f.name === "password" ? t("password") : f.label} value={credentials[f.name] || ""} onChange={v => setCredentials(c => ({ ...c, [f.name]: v }))} type={/user|client_id/.test(f.name) ? "text" : "password"} />)}</div></div>
    <details><summary className="cursor-pointer text-body font-medium">{t("advancedConfig")}</summary><div className="mt-3"><TextArea label={t("config")} value={config} onChange={setConfig} rows={6} /></div></details><Failure error={error || save.error} /><Button type="submit" disabled={save.isPending || !name.trim() || !endpoint.trim() || !capabilities.length}>{save.isPending && <LoaderCircle className="size-4 animate-spin" />}{t("connectAndDiscover")}</Button>
  </form>;
}

function SourceDetail({ connection, connector, onEdit }: { connection: Connection; connector?: Connector; onEdit: () => void }) {
  const t = useSemanticText(), wsId = useWorkspaceId(), catalog = useQuery(catalogOptions(wsId, connection.id)), snapshots = useQuery(snapshotOptions(wsId, connection.id));
  const [entryId, setEntryId] = useState(""), [search, setSearch] = useState("");
  const discover = useSemanticMutation(wsId, () => catalogApi.discover(connection.id)), snapshot = useSemanticMutation(wsId, () => catalogApi.snapshot(connection.id));
  const toggle = useSemanticMutation(wsId, () => connection.enabled ? semanticApi.command(`/connections/${connection.id}/disable`) : semanticApi.updateConnection(connection.id, { name: connection.name, kind: connection.kind, endpoint: connection.endpoint, config: connection.config, capabilities: connection.capabilities, enabled: true }));
  const entries = catalog.data?.entries || [], selected = entries.find(e => e.id === entryId) || entries.find(e => e.fields.length || e.method || e.kind === "file") || entries[0];
  const filtered = entries.filter(e => `${e.name} ${e.path} ${e.fields.map(f => f.name).join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-5 p-5 lg:p-6"><header className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-3"><span className="rounded-lg border bg-background p-3 text-primary"><SourceIcon capabilities={caps(connection, connector ? [connector] : [])} /></span><div><h2 className="text-title-lg font-semibold">{connection.name}</h2><p className="mt-1 text-caption text-muted-foreground">{connector?.name || connection.kind} · {t("nativeConnector")}</p></div></div><div className="mt-3 flex flex-wrap gap-2">{caps(connection, connector ? [connector] : []).map(cap => <StateBadge key={cap} state={capLabel[cap as keyof typeof capLabel] ? t(capLabel[cap as keyof typeof capLabel]) : cap} />)}<StateBadge state={t(catalog.data?.state === "ready" ? "catalogReady" : catalog.data?.state === "partial" ? "catalogPartial" : "catalogUndiscovered")} /></div></div><div className="flex gap-2"><Button variant="outline" onClick={onEdit}>{t("edit")}</Button><Button disabled={discover.isPending || !connection.enabled} onClick={() => discover.mutate()}><RefreshCw className={`size-4 ${discover.isPending ? "animate-spin" : ""}`} />{discover.isPending ? t("discovering") : entries.length ? t("rediscover") : t("discover")}</Button></div></header>
    <Failure error={catalog.error || discover.error || snapshot.error || toggle.error} />
    {catalog.data?.sourceRevision && <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-border-soft bg-muted/20 px-4 py-3 text-caption"><span className="text-muted-foreground">{t("sourceRevision")} <code className="ml-2 text-foreground">{catalog.data.sourceRevision}</code></span><span className="text-muted-foreground">{t("lastDiscovered")} <time className="ml-2">{catalog.data.createdAt ? new Date(catalog.data.createdAt).toLocaleString() : "—"}</time></span></div>}
    {!!catalog.data?.warnings.length && <details className="rounded-lg border border-warning/30 p-3"><summary className="cursor-pointer text-body">{t("warnings")} · {catalog.data.warnings.length}</summary><RecordView value={catalog.data.warnings} /></details>}
    <Tabs defaultValue="catalog"><TabsList><TabsTrigger value="catalog">{t("catalog")} <span className="ml-2 text-muted-foreground">{entries.length}</span></TabsTrigger><TabsTrigger value="snapshots">{t("snapshots")}</TabsTrigger><TabsTrigger value="access">{t("access")}</TabsTrigger></TabsList>
      <TabsContent value="catalog" className="mt-4">{!entries.length ? <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed p-14 text-center"><Table2 className="size-9 text-muted-foreground/40" /><p className="max-w-md text-body text-muted-foreground">{catalog.isPending ? t("loading") : t("catalogEmpty")}</p><Button variant="outline" disabled={discover.isPending} onClick={() => discover.mutate()}>{t("discover")}</Button></div> : <div className="grid overflow-hidden rounded-xl border border-border-soft xl:grid-cols-[250px_minmax(0,1fr)]"><aside className="max-h-[680px] overflow-auto border-b border-border-soft bg-muted/15 p-3 xl:border-b-0 xl:border-r"><Input aria-label={t("searchCatalog")} placeholder={t("searchCatalog")} value={search} onChange={e => setSearch(e.target.value)} className="mb-3" /><CatalogList entries={filtered} allEntries={entries} selectedId={selected?.id} onSelect={setEntryId} /></aside>{selected && <CatalogInspector key={selected.id} connection={connection} entry={selected} digest={catalog.data?.sourceDigest || ""} />}</div>}</TabsContent>
      <TabsContent value="snapshots" className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3 py-3"><p className="max-w-xl text-body text-muted-foreground">{t("snapshotHelp")}</p><Button disabled={snapshot.isPending || !connection.enabled} onClick={() => snapshot.mutate()}>{snapshot.isPending && <LoaderCircle className="size-4 animate-spin" />}{t("captureSnapshot")}</Button></div><Failure error={snapshots.error} />{!snapshots.data?.length && <p className="rounded-xl border border-dashed p-8 text-body text-muted-foreground">{t("snapshotEmpty")}</p>}{snapshots.data?.map(s => <details key={s.id} className="rounded-xl border border-border-soft p-4"><summary className="cursor-pointer"><span className="text-body font-medium">{s.sourceRevision || s.id}</span><span className="ml-3 text-caption text-muted-foreground">{s.documents.length} {t("documents")} · {new Date(s.createdAt).toLocaleString()}</span></summary><p className="my-3 break-all font-mono text-caption text-muted-foreground">{s.sourceDigest}</p>{s.documents.map(d => <details key={d.id || d.sourcePath} className="mt-2 rounded-md border p-3"><summary className="cursor-pointer text-body">{d.sourcePath || d.id}</summary><p className="my-2 break-all font-mono text-caption text-muted-foreground">{d.sourceCommit || d.sourceHash}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-caption">{d.content}</pre></details>)}</details>)}</TabsContent>
      <TabsContent value="access" className="space-y-4 pt-3"><div className="rounded-xl border border-border-soft p-5"><h3 className="mb-3 text-body font-semibold">{t("endpoint")}</h3><p className="break-all font-mono text-caption">{connection.endpoint}</p><h3 className="mb-3 mt-6 text-body font-semibold">{t("config")}</h3><RecordView value={connection.config} /><p className="mt-4 flex items-center gap-2 text-caption text-muted-foreground"><ShieldCheck className="size-4" />{t("credentialsHelp")}</p></div><Button variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate()}>{connection.enabled ? t("disable") : t("enable")}</Button></TabsContent>
    </Tabs></div>;
}

function CatalogList({ entries, allEntries, selectedId, onSelect }: {
  entries: CatalogEntry[];
  allEntries: CatalogEntry[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const groups = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const path = entry.path || entry.name;
    const folder = ["document", "file"].includes(entry.kind) && path.includes("/")
      ? path.slice(0, path.lastIndexOf("/"))
      : "";
    groups.set(folder, [...(groups.get(folder) || []), entry]);
  }
  function depth(entry: CatalogEntry) {
    let parent = entry.parentId, count = 0;
    const seen = new Set([entry.id]);
    while (parent && !seen.has(parent) && count < 6) {
      seen.add(parent); count++;
      parent = allEntries.find(e => e.id === parent)?.parentId;
    }
    return count;
  }
  function row(entry: CatalogEntry, folder: string) {
    const label = folder ? (entry.path || entry.name).split("/").pop() : entry.name || entry.path;
    return <button key={entry.id} title={entry.path || entry.name}
      className={`mb-1 flex w-full items-center gap-2 rounded-md py-2.5 pr-2 text-left text-caption hover:bg-muted ${selectedId === entry.id ? "bg-surface-selected font-semibold" : ""}`}
      style={{ paddingLeft: 8 + depth(entry) * 12 }} onClick={() => onSelect(entry.id)}>
      {entry.capabilities.includes("actions") ? <Zap className="size-3.5 shrink-0 text-chart-4" /> : entry.fields.length ? <Table2 className="size-3.5 shrink-0 text-chart-2" /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="truncate">{label}</span>
      {entry.fields.length > 0 && <span className="ml-auto text-muted-foreground">{entry.fields.length}</span>}
    </button>;
  }
  return <>{Array.from(groups, ([folder, children]) => folder
    ? <details key={folder} open className="mb-2"><summary title={folder} className="mb-1 cursor-pointer break-all py-2 text-caption text-muted-foreground"><Folder className="mr-1.5 inline size-3.5" />{folder}</summary><div className="ml-2 border-l border-border-soft pl-2">{children.map(e => row(e, folder))}</div></details>
    : children.map(e => row(e, "")))}</>;
}

function CatalogInspector({ connection, entry, digest }: { connection: Connection; entry: CatalogEntry; digest: string }) {
  const t = useSemanticText(), wsId = useWorkspaceId(), paths = useWorkspacePaths(), nav = useNavigation();
  const [parameters, setParameters] = useState("{}"), [result, setResult] = useState<unknown>();
  const preview = useSemanticMutation(wsId, async () => { const value = await catalogApi.preview(connection.id, entry.id, JSON.parse(parameters)); setResult(value.records); return value; });
  const isAction = entry.capabilities.includes("actions") || !!entry.method && !["GET", "HEAD", "OPTIONS"].includes(entry.method.toUpperCase());
  return <section className="min-w-0 space-y-5 p-5"><header><div className="mb-2 flex items-center gap-2"><StateBadge state={entry.kind} />{entry.method && <StateBadge state={entry.method} />}</div><h3 className="break-words text-title font-semibold">{entry.name}</h3><p className="mt-2 text-body leading-relaxed text-muted-foreground">{entry.description}</p>{entry.path && <p className="mt-3 break-all rounded-md bg-muted/40 p-3 font-mono text-caption">{entry.path}</p>}</header>
    {entry.fields.length > 0 && <div className="overflow-auto rounded-lg border border-border-soft"><table className="w-full text-left text-caption"><thead className="bg-muted/40"><tr>{(["fields", "type", "nullable", "description"] as const).map(k => <th key={k} className="p-3 font-medium">{t(k)}</th>)}</tr></thead><tbody>{entry.fields.map(f => <tr key={f.name} className="border-t border-border-soft"><td className="p-3 font-mono">{f.name}{f.primaryKey && <KeyRound aria-label={t("primaryKey")} className="ml-2 inline size-3 text-primary" />}</td><td className="p-3 text-muted-foreground">{f.type}</td><td className="p-3 text-muted-foreground">{f.nullable ? t("yes") : t("no")}</td><td className="p-3 text-muted-foreground">{f.description}</td></tr>)}</tbody></table></div>}
    {entry.relationships.length > 0 && <div><h4 className="mb-2 text-body font-medium">{t("relations")}</h4><RecordView value={entry.relationships} /></div>}
    {(Object.keys(entry.inputSchema).length > 0 || Object.keys(entry.outputSchema).length > 0) && <div className="space-y-4">{([["inputSchema", entry.inputSchema], ["outputSchema", entry.outputSchema]] as const).map(([key, value]) => Object.keys(value).length > 0 && <details key={key} open={key === "inputSchema"}><summary className="cursor-pointer text-body font-medium">{t(key)}</summary><div className="mt-3"><SchemaFields schema={value} /></div></details>)}</div>}
    {(entry.callExample != null || entry.operationId) && <div className="space-y-3 rounded-lg border border-border-soft p-4"><h4 className="text-body font-semibold">{t("invocation")}</h4>{entry.operationId && <code className="text-caption">{entry.operationId}</code>}<RecordView value={entry.callExample} /></div>}
    <div className="space-y-3 border-t border-border-soft pt-4"><p className="flex items-start gap-2 text-caption leading-relaxed text-muted-foreground">{isAction ? <Zap className="size-4 shrink-0 text-chart-4" /> : <ShieldCheck className="size-4 shrink-0 text-success" />}{isAction ? t("writeDocumentation") : t("previewReadOnly")}</p>{!isAction && Object.keys(entry.inputSchema).length > 0 && <TextArea label={t("operationParameters")} value={parameters} onChange={setParameters} rows={3} />}<div className="flex flex-wrap gap-2">{!isAction && <Button variant="outline" disabled={preview.isPending || !connection.enabled} onClick={() => preview.mutate()}>{preview.isPending && <LoaderCircle className="size-4 animate-spin" />}{t(["document", "file"].includes(entry.kind) ? "previewDocument" : "previewData")}</Button>}<Button variant="outline" onClick={() => nav.push(`${paths.agentsTab("ontologies")}&source=${encodeURIComponent(connection.id)}&entry=${encodeURIComponent(entry.id)}`)}>{t("useBinding")}<ChevronRight className="size-4" /></Button></div><Failure error={preview.error} />{result !== undefined && <div className="space-y-2"><h4 className="text-body font-medium">{t("sampleResults")}</h4><RecordView value={result} /></div>}</div>
    <details><summary className="cursor-pointer text-caption text-muted-foreground">{t("metadata")}</summary><p className="my-2 break-all font-mono text-caption text-muted-foreground">{digest}</p><RecordView value={entry.metadata} /></details>
  </section>;
}
