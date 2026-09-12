// Browser-check-surface: d-account-msg
'use strict';

/**
 * kosmos#2811: a DEFAULT-account Codex agent's detail panel must not say
 * "We cannot tell which account this one uses".
 *
 * 🛑 WHY THIS EXISTS. #2811's `accountForAgent` provider gate is GLOBAL, not
 * whoami-local: the board route resolves every card's account against the CLAUDE
 * list, and the gate now refuses to hand a codex agent a Claude row. So a
 * default-account codex agent arrives here with `account === null` and lands on
 * `paintAccountPicker`'s `!ours` branch. That branch's sentence is FALSE about it:
 * the null means "no CLAUDE account", not "we cannot tell", and `server.js`'s
 * account-status route says exactly that about the identical wording it used to
 * carry. Saying it here would be the card's own defect one surface over.
 *
 * ⚠️ WHY A BROWSER. The source can be read to say the branch splits on the runner;
 * only a render proves the sentence a person actually sees. That is the #1720 gap
 * this directory exists to close.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-codex-account-picker-2811.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-codex-account-picker-2811: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const CLAUDE_ROWS = [{ dir: '/Users/x/.claude', email: 'josh@example.com', label: null, isDefault: true }];

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-codex-account-picker-2811: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  /* 🛑 ONE PAGE LOAD PER ARM, AND THE REASON IS A REAL COUPLING THIS CHECK FOUND.
     `paintAccountPicker` writes 'Checking…', then awaits a SHARED in-flight
     `ACCT_PICKER_FETCH` under an `ACCT_PICKER_EPOCH` guard: a second call bumps the
     epoch so the FIRST agent's continuation aborts rather than painting its sentence
     onto the second agent's panel (the switch-time clobber that guard exists for).
     Driving both arms in one page therefore left the first arm reading 'Checking…' -
     the guard working correctly, and my probe measuring the wrong moment. */
  const drive = async (card) => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto('file://' + PAGE);
    const out = await page.evaluate(async ({ accounts, card: c }) => {
      const realFetch = window.fetch;
      window.fetch = (u, opts) => (String(u).indexOf('/api/accounts') !== -1
        ? Promise.resolve({ ok: true, json: async () => ({ accounts }) })
        : realFetch(u, opts));
      if (typeof paintAccountPicker !== 'function') return { error: 'paintAccountPicker is not a function' };
      const msg = document.getElementById('d-account-msg');
      const sel = document.getElementById('d-account');
      if (!msg || !sel) return { error: 'the picker elements are not in the page (d-account-msg / d-account)' };
      msg.textContent = '';
      /* 🔑 `CURRENT` MUST BE THE OPEN AGENT, and this is not fixture decoration.
         Past the awaited fetch the function does
         `if (!CURRENT || CURRENT.sessionName !== forAgent) return;` -- the guard that
         stops a stale continuation painting onto a panel the person has since
         switched away from. With CURRENT unset it returns BEFORE clearing
         'Checking…', so the sentence never paints and this check read the
         placeholder. In the real flow the panel is open for this agent, which is
         exactly what this line reproduces. */
      CURRENT = c;
      await paintAccountPicker(c);
      /* The sentence is written by a continuation past the awaited fetch, so settle
         rather than read immediately. A timeout returns 'Checking…', which the
         assertions below treat as a failure rather than silently passing. */
      for (let i = 0; i < 100 && (msg.textContent || '').trim() === 'Checking…'; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      return { text: (msg.textContent || '').trim() };
    }, { accounts: CLAUDE_ROWS, card });
    await page.close();
    return out;
  };

  // The subject: a default-account codex agent, which #2811 resolves to null.
  const codexR = await drive({ sessionName: 'gpt1', isNamedOurs: true, runner: 'codex', account: null });
  // CONTROL: identical card, claude runner. If this does NOT produce the old
  // sentence, the branch was not reached and the codex result proves nothing.
  const claudeR = await drive({ sessionName: 'cl1', isNamedOurs: true, runner: 'claude', account: null });
  const r = { error: codexR.error || claudeR.error, codex: codexR.text, claude: claudeR.text };

  await browser.close();

  const problems = [];
  if (r.error) problems.push(r.error);
  else {
    // POPULATION FLOOR / CONTROL first: the claude arm must reach the branch.
    if (!/We cannot tell which account this one uses/.test(r.claude)) {
      problems.push('CONTROL FAILED: a claude agent with no account did not produce the "cannot tell" sentence, '
        + 'so the !ours branch was not reached and the codex assertion below proves nothing. got: ' + JSON.stringify(r.claude));
    }
    if (/We cannot tell which account this one uses/.test(r.codex)) {
      problems.push('a DEFAULT-account CODEX agent is told "we cannot tell which account this one uses", '
        + 'which is false: the null means no CLAUDE account. got: ' + JSON.stringify(r.codex));
    }
    if (!/Codex agent/.test(r.codex)) {
      problems.push('the codex sentence no longer names Codex, so the panel says nothing true about this agent class. got: '
        + JSON.stringify(r.codex));
    }
    if (!/cannot be moved from here/.test(r.codex)) {
      problems.push('the codex sentence dropped the "cannot be moved" clause, which is still true (movable is the Claude list). got: '
        + JSON.stringify(r.codex));
    }
  }

  if (problems.length) {
    console.error('FAIL  render-codex-account-picker-2811');
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
  console.log('PASS  render-codex-account-picker-2811: a default-account Codex agent is told it is a Codex agent, not that we cannot tell');
})().catch((err) => { console.error('FAIL  render-codex-account-picker-2811: ' + ((err && err.message) || err)); process.exit(1); });
