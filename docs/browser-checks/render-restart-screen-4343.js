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
 *   - down, after it: the screen. Exact headline, the remedy and nothing else (details logged), opaque, full
 *     window, centered, page scroll off, everything behind it inert (including a node added while it
 *     is up), focus on it, a K that is drawn and does not move, and Escape/Tab doing nothing to a
 *     dialog left open under it;
 *   - up again: the real poll removes it, gives back exactly the inert elements it took, and puts
 *     the page scroll back;
 *   - broken (a 200 whose painting throws): never the screen, because the board did answer;
 *   - it stays away while an update runs, during a world switch, when the device is offline, and on a
 *     file:// page (where the note shows first, so the poll is known to be failing there);
 *   - the Kosmos app (its kosmosBadge bridge): Command-Q first; a browser tab is told to reopen Kosmos;
 *   - a baked Windows page: the Windows remedy, and the version in the logged details.
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
const HELD = [];
let ONESTUCK_TAKEN = false, MODE_ONESTUCK_UP = false;   // #4562: 'frozen' requests, held open and never answered (ended at the close)
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    if (MODE === 'down') { req.socket.destroy(); return; }   // nothing answers
    // #4562 'frozen': the board is RUNNING but stuck. The connection is accepted and nothing is ever sent,
    // which is what a frozen board's socket does (the kernel accepts it); 'slow' answers, 6 s late (well
    // inside the page's 10 s limit); 'onestuck' holds ONE /api/status past the limit and answers the rest.
    if (MODE === 'frozen') { HELD.push(res); return; }
    // 'refusestall': a REFUSAL (500 headers) whose body never finishes. It answered, so it keeps its own words.
    if (MODE === 'refusestall' && req.url.startsWith('/api/status')) { res.writeHead(500, { 'content-type': 'application/json' }); res.write('{"error":"'); HELD.push(res); return; }
    if (MODE === 'onestuck' && req.url.startsWith('/api/status') && !ONESTUCK_TAKEN) { ONESTUCK_TAKEN = true; HELD.push(res); return; }
    if (MODE === 'onestuck') MODE_ONESTUCK_UP = true;
    if (MODE === 'slow' && req.url.startsWith('/api/status')) {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ agents: [], counts: { total: 0, working: 0, idle: 0, unreadableLines: 0 }, checkedAt: new Date().toISOString() }));
      }, 6000);
      return;
    }
    if (req.url.startsWith('/api/status')) {
      // 'up' is the least a board can say and still paint cleanly; 'broken' makes the painters throw.
      const body = (MODE === 'up' || MODE === 'onestuck') ? { agents: [], counts: { total: 0, working: 0, idle: 0, unreadableLines: 0 }, checkedAt: new Date().toISOString() } : { agents: null };
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

  const grounds = {};
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


    // A dialog left open under it (the update confirm): its own Escape and Tab must not act from behind.
    // __inertBefore: the exact elements already inert for their own reasons, to compare by identity.
    await page.evaluate(() => { document.getElementById('updconfirm').hidden = false; window.__inertBefore = [...document.querySelectorAll('body > *')].filter((el) => el.inert); });
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
          role: msg.getAttribute('role'), modal: msg.getAttribute('aria-modal'),
          name: (document.getElementById(msg.getAttribute('aria-labelledby') || '') || {}).textContent,
          desc: (document.getElementById(msg.getAttribute('aria-describedby') || '') || {}).textContent,
          scrollOff: document.documentElement.classList.contains('restart-up') && getComputedStyle(document.documentElement).overflow === 'hidden',
        };
      });
      ok(t + ' the headline is Josh\'s words exactly', s.head === 'Kosmos requires a full restart', JSON.stringify(s.head));
      ok(t + ' in a browser tab it says to reopen Kosmos (Command-Q there would quit the browser)', s.how === 'Open Kosmos again from your Applications folder.', JSON.stringify(s.how));
      grounds[theme] = s.bg;
      ok(t + ' nothing else on it: the mark, the headline and how to restart, and no details line', s.parts === 'canvas,h1,p', s.parts);
      ok(t + ' the version and the address that did not answer go to the log instead', logs.some((l) => /^Kosmos requires a full restart: .*nothing answered at 127\.0\.0\.1:\d+\.$/i.test(l)), JSON.stringify(logs.slice(-3)));
      ok(t + ' the ground is opaque (nothing shows through)', s.alpha === 1, s.bg);
      ok(t + ' it fills the window and covers the header, the board and the corners', s.full && s.covered, JSON.stringify({ full: s.full, covered: s.covered }));
      ok(t + ' the message is centered (within 2px each way)', s.dx <= 2 && s.dy <= 2, JSON.stringify({ dx: s.dx, dy: s.dy }));
      ok(t + ' everything behind it is inert, and focus is on it', s.allInert && s.focused, JSON.stringify({ allInert: s.allInert, focused: s.focused }));
      ok(t + ' it is a modal alert dialog named by its headline and described by its how-to', s.role === 'alertdialog' && s.modal === 'true'
        && s.name === 'Kosmos requires a full restart' && s.desc === s.how, JSON.stringify({ role: s.role, modal: s.modal, name: s.name, desc: s.desc }));
      ok(t + ' the page behind does not scroll or keep its scrollbar gutter', s.scrollOff === true);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Escape');
      const keys = await page.evaluate(() => ({ dialogOpen: document.getElementById('updconfirm').hidden === false,
        screen: !!document.querySelector('.restart-back'), inertKept: [...document.querySelectorAll('body > *')].filter((el) => el !== document.querySelector('.restart-back')).every((el) => el.inert) }));
      ok(t + ' Escape and Tab do nothing behind the screen: the dialog under it stays open and everything stays inert', keys.dialogOpen && keys.screen && keys.inertKept, JSON.stringify(keys));
      const covered = await page.evaluate(() => ({ wn: wnCovered(), tip: tipModalOpen(), notice: cnHeld() }));
      ok(t + ' the What\'s New window and the tips know they are covered (their keys stand down)', covered.wn === true && covered.tip === true && covered.notice === true, JSON.stringify(covered));
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
        document.getElementById('updconfirm').hidden = true;
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
    // A world switch restarts the board on purpose (it can take minutes): the switcher owns the screen.
    await page.evaluate(() => { WORLDSW_SWITCHING = true; });
    await ageIt(page);
    await nextPolls(page);
    ok(t + ' during a world switch the switcher owns the screen, not this', !(await shown(page)));
    await page.evaluate(() => { WORLDSW_SWITCHING = false; });

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

  ok('CONTROL: the dark pass really ran dark (the screen\'s ground differs from the light pass)', grounds.light && grounds.dark && grounds.light !== grounds.dark, JSON.stringify(grounds));

  // ── The Kosmos app itself (its kosmosBadge bridge present): Command-Q, then the Applications folder. ──
  {
    MODE = 'down';
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => problems.push('[app] pageerror: ' + e.message));
    await page.addInitScript(() => { window.webkit = { messageHandlers: { kosmosBadge: { postMessage() {} } } }; });
    await page.goto('http://127.0.0.1:' + port + '/?tab=agents');
    await page.waitForFunction(() => /not answering/.test(document.getElementById('uoffline-slot').textContent || ''), null, { timeout: 12000 }).catch(() => {});
    await ageIt(page);
    const drawn = await page.waitForSelector('.restart-back', { timeout: 8000 }).then(() => true, () => false);
    const how = drawn ? await page.evaluate(() => document.querySelector('.restart-back p').textContent) : null;
    ok('[app] in the Kosmos app it says Command-Q, then the Applications folder', how === 'Quit Kosmos with Command-Q, then open it again from your Applications folder.', JSON.stringify(how));
    await page.close();
  }

  // ── A baked Windows page: the Windows remedy, and the version in the logged details. ──
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
      ok('[win] it gives the Windows remedy, not Command-Q', w.how === 'Close the Kosmos window, then open Kosmos again from the Start menu.', JSON.stringify(w.how));
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

  // ── #4562: a FROZEN board (running, accepts the connection, never answers). With no time limit on the
  //    poll this never counted as down, so the screen never came (Josh, Friday). Measured end to end with
  //    the real clocks, no aging: it must show within about STATUS_POLL_TIMEOUT_MS + RESTART_SCREEN_AFTER_MS
  //    plus two polls. And a board that is merely SLOW (answers in 6 s) never counts as down. ──
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => problems.push('[frozen] pageerror: ' + e.message));
    MODE = 'up';
    await page.goto('http://127.0.0.1:' + port + '/?tab=agents');
    await page.waitForTimeout(1500);
    MODE = 'frozen';
    const t0 = Date.now();
    const drawn = await page.waitForSelector('.restart-back', { timeout: 40000 }).then(() => true, () => false);
    const took = Date.now() - t0;
    // (Defaulted, so this runs against a page without the limit too, and fails there on the screen, not here.)
    const limits = await page.evaluate(() => ({ poll: typeof STATUS_POLL_TIMEOUT_MS === 'number' ? STATUS_POLL_TIMEOUT_MS : 10000, wait: RESTART_SCREEN_AFTER_MS }));
    // The worst case: up to one 5 s poll before the first frozen request, its limit, then the wait,
    // which the next failing poll (every 5 s) crosses. So limit + wait + two polls, plus page slack.
    const bound = limits.poll + limits.wait + 10000 + 1500;
    ok('[frozen] a board that accepts the connection and never answers gets the restart screen', drawn, 'waited ' + took + ' ms');
    ok('[frozen] and within the poll limit + the wait + two polls (' + bound + ' ms)', drawn && took <= bound, took + ' ms');
    // What the board underneath says: a plain sentence, never the browser's own abort text.
    const said = await page.evaluate(() => (document.getElementById('grid') || {}).textContent || '');
    ok('[frozen] the board behind says nothing answered for 10 seconds, not the browser\'s abort text',
      /nothing answered for 10 seconds/.test(said) && !/abort/i.test(said), JSON.stringify(said.slice(0, 300)));
    // The board unfreezes: it answers what was queued (released here) and every poll after.
    MODE = 'up';
    for (const r of HELD.splice(0)) { try { r.destroy(); } catch { /* already gone */ } }
    const cleared = await page.waitForFunction(() => !document.querySelector('.restart-back'), null, { timeout: 20000 }).then(() => true, () => false);
    ok('[frozen] it clears by itself once the board answers again', cleared);
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => problems.push('[slow] pageerror: ' + e.message));
    MODE = 'slow';
    await page.goto('http://127.0.0.1:' + port + '/?tab=agents');
    // The CONTROL that the slow board really is being polled: its answers arrive (the stamp fills in).
    const answeredOnce = await page.waitForFunction(() => /Agent status/.test(document.getElementById('checked').textContent || '')
      && !/could not refresh/.test(document.getElementById('checked').textContent || ''), null, { timeout: 15000 }).then(() => true, () => false);
    await page.waitForTimeout(20000);
    const st = await page.evaluate(() => ({ screen: !!document.querySelector('.restart-back'),
      note: /not answering/.test(document.getElementById('uoffline-slot').textContent || ''), since: BOARD_NO_ANSWER_SINCE }));
    ok('[slow] a board answering 6 s late is polled and answers (control)', answeredOnce);
    ok('[slow] and it never counts as down: no note, no screen, no failure clock', !st.screen && !st.note && st.since === null, JSON.stringify(st));
    await page.close();
  }
  // ── #4562 review: ONE poll stuck past the limit while the polls after it answer. Its timeout lands
  //    after a newer poll's success, and must not paint "not answering" over a board that is answering. ──
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => problems.push('[onestuck] pageerror: ' + e.message));
    MODE = 'up';
    await page.goto('http://127.0.0.1:' + port + '/?tab=agents');
    await page.waitForTimeout(1500);
    ONESTUCK_TAKEN = false; MODE = 'onestuck';
    await page.evaluate(() => { window.__noted = false; setInterval(() => {
      if (/not answering/.test(document.getElementById('uoffline-slot').textContent || '')) window.__noted = true; }, 100); });
    await page.waitForTimeout(18000);   // the stuck poll's 10 s limit passes, with later polls answering
    const os = await page.evaluate(() => ({ noted: window.__noted, since: BOARD_NO_ANSWER_SINCE,
      stamp: (document.getElementById('checked').textContent || '') }));
    ok('[onestuck] the harness really held one poll and answered later ones (control)', ONESTUCK_TAKEN && MODE_ONESTUCK_UP, JSON.stringify({ ONESTUCK_TAKEN, MODE_ONESTUCK_UP }));
    ok('[onestuck] a stuck poll timing out after a newer answer paints nothing: no note, no failure clock, no "could not refresh"',
      !os.noted && os.since === null && !/could not refresh/.test(os.stamp), JSON.stringify(os));
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => problems.push('[refusestall] pageerror: ' + e.message));
    MODE = 'refusestall';
    await page.goto('http://127.0.0.1:' + port + '/?tab=agents');
    const failed = await page.waitForFunction(() => /could not refresh/.test(document.getElementById('checked').textContent || ''), null, { timeout: 20000 }).then(() => true, () => false);
    const rs = await page.evaluate(() => ({ grid: (document.getElementById('grid') || {}).textContent || '',
      note: /not answering/.test(document.getElementById('uoffline-slot').textContent || '') }));
    ok('[refusestall] a 500 whose body stalls past the limit is a failed poll (control)', failed);
    ok('[refusestall] and it keeps its own words: status 500, not "nothing answered", and no "not answering" note',
      /status 500/.test(rs.grid) && !/nothing answered for/.test(rs.grid) && !rs.note, JSON.stringify({ note: rs.note, grid: rs.grid.slice(0, 260) }));
    await page.close();
  }
  for (const r of HELD.splice(0)) { try { r.destroy(); } catch { /* already gone */ } }

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
