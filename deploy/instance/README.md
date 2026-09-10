# Complete Enact instance snapshot

Snapshot captured on 2026-09-10 (UTC) for `jadennevercode/Enact-Onto`.
This is a complete encrypted instance backup, separate from the older five-workspace
account bundle in `deploy/demo`. Publishing this repository does not start a server
or import data into a hosted application.

## Contents

- Main Enact database: all **242 workspaces**, **134 tables**, **81,374 rows**,
  including 161 issues and 112 attachment records. No tables or accounts filtered.
- Seven additional development/integration databases (eight databases total).
  They contain 343 workspace rows across their independent database histories;
  this is not a count of unique production workspaces.
- Entire backend upload volume: 205 files, including every referenced attachment.
- Entire semantic persistent volume: 688 files, including artifacts, checkpoints,
  ontology state, provenance, reasoning state and historical results.
- Local Agent task workspaces: 6,478 files, plus the local daemon profile/logs.
- Local development upload directories, current Semantica and QualityTraceability
  source snapshots (tracked files plus non-ignored local changes), and the Quality
  reference PostgreSQL database.
- Instance configuration, original connection-encryption keys, source environment
  and the key for the previous demo archive, all inside encrypted components.

`manifest.json` contains checksums, file sizes, counts and verification results.
Workspace identities, record content and credentials are stored only in ciphertext.
The new backup key is never included in this repository or in these archives.

## Encryption and integrity

Each component uses AES-256-GCM with a fresh nonce and the existing `ENACTB01`
format. Capture streams directly from PostgreSQL or tar into encryption; no
plaintext backup staging files were created. Large ciphertext files are split
into 40 MiB parts for GitHub. The restore helper reassembles them, verifies part
and complete-file hashes, and authenticates the GCM tag before releasing plaintext.

Keep the separately supplied base64 key in an owner-only file outside a checkout:

```sh
export ENACT_SNAPSHOT_KEY=/secure/enact-onto-backup.key
chmod 600 "$ENACT_SNAPSHOT_KEY"
```

Verify all distributed files before restoring:

```sh
python3 - <<'PY'
import hashlib, json, pathlib
root = pathlib.Path('deploy/instance')
for name, expected in json.loads((root / 'manifest.json').read_text())['files'].items():
    path = root / name
    assert path.stat().st_size == expected['bytes'], name
    assert hashlib.sha256(path.read_bytes()).hexdigest() == expected['sha256'], name
print('All encrypted components and part manifests verified.')
PY
```

## Restore into a new instance

Use PostgreSQL 17 with pgvector, Node.js 22+, and the code in this repository.
Provision an **empty, isolated** destination database and empty destination volumes.
The full instance dump contains account authentication and scheduled execution
state; keep application workers/daemons disconnected until schedules, connection
endpoints and session credentials have been reviewed for the new instance.
Do not merge this full dump into an existing populated database or use `--clean`.

For a newly provisioned PostgreSQL container named `enact-restore-postgres`, with
an empty database `enact` and database user `enact`:

```sh
set -o pipefail
node scripts/instance-archive.mjs decrypt "$ENACT_SNAPSHOT_KEY" \
  deploy/instance/enact.dump.enc \
  | docker exec -i enact-restore-postgres pg_restore \
      -U enact -d enact --no-owner --no-privileges --exit-on-error
```

The logical filename above works for both whole files and `.parts.json` manifests.
Restore each additional database listed in `manifest.json` into its own newly
created empty database with the same command. Preserve the databases separately.
PostgreSQL cluster roles are not exported; provision destination login roles and
passwords as needed. Application account records are included in the dumps.

Decrypt tar components directly into **empty private directories** or new volumes:

```sh
mkdir -m 700 /secure/enact-uploads /secure/enact-semantic
node scripts/instance-archive.mjs decrypt "$ENACT_SNAPSHOT_KEY" \
  deploy/instance/uploads.tar.enc | tar -xf - -C /secure/enact-uploads
node scripts/instance-archive.mjs decrypt "$ENACT_SNAPSHOT_KEY" \
  deploy/instance/semantic-state.tar.enc | tar -xf - -C /secure/enact-semantic
```

Inspect the archive layout with the same decrypt command piped to `tar -tf -`.
Mount the recovered upload content at `/app/data/uploads` and semantic content at
`/data`. Source archives are rooted at repository contents; local directory
archives retain their directory name. Agent workspaces can contain absolute
symlinks and local paths: map them to the destination before reconnecting a daemon.
No symlink targets outside the captured directories were followed during capture.

Retrieve `source.env.enc` and `container-configuration.json.enc` only into private
configuration storage. Preserve original application encryption keys so saved
Source credentials remain readable; update database/service addresses for the new
host. Do not expose the configuration through Git or copy secrets into images.
Run the normal application migrations after database restore, before enabling the
new backend. The archive preserves the source migration ledger.

`quality-source.tar.enc` includes the current Quality REST/MCP runtime. Rebuild
its environment from the included dependency files, restore the dedicated
`quality_reference_integration` database, and set `QT_SEED_ON_START=0` to preserve
business state. The original Quality endpoints are described in `deploy/demo/README.md`.
`semantic-runtime-source.tar.enc` builds with `semantica/semantic_service/Dockerfile`.
Reconnect local Sources and daemon paths to the restored instance.

## Verification and consistency

All eight databases were actually restored into a network-isolated PostgreSQL 17
container whose database storage was tmpfs. Every main-database table count
matched. All 112 attachment records resolved to archived local files. Every
component authenticated successfully and all eight tar archives were fully read.
Streaming encryption, split restore, tamper rejection, wrong-key rejection and
existing-output protection are covered by `scripts/instance-archive.test.mjs`.

Main database, upload volume and semantic volume were captured while the backend
and semantic containers were briefly paused; both resumed after capture. Other
databases use independent transaction-consistent `pg_dump` snapshots. Local daemon
files are a live filesystem capture, not a global transaction across all systems.
