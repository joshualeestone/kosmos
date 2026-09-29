'use strict';
/* #4588: what the person and the manager are told about an Antigravity agent paused on its Google account's shared
   quota: firm, the shared account named, the reset given, and no "add credits" (it is a subscription allowance). */
const test = require('node:test');
const assert = require('node:assert');
const { accountProblemOf } = require('./accountproblem');

const UNTIL = '2026-09-28T22:11:54.000Z';
const HHMM = new Date(Date.parse(UNTIL)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

test('#4588: a quota-paused agy card is told firmly, with the shared account and the reset', () => {
  const p = accountProblemOf({ name: 'Ada', runner: 'antigravity', state: 'rate_limited', quotaUntil: UNTIL });
  assert.equal(p.kind, 'usage');
  assert.equal(p.notify, true);
  assert.match(p.text, /Ada has used up its Google account's Antigravity quota, which every Antigravity agent on this computer shares/);
  assert.match(p.text, new RegExp('resets at ' + HHMM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(p.text, /credits|looks like/i);
});

test('#4588: CONTROL: an agy card without a reset keeps the generic wording', () => {
  const p = accountProblemOf({ name: 'Ada', runner: 'antigravity', state: 'rate_limited' });
  assert.ok(p);
  assert.doesNotMatch(p.text, /every Antigravity agent on this computer shares/);
});
