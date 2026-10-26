'use strict';
// Browser-check-functions: acctUsageHtml, moveAccountAgents, stopAccountMove, acctStopClick, acctStopLabel, acctMoveCountShow, engineRestartClick

/**
 * kosmos#6214: Stop a running account move from its row in Settings > AI Models.
 *
 * Drives the real paintAccounts() against stubbed /api/accounts and move routes (no board), in Chromium and WebKit.
 * The stub behaves like engine/accountmove.js: the move restarts one agent at a time and does not finish on its own;
 * a POST to the stop route marks the unreached agents as put back and finishes the one restarting. The claims, each
 * able to fail:
 *  - a moving row draws "Stop the move", and a row that is not moving does not;
 *  - pressing it sends one POST to /api/agents/account-moves/stop and the button reads "Stopping…" until the move ends;
 *  - the row's final sentence says the restarted agent moved and the unreached ones were not moved and stay on their
 *    old account, in the board's words; and the stop button is gone once the move has ended;
 *  - no page error.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-acct-stopmove-6214.js
 *
 * HEADED by default, like the other checks here; HEADED=0 on a machine with no console session.
 */

const nodePath = require('node:path');
let pw;
try { pw = require('playwright'); }
catch { console.log('render-acct-stopmove-6214: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const H = 3600e3, now = Date.now();
const conn = { state: 'connected', badge: 'working', checkedLive: true, because: 'a real request succeeded', observedAt: now - 9000, observedAgeMs: 9000 };
const claude = (email, dir, extra) => ({ provider: 'anthropic', providerName: 'Anthropic / Claude', email, label: email, dir: '/home/.claude-' + dir,
  organization: null, isDefault: false, keyTail: null, name: null, memoryShared: true, connection: conn,
  weekly: { usedPct: 50, resetsAt: now + 50 * H, at: now - H }, ...extra });
/* kosmos#7152 slice 2: /api/accounts now sends each Claude row's bulkTargetable, from the engine's own rule; the
   fixtures carry what the route would send, computed by that same function, not a hand-set value. */
const withTarget = (rows) => rows.map((r) => ({ ...r, bulkTargetable: require('../../engine/autobalance').bulkTargetable(r, now) }));
const ACCOUNTS = withTarget([
  claude('busy@example.com', 'busy', { agentsHere: { names: ['s-al', 's-bo', 's-cy'], complete: true } }),
  claude('calm@example.com', 'calm', { agentsHere: { names: ['s-di'], complete: true } }),
  claude('spare@example.com', 'spare', { agentsHere: { names: [], complete: true } }),
]);
const AGENTS = [{ sessionName: 's-al', name: 'Al', state: 'working' }, { sessionName: 's-bo', name: 'Bo', state: 'working' },
  { sessionName: 's-cy', name: 'Cy', state: 'working' }, { sessionName: 's-di', name: 'Di', state: 'working' }];

const fails = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fails.push(label); };

(async () => {
  for (const engine of ['chromium', 'webkit']) {
    let browser;
    try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
    catch (err) { say(false, '[' + engine + '] could not start a browser', err && err.message ? err.message.split('\n')[0] : String(err)); continue; }
    const tag = '[' + engine + ']';
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    /* A file:// page has no board behind it; WebKit reports each background read as an access-control error. */
    const errs = []; page.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) errs.push(e.message); });
    await page.goto('file://' + PAGE);
    const r = await page.evaluate(async ({ accounts, agents }) => {
      const stops = [];
      let move = null;   // { id, agents, stopped }
      const reply = (status, body) => new Promise((res) => setTimeout(() => res({ ok: status >= 200 && status < 300, status, json: async () => body }), 20));
      const view = () => ({ id: move.id, done: move.agents.every((a) => a.outcome !== 'pending'), ...(move.stopped ? { stopped: true } : {}),
        agents: move.agents.map((a) => ({ ...a })) });
      const realFetch = window.fetch;
      window.fetch = (u, opts) => {
        const url = String(u);
        if (url.indexOf('/api/accounts') !== -1) return Promise.resolve({ ok: true, json: async () => ({ accounts }) });
        if (url === '/api/agents/account' && opts && opts.method === 'POST') {
          const { names } = JSON.parse(opts.body);
          move = { id: 'mv1', stopped: false, agents: names.map((name) => ({ name, outcome: 'pending' })) };
          return reply(202, view());
        }
        if (url === '/api/agents/account-moves/stop' && opts && opts.method === 'POST') {
          stops.push(Date.now());
          if (!move || view().done) return reply(409, { outcome: 'refused', because: 'No account move is running.' });
          /* As the engine does: the first agent is mid-restart and finishes; the rest are put back now. */
          move.stopped = true;
          move.agents.slice(1).forEach((a) => Object.assign(a, { outcome: 'stopped', because: 'you stopped the move before their turn. They stay on busy@example.com.' }));
          const v = { ...view(), waitingFor: move.agents[0].name };
          setTimeout(() => Object.assign(move.agents[0], { outcome: 'changed', because: 'moved' }), 600);
          return reply(200, v);
        }
        const rd = url.match(/\/api\/agents\/account-moves\/([^/]+)$/);
        if (rd) return move ? reply(200, view()) : reply(404, {});
        return realFetch(u, opts);
      };
      if (typeof paintAccounts !== 'function') return { error: 'paintAccounts is not a function' };
      LAST = agents;
      await paintAccounts();
      const list0 = document.getElementById('set-accounts');
      for (let el = list0; el && el !== document.body; el = el.parentElement) {
        if (el.hidden) el.hidden = false;
        if (getComputedStyle(el).display === 'none') el.style.display = 'block';
      }
      const box = (d) => document.querySelector('#set-accounts .acct-box[data-acct-dir="/home/.claude-' + d + '"]');
      const stopIn = (d) => box(d) && box(d).querySelector('[data-acct-move-stop]');
      const out = { stopBeforeMove: !!stopIn('busy') };
      const sel = box('busy').querySelector('[data-acct-move-to]'), btn = box('busy').querySelector('[data-acct-move]');
      sel.value = '/home/.claude-spare'; sel.dispatchEvent(new Event('change'));
      btn.click();
      const wait = async (pred, ms) => { const until = Date.now() + ms; while (Date.now() < until) { if (pred()) return true; await new Promise((x) => setTimeout(x, 50)); } return pred(); };
      /* Offered from the press itself (no repaint happens before the move ends): read it within 50 ms, before any poll. */
      out.stopDrawn = await wait(() => !!stopIn('busy'), 50);
      const s = stopIn('busy');
      out.stopText = s ? s.textContent.trim() : null;
      out.stopVisible = !!s && s.getBoundingClientRect().width > 0;
      /* #6231: named for a screen reader, and focused (the pressed Move button is disabled, so focus had fallen to the page). */
      out.stopName = s ? s.getAttribute('aria-label') : null;
      out.stopFocused = !!s && document.activeElement === s;
      out.calmHasStop = !!stopIn('calm');
      if (s) s.click();
      await new Promise((x) => setTimeout(x, 100));
      /* The row may repaint while it waits; read whichever stop button is drawn now. */
      const s2 = stopIn('busy');
      out.stoppingText = s2 ? s2.textContent.trim() : null;
      out.stoppingDisabled = s2 ? s2.disabled : null;
      out.stoppingName = s2 ? s2.getAttribute('aria-label') : 'none drawn';
      /* #6231: the Move button drops its count once a stop is pressed (it would jump ahead as put-back agents finish). */
      const mv = box('busy') && box('busy').querySelector('[data-acct-move]');
      out.moveWhileStopping = mv ? mv.textContent.trim() : null;
      /* Ended: the row is drawn plain again (its Move button no longer reads Moving or a count). It stays disabled until a
         new target is picked, so its disabled state says nothing here. */
      const moveText = () => { const m = box('busy') && box('busy').querySelector('[data-acct-move]'); return m ? m.textContent.trim() : ''; };
      out.ended = await wait(() => !stopIn('busy') && /^Move\b/.test(moveText()) && !/^Moving/.test(moveText()), 8000);
      out.endText = moveText();
      /* The row's own sentence (the paint draws it), else the panel's status line, which says it 150 ms later. */
      const note = () => {
        const m = document.querySelector('[data-acct-move-msg="/home/.claude-busy"]');
        const ps = document.getElementById('set-accounts-msg');
        return (m && m.textContent.trim()) || (ps && ps.textContent.trim()) || '';
      };
      out.said = await wait(() => /Not moved/.test(note()), 3000) ? note() : note();
      out.stops = stops.length;
      return out;
    }, { accounts: ACCOUNTS, agents: AGENTS });
    if (r.error) { say(false, tag + ' ' + r.error); await browser.close(); continue; }
    say(r.stopBeforeMove === false, tag + ' a row that is not moving draws no stop button');
    say(r.stopDrawn && r.stopText === 'Stop the move' && r.stopVisible, tag + ' the moving row draws Stop the move', JSON.stringify([r.stopDrawn, r.stopText, r.stopVisible]));
    say(r.calmHasStop === false, tag + ' only the moving row offers the stop');
    say(r.stoppingText === 'Stopping…' && r.stoppingDisabled === true, tag + ' a pressed stop reads Stopping… and cannot be pressed again', JSON.stringify([r.stoppingText, r.stoppingDisabled]));
    say(r.stopName === 'Stop the move to another account' && r.stopFocused === true, tag + ' #6231: the inserted stop is named and focused', JSON.stringify([r.stopName, r.stopFocused]));
    say(r.stoppingName === null, tag + ' #6231: while stopping, its visible Stopping… is its name', JSON.stringify(r.stoppingName));
    say(r.moveWhileStopping === 'Moving…', tag + ' #6231: once stopping, the Move button shows no count', JSON.stringify(r.moveWhileStopping));
    say(r.stops === 1, tag + ' one stop request', String(r.stops));
    say(r.ended === true, tag + ' the move ends and its stop button goes', JSON.stringify(r.endText));
    say(/Moved 1 agent\./.test(r.said) && /Not moved \(Bo, Cy\): you stopped the move before their turn\. They stay on busy@example\.com\./.test(r.said),
      tag + ' the final sentence says who moved and who stays', JSON.stringify(r.said));
    say(errs.length === 0, tag + ' no page error', errs.join(' | '));

    /* Restart Kosmos refused because a move holds the board (round 6): at phone width the toast hides its small line,
       so the refusal and the stop's answer must be readable in what IS shown. The toast is the one the page paints
       (its classes and the real button id), drawn here because painting it for real needs a stale-engine status. */
    for (const [tw, th] of [[390, 844], [1100, 900]]) {
      const ttag = '[' + engine + ' toast ' + tw + ']';
      const tp = await browser.newPage({ viewport: { width: tw, height: th } });
      const terrs = []; tp.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) terrs.push(e.message); });
      await tp.goto('file://' + PAGE);
      const t = await tp.evaluate(async () => {
        const realFetch = window.fetch;
        let stops = 0;
        window.fetch = (u, opts) => {
          const url = String(u);
          const reply = (status, body) => new Promise((r) => setTimeout(() => r({ ok: status >= 200 && status < 300, status, json: async () => body }), 20));
          if (url === '/api/engine/restart') return reply(409, { ok: false, because: 'An account move is restarting agents one at a time, so Kosmos cannot restart now.', moveStoppable: true });
          if (url === '/api/agents/account-moves/stop') { stops++; return reply(200, { id: 'mv1', stopped: true, waitingFor: 's-al', agents: [] }); }
          return realFetch(u, opts);
        };
        LAST = [{ sessionName: 's-al', name: 'Al' }];
        const slot = document.getElementById('utoast-slot');
        for (let el = slot; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; }
        slot.dataset.v = 'engine-btn';
        slot.innerHTML = '<div class="utoast stale" role="status"><span class="udot" aria-hidden="true"></span>'
          + '<div class="utxt"><b>Kosmos needs a quick restart</b><small>A Kosmos file was changed, and Kosmos is still running the old copy. Your agents keep running.</small></div>'
          + '<div class="uacts"><button type="button" class="uprime" id="ut-engine-restart">Restart Kosmos</button></div></div>';
        document.getElementById('ut-engine-restart').addEventListener('click', () => engineRestartClick());
        const wait = async (pred, ms) => { const until = Date.now() + ms; while (Date.now() < until) { if (pred()) return true; await new Promise((x) => setTimeout(x, 30)); } return pred(); };
        const shownText = () => [...slot.querySelectorAll('b, small')].filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0).map((e) => e.textContent.trim()).join(' | ');
        document.getElementById('ut-engine-restart').click();
        const offered = await wait(() => !!slot.querySelector('[data-stop-move-offer]'), 3000);
        const offer = slot.querySelector('[data-stop-move-offer]');
        const offerVisible = !!offer && offer.getBoundingClientRect().width > 0;
        const afterRefusal = shownText();
        const title = slot.querySelector('b') ? slot.querySelector('b').textContent.trim() : '';
        if (offer) offer.click();
        await wait(() => !slot.querySelector('[data-stop-move-offer]'), 3000);
        await new Promise((x) => setTimeout(x, 50));
        return { offered, offerVisible, afterRefusal, title, afterStop: shownText(), stops };
      });
      say(t.offered && t.offerVisible, ttag + ' the refusal offers a visible Stop the move');
      say(t.title === 'An account move is running, so Kosmos cannot restart yet', ttag + ' #6231: the title says an account move is why at this width', JSON.stringify(t.title));
      say(/account move/i.test(t.afterRefusal), ttag + ' what is shown says an account move is why', JSON.stringify(t.afterRefusal));
      say(t.stops === 1 && /The move will stop once Al has finished restarting/.test(t.afterStop), ttag + ' the stop\'s answer is shown, naming the agent', JSON.stringify(t.afterStop));
      say(terrs.length === 0, ttag + ' no page error', terrs.join(' | '));
      await tp.close();
    }
    await browser.close();
  }
  console.log(fails.length ? 'render-acct-stopmove-6214: ' + fails.length + ' FAILED' : 'render-acct-stopmove-6214: all passed');
  process.exit(fails.length ? 1 : 0);
})();
