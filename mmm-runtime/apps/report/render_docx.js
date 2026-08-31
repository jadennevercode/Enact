/**
 * A dumb .docx renderer. Reads a document model as JSON on stdin, writes a Word
 * file. It decides nothing about content.
 *
 *     node render_docx.js <out.docx> < model.json
 *
 * The model:
 *
 *     { "title": str,
 *       "properties": { "<name>": "<value>", ... },   // custom document properties
 *       "blocks": [
 *         { "kind": "title",   "text": str },
 *         { "kind": "heading", "text": str },
 *         { "kind": "para",    "text": str },
 *         { "kind": "note",    "text": str },          // smaller, grey — for captions
 *         { "kind": "bullets", "items": [str] },
 *         { "kind": "table",   "header": [str], "rows": [[str]] },
 *       ] }
 *
 * Content lives on the Python side, where the workspace, the terminology table
 * and the source fingerprint already are. This file only knows Word.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  AlignmentType, Document, HeadingLevel, Packer, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, WidthType,
} = require("docx");

// DXA: 1440 per inch. A4 portrait minus one-inch margins leaves 9026.
const CONTENT_WIDTH = 9026;
const HEADER_FILL = "F2F2F2";

function cell(text, width, isHeader) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    // CLEAR, never SOLID — SOLID renders as a black block in Word.
    shading: isHeader ? { type: ShadingType.CLEAR, fill: HEADER_FILL } : undefined,
    children: [new Paragraph({
      children: [new TextRun({ text: String(text ?? ""), bold: !!isHeader, size: 20 })],
    })],
  });
}

function table(block) {
  const columns = Math.max(1, (block.header || []).length);
  // Column widths must sum to the table width, and every cell needs its own
  // width as well — percentage widths break when the file is opened elsewhere.
  const width = Math.floor(CONTENT_WIDTH / columns);
  const widths = Array(columns).fill(width);
  widths[columns - 1] = CONTENT_WIDTH - width * (columns - 1);

  const rows = [new TableRow({
    tableHeader: true,
    children: (block.header || []).map((text, i) => cell(text, widths[i], true)),
  })];
  for (const row of block.rows || []) {
    rows.push(new TableRow({
      children: widths.map((w, i) => cell((row || [])[i], w, false)),
    }));
  }
  return new Table({ columnWidths: widths, width: { size: CONTENT_WIDTH, type: WidthType.DXA }, rows });
}

function render(block) {
  switch (block.kind) {
    case "title":
      return [new Paragraph({ text: block.text, heading: HeadingLevel.TITLE })];
    case "heading":
      return [new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_1,
                              spacing: { before: 320, after: 160 } })];
    case "para":
      return [new Paragraph({ children: [new TextRun(block.text)],
                              spacing: { after: 120 } })];
    case "note":
      return [new Paragraph({
        children: [new TextRun({ text: block.text, size: 18, color: "666666" })],
        spacing: { after: 120 },
      })];
    case "bullets":
      // Never a literal "•" — Word needs real list numbering to indent and wrap.
      return (block.items || []).map((item) => new Paragraph({
        text: String(item), bullet: { level: 0 }, spacing: { after: 60 },
      }));
    case "table":
      // A table butted against the next paragraph reads as one block; the empty
      // paragraph is the separation Word will not add on its own.
      return [table(block), new Paragraph({ text: "", spacing: { after: 120 } })];
    default:
      throw new Error("unknown block kind: " + block.kind);
  }
}

function main(argv) {
  const out = argv[0];
  if (!out) {
    process.stderr.write("usage: node render_docx.js <out.docx> < model.json\n");
    return 2;
  }
  const model = JSON.parse(fs.readFileSync(0, "utf8"));
  const children = (model.blocks || []).flatMap(render);
  const doc = new Document({
    title: model.title || "",
    customProperties: Object.entries(model.properties || {})
      .map(([name, value]) => ({ name, value: String(value) })),
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children,
    }],
  });
  return Packer.toBuffer(doc).then((buffer) => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buffer);
    process.stdout.write(out + "\n");
    return 0;
  });
}

Promise.resolve(main(process.argv.slice(2))).then(
  (code) => process.exit(code || 0),
  (error) => { process.stderr.write(String(error && error.stack || error) + "\n"); process.exit(1); },
);
