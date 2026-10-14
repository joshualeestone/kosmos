'use strict';

/**
 * kosmos#6108: a Claude account row in Settings > AI Models says how much of its weekly limit it has used, which of
 * this computer's agents run on it, warns at 75%, and moves those agents to another account.
 *
 * Drives the real paintAccounts() against a stubbed /api/accounts and a stubbed move route (no board), in Chromium
 * and WebKit, at desktop and phone width. The claims, each one able to fail:
 *  - an 82% row draws its meter at 82%, says "82% of its weekly limit used · resets ... · Kosmos last saw it change ...", carries the
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
  claude('busy@example.com', 'busy', { weekly: { usedPct: 82, resetsAt: now + 50 * H, at: now - 2 * H }, agentsHere: { names: ['s-dana', 's-eli', 's-guide'], complete: true } }),
  claude('stale@example.com', 'stale', { weekly: { usedPct: 50, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: ['s-st1', 's-st2'], complete: true } }),
  claude('nocheck@example.com', 'nocheck', { weekly: { usedPct: 50, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: ['s-nc'], complete: true } }),
  claude('tgt@example.com', 'tgt', { weekly: { usedPct: 50, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: ['s-tg'], complete: true } }),
  claude('gone@example.com', 'gone', { weekly: { usedPct: 10, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: [], complete: true } }),
  claude('lost@example.com', 'lost', { weekly: { usedPct: 50, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: ['s-lo'], complete: true } }),
  claude('fullstop@example.com', 'fullstop', { weekly: { usedPct: 100, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: ['s-z2'], complete: true } }),
  claude('nearfull@example.com', 'nearfull', { weekly: { usedPct: 99.6, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: [], complete: true } }),
  claude('warmstop@example.com', 'warmstop', { weekly: { usedPct: 80, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: ['s-z4'], complete: true } }),
  claude('frozen@example.com', 'frozen', { weekly: { usedPct: 30, resetsAt: now + 50 * H, at: now - 30 * H }, weeklyBlocked: 'own-statusline', agentsHere: { names: [], complete: true } }),
  claude('unknown@example.com', 'unknown', { weekly: { usedPct: 30, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: [], complete: false } }),
  claude('inc@example.com', 'inc', { weekly: { usedPct: 50, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: ['s-in'], complete: true } }),
  claude('fullmix@example.com', 'fullmix', { weekly: { usedPct: 100, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: ['s-q2', 's-z3'], complete: true } }),
  claude('weekout@example.com', 'weekout', { weekly: { usedPct: 3, resetsAt: now + 162 * H, at: now - H }, agentsHere: { names: [], complete: true } }),
  claude('mixed@example.com', 'mixed', { weekly: { usedPct: 95, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: ['s-p', 's-r1', 's-r2', 's-slow'], complete: true } }),
  claude('spare@example.com', 'spare', { weekly: { usedPct: 20, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: [], complete: true } }),
  claude('fresh@example.com', 'fresh', { weekly: null, agentsHere: { names: ['s-x'], complete: true } }),
  claude('calm@example.com', 'calm', { weekly: { usedPct: 40, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: [], complete: true } }),
  claude('key@example.com', 'key', { apiKey: true, weekly: null, agentsHere: { names: [], complete: true } }),
  claude('old@example.com', 'old', {}),   // an older board: no weekly, no agentsHere
  claude('guideonly@example.com', 'guideonly', { weekly: { usedPct: 80, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: ['s-guide2'], complete: true } }),
  claude('full@example.com', 'full', { weekly: { usedPct: 100, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: ['s-q'], complete: true } }),
  claude('sleepy@example.com', 'sleepy', { weekly: { usedPct: 50, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: ['s-z'], complete: true } }),
  claude('unwired@example.com', 'unwired', { weekly: null, weeklyBlocked: 'not-wired', agentsHere: { names: [], complete: true } }),
  claude('mine@example.com', 'mine', { weekly: null, weeklyBlocked: 'own-statusline', agentsHere: { names: [], complete: true } }),
  claude('linkedset@example.com', 'linkedset', { weekly: null, weeklyBlocked: 'linked-settings', agentsHere: { names: [], complete: true } }),
  claude('stalewired@example.com', 'stalewired', { weekly: { usedPct: 30, resetsAt: now + 50 * H, at: now - 30 * H }, weeklyBlocked: 'not-wired', agentsHere: { names: [], complete: true } }),
  claude('default@example.com', 'default', { isDefault: true, weekly: null, agentsHere: { names: [], complete: true } }),
  claude('noshare@example.com', 'noshare', { memoryShared: false, weekly: { usedPct: 5, resetsAt: now + 50 * H, at: now - H }, agentsHere: { names: [], complete: true } }),
];
const AGENTS = [{ sessionName: 's-dana', name: 'Dana', state: 'working' }, { sessionName: 's-eli', name: 'Eli', state: 'working' }, { sessionName: 's-x', name: 'x<b>y', state: 'working' },
  { sessionName: 's-guide', name: 'Kosmos Guide', isGuide: true, state: 'working' }, { sessionName: 's-guide2', name: 'Kosmos Guide', isGuide: true, state: 'working' }, { sessionName: 's-q', name: 'Quinn', state: 'working' }, { sessionName: 's-z', name: 'Zed', state: 'stopped' }, { sessionName: 's-z2', name: 'Zoe', state: 'stopped' }, { sessionName: 's-z3', name: 'Zia', state: 'stopped' }, { sessionName: 's-z4', name: 'Zak', state: 'stopped' }, { sessionName: 's-q2', name: 'Quill', state: 'working' }, { sessionName: 's-p', name: 'Pia', state: 'working' }, { sessionName: 's-r1', name: 'Rex', state: 'working' }, { sessionName: 's-r2', name: 'Rio', state: 'working' }, { sessionName: 's-slow', name: 'Sol', state: 'working' }];

const fails = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fails.push(label); };

(async () => {
  for (const engine of ['chromium', 'webkit']) {
    let browser;
    try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
    catch (err) { say(false, '[' + engine + '] could not start a browser', err && err.message ? err.message.split('\n')[0] : String(err)); continue; }
    for (const [w, h, scheme] of [[1100, 900, 'light'], [390, 844, 'light'], [1100, 900, 'dark']]) {
      const tag = '[' + engine + ' ' + w + (scheme === 'dark' ? ' dark' : '') + ']';
      const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
      /* A file:// page has no board behind it, so the page's own background reads (/api/status and friends) fail; WebKit
         reports each as "... due to access control checks". Those are this harness, not the change; any other error counts. */
      const errs = []; page.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) errs.push(e.message); });
      await page.goto('file://' + PAGE);
      const r = await page.evaluate(async ({ accounts, agents }) => {
        const posts = [];
        /* The stub behaves like the engine: a 'changed' move takes the agent off its account in the next list. s-p
           comes back 'partial' (saved, restart pending); s-r1 and s-r2 are refused with the same reason. */
        const where = new Map(); accounts.forEach((a) => (a.agentsHere ? a.agentsHere.names : []).forEach((n) => where.set(n, a.dir)));
        const list = () => accounts.map((a0) => ({ ...a0, ...((window.__acctPatch || {})[a0.dir] || {}) })).map((a) => a.agentsHere ? { ...a, agentsHere: { ...a.agentsHere, names: [...where].filter(([, d]) => d === a.dir).map(([n]) => n) } } : a);
        const realFetch = window.fetch;
        window.fetch = (u, opts) => {
          const url = String(u);
          /* Like the server: agentsHere only when the page asks (?agents=1), so a page that stopped asking draws nothing. */
          if (url.indexOf('/api/accounts') !== -1 && window.__failAccounts > 0 && window.__passAccounts > 0) window.__passAccounts--;   // let the click's own re-read through first
          else if (url.indexOf('/api/accounts') !== -1 && window.__failAccounts > 0) { window.__failAccounts--; return Promise.resolve({ ok: false, status: 503, json: async () => ({}) }); }
          if (url.indexOf('/api/accounts') !== -1 && window.__failNextAccounts) { window.__failNextAccounts = false; return Promise.resolve({ ok: false, status: 503, json: async () => ({}) }); }
          if (url.indexOf('/api/accounts') !== -1) return Promise.resolve({ ok: true, json: async () => ({ accounts: /[?&]agents=1\b/.test(url) ? list() : list().map(({ agentsHere, ...rest }) => rest) }) });
          const m = url.match(/\/api\/agent\/([^/]+)\/account$/);
          if (m && opts && opts.method === 'POST') {
            const agent = decodeURIComponent(m[1]), dir = JSON.parse(opts.body).dir;
            posts.push({ agent, dir });
            if (agent === 's-p') return new Promise((r) => setTimeout(() => r({ ok: true, json: async () => ({ outcome: 'partial', because: 'We saved spare@example.com, but could not start it again: the session is busy. It is still on the old account until it restarts.' }) }), 30));
            if (agent === 's-slow') return new Promise((_, rej) => setTimeout(() => rej(new DOMException('The operation was aborted.', 'AbortError')), 30));   // as the 60 s limit ends it
            if (agent === 's-z') { where.set(agent, dir); return new Promise((r) => setTimeout(() => r({ ok: true, json: async () => ({ outcome: 'partial', because: 'We saved spare@example.com, but could not start it again: Zed is not running, so there is nothing to restart. It starts itself when this computer is on and it is not removed. It is still on the old account until it restarts.' }) }), 30)); }   // the route's real reply for a stopped agent
            if (agent === 's-r1' || agent === 's-r2') return new Promise((r) => setTimeout(() => r({ ok: false, json: async () => ({ outcome: 'refused', because: 'That account does not share this computer\'s memory.' }) }), 30));
            where.set(agent, dir);
            return new Promise((r) => setTimeout(() => r({ ok: true, json: async () => ({ outcome: 'changed', because: 'moved' }) }), 30));
          }
          return realFetch(u, opts);
        };
        if (typeof paintAccounts !== 'function') return { error: 'paintAccounts is not a function' };
        LAST = agents;
        await paintAccounts();
        /* The Settings panel is hidden on a bare page, and a hidden element has no size and cannot take focus. Show the
           list IN PLACE, inside the real Settings panel, so every rule that reaches it on the real screen (.panel p,
           above all) reaches it here: un-hide each ancestor, and hide the page's other top-level panels. Lifting the
           list out of the panel hid exactly the cascade bug this check must catch. */
        const list0 = document.getElementById('set-accounts');
        for (let el = list0; el && el !== document.body; el = el.parentElement) {
          if (el.hidden) el.hidden = false;
          if (getComputedStyle(el).display === 'none') el.style.display = 'block';
        }
        const panel = list0.closest('.panel');
        for (const other of document.querySelectorAll('.panel')) if (other !== panel && !other.contains(panel)) other.style.display = 'none';
        list0.scrollIntoView({ block: 'start' });
        const frame = document.scrollingElement || document.documentElement;
        /* By the row's own dir, never by its text: every email also appears in the other rows' Move menus. */
        const box = (email) => document.querySelector('#set-accounts .acct-box[data-acct-dir="/home/.claude-' + email.split('@')[0] + '"]');
        const read = (email) => {
          const b = box(email); if (!b) return null;
          const u = b.querySelector('.acct-usage');
          const fill = b.querySelector('.acct-usage-meter .bar i');
          const sel = b.querySelector('[data-acct-move-to]'), btn = b.querySelector('[data-acct-move]');
          const br = b.getBoundingClientRect(), mr = b.querySelector('.acct-move') ? b.querySelector('.acct-move').getBoundingClientRect() : null;
          const warnEl = u && u.querySelector('.acct-usage-warn'), note = u && u.querySelector('.acct-move-note');
          const vis = br.width > 0 && br.height > 0;
          const lineEl = u && u.querySelector('.acct-usage-line');
          const cs = lineEl ? getComputedStyle(lineEl) : null;
          const label = getComputedStyle(document.documentElement).getPropertyValue('--label').trim();
          const probe = document.createElement('span'); probe.style.color = 'var(--label)'; b.appendChild(probe); const labelRgb = getComputedStyle(probe).color; probe.remove();
          return { vis, font: cs ? cs.fontSize : null, color: cs ? cs.color : null, labelRgb, margin: cs ? cs.marginBottom : null, warnText: warnEl ? warnEl.textContent.trim() : null, note: note ? note.textContent.trim() : null, has: !!u, line: u && u.querySelector('.acct-usage-line') ? u.querySelector('.acct-usage-line').textContent.trim() : null,
            fill: fill ? fill.style.width : null, warn: !!(u && u.querySelector('.acct-usage-warn')), text: u ? u.textContent.replace(/\s+/g, ' ').trim() : null,
            descOf: [sel, btn].map((el) => { const id = el && el.getAttribute('aria-describedby'); const d = id && document.getElementById(id); return d ? d.textContent.trim() : null; }),
            agents: u && u.querySelector('.acct-agents-line') ? u.querySelector('.acct-agents-line').textContent.trim() : null,
            agentsEls: u && u.querySelector('.acct-agents-line') ? u.querySelector('.acct-agents-line').querySelectorAll('b').length : 0,
            options: sel ? [...sel.options].map((o) => o.textContent.trim()) : null, btnDisabled: btn ? btn.disabled : null,
            moveInside: mr ? mr.right <= br.right + 0.5 && mr.left >= br.left - 0.5 : null };
        };
        /* Contrast against the row's own card, in whichever theme this page is in (a dot or fill is a graphic: 3:1). */
        const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const ratio = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const cardBg = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return 'rgb(255, 255, 255)'; };
        const dotOf = (email) => { const w = box(email) && box(email).querySelector('.acct-usage-warn'); return w ? ratio(getComputedStyle(w, '::before').backgroundColor, cardBg(w)) : null; };
        const contrast = { warnDot: dotOf('busy@example.com'), highDot: dotOf('mixed@example.com'),
          moveText: (() => { const b = box('busy@example.com'); const btn = b && b.querySelector('[data-acct-move]'); return btn ? ratio(getComputedStyle(btn).color, getComputedStyle(btn).backgroundColor) : null; })() };
        const before = { busy: read('busy@example.com'), fresh: read('fresh@example.com'), calm: read('calm@example.com'), key: read('key@example.com'), old: read('old@example.com'), def: read('default@example.com'), guideonly: read('guideonly@example.com'), full: read('full@example.com'), sleepy: read('sleepy@example.com') };
        const msgOf = (d) => { const e = document.querySelector('[data-acct-move-msg="' + d + '"]'); return e ? e.textContent.trim() : null; };
        const runMove = async (email, toDir, expect, once) => {   // once: no forced second click (a move that ends at once would just start again)
          const b = box(email); const sel = b && b.querySelector('[data-acct-move-to]'); const btn = b && b.querySelector('[data-acct-move]');
          if (!sel || !btn) return null;
          const start = posts.length;
          sel.value = toDir; sel.dispatchEvent(new Event('change'));
          const enabled = !btn.disabled;
          btn.click();
          /* Mid-move, repaint the list (as a poll would) and force a click on the freshly drawn button: the move guard,
             not the disabled attribute, must stop a second move. */
          await new Promise((r) => setTimeout(r, 10));
          await paintAccounts();
          const again = box(email) && box(email).querySelector('[data-acct-move]');
          const againSel = box(email) && box(email).querySelector('[data-acct-move-to]');
          const drawnBusy = !!again && again.disabled && again.textContent.trim() === 'Moving…';
          const psMid = document.getElementById('set-accounts-msg');
          const quietMid = !!box(email) && !!psMid && !/Moving/.test(psMid.textContent) && (msgOf(box(email).getAttribute('data-acct-dir')) || '') === '';   // progress is on the button: never in the live region   // progress is on the button, not the live region
          if (again && !once) { if (againSel) { againSel.disabled = false; againSel.value = toDir; } again.disabled = false; again.click(); }
          for (let i = 0; i < 150 && posts.length - start < expect; i++) await new Promise((r) => setTimeout(r, 20));
          await new Promise((r) => setTimeout(r, 400));
          return { enabled, drawnBusy, quietMid, posts: posts.slice(start) };
        };
        /* A pick survives a poll's repaint: choose a target, repaint, and the menu still holds it with Move awake. */
        const pb = box('busy@example.com'), ps = pb && pb.querySelector('[data-acct-move-to]');
        if (ps) { ps.value = '/home/.claude-spare'; ps.dispatchEvent(new Event('change')); }
        await paintAccounts();
        const pb2 = box('busy@example.com');
        const pb2s = pb2 && pb2.querySelector('[data-acct-move-to]'), pb2b = pb2 && pb2.querySelector('[data-acct-move]');   // absent when the page drew no agents (e.g. it stopped asking ?agents=1)
        const pickKept = !!pb2s && !!pb2b && pb2s.value === '/home/.claude-spare' && !pb2b.disabled;
        const moved = await runMove('busy@example.com', '/home/.claude-spare', 2);
        if (moved) { moved.msg = msgOf('/home/.claude-busy');   // read AFTER the list repainted with the agents gone
          const ps = document.getElementById('set-accounts-msg'); moved.spoken = ps ? { text: ps.textContent.trim(), role: ps.getAttribute('role') } : null;   // the panel's persistent status line
          const ae = document.activeElement;   // before any further repaint; which element, not just which row
          moved.focus = !ae ? null : ae.id === 'set-accounts' ? 'list' : ae.hasAttribute('data-acct-move-msg') ? 'sentence:' + ae.getAttribute('data-acct-move-msg') : ae.hasAttribute('data-acct-move-to') ? 'menu:' + ae.getAttribute('data-acct-move-to') : ae.tagName;
          /* A repaint may clear the line (clearing is not spoken); speaking it again would write the sentence back. */
          const texts = []; const obs = new MutationObserver(() => { texts.push(ps.textContent.trim()); });
          if (ps) obs.observe(ps, { childList: true, characterData: true, subtree: true });
          await paintAccounts();   // a later repaint inside the two minutes: the sentence stays, but is not spoken again
          await new Promise((r) => setTimeout(r, 300)); obs.disconnect(); moved.respoken = texts.filter((t) => t && t === moved.msg).length;
          const again = document.querySelector('[data-acct-move-msg="/home/.claude-busy"]');
          moved.redrawn = again ? { text: again.textContent.trim(), role: again.getAttribute('role') } : null; }
        const busyAfter = read('busy@example.com');
        const mixed = await runMove('mixed@example.com', '/home/.claude-spare', 4);
        if (mixed) mixed.msg = msgOf('/home/.claude-mixed');
        const sleepyMove = await runMove('sleepy@example.com', '/home/.claude-spare', 1);
        if (sleepyMove) sleepyMove.msg = msgOf('/home/.claude-sleepy');
        /* An agent moved on its own page since the last paint must not be moved again: Move asks for the list afresh. */
        where.set('s-st2', '/home/.claude-spare');
        const staleMove = await runMove('stale@example.com', '/home/.claude-spare', 1);
        if (staleMove) staleMove.msg = msgOf('/home/.claude-stale');
        /* And when that fresh list cannot be had, nothing moves. */
        window.__failNextAccounts = true;
        const ncMove = await runMove('nocheck@example.com', '/home/.claude-spare', 0, true);
        if (ncMove) ncMove.msg = msgOf('/home/.claude-nocheck');
        /* The account picked went full since the menu was drawn: nothing moves, and the row says why. */
        window.__acctPatch = { '/home/.claude-gone': { weekly: { usedPct: 100, resetsAt: Date.now() + 50 * 3600e3, at: Date.now() } } };
        const tgMove = await runMove('tgt@example.com', '/home/.claude-gone', 0, true);
        if (tgMove) tgMove.msg = msgOf('/home/.claude-tgt');
        window.__acctPatch = null; await paintAccounts();
        /* The list cannot be read after the move: the result is still said, by the panel's status line. */
        window.__passAccounts = 1; window.__failAccounts = 2;
        const lostMove = await runMove('lost@example.com', '/home/.claude-spare', 1, true);
        await new Promise((r) => setTimeout(r, 300));
        if (lostMove) { const pl = document.getElementById('set-accounts-msg'); lostMove.spoken = pl ? pl.textContent.trim() : null; lostMove.left = window.__failAccounts; }
        window.__failAccounts = 0; await paintAccounts();
        /* The fresh list is incomplete and lost a drawn agent: gone and not-read look the same, so nothing moves. */
        where.delete('s-in'); window.__acctPatch = { '/home/.claude-inc': { agentsHere: { names: [], complete: false } } };
        const incMove = await runMove('inc@example.com', '/home/.claude-spare', 0, true);
        if (incMove) incMove.msg = msgOf('/home/.claude-inc');
        window.__acctPatch = null; where.set('s-in', '/home/.claude-inc'); await paintAccounts();
        const warmstop = read('warmstop@example.com'), frozen = read('frozen@example.com'), unknown = read('unknown@example.com'), fullmix = read('fullmix@example.com');
        const fullstop = read('fullstop@example.com'), weekout = read('weekout@example.com');
        const mine = read('mine@example.com'), unwired = read('unwired@example.com');
        const unsureNote = acctMoveNote([{ sessionName: 'a', state: 'working' }, { sessionName: 'b', state: 'unknown' }]);
        // Two minutes on, a repaint shows the row plain again.
        const st = ACCT_MOVE.get('/home/.claude-busy'); if (st) st.doneAt -= 3 * 60e3;
        await paintAccounts();
        const expired = msgOf('/home/.claude-busy');
        /* Sideways overflow of the page itself, with the list in its real place. */
        return { contrast, incMove, warmstop, frozen, unknown, fullmix, tgMove, lostMove, fullstop, weekout, weekoutDay: new Date(Date.now() + 162 * 3600e3).getDate(), staleMove, ncMove, sleepyMove, mine, unwired, unsureNote, pickKept, before, moved, busyAfter, mixed, expired, sideways: frame.scrollWidth - window.innerWidth };
      }, { accounts: ACCOUNTS, agents: AGENTS });
      /* #6175: the page stays open for the set-up step below; it is closed after it (and here, on an error). */
      if (r.error) { say(false, tag + ' ' + r.error); await page.close(); continue; }
      const { busy, fresh, calm, key, old, def, guideonly, full, sleepy } = r.before;
      say(!!busy && busy.has && busy.fill === '82%', tag + ' an 82% row draws its meter at 82%', JSON.stringify(busy && busy.fill));
      say(!!busy && busy.vis && busy.font === '13px' && busy.color === busy.labelRgb && busy.margin === '0px', tag + ' inside the real Settings panel the usage line keeps its own size, ink and spacing (the panel\'s paragraph rule does not win)', JSON.stringify(busy && { vis: busy.vis, font: busy.font, color: busy.color, label: busy.labelRgb, margin: busy.margin }));
      say(!!busy && /^82% of its weekly limit used · resets .+ · Kosmos last saw it change 2 hours ago$/.test(busy.line || ''), tag + ' the row says how much is used, when it resets and how old the reading is', JSON.stringify(busy && busy.line));
      say(!!busy && busy.warn && busy.warnText === 'Close to its weekly limit. Move its agents to another account before they stop.', tag + ' at 82% the row warns, and says what to do', JSON.stringify(busy && busy.warnText));
      say(!!busy && Array.isArray(busy.descOf) && busy.descOf.every((d) => d === 'Moving restarts both on the new account.'), tag + ' the menu and Move are described by the restart note, so a screen reader hears it before the click', JSON.stringify(busy && busy.descOf));
      say(!!busy && busy.note === 'Moving restarts both on the new account.', tag + ' the restart is said before the click, beside the control', JSON.stringify(busy && busy.note));
      say(!!guideonly && guideonly.warnText === 'Close to its weekly limit.' && guideonly.agents === 'Kosmos cannot see any agents on it on this computer.' && guideonly.options === null, tag + ' a guide-only row warns but never says to move agents it does not show', JSON.stringify(guideonly));
      say(!!sleepy && sleepy.note === 'Moving sets it up on the new account. It is not running now.', tag + ' a stopped agent is said to stay stopped, with no promise of when it starts', JSON.stringify(sleepy && sleepy.note));
      say(!!full && full.warnText === 'At its weekly limit. Move its agent to another account to get it working again.', tag + ' at 100% the row says it is at its limit', JSON.stringify(full && full.warnText));
      say(!!busy && busy.agents === 'Its agents on this computer: Dana, Eli', tag + ' it names its agents by display name, leaving out the setup guide', JSON.stringify(busy && busy.agents));
      say(!!busy && Array.isArray(busy.options) && busy.options.some((o) => o === 'spare@example.com (20% used)') && !busy.options.some((o) => o.startsWith('busy@')), tag + ' Move offers the other account with its own reading, never itself', JSON.stringify(busy && busy.options));
      say(!!busy && Array.isArray(busy.options) && !busy.options.some((o) => o.startsWith('nearfull@')), tag + ' an account its own row calls full (99.6% shows as 100%) is not offered either', JSON.stringify(busy && busy.options));
      say(!!busy && Array.isArray(busy.options) && !busy.options.some((o) => o.startsWith('key@')), tag + ' an API-key account is not a bulk target (that would change who pays)', JSON.stringify(busy && busy.options));
      say(!!busy && Array.isArray(busy.options) && !busy.options.some((o) => o.startsWith('full@')), tag + ' a full account (100%) is not offered: it cannot run them either', JSON.stringify(busy && busy.options));
      say(!!busy && Array.isArray(busy.options) && !busy.options.some((o) => o.startsWith('noshare@')), tag + ' an account without shared history is not offered (a move there always fails)', JSON.stringify(busy && busy.options));
      say(!!def && def.line === 'No usage reading for this account yet. Kosmos reads it while an agent on it is working.', tag + ' the default account (wired by the installer) waits for a reading, never "cannot"', JSON.stringify(def && def.line));
      say(!!r.mine && r.mine.line === 'Kosmos cannot read usage for this account. It is set up its own way, and Kosmos leaves that alone.', tag + ' "cannot read" appears only when the server knows why', JSON.stringify(r.mine && r.mine.line));
      say(!!r.unwired && r.unwired.line === 'Kosmos is not set up to read usage for this account.', tag + ' an account with no status line is not promised a reading', JSON.stringify(r.unwired && r.unwired.line));
      say(r.unsureNote === 'Moving restarts the running ones on the new account.', tag + ' an agent of unknown state gets no restart count it may not keep', JSON.stringify(r.unsureNote));
      say(!!r.sleepyMove && r.sleepyMove.msg === 'Moved Zed (stopped). It is not running now.', tag + ' moving a stopped agent reads as moved, still stopped, through the route\'s real reply', JSON.stringify(r.sleepyMove));
      say(!!busy && busy.btnDisabled === true, tag + ' Move is disabled until a target is picked');
      say(r.pickKept === true, tag + ' a picked target survives a repaint, with Move awake');
      say(!!r.moved && r.moved.enabled && r.moved.posts.length === 2 && r.moved.posts.every((p) => p.dir === '/home/.claude-spare') && r.moved.posts.map((p) => p.agent).sort().join() === 's-dana,s-eli', tag + ' Move sends one move per agent to the picked account, once (a forced click on the repainted button adds nothing), never the guide', JSON.stringify(r.moved));
      say(!!r.moved && !!r.moved.spoken && r.moved.spoken.role === 'status' && r.moved.spoken.text === 'Moved 2 agents. They restart on the new account.', tag + ' the result is spoken by the panel\'s persistent status line, not a region the repaint replaced', JSON.stringify(r.moved && r.moved.spoken));
      say(!!r.moved && r.moved.drawnBusy, tag + ' a repaint mid-move draws the button busy ("Moving…", disabled)', JSON.stringify(r.moved));
      say(!!r.moved && r.moved.quietMid, tag + ' mid-move the live region is silent (a screen reader hears the result once)', JSON.stringify(r.moved));
      say(!!r.moved && r.moved.msg === 'Moved 2 agents. They restart on the new account.', tag + ' and says how many moved and that they restart, still there after the list repaints with the agents gone', JSON.stringify(r.moved && r.moved.msg));
      say(!!r.moved && r.moved.focus === 'list', tag + ' after the move, focus lands on the list (the pressed button is gone), not the sentence the status line already speaks', JSON.stringify(r.moved && r.moved.focus));
      say(!!r.moved && !!r.moved.redrawn && r.moved.redrawn.text === 'Moved 2 agents. They restart on the new account.' && r.moved.respoken === 0, tag + ' a later repaint keeps the sentence but does not announce it again (the panel line is not written with it again)', JSON.stringify(r.moved && { redrawn: r.moved.redrawn, respoken: r.moved.respoken }));
      say(r.expired === '', tag + ' two minutes on, a repaint shows the row plain again', JSON.stringify(r.expired));
      say(!!r.busyAfter && r.busyAfter.agents === 'Kosmos cannot see any agents on it on this computer.', tag + ' after the move the busy row has no agents left (the repaint happened)', JSON.stringify(r.busyAfter && r.busyAfter.agents));
      say(!!r.staleMove && r.staleMove.posts.length === 1 && r.staleMove.posts[0].agent === 's-st1' && /^Moved 1 agent\b/.test(r.staleMove.msg || ''), tag + ' an agent moved elsewhere since the list was drawn is not moved again (Move reads the list afresh)', JSON.stringify(r.staleMove));
      say(!!r.ncMove && r.ncMove.posts.length === 0 && r.ncMove.msg === 'Nothing moved: Kosmos could not check which agents are on this account. Try again in a moment.', tag + ' when the fresh list cannot be read, nothing moves and the row says so', JSON.stringify(r.ncMove));
      say(!!r.tgMove && r.tgMove.posts.length === 0 && r.tgMove.msg === 'Nothing moved: gone@example.com cannot take it now. Pick another account.', tag + ' an account that went full since the menu was drawn takes nothing (Move checks the target afresh)', JSON.stringify(r.tgMove));
      say(!!r.lostMove && r.lostMove.posts.length === 1 && r.lostMove.left === 0 && /^Moved 1 agent\b/.test(r.lostMove.spoken || ''), tag + ' when the list cannot be read after a move, the result is still said', JSON.stringify(r.lostMove));
      say(!!r.incMove && r.incMove.posts.length === 0 && r.incMove.msg === 'Nothing moved: Kosmos could not check which agents are on this account. Try again in a moment.', tag + ' an incomplete fresh list that lost an agent moves nothing, and says it could not check (not that they left)', JSON.stringify(r.incMove));
      say(!!r.warmstop && r.warmstop.warnText === 'Close to its weekly limit. Move its agent to another account.', tag + ' close to the limit with only a stopped agent, no "before it stops"', JSON.stringify(r.warmstop && r.warmstop.warnText));
      say(!!r.frozen && r.frozen.fill === '30%' && /This is the last reading Kosmos saw\. It will not update, because this account is set up its own way\./.test(r.frozen.text || '') && !/cannot read usage/.test(r.frozen.text || ''), tag + ' an old reading Kosmos can no longer update says so under the meter', JSON.stringify(r.frozen && r.frozen.text));
      say(!!r.unknown && r.unknown.agents === 'Kosmos could not check which agents are on it.', tag + ' an agent list that could not be read is never called empty', JSON.stringify(r.unknown && r.unknown.agents));
      say(!!r.fullmix && r.fullmix.warnText === 'At its weekly limit. Move its agents to another account.', tag + ' at its limit with a stopped agent among them, no promise that a move gets them working', JSON.stringify(r.fullmix && r.fullmix.warnText));
      say(!!r.fullstop && r.fullstop.warnText === 'At its weekly limit. Move its agent to another account.', tag + ' at its limit with only a stopped agent, no promise that a move gets it working', JSON.stringify(r.fullstop && r.fullstop.warnText));
      say(!!r.weekout && new RegExp('resets [^·]*\\b' + r.weekoutDay + '\\b').test(r.weekout.line || ''), tag + ' a reset a week out names its date, not only a weekday that reads as today', JSON.stringify(r.weekout && r.weekout.line));
      say(!!r.mixed && r.mixed.posts.length === 4, tag + ' a mixed move sends one move per agent', JSON.stringify(r.mixed && r.mixed.posts));
      say(!!r.mixed && r.mixed.msg === "Not restarted yet (Pia): We saved spare@example.com, but could not start it again: the session is busy. It is still on the old account until it restarts. Not moved (Rex, Rio): That account does not share this computer's memory. No answer yet for Sol. Check its account in a moment.",
        tag + ' saved-but-restarting keeps the engine\'s reason, one refusal is said once, and an unanswered move is not called a failure', JSON.stringify(r.mixed && r.mixed.msg));
      say(!!fresh && fresh.line === 'No usage reading for this account yet. Kosmos reads it while an agent on it is working.' && !fresh.warn, tag + ' a row with no reading says so, and when it will have one, and does not warn', JSON.stringify(fresh));
      say(!!fresh && fresh.agents === 'Its agents on this computer: x<b>y' && fresh.agentsEls === 0, tag + ' an agent name with markup is shown as text', JSON.stringify(fresh && fresh.agents));
      say(!!calm && calm.fill === '40%' && !calm.warn, tag + ' a 40% row does not warn', JSON.stringify(calm));
      say(!!key && key.has && key.fill === null && key.line === null, tag + ' an API-key row draws no meter', JSON.stringify(key));
      say(!!old && !old.has, tag + ' an older board\'s row draws no usage block', JSON.stringify(old));
      say(!!busy && busy.vis && busy.moveInside === true, tag + ' the move control fits inside its (visible, measured) row', JSON.stringify(busy && { vis: busy.vis, inside: busy.moveInside }));
      say(r.sideways <= 0, tag + ' the page does not scroll sideways', String(r.sideways));
      say(r.contrast.warnDot >= 3 && r.contrast.highDot >= 3, tag + ' the warning dots stand out from the card (3:1 or more) in this theme', JSON.stringify(r.contrast));
      say(r.contrast.moveText >= 4.5, tag + ' Move\'s label is readable on its button in this theme (4.5:1 or more)', JSON.stringify(r.contrast));
      /* #6175: a "not set up" row offers to set the reading up; an own-status-line row does not. A refusal is said on the
         row (a second replaces the first), and a success repaints the row without the offer. The route is stubbed like
         the engine: refused twice, then wired (the next list no longer says not-wired). */
      const s6175 = await page.evaluate(async () => {
        const row = (n) => document.querySelector('#set-accounts .acct-box[data-acct-dir="/home/.claude-' + n + '"]');
        const btnOf = (n) => row(n) && row(n).querySelector('[data-usage-setup]');
        const out = { offer: !!btnOf('unwired'), offerText: btnOf('unwired') ? btnOf('unwired').textContent.trim() : null,
          explain: row('unwired') ? row('unwired').textContent.replace(/\s+/g, ' ') : '', ownOffer: !!btnOf('mine'), posts: [],
          linked: { offer: !!btnOf('linkedset'), text: row('linkedset') ? row('linkedset').textContent.replace(/\s+/g, ' ') : '' } };
        /* a row that still shows an old reading is offered it too, with the same explainer */
        const sb = btnOf('stalewired'), sd = sb && document.getElementById(sb.getAttribute('aria-describedby') || '');
        out.stale = { offer: !!sb, describedBy: sd ? sd.textContent : null, stillShows: (() => { const i = row('stalewired') && row('stalewired').querySelector('.acct-usage-meter .bar i'); return !!i && i.style.width === '30%'; })() };
        let refuse = 2; let staleN = 0; let listDown = false;
        const posts1 = () => out.posts.length;
        const prior = window.fetch;
        window.fetch = (u, opts) => {
          if (String(u).indexOf('/api/accounts/claude/usage-reading') !== -1) {
            const dir = JSON.parse(opts.body).dir;
            /* Review 10: the stale row answers wired first (its row is left not-wired, so the offer stays), then refused. */
            if (dir === '/home/.claude-stalewired') {
              staleN++;
              if (staleN === 1 || staleN === 3) return Promise.resolve({ ok: true, status: 200, json: async () => ({ wired: true, changed: true }) });
              return Promise.resolve({ ok: false, status: 409, json: async () => ({ wired: false, because: 'the settings file could not be read' }) });
            }
            out.posts.push(dir);
            /* Review 5: the button loses focus during the refusal (some engines keep it on a disabled button), so the arm
               below fails unless the handler gives it back. */
            if (refuse > 0) { refuse--; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return Promise.resolve({ ok: false, status: 409, json: async () => ({ wired: false, because: 'this account already has its own status line, so it was left alone' }) }); }
            (window.__acctPatch = window.__acctPatch || {})[dir] = { weeklyBlocked: null };
            return Promise.resolve({ ok: true, status: 200, json: async () => ({ wired: true, changed: true }) });
          }
          if (listDown && String(u).indexOf('/api/accounts') !== -1) return Promise.reject(new TypeError('the list is down (stub)'));   // review 13
          return prior(u, opts);
        };
        /* Waits on the state each step reads (review 1), never a fixed sleep: a refusal is done when the button is enabled
           again with its label back; the success when the offer is gone. */
        const until = async (cond) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 25)); return cond(); };
        const idle = () => btnOf('unwired') && !btnOf('unwired').disabled && btnOf('unwired').textContent === 'Set up usage reading';
        if (!btnOf('unwired')) { window.fetch = prior; return out; }   // review 4: no offer is a FAIL line below, not a thrown evaluate
        const b0 = btnOf('unwired'); const why0 = b0 && document.getElementById(b0.getAttribute('aria-describedby') || '');
        out.describedBy = why0 ? why0.textContent.trim() : null;
        btnOf('unwired').focus(); btnOf('unwired').click(); await until(() => posts1() >= 1 && idle());   // review 4: from the button, as a keyboard user
        out.refocus = document.activeElement === btnOf('unwired');
        out.say1 = [...row('unwired').querySelectorAll('[data-usage-say]')].map((e) => e.textContent);
        await until(() => document.getElementById('set-accounts-msg').textContent === (out.say1[0] || '\u0000'));   // review 9: written a frame later
        out.msg1 = document.getElementById('set-accounts-msg').textContent;
        /* Review 9: the same refusal again must change the status line (emptied, then written), or a screen reader stays silent. */
        const seen = []; const mo = new MutationObserver(() => seen.push(document.getElementById('set-accounts-msg').textContent));
        mo.observe(document.getElementById('set-accounts-msg'), { childList: true, characterData: true, subtree: true });
        btnOf('unwired').click(); await until(() => posts1() >= 2 && idle());
        await until(() => seen.length >= 2 && seen[seen.length - 1] === out.msg1); mo.disconnect();
        out.reSaid = seen.indexOf('') >= 0 && seen[seen.length - 1] === out.msg1;
        out.rowFocusable = row('unwired') ? row('unwired').getAttribute('tabindex') === '-1' : false;
        out.say2 = [...row('unwired').querySelectorAll('[data-usage-say]')].map((e) => e.textContent);
        btnOf('unwired').focus(); btnOf('unwired').click(); await until(() => !btnOf('unwired') && /Usage reading set up/.test(document.getElementById('set-accounts-msg').textContent));
        out.after = { offer: !!btnOf('unwired'), line: row('unwired') && row('unwired').querySelector('.acct-usage-line') ? row('unwired').querySelector('.acct-usage-line').textContent.trim() : null,
          msg: document.getElementById('set-accounts-msg').textContent, focusIsRow: document.activeElement === row('unwired'),
          ring: (() => {   // the row focused from code draws no ring (as .dsec). A weaker ring rule stands in for the engine's
            const st = document.createElement('style'); st.textContent = '.acct-box:focus { outline: 2px solid red; }';   // own, which headless may not draw
            document.head.appendChild(st); const o = getComputedStyle(document.activeElement).outlineStyle; st.remove(); return o;
          })() };
        /* Review 4: another writer's sentence and a focus the person moved both stand during the re-claim second. */
        const sentinel = document.createElement('input'); document.body.appendChild(sentinel); sentinel.focus();
        document.getElementById('set-accounts-msg').textContent = 'Moved Dana to spare@example.com.';
        await new Promise((r) => setTimeout(r, 400));
        out.foreign = { msg: document.getElementById('set-accounts-msg').textContent, focusKept: document.activeElement === sentinel };
        sentinel.remove();
        /* Review 10: a refusal pressed during an earlier success's re-claim second is what the status line says, not the
           older "set up" sentence. */
        await new Promise((r) => setTimeout(r, 1100));   // the unwired press's re-claim second is over
        const sb2 = () => btnOf('stalewired');
        if (sb2()) {
          sb2().click(); await until(() => staleN >= 1 && document.getElementById('set-accounts-msg').textContent.indexOf('Usage reading set up') === 0 && sb2() && !sb2().disabled);
          sb2().click(); await until(() => staleN >= 2 && sb2() && !sb2().disabled);
          await new Promise((r) => setTimeout(r, 400));
          out.newerRefusal = { n: staleN, msg: document.getElementById('set-accounts-msg').textContent };
          /* Review 13: wired, but the list cannot be read after: the error stands alone, never "set up" beside it. */
          await new Promise((r) => setTimeout(r, 300));   // the refusal's deferred write has landed
          listDown = true;
          sb2().click();
          await until(() => staleN >= 3 && /We could not read the accounts on this computer/.test(document.getElementById('set-accounts').textContent));
          await new Promise((r) => setTimeout(r, 400));
          out.listDown = { n: staleN, listError: /We could not read the accounts on this computer/.test(document.getElementById('set-accounts').textContent), msg: document.getElementById('set-accounts-msg').textContent };
          listDown = false;
        }
        window.fetch = prior;
        return out;
      });
      say(s6175.offer && s6175.offerText === 'Set up usage reading' && /adds Kosmos\u2019s status line to this account\u2019s Claude Code/.test(s6175.explain), tag + ' #6175 a not-set-up row offers to set the reading up, and says what it adds', JSON.stringify({ offer: s6175.offer, text: s6175.offerText }));
      say(/adds Kosmos\u2019s status line/.test(s6175.describedBy || ''), tag + ' #6175 the button is described by the line that says what it adds', JSON.stringify(s6175.describedBy));
      say(s6175.msg1 === s6175.say1[0], tag + ' #6175 a refusal is also said in the panel\'s status line (heard by a screen reader)', JSON.stringify(s6175.msg1));
      say(s6175.after.focusIsRow && s6175.after.msg === 'Usage reading set up. Kosmos reads it once an agent on this account is working.', tag + ' #6175 a success is said in the status line and focus lands on the row', JSON.stringify({ focus: s6175.after.focusIsRow, msg: s6175.after.msg }));
      say(!!s6175.newerRefusal && s6175.newerRefusal.n === 2 && s6175.newerRefusal.msg === 'Not set up: the settings file could not be read.', tag + ' #6175 a refusal pressed during an earlier success\'s re-claim second stands in the status line', JSON.stringify(s6175.newerRefusal));
      say(!!s6175.listDown && s6175.listDown.n === 3 && s6175.listDown.listError && !/Usage reading set up/.test(s6175.listDown.msg), tag + ' #6175 a set-up whose list cannot be read after does not say "set up" beside the error', JSON.stringify(s6175.listDown));
      say(s6175.reSaid === true, tag + ' #6175 the same refusal twice is emptied and said again, so a screen reader hears it again', String(s6175.reSaid));
      say(s6175.rowFocusable === true, tag + ' #6175 the row itself takes focus, so a repaint can hand focus back to it', String(s6175.rowFocusable));
      say(s6175.after.ring === 'none', tag + ' #6175 the row focused from code after a press draws no focus ring', JSON.stringify(s6175.after.ring));
      say(s6175.refocus === true, tag + ' #6175 after a refusal, focus is back on the button for a keyboard user', String(s6175.refocus));
      say(!!s6175.foreign && s6175.foreign.msg === 'Moved Dana to spare@example.com.' && s6175.foreign.focusKept, tag + ' #6175 the re-claim leaves another writer\'s sentence and a focus the person moved alone', JSON.stringify(s6175.foreign));
      say(s6175.stale.offer && /adds Kosmos\u2019s status line/.test(s6175.stale.describedBy || '') && s6175.stale.stillShows, tag + ' #6175 a row still showing an old reading is offered it too, described by its explainer', JSON.stringify(s6175.stale));
      say(!s6175.linked.offer && /Its settings file is a link to a file elsewhere, and Kosmos leaves that alone\./.test(s6175.linked.text), tag + ' #6175 a row whose settings file is a link elsewhere says so and is not offered a set-up that is always refused', JSON.stringify(s6175.linked));
      say(!s6175.ownOffer, tag + ' #6175 a row with the person\'s own status line is not offered it (control)', String(s6175.ownOffer));
      say(s6175.say1.length === 1 && s6175.say1[0] === 'Not set up: this account already has its own status line, so it was left alone.', tag + ' #6175 a refusal is said on the row', JSON.stringify(s6175.say1));
      say(s6175.say2.length === 1, tag + ' #6175 a second refusal replaces the first', JSON.stringify(s6175.say2));
      say(s6175.posts.length === 3 && s6175.posts.every((d) => d === '/home/.claude-unwired') && !s6175.after.offer && s6175.after.line === 'No usage reading for this account yet. Kosmos reads it while an agent on it is working.', tag + ' #6175 once set up, the row repaints without the offer and says a reading comes', JSON.stringify(s6175.after));
      say(errs.length === 0, tag + ' no page errors', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  console.log(fails.length ? 'FAILED' : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
