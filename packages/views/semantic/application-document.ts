import type { ApplicationBuild } from "@enact/core/semantic";

function decode(content: string) {
  return new TextDecoder().decode(
    Uint8Array.from(atob(content), (c) => c.charCodeAt(0)),
  );
}
const bootstrap = `(()=>{let port;let next=0;const pending=new Map();window.enact={call(operation,input={}){return new Promise((resolve,reject)=>{if(!port){reject(new Error('Application connection is not ready'));return;}const id=String(++next);pending.set(id,{resolve,reject});port.postMessage({id,operation,input});});}};window.addEventListener('message',event=>{if(event.source!==parent||event.data?.type!=='enact.application.init'||!event.ports[0]||port)return;port=event.ports[0];port.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);e.data.ok?p.resolve(e.data.value):p.reject(new Error(e.data.error));};port.start();window.dispatchEvent(new Event('enact-ready'));});parent.postMessage({type:'enact.application.ready'},'*');})();`;

/** Rewrites packaged assets to data/inline content; no source URL receives viewer data. */
export function buildApplicationDocument(build: ApplicationBuild): string {
  const files = build.files ?? {};
  const entry = files[build.manifest.entry];
  if (!entry) throw new Error("Application entry is missing");
  const doc = new DOMParser().parseFromString(
    decode(entry.content),
    "text/html",
  );
  const asset = (name: string, from: string = build.manifest.entry) => {
    const resolved = new URL(name, new URL(from, "https://enact.invalid/"));
    if (resolved.origin !== "https://enact.invalid" || resolved.search)
      return undefined;
    return files[decodeURIComponent(resolved.pathname.slice(1))];
  };
  const dataUrl = (name: string, from: string = build.manifest.entry) => {
    const f = asset(name, from);
    if (!f) throw new Error(`Missing packaged asset: ${name}`);
    return `data:${f.mediaType};base64,${f.content}`;
  };
  for (const node of doc.querySelectorAll("base,meta,iframe,object,embed"))
    node.remove();
  for (const node of doc.querySelectorAll("script[src]")) {
    const src = node.getAttribute("src") ?? "";
    const file = asset(src);
    if (!file) throw new Error(`External or missing script: ${src}`);
    if (node.getAttribute("type") === "module")
      throw new Error(
        "Bundle the application as an IIFE; module scripts are not supported",
      );
    node.removeAttribute("src");
    node.removeAttribute("type");
    node.textContent = decode(file.content);
  }
  for (const node of doc.querySelectorAll('link[rel="stylesheet"]')) {
    const href = node.getAttribute("href") ?? "";
    const file = asset(href);
    if (!file) throw new Error(`External or missing stylesheet: ${href}`);
    const style = doc.createElement("style");
    style.textContent = decode(file.content).replace(
      /url\(["']?([^)'"\s]+)["']?\)/g,
      (_match, name: string) =>
        `url("${name.startsWith("data:") || name.startsWith("#") ? name : dataUrl(name, href)}")`,
    );
    node.replaceWith(style);
  }
  for (const node of doc.querySelectorAll("link")) node.remove();
  for (const node of doc.querySelectorAll("img,source,video,audio")) {
    const src = node.getAttribute("src");
    if (src && !src.startsWith("data:")) node.setAttribute("src", dataUrl(src));
    node.removeAttribute("srcset");
  }
  for (const node of doc.querySelectorAll("a")) {
    node.removeAttribute("href");
    node.removeAttribute("target");
  }
  const csp = doc.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; worker-src 'none'";
  const script = doc.createElement("script");
  script.textContent = bootstrap;
  doc.head.prepend(script);
  doc.head.prepend(csp);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}

// A trusted parent frame restricts navigation of the generated document. A
// document's own connect-src policy does not prevent it navigating itself.
export function buildApplicationEnvelope(build: ApplicationBuild): string {
  const document = JSON.stringify(buildApplicationDocument(build)).replaceAll(
    "<",
    "\\u003c",
  );
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; frame-src about:; connect-src 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'"><style>html,body,iframe{width:100%;height:100%;margin:0;border:0}body{overflow:hidden}</style></head><body><script>
const app=document.createElement('iframe');app.title='Application content';app.setAttribute('sandbox','allow-scripts');app.referrerPolicy='no-referrer';
window.addEventListener('message',event=>{
 if(event.source===app.contentWindow&&event.data?.type==='enact.application.ready')parent.postMessage({type:'enact.application.ready'},'*');
 if(event.source===parent&&event.data?.type==='enact.application.init'&&event.ports[0])app.contentWindow.postMessage({type:'enact.application.init'},'*',[event.ports[0]]);
});
app.srcdoc=${document};document.body.append(app);
</script></body></html>`;
}
