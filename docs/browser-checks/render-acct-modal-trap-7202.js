// Browser-check-surface: acct-add-modal acct-add-dialog acct-add-note acct-provider-pick acct-claude-pick-sub
'use strict';
/**
 * #7202: while the account dialog is open (Add a provider, and every Sign in again), Tab and
 * Shift+Tab stay inside it. Before this, the dialog had aria-modal and nothing else, so Tab walked
 * out of its last control onto the page behind it.
 *
 * Hermetic: boots its own sandboxed board with one agent and no sign-in. Real key presses, both
 * directions, on two pages (the board's Agents tab and an agent's own page), for each of the four
 * openers (openAcctAdd, openAcctReauth, openAcctReauthOpenai, openAcctReauthGrok). Per arm:
 *   - before opening, focus is on a page control outside the dialog (asserted, so the arm cannot pass
 *     with focus already inside);
 *   - one Tab goes INTO the dialog (Sign in again for OpenAI opens without moving focus);
 *   - from the last stop, Tab lands inside; from the first, Shift+Tab lands inside;
 *   - thirty presses each way never leave it;
 *   - Escape closes it.
 * A last arm puts focus on the note (focusable, not a stop, the place a failed start sends focus)
 * and asserts Tab from there stays inside too.
 * Without the fix, "Tab from the last stop" reads a page control on every arm (the control).
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

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };

/* Where focus is: its id or tag, and whether it is inside the dialog (or the Sign in again ask, the one
   stop outside it the trap allows). */
const focusNow = (p) => p.evaluate(() => {
  const a = document.activeElement;
  const dlg = document.getElementById('acct-add-dialog');
  const ask = document.getElementById('stepup-ask');
  const name = (a && (a.id || a.className || a.tagName)) || '';
  return { name: String(name).slice(0, 60), inside: !!(a && ((dlg && dlg.contains(a)) || (ask && !ask.hidden && ask.contains(a)))) };
});

/* The dialog's own Tab stops, worked out here rather than read from the page's helper, so the check runs (and reds)
   on a page that has no trap at all. */
const STOPS = "const stops = () => Array.from(document.getElementById('acct-add-dialog').querySelectorAll('button, [href], input, select, textarea, [tabindex]'))"
  + ".filter((el) => el.tabIndex >= 0 && !el.disabled && !el.closest('[hidden]') && el.getClientRects().length);\n";

const OPENERS = ['Add a provider', 'Sign in again (Claude)', 'Sign in again (OpenAI)', 'Sign in again (Grok)'];

(async () => {
  fleet.install([fleet.agent('mara', { state: 'idle', displayName: 'Mara' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  try {
    const r = await fetch(URL + '/api/first-run/complete', { method: 'POST' });
    say(r.ok, 'first run is completed on the sandboxed board');
    const p = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e.message)));

    for (const [where, url, ready] of [
      ['the board', '/?tab=agents', null],
      ['an agent page', '/?tab=detail&agent=mara', '#panel-detail:not([hidden])'],
    ]) {
      await p.goto(URL + url, { waitUntil: 'load' });
      const up = await (ready ? p.waitForSelector(ready, { timeout: 15000 }) : p.waitForFunction(() => typeof openAcctAdd === 'function', null, { timeout: 15000 })).then(() => true, () => false);
      say(up, where + ': the page is showing');
      await p.waitForTimeout(500);

      for (let i = 0; i < OPENERS.length; i++) {
        const who = OPENERS[i];
        const tag = where + ', ' + who;
        /* A page control outside the dialog holds focus first. */
        const outside = await p.evaluate(() => {
          const modal = document.getElementById('acct-add-modal');
          const c = Array.from(document.querySelectorAll('button, [href]')).find((el) => !modal.contains(el) && el.tabIndex >= 0 && !el.disabled && el.getClientRects().length && !el.closest('[inert]'));
          if (c) c.focus();
          return !!c && document.activeElement === c;
        });
        say(outside, tag + ': before opening, focus is on a page control outside the dialog');
        await p.evaluate((n) => [() => openAcctAdd(),
          () => openAcctReauth('/nonexistent/acct-7202', 'someone@example.com'),
          () => openAcctReauthOpenai('/nonexistent/acct-7202', 'someone@example.com'),
          () => openAcctReauthGrok('/nonexistent/acct-7202', 'someone@example.com')][n](), i);
        await p.waitForTimeout(400);
        say(await p.isVisible('#acct-add-modal'), tag + ': the dialog is open');

        await p.keyboard.press('Tab');
        const f0 = await focusNow(p);
        say(f0.inside, tag + ': one Tab puts focus inside the dialog', JSON.stringify(f0));

        await p.evaluate(STOPS + 'const s = stops(); s[s.length - 1].focus();');
        await p.keyboard.press('Tab');
        const f1 = await focusNow(p);
        say(f1.inside, tag + ': Tab from the last control stays inside', JSON.stringify(f1));

        await p.evaluate(STOPS + 'stops()[0].focus();');
        await p.keyboard.press('Shift+Tab');
        const f2 = await focusNow(p);
        say(f2.inside, tag + ': Shift+Tab from the first control stays inside', JSON.stringify(f2));

        let leakF = null;
        let leakB = null;
        for (let k = 0; k < 30 && !leakF; k++) { await p.keyboard.press('Tab'); const f = await focusNow(p); if (!f.inside) leakF = f; }
        for (let k = 0; k < 30 && !leakB; k++) { await p.keyboard.press('Shift+Tab'); const f = await focusNow(p); if (!f.inside) leakB = f; }
        say(!leakF, tag + ': thirty Tabs never leave the dialog', leakF ? JSON.stringify(leakF) : '');
        say(!leakB, tag + ': thirty Shift+Tabs never leave the dialog', leakB ? JSON.stringify(leakB) : '');

        await p.keyboard.press('Escape');
        await p.waitForTimeout(300);
        say(await p.isHidden('#acct-add-modal'), tag + ': Escape closes the dialog');
      }
    }

    /* The note: focusable (a failed start sends focus there), not a Tab stop, and the last thing in the form. */
    await p.evaluate(() => openAcctAdd());
    await p.waitForTimeout(400);
    await p.selectOption('#acct-provider-pick', 'claude');   // the note sits in Claude's sign-in step
    await p.waitForTimeout(200);
    if (await p.isVisible('#acct-claude-pick-sub').catch(() => false)) { await p.click('#acct-claude-pick-sub'); await p.waitForTimeout(200); }
    const noted = await p.evaluate(() => {
      const n = document.getElementById('acct-add-note');
      n.textContent = 'That sign-in did not finish.';
      if (!n.hasAttribute('tabindex')) n.setAttribute('tabindex', '-1');
      n.focus();
      return document.activeElement === n;
    });
    say(noted, 'the note: focus is on it before the key press');
    await p.keyboard.press('Tab');
    const fn = await focusNow(p);
    say(fn.inside, 'the note: Tab from it stays inside', JSON.stringify(fn));
    await p.keyboard.press('Escape');

    say(errors.length === 0, 'no page errors', errors.join(' | '));
  } finally {
    await browser.close();
    server.close();
    for (const d of [SANDBOX, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
  console.log(fail.length ? `render-acct-modal-trap-7202: ${fail.length} FAILED` : 'render-acct-modal-trap-7202: 0 FAILED');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-acct-modal-trap-7202: ' + (e && e.stack || e)); process.exit(2); });
