// Browser-check-surface: set-other-wrap set-other set-other-note s-sec-accounts
'use strict';

/**
 * kosmos#6178: Settings > AI Models shows the accounts on the person's OTHER computers, read by this browser from each
 * one through the #4812 sibling read (each computer's own /api/status, now carrying accountsWeekly).
 *
 * Harness: #4812's. The real board, with the PAGE served at https://laptop.kosmosplus.com (Playwright answers that
 * origin from the board on loopback), because other computers can be read only from this computer's own Kosmos+
 * address. The other computers are Playwright routes:
 *   studio  answers /api/status with two Claude accounts (one at 82%, one with no reading) and an agent on each
 *   workshop  answers 401 (its gate: this browser is not let in there)
 *   oldmac   answers 200 with agents but no accountsWeekly (a Kosmos from before #6178)
 * The routes add the CORS pair themselves, so this proves the page's side only; the relay's own tests cover its answer.
 *
 * Claims, each able to fail:
 *   S1 one group per other computer, in the account list's order, this computer left out;
 *   S1 studio: each account by its email, the 82% meter drawn at 82% with the row's own sentence, the no-reading
 *      account with the row's own reason, each account's agents there by display name, the guide left out, no Move;
 *   S1 workshop says this browser is not let in; oldmac says it has an older Kosmos;
 *   S1 another computer's text is shown as text (a hostile email and agent name), never markup;
 *   S2 CONTROL studio answers its gate on the next read: its accounts are DROPPED, not kept;
 *   N  the way a person gets there: Settings on Your profile, then a click on AI Models in the Settings menu, with no
 *      DOM forced open (settingsGo's own call reads the other computers);
 *   A  CONTROL the Mac's own window (http://127.0.0.1): no computers listed and not one request to another computer;
 *   P  at 390 px nothing scrolls sideways.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-otheraccounts-6178.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ao-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium, webkit } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
let pass = 0;
function chkAll(ok, label, extra) {
  if (ok) { pass++; console.log('PASS  ' + label + (extra ? '  ' + extra : '')); }
  else { fail.push(label); console.log('FAIL  ' + label + (extra ? '  --  ' + extra : '')); }
}
const HOME = 'https://laptop.kosmosplus.com';
const NOW = Math.floor(Date.now() / 1000);
const COMPUTERS = {
  ok: true,
  domain: 'kosmosplus.com',
  computers: [
    { name: 'laptop', address: 'laptop.kosmosplus.com', this: true, online: true, updating: false, lastSeen: NOW },
    { name: 'studio', address: 'studio.kosmosplus.com', this: false, online: true, updating: false, lastSeen: NOW },
    { name: 'workshop', address: 'workshop.kosmosplus.com', this: false, online: true, updating: false, lastSeen: NOW },
    { name: 'oldmac', address: 'oldmac.kosmosplus.com', this: false, online: true, updating: false, lastSeen: NOW },
  ],
};
const HOSTILE = '<img src=x onerror="window.__aoPwned=1">';
const SIBLING = {
  agents: [
    { sessionName: 'angel', name: 'Angel', state: 'working', runner: 'claude', acct: 'a0', tied: true },
    { sessionName: 'evil', name: HOSTILE, state: 'idle', runner: 'claude', acct: 'a1', tied: true },
    { sessionName: 'guide', name: 'Guide', isGuide: true, acct: 'a0', tied: true },
  ],
  accountsWeekly: [
    { key: 'a0', email: 'person@example.com', isDefault: true, weekly: { usedPct: 82, resetsAt: Date.now() + 3 * 864e5, at: Date.now() - 3600e3 }, blocked: null },
    { key: 'a1', email: HOSTILE, weekly: null, blocked: 'not-wired' },
  ],
};
const OLD = { agents: [{ sessionName: 'bo', name: 'Bo', state: 'idle' }] };
const cors = { 'access-control-allow-origin': HOME, 'access-control-allow-credentials': 'true', vary: 'Origin', 'content-type': 'application/json' };

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' })]);
  const server = await srv.start(0);
  const port = server.address().port;
  for (const [ENGINE, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await engine.launch({ headless: process.env.HEADED === '0' });
    const elsewhere = [];
    let studioMode = 'ok';
    const chk = (ok, label, extra) => chkAll(ok, ENGINE + ' ' + label, extra);
    const fresh = async (opts) => {
      const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }, opts || {}));
      await ctx.route('https://laptop.kosmosplus.com/**', async (route) => {
        try {
          const u = new URL(route.request().url());
          if (u.pathname === '/api/remote/computers') return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COMPUTERS) });
          const resp = await route.fetch({ url: 'http://127.0.0.1:' + port + u.pathname + u.search });
          return await route.fulfill({ response: resp });
        } catch { await route.abort().catch(() => {}); }
      });
      await ctx.route('**/api/first-run', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ done: true }) }));
      await ctx.route('https://studio.kosmosplus.com/**', (route) => {
        elsewhere.push(route.request().url());
        if (studioMode === 'gate') return route.fulfill({ status: 401, headers: cors, body: JSON.stringify({ error: 'not signed in' }) });
        return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(SIBLING) });
      });
      await ctx.route('https://workshop.kosmosplus.com/**', (route) => { elsewhere.push(route.request().url()); return route.fulfill({ status: 401, headers: cors, body: '{}' }); });
      await ctx.route('https://oldmac.kosmosplus.com/**', (route) => { elsewhere.push(route.request().url()); return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(OLD) }); });
      const page = await ctx.newPage();
      return { ctx, page };
    };
    const settle = async (page) => { if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); } };
    /* Show AI Models IN PLACE inside the real Settings panel (as render-account-usage-6108 does), then paint. */
    const openModels = (page) => page.evaluate(() => {
      const sec = document.getElementById('s-sec-accounts');
      for (let el = sec; el && el !== document.body; el = el.parentElement) {
        if (el.hidden) el.hidden = false;
        if (getComputedStyle(el).display === 'none') el.style.display = 'block';
      }
      const panel = sec.closest('.panel');
      for (const other of document.querySelectorAll('.panel')) if (other !== panel && !other.contains(panel)) other.style.display = 'none';
      aoKick();
    });
    const read = (page) => page.evaluate(() => {
      const wrap = document.getElementById('set-other-wrap');
      const groups = [...document.querySelectorAll('#set-other .ao-computer')].map((g) => ({
        name: (g.querySelector('.ao-name') || {}).textContent || '',
        note: [...g.querySelectorAll('.ao-note')].map((n) => n.textContent).join(' | '),
        accts: [...g.querySelectorAll('.ao-acct')].map((a) => ({
          who: (a.querySelector('.ao-acct-name') || {}).textContent,
          usage: [...a.querySelectorAll('.acct-usage-line')].map((n) => n.textContent).join(' | '),
          width: (a.querySelector('.acct-usage-meter .bar i') || { style: {} }).style.width || null,
          agents: (a.querySelector('.acct-agents-line') || {}).textContent,
        })),
        buttons: g.querySelectorAll('button, select').length,
      }));
      return { shown: !!wrap && !wrap.hidden, note: document.getElementById('set-other-note').textContent, groups,
        pwned: !!window.__aoPwned, imgs: document.querySelectorAll('#set-other img').length,
        sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
    });
    const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20000 }).then(() => true, () => false);
    try {
      for (const [w, h] of [[1280, 900], [390, 844]]) {
        const { ctx, page } = await fresh({ viewport: { width: w, height: h } });
        const tag = w === 390 ? ' (390)' : '';
        await page.goto(HOME + '/', { waitUntil: 'networkidle' });
        await settle(page);
        await openModels(page);
        const landed = await until(page, () => document.querySelectorAll('#set-other .ao-acct').length >= 2
          && /older Kosmos/.test(document.getElementById('set-other').textContent)
          && /not let in/.test(document.getElementById('set-other').textContent));
        const r = await read(page);
        chk(landed && r.shown, 'S1 the section shows under this computer\'s accounts' + tag, JSON.stringify(r).slice(0, 220));
        chk(JSON.stringify(r.groups.map((g) => g.name)) === JSON.stringify(['studio', 'workshop', 'oldmac']), 'S1 one group per OTHER computer' + tag, r.groups.map((g) => g.name).join(','));
        const a = r.groups[0] || { accts: [] };
        const main = a.accts[0] || {}, work = a.accts[1] || {};
        chk(main.who === 'person@example.com' && main.width === '82%' && /^82% of its weekly limit used · resets .+ · Kosmos last saw it change /.test(main.usage),
          'S1 an 82% account: its email, the meter at 82%, the row\'s own sentence' + tag, JSON.stringify(main));
        chk(main.agents === 'Its agents on studio: Angel', 'S1 its agents there by display name, the guide left out' + tag, main.agents);
        chk(work.usage === 'Kosmos is not set up to read usage for this account.' && work.width === null, 'S1 an account with no reading: the row\'s own reason, no meter' + tag, JSON.stringify(work));
        chk(work.who === HOSTILE && work.agents === 'Its agents on studio: ' + HOSTILE && !r.pwned && r.imgs === 0, 'S1 another computer\'s text is text, never markup' + tag, JSON.stringify({ who: work.who, pwned: r.pwned, imgs: r.imgs }));
        chk(r.groups.every((g) => g.buttons === 0), 'S1 no Move or any control for another computer\'s accounts' + tag);
        chk(/not let in on workshop/.test((r.groups[1] || {}).note || ''), 'S1 workshop: this browser is not let in' + tag, (r.groups[1] || {}).note);
        chk(/oldmac has an older Kosmos/.test((r.groups[2] || {}).note || '') && !(r.groups[2] || { accts: [1] }).accts.length, 'S1 oldmac: an older Kosmos, no accounts guessed' + tag, JSON.stringify(r.groups[2]));
        chk(!r.sideways, 'P nothing scrolls sideways' + tag);
        if (w === 1280) {
          studioMode = 'gate';
          await page.evaluate(() => oaRound(true));   // true: a round already running reads once more
          const dropped = await until(page, () => {
            const g = document.querySelector('#set-other .ao-computer');
            return g && g.querySelectorAll('.ao-acct').length === 0 && /not let in on studio/.test(g.textContent);
          });
          chk(dropped, 'S2 CONTROL studio answers its gate: its accounts are dropped, not kept', JSON.stringify((await read(page)).groups[0]).slice(0, 200));
          studioMode = 'ok';
        }
        await ctx.close();
      }
      // N: arriving by the Settings menu, as a person does. Nothing is forced open; settingsGo('accounts') must read.
      {
        const { ctx, page } = await fresh();
        await page.goto(HOME + '/?tab=settings&sec=you', { waitUntil: 'networkidle' });
        await settle(page);
        await page.waitForSelector('#s-nav button[data-go="accounts"]', { state: 'visible', timeout: 10000 });
        await page.click('#s-nav button[data-go="accounts"]');
        const came = await until(page, () => document.querySelectorAll('#set-other .ao-acct').length >= 2
          && !document.getElementById('s-sec-accounts').closest('[hidden]'));
        chk(came, 'N the Settings menu\'s AI Models shows the other computers\' accounts, nothing forced', JSON.stringify((await read(page)).groups.map((g) => g.name)));
        await ctx.close();
      }
      // CONTROL A: the Mac's own window. Nothing is read from another computer, and no computer is listed.
      {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
        await ctx.route('**/api/first-run', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ done: true }) }));
        await ctx.route('https://*.kosmosplus.com/**', (route) => { elsewhere.push(route.request().url()); return route.abort(); });
        const page = await ctx.newPage();
        const before = elsewhere.length;
        await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'networkidle' });
        await settle(page);
        await openModels(page);
        await page.waitForTimeout(1500);
        const r = await read(page);
        chk(r.groups.length === 0 && elsewhere.length === before, 'A CONTROL the Mac\'s own window lists no other computer and asks none', JSON.stringify({ groups: r.groups.length, asked: elsewhere.slice(before) }));
        await ctx.close();
      }
    } catch (e) {
      chk(false, 'the check ran to the end', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : String(e));
    } finally {
      await browser.close();
    }
  }
  server.close();
  fleet.restore();
  for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  console.log('\n' + pass + ' passed, ' + fail.length + ' failed');
  process.exit(fail.length ? 1 : 0);
})();
