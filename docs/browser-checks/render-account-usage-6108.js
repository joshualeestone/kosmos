'use strict';

/**
 * kosmos#6108: a Claude account row in Settings > AI Models says how much of its weekly limit it has used, which of
 * this computer's agents run on it, warns at 75%, and moves those agents to another account.
 *
 * Drives the real paintAccounts() against a stubbed /api/accounts and a stubbed move route (no board), in Chromium
 * and WebKit, at desktop and phone width. The claims, each one able to fail:
 *  - an 82% row draws its meter at 82%, says "82% of its weekly limit used · resets ... · as of ...", carries the
 *    warning, and names its agents by their display names (not session names);
 *  - Move offers the other Claude account with its own reading, stays disabled until a target is picked, then sends
 *    one move per agent to the existing per-agent route with the target's dir, and says how many moved;
 *  - a row with no reading says so plainly and carries no warning; a 40% row carries no warning;
 *  - an API-key row draws no meter (a key has no weekly limit); an older board's row (no agentsHere) draws nothing;
 *  - an agent name with markup is shown as text;
 *  - at 390 px the page does not scroll sideways and the move control fits its row.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-account-usage-6108.js
 *
 * HEADED by default, like the other checks here; HEADED=0 on a machine with no console session.
 */

const nodePath = require('node:path');
let pw;
try { pw = require('playwright'); }
catch { console.log('render-account-usage-6108: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const H = 3600e3, now = Date.now();
const conn = { state: 'connected', badge: 'working', checkedLive: true, because: 'a real request succeeded', observedAt: now - 9000, observedAgeMs: 9000 };
const claude = (email, dir, extra) => ({ provider: 'anthropic', providerName: 'Anthropic / Claude', email, label: email, dir: '/home/.claude-' + dir,
  organization: null, isDefault: false, keyTail: null, name: null, memoryShared: true, connection: conn, ...extra });
const ACCOUNTS = [
  claude('busy@example.com', 'busy', { weekly: { usedPct: 82, resetsAt: now + 50 * H, at: now - 2 * H }, agentsHere: { names: ['s-dana', 's-eli'], complete: true } }),
  claude('spare@example.com', 'spare', { weekly: { usedPct: 20, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: [], complete: true } }),
  claude('fresh@example.com', 'fresh', { weekly: null, agentsHere: { names: ['s-x'], complete: true } }),
  claude('calm@example.com', 'calm', { weekly: { usedPct: 40, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: [], complete: true } }),
  claude('key@example.com', 'key', { apiKey: true, weekly: null, agentsHere: { names: [], complete: true } }),
  claude('old@example.com', 'old', {}),   // an older board: no weekly, no agentsHere
];
const AGENTS = [{ sessionName: 's-dana', name: 'Dana' }, { sessionName: 's-eli', name: 'Eli' }, { sessionName: 's-x', name: 'x<b>y' }];

const fails = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fails.push(label); };

(async () => {
  for (const engine of ['chromium', 'webkit']) {
    let browser;
    try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
    catch (err) { say(false, '[' + engine + '] could not start a browser', err && err.message ? err.message.split('\n')[0] : String(err)); continue; }
    for (const [w, h] of [[1100, 900], [390, 844]]) {
      const tag = '[' + engine + ' ' + w + ']';
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      /* A file:// page has no board behind it, so the page's own background reads (/api/status and friends) fail; WebKit
         reports each as "... due to access control checks". Those are this harness, not the change; any other error counts. */
      const errs = []; page.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) errs.push(e.message); });
      await page.goto('file://' + PAGE);
      const r = await page.evaluate(async ({ accounts, agents }) => {
        const posts = [];
        const realFetch = window.fetch;
        window.fetch = (u, opts) => {
          const url = String(u);
          if (url.indexOf('/api/accounts') !== -1) return Promise.resolve({ ok: true, json: async () => ({ accounts }) });
          const m = url.match(/\/api\/agent\/([^/]+)\/account$/);
          if (m && opts && opts.method === 'POST') { posts.push({ agent: decodeURIComponent(m[1]), dir: JSON.parse(opts.body).dir }); return Promise.resolve({ ok: true, json: async () => ({ outcome: 'changed', because: 'moved' }) }); }
          return realFetch(u, opts);
        };
        if (typeof paintAccounts !== 'function') return { error: 'paintAccounts is not a function' };
        LAST = agents;
        const sec = document.getElementById('s-sec-accounts'); if (sec) { sec.hidden = false; sec.style.display = 'block'; }
        await paintAccounts();
        /* By the row's own dir, never by its text: every email also appears in the other rows' Move menus. */
        const box = (email) => document.querySelector('#set-accounts .acct-box[data-acct-dir="/home/.claude-' + email.split('@')[0] + '"]');
        const read = (email) => {
          const b = box(email); if (!b) return null;
          const u = b.querySelector('.acct-usage');
          const fill = b.querySelector('.acct-usage-meter .bar i');
          const sel = b.querySelector('[data-acct-move-to]'), btn = b.querySelector('[data-acct-move]');
          const br = b.getBoundingClientRect(), mr = b.querySelector('.acct-move') ? b.querySelector('.acct-move').getBoundingClientRect() : null;
          return { has: !!u, line: u && u.querySelector('.acct-usage-line') ? u.querySelector('.acct-usage-line').textContent.trim() : null,
            fill: fill ? fill.style.width : null, warn: !!(u && u.querySelector('.acct-usage-warn')),
            agents: u && u.querySelector('.acct-agents-line') ? u.querySelector('.acct-agents-line').textContent.trim() : null,
            agentsEls: u && u.querySelector('.acct-agents-line') ? u.querySelector('.acct-agents-line').querySelectorAll('b').length : 0,
            options: sel ? [...sel.options].map((o) => o.textContent.trim()) : null, btnDisabled: btn ? btn.disabled : null,
            moveInside: mr ? mr.right <= br.right + 0.5 && mr.left >= br.left - 0.5 : null };
        };
        const before = { busy: read('busy@example.com'), fresh: read('fresh@example.com'), calm: read('calm@example.com'), key: read('key@example.com'), old: read('old@example.com') };
        // Move busy's agents to spare.
        const b = box('busy@example.com'); const sel = b && b.querySelector('[data-acct-move-to]'); const btn = b && b.querySelector('[data-acct-move]');
        let moved = null;
        if (sel && btn) {
          sel.value = '/home/.claude-spare'; sel.dispatchEvent(new Event('change'));
          const enabled = !btn.disabled;
          btn.click();
          for (let i = 0; i < 100 && posts.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
          await new Promise((r) => setTimeout(r, 200));
          const msg = document.querySelector('[data-acct-move-msg="/home/.claude-busy"]');
          moved = { enabled, posts: posts.slice(), msg: msg ? msg.textContent.trim() : null };
        }
        return { before, moved, sideways: document.documentElement.scrollWidth - window.innerWidth };
      }, { accounts: ACCOUNTS, agents: AGENTS });
      await page.close();
      if (r.error) { say(false, tag + ' ' + r.error); continue; }
      const { busy, fresh, calm, key, old } = r.before;
      say(!!busy && busy.has && busy.fill === '82%', tag + ' an 82% row draws its meter at 82%', JSON.stringify(busy && busy.fill));
      say(!!busy && /^82% of its weekly limit used · resets .+ · as of 2 hours ago$/.test(busy.line || ''), tag + ' the row says how much is used, when it resets and how old the reading is', JSON.stringify(busy && busy.line));
      say(!!busy && busy.warn, tag + ' at 82% the row warns');
      say(!!busy && busy.agents === 'Its agents on this computer: Dana, Eli', tag + ' it names its agents by display name', JSON.stringify(busy && busy.agents));
      say(!!busy && Array.isArray(busy.options) && busy.options.some((o) => o === 'spare@example.com (20% used)') && !busy.options.some((o) => o.startsWith('busy@')), tag + ' Move offers the other account with its own reading, never itself', JSON.stringify(busy && busy.options));
      say(!!busy && busy.btnDisabled === true, tag + ' Move is disabled until a target is picked');
      say(!!r.moved && r.moved.enabled && r.moved.posts.length === 2 && r.moved.posts.every((p) => p.dir === '/home/.claude-spare') && r.moved.posts.map((p) => p.agent).sort().join() === 's-dana,s-eli', tag + ' Move sends one move per agent, to the picked account', JSON.stringify(r.moved));
      say(!!r.moved && r.moved.msg === 'Moved 2 agents.', tag + ' and says how many moved', JSON.stringify(r.moved && r.moved.msg));
      say(!!fresh && fresh.line === 'No usage reading for this account yet.' && !fresh.warn, tag + ' a row with no reading says so, and does not warn', JSON.stringify(fresh));
      say(!!fresh && fresh.agents === 'Its agents on this computer: x<b>y' && fresh.agentsEls === 0, tag + ' an agent name with markup is shown as text', JSON.stringify(fresh && fresh.agents));
      say(!!calm && calm.fill === '40%' && !calm.warn, tag + ' a 40% row does not warn', JSON.stringify(calm));
      say(!!key && key.has && key.fill === null && key.line === null, tag + ' an API-key row draws no meter', JSON.stringify(key));
      say(!!old && !old.has, tag + ' an older board\'s row draws no usage block', JSON.stringify(old));
      say(!!busy && busy.moveInside === true, tag + ' the move control fits inside its row');
      say(r.sideways <= 0, tag + ' the page does not scroll sideways', String(r.sideways));
      say(errs.length === 0, tag + ' no page errors', errs.join(' | '));
    }
    await browser.close();
  }
  console.log(fails.length ? 'FAILED' : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
