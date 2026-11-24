/* kosmos#8990: a poll that changes nothing rebuilds no avatar, in a real browser.
 *
 * The report: agent avatars "seem to reload continuously" in a project room. Measured on main 87918b0c75 with a
 * project room open: every status poll rewrote the board's card grid (#grid, painted even while hidden behind the
 * room) and the agents rail (#alist) with innerHTML, so each member's avatar node was destroyed and rebuilt every
 * poll, and agent avatars are served no-store, so each rebuild fetched the picture again (32 rebuilds and 16 fetches
 * in 40 s for two agents). The fix writes each of the two only when its markup changed (setGridHtml, ALIST_HTML).
 *
 * Two arms, because a guard that skips writes can fail in either direction:
 *   1. STEADY: over the polls of a 16 s window (at least two are required) with nothing changing, no avatar node is added or removed in #grid or #alist
 *      and no avatar is fetched. The arm also asserts that the polls RAN (status responses counted), or "nothing was
 *      rebuilt" would be true of a page that never polled.
 *   2. A REAL CHANGE STILL PAINTS: one agent's session ends, and within a few polls both the grid and the rail stop
 *      showing it as running. A memo that never wrote again would pass arm 1 and fail here.
 *   3. A NEW PICTURE IS DRAWN (run before arm 2): an uploaded avatar replaces the avatar element in the grid and the
 *      rail. The avatar URLs carry the picture's version (?v=), so a new picture is a change of markup (#2698's rule).
 *   4. A FAILED PICTURE IS ASKED FOR AGAIN: with alpha's avatar answering 500, later polls request it again.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-avatar-steady-8990.js
 * Self-contained: a throwaway board (sandboxed data, fake tmux) on a free port, killed at the end.
 */
// Browser-check-surface: setGridHtml ALIST_HTML paintAgentListNow repaintAgentOrder
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const REPO = path.resolve(__dirname, '..', '..');
const PORT = Number(execFileSync(process.execPath,
  ['-e', "const s=require('node:net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close();});"]).toString().trim());

let failures = 0, ran = 0;
const say = (n, cond, note) => {
  ran++;
  if (cond) console.log('PASS  ' + n + (note ? '  ' + note : ''));
  else { failures++; console.log('FAIL  ' + n + '  --  ' + (note || 'assertion failed')); }
};

(async () => {
  const roots = {};
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'av8990-' + k.toLowerCase() + '-'));
  const fleet = require(path.join(REPO, 'test-support', 'fleet'));
  const panes = roots.DATA + '/fake-panes';
  const sessions = roots.DATA + '/fake-sessions';
  const setFleet = (names) => {
    fs.writeFileSync(panes, names.map((n) => fleet.line({ session: n + '-discord', claim: n, title: '✳ idle' })).join('\n'));
    fs.writeFileSync(sessions, names.map((n) => n + '-discord\n').join(''));
  };
  setFleet(['alpha', 'beta']);
  process.env.AGENT_WORKFORCE_DATA = roots.DATA;
  const store = require(path.join(REPO, 'engine', 'store'));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  store.saveAvatar('alpha', 'image/png', png);
  store.saveAvatar('beta', 'image/png', png);
  const srv = spawn(process.execPath, ['server.js'], { cwd: REPO, stdio: 'ignore', env: { ...process.env, PORT: String(PORT),
    AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
    AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS, AGENT_WORKFORCE_LAUNCH: roots.LAUNCH,
    AGENT_WORKFORCE_PROJECTS: roots.PROJECTS, AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
    AGENT_WORKFORCE_FAKE_PANES: panes, AGENT_WORKFORCE_FAKE_SESSIONS: sessions } });
  const BASE = 'http://127.0.0.1:' + PORT;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/status')).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('pageerror', (e) => say('no page error', false, e.message));
  try {
    await p.goto(BASE + '/', { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    const id = await p.evaluate(async () => {
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Avatar Check' }) });
      const pid = (await r.json()).project.id;
      for (const a of ['alpha', 'beta']) await fetch('/api/project/' + pid + '/agent/' + a, { method: 'POST', headers: { 'content-type': 'application/json' } });
      return pid;
    });
    await p.goto(BASE + '/?project=' + id, { waitUntil: 'networkidle' });
    await p.waitForTimeout(6000);   // the first polls settle the board before anything is counted

    const avatarFetches = []; const statusPolls = [];
    p.on('response', (r) => {
      const u = r.url();
      if (/\/api\/agent\/[^/]+\/avatar(\?|$)/.test(u)) avatarFetches.push(u.replace(BASE, ''));
      if (/\/api\/status(\?|$)/.test(u)) statusPolls.push(Date.now());
    });
    const start = await p.evaluate(() => {
      const isAv = (n) => n && n.nodeType === 1 && (n.nodeName === 'IMG' || n.nodeName.toLowerCase() === 'image')
        && /\/api\/agent\/[^/]+\/avatar(\?|$)/.test(n.getAttribute('src') || n.getAttribute('href') || '');
      window.__av8990 = { grid: 0, alist: 0 };
      const where = (n) => (n.closest && n.closest('#grid') ? 'grid' : n.closest && n.closest('#alist') ? 'alist' : null);
      const count = (n, target) => {
        if (!n || n.nodeType !== 1) return;
        const all = (isAv(n) ? [n] : []).concat([...(n.querySelectorAll ? n.querySelectorAll('img, image') : [])].filter(isAv));
        for (const a of all) { const w = where(a) || where(target); if (w) window.__av8990[w]++; }
      };
      new MutationObserver((ms) => { for (const m of ms) { m.addedNodes.forEach((n) => count(n, m.target)); m.removedNodes.forEach((n) => count(n, m.target)); } })
        .observe(document.body, { childList: true, subtree: true });
      const has = (sel) => [...document.querySelectorAll(sel + ' img, ' + sel + ' image')].filter(isAv).length;
      return { grid: has('#grid'), alist: has('#alist') };
    });
    say('fixture: both avatars are drawn in the grid and in the rail', start.grid === 2 && start.alist === 2, JSON.stringify(start));

    // Arm 1: steady.
    await p.waitForTimeout(16000);
    const steady = await p.evaluate(() => ({ ...window.__av8990 }));
    say('the board polled during the steady window (else arm 1 proves nothing)', statusPolls.length >= 2, statusPolls.length + ' status responses');
    say('steady: no avatar node rebuilt in the grid', steady.grid === 0, steady.grid + ' added or removed');
    say('steady: no avatar node rebuilt in the rail', steady.alist === 0, steady.alist + ' added or removed');
    say('steady: no avatar fetched again', avatarFetches.length === 0, avatarFetches.length + ' fetches ' + avatarFetches.slice(0, 4).join(' '));

    // Arm 3 (run before arm 2, which ends beta's session): a NEW picture for alpha reaches the grid and the rail. The
    // avatar URL must change with the picture's version, or the memo sees identical markup and keeps the old picture.
    await p.evaluate(() => {
      const isAv = (n) => /\/api\/agent\/alpha\/avatar(\?|$)/.test(n.getAttribute('src') || n.getAttribute('href') || '');
      window.__oldAlpha = [...document.querySelectorAll('#grid image, #grid img, #alist img')].filter(isAv);
    });
    const put = await p.evaluate(async () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
      const r = await fetch('/api/agent/alpha/avatar', { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png });
      return r.status;
    });
    let pic = null;
    for (let i = 0; i < 40 && !(pic && pic.grid && pic.alist); i++) {
      await p.waitForTimeout(500);
      pic = await p.evaluate(() => {
        const isAv = (n) => /\/api\/agent\/alpha\/avatar(\?|$)/.test(n.getAttribute('src') || n.getAttribute('href') || '');
        const fresh = (sel) => { const now = [...document.querySelectorAll(sel)].filter(isAv); return now.length > 0 && now.every((n) => !window.__oldAlpha.includes(n)); };
        return { grid: fresh('#grid image, #grid img'), alist: fresh('#alist img'), old: window.__oldAlpha.length };
      });
    }
    say('fixture: the new picture was saved (and alpha was drawn in both places before)', put >= 200 && put < 300 && pic && pic.old === 2, 'PUT ' + put + ' ' + JSON.stringify(pic));
    say('a new picture is drawn in the grid (its avatar element is replaced)', !!(pic && pic.grid), JSON.stringify(pic));
    say('a new picture is drawn in the rail (its avatar element is replaced)', !!(pic && pic.alist), JSON.stringify(pic));

    // Arm 4: a picture that FAILS to load is tried again at the next poll (rebuilding every poll used to do that). Every
    // alpha avatar request now answers 500; a new picture changes the markup, both places load it and fail, and then
    // only the retry can ask again. Without it this window sees exactly two requests (one per place).
    const failed = [];
    await p.route('**/api/agent/alpha/avatar*', (r) => { if (r.request().method() === 'GET') { failed.push(Date.now()); r.fulfill({ status: 500, body: '' }); } else r.continue(); });
    const put2 = await p.evaluate(async () => (await fetch('/api/agent/alpha/avatar', { method: 'PUT', headers: { 'content-type': 'image/png' },
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]) })).status);
    await p.waitForTimeout(14000);
    await p.unroute('**/api/agent/alpha/avatar*');
    say('a failed avatar is asked for again at later polls', put2 >= 200 && put2 < 300 && failed.length >= 4, 'PUT ' + put2 + ', ' + failed.length + ' failed requests in 14 s');

    // Arm 2: a real change still paints both. First, beta is drawn as running in both, so the arm can fail.
    const running = await p.evaluate(() => {
      const on = (sel) => { const el = document.querySelector(sel + '[data-agent="beta"]'); return !!el && !el.classList.contains('notrunning'); };
      return { grid: on('#grid .acard'), alist: on('#alist .lrow') };
    });
    say('before the change, beta is drawn as running in the grid and the rail', running.grid && running.alist, JSON.stringify(running));
    setFleet(['alpha']);
    let seen = null;
    for (let i = 0; i < 40 && !(seen && seen.grid && seen.alist); i++) {
      await p.waitForTimeout(500);
      seen = await p.evaluate(() => {
        const gone = (sel) => { const el = document.querySelector(sel + '[data-agent="beta"]'); return !el || el.classList.contains('notrunning'); };
        return { grid: gone('#grid .acard'), alist: gone('#alist .lrow') };
      });
    }
    say('a change still paints: the grid stops showing beta as running', !!(seen && seen.grid), JSON.stringify(seen));
    say('a change still paints: the rail stops showing beta as running', !!(seen && seen.alist), JSON.stringify(seen));
  } catch (e) {
    say('the check ran to the end', false, String(e && e.stack || e));
  } finally {
    await b.close();
    srv.kill();
  }
  console.log(failures ? 'FAILED: ' + failures + ' of ' + ran : 'all good: ' + ran + ' passed');
  process.exit(failures ? 1 : 0);
})();
