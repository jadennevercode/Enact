---
name: enact-application-building
description: Generate, refine, build and publish persistent Enact business applications backed by published ontology queries and system actions. Use for application creation or changes, previews and version publication.
---

# Build an Enact application

Read the application's purpose, pinned ontology release, data/action bindings and existing builds before editing. Use the existing agent runtime and project resources for source work. A business application should expose its primary task immediately, with readable operational data, business context, evidence, action parameters and results.

Generate React/TypeScript source and a reproducible `npm run build` producing `dist/index.html` and packaged assets. Bundle JavaScript as IIFE (for example with esbuild `--bundle --format=iife`); inline CSS or produce packaged stylesheet files. The application host blocks external scripts, fetch, frames and forms to other origins. Include all dependencies and images in the build. Use Enact's supplied `window.enact.call(operation, input)` for all business operations; see [runtime API](references/runtime-api.md).

Source belongs to the application authoring project. Preserve existing changes. Record the business request and tests alongside each revision. Prefer a clear domain-specific layout over a generic JSON editor; expose technical payloads only as expandable evidence for technical users.

## Preview and revise

The bundled `scripts/build.py` copies source into an isolated build directory, builds in a Docker Node container by default, packages the output and optionally saves it to Enact. Container build receives no Enact token or enterprise credentials. `--local` is only for source explicitly trusted to execute on the current machine.

```bash
python3 <skill>/scripts/build.py <source-directory> --app-id <application-id> --release-id <release-id> --queries @ontology,query.stock,query.case --actions action.freeze,action.stop --save
```

Set `ENACT_SERVER_URL`, `ENACT_TOKEN` and `ENACT_WORKSPACE_ID` through the normal Enact runtime, never in source files. Without `--save` the tool only creates `application-build.json` in the requested output directory. The build report records what was actually run. Add an `npm test` script for business interactions; passing build compilation does not prove workflow behavior.

Open the application's Enact preview and test its actual interactions with connected data. Save revisions until the request is fulfilled. Saving a build does not publish it. A human with workspace publication access reviews the exact digest and publishes using the application Versions page. Preserve any authorization the user already provided; never fabricate a publication approval or bypass server role checks.

## Operational correctness

- Create or continue a semantic run for the user's investigation. Show its pinned release and the time of queried data.
- Query data before recommending actions. Only rule evaluations based on persisted successful query steps count as evidence.
- Prepare actions using the bound operation. Show the scope and parameters; human confirmations are handled by the host and business approvals by the connected system.
- A request accepted by a system is pending until its receipt and readback establish the intended result. Show unknown results and offer reconciliation; do not retry a write with a fresh key.
- Use separate operations for freezing, stopping, releasing stock and restarting production. Preserve partial cross-plant success and the remaining exposure.
- Never put tokens, database credentials or raw personal data in source or build metadata.

## Continue a saved application

List saved builds with `GET /api/semantic/apps/{app_id}/builds`, choose the version to revise, then restore its exact source into an empty task directory:

```bash
python3 <skill>/scripts/restore.py <empty-source-directory> --app-id <application-id> --build-id <build-id>
```

The restore tool checks the source digest and refuses to overwrite existing work. Revise, test and build a new version. The application retains its prior published build until another reviewed digest is published; publishing an older build is a recorded rollback.
