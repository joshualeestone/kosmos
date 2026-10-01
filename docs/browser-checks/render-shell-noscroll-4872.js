// Browser-check-surface: pj3 pj-one-view consolidated dmbadge fold-a
'use strict';

/**
 * #4872 (Josh, 2026-10-01, 0.7.15): two layout faults in the Mac app window.
 *  1. "The page lets me scroll down just ever so slightly, which makes this gap at the bottom": the outer page moved.
 *     Measured here, nothing overflows in a populated room (the root and body are exactly the window tall), so what
 *     moved was the Mac's elastic overscroll. The fix is overscroll-behavior none on the shell.
 *  2. On the FOLDED agents column, an agent's red notification bubble was cut off by the strip's edge.
 *
 * What each assertion proves, stated so nobody reads more into it:
 *  - "does not bounce" reads the computed overscroll-behavior on the root and body. It goes red when the fix is
 *    reverted. It cannot see a bounce itself (headless engines do not rubber-band); that the Mac app's WebKit view
 *    honours the property is confirmed by eye in the app, not here.
 *  - "cannot scroll" (scrollHeight == clientHeight, and no element ends below the window) is a REGRESSION GUARD: it
 *    passes before this fix too, because nothing overflowed. It is here so a future real overflow goes red.
 *  - the bubble arms go red on the pre-fix page: folded, the bubble lies wholly inside the strip and clear of the
 *    needs-you triangle (both a "2" and a "99+"); open, it keeps its #3339 place.
 *
 * The board is real, on a sandboxed store: a project room with members, tasks and painted posts, the new look, in
 * the consolidated view. Chromium at five sizes (one short, 1024x640), and WebKit, the engine of the Mac app's window.
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
  // Chromium at five window sizes, and WebKit (the engine of the Mac app's window, where Josh saw both) at one.
  const runs = [['chromium', chromium, [[1400, 950], [1280, 800], [1024, 700], [1024, 640], [1920, 1080]]], ['webkit', webkit, [[1400, 950]]]];
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
        paintRoom({ rows: ['elon', 'mark', 'dario', 'mark', 'elon', 'sam'].map((f, i) => row(i, f)) });
      });
      await page.waitForTimeout(300);
      const t = `[${engine} ${w}x${h}]`;
      const m = await page.evaluate(() => {
        const de = document.documentElement, b = document.body;
        const over = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.bottom > innerHeight + 0.5; })
          .map((e) => (e.id || String(e.className).split(' ')[0] || e.tagName) + '@' + Math.round(e.getBoundingClientRect().bottom)).slice(0, 8);
        return { posts: document.querySelectorAll('#pj-room .msg').length, osRoot: getComputedStyle(de).overscrollBehaviorY, osBody: getComputedStyle(b).overscrollBehaviorY, look: de.getAttribute('data-look'), cons: b.classList.contains('consolidated'), inner: innerHeight, deSH: de.scrollHeight, deCH: de.clientHeight, bSH: b.scrollHeight, bCH: b.clientHeight, over };
      });
      console.log('  ' + t + ' ' + JSON.stringify(m));
      chk(m.cons && m.posts >= 6, t + ' the room is open in the consolidated view with its posts painted (precondition)', 'posts=' + m.posts);
      chk(m.deSH <= m.deCH && m.bSH <= m.bCH && m.over.length === 0, t + ' the document cannot scroll: root and body are exactly the window tall, nothing ends below it (regression guard)', JSON.stringify(m));
      // 2b. Nothing overflows, so what Josh dragged was the Mac's elastic overscroll; the shell must not bounce.
      chk(m.osRoot === 'none' && m.osBody === 'none', t + ' the shell is set not to bounce (computed overscroll-behavior none on the root and body)', m.osRoot + '/' + m.osBody);
      // 1. The bubble on the FOLDED agents column: drawn by the app's own dmBadge() on the first agent row,
      //    then the column folded with its real button. The bubble must lie wholly inside the strip (#alist
      //    clips it); unfolded, it keeps its place at the row's top-right corner.
      for (const unread of [2, 120]) {   // a one-digit bubble, and the widest one ("99+")
      const bub = await page.evaluate(async (n) => {
        const row = document.querySelector('#alist .lrow');
        if (!row) return { missing: 'row' };
        row.querySelectorAll('.dmbadge').forEach((e) => e.remove());
        // The row that needs both signals most: needs-you (the app's own triangle, LROW_WARN) AND unread messages.
        row.classList.add('attn');
        const lav = row.querySelector('.lav');
        if (lav && !lav.querySelector('.lwarn')) lav.insertAdjacentHTML('beforeend', LROW_WARN);
        const warn = row.querySelector('.lav > .lwarn');
        row.insertAdjacentHTML('beforeend', dmBadge({ dmUnread: n, sessionName: 'not-the-open-agent' }));
        const badge = row.querySelector('.dmbadge');
        const rect = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
        const fold = document.getElementById('rail-agents-fold');
        const startedFolded = document.body.classList.contains('fold-a');
        if (startedFolded) { fold.click(); await new Promise((res) => setTimeout(res, 250)); }   // measure OPEN as open
        const open = { badge: rect(badge), row: rect(row), folded: document.body.classList.contains('fold-a') };
        if (!document.body.classList.contains('fold-a')) fold.click();
        await new Promise((res) => setTimeout(res, 250));
        const strip = document.getElementById('alist');
        const folded = { text: badge.textContent, badge: rect(badge), warn: warn ? rect(warn) : null, strip: rect(strip), row: rect(row), folded: document.body.classList.contains('fold-a'), clip: getComputedStyle(strip).overflowX };
        if (!startedFolded) { fold.click(); await new Promise((res) => setTimeout(res, 150)); }   // back as found
        return { open, folded };
      }, unread);
      if (bub.missing) chk(false, t + ' [' + unread + '] an agent row to carry the bubble', JSON.stringify(bub));
      else {
        const f = bub.folded, o = bub.open;
        chk(f.folded === true && f.text === (unread > 99 ? '99+' : String(unread)), t + ' [' + unread + '] the agents column folds, and the bubble reads ' + (unread > 99 ? '99+' : unread) + ' (precondition)', JSON.stringify(f));
        chk(f.badge.r <= f.strip.r + 0.5 && f.badge.l >= f.strip.l - 0.5 && f.badge.t >= f.strip.t + 0.5,
          t + ' [' + unread + '] folded: the whole bubble is inside the strip (none of it cut off)', JSON.stringify(f));
        // At least 1px of clear space where they share a column (the 99+ bubble reaches over the triangle's x range).
        const sideBySide = f.warn && (f.badge.r <= f.warn.l || f.badge.l >= f.warn.r);
        chk(!!f.warn && (sideBySide || f.badge.b <= f.warn.t - 1), t + ' [' + unread + '] folded: the bubble leaves the needs-you triangle clear', JSON.stringify(f));
        chk(o.folded === false && Math.abs(o.badge.r - (o.row.r + 6)) <= 1.5 && Math.abs(o.badge.t - (o.row.t - 6)) <= 1.5,
          t + ' [' + unread + '] unfolded: the bubble keeps its place at the row\'s top-right corner (#3339)', JSON.stringify(o));
      }
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
