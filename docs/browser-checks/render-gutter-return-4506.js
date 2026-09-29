'use strict';
// Browser-check-surface: orgWatchWidth pjMentionWatchWidth orgview pj-post pj-post-mirror boot-cover
// (#2518) the distinctive web/index.html tokens this check asserts: the two width watchers #4506 added, the boxes
// they watch, and the boot cover whose gutter drop the check drives.
/* kosmos#4506: the tab layout's scrollbar gutter (#1309) is dropped while the boot cover (and the first-run and update
 * overlays, the first screen, the restart screen, Talk) is up, and comes back when it goes. That changes the page's
 * width by 15px on a classic-scrollbar machine with NO window resize, so anything fitted to a width on `resize` alone
 * goes stale. Two such fits, each watched by its own ResizeObserver since this card:
 *   G1  the org chart (orgWatchWidth): it is fitted to #orgview's width, recorded as ORG_VIEW_W at each paint.
 *   G2  the @mention mirror in a project room (pjMentionWatchWidth): it copies #pj-post's width.
 * G1 fits under the boot cover (no gutter), lifts it, and asserts the fit followed the box. G2 drops the gutter with
 * the same two root properties the overlays set (opening a room lifts the boot cover itself), types, and restores it. Each has a
 * precondition that the box really changed width, so a harness with no gutter cannot pass it vacuously.
 *
 * 🔑 WHAT ONLY A BROWSER CAN SAY: a real, space-taking 15px scrollbar (--hide-scrollbars dropped, a
 * ::-webkit-scrollbar width, a page tall enough to scroll), the CSS that drops the gutter under the cover, and the
 * observers' timing. Measured with each observer's load-time call removed: G1 stays painted at the old width,
 * G2's mirror stays at the old width.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-gutter-return-4506.js
 *      (HEADED=0 on a machine with no console session)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gret-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
let pass = 0;
function chk(ok, label, extra) {
  if (ok) { pass++; console.log('PASS  ' + label + (extra ? '  ' + extra : '')); }
  else { fail.push(label); console.log('FAIL  ' + label + (extra ? '  --  ' + extra : '')); }
}

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  const server = await srv.start(0);
  const port = server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    await page.evaluate(() => {
      document.getElementById('boot-cover').hidden = true;
      const st = document.createElement('style');
      st.textContent = '::-webkit-scrollbar { width: 15px; } ::-webkit-scrollbar-thumb { background: #999; }';
      document.head.appendChild(st);
      const tall = document.createElement('div'); tall.style.height = '3000px'; document.body.appendChild(tall);
    });
    const cover = (up) => page.evaluate((u) => { document.getElementById('boot-cover').hidden = !u; }, up);
    const gutter = () => page.evaluate(() => Math.round(innerWidth - document.documentElement.getBoundingClientRect().right));

    // G1: the org chart.
    await page.evaluate(() => { showTab('agents'); layoutApply('agents', 'org'); });
    await page.waitForTimeout(500);
    await page.evaluate(() => paintOrg());
    await page.waitForTimeout(300);
    const org = () => page.evaluate(() => ({ box: document.getElementById('orgview').clientWidth, painted: ORG_VIEW_W }));
    const g1a = { ...(await org()), gutter: await gutter() };
    chk(g1a.gutter === 15 && g1a.box > 0 && g1a.painted === g1a.box, 'G1 precondition: a real 15px gutter, and the chart painted at its box width', JSON.stringify(g1a));
    await cover(true);
    await page.waitForTimeout(400);
    const g1b = { ...(await org()), gutter: await gutter() };
    chk(g1b.gutter === 0 && g1b.box !== g1a.box, 'G1 CONTROL: under the cover the gutter is gone and the chart box changed width', JSON.stringify(g1b));
    chk(g1b.painted === g1b.box, 'G1 under the cover the chart repainted to the wider box, with no window resize', JSON.stringify(g1b));
    await cover(false);
    await page.waitForTimeout(400);
    const g1c = { ...(await org()), gutter: await gutter() };
    chk(g1c.gutter === 15 && g1c.painted === g1c.box && g1c.box === g1a.box, 'G1 once the cover lifts the chart repaints back to its box, with no window resize', JSON.stringify(g1c));

    // G2: the @mention mirror in a project room.
    const made = await page.evaluate(async () => {
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Gutter return', agents: ['beatrix'] }) });
      const j = await r.json().catch(() => ({}));
      return { status: r.status, id: j.id || (j.project && j.project.id) || null };
    });
    chk(made.status === 200 && !!made.id, 'G2 precondition: a project to open', JSON.stringify(made));
    // Opened the way a person opens it: the Projects tab, then the project's row (emoji-picker-2254's route).
    await page.click('[data-tab="projects"]');
    await page.locator('#pj-list').getByText('Gutter return').first().click();
    await page.waitForFunction(() => { const el = document.getElementById('pj-post'); return !!el && el.getBoundingClientRect().height > 0; }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    const shown = await page.evaluate(() => { const i = document.getElementById('pj-post'); return !!i && i.offsetWidth > 0; });
    chk(shown, 'G2 precondition: the room\'s composer is on screen');
    // The gutter dropped the way every overlay drops it (overflow hidden, no reserved gutter on the root; the boot
    // cover's own rule is the same two properties), set inline here because opening a room lifts the boot cover
    // itself. Typed while it is dropped, so the mirror is sized to the no-gutter width.
    const drop = (on) => page.evaluate((o) => { const r = document.documentElement.style; if (o) { r.overflow = 'hidden'; r.scrollbarGutter = 'auto'; } else { r.removeProperty('overflow'); r.removeProperty('scrollbar-gutter'); } }, on);
    await drop(true);
    await page.waitForTimeout(300);
    await page.focus('#pj-post');
    await page.keyboard.type('hello @beatrix, a long enough line to wrap somewhere in the composer box');
    await page.waitForTimeout(200);
    const mir = () => page.evaluate(() => { const i = document.getElementById('pj-post'), m = document.getElementById('pj-post-mirror');
      return { input: i.offsetWidth, mirror: Math.round(parseFloat(m.style.width) || 0), live: i.classList.contains('mention-live') }; });
    const g2a = { ...(await mir()), gutter: await gutter() };
    chk(g2a.gutter === 0 && g2a.live && g2a.mirror === g2a.input, 'G2 CONTROL: with the gutter dropped and a draft, the mirror is live and matches the composer', JSON.stringify(g2a));
    await drop(false);
    await page.waitForTimeout(400);
    const g2b = { ...(await mir()), gutter: await gutter() };
    chk(g2b.gutter === 15 && g2b.input !== g2a.input, 'G2 precondition: once the gutter is back the composer changed width', JSON.stringify(g2b));
    chk(g2b.mirror === g2b.input, 'G2 the mirror follows the composer back, with no keystroke and no window resize', JSON.stringify(g2b));

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); for (const f of fail) console.error('  FAIL  ' + f); process.exit(1); }
  console.log('\nall gutter-return checks passed (' + pass + ')');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
