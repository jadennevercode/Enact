import { describe, it, expect, vi } from "vitest";
import { buildApplicationDocument } from "./application-document";
import type { ApplicationBuild } from "@enact/core/semantic";
const make = (html: string): ApplicationBuild => ({
  id: "b",
  sourceRevision: "source",
  digest: "digest",
  manifest: {
    version: 1,
    entry: "index.html",
    ontologyReleaseId: "r",
    queries: [],
    actions: [],
  },
  report: {},
  sourceFiles: undefined,
  createdAt: "",
  files: {
    "index.html": { content: btoa(html), mediaType: "text/html" },
    "app.js": {
      content: btoa("document.body.dataset.ready='yes'"),
      mediaType: "text/javascript",
    },
  },
});
describe("packaged application host", () => {
  it("inlines packaged scripts and applies network restrictions before code", () => {
    const doc = buildApplicationDocument(
      make('<script src="./app.js"></script><div id="root"></div>'),
    );
    expect(doc).not.toContain('src="./app.js"');
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("worker-src 'none'");
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(
      doc.indexOf("dataset.ready"),
    );
  });
  it("rejects remote source scripts rather than fetching them with user context", () => {
    expect(() =>
      buildApplicationDocument(
        make('<script src="https://example.com/app.js"></script>'),
      ),
    ).toThrow("External or missing script");
  });
  it("removes embedded documents and static navigation", () => {
    const doc = buildApplicationDocument(
      make(
        '<iframe src="https://example.com"></iframe><a href="https://example.com">Open</a>',
      ),
    );
    expect(doc).not.toContain("example.com");
    expect(doc).not.toContain("<iframe");
  });
});

describe("packaged SDK error decoding", () => {
  function sdk() {
    const parent = { postMessage: vi.fn() };
    let receive: ((event: unknown) => void) | undefined;
    const target = {
      addEventListener: (_name: string, listener: (event: unknown) => void) => {
        receive = listener;
      },
      dispatchEvent: vi.fn(),
      enact: undefined as
        | { call: (operation: string) => Promise<unknown> }
        | undefined,
    };
    const doc = new DOMParser().parseFromString(
      buildApplicationDocument(make("<div></div>")),
      "text/html",
    );
    const script = doc.querySelector("script")!.textContent!;
    new Function("window", "parent", script)(target, parent);
    const port = {
      start: vi.fn(),
      postMessage: vi.fn(),
      onmessage: undefined as ((event: unknown) => void) | undefined,
    };
    receive!({
      source: parent,
      data: { type: "enact.application.init" },
      ports: [port],
    });
    return { call: target.enact!.call, port };
  }
  it("retains only whitelisted conflict information on the rejected Error", async () => {
    const { call, port } = sdk();
    const pending = call("action.prepare");
    const draft = {
      approval_id: "1b0bd562-2f85-441a-9c45-0e1ad6149243",
      run_id: "765d3d1d-bb5a-410f-90f1-48f31f4d770c",
      status: "pending",
    };
    port.onmessage!({
      data: {
        id: "1",
        ok: false,
        error: {
          message: "Draft exists",
          status: 409,
          existing_draft: { ...draft, secret: "hidden" },
          secret: "hidden",
        },
      },
    });
    const error = await pending.catch((value) => value);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: "Draft exists", status: 409, existing_draft: draft });
    expect(error).not.toHaveProperty("secret");
  });
  it("still supports legacy string errors", async () => {
    const { call, port } = sdk();
    const pending = call("context");
    port.onmessage!({ data: { id: "1", ok: false, error: "Legacy error" } });
    await expect(pending).rejects.toThrow("Legacy error");
  });
});
