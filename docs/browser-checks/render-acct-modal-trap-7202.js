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
    return Array.from(document.getElementById('acct-add-dialog').querySelectorAll('button, [href], input, select, textarea, summary, [contenteditable]:not([contenteditable="false"]), [tabindex]'))
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

/* Choose a provider the way a person does: the picker's visible button, then its option (the native select under it
   is a hidden source). */
async function pickProvider(p, value) {
  await p.click('#acct-provider-field .pcombo-trigger');
  await p.waitForTimeout(150);
  await p.click('#acct-provider-field .pcombo-opt[data-value="' + value + '"]');
  await p.waitForTimeout(250);
}

/* Tab and Shift+Tab from every stop: each lands on its neighbour, wrapping. Returns the first miss, or null. */
async function walk(p) {
  const n = await p.evaluate(() => window.__stops7202().length);
  if (!n) return { why: 'no stops' };
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
        await pickProvider(p, 'claude');
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

        /* Steps with text fields, where WebKit's default Tab would leave for a field behind the dialog: the OpenAI key
           step and the Grok key step, each walked from every stop, the password field included. */
        for (const [prov, keyBtn, field] of [['openai', '#acct-openai-pick-key', '#acct-openai-key'], ['xai', '#acct-grok-pick-key', '#acct-apikey-key']]) {
          await open(p, 0);
          await p.waitForTimeout(400);
          await pickProvider(p, prov);
          if (await p.isVisible(keyBtn).catch(() => false)) { await p.click(keyBtn); await p.waitForTimeout(250); }
          const hasField = await p.evaluate((sel) => { const f = document.querySelector(sel); return !!f && window.__stops7202().includes(f); }, field);
          say(hasField, eng + ', the ' + prov + ' key step: its key field is a stop');
          const missK = await walk(p);
          say(!missK, eng + ', the ' + prov + ' key step: from every stop, the field included, Tab and Shift+Tab land on the neighbour', missK ? JSON.stringify(missK) : '');
          /* A key typed, Tab away, Shift+Tab back: its text is selected, as a native Tab leaves it, so typing replaces it. */
          await p.fill(field, 'sk-mistyped-7202');
          await p.focus(field);
          await p.evaluate((sel) => { const f = document.querySelector(sel); f.setSelectionRange(3, 3); }, field);
          await p.keyboard.press('Tab');
          await p.keyboard.press('Shift+Tab');
          const selK = await p.evaluate((sel) => { const f = document.querySelector(sel); return { on: document.activeElement === f, start: f.selectionStart, end: f.selectionEnd, len: f.value.length }; }, field);
          say(selK.on && selK.start === 0 && selK.end === selK.len, eng + ', the ' + prov + ' key step: Shift+Tab back into the key selects it', JSON.stringify(selK));
          await p.keyboard.press('Escape');
          await p.waitForTimeout(300);
        }

        /* The two stand-downs a real key press cannot reach: an input method composing, and the dialog made inert by
           a screen over it. A key event is sent to the focused stop and its defaultPrevented read: the trap must not
           take it. A plain Tab sent the same way is the control (the trap takes it). */
        await open(p, 0);
        await p.waitForTimeout(400);
        const taken = await p.evaluate(() => {
          const send = (init) => { const s = window.__stops7202(); s[0].focus(); const ev = new KeyboardEvent('keydown', Object.assign({ key: 'Tab', bubbles: true, cancelable: true }, init)); s[0].dispatchEvent(ev); return ev.defaultPrevented; };
          const plain = send({});
          const composing = send({ isComposing: true });
          const modal = document.getElementById('acct-add-modal');
          modal.inert = true;
          const inert = send({});
          modal.inert = false;
          return { plain, composing, inert };
        });
        say(taken.plain === true, eng + ', the control: a plain Tab sent to a stop is taken by the trap', JSON.stringify(taken));
        say(taken.composing === false, eng + ', composing: a Tab while an input method composes is left alone', JSON.stringify(taken));
        say(taken.inert === false, eng + ', inert: a Tab while the dialog is inert under another screen is left alone', JSON.stringify(taken));
        await p.keyboard.press('Escape');
        await p.waitForTimeout(300);

        /* Option+Tab is how WebKit moves between buttons: it must not walk out either. From the last stop, forward. */
        await open(p, 0);
        await p.waitForTimeout(400);
        const nOpt = await p.evaluate(() => { const s = window.__stops7202(); s[s.length - 1].focus(); return s.length; });
        await p.keyboard.press('Alt+Tab');
        const fo = await focusNow(p);
        say(fo.at === 0, eng + ', Option+Tab: from the last stop it wraps to the first', JSON.stringify(fo));
        await p.evaluate(() => window.__stops7202()[0].focus());
        await p.keyboard.press('Alt+Shift+Tab');
        const fob = await focusNow(p);
        say(fob.at === nOpt - 1, eng + ', Option+Shift+Tab: from the first stop it wraps to the last', JSON.stringify(fob));

        /* The provider picker's list open: Tab closes it (the picker's own handler) and moves on to the next stop. */
        const trig = await p.evaluate(() => { const s = window.__stops7202(); const t = document.querySelector('#acct-provider-field .pcombo-trigger'); if (t) t.focus(); return t ? s.indexOf(t) : -2; });
        say(trig >= 0, eng + ', the picker: its trigger is a stop', String(trig));
        await p.keyboard.press('ArrowDown');
        await p.waitForTimeout(150);
        const listOpen = await p.evaluate(() => { const l = document.querySelector('#acct-provider-field .pcombo-list'); return !!(l && !l.hidden && l.getClientRects().length); });
        say(listOpen, eng + ', the picker: ArrowDown opens its list');
        await p.keyboard.press('Tab');
        const fp = await focusNow(p);
        const listShut = await p.evaluate(() => { const l = document.querySelector('#acct-provider-field .pcombo-list'); return !(l && !l.hidden && l.getClientRects().length); });
        say(listShut && fp.at === (trig + 1) % nOpt, eng + ', the picker: Tab with its list open closes it and lands on the next stop', JSON.stringify({ listShut, fp, want: (trig + 1) % nOpt }));

        /* A radio group is one stop, as the browser tabs it (none in the dialog today; one is put in to see the rule). */
        await p.evaluate(() => {
          const g = document.createElement('div'); g.id = 'trap7202-radios';
          g.innerHTML = '<label><input type="radio" name="trap7202" value="a">a</label><label><input type="radio" name="trap7202" value="b" checked>b</label><label><input type="radio" name="trap7202" value="c">c</label><button type="button" id="trap7202-after">after</button>';
          document.getElementById('acct-add-dialog').appendChild(g);
          document.querySelector('#trap7202-radios input[value="b"]').focus();
        });
        await p.keyboard.press('Tab');
        const fr = await p.evaluate(() => (document.activeElement && (document.activeElement.id || document.activeElement.value)) || '');
        say(fr === 'trap7202-after', eng + ', a radio group: Tab from its checked radio leaves the group', fr);
        await p.keyboard.press('Shift+Tab');
        const fr2 = await p.evaluate(() => (document.activeElement && (document.activeElement.id || document.activeElement.value)) || '');
        say(fr2 === 'b', eng + ', a radio group: Shift+Tab back lands on the checked radio, not the last of the group', fr2);
        await p.evaluate(() => document.getElementById('trap7202-radios').remove());

        /* Another dialog shown over this one: Tab is left to it. This runs on the first step, which has no text field;
           on a step with one, WebKit's default Tab from the other dialog's middle button would reach that field (the
           other dialog's own trap acts only at its ends), which is that dialog's to fix, not this one's. */
        await p.evaluate(() => { document.getElementById('updconfirm').hidden = false; document.getElementById('uc-no').focus(); });
        await p.keyboard.press('Tab');
        // Where that dialog's own trap sends focus is its business (in WebKit it acts only at its last button); what this
        // one owes is to stay out of it, never pulling focus back into the account dialog underneath.
        const fu = await p.evaluate(() => { const a = document.activeElement; return { id: (a && a.id) || '', inAcct: !!(a && document.getElementById('acct-add-dialog').contains(a)) }; });
        say(!fu.inAcct, eng + ', another dialog over it: Tab is left to that dialog, never pulled back into this one', JSON.stringify(fu));
        await p.evaluate(() => { document.getElementById('updconfirm').hidden = true; });

        /* The success view: one stop. Tab and Shift+Tab stay on it. */
        await p.evaluate(() => acctShowSuccess('someone@example.com'));
        await p.waitForTimeout(200);
        const nS = await p.evaluate(() => window.__stops7202().length);
        const missS = await walk(p);
        say(nS === 1 && !missS, eng + ', the success view: its one stop keeps Tab and Shift+Tab', JSON.stringify({ nS, missS }));
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
