'use strict';
/* kosmos#6774: the DM thread's words for a message kept while the agent's input box held text not yet sent, and no
 * Send now anyway on such a row (the same box would refuse it). dmHeldWords is lifted out of the page and run; the
 * button and the line under the box are read from their own functions, since dmRow needs most of the page to run.
 *   node --test web.inputkeep-6774.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/* The page's own function, lifted out of index.html and run (not a copy of it). */
function lift(name, scope) {
  const m = PAGE.match(new RegExp('\\n(async )?function ' + name + '\\([\\s\\S]*?\\n\\}\\n'));
  assert.ok(m, 'CONTROL: ' + name + ' was not found in the page');
  const keys = Object.keys(scope);
  return new Function(...keys, m[0] + '\nreturn ' + name + ';')(...keys.map((k) => scope[k]));
}
/* One function's source, from its line to the next top-level function. */
function body(name) {
  const at = PAGE.indexOf('\nfunction ' + name + '(');
  assert.ok(at > 0, 'CONTROL: ' + name + ' was not found in the page');
  return PAGE.slice(at, PAGE.indexOf('\nfunction ', at + 1) > 0 ? PAGE.indexOf('\nfunction ', at + 1) : undefined);
}

test('#6774: a row kept for the box says so, and one behind such messages says what it waits behind', () => {
  const words = lift('dmHeldWords', { quotaResetWords: undefined });
  assert.equal(words('casey', { state: 'held', heldFor: 'input' }), "Held: casey's input box holds text not yet sent. Kosmos sends it once the box is clear.");
  assert.equal(words('casey', { state: 'held', behind: true, behindFor: 'input' }), 'Held: Kosmos sends this after the messages kept for casey while its input box held text not yet sent.');
  // CONTROLS: the usage-limit words are unchanged.
  assert.match(words('casey', { state: 'held', behind: true }), /while it was out of usage\.$/);
  assert.match(words('casey', { state: 'held', heldUntil: null }), /is out of usage\. Kosmos sends it after the reset\.$/);
});

test('#6774: Send now anyway is not offered on a row kept for the box, and the line under the box does not point at it', () => {
  const row = body('dmRow');
  const button = row.match(/m\.delivery && m\.delivery\.state === 'held' && typeof m\.at === 'string'([^?]*)\?\s*'<button type="button" class="dm-held-send"/);
  assert.ok(button, 'CONTROL: the Send now anyway button and its condition were not found in dmRow');
  assert.match(button[1], /m\.delivery\.heldFor !== 'input'/, 'the button is offered on a row kept for the box');
  assert.match(button[1], /m\.delivery\.behindFor !== 'input'/, 'the button is offered on a row kept behind messages kept for the box');
  const line = PAGE.match(/line = dmHeldWords\(name, d\) \+ \(([^?]*)\? '' : ' To send it now, use Send now anyway on the message\.'\)/);
  assert.ok(line, 'the held line under the box still offers Send now anyway on a row kept for the box');
  assert.match(line[1], /d\.heldFor === 'input'/);
  assert.match(line[1], /d\.behindFor === 'input'/);
});
