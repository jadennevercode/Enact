#!/usr/bin/env node
// Encrypted, workspace-scoped transfer. SQL identifiers come from the catalog;
// values are encoded as literals, never interpolated into a shell command.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MAGIC = Buffer.from('ENACTB01');
const qi = value => '"' + value.replaceAll('"', '""') + '"';
const lit = value => "'" + String(value).replaceAll("'", "''") + "'";
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const excluded = new Set([
  'schema_migrations', 'personal_access_token', 'daemon_token', 'task_token',
  'channel_binding_token', 'lark_binding_token', 'daemon_connection',
  'channel_inbound_message_dedup', 'lark_inbound_message_dedup',
  'github_pending_installation', 'contact_sales_inquiry', 'sys_cron_executions',
  'task_usage_hourly_dirty', 'task_usage_hourly_rollup_state', 'user_composio_connection',
]);
// Tables without workspace_id must be scoped through their owning entity.
const children = {
  agent_invocation_target: ['agent_id', 'agent'], agent_mcp_server: ['agent_id', 'agent'],
  agent_resource: ['agent_id', 'agent'], agent_skill: ['agent_id', 'agent'],
  agent_to_label: ['agent_id', 'agent'],
  autopilot_collaborator: ['autopilot_id', 'autopilot'],
  autopilot_run: ['autopilot_id', 'autopilot'],
  autopilot_subscriber: ['autopilot_id', 'autopilot'], autopilot_trigger: ['autopilot_id', 'autopilot'],
  channel_chat_session_binding: ['chat_session_id', 'chat_session'],
  channel_inbound_audit: ['installation_id', 'channel_installation'],
  channel_outbound_card_message: ['chat_session_id', 'chat_session'],
  chat_draft_restore: ['chat_session_id', 'chat_session'], chat_message: ['chat_session_id', 'chat_session'],
  github_pull_request_check_run: ['pr_id', 'github_pull_request'],
  github_pull_request_check_suite: ['pr_id', 'github_pull_request'],
  issue_dependency: ['issue_id', 'issue'], issue_pull_request: ['issue_id', 'issue'],
  issue_subscriber: ['issue_id', 'issue'], issue_to_label: ['issue_id', 'issue'],
  issue_vcs_pull_request: ['issue_id', 'issue'],
  lark_chat_session_binding: ['chat_session_id', 'chat_session'],
  lark_inbound_audit: ['installation_id', 'lark_installation'],
  lark_outbound_card_message: ['chat_session_id', 'chat_session'],
  marketplace_listing_version: ['listing_id', 'marketplace_listing'],
  marketplace_listing_file: ['version_id', 'marketplace_listing_version'],
  plugin_package_file: ['version_id', 'plugin_package_version'],
  plugin_secret: ['installation_id', 'plugin_installation'],
  plugin_storage: ['installation_id', 'plugin_installation'],
  skill_file: ['skill_id', 'skill'], skill_to_label: ['skill_id', 'skill'],
  squad_member: ['squad_id', 'squad'], task_message: ['task_id', 'agent_task_queue'],
  task_usage: ['task_id', 'agent_task_queue'], vcs_commit_status: ['connection_id', 'vcs_connection'],
};

export function seal(data, key) {
  if (key.length !== 32) throw new Error('Bundle key must contain exactly 32 bytes');
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(MAGIC);
  return Buffer.concat([MAGIC, nonce, cipher.update(zlib.gzipSync(data)), cipher.final(), cipher.getAuthTag()]);
}

export function unseal(data, key) {
  if (!data.subarray(0, 8).equals(MAGIC)) throw new Error('Unsupported bundle format');
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(8, 20));
  cipher.setAAD(MAGIC);
  cipher.setAuthTag(data.subarray(-16));
  return zlib.gunzipSync(Buffer.concat([cipher.update(data.subarray(20, -16)), cipher.final()]));
}

function psql(sql) {
  const command = JSON.parse(process.env.BUNDLE_PSQL_COMMAND || '["psql"]');
  try {
    return execFileSync(command[0], [...command.slice(1), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
      input: 'SET standard_conforming_strings=on;\n' + sql, maxBuffer: 1024 ** 3,
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    // PostgreSQL CONTEXT can contain source content/credentials: do not echo it.
    const summary = String(error.stderr || '').split('\n').find(x => x.startsWith('ERROR:'));
    throw new Error(summary || 'Database command failed; check connection and administrative permissions');
  }
}

function catalog() {
  return JSON.parse(psql(`SELECT json_build_object(
    'columns', (SELECT json_object_agg(table_name, cols) FROM (
      SELECT table_name, json_agg(json_build_object('name',column_name,'type',udt_name) ORDER BY ordinal_position) cols
      FROM information_schema.columns WHERE table_schema='public' GROUP BY table_name) c),
    'primaryKeys', (SELECT json_object_agg(tbl, cols) FROM (
      SELECT conrelid::regclass::text tbl, json_agg(a.attname ORDER BY k.n) cols
      FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(num,n)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num
      WHERE c.contype='p' AND c.connamespace='public'::regnamespace GROUP BY conrelid) p),
    'uniqueKeys', (SELECT COALESCE(json_agg(json_build_object('table',tbl,'columns',cols)),'[]') FROM (
      SELECT i.indrelid::regclass::text tbl, i.indexrelid, json_agg(a.attname ORDER BY k.n) cols
      FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(num,n)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num
      JOIN pg_class t ON t.oid=i.indrelid
      WHERE i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL
        AND t.relnamespace='public'::regnamespace AND k.n<=i.indnkeyatts
      GROUP BY i.indrelid,i.indexrelid ORDER BY i.indrelid,i.indexrelid) u),
    'foreignKeys', (SELECT COALESCE(json_agg(json_build_object('table',conrelid::regclass::text,
      'parent',confrelid::regclass::text,'columns',(SELECT json_agg(attname ORDER BY k.n)
        FROM unnest(conkey) WITH ORDINALITY k(num,n) JOIN pg_attribute a ON a.attrelid=conrelid AND a.attnum=k.num),
      'references',(SELECT json_agg(attname ORDER BY k.n) FROM unnest(confkey) WITH ORDINALITY k(num,n)
        JOIN pg_attribute a ON a.attrelid=confrelid AND a.attnum=k.num))), '[]')
      FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace),
    'migrations', (SELECT json_agg(version ORDER BY version) FROM schema_migrations));`));
}

function normalizeCatalog(meta) {
  meta.primaryKeys = Object.fromEntries(Object.entries(meta.primaryKeys).map(([k,v]) => [k.replaceAll('"',''),v]));
  for (const key of meta.uniqueKeys || []) {
    const table=key.table.replaceAll('"','');
    if (!meta.primaryKeys[table]) meta.primaryKeys[table]=key.columns;
  }
  for (const fk of meta.foreignKeys) {
    fk.table = fk.table.replaceAll('"',''); fk.parent = fk.parent.replaceAll('"','');
  }
  return meta;
}

function selection(meta, email) {
  const queries = new Map();
  const add = (table, where) => queries.set(table, `SELECT * FROM ${qi(table)} WHERE ${where}`);
  add('user', `lower(email)=${lit(email.toLowerCase())}`);
  add('workspace', `id IN (SELECT workspace_id FROM member WHERE user_id IN (SELECT id FROM b_user))`);
  for (const [table, columns] of Object.entries(meta.columns)) {
    if (queries.has(table) || excluded.has(table) || children[table]) continue;
    if (table === 'agent_task_queue') {
      add(table, 'agent_id IN (SELECT id FROM b_agent) OR issue_id IN (SELECT id FROM b_issue) OR chat_session_id IN (SELECT id FROM b_chat_session)');
    } else if (table === 'machine') add(table, 'owner_id IN (SELECT id FROM b_user)');
    else if (table === 'runtime_profile') add(table, 'workspace_id IN (SELECT id FROM b_workspace) OR owner_id IN (SELECT id FROM b_user)');
    else if (columns.some(c => c.name === 'workspace_id')) add(table, 'workspace_id IN (SELECT id FROM b_workspace)');
    else throw new Error(`No account scope policy for table ${table}; export refused`);
  }
  for (const [table, [column, parent]] of Object.entries(children)) {
    if (meta.columns[table]) add(table, `${qi(column)} IN (SELECT id FROM b_${parent})`);
  }
  const ordered = [], pending = new Map(queries);
  while (pending.size) {
    const before = pending.size;
    for (const [table, sql] of pending) {
      const deps = [...sql.matchAll(/\bb_([a-z_]+)/g)].map(m => m[1]);
      if (deps.every(d => !pending.has(d))) { ordered.push([table, sql]); pending.delete(table); }
    }
    if (pending.size === before) throw new Error('Cyclic export scope');
  }
  return ordered;
}

function walk(root, prefix = '') {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, {withFileTypes:true}).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error(`Symlink in bundle input: ${prefix}${entry.name}`);
    const rel = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? walk(path.join(root, entry.name), rel) : [rel];
  });
}

export function safePath(root, relative) {
  if (!relative || relative.includes('\\') || path.isAbsolute(relative) || relative.split('/').includes('..')) {
    throw new Error('Unsafe bundle file path');
  }
  const base = path.resolve(root), result = path.resolve(base, relative);
  if (!result.startsWith(base + path.sep)) throw new Error('File escaped bundle root');
  for (let p = result; p !== path.dirname(base); p = path.dirname(p)) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw new Error('Symlink in destination path');
  }
  return result;
}

function filesFrom(root, paths) {
  return Object.fromEntries(paths.map(relative => {
    const data = fs.readFileSync(safePath(root, relative));
    return [relative, {sha256:hash(data), content:data.toString('base64')}];
  }));
}

function exportBundle(opts, key) {
  const meta = normalizeCatalog(catalog());
  meta.jsonText = true;
  const queries = selection(meta, opts.email);
  const sql = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; WITH ${queries.map(([t,q]) => `b_${t} AS MATERIALIZED (${q})`).join(',\n')}
    SELECT json_object_agg(name, rows) FROM (${queries.map(([t]) => {
      // JSON text encoding preserves SQL NULL versus JSON null and exact
      // numeric representations inside signed semantic artifacts.
      const cols=meta.columns[t].map(c=>['json','jsonb'].includes(c.type)?`${qi(c.name)}::text AS ${qi(c.name)}`:qi(c.name));
      return `SELECT ${lit(t)} name, COALESCE(json_agg(row_to_json(t)), '[]') rows FROM (SELECT ${cols} FROM b_${t}) t`;
    }).join(' UNION ALL ')}) q; COMMIT;`;
  const tables = JSON.parse(psql(sql));
  if (tables.user.length !== 1 || !tables.workspace.length) throw new Error('Expected one account with workspaces');
  const workspaceIDs = tables.workspace.map(w => w.id);
  const filePaths = walk(opts.uploads).filter(p => workspaceIDs.some(id => p.startsWith(`workspaces/${id}/`)));
  const files = filesFrom(opts.uploads, filePaths);
  const missing = (tables.attachment || []).map(a => new URL(a.url, 'http://local').pathname)
    .filter(p => p.startsWith('/uploads/') && !files[decodeURIComponent(p.slice(9))]);
  if (missing.length) throw new Error(`${missing.length} attachment objects are missing from the source upload directory`);
  const bundle = {format:1, email:opts.email, exportedAt:new Date().toISOString(), meta, tables,
    files, excludedTables:[...excluded], sourceKeys:{}, supplemental:{}};
  if (opts.secrets) bundle.sourceKeys = JSON.parse(fs.readFileSync(opts.secrets, 'utf8'));
  if (opts.credentials) bundle.connectionSecrets = JSON.parse(unseal(fs.readFileSync(opts.credentials),key));
  if (opts.supplemental) bundle.supplemental = filesFrom(opts.supplemental, walk(opts.supplemental));
  const encrypted = seal(Buffer.from(JSON.stringify(bundle)), key);
  fs.writeFileSync(opts.bundle, encrypted, {mode:0o600, flag:'wx'});
  const summary = {format:1,email:opts.email,exportedAt:bundle.exportedAt,sha256:hash(encrypted),
    workspaces:tables.workspace.map(w => ({id:w.id,name:w.name,slug:w.slug})),
    rows:Object.fromEntries(Object.entries(tables).filter(([,v])=>v.length).map(([t,v])=>[t,v.length])),
    uploadFiles:Object.keys(files).length,supplementalFiles:Object.keys(bundle.supplemental).length,
    excludedTables:bundle.excludedTables};
  fs.writeFileSync(opts.bundle + '.manifest.json', JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary,null,2));
}

export function accountID(sourceID, email) {
  const h = hash(`enact-account-import-v1:${sourceID}:${email.toLowerCase()}`);
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

// Match encoding/json's map ordering, struct field order and HTML escaping.
const htmlJSON = s => s.replaceAll('&','\\u0026').replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
function mapJSON(v) {
  if (Array.isArray(v)) return '['+v.map(mapJSON).join(',')+']';
  if (v && typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+mapJSON(v[k])).join(',')+'}';
  return JSON.stringify(v);
}
function credentialJSON(value, secret=false) {
  const fields=secret?['credentials','headers','dsn','roles','user_credentials']:['credentials','headers','dsn','roles'];
  return '{'+fields.filter(k=>value[k] && (typeof value[k]!=='object' || Object.keys(value[k]).length)).map(k=>{
    const v=k==='user_credentials'?'{'+Object.keys(value[k]).sort().map(id=>JSON.stringify(id)+':'+credentialJSON(value[k][id])).join(',')+'}':mapJSON(value[k]);
    return JSON.stringify(k)+':'+v;
  }).join(',')+'}';
}
export function credentialRevision(connection, secret) {
  return 'sha256:'+hash(htmlJSON('{"config":'+mapJSON(connection.config)+',"endpoint":'+JSON.stringify(connection.endpoint)+',"kind":'+JSON.stringify(connection.kind)+',"secret":'+credentialJSON(secret,true)+'}'));
}

function rekey(value, sourceKey, destinationKey) {
  const data = Buffer.from(value.slice(2), 'hex');
  if (sourceKey === destinationKey) return value;
  const source = crypto.createDecipheriv('aes-256-gcm', Buffer.from(sourceKey,'base64'),data.subarray(0,12));
  source.setAuthTag(data.subarray(-16));
  const plain = Buffer.concat([source.update(data.subarray(12,-16)),source.final()]);
  // A source ciphertext has a random nonce already. Deriving the destination
  // nonce from it makes replay byte-stable without reusing a nonce for a
  // different source ciphertext under the same destination key.
  const nonce = crypto.createHmac('sha256',Buffer.from(destinationKey,'base64')).update(data).digest().subarray(0,12);
  const dest = crypto.createCipheriv('aes-256-gcm',Buffer.from(destinationKey,'base64'),nonce);
  return '\\x' + Buffer.concat([nonce,dest.update(plain),dest.final(),dest.getAuthTag()]).toString('hex');
}

function importSQL(bundle, opts) {
  const {tables, meta} = bundle;
  const source = tables.user[0];
  const sourceID = source.id;
  const existing = JSON.parse(psql(`SELECT COALESCE(json_agg(row_to_json(u)),'[]') FROM "user" u WHERE lower(email)=${lit(bundle.email.toLowerCase())};`));
  if (existing.length > 1) throw new Error('Multiple destination accounts have the same email');
  const targetID = existing[0]?.id || accountID(source.id, bundle.email);
  for (const [table, rows] of Object.entries(tables)) for (const row of rows) {
    // Rewrite typed user identity references only. Do not rewrite immutable
    // artifact strings or arbitrary JSON: doing so invalidates semantic digests.
    for (const column of meta.columns[table]) {
      if (column.type === 'uuid' && row[column.name] === sourceID) row[column.name] = targetID;
    }
    if (table === 'attachment' && row.url?.includes('/uploads/')) row.url = '/uploads/' + row.url.split('/uploads/')[1];
    if (table === 'autopilot') row.status = 'paused';
    if (table === 'autopilot_trigger') row.enabled = false;
    if (['agent','agent_runtime','machine'].includes(table)) row.status = 'offline';
    if (table === 'agent_task_queue' && ['queued','dispatched','running','waiting'].includes(row.status)) {
      row.status = 'cancelled'; row.error = 'Source execution stopped for account migration';
      row.completed_at = bundle.exportedAt;
    }
  }
  const secretColumns = {
    semantic_connection: ['ENACT_SEMANTIC_SECRET_KEY', ['secret']],
    vcs_connection: ['ENACT_VCS_SECRET_KEY',['access_token_encrypted','webhook_secret_encrypted']],
  };
  for (const [table,[env,columns]] of Object.entries(secretColumns)) for (const row of tables[table] || []) {
    for (const column of columns) if (row[column]) {
      if (table==='semantic_connection' && bundle.connectionSecrets?.[row.id]) {
        const key=Buffer.from(process.env.ENACT_SEMANTIC_SECRET_KEY || '', 'base64');
        if (key.length!==32) throw new Error('Set the destination ENACT_SEMANTIC_SECRET_KEY (32 bytes, base64)');
        const secret=structuredClone(bundle.connectionSecrets[row.id]);
        const connection={...row,config:meta.jsonText?JSON.parse(row.config):row.config};
        const oldRevision=credentialRevision(connection,secret);
        if (secret.user_credentials?.[sourceID] && sourceID!==targetID) {
          secret.user_credentials[targetID]=secret.user_credentials[sourceID];
          delete secret.user_credentials[sourceID];
        }
        const nextRevision=credentialRevision(connection,secret);
        for (const t of ['semantic_catalog_revision','semantic_source_snapshot']) for (const item of tables[t] || []) {
          if (item.connection_id===row.id && item.credential_revision===oldRevision) item.credential_revision=nextRevision;
        }
        const plain=Buffer.from(JSON.stringify(secret));
        const nonce=crypto.createHmac('sha256',key).update('enact-source-transfer-v1:'+row.id+':').update(plain).digest().subarray(0,12);
        const cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);
        row[column]='\\x'+Buffer.concat([nonce,cipher.update(plain),cipher.final(),cipher.getAuthTag()]).toString('hex');
        continue;
      }
      if (!bundle.sourceKeys[env] || !process.env[env]) {
        if (table !== 'semantic_connection') throw new Error(`Set source and destination ${env} before importing ${table}`);
        // Preserve the encrypted original in the bundle. A connection without
        // transferable credentials remains visible but cannot execute calls.
        row[column] = null; row.enabled = false;
      } else row[column] = rekey(row[column],bundle.sourceKeys[env],process.env[env]);
    }
  }
  const sql = ['BEGIN;', "SET LOCAL lock_timeout='10s';", 'SELECT pg_advisory_xact_lock(74382019);'];
  // The old schema has non-deferrable and cyclic FKs. Suppress insert-time
  // triggers only in this transaction and explicitly validate every imported
  // FK below. No existing row is updated and no constraint is removed.
  sql.push("SET LOCAL session_replication_role='replica';");
  if (!existing.length && !source.password_hash) {
    const password = process.env.DEMO_ACCOUNT_PASSWORD;
    if (!password || Buffer.byteLength(password)<8 || Buffer.byteLength(password)>72) throw new Error('Set DEMO_ACCOUNT_PASSWORD (8–72 bytes) for the new account');
    source.password_hash = psql(`SELECT crypt(${lit(password)},gen_salt('bf',10));`);
  }
  for (const [table,rows] of Object.entries(tables)) {
    if (!rows.length || (table === 'user' && existing.length)) continue;
    const cols = meta.columns[table].map(c=>c.name);
    const pk = meta.primaryKeys[table];
    if (!pk?.length) throw new Error(`No primary key for ${table}`);
    sql.push(`CREATE TEMP TABLE ${qi('b_'+table)} (LIKE ${qi(table)}) ON COMMIT DROP;`);
    const select=meta.columns[table].map(c=>meta.jsonText && ['json','jsonb'].includes(c.type)
      ? `(${qi(c.name)} #>> '{}')::${c.type}` : qi(c.name));
    sql.push(`INSERT INTO ${qi('b_'+table)} (${cols.map(qi)}) SELECT ${select} FROM json_populate_recordset(NULL::${qi(table)},${lit(JSON.stringify(rows))}::json);`);
    const match = pk.map(k=>`t.${qi(k)} IS NOT DISTINCT FROM b.${qi(k)}`).join(' AND ');
    sql.push(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM ${qi(table)} t JOIN ${qi('b_'+table)} b ON ${match}
      WHERE to_jsonb(t) IS DISTINCT FROM to_jsonb(b)) THEN RAISE EXCEPTION 'Existing data conflict in ${table}; no rows changed'; END IF; END $$;`);
    sql.push(`INSERT INTO ${qi(table)} (${cols.map(qi)}) SELECT ${cols.map(qi)} FROM ${qi('b_'+table)} b
      WHERE NOT EXISTS (SELECT 1 FROM ${qi(table)} t WHERE ${match});`);
  }
  for (const fk of meta.foreignKeys) {
    if (!tables[fk.table]?.length || (fk.table==='user' && existing.length)) continue;
    const nonnull = fk.columns.map(c=>`b.${qi(c)} IS NOT NULL`).join(' AND ');
    const match = fk.columns.map((c,i)=>`p.${qi(fk.references[i])}=b.${qi(c)}`).join(' AND ');
    sql.push(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM ${qi('b_'+fk.table)} b WHERE ${nonnull}
      AND NOT EXISTS (SELECT 1 FROM ${qi(fk.parent)} p WHERE ${match})) THEN
      RAISE EXCEPTION 'Missing dependency: ${fk.table} to ${fk.parent}'; END IF; END $$;`);
  }
  sql.push("SET LOCAL session_replication_role='origin';",opts.apply ? 'COMMIT;' : 'ROLLBACK;');
  return sql.join('\n');
}

function checkFiles(root, files, write) {
  for (const [relative,file] of Object.entries(files)) {
    const dest = safePath(root,relative), data = Buffer.from(file.content,'base64');
    if (hash(data)!==file.sha256) throw new Error('Bundle file checksum mismatch');
    if (fs.existsSync(dest)) {
      if (hash(fs.readFileSync(dest))!==file.sha256) throw new Error(`Existing file conflict: ${relative}`);
    } else if (write) {
      fs.mkdirSync(path.dirname(dest),{recursive:true});
      fs.writeFileSync(dest,data,{flag:'wx',mode:0o600});
    }
  }
}

function importBundle(opts,key) {
  let encrypted;
  if (fs.existsSync(opts.bundle)) encrypted=fs.readFileSync(opts.bundle);
  else {
    const manifest=JSON.parse(fs.readFileSync(opts.bundle+'.parts.json','utf8'));
    encrypted=Buffer.concat(manifest.parts.map(part=>{
      const bytes=fs.readFileSync(safePath(path.dirname(opts.bundle),part.name));
      if (hash(bytes)!==part.sha256) throw new Error('Encrypted bundle part checksum mismatch');
      return bytes;
    }));
    if (hash(encrypted)!==manifest.sha256) throw new Error('Encrypted bundle checksum mismatch');
  }
  const bundle = JSON.parse(unseal(encrypted,key));
  if (bundle.format!==1 || bundle.tables.user.length!==1) throw new Error('Unsupported bundle');
  const meta = normalizeCatalog(catalog());
  if (JSON.stringify(meta.migrations)!==JSON.stringify(bundle.meta.migrations)) throw new Error('Source and destination migration versions differ; deploy matching code first');
  // Validate the actual destination relationships, including any locally
  // introduced constraint, rather than trusting only the exported schema.
  bundle.meta.foreignKeys = meta.foreignKeys;
  for (const [table,rows] of Object.entries(bundle.tables)) {
    if (rows.length && JSON.stringify(meta.columns[table])!==JSON.stringify(bundle.meta.columns[table])) {
      throw new Error(`Source and destination columns differ in ${table}`);
    }
    if (!bundle.meta.primaryKeys[table]) bundle.meta.primaryKeys[table]=meta.primaryKeys[table];
  }
  checkFiles(opts.uploads,bundle.files,false);
  if (Object.keys(bundle.supplemental).length && !opts.supplemental) throw new Error('Provide --supplemental output directory for dependency backups');
  if (opts.supplemental) checkFiles(opts.supplemental,bundle.supplemental,false);
  // Perform a real rollback rehearsal even for an apply, before writing files.
  const rehearsal = importSQL(structuredClone(bundle),{apply:false});
  psql(rehearsal);
  if (opts.apply) {
    // Additive file writes can leave unreferenced files after a DB failure, but
    // never a committed attachment that points to a missing file.
    checkFiles(opts.uploads,bundle.files,true);
    if (opts.supplemental) checkFiles(opts.supplemental,bundle.supplemental,true);
    psql(importSQL(structuredClone(bundle),{apply:true}));
  }
  console.log(`${opts.apply?'Imported':'Dry run passed'}: ${bundle.email}, ${bundle.tables.workspace.length} workspaces, ${Object.keys(bundle.files).length} files. Existing accounts were preserved.`);
  if (!bundle.sourceKeys.ENACT_SEMANTIC_SECRET_KEY && !bundle.connectionSecrets) console.log('Semantic connections with credentials are disabled until reconfigured; their encrypted originals remain in the bundle.');
}

export function main(args) {
  const [command,...rest]=args, opts={};
  for (let i=0;i<rest.length;i++) {
    if (rest[i]==='--apply') opts.apply=true;
    else if (rest[i].startsWith('--') && rest[i+1]) opts[rest[i].slice(2)]=rest[++i];
    else throw new Error('Invalid arguments');
  }
  if (command==='decrypt' && opts.bundle && opts.key && opts.output) {
    const key=Buffer.from(fs.readFileSync(opts.key,'utf8').trim(),'base64');
    fs.writeFileSync(opts.output,unseal(fs.readFileSync(opts.bundle),key),{mode:0o600,flag:'wx'});
    console.log('Decrypted file written with owner-only permissions.');
    return;
  }
  if (!['export','import'].includes(command) || !opts.bundle || !opts.key || !opts.uploads) {
    throw new Error('Usage: account-bundle.mjs export|import --bundle FILE --key KEY_FILE --uploads DIR [--email EMAIL] [--secrets JSON] [--supplemental DIR] [--apply]');
  }
  const key=Buffer.from(fs.readFileSync(opts.key,'utf8').trim(),'base64');
  if (command==='export') exportBundle(opts,key); else importBundle(opts,key);
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); } catch(error) { console.error(error.message); process.exitCode=1; }
}
