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
 * Slice 3, in its own box under the decision (#ab-recent): it says whether Kosmos moves agents itself; the record's entries
 * are drawn newest first, one line each, a name with markup in it as text, an account gone from the list by the
 * record's own label; switched off, or with one account, the box is empty.
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
  loginrisk: { accounts: TWO, autobalance: { on: true, ok: true, eligible: 2, moves: [], held: [], short: [], atRisk: [{ from: '/home/.claude-full', why: 'its login has stopped working', kind: 'login' }] } },
  heldshort: { accounts: TWO, autobalance: { on: true, ok: true, eligible: 2, moves: [], held: [{ from: '/home/.claude-full', why: WHY }], short: ['/home/.claude-full'], atRisk: [{ from: '/home/.claude-full', why: WHY }] } },
  shortrisk: { accounts: TWO, autobalance: { on: true, ok: true, eligible: 2, moves: [], held: [], short: ['/home/.claude-full'], atRisk: [{ from: '/home/.claude-full', why: WHY }] } },
  busy: { accounts: TWO, autobalance: { on: true, eligible: 2, moves: [], held: [], short: [], atRisk: [{ from: '/home/.claude-full', why: WHY }] } },
  /* Slice 3: the record, as the route sends it (newest first). */
  notRecording: { accounts: TWO, autobalance: { on: true, eligible: 2, moves: [], held: [], short: [], atRisk: [], recording: false, movesOn: false, recent: [] } },
  recentOff: { accounts: TWO, autobalance: { on: true, eligible: 2, moves: [], held: [], short: [], atRisk: [], recording: true, movesOn: false, recent: [
    { kind: 'skipped', at: now - 5 * 60e3, agent: 's-a', from: '/home/.claude-full', to: '/home/.claude-spare' },
    { kind: 'decision', at: now - 10 * 60e3, live: false, moves: [{ agent: 's-a', from: '/home/.claude-full', to: '/home/.claude-spare', why: WHY }], held: [], atRisk: [] }] } },
  recentOn: { accounts: TWO, autobalance: { on: true, eligible: 2, moves: [], held: [], short: [], atRisk: [], recording: true, movesOn: true, recent: [
    { kind: 'move', at: now - 30e3, agent: 's-a', from: '/home/.claude-spare', to: '/home/.claude-full', outcome: 'changed', back: true },
    { kind: 'move', at: now - 45e3, agent: 's-a', from: '/home/.claude-full', to: '/home/.claude-spare', outcome: 'stopped' },
    { kind: 'works', at: now - 1 * 60e3, agent: 's-a', from: '/home/.claude-full', to: '/home/.claude-spare', works: 'yes' },
    { kind: 'move', at: now - 2 * 60e3, agent: 's-x', from: '/home/.claude-full', to: '/home/.claude-gone', toLabel: 'Old', why: WHY, outcome: 'changed' },
    { kind: 'move', at: now - 3 * 60e3, agent: 's-a', from: '/home/.claude-full', to: '/home/.claude-spare', outcome: 'partial' },
    { kind: 'works', at: now - 4 * 60e3, agent: 's-a', to: '/home/.claude-spare', works: 'no' },
    { kind: 'move', at: now - 5 * 60e3, agent: 's-a', to: '/home/.claude-spare', outcome: 'refused' },
    { kind: 'works', at: now - 6 * 60e3, agent: 's-a', to: '/home/.claude-spare', works: 'not-seen' },
    { kind: 'decision', at: now - 7 * 60e3, live: true, moves: [{ agent: 's-a', from: '/home/.claude-full', to: '/home/.claude-spare', why: WHY }], held: [], atRisk: [] },
    { kind: 'skipped', at: now - 3 * 24 * H, agent: 's-a', from: '/home/.claude-full', to: '/home/.claude-spare' }] } },
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
            recent: [...document.querySelectorAll('#ab-recent p')].map((p) => p.textContent.trim()),
            recentMarkup: !!document.querySelector('#ab-recent b'),
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
      say(r.loginrisk && r.loginrisk.lines[0] === 'Work cannot be used right now, because its login has stopped working, but none of its agents is idle, so there is nothing to move yet.', tag + ' a stopped login is said as such, not as running out', JSON.stringify(r.loginrisk && r.loginrisk.lines));
      say(r.heldshort && r.heldshort.lines.length === 2 && r.heldshort.lines.filter((x) => x.indexOf(WHY) !== -1).length === 1 && r.heldshort.lines[1] === 'Kosmos could not read every agent on Work, so there may be more to move.', tag + ' held and short: the reason is said once', JSON.stringify(r.heldshort && r.heldshort.lines));
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
      /* Slice 3. */
      const NOT_ON = 'Moving agents on its own is not switched on for this computer yet, so Kosmos keeps a record of what it would move.';
      const ro = r.recentOff && r.recentOff.recent;
      say(ro && ro.length === 4 && ro[0] === NOT_ON && ro[1] === 'Lately'
        && /^At 11:55\sAM, Kosmos did not move Ada, because it was no longer idle\.$/.test(ro[2])
        && /^At 11:50\sAM, it would have moved Ada from Work to Spare\.$/.test(ro[3]), tag + ' moves not on: it says so, then the record newest first', JSON.stringify(ro));
      say(r.recentOff && r.recentOff.lines.length === 1 && r.recentOff.lines[0] === 'Nothing to move right now.', tag + ' CONTROL: the decision lines are unchanged beside the record', JSON.stringify(r.recentOff && r.recentOff.lines));
      const rn = r.recentOn && r.recentOn.recent;
      const want = [
        /^Kosmos moves them itself, one agent at a time, and says each move here\.$/,
        /^Lately$/,
        /^At 11:59\sAM, Kosmos moved Ada back to Work, because its first request on Spare was refused\.$/,
        /^At 11:59\sAM, the move of Ada to Spare was stopped, so it stays on Work\.$/,
        /^At 11:59\sAM, Ada was seen working on Spare\.$/,
        new RegExp('^At 11:58\\sAM, Kosmos moved <b>Bo</b> from Work to Old, because ' + WHY + '\\.$'),
        /^At 11:57\sAM, Kosmos saved Spare for Ada but could not start it again, so it stays on Work until it restarts\.$/,
        /^At 11:56\sAM, Ada\u2019s first request on Spare was refused, so Kosmos will not move agents there for a while\.$/,
        /^At 11:55\sAM, Kosmos tried to move Ada to Spare, and the move was refused\.$/,
        /^At 11:54\sAM, Ada has not been seen working on Spare in the day since it moved\.$/,
        /^On [A-Z][a-z]{2} \d{1,2} at 12:00\sPM, Kosmos did not move Ada, because it was no longer idle\.$/,
      ];
      say(rn && rn.length === want.length && want.every((re, i) => re.test(rn[i])), tag + ' moves on: it says Kosmos moves them, every entry said, a live decision not repeated as a would-have', JSON.stringify(rn));
      say(r.recentOn && !r.recentOn.recentMarkup, tag + ' a name with markup in the record is shown as text', '');
      const nr = r.notRecording && r.notRecording.recent;
      say(nr && nr.length === 1 && nr[0] === 'Kosmos does not check these accounts on a schedule on this computer, so it does not move agents or keep a record of what it would move.',
        tag + ' where the sweep does not run, it says so, and claims neither moves nor a record', JSON.stringify(nr));
      say(r.off && r.off.recent.length === 0 && r.one && r.one.recent.length === 0, tag + ' switched off, or one account: no record drawn', JSON.stringify([r.off && r.off.recent, r.one && r.one.recent]));
      say(errs.length === 0, tag + ' no page errors', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  if (fails.length) { console.log('render-autobalance-7152: ' + fails.length + ' FAILED'); process.exit(1); }
  console.log('render-autobalance-7152: all passed');
})();
