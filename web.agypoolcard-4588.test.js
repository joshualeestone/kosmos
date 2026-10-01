'use strict';
/* #4588 part 3: the card's line for an agent held by a colleague's pause on the same Google account. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
const reasonOf = (a, opts) => new Function('a', 'opts', `${page.lift(SCRIPT, 'quotaResetWords')}\n${page.lift(SCRIPT, 'stateReason')}\nreturn stateReason(a, opts);`)(a, opts);

test('#4588 part 3: a card held by the shared pool says so, with the pool\'s reset; CONTROL: its own pause keeps its wording', () => {
  const until = new Date(Date.now() + 3600e3).toISOString(); // ahead of now: the page says a past time is stale
  const hhmm = new Date(Date.parse(until)).toLocaleString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const held = { state: 'rate_limited', stateConfidence: 'structured', stateReported: true, poolUntil: until, quotaUntil: null };
  assert.equal(reasonOf(held, { noQuote: true }), 'Waiting for the shared Google quota, reported to reset at ' + hhmm + '.');
  const own = { ...held, poolUntil: null, quotaUntil: until };
  assert.equal(reasonOf(own, { noQuote: true }), 'Usage limit reached. The Google quota resets at ' + hhmm + '.', 'CONTROL');
  assert.equal(reasonOf({ state: 'idle', poolUntil: until }), '', 'only a paused card says it');
  const past = new Date(Date.now() - 60e3).toISOString();
  assert.equal(reasonOf({ ...held, poolUntil: past }, { noQuote: true }), 'Waiting for the shared Google quota.', 'a past poolUntil: the shared-quota line with no time');
});
