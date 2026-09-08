"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@enact/core/hooks";
import { semanticOptions, parseSemanticSource, catalogOptions, type SemanticGraphNode } from "@enact/core/semantic";
import { useNavigation } from "../navigation";
import { Button } from "@enact/ui/components/ui/button";
import { Field, TextField, TextArea, Failure, useSemanticText } from "./shared";

type Binding = Record<string, unknown>;
const record = (value: unknown): Binding =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Binding)
    : {};
const list = (value: unknown): Binding[] =>
  Array.isArray(value) ? value.map(record) : [];
const strings = (value: string) =>
  value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

export function BindingEditor({
  value,
  onChange,
  ontologyNodes = [],
}: {
  value: string;
  onChange: (value: string) => void;
  ontologyNodes?: SemanticGraphNode[];
}) {
  const t = useSemanticText(),
    wsId = useWorkspaceId(),
    nav = useNavigation();
  const connections = useQuery(semanticOptions(wsId).connections);
  const [mode, setMode] = useState("data_bindings"),
    [id, setId] = useState(""),
    [description, setDescription] = useState(""),
    [connection, setConnection] = useState(nav.searchParams.get("source") || ""),
    [path, setPath] = useState(""),
    [method, setMethod] = useState("POST"),
    [authorization, setAuthorization] = useState("confirm"),
    [roles, setRoles] = useState(""),
    [required, setRequired] = useState(""),
    [body, setBody] = useState(""),
    [readback, setReadback] = useState(""),
    [expected, setExpected] = useState('{"status":"succeeded"}'),
    [error, setError] = useState<unknown>(),
    [catalogEntryId, setCatalogEntryId] = useState(""),
    [ontologyIri, setOntologyIri] = useState(""),
    [factMappings, setFactMappings] = useState("[]"),
    [idempotencyParameter, setIdempotencyParameter] = useState(""),
    [toolDigest, setToolDigest] = useState(""),
    [readbackDigest, setReadbackDigest] = useState("");
  const catalog = useQuery(catalogOptions(wsId, connection));
  const pickEntry = useCallback((entryId: string) => {
    const entry = catalog.data?.entries.find(e => e.id === entryId); if (!entry) return;
    setCatalogEntryId(entry.id); setDescription(entry.description); setId(entry.operationId || entry.name.toLowerCase().replace(/[^a-z0-9_]+/g, "_"));
    const action = entry.capabilities.includes("actions") || !!entry.method && !["GET", "HEAD"].includes(entry.method.toUpperCase());
    setMode(action ? "action_bindings" : "data_bindings"); setMethod(entry.method || "POST");
    const source = connections.data?.find(c => c.id === connection);
    setPath(source?.kind === "postgres" ? `SELECT * FROM ${(entry.path || entry.name).split(".").map(v => '"' + v.replaceAll('"', '""') + '"').join(".")} LIMIT 100` : source?.kind === "mcp" ? entry.operationId || entry.name : entry.path);
    setRequired(Array.isArray(entry.inputSchema.required) ? entry.inputSchema.required.join(", ") : "");
    setToolDigest(String(entry.metadata.tool_schema_digest || entry.metadata.schema_digest || ""));
  }, [catalog.data, connections.data, connection]);
  const entryFromUrl = nav.searchParams.get("entry");
  useEffect(() => { if (entryFromUrl && !catalogEntryId) pickEntry(entryFromUrl); }, [entryFromUrl, catalogEntryId, pickEntry]);
  let config: Binding = {};
  let parseError: unknown;
  try {
    config = parseSemanticSource(value);
  } catch (e) {
    parseError = e;
  }
  const selected = connections.data?.find((c) => c.id === connection);
  function edit(binding: Binding, type: string) {
    setMode(type);
    setCatalogEntryId(String(binding.catalog_entry_id || "")); setOntologyIri(String(binding.ontology_iri || "")); setFactMappings(JSON.stringify(binding.fact_mappings || [], null, 2));
    setToolDigest(String(binding.tool_schema_digest || "")); setIdempotencyParameter(String(binding.idempotency_parameter || "")); setReadbackDigest(String(record(binding.readback).tool_schema_digest || ""));
    setId(String(binding.id ?? ""));
    setDescription(String(binding.description ?? ""));
    setConnection(String(binding.connection_id ?? ""));
    setPath(String(binding.path ?? binding.sql ?? binding.tool ?? ""));
    setMethod(String(binding.method ?? "POST"));
    const auth = record(binding.authorization),
      verify = record(binding.readback);
    setAuthorization(String(auth.mode ?? "confirm"));
    setRoles(Array.isArray(auth.roles) ? auth.roles.join(", ") : "");
    setRequired(
      Array.isArray(binding.required_parameters)
        ? binding.required_parameters.join(", ")
        : "",
    );
    setBody(
      Array.isArray(binding.body_parameters)
        ? binding.body_parameters.join(", ")
        : "",
    );
    setReadback(String(verify.path ?? verify.tool ?? ""));
    setExpected(
      JSON.stringify(verify.expected ?? { status: "succeeded" }, null, 2),
    );
    setError(undefined);
  }
  function save() {
    try {
      const current = parseSemanticSource(value);

      if (!id.trim() || !connection || !path.trim())
        throw new Error(t("bindingRequired"));
      const binding: Binding = {
        ...list(current[mode]).find((b) => b.id === id.trim()),
        id: id.trim(),
        description,
        connection_id: connection,
        required_parameters: strings(required),
        ...(ontologyIri ? { ontology_iri: ontologyIri } : {}),
        ...(catalogEntryId ? { catalog_entry_id: catalogEntryId, catalog_revision_id: catalog.data?.id, catalog_digest: catalog.data?.sourceDigest } : {}),
        ...(JSON.parse(factMappings).length || list(current[mode]).find(b => b.id === id.trim())?.fact_mappings ? { fact_mappings: JSON.parse(factMappings) } : {}),
      };
      if (selected?.kind === "postgres") {
        binding.sql = path;
        binding.arguments ??= strings(required);
        delete binding.path;
        delete binding.tool;
        delete binding.method;
      } else if (selected?.kind === "mcp") {
        binding.tool = path;
        binding.tool_schema_digest = toolDigest;
        if (mode === "action_bindings") binding.idempotency_parameter = idempotencyParameter;
        delete binding.sql;
        delete binding.path;
        delete binding.method;
      } else {
        binding.path = path;
        binding.method = mode === "data_bindings" ? "GET" : method;
        delete binding.sql;
        delete binding.tool;
        delete binding.arguments;
      }
      if (mode === "action_bindings") {
        if (!readback.trim()) throw new Error(t("readbackRequired"));
        binding.authorization = {
          ...record(binding.authorization),
          mode: authorization,
          ...(authorization === "role" ? { roles: strings(roles) } : {}),
        };
        if (body.trim()) binding.body_parameters = strings(body);
        binding.readback = {
          ...record(binding.readback),
          ...(selected?.kind === "mcp" ? { tool: readback, tool_schema_digest: readbackDigest } : { path: readback }),
          expected: parseSemanticSource(expected),
        };
      }
      const other =
        mode === "data_bindings" ? "action_bindings" : "data_bindings";
      if (list(current[other]).some((b) => b.id === binding.id))
        throw new Error(t("bindingDuplicate"));
      onChange(
        JSON.stringify(
          {
            ...current,
            [mode]: [
              ...list(current[mode]).filter((b) => b.id !== binding.id),
              binding,
            ],
          },
          null,
          2,
        ),
      );
      setError(undefined);
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="space-y-5">
      <Failure error={parseError || connections.error || catalog.error || error} />
      <div className="grid gap-4 lg:grid-cols-2">
        {(["data_bindings", "action_bindings"] as const).map((type) => (
          <section className="space-y-2 rounded-lg border p-4" key={type}>
            <h3 className="font-medium">
              {type === "data_bindings" ? t("queries") : t("actions")}
            </h3>
            {list(config[type]).map((b) => (
              <div
                className="flex items-center justify-between gap-2"
                key={String(b.id)}
              >
                <button
                  type="button"
                  className="min-w-0 truncate text-left text-body underline-offset-4 hover:underline"
                  onClick={() => edit(b, type)}
                >
                  {String(b.description || b.id)}
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onChange(
                      JSON.stringify(
                        {
                          ...config,
                          [type]: list(config[type]).filter(
                            (item) => item.id !== b.id,
                          ),
                        },
                        null,
                        2,
                      ),
                    )
                  }
                >
                  {t("remove")}
                </Button>
              </div>
            ))}
          </section>
        ))}
      </div>
      <div className="space-y-4 rounded-lg border p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("kind")}>
            <select
              className="rounded-md border bg-background p-2"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="data_bindings">{t("queries")}</option>
              <option value="action_bindings">{t("actions")}</option>
            </select>
          </Field>
          <TextField label={t("bindingId")} value={id} onChange={setId} />
        </div>
        <TextField
          label={t("description")}
          value={description}
          onChange={setDescription}
        />
        <Field label={t("connections")}>
          <select
            className="rounded-md border bg-background p-2"
            value={connection}
            onChange={(e) => { setConnection(e.target.value); setCatalogEntryId(""); }}
          >
            <option value="">—</option>
            {connections.data
              ?.filter((c) => c.enabled)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.kind}
                </option>
              ))}
          </select>
        </Field>
        {connection && <Field label={t("chooseDiscoveredResource")}><select className="rounded-md border bg-background p-2" value={catalogEntryId} onChange={e => pickEntry(e.target.value)}><option value="">{catalog.data?.entries.length ? t("chooseDiscoveredResource") : t("discoverBeforeBind")}</option>{catalog.data?.entries.filter(e => e.fields.length || e.method || e.kind === "tool").map(e => <option key={e.id} value={e.id}>{e.name} {e.method ? `(${e.method})` : ""}</option>)}</select></Field>}
        <Field label={t("ontologyLayer")}><select className="rounded-md border bg-background p-2" value={ontologyIri} onChange={e => setOntologyIri(e.target.value)}><option value="">{t("selectNode")}</option>{ontologyNodes.map(n => <option key={n.id} value={n.id}>{n.label || n.name || n.id}</option>)}{ontologyIri && !ontologyNodes.some(n => n.id === ontologyIri) && <option value={ontologyIri}>{ontologyIri}</option>}</select></Field>
        {selected?.kind === "mcp" && <><TextField label={t("sourceRevision")} value={toolDigest} onChange={setToolDigest} />{mode === "action_bindings" && <><TextField label={t("idempotencyKey")} value={idempotencyParameter} onChange={setIdempotencyParameter} /><TextField label={t("readback") + " · " + t("sourceRevision")} value={readbackDigest} onChange={setReadbackDigest} /></>}</>}
        <TextArea
          label={
            selected?.kind === "postgres"
              ? t("sql")
              : selected?.kind === "mcp"
                ? t("mcpTool")
                : t("operationPath")
          }
          value={path}
          onChange={setPath}
          rows={2}
        />
        {mode === "data_bindings" && <TextArea label={t("factMappings")} value={factMappings} onChange={setFactMappings} rows={4} />}
        <TextField
          label={t("requiredParameters")}
          value={required}
          onChange={setRequired}
        />
        {mode === "action_bindings" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("method")}>
                <select
                  className="rounded-md border bg-background p-2"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  {["POST", "PUT", "PATCH", "DELETE"].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("authorization")}>
                <select
                  className="rounded-md border bg-background p-2"
                  value={authorization}
                  onChange={(e) => setAuthorization(e.target.value)}
                >
                  <option value="confirm">{t("confirmEach")}</option>
                  <option value="role">{t("businessRole")}</option>
                  <option value="allow">{t("preauthorized")}</option>
                </select>
              </Field>
            </div>
            {authorization === "role" && (
              <TextField
                label={t("businessRoles")}
                value={roles}
                onChange={setRoles}
              />
            )}
            <TextField
              label={t("bodyParameters")}
              value={body}
              onChange={setBody}
            />
            <TextField
              label={t("readbackPath")}
              value={readback}
              onChange={setReadback}
            />
            <TextArea
              label={t("expectedState")}
              value={expected}
              onChange={setExpected}
              rows={3}
            />
          </>
        )}
        {selected?.kind === "mcp" && mode === "action_bindings" && (
          <p className="text-body text-muted-foreground">{t("mcpAdvanced")}</p>
        )}
        <Button
          variant="outline"
          disabled={
            !!parseError ||
            (selected?.kind === "mcp" && mode === "action_bindings")
          }
          onClick={save}
        >
          {t("applyBinding")}
        </Button>
      </div>
      <details>
        <summary className="cursor-pointer text-body">{t("advanced")}</summary>
        <TextArea
          label={t("bindings")}
          value={value}
          onChange={onChange}
          rows={15}
        />
      </details>
    </div>
  );
}
