'use strict';

/**
 * kosmos#7152 slice 2: Settings > AI Models says what usage auto-balance WOULD move, and has its switch.
 *
 * Drives the real paintAccounts() against a stubbed /api/accounts (no board), in Chromium and WebKit, at desktop and
 * phone width, inside the real Settings panel. The claims, each able to fail:
 *  - with one Claude subscription account the row is hidden and its switch carries no on or off (a control: shown
 *    with two);
 *  - a would-move line names the agent by its board name, both accounts as the list names them, and why; a name
 *    with markup in it is shown as text;
 *  - an account with nothing able to take its agents says so; nothing to move says "Nothing to move right now.";
 *  - switched off: the switch reads off and no line is drawn; an unreadable decision says so;
 *  - pressing the switch sends { on: false } once and draws the next read's answer;
 *  - at 390 px nothing scrolls sideways.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-autobalance-7152.js
 *
 * HEADED by default; HEADED=0 on a machine with no console session.
 */

const nodePath = require('node:path');
let pw;
try { pw = require('playwright'); }
catch { console.log('render-autobalance-7152: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const H = 3600e3, now = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
const conn = { state: 'connected', badge: 'working', checkedLive: true, because: 'a real request succeeded', observedAt: now - 9000, observedAgeMs: 9000 };
const claude = (id, extra) => ({ provider: 'anthropic', providerName: 'Anthropic / Claude', email: id + '@example.com', label: id + '@example.com', dir: '/home/.claude-' + id,
  organization: null, isDefault: false, keyTail: null, name: null, memoryShared: true, connection: conn, bulkTargetable: true,
  agentsHere: { names: [], complete: true }, weekly: { usedPct: 20, resetsAt: now + 50 * H, at: now - H }, fiveHour: null, ...extra });
const TWO = [claude('full', { name: 'Work', weekly: { usedPct: 93, resetsAt: now + 35 * H, at: now - H }, agentsHere: { names: ['s-a', 's-x'], complete: true } }), claude('spare', { name: 'Spare' })];
const AGENTS = [{ sessionName: 's-a', name: 'Ada', state: 'idle' }, { sessionName: 's-x', name: '<b>Bo</b>', state: 'idle' }];
const WHY = 'it is at 93% of its weekly limit, which resets in 35 h';
const CASES = {
  one: { accounts: [TWO[0]], autobalance: { on: true, eligible: 1, moves: [], held: [] } },
  moves: { accounts: TWO, autobalance: { on: true, eligible: 2, held: [], moves: [
    { agent: 's-a', from: '/home/.claude-full', to: '/home/.claude-spare', why: WHY },
    { agent: 's-x', from: '/home/.claude-full', to: '/home/.claude-spare', why: WHY }] } },
  held: { accounts: TWO, autobalance: { on: true, eligible: 2, moves: [], held: [{ from: '/home/.claude-full', why: WHY }] } },
  none: { accounts: TWO, autobalance: { on: true, eligible: 2, moves: [], held: [] } },
  off: { accounts: TWO, autobalance: { on: false, eligible: 2, moves: [], held: [] } },
  bad: { accounts: TWO, autobalance: { on: null, eligible: 0, moves: [], held: [], unreadable: true } },
  badtwo: { accounts: TWO, autobalance: { on: true, eligible: 2, moves: [], held: [], unreadable: true } },
};

const fails = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fails.push(label); };

(async () => {
  for (const engine of ['chromium', 'webkit']) {
    let browser;
    try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
    catch (err) { say(false, '[' + engine + '] could not start a browser', err && err.message ? err.message.split('\n')[0] : String(err)); continue; }
    for (const [w, h] of [[1100, 900], [390, 844]]) {
      const tag = '[' + engine + ' ' + w + ']';
      const page = await browser.newPage({ viewport: { width: w, height: h }, locale: 'en-US' });
      await page.clock.setFixedTime(new Date(now));
      const errs = []; page.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) errs.push(e.message); });
      await page.goto('file://' + PAGE);
      const r = await page.evaluate(async ({ cases, agents }) => {
        if (typeof paintAccounts !== 'function') return { error: 'paintAccounts is not a function' };
        LAST = agents;
        const realFetch = window.fetch;
        let current = null;
        const puts = [];
        window.fetch = (u, opts) => {
          const url = String(u);
          if (url.indexOf('/api/accounts') !== -1) return Promise.resolve({ ok: true, json: async () => current });
          if (url.indexOf('/api/autobalance-setting') !== -1) {
            puts.push(opts && opts.body);
            current = { ...current, autobalance: { ...current.autobalance, on: false } };
            return Promise.resolve({ ok: true, json: async () => ({ on: false, ok: true }) });
          }
          return realFetch(u, opts);
        };
        const list0 = document.getElementById('set-accounts');
        for (let el = list0; el && el !== document.body; el = el.parentElement) {
          if (el.hidden) el.hidden = false;
          if (getComputedStyle(el).display === 'none') el.style.display = 'block';
        }
        const panel = list0.closest('.panel');
        for (const other of document.querySelectorAll('.panel')) if (other !== panel && !other.contains(panel)) other.style.display = 'none';
        const look = () => {
          const row = document.getElementById('ab-row');
          const tog = document.getElementById('ab-toggle');
          return {
            shown: !!row && !row.hidden && row.getBoundingClientRect().height > 0,
            checked: tog && tog.hasAttribute('aria-checked') ? tog.getAttribute('aria-checked') : null,
            togHidden: !!tog && tog.hidden,
            lines: [...document.querySelectorAll('#ab-lines p')].map((p) => p.textContent.trim()),
            markup: !!document.querySelector('#ab-lines b'),
            sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
          };
        };
        const out = {};
        for (const [k, c] of Object.entries(cases)) { current = c; await paintAccounts(); out[k] = look(); }
        current = cases.moves;
        await paintAccounts();
        document.getElementById('ab-toggle').click();
        for (let i = 0; i < 50 && look().checked !== 'false'; i += 1) await new Promise((res) => setTimeout(res, 20));
        await new Promise((res) => setTimeout(res, 100));
        out.pressed = { ...look(), puts };
        return out;
      }, { cases: CASES, agents: AGENTS });
      if (r.error) { say(false, tag + ' ' + r.error); await page.close(); continue; }
      say(r.one && !r.one.shown && r.one.checked === null && r.one.togHidden, tag + ' one subscription account: the row is hidden, its switch neither on nor off', JSON.stringify(r.one));
      say(r.moves && r.moves.shown && r.moves.checked === 'true', tag + ' CONTROL: two accounts, the row shows and the switch reads on', JSON.stringify(r.moves && { shown: r.moves.shown, checked: r.moves.checked }));
      say(r.moves && r.moves.lines.length === 2 && r.moves.lines[0] === 'Would move Ada from Work to Spare, because ' + WHY + '.', tag + ' a would-move line names the agent, both accounts and why', JSON.stringify(r.moves && r.moves.lines));
      say(r.moves && r.moves.lines[1] === 'Would move <b>Bo</b> from Work to Spare, because ' + WHY + '.' && !r.moves.markup, tag + ' a name with markup in it is shown as text', JSON.stringify(r.moves && r.moves.lines[1]));
      say(r.held && r.held.lines.length === 1 && /^Would move the idle agents off Work, because it is at 93%.*but no account has room: none Kosmos has measured is under 70%\.$/.test(r.held.lines[0]), tag + ' nothing able to take them says so', JSON.stringify(r.held && r.held.lines));
      say(r.none && r.none.lines.length === 1 && r.none.lines[0] === 'Nothing to move right now.', tag + ' nothing to move says so', JSON.stringify(r.none && r.none.lines));
      say(r.off && r.off.shown && r.off.checked === 'false' && r.off.lines.length === 0, tag + ' switched off: it reads off and draws no line', JSON.stringify(r.off));
      say(r.bad && !r.bad.shown, tag + ' an unreadable decision with no count hides the row', JSON.stringify(r.bad));
      say(r.badtwo && r.badtwo.shown && r.badtwo.lines[0] === 'Kosmos could not work out what it would move just now.', tag + ' an unreadable decision says so', JSON.stringify(r.badtwo && r.badtwo.lines));
      say(r.pressed && r.pressed.puts.length === 1 && r.pressed.puts[0] === '{"on":false}' && r.pressed.checked === 'false' && r.pressed.lines.length === 0,
        tag + ' pressing the switch sends off once and draws the next read', JSON.stringify(r.pressed));
      say(Object.values(r).every((x) => !x || x.sideways === false), tag + ' nothing scrolls sideways', '');
      say(errs.length === 0, tag + ' no page errors', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  if (fails.length) { console.log('render-autobalance-7152: ' + fails.length + ' FAILED'); process.exit(1); }
  console.log('render-autobalance-7152: all passed');
})();
