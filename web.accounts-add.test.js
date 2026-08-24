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
