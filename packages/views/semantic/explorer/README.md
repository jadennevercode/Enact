# Scoped Semantica Explorer integration

`small-graph-layout.ts` and `ontology-editor-model.ts` are extracted from the MIT licensed Semantica Explorer (semantica-agi/semantica, commit c449209). `node-hover.ts` adapts Explorer's `sigmaNativeRendering.ts` hover card with Enact theme tokens. The adjacent LICENSE preserves its copyright notice. The graph renderer adapts Explorer's Sigma/Graphology rendering, neighborhood focus, edge inspection and deterministic component layout to Enact's scoped React lifecycle, accessibility and theme tokens. It does not share the Explorer application's global graph store.

Source: https://github.com/semantica-agi/semantica/tree/main/explorer/src/workspaces
