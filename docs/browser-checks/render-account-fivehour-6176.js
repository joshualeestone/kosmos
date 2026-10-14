'use strict';

/**
 * kosmos#6176 slice 1: a Claude account row in Settings > AI Models also says how much of its 5-hour limit it has
 * used, as its own line under the weekly one.
 *
 * Drives the real paintAccounts() against a stubbed /api/accounts (no board), in Chromium and WebKit, at desktop and
 * phone width, inside the real Settings panel. The claims, each one able to fail:
 *  - a row with both readings draws two meters, the second at the five-hour figure, saying
 *    "64% of its 5-hour limit used · resets <time> · Kosmos last saw it change ...";
 *  - a row with no five-hour reading draws one meter (the control);
 *  - at 82% the five-hour line warns "Close to its 5-hour limit." and never suggests a move (it resets within hours);
 *    at 100% it says "At its 5-hour limit until <time>.";
 *  - a row with only a five-hour reading shows it in place of "No usage reading yet", and under a blocked account it
 *    is said to be the last reading;
 *  - an API-key row draws no meter at all;
 *  - at 390 px nothing scrolls sideways.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-account-fivehour-6176.js
 *
 * HEADED by default; HEADED=0 on a machine with no console session.
 */

const nodePath = require('node:path');
let pw;
try { pw = require('playwright'); }
catch { console.log('render-account-fivehour-6176: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
/* Every time is relative to a pinned noon, and the page's clock is pinned there too, so the "today, time only" form
   never turns into tomorrow's weekday form late in the evening (the check ran red from 22:00 to midnight otherwise). */
const H = 3600e3, now = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
const conn = { state: 'connected', badge: 'working', checkedLive: true, because: 'a real request succeeded', observedAt: now - 9000, observedAgeMs: 9000 };
const claude = (id, extra) => ({ provider: 'anthropic', providerName: 'Anthropic / Claude', email: id + '@example.com', label: id + '@example.com', dir: '/home/.claude-' + id,
  organization: null, isDefault: false, keyTail: null, name: null, memoryShared: true, connection: conn, agentsHere: { names: [], complete: true }, ...extra });
const week = (pct) => ({ usedPct: pct, resetsAt: now + 50 * H, at: now - H });
const five = (pct) => ({ usedPct: pct, resetsAt: now + 2 * H, at: now - 2 * 60e3 });
const ACCOUNTS = [
  claude('both', { weekly: week(40), fiveHour: five(64) }),
  claude('weekonly', { weekly: week(40), fiveHour: null }),
  claude('fivewarn', { weekly: week(20), fiveHour: five(82), agentsHere: { names: ['s-a'], complete: true } }),
  claude('fivefull', { weekly: week(20), fiveHour: five(100) }),
  claude('fiveonly', { weekly: null, fiveHour: five(30) }),
  claude('fivefrozen', { weekly: null, weeklyBlocked: 'own-statusline', fiveHour: five(30) }),
  claude('bothwarn', { weekly: week(90), fiveHour: five(85), agentsHere: { names: ['s-b'], complete: true } }),
  claude('tomorrow', { weekly: week(20), fiveHour: { usedPct: 30, resetsAt: now + 14 * H, at: now - 60e3 } }),
  claude('expired', { weekly: week(20), fiveHour: { usedPct: 99, resetsAt: now - 60e3, at: now - 3 * H } }),
  claude('bothfrozen', { weekly: week(40), weeklyBlocked: 'not-wired', fiveHour: five(30) }),
  claude('weekfrozen', { weekly: week(40), weeklyBlocked: 'not-wired', fiveHour: null }),
  claude('key', { apiKey: true, keyTail: 'abcd', weekly: null, fiveHour: five(50) }),
  claude('spare', { weekly: week(5), fiveHour: null }),
];
const AGENTS = [{ sessionName: 's-a', name: 'Ada', state: 'working' }, { sessionName: 's-b', name: 'Bo', state: 'working' }];

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
      /* A file:// page has no board, so its own background reads fail; WebKit reports each "due to access control checks". */
      const errs = []; page.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) errs.push(e.message); });
      await page.goto('file://' + PAGE);
      const r = await page.evaluate(async ({ accounts, agents }) => {
        const realFetch = window.fetch;
        window.fetch = (u, opts) => (String(u).indexOf('/api/accounts') !== -1
          ? Promise.resolve({ ok: true, json: async () => ({ accounts }) }) : realFetch(u, opts));
        if (typeof paintAccounts !== 'function') return { error: 'paintAccounts is not a function' };
        LAST = agents;
        await paintAccounts();
        // Show the list IN PLACE inside the real Settings panel, so every rule that reaches it on the real screen applies.
        const list0 = document.getElementById('set-accounts');
        for (let el = list0; el && el !== document.body; el = el.parentElement) {
          if (el.hidden) el.hidden = false;
          if (getComputedStyle(el).display === 'none') el.style.display = 'block';
        }
        const panel = list0.closest('.panel');
        for (const other of document.querySelectorAll('.panel')) if (other !== panel && !other.contains(panel)) other.style.display = 'none';
        const read = (id) => {
          const b = document.querySelector('#set-accounts .acct-box[data-acct-dir="/home/.claude-' + id + '"]'); if (!b) return null;
          const u = b.querySelector('.acct-usage');
          const meters = u ? [...u.querySelectorAll('.acct-usage-meter')] : [];
          const fiveM = u && u.querySelector('.acct-usage-five');
          return {
            meters: meters.length,
            fiveFill: fiveM ? fiveM.querySelector('.bar i').style.width : null,
            fiveLine: fiveM ? fiveM.querySelector('.acct-usage-line').textContent.trim() : null,
            fiveVisible: fiveM ? fiveM.getBoundingClientRect().height > 0 : false,
            warns: u ? [...u.querySelectorAll('.acct-usage-warn')].map((x) => x.textContent.trim()) : [],
            order: u ? [...u.querySelectorAll('.acct-usage-meter, .acct-usage-warn')].map((x) => x.classList.contains('acct-usage-five') ? 'five' : x.classList.contains('acct-usage-meter') ? 'week' : (/5-hour/.test(x.textContent) ? 'fivewarn' : 'weekwarn')) : [],
            nones: u ? [...u.querySelectorAll('.acct-usage-none')].map((x) => x.textContent.trim()) : [],
            lastIsNone: u ? (() => { const kids = [...u.querySelectorAll('.acct-usage-meter, .acct-usage-warn, .acct-usage-none')]; return kids.length > 0 && kids[kids.length - 1].classList.contains('acct-usage-none'); })() : false,
          };
        };
        const out = {};
        for (const a of accounts) out[a.dir.split('-').pop()] = read(a.dir.split('-').pop());
        out.sideways = document.documentElement.scrollWidth > window.innerWidth + 1;
        return out;
      }, { accounts: ACCOUNTS, agents: AGENTS });
      if (r.error) { say(false, tag + ' ' + r.error); await page.close(); continue; }
      const T = '\\d{1,2}:\\d{2}\\s?[AP]M';
      say(r.both && r.both.meters === 2 && r.both.fiveFill === '64%' && r.both.fiveVisible, tag + ' both readings: two meters, the second at 64%', JSON.stringify(r.both));
      say(r.both && new RegExp('^64% of its 5-hour limit used · resets ' + T + ' · Kosmos last saw it change 2 minutes ago$').test(r.both.fiveLine || ''), tag + ' the five-hour line says the figure, the reset time and its age', JSON.stringify(r.both && r.both.fiveLine));
      say(r.weekonly && r.weekonly.meters === 1 && r.weekonly.fiveLine === null, tag + ' no five-hour reading: one meter (control)', JSON.stringify(r.weekonly));
      say(r.fivewarn && r.fivewarn.warns.length === 1 && r.fivewarn.warns[0] === 'Close to its 5-hour limit.', tag + ' at 82% the five-hour line warns, and suggests no move', JSON.stringify(r.fivewarn && r.fivewarn.warns));
      say(r.fivefull && r.fivefull.warns.length === 1 && new RegExp('^At its 5-hour limit until ' + T + '\\.$').test(r.fivefull.warns[0]), tag + ' at 100% it says until when', JSON.stringify(r.fivefull && r.fivefull.warns));
      say(r.fiveonly && r.fiveonly.meters === 1 && r.fiveonly.fiveFill === '30%' && r.fiveonly.nones.length === 0, tag + ' only a five-hour reading: shown, with no "no reading yet" beside it', JSON.stringify(r.fiveonly));
      say(r.fivefrozen && r.fivefrozen.fiveFill === '30%' && r.fivefrozen.nones.length === 1 && /^This is the last reading Kosmos saw\. It will not update, because this account is set up its own way\.$/.test(r.fivefrozen.nones[0]), tag + ' under a blocked account it is the last reading', JSON.stringify(r.fivefrozen));
      say(r.bothfrozen && r.bothfrozen.meters === 2 && r.bothfrozen.nones.length === 1 && r.bothfrozen.lastIsNone
        && r.bothfrozen.nones[0] === "These are the last readings Kosmos saw. They will not update, because Kosmos is not set up to read this account's usage.",
        tag + ' both readings, neither updating: one note after both, in the plural', JSON.stringify(r.bothfrozen && r.bothfrozen.nones));
      say(r.weekfrozen && r.weekfrozen.nones.length === 1 && /^This is the last reading Kosmos saw\. It will not update/.test(r.weekfrozen.nones[0]),
        tag + ' weekly only, not updating: the singular note, as before (control)', JSON.stringify(r.weekfrozen && r.weekfrozen.nones));
      say(r.key && r.key.meters === 0, tag + ' an API-key row draws no meter', JSON.stringify(r.key));
      say(r.bothwarn && r.bothwarn.order.join(',') === 'week,weekwarn,five,fivewarn' && /Move its agent/.test(r.bothwarn.warns[0] || '') && r.bothwarn.warns[1] === 'Close to its 5-hour limit.',
        tag + ' both warning: the weekly block (with its move) comes whole, then the five-hour one (with none)', JSON.stringify(r.bothwarn && { order: r.bothwarn.order, warns: r.bothwarn.warns }));
      say(r.tomorrow && /^30% of its 5-hour limit used · resets (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}:\d{2}\s?[AP]M · /.test(r.tomorrow.fiveLine || ''), tag + ' a reset after today names the weekday', JSON.stringify(r.tomorrow && r.tomorrow.fiveLine));
      say(r.expired && r.expired.meters === 1 && r.expired.fiveLine === null, tag + ' a reading whose reset has passed is not drawn (a panel left open)', JSON.stringify(r.expired));
      if (w === 390) say(!r.sideways, tag + ' nothing scrolls sideways');
      say(errs.length === 0, tag + ' no page errors', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall good');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
