'use strict';

/**
 * kosmos#8720: Settings > Automation > Idle agents, the switch for retiring agents that have not run in N days.
 *
 * Drives the real paintIdleRetire() against a stubbed /api/idle-retire (no board), in Chromium and WebKit, at desktop
 * and phone width, inside the real Settings panel. The claims, each able to fail:
 *  - a failed read of the setting (the route answers 500) hides the switch with no on or off on it and says so (never a
 *    false Off);
 *  - a record of retirements Kosmos cannot read: the heading says it retires nobody until it can;
 *  - off: the switch reads off, and the days and the lists still show, as a preview ("if you turn this on");
 *  - on: the days read the stored number; "would be retired" names each agent as the list shows it, with why, and a
 *    name with markup in it is shown as text; "kept" lists only agents idle long enough and protected (an agent that
 *    ran two days ago is not in it, a control); "cannot tell" and "recently retired" are drawn, and an empty group
 *    draws no heading;
 *  - pressing the switch sends { on: false } once; picking 90 days sends { days: 90 } once;
 *  - a save the board took but could not list agents for re-reads, and that read failing hides the switch and says so;
 *  - on but paused on this computer (active false): the heading says retiring is paused;
 *  - a days change while a save is in flight is put back and sends nothing, and the in-flight answer is drawn;
 *  - at 390 px nothing scrolls sideways.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-idleretire-8720.js
 *
 * HEADED by default; HEADED=0 on a machine with no console session.
 */

const nodePath = require('node:path');
let pw;
try { pw = require('playwright'); }
catch { console.log('render-idleretire-8720: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const CHOICES = [14, 30, 60, 90];
const ON = { setting: { on: true, days: 60, ok: true }, choices: CHOICES, recent: [
  { name: 's-old', shownAs: 'Olga', at: '2026-11-20T09:00:00.000Z', days: 75, outcome: 'removed', because: 'it has not run in 75 days' },
  { name: 's-ref', shownAs: 'Ref', at: '2026-11-20T09:00:00.000Z', days: 80, outcome: 'refused', because: 'it is held' },
  { name: 's-par', shownAs: 'Pat', at: '2026-11-20T09:00:00.000Z', days: 80, outcome: 'partial', because: 'the session did not stop' }],
  verdicts: [
    { name: 's-a', shownAs: '<b>Ada</b>', verdict: 'retire', days: 70, why: 'it has not run in 70 days' },
    { name: 's-p', shownAs: 'Pia', verdict: 'keep', days: 65, why: 'it is on the project Atlas' },
    { name: 's-r', shownAs: 'Rex', verdict: 'keep', days: 2, why: 'it ran 2 days ago' },
    { name: 's-u', shownAs: 'Uma', verdict: 'unknown', days: null, why: 'Kosmos has no record of it running yet' }] };
const OFF = { setting: { on: false, days: 30, ok: true }, choices: CHOICES, recent: [],
  verdicts: [{ name: 's-a', shownAs: 'Ada', verdict: 'retire', days: 70, why: 'it has not run in 70 days' }] };
const EMPTY_ON = { setting: { on: true, days: 30, ok: true }, choices: CHOICES, verdicts: [], recent: [] };

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
      const errs = []; page.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) errs.push(e.message); });
      await page.goto('file://' + PAGE);
      const r = await page.evaluate(async ({ on, off, emptyOn }) => {
        if (typeof paintIdleRetire !== 'function') return { error: 'paintIdleRetire is not a function' };
        const realFetch = window.fetch;
        let current = null;
        const puts = [];
        window.fetch = (u, opts) => {
          const url = String(u);
          if (url.indexOf('/api/idle-retire') !== -1) {
            if (opts && opts.method === 'PUT') {
              puts.push(JSON.parse(opts.body));
              if (current && current.slow) { const answer = current.slow; return new Promise((res) => { window.releaseSave = () => res({ ok: true, json: async () => answer }); }); }
              if (current === 'saved-no-list') { current = 'fail'; return Promise.resolve({ ok: true, json: async () => ({ setting: { on: true, days: 30, ok: true }, choices: [14, 30, 60, 90], verdicts: null, recent: null }) }); }
              return Promise.resolve({ ok: true, json: async () => current });
            }
            return current === 'fail' ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) }) : Promise.resolve({ ok: true, json: async () => current });
          }
          return realFetch(u, opts);
        };
        const tog0 = document.getElementById('idr-toggle');
        for (let el = tog0.parentElement; el && el !== document.body; el = el.parentElement) {
          if (el.hidden && el.id !== 'idr-days-row' && el.id !== 'idr-lists') el.hidden = false;
          if (getComputedStyle(el).display === 'none') el.style.display = 'block';
        }
        const panel = tog0.closest('.panel');
        if (panel) for (const other of document.querySelectorAll('.panel')) if (other !== panel && !other.contains(panel)) other.style.display = 'none';
        const shown = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getBoundingClientRect().height > 0; };
        const items = (id) => (shown(id) ? [...document.querySelectorAll('#' + id + ' li')].map((li) => li.textContent.trim()) : []);
        const look = () => {
          const tog = document.getElementById('idr-toggle');
          return {
            togHidden: tog.hidden,
            checked: tog.hasAttribute('aria-checked') ? tog.getAttribute('aria-checked') : null,
            days: shown('idr-days-row') ? document.getElementById('idr-days').value : null,
            lists: shown('idr-lists'),
            retire: items('idr-retire'), keep: items('idr-keep'), unknown: items('idr-unknown'), recent: items('idr-recent'),
            heads: ['idr-retire-h', 'idr-keep-h', 'idr-unknown-h', 'idr-recent-h'].filter(shown),
            retireHead: document.getElementById('idr-retire-h').textContent,
            markup: !!document.querySelector('#idr-retire b'),
            msg: document.getElementById('idr-msg').textContent.trim(),
            sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
          };
        };
        const out = {};
        current = 'fail'; await paintIdleRetire(); out.fail = look();
        current = off; await paintIdleRetire(); out.off = look();
        current = emptyOn; await paintIdleRetire(); out.emptyOn = look();
        current = on; await paintIdleRetire(); out.on = look();
        current = { ...on, setting: { ...on.setting, on: false } };
        document.getElementById('idr-toggle').click();
        for (let i = 0; i < 50 && look().checked !== 'false'; i += 1) await new Promise((res) => setTimeout(res, 20));
        out.afterClick = { ...look(), puts: puts.slice() };
        current = on; await paintIdleRetire();
        puts.length = 0;
        const sel = document.getElementById('idr-days');
        current = { ...on, setting: { ...on.setting, days: 90 } };
        sel.value = '90'; sel.dispatchEvent(new Event('change'));
        for (let i = 0; i < 50 && puts.length === 0; i += 1) await new Promise((res) => setTimeout(res, 20));
        await new Promise((res) => setTimeout(res, 100));
        out.afterDays = { ...look(), puts: puts.slice() };
        current = off; await paintIdleRetire();
        current = 'saved-no-list';
        document.getElementById('idr-toggle').click();
        for (let i = 0; i < 50 && look().checked !== null; i += 1) await new Promise((res) => setTimeout(res, 20));
        out.savedNoList = look();
        current = { ...on, active: false }; await paintIdleRetire(); out.paused = look();
        current = { ...on, unreadable: true, recent: [] }; await paintIdleRetire(); out.recordUnreadable = look();
        current = on; await paintIdleRetire();
        puts.length = 0;
        const sel2 = document.getElementById('idr-days');
        current = { slow: { ...on, setting: { ...on.setting, days: 90 } } };
        sel2.value = '90'; sel2.dispatchEvent(new Event('change'));
        await new Promise((res) => setTimeout(res, 50));
        sel2.value = '14'; sel2.dispatchEvent(new Event('change'));
        await new Promise((res) => setTimeout(res, 50));
        const during = { value: sel2.value, msg: document.getElementById('idr-msg').textContent.trim() };
        window.releaseSave();
        for (let i = 0; i < 50 && sel2.value !== '90'; i += 1) await new Promise((res) => setTimeout(res, 20));
        out.inflight = { during, after: sel2.value, puts: puts.slice() };
        return out;
      }, { on: ON, off: OFF, emptyOn: EMPTY_ON });
      if (r.error) { say(false, tag + ' ' + r.error); await page.close(); continue; }
      say(r.fail.togHidden && r.fail.checked === null && !r.fail.lists && /could not read/.test(r.fail.msg), tag + ' a failed read hides the switch with no position and says so', JSON.stringify(r.fail));
      say(!r.off.togHidden && r.off.checked === 'false' && r.off.days === '30' && r.off.lists
        && JSON.stringify(r.off.retire) === JSON.stringify(['Ada: it has not run in 70 days'])
        && /if you turn this on/.test(r.off.retireHead), tag + ' off: the switch reads off, and the days and a preview of who would go still show', JSON.stringify(r.off));
      say(r.emptyOn.checked === 'true' && r.emptyOn.heads.length === 0, tag + ' on with nothing to list draws no group heading', JSON.stringify(r.emptyOn.heads));
      say(r.on.checked === 'true' && r.on.days === '60' && r.on.lists, tag + ' on: the switch reads on and the days read the stored 60', JSON.stringify({ c: r.on.checked, d: r.on.days }));
      say(JSON.stringify(r.on.retire) === JSON.stringify(['<b>Ada</b>: it has not run in 70 days']) && !r.on.markup, tag + ' would-retire names the agent as shown, with why, markup as text', JSON.stringify(r.on.retire));
      say(JSON.stringify(r.on.keep) === JSON.stringify(['Pia: it is on the project Atlas']), tag + ' kept lists only the idle-and-protected agent (Rex, who ran 2 days ago, is not in it)', JSON.stringify(r.on.keep));
      say(JSON.stringify(r.on.unknown) === JSON.stringify(['Uma']), tag + ' cannot-tell lists the agent with no record', JSON.stringify(r.on.unknown));
      say(r.on.recent.length === 3 && /^Olga, 2026-11-20: retired, /.test(r.on.recent[0]) && /^Ref, 2026-11-20: not retired, it is held$/.test(r.on.recent[1])
        && /^Pat, 2026-11-20: partly removed, the session did not stop$/.test(r.on.recent[2]), tag + ' recently retired says retired or not, with the day and why', JSON.stringify(r.on.recent));
      say(JSON.stringify(r.afterClick.puts) === JSON.stringify([{ on: false }]) && r.afterClick.checked === 'false' && /if you turn this on/.test(r.afterClick.retireHead), tag + ' pressing the switch sends { on: false } once and draws off', JSON.stringify(r.afterClick.puts));
      say(r.savedNoList.checked === null && r.savedNoList.togHidden && /could not read/.test(r.savedNoList.msg), tag + ' a save with no agent list re-reads, and a failed read hides the switch and says so', JSON.stringify(r.savedNoList));
      say(JSON.stringify(r.afterDays.puts) === JSON.stringify([{ days: 90 }]) && r.afterDays.days === '90', tag + ' picking 90 days sends { days: 90 } once', JSON.stringify(r.afterDays.puts));
      say(/paused on this computer/.test(r.paused.retireHead) && r.paused.checked === 'true', tag + ' on but paused: the heading says retiring is paused', r.paused.retireHead);
      say(/cannot read its record of retirements, so it retires nobody/.test(r.recordUnreadable.retireHead), tag + ' an unreadable record: the heading says nobody is retired until it can be read', r.recordUnreadable.retireHead);
      say(r.inflight.during.value === '60' && /Still saving/.test(r.inflight.during.msg) && r.inflight.after === '90' && JSON.stringify(r.inflight.puts) === JSON.stringify([{ days: 90 }]),
        tag + ' a days change during a save is put back and sends nothing; the save that was in flight is drawn', JSON.stringify(r.inflight));
      say(!r.on.sideways, tag + ' nothing scrolls sideways');
      say(errs.length === 0, tag + ' no page errors', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  console.log(fails.length ? '\nrender-idleretire-8720: ' + fails.length + ' FAILED' : '\nrender-idleretire-8720: all passed');
  process.exit(fails.length ? 1 : 0);
})();
