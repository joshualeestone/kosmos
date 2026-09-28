// Browser-check-surface: restart-back restart-msg restart-k uoffline-slot
'use strict';

/**
 * kosmos#4343 (Josh, 2026-09-28): when this window's board stops answering, show "Kosmos requires a
 * full restart" as one clean centered screen with the Kosmos mark, and nothing else behind it.
 *
 * Harness: a tiny static server that serves web/index.html and DROPS every /api/ request without an
 * answer, so the page's real 5-second status poll fails the way it does when the board is gone. The
 * 15-second wait is shortened by moving BOARD_NO_ANSWER_SINCE back, and the real poll then draws it.
 *
 * Arms (light and dark):
 *   - before the wait is up only the small note shows (positive control: the poll really failed);
 *   - after it, the screen: exact headline, the Mac remedy, the details line, opaque, full window,
 *     centered, everything behind it inert, focus on it, and a K that is drawn and does not move;
 *   - recovery (paintRestartScreen(false), the call the success path makes) removes it and gives
 *     back exactly the inert state it took;
 *   - it stays away while an update runs, when the device is offline, and on a file:// page.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-restart-screen-4343.js
 */

const fs = require('node:fs');
const http = require('node:http');
const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-restart-screen-4343: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const ROOT = nodePath.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(nodePath.join(ROOT, 'web', 'index.html'));
const FILE_PAGE = 'file://' + nodePath.join(ROOT, 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) { req.socket.destroy(); return; }   // nothing answers
  if (req.url === '/' || req.url.startsWith('/?') || req.url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }
  res.writeHead(404); res.end();
});

const ageIt = (page) => page.evaluate(() => { BOARD_NO_ANSWER_SINCE = Date.now() - 16000; });
const shown = (page) => page.evaluate(() => !!document.querySelector('.restart-back'));
// Wait through at least one real poll after a change (the poll runs every 5 s).
const nextPolls = (page) => page.waitForTimeout(6500);

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-restart-screen-4343: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    server.close();
    process.exit(1);
  }

  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
    const t = '[' + theme + ']';
    page.on('pageerror', (e) => problems.push(t + ' pageerror: ' + e.message));
    await page.goto('http://127.0.0.1:' + port + '/?tab=agents');

    // ── Positive control: the poll really failed, and the small note says so. ──
    const noted = await page.waitForFunction(() => /not answering/.test(document.getElementById('uoffline-slot').textContent || ''),
      null, { timeout: 12000 }).then(() => true, () => false);
    ok(t + ' the poll failed and the small note shows (the harness really has no board)', noted);
    ok(t + ' before the wait is up there is no restart screen, only the note', !(await shown(page)));

    const inertBefore = await page.evaluate(() => [...document.querySelectorAll('body > *')].filter((el) => el.inert).length);

    // ── Once the wait is up, the next real poll draws the screen. ──
    await ageIt(page);
    const drawn = await page.waitForSelector('.restart-back', { timeout: 8000 }).then(() => true, () => false);
    ok(t + ' after the wait the real poll draws the restart screen', drawn);
    if (drawn) {
      const s = await page.evaluate(() => {
        const back = document.querySelector('.restart-back');
        const msg = back.querySelector('.restart-msg');
        const r = back.getBoundingClientRect();
        const m = msg.getBoundingClientRect();
        const bg = getComputedStyle(back).backgroundColor;
        const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.test(bg) ? Number(RegExp.$1) : 1;
        const points = [[640, 20], [30, 400], [1250, 780], [640, 400]];
        const covered = points.every(([x, y]) => back.contains(document.elementFromPoint(x, y)));
        const others = [...document.querySelectorAll('body > *')].filter((el) => el !== back);
        return {
          head: (back.querySelector('h1') || {}).textContent,
          how: (back.querySelector('p') || {}).textContent,
          small: (back.querySelector('small') || {}).textContent || '',
          alpha, bg,
          full: r.left === 0 && r.top === 0 && r.width === window.innerWidth && r.height === window.innerHeight,
          covered,
          dx: Math.abs((m.left + m.width / 2) - window.innerWidth / 2),
          dy: Math.abs((m.top + m.height / 2) - window.innerHeight / 2),
          allInert: others.every((el) => el.inert),
          focused: msg.contains(document.activeElement),
          role: msg.getAttribute('role'),
        };
      });
      ok(t + ' the headline is Josh\'s words exactly', s.head === 'Kosmos requires a full restart', JSON.stringify(s.head));
      ok(t + ' it says how: Command-Q, then the Applications folder', /Command-Q/.test(s.how) && /Applications folder/.test(s.how), JSON.stringify(s.how));
      ok(t + ' the details line starts with a capital and carries the address (and the version when one is baked)', /^[A-Z]/.test(s.small) && /nothing answered at 127\.0\.0\.1:\d+/i.test(s.small), JSON.stringify(s.small));
      ok(t + ' the ground is opaque (nothing shows through)', s.alpha === 1, s.bg);
      ok(t + ' it fills the window and covers the header, the board and the corners', s.full && s.covered, JSON.stringify({ full: s.full, covered: s.covered }));
      ok(t + ' the message is centered (within 2px each way)', s.dx <= 2 && s.dy <= 2, JSON.stringify({ dx: s.dx, dy: s.dy }));
      ok(t + ' everything behind it is inert, and focus is on it', s.allInert && s.focused, JSON.stringify({ allInert: s.allInert, focused: s.focused }));
      ok(t + ' it is announced (role=alert)', s.role === 'alert');

      const pix = () => page.evaluate(() => {
        const cv = document.querySelector('.restart-k');
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let lit = 0; let sum = 0;
        for (let i = 3; i < d.length; i += 4) { if (d[i] > 0) lit += 1; sum = (sum + d[i] * (i + 1)) % 1000000007; }
        return { lit, sum };
      });
      const a = await pix();
      await page.waitForTimeout(400);
      const b = await pix();
      ok(t + ' the K mark is drawn', a.lit > 500, JSON.stringify(a));
      ok(t + ' the K mark is still (nothing is working, so nothing moves)', a.sum === b.sum, JSON.stringify({ a: a.sum, b: b.sum }));

      // ── The board answers again: the success path calls paintRestartScreen(false). ──
      const back = await page.evaluate(() => {
        paintRestartScreen(false);
        return {
          gone: !document.querySelector('.restart-back'),
          inert: [...document.querySelectorAll('body > *')].filter((el) => el.inert).length,
          since: BOARD_NO_ANSWER_SINCE,
        };
      });
      ok(t + ' an answer removes the screen and forgets the outage', back.gone && back.since === null, JSON.stringify(back));
      ok(t + ' it gives back exactly the inert state it took', back.inert === inertBefore, JSON.stringify({ before: inertBefore, after: back.inert }));
    }

    // ── Controls: the cases where the note tells a different story. ──
    await page.evaluate(() => { UPDATING_NOW = true; });
    await ageIt(page);
    await nextPolls(page);
    ok(t + ' while an update runs its own overlay owns the screen, not this', !(await shown(page)));
    await page.evaluate(() => { UPDATING_NOW = false; });

    const offline = await page.evaluate(() => {
      BOARD_NO_ANSWER_SINCE = Date.now() - 16000;
      paintRestartScreen(true, true);
      const was = !!document.querySelector('.restart-back');
      paintRestartScreen(false);
      return was;
    });
    ok(t + ' when the device itself is offline it does not claim Kosmos needs a restart', offline === false);
    await page.close();
  }

  // ── A page no board served (file://): nothing to restart, however long the poll fails. ──
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => problems.push('[file] pageerror: ' + e.message));
    await page.goto(FILE_PAGE);
    await ageIt(page);
    await nextPolls(page);
    ok('[file] a file:// page never shows the restart screen', !(await shown(page)));
    await page.close();
  }

  await browser.close();
  server.close();
  if (problems.length) {
    console.error('FAIL  render-restart-screen-4343: ' + problems.length + ' problem(s), ' + pass + ' passed');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-restart-screen-4343: ' + pass + ' passed (the full-restart screen: drawn by the real poll after the wait, Josh\'s headline, the Mac remedy, opaque and centered over everything, inert behind, a still K; removed on an answer; not during an update, a device outage or on file://). problems: none');
  process.exit(0);
})().catch((e) => { console.error('FAIL  render-restart-screen-4343: ' + (e && e.message ? e.message.split('\n')[0] : e)); server.close(); process.exit(1); });
