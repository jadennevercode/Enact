# Scoped Semantica Explorer integration

This integration preserves the adjacent MIT LICENSE from Semantica.

## Reused upstream implementation

- `small-graph-layout.ts` and `ontology-editor-model.ts`: extracted Semantica Explorer component layout and editor model.
- `node-hover.ts`: original `sigmaNativeRendering.ts` hover card adapted to Enact theme tokens.
- `behaviors/clickSelectionBehavior.ts`, `hoverActivationBehavior.ts`, `fitViewBehavior.ts`, `focusCameraBehavior.ts`, `pathHighlightBehavior.ts`: original Explorer interaction plugins. The local `types.ts` injects a graph rather than importing the Explorer global store.
- `graph-canvas.tsx`: GraphCanvas / SceneAdapter lifecycle, Sigma renderer and ForceAtlas2 worker adapted to a React-owned graph, Enact typography, scoped selection and accessibility. Path sweep is omitted for reduced motion.
- `graph-scene.ts`: Graphology scene construction, original Louvain community algorithm, original Dijkstra path algorithm, and neighborhood traversal, adapted into pure functions.

Source repository: https://github.com/semantica-agi/semantica/tree/main/explorer/src/workspaces

The local upstream checkout has HEAD c449209 and later uncommitted Explorer changes. This integration does not claim every reused file belongs to the committed revision. Review the copied files and this license as the provenance of the integration.

## Product adaptation

The surrounding Enact interface supplies Full / Grouped / Focused modes, label search, kind/layer filters, neighborhood depth, distance heatmap, pause/run layout, zoom/fit, member expansion, shortest directed paths, and a keyboard-accessible list and inspector. Group nodes are presentation-only and never written back as ontology facts.

Each canvas owns its graph, worker, selection and cleanup. No iframe embeds the global Explorer application. The default business projection keeps attributes on entities, shows first-class actions and policies, and excludes PROV blank nodes. Evidence and native details remain expandable.

The renderer caps projections at 500 nodes / 1500 edges, prioritizes selected/path nodes and displays a partial-results notice. This is a rendering bound, not proof of backend pagination or enterprise performance acceptance. The text alternative is available when WebGL is unavailable.
