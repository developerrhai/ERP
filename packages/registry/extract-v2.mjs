// Registry v2 (Phase 22-B). Reads the V40 prototype by RUNNING it in headless Chromium (the same
// Playwright the e2e suite uses), because V40 builds its menu in layers: MENU, the v17AddMenu()
// insertions, MENU.unshift of the dynamic families, department families, contract labour, etc.
// Output: registry.v2.json  { version, generatedFrom, sha256, families[], pages[] }
//   pages[] = { id, title, family, tabs[], fields[], buttons[], dynamic, status, ownerPhase }
// Never hand-edit the output; re-run `npm run extract:v2`.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const SOURCE_REL = 'RHAI_ERP_V40_Edit_Update_Fixed.html';
const require = createRequire(resolve(root, 'package.json'));
const { chromium } = require('@playwright/test');

const bytes = readFileSync(resolve(root, SOURCE_REL));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const old = JSON.parse(readFileSync(resolve(here, 'registry.json'), 'utf8'));

const oldPage = new Map();
for (const f of old.families) for (const i of f.items) oldPage.set(i.id, { title: i.title, family: f.name, icon: f.icon });

// Owner phase of every V40 page that did not exist in the 248 old ones. Taken from the phase files
// 23-31 (the file that names the id); the ones no file names are listed with the reason.
const OWNER_BY_ID = {
  'project-global-history': 26, 'ops-mfg-dashboard': 24, 'my-approvals': 25, 'process-exceptions': 26,
  'master-customers': 26, 'ops-order-360': 26, 'sales-enquiries': 26, 'master-products': 26, 'master-materials': 26,
  'proj-demo-control': 26, 'proj-stage-gates': 26, 'proj-dependencies': 26, 'proj-specifications': 26,
  'proj-test-records': 26, 'proj-documents': 26, 'customer-receipts': 25,
  'ops-tasks': 29, 'ops-shift-roster': 29, 'ops-visitors': 29, 'ops-canteen': 29,
  'business-documents': 27, 'dispatch-dc': 27, 'quality-certificate': 27, 'accounts-gst-invoice': 27,
  'hr-offer-letter': 27, 'hr-appointment-letter': 27,
  // Not named by any phase file: grouped with the engine they belong to (movement = Phase 25).
  'mfg-material-issue': 25, 'document-movement-center': 25, 'plant-flow-command': 25, 'plant-project-forward': 25,
  'maint-part-movement': 25, 'plant-process-movement': 25, 'plant-unit-routing': 25,
  'plant-department-movement': 25, 'plant-interplant-movement': 25, 'flow-bom-approval': 25,
  'mfg-unit-route': 25, 'mfg-transfer-note': 25,
};
function ownerPhaseOf(id) {
  if (OWNER_BY_ID[id] !== undefined) return OWNER_BY_ID[id];
  if (id.startsWith('cl-')) return 30;
  if (id.startsWith('dept-inbox-') || id.startsWith('dept-work-')) return 25;
  return null;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(resolve(root, SOURCE_REL)).href);
await page.waitForTimeout(1500);

const v40 = await page.evaluate(() => {
  const users = JGet(DB.users, []);
  CURRENT_USER = users.find((u) => /super/i.test(u.role)) || users[0];
  openERP();
  const seen = new Set();
  const flat = [];
  for (const f of MENU) for (const it of f.items) if (!seen.has(it[0])) { seen.add(it[0]); flat.push({ id: it[0], title: it[1], family: f.name, icon: f.icon }); }
  const buttons = {};
  for (const it of flat) {
    try {
      nav(it.id);
      const host = document.querySelector('main') || document.body;
      const first = (PROFILES[it.id]?.tabs || [])[0];
      const out = [];
      for (const b of host.querySelectorAll('button')) {
        const t = b.textContent.trim();
        if (!t) continue;
        if (t === '←' || t === first) break; // the page-level bar ends where the tab strip starts
        if (!out.includes(t)) out.push(t);
      }
      buttons[it.id] = out;
    } catch (e) {
      buttons[it.id] = null;
    }
  }
  return { flat, profiles: PROFILES, buttons };
});
await browser.close();

const DYNAMIC = (id) => id.startsWith('dept-inbox-') || id.startsWith('dept-work-');
const pages = [];
const famOrder = [];
const famIcon = new Map();
const famOf = (name, icon) => { if (!famOrder.includes(name)) { famOrder.push(name); famIcon.set(name, icon); } };

for (const it of v40.flat) {
  const prof = v40.profiles[it.id];
  const o = oldPage.get(it.id);
  let family = o ? o.family : prof?.family || it.family;
  if (DYNAMIC(it.id)) family = it.id.startsWith('dept-inbox-') ? 'Department Inbox' : 'Department Work';
  famOf(family, o?.icon ?? it.icon);
  const ownerPhase = o ? null : ownerPhaseOf(it.id);
  pages.push({
    id: it.id,
    title: it.title,
    family,
    tabs: prof?.tabs ?? [],
    fields: prof?.fields ?? [],
    buttons: v40.buttons[it.id] ?? [],
    dynamic: DYNAMIC(it.id),
    status: o ? 'built' : 'planned',
    ownerPhase,
    ...(o && o.title !== it.title ? { changedOnPurpose: `V40 renamed "${o.title}" to "${it.title}"`, legacyTitle: o.title } : {}),
  });
}
// A page of the 248 that V40 no longer shows keeps its row (never rename or drop a built page).
for (const [id, o] of oldPage) {
  if (pages.some((p) => p.id === id)) continue;
  famOf(o.family, o.icon);
  pages.push({
    id, title: o.title, family: o.family, tabs: old.profiles?.[id]?.tabs ?? [], fields: old.profiles?.[id]?.fields ?? [],
    buttons: [], dynamic: false, status: 'built', ownerPhase: null,
    changedOnPurpose: 'Not in the V40 menu; kept because the page is built and in use',
  });
}
const errors = pages.filter((p) => p.status === 'planned' && p.ownerPhase === null).map((p) => p.id);
if (errors.length) throw new Error(`New V40 pages without an ownerPhase: ${errors.join(', ')}`);

const out = {
  version: 2,
  generatedFrom: SOURCE_REL,
  sha256,
  families: famOrder.map((name) => ({ name, icon: famIcon.get(name), pageCount: pages.filter((p) => p.family === name).length })),
  pages,
};
writeFileSync(resolve(here, 'registry.v2.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
process.stdout.write(
  `registry.v2.json: ${out.families.length} families, ${pages.length} pages ` +
    `(${pages.filter((p) => p.status === 'built').length} built, ${pages.filter((p) => p.status === 'planned').length} planned), ` +
    `${pages.filter((p) => p.buttons.length === 0).length} without buttons, sha256 ${sha256.slice(0, 12)}\n`,
);
