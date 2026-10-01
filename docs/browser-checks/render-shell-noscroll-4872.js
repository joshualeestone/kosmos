// Browser-check-surface: pj3 pj-one-view consolidated dmbadge fold-a
'use strict';

/**
 * #4872 (Josh, 2026-10-01, 0.7.15): two layout faults in the app window.
 *  1. The whole interface scrolled a few pixels: the shell is meant to be fixed to the window (only the
 *     inner panes scroll), but the document was taller than the viewport, so a wheel moved the top bar up
 *     against the window edge and opened a gap at the bottom.
 *  2. On the FOLDED agents column, an agent's red notification bubble was cut off by the strip's edge.
 *
 * This boots the real board on a sandboxed store, opens a populated project room in the consolidated
 * view, and asserts at several window sizes that the document cannot scroll (scrollHeight == viewport
 * height on both the root and the body), then folds the agents column and asserts the bubble lies wholly
 * inside the strip. Controls: the same measurements report the overflow on the pre-fix page.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-shell-noscroll-4872.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('fs');
const os = require('os');
const path = require('path');

const mk = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ns-' + tag));
const SANDBOX = mk('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mk('workers-');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects-');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mk('config-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium, webkit } = require('playwright');
const fleet = require('../../test-support/fleet');
const projects = require('../../engine/projects');
const tasks = require('../../engine/tasks');
const srv = require('../../server.js');

const fail = [];
let passed = 0;
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (ok) passed += 1; else fail.push(label);
};

(async () => {
  fleet.install(['elon', 'mark', 'dario', 'demis', 'sam'].map((n, i) => fleet.agent(n, { state: i % 2 ? 'working' : 'idle', displayName: n[0].toUpperCase() + n.slice(1), role: 'Director of Research & Market Intelligence' })));
  const proj = projects.create({ name: 'Five Families' });
  for (const n of ['elon', 'mark', 'dario', 'demis', 'sam']) projects.addAgent(proj.id, n, null);
  for (const s of ['Elon: Kosmos 7.15 diagnostic, Grok side', 'Dario: assemble and verify the final PDF', 'Demis: diagnostic, Gemini side']) tasks.create(proj.id, { sentence: s });

  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  // Chromium at four window sizes, and WebKit (the engine of the Mac app's window, where Josh saw both) at one.
  const runs = [['chromium', chromium, [[1400, 950], [1280, 800], [1024, 700], [1920, 1080]]], ['webkit', webkit, [[1400, 950]]]];
  for (const [engine, kind, sizes] of runs) {
  const browser = await kind.launch({ headless: process.env.HEADED === '0' });
  try {
    for (const [w, h] of sizes) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: 'light' });
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.addInitScript(() => { try { localStorage.setItem('kosmos-look', 'new'); } catch { /* none */ } });
      await page.goto(BASE, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
      await page.evaluate(() => fetch('/api/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: 'consolidated' }) }).then((r) => r.text()));
      await page.reload({ waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
      await page.waitForSelector('.pj-row', { state: 'visible', timeout: 10000 });
      await page.click('[data-project="' + proj.id + '"]');
      await page.waitForSelector('#pj-one-name', { state: 'visible', timeout: 8000 });
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        const t0 = Date.now() - 3600000;
        const row = (i, from) => ({ id: 'r' + i, kind: 'post', from, at: new Date(t0 + i * 60000).toISOString(), text: 'Meta diagnostic on 0.7.15 done, all live-probed from a sandboxed shell. Still broken: project list missing. '.repeat(1 + (i % 3)) });
        if (typeof paintRoom === 'function') paintRoom({ rows: ['elon', 'mark', 'dario', 'mark', 'elon', 'sam'].map((f, i) => row(i, f)) });
      });
      await page.waitForTimeout(300);
      const t = `[${engine} ${w}x${h}]`;
      const m = await page.evaluate(() => {
        const de = document.documentElement, b = document.body;
        const over = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.bottom > innerHeight + 0.5; })
          .map((e) => (e.id || String(e.className).split(' ')[0] || e.tagName) + '@' + Math.round(e.getBoundingClientRect().bottom)).slice(0, 8);
        return { osRoot: getComputedStyle(de).overscrollBehaviorY, osBody: getComputedStyle(b).overscrollBehaviorY, look: de.getAttribute('data-look'), cons: b.classList.contains('consolidated'), inner: innerHeight, deSH: de.scrollHeight, deCH: de.clientHeight, bSH: b.scrollHeight, bCH: b.clientHeight, over };
      });
      console.log('  ' + t + ' ' + JSON.stringify(m));
      chk(m.cons, t + ' the room is open in the consolidated view (precondition)');
      chk(m.deSH <= m.deCH && m.bSH <= m.bCH, t + ' the document cannot scroll: root and body are exactly the window tall', JSON.stringify(m));
      // 2b. Nothing overflows, so what Josh dragged was the Mac's elastic overscroll; the shell must not bounce.
      chk(m.osRoot === 'none' && m.osBody === 'none', t + ' the shell does not bounce (overscroll-behavior none on the root and body)', m.osRoot + '/' + m.osBody);
      // 1. The bubble on the FOLDED agents column: drawn by the app's own dmBadge() on the first agent row,
      //    then the column folded with its real button. The bubble must lie wholly inside the strip (#alist
      //    clips it); unfolded, it keeps its place at the row's top-right corner.
      const bub = await page.evaluate(async () => {
        const row = document.querySelector('#alist .lrow');
        if (!row) return { missing: 'row' };
        row.querySelectorAll('.dmbadge').forEach((e) => e.remove());
        row.insertAdjacentHTML('beforeend', dmBadge({ dmUnread: 2, sessionName: 'not-the-open-agent' }));
        const badge = row.querySelector('.dmbadge');
        const rect = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
        const fold = document.getElementById('rail-agents-fold');
        const startedFolded = document.body.classList.contains('fold-a');
        if (startedFolded) { fold.click(); await new Promise((res) => setTimeout(res, 250)); }   // measure OPEN as open
        const open = { badge: rect(badge), row: rect(row), folded: document.body.classList.contains('fold-a') };
        if (!document.body.classList.contains('fold-a')) fold.click();
        await new Promise((res) => setTimeout(res, 250));
        const strip = document.getElementById('alist');
        const folded = { badge: rect(badge), strip: rect(strip), row: rect(row), folded: document.body.classList.contains('fold-a'), clip: getComputedStyle(strip).overflowX };
        if (!startedFolded) { fold.click(); await new Promise((res) => setTimeout(res, 150)); }   // back as found
        return { open, folded };
      });
      if (bub.missing) chk(false, t + ' an agent row to carry the bubble', JSON.stringify(bub));
      else {
        const f = bub.folded, o = bub.open;
        chk(f.folded === true, t + ' the agents column folds (precondition)', JSON.stringify(f));
        chk(f.badge.r <= f.strip.r + 0.5 && f.badge.l >= f.strip.l - 0.5 && f.badge.t >= f.strip.t - 0.5,
          t + ' folded: the whole bubble is inside the strip (none of it cut off)', JSON.stringify(f));
        chk(o.folded === false && Math.abs(o.badge.r - (o.row.r + 6)) <= 1.5 && Math.abs(o.badge.t - (o.row.t - 6)) <= 1.5,
          t + ' unfolded: the bubble keeps its place at the row\'s top-right corner (#3339)', JSON.stringify(o));
      }
      chk(errs.length === 0, t + ' no page errors', errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  }
  server.close();
  fleet.restore();
  if (fail.length) { console.log('\n' + passed + ' passed, ' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\n' + passed + ' passed, all passed');
})().catch((e) => { console.error(e); process.exit(2); });
