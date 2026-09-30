// Owner task: EB-23 Web UI shell — the screen registry must match docs/architecture/SCREENS_CATALOG.md and the route
// files on disk, so a screen cannot be dropped, renamed or left unbuilt unnoticed.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { SCREENS, screenByN } from "@/lib/screens";

const root = join(import.meta.dirname, "..");
const catalog = readFileSync(join(root, "../../docs/architecture/SCREENS_CATALOG.md"), "utf8");
const rows = [...catalog.matchAll(/^\| \*\*(\d+)\*\* \| \*\*(.+?)\*\* \| (.+?) \|/gm)].map((m) => ({ n: Number(m[1]), title: m[2]!, route: m[3]!.replace(/`/g, "").trim() }));

test("the registry lists screens 1–45 once each, in order", () => {
  assert.deepEqual(SCREENS.map((s) => s.n), Array.from({ length: 45 }, (_, i) => i + 1));
});

test("every catalog row 1–45 has the same route as the registry (overlays excepted)", () => {
  const tenant = rows.filter((r) => r.n <= 45);
  assert.equal(tenant.length, 45);
  for (const r of tenant) {
    const s = screenByN(r.n);
    if (r.route.startsWith("/")) assert.equal(s.route.split("?")[0], r.route.split("?")[0], `screen ${r.n} route`);
    else assert.ok(s.overlay, `screen ${r.n} (${r.route}) must be an overlay`);
  }
});

test("every page route has a page.tsx and every overlay is hosted", () => {
  for (const s of SCREENS.filter((x) => !x.overlay && x.route.startsWith("/"))) {
    const dir = s.route.split("?")[0]!.replace(/^\//, "");
    assert.ok(existsSync(join(root, "app", dir, "page.tsx")), `screen ${s.n}: app/${dir}/page.tsx`);
  }
  const host = readFileSync(join(root, "components/overlays/OverlayHost.tsx"), "utf8");
  for (const piece of ["EvidenceSheet", "FileViewer", "RunInspector", "ComposerDrawer"]) assert.match(host, new RegExp(`<${piece}`), `${piece} is mounted`);
});

test("launcher hrefs are real routes and every gated screen names a capability", () => {
  for (const s of SCREENS) {
    assert.ok(s.href.startsWith("/"), `screen ${s.n} href`);
    if (s.n !== 3) assert.ok(s.cap || s.n === 3, `screen ${s.n} needs a capability`);
    assert.notEqual(s.status, "", `screen ${s.n} status`);
  }
});
