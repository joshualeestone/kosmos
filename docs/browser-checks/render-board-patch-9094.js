/* kosmos#9094: when one agent changes, the board's agent list and card grid replace only that agent's row and card.
 *
 * Josh, 11-25 16:48: "the agent list seems to redraw every like 10 seconds". Measured on a live 0.8.24 board with 20
 * agents: 12 status polls in 60 s gave 3 whole-list rewrites (#alist innerHTML), each replacing all 20 rows when one
 * row had changed (one agent's state word, or its memory ring). #8990 skips a write only when NOTHING changed; any one
 * change still rebuilt every row and card. patchBoardHtml now replaces only the pieces whose markup changed.
 *
 * Arms:
 *   1. ONE CHANGE, ONE ROW: alpha gets a new picture (its avatar URL's version changes, so only its markup changes).
 *      Within a few polls alpha's row in #alist and its card in #grid are new nodes carrying the new version, and beta's
 *      row and card are the SAME nodes as before (a marker property set on them survives). The polls are counted, so a
 *      page that never repainted cannot pass.
 *   2. A STAR MOVES ONE ROW, NOT THE ROWS IT PASSES: gamma is starred, so it moves above alpha and beta. The list and
 *      grid then show gamma first, and alpha's and beta's rows and cards are still the same nodes. (Gamma's own row
 *      is redrawn: its star is part of its markup.)
 *      Neither of their nodes is even detached (a move would restart their animations), counted by a MutationObserver.
 *   3. A ROW MOVING DOWN MOVES ALONE: gamma's star comes off, so it moves below alpha and beta; neither is detached.
 *   4. A NEW AGENT STILL PAINTS: delta appears, and the list and grid then show all four, each once.
 * RED controls, run by hand in a queued job that edits web/index.html and restores it: patchBoardHtml forced to write
 * whole fails arms 1 to 3; matching by position instead of data-agent fails arms 2 and 3; moving every kept node (no
 * in-order run kept) fails arms 2 and 3. The reorder itself also runs in web.board-patch-9094.test.js.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-board-patch-9094.js
 * Self-contained: a throwaway board (sandboxed data, fake tmux) on a free port, killed at the end.
 */
// Browser-check-surface: patchBoardHtml setGridHtml ALIST_HTML ALIST_PARTS GRID_PARTS paintAgentListNow
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium } = require('playwright');

/* A 16x16 PNG of one colour (as render-avatar-4038.js builds it): a picture a browser can decode, so no avatar on this
   board fails to load unless an arm makes it. */
function solidPng(r, g, bl) {
  const w = 16; const h = 16;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [r, g, bl][i % 3])]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

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
  for (const k of ['DATA', 'WORKERS', 'LAUNCH', 'PROJECTS']) roots[k] = fs.mkdtempSync(path.join(os.tmpdir(), 'patch9094-' + k.toLowerCase() + '-'));
  const fleet = require(path.join(REPO, 'test-support', 'fleet'));
  const panes = roots.DATA + '/fake-panes';
  const sessions = roots.DATA + '/fake-sessions';
  const setFleet = (names) => {
    fs.writeFileSync(panes, names.map((n) => fleet.line({ session: n + '-discord', claim: n, title: '✳ idle' })).join('\n'));
    fs.writeFileSync(sessions, names.map((n) => n + '-discord\n').join(''));
  };
  setFleet(['alpha', 'beta', 'gamma']);
  process.env.AGENT_WORKFORCE_DATA = roots.DATA;
  const store = require(path.join(REPO, 'engine', 'store'));
  store.saveAvatar('alpha', 'image/png', solidPng(220, 20, 20));
  store.saveAvatar('beta', 'image/png', solidPng(20, 20, 220));
  const srv = spawn(process.execPath, ['server.js'], { cwd: REPO, stdio: 'ignore', env: { ...process.env, PORT: String(PORT),
    AGENT_WORKFORCE_RELEASE_BASE: 'http://127.0.0.1:9/dist',
    AGENT_WORKFORCE_DATA: roots.DATA, AGENT_WORKFORCE_WORKERS: roots.WORKERS, AGENT_WORKFORCE_LAUNCH: roots.LAUNCH,
    AGENT_WORKFORCE_PROJECTS: roots.PROJECTS, AGENT_WORKFORCE_TMUX_BIN: path.join(REPO, 'test-support', 'fake-tmux.sh'),
    AGENT_WORKFORCE_FAKE_PANES: panes, AGENT_WORKFORCE_FAKE_SESSIONS: sessions } });
  const BASE = 'http://127.0.0.1:' + PORT;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/api/status')).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }

  const b = await chromium.launch();
  /* serviceWorkers: 'block', as sibling checks do: the page registers web/sw.js, which answers /api/ pictures itself. */
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => say('no page error', false, e.message));
  try {
    await p.goto(BASE + '/', { waitUntil: 'networkidle' });
    if (await p.isVisible('#firstrun')) await p.keyboard.press('Escape');
    await p.waitForTimeout(6000);   // the first polls settle the board before anything is marked

    const statusPolls = [];
    p.on('response', (r) => { if (/\/api\/status(\?|$)/.test(r.url()) && r.ok()) statusPolls.push(Date.now()); });
    const marked = await p.evaluate(() => {
      const got = {};
      for (const [sel, k] of [['#alist .lrow', 'row'], ['#grid .acard', 'card']]) {
        for (const a of ['alpha', 'beta']) {
          const el = document.querySelector(sel + '[data-agent="' + a + '"]');
          if (el) { el.__m9094 = true; got[k + ':' + a] = true; }
        }
      }
      return got;
    });
    say('fixture: alpha and beta each have a row and a card', Object.keys(marked).length === 4, JSON.stringify(marked));

    // Arm 1: change alpha only.
    const put = await p.evaluate(async (bytes) => (await fetch('/api/agent/alpha/avatar', { method: 'PUT',
      headers: { 'content-type': 'image/png' }, body: new Uint8Array(bytes) })).status, [...solidPng(20, 200, 20)]);
    say('fixture: alpha\'s new picture was accepted', put >= 200 && put < 300, 'PUT ' + put);
    const pollsBefore = statusPolls.length;
    let seen = null;
    for (let i = 0; i < 40; i++) {
      await p.waitForTimeout(500);
      seen = await p.evaluate(() => {
        const one = (sel, a) => document.querySelector(sel + '[data-agent="' + a + '"]');
        const ver = (el) => { const n = el && el.querySelector('img, image'); return n ? (/[?&]v=(\d+)/.exec(n.getAttribute('src') || n.getAttribute('href') || '') || [])[1] || null : null; };
        return {
          rowAlphaNew: !!one('#alist .lrow', 'alpha') && one('#alist .lrow', 'alpha').__m9094 !== true, rowAlphaV: ver(one('#alist .lrow', 'alpha')),
          cardAlphaNew: !!one('#grid .acard', 'alpha') && one('#grid .acard', 'alpha').__m9094 !== true, cardAlphaV: ver(one('#grid .acard', 'alpha')),
          rowBetaKept: !!one('#alist .lrow', 'beta') && one('#alist .lrow', 'beta').__m9094 === true,
          cardBetaKept: !!one('#grid .acard', 'beta') && one('#grid .acard', 'beta').__m9094 === true,
        };
      });
      if (seen.rowAlphaNew && seen.cardAlphaNew && statusPolls.length - pollsBefore >= 2) break;
    }
    await p.waitForTimeout(5500);   // one more poll after the change landed, so a later whole write would show
    const after = await p.evaluate(() => {
      const one = (sel, a) => document.querySelector(sel + '[data-agent="' + a + '"]');
      const img = one('#alist .lrow', 'alpha') && one('#alist .lrow', 'alpha').querySelector('img');
      return { decoded: !!img && img.complete && img.naturalWidth > 0, rowBetaKept: !!one('#alist .lrow', 'beta') && one('#alist .lrow', 'beta').__m9094 === true,
        cardBetaKept: !!one('#grid .acard', 'beta') && one('#grid .acard', 'beta').__m9094 === true };
    });
    const polls = statusPolls.length - pollsBefore;
    say('arm 1: the polls ran (at least 2 since the change)', polls >= 2, polls + ' polls');
    say('arm 1: alpha\'s row was redrawn with its new picture', !!(seen && seen.rowAlphaNew && seen.rowAlphaV), JSON.stringify(seen));
    say('arm 1: alpha\'s card was redrawn with its new picture', !!(seen && seen.cardAlphaNew && seen.cardAlphaV), JSON.stringify(seen));
    say('arm 1: beta\'s row is the same node (not redrawn)', after.rowBetaKept, JSON.stringify(after));
    say('arm 1: beta\'s card is the same node (not redrawn)', after.cardBetaKept, JSON.stringify(after));
    say('arm 1: alpha\'s new row picture decoded (built in a template, then moved into the page)', after.decoded, JSON.stringify(after));

    // Arm 2: star gamma, so it moves above alpha and beta; those two stay the same nodes.
    /* A moved node keeps its identity, so the marker alone cannot see a move. Count every time alpha's or beta's row or
       card is detached from its container: a move detaches it, an untouched node never is. */
    await p.evaluate(() => {
      for (const sel of ['#alist .lrow', '#grid .acard']) for (const a of ['alpha', 'beta', 'gamma']) {
        const el = document.querySelector(sel + '[data-agent="' + a + '"]'); if (el) el.__m9094b = true;
      }
      window.__det9094 = 0;
      const watch = (id) => new MutationObserver((ms) => { for (const m of ms) for (const n of m.removedNodes) {
        if (n.nodeType === 1 && (n.dataset.agent === 'alpha' || n.dataset.agent === 'beta')) window.__det9094 += 1;
      } }).observe(document.getElementById(id), { childList: true });
      watch('alist'); watch('grid');
    });
    const star = await p.evaluate(async () => (await fetch('/api/agent-stars', { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'gamma', on: true }) })).status);
    say('fixture: gamma\'s star was accepted', star >= 200 && star < 300, 'PUT ' + star);
    await p.evaluate(() => (typeof loadStars === 'function' ? loadStars() : null));   // eslint-disable-line no-undef
    let moved = null;
    for (let i = 0; i < 30; i++) {
      await p.waitForTimeout(500);
      moved = await p.evaluate(() => {
        const order = (sel) => [...document.querySelectorAll(sel)].map((e) => e.dataset.agent).join(',');
        const kept = (sel) => ['alpha', 'beta'].every((a) => { const el = document.querySelector(sel + '[data-agent="' + a + '"]'); return !!el && el.__m9094b === true; });
        const fresh = (sel) => { const el = document.querySelector(sel + '[data-agent="gamma"]'); return !!el && el.__m9094b !== true; };
        return { rows: order('#alist .lrow'), cards: order('#grid .acard'), rowsKept: kept('#alist .lrow'), cardsKept: kept('#grid .acard'),
          gammaRedrawn: fresh('#alist .lrow') && fresh('#grid .acard'), detached: window.__det9094 };
      });
      if (moved.rows === 'gamma,alpha,beta' && moved.cards === 'gamma,alpha,beta') break;
    }
    say('arm 2: the starred gamma now comes first in the list and the grid', !!moved && moved.rows === 'gamma,alpha,beta' && moved.cards === 'gamma,alpha,beta', JSON.stringify(moved));
    say('arm 2: alpha\'s and beta\'s rows were not redrawn when gamma passed them', !!moved && moved.rowsKept, JSON.stringify(moved));
    say('arm 2: alpha\'s and beta\'s cards were not redrawn when gamma passed them', !!moved && moved.cardsKept, JSON.stringify(moved));
    say('arm 2: gamma\'s own row and card were redrawn (its star is in its markup)', !!moved && moved.gammaRedrawn, JSON.stringify(moved));
    say('arm 2: alpha\'s and beta\'s nodes were never even moved', !!moved && moved.detached === 0, JSON.stringify(moved));

    // Arm 3: un-star gamma, so it moves DOWN past alpha and beta; still only gamma moves.
    await p.evaluate(() => { window.__det9094 = 0; });
    const unstar = await p.evaluate(async () => (await fetch('/api/agent-stars', { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'gamma', on: false }) })).status);
    say('fixture: gamma\'s star was taken off', unstar >= 200 && unstar < 300, 'PUT ' + unstar);
    await p.evaluate(() => (typeof loadStars === 'function' ? loadStars() : null));   // eslint-disable-line no-undef
    let down = null;
    for (let i = 0; i < 30; i++) {
      await p.waitForTimeout(500);
      down = await p.evaluate(() => {
        const order = (sel) => [...document.querySelectorAll(sel)].map((e) => e.dataset.agent).join(',');
        return { rows: order('#alist .lrow'), cards: order('#grid .acard'), detached: window.__det9094 };
      });
      if (down.rows === 'alpha,beta,gamma' && down.cards === 'alpha,beta,gamma') break;
    }
    say('arm 3: gamma is back after alpha and beta in the list and the grid', !!down && down.rows === 'alpha,beta,gamma' && down.cards === 'alpha,beta,gamma', JSON.stringify(down));
    say('arm 3: moving gamma down moved neither alpha nor beta', !!down && down.detached === 0, JSON.stringify(down));

    // Arm 4: a new agent still paints, once each.
    setFleet(['alpha', 'beta', 'gamma', 'delta']);
    let three = null;
    for (let i = 0; i < 40; i++) {
      await p.waitForTimeout(500);
      three = await p.evaluate(() => ({
        rows: [...document.querySelectorAll('#alist .lrow')].map((e) => e.dataset.agent).sort().join(','),
        cards: [...document.querySelectorAll('#grid .acard')].map((e) => e.dataset.agent).sort().join(','),
      }));
      if (three.rows === 'alpha,beta,delta,gamma' && three.cards === 'alpha,beta,delta,gamma') break;
    }
    say('arm 4: the list shows all four agents once each', !!three && three.rows === 'alpha,beta,delta,gamma', JSON.stringify(three));
    say('arm 4: the grid shows all four agents once each', !!three && three.cards === 'alpha,beta,delta,gamma', JSON.stringify(three));
  } catch (e) {
    say('the check ran to the end', false, String(e && e.stack || e));
  } finally {
    await b.close();
    srv.kill();
    for (const k of Object.keys(roots)) { try { fs.rmSync(roots[k], { recursive: true, force: true }); } catch { /* left for the OS */ } }
  }
  console.log(failures ? 'FAILED: ' + failures + ' of ' + ran : 'all good: ' + ran + ' passed');
  process.exit(failures ? 1 : 0);
})();
