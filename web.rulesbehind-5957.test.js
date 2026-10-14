'use strict';
/* kosmos#5957 slice 2: an agent whose working rules are far behind says so on its card (stateReason, lifted from the
   page as web.agypoolcard-4588.test.js does). The number comes from the server (engine/doctrine.js rulesBehind). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
const reasonOf = (a, opts) => new Function('a', 'opts',
  `${page.lift(SCRIPT, 'quotaResetWords')}\n${page.lift(SCRIPT, 'waitingLine')}\n${page.lift(SCRIPT, 'rulesBehindLine')}\n${page.lift(SCRIPT, 'stateReason')}\nreturn stateReason(a, opts);`)(a, opts);
const SAID = 'Its working rules are 13 versions behind. Open it to update them.';

const CARD = { card: true };   // what card() and lrow() pass (#6118 removed the noQuote opt-out)

test('#5957: an idle card far behind says so; with no number it says nothing (control)', () => {
  assert.equal(reasonOf({ state: 'idle', rulesBehind: 13 }, CARD), SAID);
  assert.equal(reasonOf({ state: 'stopped', rulesBehind: 13 }, CARD), SAID);
  assert.equal(reasonOf({ state: 'idle', rulesBehind: null }, CARD), '');
  assert.equal(reasonOf({ state: 'idle' }, CARD), '');
});

test('#5957: not on the agent\'s own page (the detail header passes no card flag), which has the update note itself', () => {
  assert.equal(reasonOf({ state: 'idle', rulesBehind: 13 }), '');
});

test('#5957: never on a working card (the update restarts it), in the slot a needs-you, question or blocked agent is read by (#986/#2833), nor over a sign-in or connection problem', () => {
  for (const state of ['working', 'needs_you', 'question', 'blocked', 'auth_failed', 'connection_lost', 'restarting', 'unknown']) {
    assert.doesNotMatch(String(reasonOf({ state, rulesBehind: 13 }, CARD)), /working rules/, state);
  }
});

test('#5957: anything more urgent wins', () => {
  assert.match(reasonOf({ state: 'idle', rulesBehind: 13, crashLoop: { looping: true, count: 4 } }, CARD), /restarted it 4 times/);
  assert.match(reasonOf({ state: 'working', rulesBehind: 13, waiting: { n: 2 } }, CARD), /2 messages waiting/);
  const limited = reasonOf({ state: 'rate_limited', rulesBehind: 13, stateConfidence: 'reported' }, CARD);
  assert.doesNotMatch(limited, /working rules/);
  assert.match(limited, /[Uu]sage limit/);
});

test('#5957: only a whole positive number is said (the server sends a number or null)', () => {
  for (const v of [0, -2, 13.5, '13', NaN, Infinity]) assert.equal(reasonOf({ state: 'idle', rulesBehind: v }, CARD), '', String(v));
});
