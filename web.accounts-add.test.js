'use strict';

/**
 * #248: adding a second account from Settings, no terminal.
 *
 *   node --test web.accounts-add.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');

function accountsSection() {
  const at = PAGE.indexOf('id="s-sec-accounts"');
  const end = PAGE.indexOf('id="s-sec-connect"');
  assert.ok(at > -1 && end > at, 'the accounts section moved; restate this pin');
  return PAGE.slice(at, end);
}

test('the add-account button is live and no user-facing copy names a terminal (#248 rules 1, 2)', () => {
  const sec = accountsSection();
  assert.match(sec, /id="acct-add"(?![^>]*\bdisabled)/, 'the add-account button shipped disabled');
  /* Rule 2, asserted on the rendered markup region, comments stripped so a
     recorded history cannot satisfy or fail a copy pin. */
  const rendered = sec.replace(/<!--[\s\S]*?-->/g, '');
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


test('#727: one provider at a time, a key field the row sizes, an exit at button size, and a stopped receipt', () => {
  const sec = accountsSection().replace(/<!--[\s\S]*?-->/g, '');
  assert.match(sec, /class="frow acct-pick" role="group" aria-label="Add an account"/);
  assert.match(sec, /data-pick="claude" aria-pressed="false"/); assert.match(sec, /data-pick="openai" aria-pressed="false"/);
  assert.doesNotMatch(sec, /id="acct-add-openai"/, 'the old toggle would show the OpenAI form beside the Claude one');
  assert.match(sec, /id="acct-claude-flow" hidden/); assert.match(sec, /id="acct-openai-flow" hidden/);
  const claude = sec.slice(sec.indexOf('id="acct-claude-flow"'), sec.indexOf('id="acct-openai-flow"'));
  assert.match(claude, /id="acct-add"/); assert.match(claude, /id="acct-flow"/); assert.match(claude, /id="acct-code-row"/);
  const pick = PAGE.slice(PAGE.indexOf('function acctPick'), PAGE.indexOf("document.querySelectorAll('.acct-pick [data-pick]').forEach((b) => b.addEventListener"));
  assert.match(pick, /getElementById\('acct-claude-flow'\)\.hidden = which !== 'claude'/);
  assert.match(pick, /getElementById\('acct-openai-flow'\)\.hidden = which !== 'openai'/);
  const paint = PAGE.slice(PAGE.indexOf('function acctFlowPaint'), PAGE.indexOf('function acctFlowWatch'));
  assert.match(paint, /if \(!document\.querySelector\('\.acct-pick \[data-pick\]\[aria-pressed="true"\]'\)\) acctPick\('claude', \{ focus: false \}\)/, 'a sign-in in flight picks Claude on its own');
  assert.match(PAGE, /\.frow input\[type=text\], \.frow input\[type=password\] \{ flex: 1; min-width: 220px;/, 'the key field is sized by the row (it was "the world\'s tiniest input")');
  assert.match(sec, /id="acct-openai-show" type="button" aria-pressed="false">Show</);
  const flow = sec.slice(sec.indexOf('id="acct-flow"'), sec.indexOf('id="acct-add-note"'));
  assert.match(flow, /<button class="btn" id="acct-cancel" type="button">Stop this sign-in<\/button>/, 'the exit is a button at button size');
  assert.doesNotMatch(flow, /class="linkish" id="acct-cancel"/);
  assert.ok(flow.indexOf('id="acct-cancel"') > flow.indexOf('id="acct-code-row"'), 'the exit sits under the code row in its own row, shown whether or not a code is wanted');
  const cancel = PAGE.slice(PAGE.indexOf("getElementById('acct-cancel').addEventListener"), PAGE.indexOf("getElementById('acct-cancel').addEventListener") + 700);
  assert.match(cancel, /note\.textContent = 'Stopped\. Nothing changed; start the sign-in again whenever you like\.'/);
});
