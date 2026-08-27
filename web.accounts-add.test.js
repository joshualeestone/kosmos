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

test('the flow asks for another account, never the default (#248, the hazard the old disable prevented)', () => {
  /* The one request this button makes carries { another: true }: a plain
     start would sign into the DEFAULT config and could log the person's
     main account out, which is what kept this button disabled for a day. */
  const at = PAGE.indexOf("getElementById('acct-add').addEventListener");
  assert.ok(at > -1, 'the button wiring moved; restate this pin');
  const wiring = PAGE.slice(at, at + 700);
  assert.match(wiring, /\/api\/connect\/start/, 'the button does not start the connect flow');
  assert.match(wiring, /another:\s*true/, 'the start request does not ask for ANOTHER account');
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
