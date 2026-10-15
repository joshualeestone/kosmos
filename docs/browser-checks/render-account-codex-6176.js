'use strict';

/**
 * kosmos#6176 slice 2: a ChatGPT sign-in (OpenAI) row in Settings > AI Models shows its plan limits as Codex last
 * reported them, one meter per window.
 *
 * Drives the real paintAccounts() against a stubbed /api/accounts (no board), in Chromium and WebKit, at desktop and
 * phone width, inside the real Settings panel, with the page clock pinned at noon. The claims, each one able to fail:
 *  - a row with two windows draws two meters, named by length: "64% of its 5-hour limit used · resets <time> · Codex
 *    last reported it 2 minutes ago" then the weekly one;
 *  - a 1440-minute window is called "1-day";
 *  - at 82% a window warns "Close to its 5-hour limit." and never suggests a move; at 100% "At its weekly limit until ...";
 *  - a window whose reset has passed is not drawn; a row with no report says so plainly;
 *  - an API-key row (no limits field) and an older board's row draw nothing;
 *  - at 390 px nothing scrolls sideways.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-account-codex-6176.js
 *
 * HEADED by default; HEADED=0 on a machine with no console session.
 */

const nodePath = require('node:path');
let pw;
try { pw = require('playwright'); }
catch { console.log('render-account-codex-6176: playwright is not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const H = 3600e3, now = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
const conn = { state: 'connected', badge: 'working', checkedLive: true, because: 'it reached ChatGPT', observedAt: now - 9000, observedAgeMs: 9000 };
const openai = (id, extra) => ({ provider: 'openai', providerName: 'OpenAI', email: id + '@example.com', label: id, dir: '/home/.codex-' + id,
  name: null, isDefault: false, authMode: 'chatgpt', keyTail: null, connection: conn, offerable: true, ...extra });
const win = (pct, mins, resetsAt) => ({ usedPct: pct, windowMinutes: mins, resetsAt });
const ACCOUNTS = [
  openai('two', { limits: { windows: [win(64, 300, now + 2 * H), win(30, 10080, now + 50 * H)], plan: 'prolite', at: now - 2 * 60e3 } }),
  openai('day', { limits: { windows: [win(10, 1440, now + 5 * H)], plan: 'plus', at: now - 60e3 } }),
  openai('warn', { limits: { windows: [win(82, 300, now + H)], plan: 'plus', at: now - 60e3 } }),
  openai('full', { limits: { windows: [win(100, 10080, now + 50 * H)], plan: 'plus', at: now - 60e3 } }),
  openai('over', { limits: { windows: [win(99, 300, now - 60e3), win(20, 10080, now + 50 * H)], plan: 'plus', at: now - 6 * H } }),
  openai('none', { limits: null }),
  openai('key', { authMode: 'apikey', email: null, keyTail: 'KEYX' }),
  openai('old', {}),
];
delete ACCOUNTS[ACCOUNTS.length - 1].limits;

const fails = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fails.push(label); };

(async () => {
  for (const engine of ['chromium', 'webkit']) {
    let browser;
    try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
    catch (err) { say(false, '[' + engine + '] could not start a browser', err && err.message ? err.message.split('\n')[0] : String(err)); continue; }
    for (const [w, h] of [[1100, 900], [390, 844]]) {
      const tag = '[' + engine + ' ' + w + ']';
      const page = await browser.newPage({ viewport: { width: w, height: h }, locale: 'en-US', timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone });   // the same zone as Node's noon
      await page.clock.setFixedTime(new Date(now));
      const errs = []; page.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) errs.push(e.message); });
      await page.goto('file://' + PAGE);
      const r = await page.evaluate(async ({ accounts }) => {
        const realFetch = window.fetch;
        window.fetch = (u, opts) => (String(u).indexOf('/api/accounts') !== -1 ? Promise.resolve({ ok: true, json: async () => ({ accounts }) }) : realFetch(u, opts));
        if (typeof paintAccounts !== 'function') return { error: 'paintAccounts is not a function' };
        await paintAccounts();
        const list0 = document.getElementById('set-accounts');
        for (let el = list0; el && el !== document.body; el = el.parentElement) {
          if (el.hidden) el.hidden = false;
          if (getComputedStyle(el).display === 'none') el.style.display = 'block';
        }
        const panel = list0.closest('.panel');
        for (const other of document.querySelectorAll('.panel')) if (other !== panel && !other.contains(panel)) other.style.display = 'none';
        const out = {};
        for (const a of accounts) {
          const b = document.querySelector('#set-accounts .acct-box[data-acct-dir="' + a.dir + '"]');
          const u = b && b.querySelector('.acct-usage');
          out[a.label] = b ? {
            meters: u ? [...u.querySelectorAll('.acct-usage-codex')].map((m) => ({ fill: m.querySelector('.bar i').style.width, line: m.querySelector('.acct-usage-line').textContent.trim(), h: m.getBoundingClientRect().height })) : [],
            warns: u ? [...u.querySelectorAll('.acct-usage-warn')].map((x) => x.textContent.trim()) : [],
            nones: u ? [...u.querySelectorAll('.acct-usage-none')].map((x) => x.textContent.trim()) : [],
            usage: !!u,
            move: !!b.querySelector('.acct-move'),   // Claude's move control (#6108): never on an OpenAI row
          } : null;
        }
        out.sideways = document.documentElement.scrollWidth > window.innerWidth + 1;
        return out;
      }, { accounts: ACCOUNTS });
      if (r.error) { say(false, tag + ' ' + r.error); await page.close(); continue; }
      const T = '\\d{1,2}:\\d{2}\\s?[AP]M';
      const two = r.two;
      say(two && two.meters.length === 2 && two.meters[0].fill === '64%' && two.meters[1].fill === '30%' && two.meters.every((m) => m.h > 0), tag + ' two windows: two meters, in the order Codex gives them', JSON.stringify(two && two.meters.map((m) => m.fill)));
      say(two && new RegExp('^64% of its 5-hour limit used · resets ' + T + ' · Codex last reported it 2 minutes ago$').test(two.meters[0] && two.meters[0].line || ''), tag + ' the 5-hour line: figure, reset time, and when Codex reported it', JSON.stringify(two && two.meters[0] && two.meters[0].line));
      say(two && /^30% of its weekly limit used · resets (Mon|Tue|Wed|Thu|Fri|Sat|Sun) /.test(two.meters[1] && two.meters[1].line || ''), tag + ' the weekly line names its reset day', JSON.stringify(two && two.meters[1] && two.meters[1].line));
      say(r.day && /^10% of its 1-day limit used/.test(r.day.meters[0] && r.day.meters[0].line || ''), tag + ' a 1440-minute window is a 1-day limit', JSON.stringify(r.day && r.day.meters));
      say(r.warn && r.warn.warns.length === 1 && r.warn.warns[0] === 'Close to its 5-hour limit.' && !r.warn.move && !r.full.move, tag + ' at 82% it warns, with no move (no move control on a warning or full row)', JSON.stringify(r.warn && { warns: r.warn.warns, move: r.warn.move, fullMove: r.full && r.full.move }));
      say(r.full && r.full.warns.length === 1 && new RegExp('^At its weekly limit until (Mon|Tue|Wed|Thu|Fri|Sat|Sun) ' + T + '\\.$').test(r.full.warns[0]), tag + ' at 100% it says until when', JSON.stringify(r.full && r.full.warns));
      say(r.over && r.over.meters.length === 1 && /weekly/.test(r.over.meters[0].line), tag + ' a window whose reset has passed is not drawn', JSON.stringify(r.over && r.over.meters));
      say(r.none && r.none.meters.length === 0 && r.none.nones[0] === 'No current usage reading for this sign-in. Codex reports it while an agent on it is working.', tag + ' no report: said plainly', JSON.stringify(r.none));
      say(r.key && !r.key.usage, tag + ' an API-key row draws nothing (a key has no plan limits)', JSON.stringify(r.key));
      say(r.old && !r.old.usage, tag + ' an older board (no limits field) draws nothing', JSON.stringify(r.old));
      if (w === 390) say(!r.sideways, tag + ' nothing scrolls sideways');
      say(errs.length === 0, tag + ' no page errors', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  /* A list left open across a Codex window's reset is read again just after it, and that window's meter goes while the
     weekly one stays (the same timer as Claude's five-hour line). The page clock is installed so it can run forward. */
  {
    const browser = await pw.chromium.launch({ headless: process.env.HEADED === '0' });
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await page.clock.install({ time: new Date(now) });
    await page.goto('file://' + PAGE);
    const rows = [openai('soon', { limits: { windows: [win(70, 300, now + 10 * 60e3), win(30, 10080, now + 50 * H)], plan: 'plus', at: now - 60e3 } })];
    const before = await page.evaluate(async (accounts) => {
      window.__reads = 0;
      const realFetch = window.fetch;
      window.fetch = (u, o) => (String(u).indexOf('/api/accounts') !== -1 ? (window.__reads++, Promise.resolve({ ok: true, json: async () => ({ accounts }) })) : realFetch(u, o));
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
      return [...document.querySelectorAll('#set-accounts .acct-usage-codex')].map((m) => m.dataset.resets && m.querySelector('.acct-usage-line').textContent.trim().slice(0, 30));
    }, rows);
    await page.clock.runFor(11 * 60e3); await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ lines: [...document.querySelectorAll('#set-accounts .acct-usage-codex .acct-usage-line')].map((x) => x.textContent.trim().slice(0, 30)), reads: window.__reads }));
    say(before.length === 2 && before.every(Boolean) && after.reads === 2 && after.lines.length === 1 && /weekly/.test(after.lines[0]),
      '[chromium open] a Codex window past its reset on a list left open is read again and goes; the weekly one stays', JSON.stringify({ before, after }));
    // The reset passes while another Settings section is open (the list hidden): back on AI Models, the meter goes.
    const p2 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p2.clock.install({ time: new Date(now) });
    await p2.goto('file://' + PAGE);
    await p2.evaluate(async (accounts) => {
      window.__reads = 0;
      const realFetch = window.fetch;
      window.fetch = (u, o) => (String(u).indexOf('/api/accounts') !== -1 ? (window.__reads++, Promise.resolve({ ok: true, json: async () => ({ accounts }) })) : realFetch(u, o));
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
      settingsGo('you');
    }, rows);
    await p2.clock.runFor(12 * 60e3); await p2.waitForTimeout(200);
    const away = await p2.evaluate(() => window.__reads);
    await p2.evaluate(() => settingsGo('accounts'));
    await p2.clock.runFor(2e3); await p2.waitForTimeout(300);
    const back = await p2.evaluate(() => ({ lines: document.querySelectorAll('#set-accounts .acct-usage-codex').length, reads: window.__reads }));
    say(away === 1 && back.reads === 2 && back.lines === 1, '[chromium open] a Codex reset that passed in another section: back on AI Models it is read again and goes', JSON.stringify({ away, back }));
    await p2.close();
    // Only a weekly window (days out): a list left open is not read again every six hours for it.
    const p3 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p3.clock.install({ time: new Date(now) });
    await p3.goto('file://' + PAGE);
    await p3.evaluate(async (accounts) => {
      window.__reads = 0;
      const realFetch = window.fetch;
      window.fetch = (u, o) => (String(u).indexOf('/api/accounts') !== -1 ? (window.__reads++, Promise.resolve({ ok: true, json: async () => ({ accounts }) })) : realFetch(u, o));
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
    }, [openai('weekonly', { limits: { windows: [win(30, 10080, now + 50 * H)], plan: 'plus', at: now - 60e3 } })]);
    await p3.clock.runFor(7 * H); await p3.waitForTimeout(300);
    const week = await p3.evaluate(() => window.__reads);
    say(week === 1, '[chromium open] a weekly window alone arms no six-hourly read', 'reads=' + week);
    await p3.close();
    // A window resetting further out than six hours, on a list nobody touches, still goes at its reset (a wake timer arms
    // six hours before it, without reading), and nothing is read before then.
    const p4 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p4.clock.install({ time: new Date(now) });
    await p4.goto('file://' + PAGE);
    await p4.evaluate(async (accounts) => {
      window.__reads = 0;
      const realFetch = window.fetch;
      window.fetch = (u, o) => (String(u).indexOf('/api/accounts') !== -1 ? (window.__reads++, Promise.resolve({ ok: true, json: async () => ({ accounts }) })) : realFetch(u, o));
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
    }, [openai('dayonly', { limits: { windows: [win(40, 1440, now + 8 * H)], plan: 'plus', at: now - 60e3 } })]);
    await p4.clock.runFor(7 * H + 50 * 60e3); await p4.waitForTimeout(200);
    const early4 = await p4.evaluate(() => window.__reads);
    await p4.clock.runFor(15 * 60e3); await p4.waitForTimeout(300);
    const late4 = await p4.evaluate(() => ({ lines: document.querySelectorAll('#set-accounts .acct-usage-codex').length, reads: window.__reads }));
    say(early4 === 1 && late4.reads === 2 && late4.lines === 0, '[chromium open] a window more than six hours out still goes at its reset on an untouched list, with no read before', JSON.stringify({ early4, late4 }));
    await p4.close();
    // An OpenAI row that happened to carry a five-hour reading draws no five-hour line, so its reset must cost no read.
    const p5 = await browser.newPage({ viewport: { width: 1100, height: 900 }, locale: 'en-US' });
    await p5.clock.install({ time: new Date(now) });
    await p5.goto('file://' + PAGE);
    await p5.evaluate(async (accounts) => {
      window.__reads = 0;
      const realFetch = window.fetch;
      window.fetch = (u, o) => (String(u).indexOf('/api/accounts') !== -1 ? (window.__reads++, Promise.resolve({ ok: true, json: async () => ({ accounts }) })) : realFetch(u, o));
      const l = document.getElementById('set-accounts');
      for (let el = l; el && el !== document.body; el = el.parentElement) { if (el.hidden) el.hidden = false; if (getComputedStyle(el).display === 'none') el.style.display = 'block'; }
      await paintAccounts();
    }, [openai('stray', { limits: null, fiveHour: { usedPct: 50, resetsAt: now + 10 * 60e3, at: now - 60e3 } })]);
    await p5.clock.runFor(12 * 60e3); await p5.waitForTimeout(300);
    const r5 = await p5.evaluate(() => window.__reads);
    say(r5 === 1, '[chromium open] a five-hour reading on a row that does not draw one arms no read', 'reads=' + r5);
    await p5.close();
    await browser.close();
  }
  console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall good');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
