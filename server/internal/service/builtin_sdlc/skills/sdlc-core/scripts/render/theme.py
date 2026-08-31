"""The single stylesheet. Emitted once per document.

Two rules shape all of it:

1. Inverse ink. Normal rows carry almost no ink so the abnormal ones are what
   the eye lands on. A page where everything is coloured says nothing.
2. Never rely on colour alone. Users can switch off "background graphics" in the
   print dialog, at which point every fill disappears and only glyphs, patterns
   and prefix characters remain.
"""

CSS = """
:root{
  color-scheme: light dark;
  --bg:#fff; --fg:#16181d; --muted:#6b7280; --line:#e3e6ea; --code-bg:#f6f7f9;
  --ok:#009E73; --warn:#E69F00; --bad:#D55E00; --info:#0072B2;
  --sel:#eef2f7; --focus:#0072B2; --card:#fbfcfd;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme=light]){
    --bg:#14161a; --fg:#e7e9ee; --muted:#9aa2ae; --line:#2a2f37; --code-bg:#1b1f25;
    --ok:#3ddcac; --warn:#f0b429; --bad:#ff7a45; --info:#5aa9e6;
    --sel:#232a33; --card:#191c21;
  }
}
*{box-sizing:border-box}
body{margin:0;padding:28px 22px 60px;background:var(--bg);color:var(--fg);
  font:15px/1.65 -apple-system,"Segoe UI","Noto Sans SC",sans-serif;
  max-width:1180px;margin-inline:auto}
h1{font-size:1.6rem;margin:0 0 .2em} h2{font-size:1.22rem;margin:1.8em 0 .5em}
h3{font-size:1.02rem;margin:1.4em 0 .5em} h4{font-size:.95rem;margin:.8em 0 .3em}
code{font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code-bg);
  padding:1px 5px;border-radius:3px}
.meta{color:var(--muted);font-size:.86rem;margin:.2em 0 1.6em}
.hint{color:var(--muted);font-size:.84rem;font-weight:400}
.lede{margin:.3em 0 .9em} .empty{color:var(--muted);font-style:italic}
.bad{color:var(--bad)} .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}

/* verdict --------------------------------------------------------------- */
.verdict{border:2px solid var(--line);border-radius:10px;padding:18px 20px;margin:0 0 1.8em;
  background:var(--card)}
.verdict.v-pass{border-color:var(--ok)} .verdict.v-conditional{border-color:var(--warn)}
.verdict.v-block{border-color:var(--bad);border-width:3px}
.vlabel{font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;margin:0;color:var(--muted)}
.v-pass .vlabel{color:var(--ok)} .v-conditional .vlabel{color:var(--warn)} .v-block .vlabel{color:var(--bad)}
.vhead{font-size:1.45rem;margin:.15em 0 .6em}
.dq{margin:.5em 0 .3em;font-weight:600}
.decisions{margin:.2em 0 0;padding-left:1.4em} .decisions li{margin:.25em 0}

/* KPI ------------------------------------------------------------------- */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(178px,1fr));gap:12px;margin:1em 0 1.6em}
.kpi{border:1px solid var(--line);border-radius:8px;padding:12px 14px;background:var(--card);
  display:flex;flex-direction:column;gap:2px}
.kpi.k-bad{border-width:2px;border-color:var(--bad);box-shadow:inset 6px 0 0 var(--bad)}
.kpi.k-warn{box-shadow:inset 6px 0 0 var(--warn)}
.klabel{font-size:.82rem;color:var(--muted)}
.kvalue{font-size:clamp(1.9rem,5vw,2.9rem);font-weight:700;line-height:1.05;
  font-variant-numeric:tabular-nums}
.ref,.cnote{font-size:.8rem;color:var(--muted)}

/* matrix ---------------------------------------------------------------- */
.scrollx{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
thead th{position:sticky;top:0;background:var(--bg);font-size:.82rem;color:var(--muted);
  border-bottom:2px solid var(--line);z-index:1}
.matrix .colh span{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;font-weight:600}
.rowh{font-weight:400} .rowh code{margin-right:6px}
.rowtext{color:var(--muted);font-size:.85rem}
.rowflag{color:var(--bad);font-weight:700;margin-right:4px}
.frac{font-size:.78rem;color:var(--muted);margin-left:5px;font-variant-numeric:tabular-nums}
.m{text-align:center;font-size:15px;padding:3px 6px}
.m.full{color:var(--ok)}
.m.partial{color:var(--warn);background:color-mix(in srgb,var(--warn) 13%,transparent)}
.m.planned{color:var(--muted)}
.m.missing,.m.unknown{color:var(--bad);background:color-mix(in srgb,var(--bad) 16%,transparent);
  font-weight:700;box-shadow:inset 3px 0 0 var(--bad)}
.m.unknown{background:none;box-shadow:inset 0 0 0 1.5px var(--bad);border-radius:3px}
.m.na{color:var(--muted);opacity:.42}
tr.row-empty{background:color-mix(in srgb,var(--bad) 7%,transparent);box-shadow:inset 5px 0 0 var(--bad)}
.colsum{text-align:center;font-variant-numeric:tabular-nums;color:var(--muted)}
.colsum.zero{color:var(--bad);font-weight:700}
.legend{font-size:.82rem;color:var(--muted);margin:.6em 0 0}
.lg{margin-right:14px;white-space:nowrap}
.spark{vertical-align:middle} .sp-bg{fill:var(--line)}
.sp-ok{fill:var(--ok)} .sp-warn{fill:var(--warn)} .sp-bad{fill:var(--bad)} .sp-info{fill:var(--info)}
.sp-target{stroke:var(--fg);stroke-width:1.5}

/* tree ------------------------------------------------------------------ */
.stack{width:100%;height:10px;display:block;margin:.4em 0}
.tb.full{fill:var(--ok)} .tb.partial{fill:var(--warn)}
.tb.unknown{fill:var(--bad)} .tb.na{fill:var(--muted);opacity:.4}
ul.tree{list-style:none;padding:0;margin:.6em 0}
ul.tree li{padding:5px 0 5px 4px;border-bottom:1px solid var(--line);display:flex;gap:8px;align-items:baseline}
ul.tree li.unknown{box-shadow:inset 4px 0 0 var(--bad);padding-left:10px;font-weight:600}
ul.tree li.na{opacity:.5}
.tname{min-width:190px;font-weight:500} .tconc{color:var(--muted);font-size:.88rem}

/* graph / timeline ------------------------------------------------------ */
.graph text,.tl text{font:11.5px -apple-system,"Noto Sans SC",sans-serif;fill:var(--fg)}
.graph .n rect{fill:var(--card);stroke:var(--line);stroke-width:1}
.graph .n-blocked rect{fill:color-mix(in srgb,var(--bad) 16%,var(--card));stroke:var(--bad);stroke-width:2.5}
.graph .n-affected rect{fill:url(#p-diag);color:var(--warn);stroke:var(--warn);stroke-width:1.5;stroke-dasharray:4 3}
.graph .e{stroke:var(--line);stroke-width:1.4}
.graph .e-blocked{stroke:var(--bad);stroke-width:2.2}
.graph .e-cycle{stroke:var(--bad);stroke-width:2;stroke-dasharray:5 4}
.tl .seg{fill:var(--info);opacity:.75} .tl .seg.longstay{fill:var(--warn);opacity:.9}
.tl .seglab,.tl .staylab{font-size:10.5px;fill:var(--muted)}
.tl .gate{stroke:var(--fg);stroke-width:1.5}
.tl .g-pass{fill:var(--bg)} .tl .g-fail{fill:var(--bad);stroke:var(--bad)}
.tl .revert{stroke:var(--bad);stroke-width:1.5;stroke-dasharray:4 3;fill:none}
.tl .revlab{fill:var(--bad);font-size:12px}

/* diff / compare -------------------------------------------------------- */
.diff{font:12.5px/1.6 ui-monospace,Menlo,monospace;border:1px solid var(--line);border-radius:6px;
  overflow-x:auto;background:var(--code-bg)}
.dl{padding:1px 10px;white-space:pre}
.dl .pfx{display:inline-block;width:1.2em;color:var(--muted);user-select:none}
.dl.ins{background:color-mix(in srgb,var(--ok) 12%,transparent)}
.dl.del{background:color-mix(in srgb,var(--bad) 12%,transparent);text-decoration:line-through;
  text-decoration-color:color-mix(in srgb,var(--bad) 55%,transparent)}
.dl mark{background:color-mix(in srgb,var(--warn) 45%,transparent);color:inherit;padding:0 1px}
.part{border-left:5px solid var(--line);padding:2px 0 2px 12px;margin:.7em 0}
.part.only-declared{border-left-color:var(--bad)} .part.only-actual{border-left-color:var(--warn)}
.part.empty-part{opacity:.5} .part ul{margin:.3em 0;padding-left:1.2em}
.why{color:var(--muted);font-size:.85rem;margin:.15em 0}
.badge{background:var(--line);border-radius:10px;padding:0 8px;font-size:.78rem;
  font-variant-numeric:tabular-nums}

/* role tabs (checkbox hack, no JS) --------------------------------------- */
.roles>input{position:absolute;opacity:0;width:1px;height:1px}
.rolebar{display:flex;flex-wrap:wrap;gap:6px;margin:1.4em 0 1em;border-bottom:2px solid var(--line);
  padding-bottom:8px}
.rolebar label{cursor:pointer;padding:6px 13px;border-radius:6px 6px 0 0;font-size:.9rem;
  border:1px solid transparent}
.rolebar label:hover{background:var(--sel)}
.pane{display:none}
.roles>input:focus-visible~.rolebar label{outline:2px solid var(--focus);outline-offset:2px}
.showall-wrap{font-size:.85rem;color:var(--muted);margin:.4em 0 1em}
#showall{margin-right:6px}

/* mermaid: readable code block until it renders, then a bare container --- */
pre.mermaid{font:12px/1.55 ui-monospace,Menlo,monospace;white-space:pre;background:var(--code-bg);
  border:1px solid var(--line);border-radius:6px;padding:12px;overflow-x:auto;margin:0}
pre.mermaid[data-processed=true]{background:none;border:0;padding:0;text-align:center;overflow:visible}
figure.mmd{margin:1em 0} figcaption{font-size:.85rem;color:var(--muted);margin-top:.4em}
.sec{margin:1.6em 0} .conclusion{font-weight:500;margin:.2em 0 .7em}
details{margin:.5em 0} summary{cursor:pointer;font-size:.9rem;color:var(--muted)}

/* print ------------------------------------------------------------------ */
@page{size:A4;margin:14mm}
@media print{
  :root{color-scheme:light}
  *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
  body{padding:0;max-width:none;font-size:11.5pt}
  thead{display:table-header-group}
  thead th{position:static}
  tr,.kpi,figure,.chart,.verdict{break-inside:avoid}
  h2,h3{break-after:avoid}
  .rolebar,.showall-wrap,.no-print{display:none}
  /* Print every role. Which tab happened to be open must not decide what a
     filed PDF contains. */
  .pane{display:block!important;break-before:page}
  .pane:first-of-type{break-before:auto}
  .pane::before{content:attr(data-role);display:block;font-size:1.3rem;font-weight:700;
    margin:0 0 .6em;padding-bottom:.2em;border-bottom:2px solid}
  details{display:block} details>summary{list-style:none}
  .scrollx{overflow:visible!important}
  .matrix{font-size:9pt}
  a[href^="http"]::after{content:" (" attr(href) ")";font-size:.78em;color:#555}
}
"""
