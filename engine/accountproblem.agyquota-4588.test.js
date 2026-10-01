'use strict';
/* #4588: what the person and the manager are told about an Antigravity agent paused on its Google account's shared
   quota: firm, the shared account named, the reset given, and no "add credits" (it is a subscription allowance). */
const test = require('node:test');
const assert = require('node:assert');
const { accountProblemOf } = require('./accountproblem');

// A reset in the near future, as a paused card carries (a fixed date goes stale and then gains a day, review 7).
const UNTIL = new Date(Date.now() + 30 * 60 * 1000).toISOString();
const HHMM = new Date(Date.parse(UNTIL)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

test('#4588: a quota-paused agy card is told plainly, with the shared account and the reset', () => {
  const p = accountProblemOf({ name: 'Ada', runner: 'antigravity', state: 'rate_limited', quotaUntil: UNTIL });
  assert.equal(p.kind, 'usage');
  assert.equal(p.notify, false, 'it clears by itself at the reset, so the manager is not interrupted to have it fixed');
  assert.match(p.text, /Ada has used up its Google account's Antigravity quota, which any other Antigravity agent signed in to the same Google account shares/);
  assert.match(p.text, new RegExp('resets at ' + HHMM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(p.text, /credits|looks like/i);
});

test('#4588: CONTROL: an agy card without a reset keeps the generic wording', () => {
  const p = accountProblemOf({ name: 'Ada', runner: 'antigravity', state: 'rate_limited' });
  assert.ok(p);
  assert.doesNotMatch(p.text, /signed in to the same Google account shares/);
});
