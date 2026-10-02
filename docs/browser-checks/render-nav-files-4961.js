// Browser-check-surface: d-nav d-files
'use strict';
/**
 * #4961 (Josh, 2026-10-01): on an agent's page, after scrolling AI Settings, the Profile and AI
 * Settings pills sat on top of the Files list's header. The nav (#d-nav) was position: sticky
 * (#350, when it was alone in its column) and the Files card (#3614) sits below it in the same
 * column, so a scroll slid the card up behind the pills; its top: 16px also tucked the pills under
 * the sticky app header.
 *
 * Boots a sandboxed board with one agent that has saved files (so the Files card shows). On chromium
 * and webkit: on AI Settings, scrolls the page to several offsets, and in the Talk view scrolls the
 * left column's own scroll box; at every offset the nav and the Files card must not overlap. The
 * Talk offsets did not overlap on main either: they guard against a regression there, and only the
 * AI Settings offsets tell the old page from the new.
 * Controls: the Files card is showing, and each scroll actually moved the card (so an unscrolled page
 * cannot pass by never testing the overlap).
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-nav-files-4961.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-navfiles-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium, webkit } = require('playwright');
const fleet = require('../../test-support/fleet');
const dmfiles = require('../../engine/dmfiles');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

const read = (page) => page.evaluate(() => {
  const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
  const files = document.getElementById('d-files');
  return { nav: r('#d-nav'), files: files && !files.hidden ? r('#d-files') : null };
});
const overlap = (a, b) => a.top < b.bottom && b.top < a.bottom && a.bottom > a.top && b.bottom > b.top;

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
  const fd = dmfiles.filesDir('beatrix');
  fs.mkdirSync(fd, { recursive: true });
  for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(fd, 'notes-' + i + '.txt'), 'x');
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  await fetch(URL + '/api/first-run/complete', { method: 'POST' });
  let ran = 0;
  try {
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: process.env.HEADED === '0' });
      try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        await page.goto(URL);
        await page.waitForSelector('.acard .namego', { timeout: 20000 });
        await page.locator('.acard .namego').first().click();
        await page.waitForSelector('#d-files:not([hidden])', { timeout: 20000 });

        /* AI Settings: the page scrolls. */
        await page.locator('#d-nav button[data-go="model"]').click();
        await page.waitForTimeout(300);
        const start = await read(page);
        chk(!!start.files, `${engineName} AI Settings: control: the Files card is showing`, JSON.stringify(start));
        for (const y of [150, 300, 450, 600]) {
          await page.evaluate((y) => window.scrollTo(0, y), y);
          await page.waitForTimeout(120);
          const r = await read(page);
          chk(r.files && r.files.top !== start.files.top, `${engineName} AI Settings, page scrolled ${y}px: control: the Files card moved`, JSON.stringify(r));
          chk(r.files && !overlap(r.nav, r.files), `${engineName} AI Settings, page scrolled ${y}px: the pills do not sit on the Files card`, JSON.stringify(r));
          ran += 1;
        }

        /* Talk: the left column is its own scroll box on a wide window. */
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator('#d-nav button[data-go="talk"]').click();
        await page.waitForTimeout(300);
        const t0 = await read(page);
        for (const y of [150, 300]) {
          const moved = await page.evaluate((y) => { const c = document.querySelector('#panel-detail .dleft'); c.scrollTop = y; window.scrollTo(0, y); return c.scrollTop + window.scrollY; }, y);
          await page.waitForTimeout(120);
          const r = await read(page);
          chk(moved > 0 && r.files && r.files.top !== t0.files.top, `${engineName} Talk, scrolled ${y}px: control: the Files card moved`, JSON.stringify({ moved, r }));
          chk(r.files && !overlap(r.nav, r.files), `${engineName} Talk, scrolled ${y}px: the pills do not sit on the Files card`, JSON.stringify(r));
          ran += 1;
        }
        chk(errs.length === 0, `${engineName}: no page errors`, errs.join(' | '));
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  chk(ran === 12, 'precondition: both engines, every scroll offset ran', String(ran));
  console.log(fail.length ? `${fail.length} check(s) FAILED` : 'all checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
