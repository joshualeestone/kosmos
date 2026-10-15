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
 * Then the timer that takes a line away at its reset, on a list left open (Chromium, page clock installed): the read
 * at the reset; a failed read there and before it; a list busy before and at the reset, and busy past its ten tries;
 * a section switch, a Settings open (even a slow one) and a double switch; back from sleep by focus and by
 * visibility; a read already out, and one that hangs; Settings closed. Each counts the reads as well as the lines.
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
  claude('bothwin', { weekly: week(40), weeklyBlocked: 'windows', fiveHour: five(30) }),
  claude('bothown', { weekly: week(40), weeklyBlocked: 'own-statusline', fiveHour: five(30) }),
  claude('bothbad', { weekly: week(40), weeklyBlocked: 'unreadable-settings', fiveHour: five(30) }),
  claude('bothlinked', { weekly: week(40), weeklyBlocked: 'linked-settings', fiveHour: five(30) }),
  claude('weekfrozen', { weekly: week(40), weeklyBlocked: 'not-wired', fiveHour: null }),
  claude('fivenotwired', { weekly: null, weeklyBlocked: 'not-wired', fiveHour: five(30) }),
  claude('key', { apiKey: true, keyTail: 'abcd', weekly: null, fiveHour: five(50) }),
  claude('spare', { weekly: week(5), fiveHour: null }),
];
const AGENTS = [{ sessionName: 's-a', name: 'Ada', state: 'working' }, { sessionName: 's-b', name: 'Bo', state: 'working' }];

const fails = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fails.push(label); };

/* The page keeps two tables of why a reading will not update: frozenSay (one reading, mirrored word for word by #6178's
   other-computers section) and frozenBothSay (two readings). A reason in one and not the other would put two meters
   under a singular note; this reads acctUsageHtml's own source and compares the reasons they name. */
{
  const src = require('node:fs').readFileSync(PAGE, 'utf8');
  const at = src.indexOf('function acctUsageHtml(');
  const body = at >= 0 ? src.slice(at, src.indexOf('\nfunction ', at + 10)) : '';
  const reasons = (name) => { const a = body.indexOf('const ' + name + ' = {'); if (a < 0) return ''; return [...body.slice(a, body.indexOf('}[', a)).matchAll(/^\s*'([a-z-]+)':/gm)].map((m) => m[1]).sort().join(','); };
  const one = reasons('frozenSay'), two = reasons('frozenBothSay');
  say(one.split(',').length >= 5 && one === two, 'every reason with a singular "will not update" note has its plural one', one + ' | ' + two);
}

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
            // The notes, not #6175's set-up explanation (it shares the class; its id is acct-usage-why-*).
            nones: u ? [...u.querySelectorAll('.acct-usage-none')].filter((x) => !/^acct-usage-why-/.test(x.id)).map((x) => x.textContent.trim()) : [],
            // #6175's offer, and whether it comes after every note (it answers the note, so it follows it).
            setup: u ? !!u.querySelector('[data-usage-setup]') : false,
            setupLast: u ? (() => { const s = u.querySelector('[data-usage-setup]'); const n = [...u.querySelectorAll('.acct-usage-none')].filter((x) => !/^acct-usage-why-/.test(x.id)); return !!s && n.every((x) => x.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); })() : false,
            lastIsNone: u ? (() => { const kids = [...u.querySelectorAll('.acct-usage-meter, .acct-usage-warn, .acct-usage-none')].filter((x) => !/^acct-usage-why-/.test(x.id)); return kids.length > 0 && kids[kids.length - 1].classList.contains('acct-usage-none'); })() : false,
          };
        };
        const out = {};
        for (const a of accounts) out[a.dir.split('-').pop()] = read(a.dir.split('-').pop());
        out.sideways = document.documentElement.scrollWidth > window.innerWidth + 1;
        // #6176: the move menu's target rule. A target at its five-hour limit cannot run moved agents until it resets.
        const tgt = (fh) => ({ provider: 'anthropic', dir: '/home/.claude-target', memoryShared: true, apiKey: false, connection: { state: 'connected' }, weekly: null, fiveHour: fh });
        out.moveTo = typeof acctBulkTarget === 'function' ? {
          full: acctBulkTarget(tgt({ usedPct: 100, resetsAt: Date.now() + 3600e3 }), '/home/.claude-from'),
          near: acctBulkTarget(tgt({ usedPct: 99, resetsAt: Date.now() + 3600e3 }), '/home/.claude-from'),
          over: acctBulkTarget(tgt({ usedPct: 100, resetsAt: Date.now() - 60e3 }), '/home/.claude-from'),
        } : null;
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
      for (const [id, words] of [['bothwin', 'These are the last readings Kosmos saw. They will not update on Windows yet.'],
        ['bothown', 'These are the last readings Kosmos saw. They will not update, because this account is set up its own way.'],
        ['bothbad', "These are the last readings Kosmos saw. They will not update, because Kosmos cannot read this account's settings."],
        ['bothlinked', "These are the last readings Kosmos saw. They will not update, because this account's settings file is a link to a file elsewhere (or to nothing)."]]) {
        say(r[id] && r[id].nones.length === 1 && r[id].lastIsNone && r[id].nones[0] === words, tag + ' both readings frozen (' + id + '): the plural note in its own words', JSON.stringify(r[id] && r[id].nones));
      }
      say(r.weekfrozen && r.weekfrozen.nones.length === 1 && /^This is the last reading Kosmos saw\. It will not update/.test(r.weekfrozen.nones[0]),
        tag + ' weekly only, not updating: the singular note, as before (control)', JSON.stringify(r.weekfrozen && r.weekfrozen.nones));
      // #6175's "Set up usage reading" on a row that is not set up: offered in every shape, and after its note.
      for (const id of ['bothfrozen', 'weekfrozen', 'fivenotwired']) say(r[id] && r[id].setup && r[id].setupLast, tag + ' not set up (' + id + '): the set-up offer is there, after the note', JSON.stringify(r[id] && { setup: r[id].setup, setupLast: r[id].setupLast, nones: r[id].nones }));
      say(r.bothown && !r.bothown.setup, tag + ' set up its own way: no set-up offer (control)', JSON.stringify(r.bothown && r.bothown.setup));
      say(r.moveTo && r.moveTo.full === false && r.moveTo.near === true && r.moveTo.over === true, tag + ' the move menu offers no target at its five-hour limit (99% and a reading past its reset still are)', JSON.stringify(r.moveTo));
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
  /* A list left open across the soonest reset is read again just after it, and that row's five-hour line goes. The page
     clock is installed (not pinned) so it can run forward; the stub keeps answering with the same data, now past. */
  {
    const browser = await pw.chromium.launch({ headless: process.env.HEADED === '0' });
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await page.clock.install({ time: new Date(now) });
    await page.goto('file://' + PAGE);
    const rows = [claude('soon', { weekly: week(20), fiveHour: { usedPct: 70, resetsAt: now + 10 * 60e3, at: now - 60e3 } }), claude('later', { weekly: week(20), fiveHour: five(40) })];
    const before = await page.evaluate(async (accounts) => {
      window.__reads = 0;
      const realFetch = window.fetch;
      window.fetch = (u, o) => (String(u).indexOf('/api/accounts') !== -1 ? (window.__reads++, Promise.resolve({ ok: true, json: async () => ({ accounts }) })) : realFetch(u, o));
      const showList = () => { const l = document.getElementById('set-accounts'); for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; } };
      showList();   // on screen, as Settings would be: the re-read happens only while the list is shown
      await paintAccounts();
      return [...document.querySelectorAll('#set-accounts .acct-usage-five')].length;
    }, rows);
    await page.clock.runFor(11 * 60e3);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ fives: [...document.querySelectorAll('#set-accounts .acct-usage-five')].length, reads: window.__reads }));
    say(before === 2 && after.fives === 1 && after.reads === 2, '[chromium open] a list left open past a five-hour reset is read again, and that line goes', JSON.stringify({ before, after }));
    // The read at the reset fails: the list stays, and a minute later it tries again and the line goes.
    const p2 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p2.clock.install({ time: new Date(now) });
    await p2.goto('file://' + PAGE);
    await p2.evaluate(async (accounts) => {
      window.__reads = 0;
      const realFetch = window.fetch;
      window.fetch = (u, o) => {
        if (String(u).indexOf('/api/accounts') === -1) return realFetch(u, o);
        window.__reads++;
        return window.__reads === 2 ? Promise.resolve({ ok: false, status: 503, json: async () => ({}) }) : Promise.resolve({ ok: true, json: async () => ({ accounts }) });
      };
      const showList = () => { const l = document.getElementById('set-accounts'); for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; } };
      showList();
      await paintAccounts();
    }, rows);
    await p2.clock.runFor(11 * 60e3); await p2.waitForTimeout(200);
    const failed = await p2.evaluate(() => ({ fives: document.querySelectorAll('#set-accounts .acct-usage-five').length, reads: window.__reads }));
    await p2.clock.runFor(61e3); await p2.waitForTimeout(300);
    const retried = await p2.evaluate(() => ({ fives: document.querySelectorAll('#set-accounts .acct-usage-five').length, reads: window.__reads }));
    say(failed.reads === 2 && failed.fives === 2 && retried.reads === 3 && retried.fives === 1, '[chromium open] a failed read at the reset is tried again a minute later, and the line goes', JSON.stringify({ failed, retried }));
    // A background read that fails BEFORE the reset (another check's follow-up, say) must not cancel the reset's read.
    const p4 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p4.clock.install({ time: new Date(now) });
    await p4.goto('file://' + PAGE);
    await p4.evaluate(async (accounts) => {
      window.__reads = 0;
      const realFetch = window.fetch;
      window.fetch = (u, o) => {
        if (String(u).indexOf('/api/accounts') === -1) return realFetch(u, o);
        window.__reads++;
        return window.__reads === 2 ? Promise.resolve({ ok: false, status: 503, json: async () => ({}) }) : Promise.resolve({ ok: true, json: async () => ({ accounts }) });
      };
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
    }, rows);
    await p4.clock.runFor(2 * 60e3);
    await p4.evaluate(() => paintAccounts({ followUp: ACCT_FOLLOWUP.max }));   // read 2 fails, two minutes in
    await p4.clock.runFor(9 * 60e3); await p4.waitForTimeout(300);
    const early = await p4.evaluate(() => ({ fives: document.querySelectorAll('#set-accounts .acct-usage-five').length, reads: window.__reads }));
    say(early.reads === 3 && early.fives === 1, '[chromium open] a background read that fails before the reset does not cancel the read at the reset', JSON.stringify(early));
    await p4.close();
    // The read at the reset comes back while the list is busy (a Check started during that read) for longer than the
    // follow-up waits: the line still goes once the list is free. The busy mark is a real disabled Check button.
    const p5 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p5.clock.install({ time: new Date(now) });
    await p5.goto('file://' + PAGE);
    await p5.evaluate(async (accounts) => {
      window.__reads = 0;
      const realFetch = window.fetch;
      window.fetch = (u, o) => {
        if (String(u).indexOf('/api/accounts') === -1) return realFetch(u, o);
        window.__reads++;
        if (window.__reads === 2) { const c = document.querySelector('#set-accounts .acct-check'); if (c) c.disabled = true; }   // a Check starts while this read is out
        return Promise.resolve({ ok: true, json: async () => ({ accounts }) });
      };
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
    }, rows);
    const hasCheck = await p5.evaluate(() => !!document.querySelector('#set-accounts .acct-check'));
    await p5.clock.runFor(10 * 60e3 + 5e3); await p5.waitForTimeout(200);   // the read at the reset, busy when it returns
    const atReset = await p5.evaluate(() => ({ fives: document.querySelectorAll('#set-accounts .acct-usage-five').length, reads: window.__reads }));
    await p5.clock.runFor(5 * 60e3); await p5.waitForTimeout(200);   // longer than the follow-up's wait (about 3.5 minutes)
    await p5.evaluate(() => { const c = document.querySelector('#set-accounts .acct-check:disabled'); if (c) c.disabled = false; });
    await p5.clock.runFor(2 * 60e3); await p5.waitForTimeout(300);
    const freed = await p5.evaluate(() => ({ fives: document.querySelectorAll('#set-accounts .acct-usage-five').length, reads: window.__reads }));
    say(hasCheck && atReset.reads === 2 && atReset.fives === 2 && freed.fives === 1 && freed.reads <= 3, '[chromium open] a read at the reset that comes back to a busy list clears the line once it is free, with no reads while busy', JSON.stringify({ hasCheck, atReset, freed }));
    await p5.close();
    // Another Settings section open across the reset (the timer stops while the list is hidden), then back to AI Models:
    // the line past its reset is read again then, not left until the next full repaint.
    const p6 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p6.clock.install({ time: new Date(now) });
    await p6.goto('file://' + PAGE);
    await p6.evaluate(async (accounts) => {
      window.__reads = 0;
      const realFetch = window.fetch;
      window.fetch = (u, o) => (String(u).indexOf('/api/accounts') !== -1 ? (window.__reads++, Promise.resolve({ ok: true, json: async () => ({ accounts }) })) : realFetch(u, o));
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
      settingsGo('you');   // another section: the accounts list is hidden, not repainted
    }, rows);
    const away = await p6.evaluate(() => document.getElementById('set-accounts').getClientRects().length === 0);
    await p6.clock.runFor(12 * 60e3); await p6.waitForTimeout(200);   // past the reset while away
    const whileAway = await p6.evaluate(() => window.__reads);
    await p6.evaluate(() => settingsGo('accounts'));
    await p6.clock.runFor(2e3); await p6.waitForTimeout(300);
    const back = await p6.evaluate(() => ({ fives: document.querySelectorAll('#set-accounts .acct-usage-five').length, reads: window.__reads, shown: document.getElementById('set-accounts').getClientRects().length > 0 }));
    say(away && whileAway === 1 && back.shown && back.fives === 1, '[chromium open] back on AI Models after a reset passed in another section, the line is read again and goes', JSON.stringify({ away, whileAway, back }));
    await p6.close();
    // The list is busy BEFORE the reset (a Check under way): the timer does not read until it is free, then the line goes.
    const p7 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p7.clock.install({ time: new Date(now) });
    await p7.goto('file://' + PAGE);
    await p7.evaluate(async (accounts) => {
      window.__reads = 0;
      const realFetch = window.fetch;
      window.fetch = (u, o) => (String(u).indexOf('/api/accounts') !== -1 ? (window.__reads++, Promise.resolve({ ok: true, json: async () => ({ accounts }) })) : realFetch(u, o));
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
    }, rows);
    await p7.clock.runFor(9 * 60e3);
    const hasCheck7 = await p7.evaluate(() => { const c = document.querySelector('#set-accounts .acct-check'); if (c) c.disabled = true; return !!c; });
    await p7.clock.runFor(4 * 60e3); await p7.waitForTimeout(200);   // past the reset, still busy
    const busy7 = await p7.evaluate(() => ({ fives: document.querySelectorAll('#set-accounts .acct-usage-five').length, reads: window.__reads }));
    await p7.evaluate(() => { const c = document.querySelector('#set-accounts .acct-check:disabled'); if (c) c.disabled = false; });
    await p7.clock.runFor(2 * 60e3); await p7.waitForTimeout(300);
    const free7 = await p7.evaluate(() => ({ fives: document.querySelectorAll('#set-accounts .acct-usage-five').length, reads: window.__reads }));
    say(hasCheck7 && busy7.reads === 1 && busy7.fives === 2 && free7.fives === 1 && free7.reads === 2, '[chromium open] busy before the reset: no read while busy, then one read and the line goes', JSON.stringify({ hasCheck7, busy7, free7 }));
    await p7.close();
    // Opening Settings onto AI Models repaints the list itself, after its own reads: here /api/machine takes 3 s, longer
    // than the on-show look waits, and the look must still stand down (each read runs a live check per account).
    const p8 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p8.clock.install({ time: new Date(now) });
    await p8.goto('file://' + PAGE);
    await p8.evaluate(async (accounts) => {
      window.__reads = 0;
      const realFetch = window.fetch;
      window.fetch = (u, o) => {
        const s = String(u);
        if (s.indexOf('/api/accounts') !== -1) { window.__reads++; return Promise.resolve({ ok: true, json: async () => ({ accounts }) }); }
        if (s.indexOf('/api/machine') !== -1) return new Promise((res) => setTimeout(() => res({ ok: true, json: async () => ({}) }), 3000));
        if (s.indexOf('/api/status') !== -1) return Promise.resolve({ ok: true, json: async () => ({}) });
        return realFetch(u, o);
      };
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
      settingsGo('you');
    }, rows);
    await p8.clock.runFor(12 * 60e3); await p8.waitForTimeout(200);   // a line past its reset, list hidden
    await p8.evaluate(() => { paintSettings(); settingsOpen('accounts'); });   // what opening Settings onto AI Models does
    for (let k = 0; k < 6; k++) { await p8.clock.runFor(1000); await p8.waitForTimeout(100); }
    const open8 = await p8.evaluate(() => ({ fives: document.querySelectorAll('#set-accounts .acct-usage-five').length, reads: window.__reads }));
    say(open8.reads === 2 && open8.fives === 1, '[chromium open] opening Settings onto AI Models reads the list once, even when its own reads are slow', JSON.stringify(open8));
    await p8.close();
    // Switching to AI Models twice in a row with a line past its reset: one read, not one per switch. A behaviour arm:
    // the epoch check alone already stops the second look, so it does not prove the single acctOnShowTimer handle.
    const p9 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p9.clock.install({ time: new Date(now) });
    await p9.goto('file://' + PAGE);
    await p9.evaluate(async (accounts) => {
      window.__reads = 0;
      const realFetch = window.fetch;
      window.fetch = (u, o) => (String(u).indexOf('/api/accounts') !== -1 ? (window.__reads++, Promise.resolve({ ok: true, json: async () => ({ accounts }) })) : realFetch(u, o));
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
      settingsGo('you');
    }, rows);
    await p9.clock.runFor(12 * 60e3); await p9.waitForTimeout(200);
    await p9.evaluate(() => { settingsGo('accounts'); settingsGo('accounts'); });
    await p9.clock.runFor(3e3); await p9.waitForTimeout(300);
    const twice9 = await p9.evaluate(() => ({ fives: document.querySelectorAll('#set-accounts .acct-usage-five').length, reads: window.__reads }));
    say(twice9.reads === 2 && twice9.fives === 1, '[chromium open] two switches to AI Models read the list once', JSON.stringify(twice9));
    await p9.close();
    // Busy across one line's reset long enough to spend its ten tries: the other line still keeps its own reset.
    const p10 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p10.clock.install({ time: new Date(now) });
    await p10.goto('file://' + PAGE);
    await p10.evaluate(async (accounts) => {
      window.__reads = 0;
      const realFetch = window.fetch;
      window.fetch = (u, o) => (String(u).indexOf('/api/accounts') !== -1 ? (window.__reads++, Promise.resolve({ ok: true, json: async () => ({ accounts }) })) : realFetch(u, o));
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
    }, rows);
    await p10.clock.runFor(9 * 60e3);
    await p10.evaluate(() => { const c = document.querySelector('#set-accounts .acct-check'); if (c) c.disabled = true; });
    await p10.clock.runFor(20 * 60e3); await p10.waitForTimeout(200);   // past the soonest reset, busy for more than ten tries
    await p10.evaluate(() => { const c = document.querySelector('#set-accounts .acct-check:disabled'); if (c) c.disabled = false; });
    const spent10 = await p10.evaluate(() => window.__reads);
    await p10.clock.runFor(2 * 3600e3); await p10.waitForTimeout(300);   // past the other line's reset
    const later10 = await p10.evaluate(() => ({ fives: document.querySelectorAll('#set-accounts .acct-usage-five').length, reads: window.__reads }));
    say(spent10 === 1 && later10.reads >= 2 && later10.fives === 0, '[chromium open] with one line\'s tries spent while busy, the other line\'s reset still brings a read', JSON.stringify({ spent10, later10 }));
    await p10.close();
    // Back from sleep: the clock passed the reset but the page timer did not fire. Focus, or the page becoming visible,
    // looks again and reads once; a look while a read is already out does not start a second.
    const p11 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p11.clock.install({ time: new Date(now) });
    await p11.goto('file://' + PAGE);
    await p11.evaluate(async (accounts) => {
      window.__reads = 0;
      window.__slow = false;
      const realFetch = window.fetch;
      window.fetch = (u, o) => {
        if (String(u).indexOf('/api/accounts') === -1) return realFetch(u, o);
        window.__reads++;
        const answer = { ok: true, json: async () => ({ accounts }) };
        return window.__slow ? new Promise((res) => setTimeout(() => res(answer), 3000)) : Promise.resolve(answer);
      };
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
    }, rows);
    await p11.clock.setSystemTime(new Date(now + 12 * 60e3));   // the Mac slept past the reset: the clock moved, no timer fired
    await p11.evaluate(() => window.dispatchEvent(new Event('focus')));
    for (let k = 0; k < 3; k++) { await p11.clock.runFor(1000); await p11.waitForTimeout(100); }
    const f11 = await p11.evaluate(() => ({ fives: document.querySelectorAll('#set-accounts .acct-usage-five').length, reads: window.__reads }));
    say(f11.reads === 2 && f11.fives === 1, '[chromium open] back from sleep, focusing the window reads once and the line goes', JSON.stringify(f11));
    await p11.close();
    const p12 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p12.clock.install({ time: new Date(now) });
    await p12.goto('file://' + PAGE);
    await p12.evaluate(async (accounts) => {
      window.__reads = 0;
      window.__slow = false;
      const realFetch = window.fetch;
      window.fetch = (u, o) => {
        if (String(u).indexOf('/api/accounts') === -1) return realFetch(u, o);
        window.__reads++;
        const answer = { ok: true, json: async () => ({ accounts }) };
        return window.__slow ? new Promise((res) => setTimeout(() => res(answer), 3000)) : Promise.resolve(answer);
      };
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
    }, rows);
    await p12.clock.setSystemTime(new Date(now + 12 * 60e3));   // the Mac slept past the reset: the clock moved, no timer fired
    await p12.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    for (let k = 0; k < 3; k++) { await p12.clock.runFor(1000); await p12.waitForTimeout(100); }
    const v12 = await p12.evaluate(() => ({ fives: document.querySelectorAll('#set-accounts .acct-usage-five').length, reads: window.__reads, hidden: document.hidden }));
    say(!v12.hidden && v12.reads === 2 && v12.fives === 1, '[chromium open] back from sleep, the page becoming visible reads once and the line goes', JSON.stringify(v12));
    await p12.close();
    const p13 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p13.clock.install({ time: new Date(now) });
    await p13.goto('file://' + PAGE);
    await p13.evaluate(async (accounts) => {
      window.__reads = 0;
      window.__slow = false;
      const realFetch = window.fetch;
      window.fetch = (u, o) => {
        if (String(u).indexOf('/api/accounts') === -1) return realFetch(u, o);
        window.__reads++;
        const answer = { ok: true, json: async () => ({ accounts }) };
        return window.__slow ? new Promise((res) => setTimeout(() => res(answer), 3000)) : Promise.resolve(answer);
      };
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
    }, rows);
    await p13.clock.setSystemTime(new Date(now + 12 * 60e3));   // the Mac slept past the reset: the clock moved, no timer fired
    await p13.evaluate(() => { window.__slow = true; paintAccounts({ followUp: ACCT_FOLLOWUP.max }); });
    await p13.clock.runFor(200); await p13.waitForTimeout(100);   // the read is out (its epoch raised) before the focus comes
    const out13 = await p13.evaluate(() => window.__reads);
    await p13.evaluate(() => window.dispatchEvent(new Event('focus')));
    for (let k = 0; k < 6; k++) { await p13.clock.runFor(1000); await p13.waitForTimeout(100); }
    const r13 = await p13.evaluate(() => ({ fives: document.querySelectorAll('#set-accounts .acct-usage-five').length, reads: window.__reads }));
    say(out13 === 2 && r13.reads === 2 && r13.fives === 1, '[chromium open] focus while a read is already out does not start a second read', JSON.stringify({ out13, r13 }));
    await p13.close();
    // A read that hangs (the board stops answering mid-read) must not block every later look for good.
    const p14 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p14.clock.install({ time: new Date(now) });
    await p14.goto('file://' + PAGE);
    await p14.evaluate(async (accounts) => {
      window.__reads = 0;
      window.__slow = false;
      const realFetch = window.fetch;
      window.fetch = (u, o) => {
        if (String(u).indexOf('/api/accounts') === -1) return realFetch(u, o);
        window.__reads++;
        const answer = { ok: true, json: async () => ({ accounts }) };
        return window.__slow ? new Promise(() => {}) : Promise.resolve(answer);
      };
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
    }, rows);
    await p14.clock.setSystemTime(new Date(now + 12 * 60e3));   // the Mac slept past the reset: the clock moved, no timer fired
    await p14.evaluate(() => { window.__slow = true; paintAccounts({ followUp: ACCT_FOLLOWUP.max }); });
    await p14.clock.runFor(31e3); await p14.waitForTimeout(100);   // older than any real read
    await p14.evaluate(() => { window.__slow = false; window.dispatchEvent(new Event('focus')); });
    for (let k = 0; k < 3; k++) { await p14.clock.runFor(1000); await p14.waitForTimeout(100); }
    const r14 = await p14.evaluate(() => ({ fives: document.querySelectorAll('#set-accounts .acct-usage-five').length, reads: window.__reads }));
    say(r14.reads === 3 && r14.fives === 1, '[chromium open] a read that hangs does not stop the next look (after 30 s it reads again)', JSON.stringify(r14));
    await p14.close();
    // Settings closed (the list's panel hidden): the reset brings no read; nobody is looking at the line.
    const p3 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p3.clock.install({ time: new Date(now) });
    await p3.goto('file://' + PAGE);
    await p3.evaluate(async (accounts) => {
      window.__reads = 0;
      const realFetch = window.fetch;
      window.fetch = (u, o) => (String(u).indexOf('/api/accounts') !== -1 ? (window.__reads++, Promise.resolve({ ok: true, json: async () => ({ accounts }) })) : realFetch(u, o));
      const showList = () => { const l = document.getElementById('set-accounts'); for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; } };
      showList();
      await paintAccounts();
      document.getElementById('set-accounts').closest('.panel').style.display = 'none';   // the person left Settings
    }, rows);
    await p3.clock.runFor(30 * 60e3); await p3.waitForTimeout(200);
    const closed = await p3.evaluate(() => window.__reads);
    say(closed === 1, '[chromium open] with Settings closed, a reset brings no read', 'reads=' + closed);
    await browser.close();
  }
  console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall good');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
