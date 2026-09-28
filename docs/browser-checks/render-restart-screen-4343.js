// Browser-check-surface: restart-back restart-msg restart-k restart-up uoffline-slot
'use strict';

/**
 * kosmos#4343 (Josh, 2026-09-28): when this window's board stops answering, show "Kosmos requires a
 * full restart" as one clean centered screen with the Kosmos mark, and nothing else behind it.
 *
 * Harness: a tiny static server that serves web/index.html and answers /api/ in one of three modes:
 * 'down' DROPS every request unanswered (the board is gone), 'up' answers /api/status with a minimal
 * board, and 'broken' answers 200 with a body tick() throws on reading. The 15-second wait is
 * shortened by moving BOARD_NO_ANSWER_SINCE back; the real 5-second poll does everything else.
 *
 * Arms (light and dark):
 *   - down, before the wait is up: only the small note (positive control: the poll really failed);
 *   - down, after it: the screen. Exact headline, the Mac remedy, the details line, opaque, full
 *     window, centered, page scroll off, everything behind it inert (including a node added while it
 *     is up), focus on it, and a K that is drawn and does not move;
 *   - up again: the real poll removes it, gives back exactly the inert elements it took, and puts
 *     the page scroll back;
 *   - broken (a 200 whose painting throws): never the screen, because the board did answer;
 *   - it stays away while an update runs and when the device is offline, and on a file:// page
 *     (where the note shows first, so the poll is known to be failing there).
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
// What server.js stamps into the two metas per request, for the baked Windows arm: a real version and platform.
const WIN_HTML = HTML.toString()
  .replace('<meta name="kosmos-version" content="__KOSMOS_VERSION__">', '<meta name="kosmos-version" content="0.7.09">')
  .replace('<meta name="kosmos-platform" content="__KOSMOS_PLATFORM__">', '<meta name="kosmos-platform" content="win32">');
const FILE_PAGE = 'file://' + nodePath.join(ROOT, 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

let MODE = 'down';
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    if (MODE === 'down') { req.socket.destroy(); return; }   // nothing answers
    if (req.url.startsWith('/api/status')) {
      // 'up' is the least a board can say and still paint cleanly; 'broken' makes the painters throw.
      const body = MODE === 'up' ? { agents: [], counts: { total: 0, working: 0, idle: 0, unreadableLines: 0 }, checkedAt: new Date().toISOString() } : { agents: null };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}');
    return;
  }
  if (req.url === '/win') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(WIN_HTML);
    return;
  }
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
    MODE = 'down';
    page.on('pageerror', (e) => problems.push(t + ' pageerror: ' + e.message));
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    await page.goto('http://127.0.0.1:' + port + '/?tab=agents');

    // ── Positive control: the poll really failed, and the small note says so. ──
    const noted = await page.waitForFunction(() => /not answering/.test(document.getElementById('uoffline-slot').textContent || ''),
      null, { timeout: 12000 }).then(() => true, () => false);
    ok(t + ' the poll failed and the small note shows (the harness really has no board)', noted);
    ok(t + ' before the wait is up there is no restart screen, only the note', !(await shown(page)));

    // The exact elements already inert for their own reasons, kept on the page to compare by identity.
    await page.evaluate(() => { window.__inertBefore = [...document.querySelectorAll('body > *')].filter((el) => el.inert); });

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
          parts: [...msg.children].map((c) => c.tagName.toLowerCase()).join(','),
          alpha, bg,
          full: r.left === 0 && r.top === 0 && r.width === window.innerWidth && r.height === window.innerHeight,
          covered,
          dx: Math.abs((m.left + m.width / 2) - window.innerWidth / 2),
          dy: Math.abs((m.top + m.height / 2) - window.innerHeight / 2),
          allInert: others.every((el) => el.inert),
          focused: msg.contains(document.activeElement),
          role: msg.getAttribute('role'),
          scrollOff: document.documentElement.classList.contains('restart-up') && getComputedStyle(document.documentElement).overflow === 'hidden',
        };
      });
      ok(t + ' the headline is Josh\'s words exactly', s.head === 'Kosmos requires a full restart', JSON.stringify(s.head));
      ok(t + ' it says how: Command-Q, then the Applications folder', /Command-Q/.test(s.how) && /Applications folder/.test(s.how), JSON.stringify(s.how));
      ok(t + ' nothing else on it: the mark, the headline and how to restart, and no details line', s.parts === 'canvas,h1,p', s.parts);
      ok(t + ' the version and the address that did not answer go to the log instead', logs.some((l) => /^Kosmos requires a full restart: .*nothing answered at 127\.0\.0\.1:\d+\.$/i.test(l)), JSON.stringify(logs.slice(-3)));
      ok(t + ' the ground is opaque (nothing shows through)', s.alpha === 1, s.bg);
      ok(t + ' it fills the window and covers the header, the board and the corners', s.full && s.covered, JSON.stringify({ full: s.full, covered: s.covered }));
      ok(t + ' the message is centered (within 2px each way)', s.dx <= 2 && s.dy <= 2, JSON.stringify({ dx: s.dx, dy: s.dy }));
      ok(t + ' everything behind it is inert, and focus is on it', s.allInert && s.focused, JSON.stringify({ allInert: s.allInert, focused: s.focused }));
      ok(t + ' it is announced (role=alert)', s.role === 'alert');
      ok(t + ' the page behind does not scroll or keep its scrollbar gutter', s.scrollOff === true);
      const late = await page.evaluate(() => {
        const d = document.createElement('div'); d.tabIndex = 0; window.__late4343 = d; document.body.appendChild(d);
        return new Promise((r) => setTimeout(() => r(d.inert === true), 50));
      });
      ok(t + ' a node added to the page while it is up is made inert too', late === true);

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

      // ── The board answers again: the real poll removes it. ──
      MODE = 'up';
      const cleared = await page.waitForFunction(() => !document.querySelector('.restart-back'), null, { timeout: 12000 }).then(() => true, () => false);
      ok(t + ' when the board answers again the real poll removes the screen by itself', cleared);
      const back = await page.evaluate(() => {
        const now = [...document.querySelectorAll('body > *')].filter((el) => el.inert);
        const was = window.__inertBefore;
        const late = window.__late4343;
        const same = now.length === was.length && now.every((el) => was.includes(el));
        if (late) late.remove();
        return { same, now: now.length, was: was.length, lateFree: !!late && late.inert === false,
          since: BOARD_NO_ANSWER_SINCE, scrollBack: !document.documentElement.classList.contains('restart-up'), readOk: BOARD_LOOK_FAILED === null };
      });
      ok(t + ' it gives back exactly the inert elements it took (by identity), the late node included', back.same && back.lateFree, JSON.stringify(back));
      ok(t + ' it forgets the outage and gives the page its scroll back', back.since === null && back.scrollBack, JSON.stringify(back));
      ok(t + ' the recovery came through a clean read (the success path), not a failure', back.readOk, JSON.stringify(back));
    }

    // ── A board that ANSWERS but whose painting throws is not "nothing answered". ──
    MODE = 'broken';
    await ageIt(page);
    await nextPolls(page);
    const broken = await page.evaluate(() => ({ failed: !!BOARD_LOOK_FAILED, screen: !!document.querySelector('.restart-back') }));
    ok(t + ' a 200 whose painting throws is recorded as a failure (positive control)', broken.failed, JSON.stringify(broken));
    ok(t + ' ... and never draws the restart screen, because the board did answer', broken.screen === false, JSON.stringify(broken));
    MODE = 'down';

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

  // ── A baked Windows page: the Windows remedy, and the version on the details line. ──
  {
    MODE = 'down';
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => problems.push('[win] pageerror: ' + e.message));
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    await page.goto('http://127.0.0.1:' + port + '/win');
    const baked = await page.evaluate(() => ({ win: onWindows(), v: bakedVersion() }));
    ok('[win] CONTROL: the served page really is a baked Windows page', baked.win === true && baked.v === '0.7.09', JSON.stringify(baked));
    await page.waitForFunction(() => /not answering/.test(document.getElementById('uoffline-slot').textContent || ''), null, { timeout: 12000 }).catch(() => {});
    await ageIt(page);
    const drawn = await page.waitForSelector('.restart-back', { timeout: 8000 }).then(() => true, () => false);
    ok('[win] the screen is drawn on Windows too', drawn);
    if (drawn) {
      const w = { how: await page.evaluate(() => document.querySelector('.restart-back p').textContent),
        small: logs.find((l) => /^Kosmos requires a full restart: /.test(l)) || '' };
      ok('[win] it gives the Windows remedy, not Command-Q', w.how === 'Close the Kosmos window, then double-click Kosmos.exe in your Kosmos folder.', JSON.stringify(w.how));
      ok('[win] the logged details lead with the baked version', /^Kosmos requires a full restart: Version 0\.7\.09, nothing answered at 127\.0\.0\.1:\d+\.$/.test(w.small), JSON.stringify(w.small));
    }
    await page.close();
  }

  // ── A page no board served (file://): nothing to restart, however long the poll fails. ──
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => problems.push('[file] pageerror: ' + e.message));
    await page.goto(FILE_PAGE);
    const noted = await page.waitForFunction(() => /not answering/.test(document.getElementById('uoffline-slot').textContent || ''),
      null, { timeout: 12000 }).then(() => true, () => false);
    ok('[file] the poll fails on file:// too, and the small note shows (positive control)', noted);
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
  console.log('render-restart-screen-4343: ' + pass + ' passed (the full-restart screen: drawn by the real poll after the wait, Josh\'s headline, the Mac remedy, opaque and centered over everything, inert behind, a still K; removed by the real poll when the board answers, restoring inert and scroll; never for a board that answered; not during an update, a device outage or on file://). problems: none');
  process.exit(0);
})().catch((e) => { console.error('FAIL  render-restart-screen-4343: ' + (e && e.message ? e.message.split('\n')[0] : e)); server.close(); process.exit(1); });
