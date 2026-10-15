'use strict';
/* #6249: an agent whose input box has held unsent text for a few minutes says so on its card (engine
   status.unsentInputOf sets a.unsentInput.since). Lifts the page's own stateReason. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
function src(name) {
  const m = PAGE.match(new RegExp('\\nfunction ' + name + '\\([\\s\\S]*?\\n\\}\\n'));
  assert.ok(m, 'CONTROL: ' + name + ' was not found in the page');
  return m[0];
}
const stateReason = new Function(src('quotaResetWords') + src('waitingLine') + src('stateReason') + '\nreturn stateReason;')();

test('#6249: an idle card with text left in its box says so, with the minutes and what to do', () => {
  const since = new Date(Date.now() - 7 * 60e3).toISOString();
  assert.equal(stateReason({ state: 'idle', unsentInput: { since } }),
    'Text has been sitting unsent in its input box for about 7 minutes. Open it to send it with Enter, or clear it.');
  assert.equal(stateReason({ state: 'idle', unsentInput: null }), stateReason({ state: 'idle' }), 'CONTROL: nothing when the box is empty');
  assert.match(stateReason({ state: 'idle', unsentInput: { since: 'not a time' } }), /for about 3 minutes/, 'an unreadable time says the floor');
});

test('#6249: a crash loop still comes first; the unsent line comes before the plain state sentences', () => {
  const since = new Date(Date.now() - 5 * 60e3).toISOString();
  assert.match(stateReason({ state: 'idle', unsentInput: { since }, crashLoop: { looping: true, count: 4 } }), /^Kosmos has restarted it 4 times/);
  assert.match(stateReason({ state: 'rate_limited', stateConfidence: 'scraped', unsentInput: { since } }), /^Text has been sitting unsent/);
});
