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
 *  - an account with nothing able to take its agents says so; one whose agent list may be short says so; nothing to
 *    move says "Nothing to move right now.";
 *  - switched off: the switch reads off and no line is drawn; an unreadable decision says so;
 *  - pressing the switch sends { on: false } once and draws the next read's answer; a failed read takes earlier lines away;
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
  none: { accounts: TWO, autobalance: { on: true, eligible: 2, moves: [], held: [], short: [] } },
  short: { accounts: TWO, autobalance: { on: true, eligible: 2, moves: [], held: [], short: ['/home/.claude-full'] } },
  off: { accounts: TWO, autobalance: { on: false, eligible: 2, moves: [], held: [] } },
  /* The two shapes the route sends when the decision fails (review 1): the switch and the count are read first. */
  bad: { accounts: [TWO[0]], autobalance: { on: true, eligible: 1, moves: [], held: [], short: [], unreadable: true } },
  badtwo: { accounts: TWO, autobalance: { on: true, eligible: 2, moves: [], held: [], short: [], unreadable: true } },
  /* The shape the route sends for a setting file it could not read (review 5): off on the engine, ok false. */
  unset: { accounts: TWO, autobalance: { on: false, ok: false, eligible: 2, moves: [], held: [], short: [], atRisk: [] } },
  shortrisk: { accounts: TWO, autobalance: { on: true, ok: true, eligible: 2, moves: [], held: [], short: ['/home/.claude-full'], atRisk: [{ from: '/home/.claude-full', why: WHY }] } },
  busy: { accounts: TWO, autobalance: { on: true, eligible: 2, moves: [], held: [], short: [], atRisk: [{ from: '/home/.claude-full', why: WHY }] } },
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
        let reads = 0;
        window.fetch = (u, opts) => {
          const url = String(u);
          if (url.indexOf('/api/accounts') !== -1) reads += 1;
          if (url.indexOf('/api/accounts') !== -1) return current === 'fail' ? Promise.resolve({ ok: false, status: 503, json: async () => ({}) }) : Promise.resolve({ ok: true, json: async () => current });
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
        /* Review 2: a failed read after a good one takes the earlier lines away with the list. */
        current = cases.moves; await paintAccounts();
        out.beforeFail = look();
        current = 'fail'; await paintAccounts();
        out.failed = look();
        /* Review 3: pressing the switch while a list read is out starts no second read over it (the page's own flag
           stands in for the read), clears the lines at once, and reads once that read is over. */
        current = cases.moves; await paintAccounts();
        acctReadOpen = 999999;
        const before = reads;
        document.getElementById('ab-toggle').click();
        for (let i = 0; i < 50 && look().checked !== 'false'; i += 1) await new Promise((res) => setTimeout(res, 20));
        await new Promise((res) => setTimeout(res, 700));
        out.overRead = { ...look(), extra: reads - before };
        acctReadOpen = 0;
        await new Promise((res) => setTimeout(res, 900));
        out.afterRead = { extra: reads - before };
        /* Review 4: a wait whose list goes off screen (Settings closed) starts no read; twice pressed, one wait. */
        current = { ...cases.moves, autobalance: { ...cases.moves.autobalance, on: true } };
        await paintAccounts();
        acctReadOpen = 999999;
        const hid = reads;
        document.getElementById('ab-toggle').click();
        await new Promise((res) => setTimeout(res, 300));
        const shownBox = document.getElementById('set-accounts');
        const keep = shownBox.style.display;
        shownBox.style.display = 'none';
        acctReadOpen = 0;
        await new Promise((res) => setTimeout(res, 900));
        out.hidden = { extra: reads - hid };
        shownBox.style.display = keep;
        current = { ...cases.moves, autobalance: { ...cases.moves.autobalance, on: true } };
        await paintAccounts();
        acctReadOpen = 999999;
        const twice = reads;
        document.getElementById('ab-toggle').click();
        await new Promise((res) => setTimeout(res, 300));
        current = { ...cases.moves, autobalance: { ...cases.moves.autobalance, on: false } };
        await paintAccounts();   // a repaint while waiting (counts as one read)
        acctReadOpen = 999999;
        document.getElementById('ab-toggle').click();
        await new Promise((res) => setTimeout(res, 300));
        acctReadOpen = 0;
        await new Promise((res) => setTimeout(res, 1200));
        out.twice = { extra: reads - twice };
        current = { ...cases.moves, autobalance: { ...cases.moves.autobalance, on: true } };
        await paintAccounts();
        const putsBefore = puts.length;
        document.getElementById('ab-toggle').click();
        for (let i = 0; i < 50 && look().checked !== 'false'; i += 1) await new Promise((res) => setTimeout(res, 20));
        await new Promise((res) => setTimeout(res, 100));
        out.pressed = { ...look(), puts: puts.slice(putsBefore) };   // review 5: this press's own PUTs, so a double is seen
        return out;
      }, { cases: CASES, agents: AGENTS });
      if (r.error) { say(false, tag + ' ' + r.error); await page.close(); continue; }
      say(r.one && !r.one.shown && r.one.checked === null && r.one.togHidden, tag + ' one subscription account: the row is hidden, its switch neither on nor off', JSON.stringify(r.one));
      say(r.moves && r.moves.shown && r.moves.checked === 'true', tag + ' CONTROL: two accounts, the row shows and the switch reads on', JSON.stringify(r.moves && { shown: r.moves.shown, checked: r.moves.checked }));
      say(r.moves && r.moves.lines.length === 2 && r.moves.lines[0] === 'Would move Ada from Work to Spare, because ' + WHY + '.', tag + ' a would-move line names the agent, both accounts and why', JSON.stringify(r.moves && r.moves.lines));
      say(r.moves && r.moves.lines[1] === 'Would move <b>Bo</b> from Work to Spare, because ' + WHY + '.' && !r.moves.markup, tag + ' a name with markup in it is shown as text', JSON.stringify(r.moves && r.moves.lines[1]));
      say(r.held && r.held.lines.length === 1 && /^Would move the idle agents off Work, because it is at 93%.*, but no other account can take them right now\.$/.test(r.held.lines[0]), tag + ' nothing able to take them says so', JSON.stringify(r.held && r.held.lines));
      say(r.short && r.short.lines.length === 1 && r.short.lines[0] === 'Kosmos could not read every agent on Work, so there may be more to move.', tag + ' a list that may be short says so, not "nothing to move"', JSON.stringify(r.short && r.short.lines));
      say(r.none && r.none.lines.length === 1 && r.none.lines[0] === 'Nothing to move right now.', tag + ' nothing to move says so', JSON.stringify(r.none && r.none.lines));
      say(r.off && r.off.shown && r.off.checked === 'false' && r.off.lines.length === 0, tag + ' switched off: it reads off and draws no line', JSON.stringify(r.off));
      say(r.bad && !r.bad.shown, tag + ' a failed decision with one account still hides the row', JSON.stringify(r.bad));
      say(r.badtwo && r.badtwo.shown && r.badtwo.lines[0] === 'Kosmos could not work out what it would move just now.', tag + ' an unreadable decision says so', JSON.stringify(r.badtwo && r.badtwo.lines));
      say(r.unset && r.unset.shown && r.unset.checked === null && r.unset.togHidden && r.unset.lines[0] === 'We could not read this setting just now.', tag + ' a setting file that could not be read shows unknown, not a confident Off', JSON.stringify(r.unset));
      say(r.shortrisk && r.shortrisk.lines.length === 1 && r.shortrisk.lines[0] === 'Work is running out, because ' + WHY + '. Kosmos could not read every agent on Work, so there may be more to move.', tag + ' a short list still says why the account is running out', JSON.stringify(r.shortrisk && r.shortrisk.lines));
      say(r.busy && r.busy.lines.length === 1 && r.busy.lines[0] === 'Work is running out, because ' + WHY + ', but none of its agents is idle, so there is nothing to move yet.', tag + ' an account running out with no idle agent is said, not silent', JSON.stringify(r.busy && r.busy.lines));
      say(r.overRead && r.overRead.extra === 0 && r.overRead.lines.length === 0 && r.overRead.checked === 'false', tag + ' pressed while a read is out: no read over it, and the lines go at once', JSON.stringify(r.overRead));
      say(r.afterRead && r.afterRead.extra === 1, tag + ' once that read is over, exactly one read follows', JSON.stringify(r.afterRead));
      say(r.hidden && r.hidden.extra === 0, tag + ' a wait whose list went off screen starts no read', JSON.stringify(r.hidden));
      say(r.twice && r.twice.extra === 2, tag + ' pressed twice while waiting: one wait, so one read after (the repaint between is the other)', JSON.stringify(r.twice));
      say(r.pressed && r.pressed.puts.length === 1 && r.pressed.puts[0] === '{"on":false}' && r.pressed.checked === 'false' && r.pressed.lines.length === 0,
        tag + ' pressing the switch sends off once and draws the next read', JSON.stringify(r.pressed));
      say(r.beforeFail && r.beforeFail.lines.length === 2 && r.failed && !r.failed.shown && r.failed.lines.length === 0, tag + ' a failed read takes the earlier lines away (shown before it: the control)', JSON.stringify(r.failed));
      say(Object.values(r).filter((x) => x && 'sideways' in x).length >= 10 && Object.values(r).every((x) => !x || x.sideways !== true), tag + ' nothing scrolls sideways (in every state drawn)', '');
      say(errs.length === 0, tag + ' no page errors', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  if (fails.length) { console.log('render-autobalance-7152: ' + fails.length + ' FAILED'); process.exit(1); }
  console.log('render-autobalance-7152: all passed');
})();
