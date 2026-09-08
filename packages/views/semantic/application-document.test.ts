import { describe, it, expect } from "vitest";
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
