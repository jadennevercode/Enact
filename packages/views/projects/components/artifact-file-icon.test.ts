// @vitest-environment node
import { describe, it, expect } from "vitest";
import { File, FileCode, FileImage, FileText, FileVideo } from "lucide-react";
import { artifactFileIcon } from "./artifact-file-icon";

describe("artifactFileIcon", () => {
  it("picks by extension", () => {
    expect(artifactFileIcon("chart.png", "")).toBe(FileImage);
    expect(artifactFileIcon("schema.sql", "")).toBe(FileCode);
    expect(artifactFileIcon("report.pdf", "")).toBe(FileText);
  });

  it("is case-insensitive about the extension", () => {
    expect(artifactFileIcon("SHOT.PNG", "")).toBe(FileImage);
  });

  // Storage backends routinely report application/octet-stream, so the name
  // the agent chose has to win.
  it("prefers the extension over a generic content type", () => {
    expect(artifactFileIcon("clip.mp4", "application/octet-stream")).toBe(FileVideo);
  });

  it("falls back to content type when the name has no usable extension", () => {
    expect(artifactFileIcon("screenshot", "image/png")).toBe(FileImage);
    expect(artifactFileIcon("notes", "text/plain")).toBe(FileText);
    expect(artifactFileIcon("doc", "application/pdf")).toBe(FileText);
  });

  it("does not treat a leading dot as an extension", () => {
    expect(artifactFileIcon(".env", "")).toBe(File);
  });

  it("falls back to the generic glyph rather than guessing", () => {
    expect(artifactFileIcon("payload.bin", "application/octet-stream")).toBe(File);
    expect(artifactFileIcon("", "")).toBe(File);
  });
});
