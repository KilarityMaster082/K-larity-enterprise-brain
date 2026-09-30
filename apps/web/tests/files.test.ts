// Owner task: EB-102 File viewers — the extension picks the viewer; screens 30–37 each have exactly one.
import assert from "node:assert/strict";
import { test } from "node:test";

import { STUDIO8_DATA } from "@/lib/data/seed-studio8";
import { extLabel, extOf, needsTechnicalRole, viewerKind, VIEWER_SCREEN } from "@/lib/files";

test("extensions map to viewers", () => {
  const k = (fileName: string) => viewerKind({ fileName, docType: "report" });
  assert.equal(k("Phoenix_BOQ_v7.xlsx"), "xlsx");
  assert.equal(k("a.csv"), "xlsx");
  assert.equal(k("RFI-27.PDF"), "pdf");
  assert.equal(k("contract.docx"), "docx");
  assert.equal(k("deck.pptx"), "pptx");
  assert.equal(k("site.JPG"), "image");
  assert.equal(k("fly.mp4"), "video");
  assert.equal(k("note.m4a"), "audio");
  assert.equal(k("labels.json"), "code");
  assert.equal(extOf("noext"), "");
});

test("files without a name are exported PDFs, minutes open as documents", () => {
  assert.equal(viewerKind({ fileName: undefined, docType: "drawing" }), "pdf");
  assert.equal(viewerKind({ fileName: undefined, docType: "minutes" }), "docx");
  assert.equal(extLabel({ fileName: undefined, docType: "quotation" }), "PDF");
  assert.equal(extLabel({ fileName: "x.xlsx", docType: "report" }), "XLSX");
});

test("every viewer kind is used by the seed, has a screen number 30–37, and only code is technical", () => {
  const kinds = new Set(STUDIO8_DATA.documents.map((d) => viewerKind(d)));
  for (const k of Object.keys(VIEWER_SCREEN)) assert.ok(kinds.has(k as never), `no seed document opens the ${k} viewer`);
  assert.deepEqual(Object.values(VIEWER_SCREEN).sort(), [30, 31, 32, 33, 34, 35, 36, 37]);
  assert.ok(needsTechnicalRole("code") && !needsTechnicalRole("pdf"));
});

test("every document with a parsed body has content of the matching kind", () => {
  for (const [id, c] of Object.entries(STUDIO8_DATA.workspace.contents)) {
    const d = STUDIO8_DATA.documents.find((x) => x.documentId === id);
    assert.ok(d, `${id} has content but no document`);
    assert.equal(c.kind, viewerKind(d), id);
  }
});
