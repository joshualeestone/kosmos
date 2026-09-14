// Browser-check-surface: d-account-msg
'use strict';

/**
 * kosmos#2811 + kosmos#2338: what a Codex agent's account picker actually renders.
 *
 * 🛑 WHY THIS EXISTS. #2811's `accountForAgent` provider gate is GLOBAL, not
 * whoami-local: the board route resolves every card's account against the CLAUDE
 * list, and the gate refuses to hand a codex agent a Claude row. So a
 * default-account codex agent arrives at `paintAccountPicker` with `account === null`.
 * #2811 removed the old lie ("We cannot tell which account this one uses") for that
 * case. #2338 then went further: a codex agent is MOVABLE between the user's OpenAI
 * (CODEX_HOME) accounts, so when OpenAI accounts exist the picker must OFFER them and
 * be enabled -- the old "This is a Codex agent ... cannot be moved from here" dead-end
 * is gone. It survives as an honest could-not-read message ONLY when no OpenAI account
 * is readable at all.
 *
 * ⚠️ WHY A BROWSER. The source can be read to say the branch splits on the runner and
 * the account world; only a render proves the options a person actually sees and
 * whether the control is live. That is the #1720 gap this directory exists to close.
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
const CLAUDE_ROWS = [{ dir: '/Users/x/.claude', email: 'josh@example.com', label: null, isDefault: true, memoryShared: true }];
// #2338: two OpenAI (CODEX_HOME) accounts so a codex agent has somewhere to move.
// `provider: 'openai'` is the field acctMoveWorld filters on; `name` is what
// acctPrimaryName renders as the option label.
const OPENAI_ROWS = [
  { provider: 'openai', dir: '/Users/x/.codex', isDefault: true, name: 'Josh main', email: 'main@openai' },
  { provider: 'openai', dir: '/Users/x/.codex-work', isDefault: false, name: 'Josh work', email: 'work@openai' },
];

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
  const drive = async (card, accounts) => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto('file://' + PAGE);
    const out = await page.evaluate(async ({ accounts: accts, card: c }) => {
      const realFetch = window.fetch;
      window.fetch = (u, opts) => (String(u).indexOf('/api/accounts') !== -1
        ? Promise.resolve({ ok: true, json: async () => ({ accounts: accts }) })
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
      return {
        text: (msg.textContent || '').trim(),
        disabled: !!sel.disabled,
        options: Array.from(sel.options).map((o) => ({ value: o.value, text: (o.textContent || '').trim() })),
      };
    }, { accounts, card });
    await page.close();
    return out;
  };

  // #2338 SUBJECT: a default-account codex agent WITH OpenAI accounts available must
  // get a live picker that OFFERS the other OpenAI account -- the feature this card adds.
  const codexMovable = await drive(
    { sessionName: 'gpt1', isNamedOurs: true, runner: 'codex', account: null },
    OPENAI_ROWS.concat(CLAUDE_ROWS));
  // #2811 SUBJECT: a default-account codex agent with NO OpenAI account readable falls
  // back to the honest could-not-read message (still not the "we cannot tell" lie).
  const codexNoOpenai = await drive(
    { sessionName: 'gpt2', isNamedOurs: true, runner: 'codex', account: null },
    CLAUDE_ROWS);
  // #2338/#1492 SUBJECT: a default codex agent whose default home is SIGNED OUT (absent
  // from the list, so no isDefault row -> currentDir null) but with a usable NAMED home
  // must still get a LIVE picker offering that home -- not a dead control. The codex
  // analogue of the Claude signed-out recovery the same picker surfaces.
  const codexSignedOutDefault = await drive(
    { sessionName: 'gpt3', isNamedOurs: true, runner: 'codex', account: null },
    [{ provider: 'openai', dir: '/Users/x/.codex-work', isDefault: false, name: 'Josh work', email: 'work@openai' }]);
  // #2338/#1492 SUBJECT: a NAMED codex agent whose ONLY OpenAI home is LISTED but
  // SIGNED OUT (connection.state === 'none') has an empty movable (the state filter
  // drops it), so the picker is disabled -- but the message must be the ACCURATE
  // "signed out, sign it in again from Settings", NOT a false "could not read your
  // OpenAI accounts" (we could read it; it is signed out).
  const codexOnlyHomeSignedOut = await drive(
    { sessionName: 'gpt4', isNamedOurs: true, runner: 'codex', account: { dir: '/Users/x/.codex-solo' } },
    [{ provider: 'openai', dir: '/Users/x/.codex-solo', isDefault: false, name: 'Josh solo', email: 'solo@openai', connection: { state: 'none' } }]);
  // #2338 EXHAUSTIVENESS SUBJECT: a codex agent whose current home is CONNECTED but
  // offerable:false (a CODEX_HOME override) has an empty movable, so the picker is
  // disabled -- but the message must NOT be blank: it says there is nowhere to move to.
  const codexNoDestination = await drive(
    { sessionName: 'gpt5', isNamedOurs: true, runner: 'codex', account: { dir: '/Users/x/.codex-pinnedaway' } },
    [{ provider: 'openai', dir: '/Users/x/.codex-pinnedaway', isDefault: false, name: 'Josh pinned', email: 'p@openai', offerable: false, connection: { state: 'connected' } }]);
  // CONTROL: identical card, claude runner, claude accounts. If this does NOT produce
  // the old "we cannot tell" sentence, the !ours branch was not reached and the codex
  // assertions prove nothing.
  const claudeR = await drive(
    { sessionName: 'cl1', isNamedOurs: true, runner: 'claude', account: null },
    CLAUDE_ROWS);

  await browser.close();

  const problems = [];
  const err = codexMovable.error || codexNoOpenai.error || codexSignedOutDefault.error
    || codexOnlyHomeSignedOut.error || codexNoDestination.error || claudeR.error;
  if (err) problems.push(err);
  else {
    // POPULATION FLOOR / CONTROL first: the claude arm must reach the !ours branch.
    if (!/We cannot tell which account this one uses/.test(claudeR.text)) {
      problems.push('CONTROL FAILED: a claude agent with no account did not produce the "cannot tell" sentence, '
        + 'so the !ours branch was not reached and the codex assertions below prove nothing. got: ' + JSON.stringify(claudeR.text));
    }

    // #2338 movable arm: the picker is live and offers the OTHER OpenAI account.
    if (codexMovable.disabled) {
      problems.push('a codex agent WITH OpenAI accounts has a DISABLED account picker, so #2338\'s move is not offered. '
        + 'got options: ' + JSON.stringify(codexMovable.options));
    }
    if (!codexMovable.options.some((o) => o.value === '/Users/x/.codex-work')) {
      problems.push('the codex account picker does not offer the other OpenAI account (.codex-work) as a move destination. '
        + 'got: ' + JSON.stringify(codexMovable.options));
    }
    if (/cannot be moved from here/.test(codexMovable.text) || /We cannot tell which account/.test(codexMovable.text)) {
      problems.push('a MOVABLE codex agent still shows a cannot-move / cannot-tell message. got: ' + JSON.stringify(codexMovable.text));
    }

    // #2811 no-OpenAI arm: honest could-not-read, never the "we cannot tell" lie, and
    // no longer the old "This is a Codex agent ... cannot be moved" dead-end wording.
    if (/We cannot tell which account this one uses/.test(codexNoOpenai.text)) {
      problems.push('a codex agent with no OpenAI account is told "we cannot tell which account this one uses", '
        + 'which is the #2811 lie. got: ' + JSON.stringify(codexNoOpenai.text));
    }
    if (!/OpenAI accounts/.test(codexNoOpenai.text) || !/cannot be moved from here/.test(codexNoOpenai.text)) {
      problems.push('a codex agent with no readable OpenAI account does not get the honest '
        + 'could-not-read-OpenAI-accounts message. got: ' + JSON.stringify(codexNoOpenai.text));
    }

    // #2338/#1492 signed-out-default arm: the picker stays LIVE and offers the named home.
    if (codexSignedOutDefault.disabled) {
      problems.push('a default codex agent whose default home is signed out has a DISABLED picker, '
        + 'hiding the recovery move to a usable named home (#1492). got: ' + JSON.stringify(codexSignedOutDefault));
    }
    if (!codexSignedOutDefault.options.some((o) => o.value === '/Users/x/.codex-work')) {
      problems.push('the signed-out-default codex agent is not offered its usable named home as a destination. '
        + 'got: ' + JSON.stringify(codexSignedOutDefault.options));
    }
    if (!/Pick an account above and press Move/.test(codexSignedOutDefault.text)) {
      problems.push('the signed-out-default codex agent shows no explanatory message directing the recovery move, '
        + 'so a person sees a bare "Move to..." with no indication anything is wrong. got: ' + JSON.stringify(codexSignedOutDefault.text));
    }

    // #2338/#1492 only-home-signed-out arm: accurate "signed out", never "could not read".
    if (/could not read/.test(codexOnlyHomeSignedOut.text)) {
      problems.push('a codex agent whose only OpenAI home is signed out is falsely told we could not read its '
        + 'OpenAI accounts (we could -- it is signed out). got: ' + JSON.stringify(codexOnlyHomeSignedOut.text));
    }
    if (!/signed out/.test(codexOnlyHomeSignedOut.text) || !/Sign it in again from Settings/.test(codexOnlyHomeSignedOut.text)) {
      problems.push('a codex agent whose only OpenAI home is signed out is not given the accurate '
        + '"signed out, sign it in again from Settings" remedy. got: ' + JSON.stringify(codexOnlyHomeSignedOut.text));
    }

    // #2338 exhaustiveness arm: a connected-but-unmovable current account is not a blank
    // dead control -- it gets the "no other OpenAI account to move to" message.
    if (!/no other OpenAI account to move/.test(codexNoDestination.text)) {
      problems.push('a codex agent whose only home is connected-but-offerable:false shows a blank/dead control '
        + 'instead of an explanatory "nowhere to move" message. got: ' + JSON.stringify(codexNoDestination.text));
    }
  }

  if (problems.length) {
    console.error('FAIL  render-codex-account-picker-2811');
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
  console.log('PASS  render-codex-account-picker-2811: a codex agent with OpenAI accounts gets a live picker offering them (#2338); '
    + 'with none, an honest could-not-read message (#2811); the claude control still says "we cannot tell"');
})().catch((err) => { console.error('FAIL  render-codex-account-picker-2811: ' + ((err && err.message) || err)); process.exit(1); });
