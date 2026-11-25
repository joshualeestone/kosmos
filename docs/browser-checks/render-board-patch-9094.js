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
 *   2. A NEW AGENT STILL PAINTS WHOLE: gamma appears (the number of pieces changes), and the list and grid then show
 *      alpha, beta and gamma, each once.
 * RED with the fix off (setGridHtml and paintAgentListNow writing innerHTML whole): arm 1's beta assertions fail.
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
  setFleet(['alpha', 'beta']);
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
  /* serviceWorkers: 'block', as sibling checks do: the page registers web/sw.js, which answers /api/ pictures itself, and
     page.route() does not see a request a service worker handles, so arm 4's forced 500 would never apply. */
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
      return { rowBetaKept: !!one('#alist .lrow', 'beta') && one('#alist .lrow', 'beta').__m9094 === true,
        cardBetaKept: !!one('#grid .acard', 'beta') && one('#grid .acard', 'beta').__m9094 === true };
    });
    const polls = statusPolls.length - pollsBefore;
    say('arm 1: the polls ran (at least 3 since the change)', polls >= 3, polls + ' polls');
    say('arm 1: alpha\'s row was redrawn with its new picture', !!(seen && seen.rowAlphaNew && seen.rowAlphaV), JSON.stringify(seen));
    say('arm 1: alpha\'s card was redrawn with its new picture', !!(seen && seen.cardAlphaNew && seen.cardAlphaV), JSON.stringify(seen));
    say('arm 1: beta\'s row is the same node (not redrawn)', after.rowBetaKept, JSON.stringify(after));
    say('arm 1: beta\'s card is the same node (not redrawn)', after.cardBetaKept, JSON.stringify(after));

    // Arm 2: a new agent changes the number of pieces, so the list and grid are written whole and stay right.
    setFleet(['alpha', 'beta', 'gamma']);
    let three = null;
    for (let i = 0; i < 40; i++) {
      await p.waitForTimeout(500);
      three = await p.evaluate(() => ({
        rows: [...document.querySelectorAll('#alist .lrow')].map((e) => e.dataset.agent).sort().join(','),
        cards: [...document.querySelectorAll('#grid .acard')].map((e) => e.dataset.agent).sort().join(','),
      }));
      if (three.rows === 'alpha,beta,gamma' && three.cards === 'alpha,beta,gamma') break;
    }
    say('arm 2: the list shows alpha, beta and gamma once each', !!three && three.rows === 'alpha,beta,gamma', JSON.stringify(three));
    say('arm 2: the grid shows alpha, beta and gamma once each', !!three && three.cards === 'alpha,beta,gamma', JSON.stringify(three));
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
