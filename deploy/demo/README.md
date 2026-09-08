# Demo account deployment bundle

This directory contains an **encrypted** snapshot of
`demo@deloittecn.com.cn`, all five of its workspaces, their attachments, and
the Quality Source dependencies. The key is delivered separately; it is never
committed or copied into a container image.

`demo.enc.manifest.json` records the snapshot time, table counts and workspace
IDs. `demo.enc.parts.json` authenticates the order/checksums of the encrypted
parts. The importer also verifies the AES-256-GCM authentication tag and each
attachment checksum before writing anything.

## Import without overwriting existing accounts

1. Deploy this code and let the normal backend entrypoint finish its migrations.
   Use the existing instance's `.env`, database, upload volume and encryption
   keys. **Do not restore a complete Enact database dump or replace `.env`.**
2. Place the separately supplied `demo-bundle.key` outside the repository with
   owner-only permissions. Set `DEMO_BUNDLE_KEY_FILE` to its absolute path.
3. Set `DEMO_ACCOUNT_PASSWORD` to a new 8–72 byte password. It is required only
   when creating the demo account; an existing demo account keeps its password.
   The source account had no password hash. There is no built-in demo password.
4. Keep the destination's existing `ENACT_SEMANTIC_SECRET_KEY`. The Source
   credentials are re-encrypted under that key; the source instance key is not
   required and was not exported. Configure a fresh key only on a new instance.
5. Set `DEMO_SUPPLEMENTAL_DIR` to a private directory for the dependency archives.
   Run a real rollback rehearsal:

```sh
docker compose -f docker-compose.selfhost.yml -f docker-compose.demo.yml \
  --profile demo run --build --rm demo-import
```

6. After the rehearsal passes, import:

```sh
docker compose -f docker-compose.selfhost.yml -f docker-compose.demo.yml \
  --profile demo run --rm demo-import --apply
```

Use the same Compose project name as the existing deployment so that the
database and `backend_uploads` volume refer to that instance. The optional
import service never runs during ordinary backend startup.

The database import is one transaction. Existing account emails, names,
passwords and memberships are never updated. The importer creates a separate
identity when the source UUID belongs to an original account such as
`jaden@example.com`; references and per-user Source credentials follow the new
identity. If the demo email already exists, its existing identity is reused.

An existing row or file with different content causes a complete database
rollback. Workspace ID/slug conflicts are errors, not silent overwrites or
partial merges. An unchanged bundle can be imported repeatedly without creating
duplicates. If imported content has since been edited, stop and reconcile the
conflict explicitly; do not delete the existing workspaces to force a restore.
File writes are additive: a failed commit can leave unreferenced new files, but
cannot replace an existing file or commit a missing attachment.

Automatic tasks are paused, triggers disabled, active source executions
cancelled, and runtimes marked offline during import. Reconnect runtimes and
review schedules before enabling execution. Historical content is preserved.
Ephemeral login/PAT/task/daemon tokens, deduplication leases, global cron state,
and unrelated accounts are excluded; see the manifest for the complete list.

## Quality Sources and external runtime data

All four Source definitions are included:

| Source | Original binding | Included dependency |
| --- | --- | --- |
| Quality Knowledge Git | `file:///knowledge/quality` | Knowledge archive and exact source commit |
| Quality Operations API | `http://host.docker.internal:18180` | API runtime source and backing PostgreSQL backup |
| Quality Reference PostgreSQL | `host.docker.internal:15439/quality_reference_integration` | Authenticated encrypted database backup |
| Quality MCP Tools | `http://host.docker.internal:18180/mcp` | Same API runtime, MCP implementation and per-user credentials |

The supplemental directory contains:

- `dependencies.json`: source coordinates and original bindings.
- `quality-knowledge.tar.gz`: committed knowledge files; original repository
  `https://github.com/jadennevercode/QualityTraceability`, commit
  `2b0c1432252abf485f8aac48295f7eeef759ddaa`.
- `quality-runtime.tar.gz`: the current local API/MCP implementation.
- `quality-reference.dump.enc`: the actual reference PostgreSQL database,
  including persisted business records; global database roles are not exported.
- `quality-source-credentials.enc`: only this account's three Source credential
  sets. The importer automatically rebinds them to the destination demo user.
- `semantic-runtime-source.tar.gz`: the current Semantica runtime implementation,
  including local changes; build with its
  `semantica/semantic_service/Dockerfile`.
- `semantic-demo.tar.gz`: the semantic scope belonging to Quality Ontology Lab,
  including persisted artifacts, checkpoints, provenance and reasoning state.

The database and credential files have an additional encryption layer using
the same separately delivered bundle key. To decrypt a dependency into a **new**
owner-only file:

```sh
node scripts/account-bundle.mjs decrypt \
  --bundle /private/demo-dependencies/quality-reference.dump.enc \
  --key /secure/demo-bundle.key --output /private/quality-reference.dump
```

Restore that dump with `pg_restore --no-owner --no-privileges --exit-on-error`
into a **new, dedicated, empty** Quality PostgreSQL database. Never use `--clean`
or point this restore at the existing Enact database. The database name is
`quality_reference_integration`. Provision the dedicated reference database
login to match the PostgreSQL Source credential, or explicitly update that
Source credential after restoring. The same decrypt command can write
`quality-source-credentials.enc` to a new private JSON file for this setup;
never commit that file.

Run the packaged Quality API with `QT_DATABASE_URL` targeting the restored
reference database. Its code is shared by REST and MCP. Recreate its bearer
identities with the same roles/plant scopes as the transferred connection
credentials; the reference runtime's `QT_DEV_MODE=1` supports its original
reference identities. Set `QT_SEED_ON_START=0` to preserve the restored state.

Both the backend and Semantica must reach the configured Source endpoints.
Preserve the original host/port bindings where available, and mount the exact
Quality knowledge checkout read-only at `/knowledge/quality` in both services.
If a destination already uses those ports, choose new endpoints for the demo
Sources only, rediscover the catalogs and revalidate releases; do not redirect
other users' connections or change their host aliases.

Extract the semantic archive into an empty semantic state directory/volume,
preserving its scope directory and service ownership. Refuse existing paths
with different contents. `docker-compose.semantic.yml` can build the packaged
runtime by setting `SEMANTICA_SOURCE_DIR` to its extracted root. Retain the
destination's existing service keys and Source allowlists, adding the demo
origins/knowledge path as needed.

No target server was specified when this bundle was published. The code and
data are deployment-ready artifacts; uploading them does not deploy a server.
After restore, verify each Source discovery/preview, open the saved ontology,
and read the published application's existing run before re-enabling writes.

## Verification performed

- Account bundle encryption, tamper rejection, path/symlink containment,
  distinct account identity and credential fingerprint tests passed.
- Isolated PostgreSQL import with an original account using the source UUID:
  the original email, password and membership remained unchanged; demo had all
  five memberships and all 106 attachment records.
- Repeated import produced no duplicate accounts/workspaces. Deliberately
  conflicting issue content was rejected without changing existing rows.
- Exact JSON values of ontology drafts, release artifacts and packaged
  application files matched the source after import.
- The final encrypted parts imported successfully with a different destination
  key. All three Source credential sets were rebound only to the new demo user,
  and their fingerprints matched the saved Source catalogs.
- The encrypted Quality PostgreSQL backup restored into a new isolated database
  successfully, including its 22 business resources.
- Frontend typecheck passed. Focused core/view tests passed (22 tests).
- Focused Go semantic, semanticapp, modeloperation, ontologizer and agent tests
  passed; handler tests compiled/passed with DB-dependent tests subject to their
  normal availability guards. This is not a claim of a full production E2E run.
