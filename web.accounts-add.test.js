'use strict';

/**
 * #248: adding a second account from Settings, no terminal.
 *
 *   node --test web.accounts-add.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { codeOnly } = require('./test-support/code-only');

const PAGE = fs.readFileSync('web/index.html', 'utf8');

function accountsSection() {
  const at = PAGE.indexOf('id="s-sec-accounts"');
  const end = PAGE.indexOf('id="s-sec-connect"');
  assert.ok(at > -1 && end > at, 'the accounts section moved; restate this pin');
  return PAGE.slice(at, end);
}

/* #770: the add-a-provider flow (Claude sign-in, OpenAI key) moved out of
   the Accounts section into its own dialog (`acct-add-modal`), reached
   through a door button that stays in the section. Pins that need the
   flow markup now read this region instead of `accountsSection()`. */
function acctAddModal() {
  const at = PAGE.indexOf('id="acct-add-modal"');
  const end = PAGE.indexOf('id="del-modal"');
  assert.ok(at > -1 && end > at, 'the add-a-provider dialog moved; restate this pin');
  return PAGE.slice(at, end);
}

test('the door into the add-a-provider dialog is in the section, and the dialog itself is live with no terminal copy (#248 rules 1, 2)', () => {
  const sec = accountsSection();
  assert.match(sec, /id="acct-add-open"/, 'the door into Add a provider is gone from the section');
  const modal = acctAddModal();
  assert.match(modal, /id="acct-add"(?![^>]*\bdisabled)/, 'the add-account button shipped disabled');
  /* Rule 2, asserted on the rendered markup region, comments stripped so a
     recorded history cannot satisfy or fail a copy pin. */
  const rendered = codeOnly(modal);
  assert.ok(!rendered.includes('CLAUDE_CONFIG_DIR'), 'an environment variable reached user-facing copy');
  assert.ok(!/<code>[^<]*claude[^<]*<\/code>/i.test(rendered), 'a shell command survives in the copy');
});

test('the flow never sends a plain start (#248, the hazard the old disable prevented)', () => {
  /* A plain start would sign into the DEFAULT config and could log the
     person's main account out, which is what kept this button disabled for a
     day. That is the invariant, and it is what this pins.
     🛑 THIS USED TO SAY "the ONE request this button makes carries
     { another: true }", and #1492 made that sentence false: the same button now
     also aims at an EXISTING account's directory. The assertion stayed green
     through the change, because the new shape is a ternary and the old arm is
     still in the source -- a check asserting a superseded promise, passing.
     ⚠️ The either-arm invariant is pinned by RUNNING the expression in
     web.reauth-1492.test.js. This one stays a source pin on purpose: it is the
     #248 hazard, and it should still fail loudly if a plain start reappears.
     🛑 #1587 MOVED THE POST out of the click handler into `acctAddStart`, so the
     gate (learn willInstall, confirm) can run first. The #248 invariant is
     unchanged and now lives in the worker; this pin follows it there. The gate
     itself is pinned separately below. */
  const at = PAGE.indexOf('async function acctAddStart');
  assert.ok(at > -1, 'the start worker moved; restate this pin');
  /* 1600, not 900: #1574 added the confirm flag to the request body and a comment
     saying why, which pushed `another: true` and `accountDir` past the old window.
     The #248 invariant below is unchanged and is what this still pins. */
  const wiring = PAGE.slice(at, at + 1600);
  assert.match(wiring, /\/api\/connect\/start/, 'the button does not start the connect flow');
  assert.match(wiring, /another:\s*true/, 'the start request can no longer ask for ANOTHER account');
  assert.match(wiring, /accountDir/, 'the start request can no longer aim at an EXISTING account (#1492)');
  assert.doesNotMatch(wiring, /JSON\.stringify\(\{\}\)/, 'the button can send a plain start, which is the #248 hazard');
});

test('#1587: the acct-add button gates the sign-in behind the install confirm, like the first-run flow', () => {
  /* Settings > Accounts is a SECOND entry into /api/connect/start. Ungated, an
     accounts click could begin a ~231MB Claude Code install with no warning,
     the download the first-run flow already gates behind #fr-claude-confirm.
     The property: the click cannot reach the POST without first learning
     willInstall and, unless it is a definite false, showing the confirm.
     Comments are stripped (CODE), so a comment naming a call cannot satisfy
     these, the same discipline web.connect-confirm.test.js uses. */
  const CODE = PAGE.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

  // The POST lives in its own worker, separate from the click handler.
  /* #1574 gave the worker a parameter (did a PERSON confirm), so the pin follows
     the name rather than the empty parameter list. The property is unchanged: the
     POST lives in a worker the click handler cannot reach without gating first. */
  assert.match(CODE, /async function acctAddStart\(/, 'the acct-add start worker is gone; the gate has nothing to sit in front of');

  // The click handler itself must NOT reach the download directly: no
  // /api/connect/start POST inside the listener. That POST is the thing gated.
  const clickAt = CODE.indexOf("getElementById('acct-add').addEventListener");
  assert.ok(clickAt > -1, 'the acct-add click handler moved; restate this pin');
  const click = CODE.slice(clickAt, clickAt + 1100);
  assert.doesNotMatch(click, /\/api\/connect\/start/, 'the acct-add click POSTs the download directly, skipping the confirm (the #1587 defect)');

  // It gates: learns willInstall from /api/first-run and shows the confirm.
  assert.match(click, /\/api\/first-run/, 'the acct-add click no longer learns whether an install will happen');
  assert.match(click, /willInstall/, 'the acct-add click no longer checks willInstall before starting');
  assert.match(click, /acct-add-confirm/, 'the acct-add click no longer shows the confirm before the download');

  // The one path from the confirm to the download is the Confirm button.
  const goAt = CODE.indexOf("getElementById('acct-add-confirm-go').addEventListener");
  assert.ok(goAt > -1, 'the acct-add Confirm handler is missing, so nothing carries a confirmed click to the sign-in');
  /* 🛑 #1574: `acctAddStart(true)`, AND THE ARGUMENT IS THE POINT RATHER THAN NOISE.
     The worker now reports to the server whether a PERSON pressed Confirm, and this
     is the one call site allowed to say true. Asserting `true` specifically is
     stronger than the old empty-parens pin: a future edit that wires this button to
     `acctAddStart(false)` would silently make the Confirm button unable to confirm,
     and the old assertion could not have seen that. */
  assert.match(CODE.slice(goAt, goAt + 900), /acctAddStart\(true\)/, 'the Confirm button no longer starts the sign-in as a confirmed one');

  // Both choices exist in the accounts modal.
  assert.match(PAGE, /id="acct-add-confirm-go"/, 'the Confirm button is missing from the accounts modal');
  assert.match(PAGE, /id="acct-add-confirm-no"/, 'the Not now button is missing from the accounts modal');

  // A dismissal mid-confirm (Close, Escape, backdrop) must not leave a
  // greyed-out button behind a stale panel: closeAcctAdd (the single dismiss
  // path all three exits call) resets the confirm on the way out.
  const closeFn = CODE.slice(CODE.indexOf('function closeAcctAdd'), CODE.indexOf('function closeAcctAdd') + 400);
  assert.match(closeFn, /acctAddConfirmReset\(\)/, 'closeAcctAdd does not reset the confirm, so a mid-confirm dismissal leaves a disabled button behind a stale panel on reopen');

  // The reset runs on EVERY dismiss, so it must not re-enable Start while a
  // sign-in flow owns its disabled state: doing so reopened a double-submit
  // window (close mid-flow, reopen, click Start again). It consults #acct-flow.
  const reset = CODE.slice(CODE.indexOf('function acctAddConfirmReset'), CODE.indexOf('function acctAddConfirmReset') + 600);
  assert.match(reset, /flow\.hidden\)\s*btn\.disabled = false/, 'acctAddConfirmReset re-enables Start without gating on flow.hidden, reopening the double-submit window (close mid-flow, reopen, click Start again). If the guard was refactored, restate this pin against the new gate.');
});

test('the code row appears only when the flow awaits a code, and a reason empties it', () => {
  const at = PAGE.indexOf('function acctFlowPaint');
  assert.ok(at > -1, 'the flow painter moved; restate this pin');
  const fn = PAGE.slice(at, PAGE.indexOf('function acctFlowWatch'));
  assert.match(fn, /signin-awaiting-code/, 'the painter does not know the awaiting-code phase');
  assert.match(fn, /codeRow\.hidden = !wantCode/, 'the code row is not gated on the awaiting phase');
  assert.match(fn, /value = ''/, 'a rejected code does not empty the field (the one rebuild that is right)');
});


test('#727/#770: one provider at a time, a key field the row sizes, an exit at button size, and a stopped receipt', () => {
  const modal = codeOnly(acctAddModal());
  // #770: the picker is a dropdown now (Josh's word), not the two-button
  // toggle -- Claude and OpenAI live, everything else listed and disabled
  // so people can see what is coming.
  assert.match(modal, /id="acct-provider-pick"/);
  assert.match(modal, /<option value="claude">Anthropic Claude<\/option>/);
  assert.match(modal, /<option value="openai">OpenAI<\/option>/);
  /* 🛑 THIS USED TO PIN THE EM DASH: /<option disabled>[^<]+ — coming<\/option>/.
     Josh's one standing style rule is that an em dash never appears in anything
     he reads, and this line made the violation load-bearing: correcting the
     punctuation turned the suite red, so the wrong character was the thing
     keeping the test green. A check keyed to the spelling of a defect defends
     the defect.
     ⇒ What is asserted is the CLAIM: some other provider is listed and
     disabled, so a person can see what is coming. How it is punctuated is copy,
     and copy is allowed to improve without asking a test for permission. */
  assert.match(modal, /<option disabled>[^<]*coming soon<\/option>/, 'no other provider is listed, disabled, as coming soon');
  assert.doesNotMatch(modal, /id="acct-add-openai"/, 'the old toggle would show the OpenAI form beside the Claude one');
  assert.match(modal, /id="acct-claude-flow" hidden/); assert.match(modal, /id="acct-openai-flow" hidden/);
  const claude = modal.slice(modal.indexOf('id="acct-claude-flow"'), modal.indexOf('id="acct-openai-flow"'));
  assert.match(claude, /id="acct-add"/); assert.match(claude, /id="acct-flow"/); assert.match(claude, /id="acct-code-row"/);
  const pick = PAGE.slice(PAGE.indexOf('function acctPick'), PAGE.indexOf("document.getElementById('acct-provider-pick').addEventListener('change'"));
  assert.match(pick, /getElementById\('acct-claude-flow'\)\.hidden = which !== 'claude'/);
  assert.match(pick, /getElementById\('acct-openai-flow'\)\.hidden = which !== 'openai'/);
  const paint = PAGE.slice(PAGE.indexOf('function acctFlowPaint'), PAGE.indexOf('function acctFlowWatch'));
  assert.match(paint, /if \(document\.getElementById\('acct-provider-pick'\)\.value !== 'claude'\) acctPick\('claude', \{ focus: false \}\)/, 'a sign-in in flight picks Claude on its own');
  assert.match(PAGE, /\.frow input\[type=text\], \.frow input\[type=password\] \{ flex: 1; min-width: 220px;/, 'the key field is sized by the row (it was "the world\'s tiniest input")');
  assert.match(modal, /id="acct-openai-show" type="button" aria-pressed="false">Show</);
  const flow = modal.slice(modal.indexOf('id="acct-flow"'), modal.indexOf('id="acct-add-note"'));
  assert.match(flow, /<button class="btn" id="acct-cancel" type="button">Stop this sign-in<\/button>/, 'the exit is a button at button size');
  assert.doesNotMatch(flow, /class="linkish" id="acct-cancel"/);
  assert.ok(flow.indexOf('id="acct-cancel"') > flow.indexOf('id="acct-code-row"'), 'the exit sits under the code row in its own row, shown whether or not a code is wanted');
  const cancel = PAGE.slice(PAGE.indexOf("getElementById('acct-cancel').addEventListener"), PAGE.indexOf("getElementById('acct-cancel').addEventListener") + 700);
  assert.match(cancel, /note\.textContent = 'Stopped\. Nothing changed; start the sign-in again whenever you like\.'/);
});

test('#770: the door opens the dialog, and it closes on its own Close button, the backdrop and Escape', () => {
  assert.match(PAGE, /getElementById\('acct-add-open'\)\.addEventListener\('click', openAcctAdd\)/);
  assert.match(PAGE, /getElementById\('acct-add-close'\)\.addEventListener\('click', closeAcctAdd\)/);
  assert.match(PAGE, /getElementById\('acct-add-modal'\)\.addEventListener\('click', \(e\) => \{ if \(e\.target\.id === 'acct-add-modal'\) closeAcctAdd\(\); \}\)/);
  const openAt = PAGE.indexOf('function openAcctAdd');
  const openFn = PAGE.slice(openAt, PAGE.indexOf('function closeAcctAdd'));
  assert.match(openFn, /document\.getElementById\('acct-add-modal'\)/, 'openAcctAdd does not touch the dialog it is supposed to open');
  assert.match(openFn, /modal\.hidden = false/);
});

test('#770: reopening onto a sign-in already in flight lands focus on that step, not the top of the dialog', () => {
  // Independent review caught this: a sign-in reaching the awaiting-code
  // phase, closed and reopened before the poll's key changes, used to
  // send focus back to the provider dropdown -- acctFlowPaint's own
  // dedup guard means it will not rerun and refocus the code field on
  // its own, so openAcctAdd has to check the step itself.
  const openAt = PAGE.indexOf('function openAcctAdd');
  const openFn = PAGE.slice(openAt, PAGE.indexOf('function closeAcctAdd'));
  assert.match(openFn, /const active = frConnActive\(/, 'openAcctAdd no longer knows whether a sign-in is in flight');
  assert.match(openFn, /if \(active && !document\.getElementById\('acct-code-row'\)\.hidden\) \{\s*\n\s*document\.getElementById\('acct-code'\)\.focus\(\);/,
    'reopening mid-flow with the code field showing no longer focuses it');
  assert.match(openFn, /\} else if \(active\) \{\s*\n\s*document\.getElementById\('acct-cancel'\)\.focus\(\);/,
    'reopening mid-flow before the code field shows no longer focuses the one actionable control (Stop this sign-in)');
  assert.match(openFn, /\} else \{\s*\n\s*sel\.focus\(\);/,
    'opening fresh (nothing in flight) no longer focuses the provider dropdown');
});

test('#1492: a signed-out account the agent runs on surfaces the move (or reauth) at the picker', () => {
  /* Josh's sister: an agent stranded on a signed-out account showed no reason and
     no path. The move UI is right here, so say why it will not run and point at the
     move (when a signed-in target is offered) or at signing the account back in. */
  const CODE = codeOnly(PAGE);
  const at = CODE.indexOf('async function paintAccountPicker');
  assert.ok(at > -1, 'paintAccountPicker moved or was renamed');
  const fn = CODE.slice(at, at + 5000);
  assert.match(fn, /ACCOUNTS\.find\(\(x\) => x\.dir === acct\.dir\)/,
    'the picker no longer cross-references the agent account against the live list, so it cannot tell it is signed out (a launch-file read would not know)');
  assert.match(fn, /state !== 'connected'/, 'no signed-out detection');
  assert.match(fn, /signed out, so it cannot run\. Pick a signed-in account above/,
    'no directive to move when a signed-in target is offered');
  assert.match(fn, /signed out, so it cannot run\. Sign it in again/,
    'no reauth fallback when no move target is offered');
  assert.match(fn, /else if \(msg && !msg\.textContent && signedOut\)/,
    'the prompt is not gated on signedOut, so it could fire on a connected account');
});
