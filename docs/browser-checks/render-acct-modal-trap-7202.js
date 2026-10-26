// Browser-check-surface: acct-add-modal acct-add-dialog acct-add-note acct-provider-pick acct-claude-pick-sub stepup-ask stepup-words
'use strict';
/**
 * #7202: while the account dialog is open (Add a provider, and every Sign in again), Tab and
 * Shift+Tab stay inside it. Before this, the dialog had aria-modal and nothing else, so Tab walked
 * out of it onto the page behind.
 *
 * Hermetic: boots its own sandboxed board with one agent and no sign-in. Real key presses, both
 * directions, in Chromium AND WebKit (the Mac app is a WKWebView, whose default Tab skips buttons, so
 * a trap that acts only at the ends leaks between them there and not in Chromium). On two pages (the
 * board's Agents tab and an agent's own page), for each of the four openers (openAcctAdd,
 * openAcctReauth, openAcctReauthOpenai, openAcctReauthGrok). Per arm:
 *   - before opening, focus is on a page control outside the dialog (asserted, so the arm cannot pass
 *     with focus already inside);
 *   - one Tab goes INTO the dialog (Sign in again for OpenAI opens without moving focus);
 *   - from EVERY stop, Tab lands on the next stop and Shift+Tab on the one before (so a step between
 *     the ends is checked, not only the wrap);
 *   - Escape closes it.
 * Then, once per engine:
 *   - the Sign in again ask showing over the dialog: its buttons are stops after the dialog's, and every
 *     step through dialog and ask lands on the neighbour (the ask sits far from the dialog in the page);
 *   - a focused element that is not a stop and sits after the last stop: Tab from it wraps to the first
 *     stop, Shift+Tab from it goes to the last (a default step would leave the dialog either way);
 *   - the note (focusable, not a stop): Shift+Tab from it lands on the stop just before it.
 * Without the fix the per-stop arms read a page control (the control).
 *
 * Computed-state only, so headless is sound.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-acct-modal-trap-7202.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acct7202-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acct7202-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acct7202-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acct7202-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-acct7202-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_RELEASE_BASE = 'http://127.0.0.1:9/dist'; // never the real update server

const pw = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const ENGINES = ['chromium', 'webkit'];

const fail = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };

/* The Tab stops in page order, worked out here rather than read from the page's helper, so the check runs (and reds)
   on a page that has no trap at all: the dialog's shown, enabled controls, then the Sign in again ask's buttons when
   it shows. Installed on every page as window.__stops7202. */
const INSTALL = () => {
  window.__stops7202 = () => {
    const ok = (el) => el.tabIndex >= 0 && !el.disabled && !el.closest('[hidden]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const ask = document.getElementById('stepup-ask');
    return Array.from(document.getElementById('acct-add-dialog').querySelectorAll('button, [href], input, select, textarea, [tabindex]'))
      .concat(ask && !ask.hidden ? Array.from(ask.querySelectorAll('button')) : []).filter(ok);
  };
};
/* Where focus is: its index among the stops (-1 when it is not one), and a name for the message. */
const focusNow = (p) => p.evaluate(() => {
  const a = document.activeElement;
  return { at: window.__stops7202().indexOf(a), name: String((a && (a.id || a.className || a.tagName)) || '').slice(0, 50) };
});

const OPENERS = ['Add a provider', 'Sign in again (Claude)', 'Sign in again (OpenAI)', 'Sign in again (Grok)'];
const open = (p, i) => p.evaluate((n) => [() => openAcctAdd(),
  () => openAcctReauth('/nonexistent/acct-7202', 'someone@example.com'),
  () => openAcctReauthOpenai('/nonexistent/acct-7202', 'someone@example.com'),
  () => openAcctReauthGrok('/nonexistent/acct-7202', 'someone@example.com')][n](), i);
/* A page control outside the dialog takes focus; says whether it did. */
const focusPage = (p) => p.evaluate(() => {
  const modal = document.getElementById('acct-add-modal');
  const c = Array.from(document.querySelectorAll('button, [href]')).find((el) => !modal.contains(el) && el.tabIndex >= 0 && !el.disabled && el.getClientRects().length && !el.closest('[inert]'));
  if (c) c.focus();
  return !!c && document.activeElement === c;
});

/* Tab and Shift+Tab from every stop: each lands on its neighbour, wrapping. Returns the first miss, or null. */
async function walk(p) {
  const n = await p.evaluate(() => window.__stops7202().length);
  if (n < 2) return { why: 'fewer than two stops', n };
  for (let k = 0; k < n; k++) {
    for (const [key, step] of [['Tab', 1], ['Shift+Tab', -1]]) {
      await p.evaluate((j) => window.__stops7202()[j].focus(), k);
      await p.keyboard.press(key);
      const f = await focusNow(p);
      const want = (k + step + n) % n;
      if (f.at !== want) return { from: k, key, want, got: f.at, name: f.name, of: n };
    }
  }
  return null;
}

(async () => {
  fleet.install([fleet.agent('mara', { state: 'idle', displayName: 'Mara' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  try {
    const r = await fetch(URL + '/api/first-run/complete', { method: 'POST' });
    say(r.ok, 'first run is completed on the sandboxed board');
    for (const eng of ENGINES) {
      const browser = await pw[eng].launch({ headless: process.env.HEADED !== '1' });
      try {
        const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
        const errors = [];
        p.on('pageerror', (e) => errors.push(String(e.message)));
        await p.addInitScript(INSTALL);

        for (const [where, url, ready] of [
          ['the board', '/?tab=agents', null],
          ['an agent page', '/?tab=detail&agent=mara', '#panel-detail:not([hidden])'],
        ]) {
          await p.goto(URL + url, { waitUntil: 'load' });
          const up = await (ready ? p.waitForSelector(ready, { timeout: 15000 }) : p.waitForFunction(() => typeof openAcctAdd === 'function', null, { timeout: 15000 })).then(() => true, () => false);
          say(up, eng + ', ' + where + ': the page is showing');
          await p.waitForTimeout(500);

          for (let i = 0; i < OPENERS.length; i++) {
            const tag = eng + ', ' + where + ', ' + OPENERS[i];
            say(await focusPage(p), tag + ': before opening, focus is on a page control outside the dialog');
            await open(p, i);
            await p.waitForTimeout(400);
            say(await p.isVisible('#acct-add-modal'), tag + ': the dialog is open');
            // Whatever the opener did with focus, start from the page: the Tab that brings it in is the case under test.
            await focusPage(p);
            await p.keyboard.press('Tab');
            const f0 = await focusNow(p);
            say(f0.at !== -1, tag + ': one Tab from the page behind puts focus on a stop in the dialog', JSON.stringify(f0));

            const miss = await walk(p);
            say(!miss, tag + ': from every stop, Tab and Shift+Tab land on its neighbour in the dialog', miss ? JSON.stringify(miss) : '');

            await p.keyboard.press('Escape');
            await p.waitForTimeout(300);
            say(await p.isHidden('#acct-add-modal'), tag + ': Escape closes the dialog');
          }
        }

        /* The Sign in again ask showing over the open dialog. */
        await open(p, 0);
        await p.waitForTimeout(400);
        await p.evaluate(() => { document.getElementById('stepup-words').textContent = 'Sign in again to do that.'; document.getElementById('stepup-ask').hidden = false; });
        const askStops = await p.evaluate(() => window.__stops7202().filter((el) => el.closest('#stepup-ask')).length);
        say(askStops === 2, eng + ', the ask: its two buttons are stops while it shows', String(askStops));
        const missAsk = await walk(p);
        say(!missAsk, eng + ', the ask: from every stop, dialog and ask, Tab and Shift+Tab land on the neighbour', missAsk ? JSON.stringify(missAsk) : '');
        await p.evaluate(() => { document.getElementById('stepup-ask').hidden = true; });

        /* A focused element that is not a stop, after the last stop. */
        const placed = await p.evaluate(() => {
          const x = document.createElement('p');
          x.id = 'trap7202-tail'; x.tabIndex = -1; x.textContent = 'tail';
          document.getElementById('acct-add-dialog').appendChild(x);
          x.focus();
          return document.activeElement === x;
        });
        say(placed, eng + ', a non-stop after the last stop: focus is on it before the key press');
        await p.keyboard.press('Tab');
        const ft = await focusNow(p);
        say(ft.at === 0, eng + ', a non-stop after the last stop: Tab wraps to the first stop', JSON.stringify(ft));
        await p.evaluate(() => document.getElementById('trap7202-tail').focus());
        await p.keyboard.press('Shift+Tab');
        const fb = await focusNow(p);
        const nStops = await p.evaluate(() => window.__stops7202().length);
        say(fb.at === nStops - 1, eng + ', a non-stop after the last stop: Shift+Tab goes to the last stop', JSON.stringify(fb));
        await p.evaluate(() => document.getElementById('trap7202-tail').remove());

        /* The note: focusable, not a stop. It sits in Claude's sign-in step. */
        await p.selectOption('#acct-provider-pick', 'claude');
        await p.waitForTimeout(200);
        if (await p.isVisible('#acct-claude-pick-sub').catch(() => false)) { await p.click('#acct-claude-pick-sub'); await p.waitForTimeout(200); }
        const noted = await p.evaluate(() => {
          const n = document.getElementById('acct-add-note');
          n.textContent = 'That sign-in did not finish.';
          n.focus();
          const before = window.__stops7202().filter((el) => el.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING);
          return { on: document.activeElement === n, want: before.length - 1 };
        });
        say(noted.on && noted.want >= 0, eng + ', the note: focus is on it, with a stop before it', JSON.stringify(noted));
        await p.keyboard.press('Shift+Tab');
        const fn = await focusNow(p);
        say(fn.at === noted.want, eng + ', the note: Shift+Tab from it lands on the stop just before it', JSON.stringify(fn));
        await p.keyboard.press('Escape');

        say(errors.length === 0, eng + ': no page errors', errors.join(' | '));
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
    for (const d of [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
  console.log(fail.length ? `render-acct-modal-trap-7202: ${fail.length} FAILED` : 'render-acct-modal-trap-7202: 0 FAILED');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-acct-modal-trap-7202: ' + (e && e.stack || e)); process.exit(2); });
