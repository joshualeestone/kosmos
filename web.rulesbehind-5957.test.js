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
/* #6716: a tile and a list row carry no sentence; what one would say is the pill's text (pillSay). */
const pillOf = (a) => new Function('a',
  `${page.lift(SCRIPT, 'quotaResetWords')}\n${page.lift(SCRIPT, 'waitingLine')}\n${page.lift(SCRIPT, 'rulesBehindLine')}\n${page.lift(SCRIPT, 'stateReason')}\n${page.lift(SCRIPT, 'pillSay')}\nreturn pillSay(a);`)(a);

const CARD = { card: true };   // what card() and lrow() pass (#6118 removed the noQuote opt-out)

test('#5957 / #6716: an idle card far behind says so on its pill, never as a line on the tile; with no number, nothing (control)', () => {
  assert.equal(pillOf({ state: 'idle', rulesBehind: 13 }), SAID);
  assert.equal(pillOf({ state: 'stopped', rulesBehind: 13 }), SAID);
  assert.equal(reasonOf({ state: 'idle', rulesBehind: 13 }, CARD), '', 'the tile carries the sentence again (#6716)');
  assert.equal(pillOf({ state: 'idle', rulesBehind: null }), '');
  assert.equal(pillOf({ state: 'idle' }), '');
});

test('#5957: not on the agent\'s own page (the detail header passes no card flag), which has the update note itself', () => {
  assert.equal(reasonOf({ state: 'idle', rulesBehind: 13 }), '');
});

test('#5957: never on a working card (the update restarts it), in the slot a needs-you, question or blocked agent is read by (#986/#2833), nor over a sign-in or connection problem', () => {
  for (const state of ['working', 'needs_you', 'question', 'blocked', 'auth_failed', 'connection_lost', 'restarting', 'unknown']) {
    assert.doesNotMatch(String(pillOf({ state, rulesBehind: 13 })), /working rules/, state);
  }
});

test('#5957: anything more urgent wins', () => {
  assert.match(pillOf({ state: 'idle', rulesBehind: 13, crashLoop: { looping: true, count: 4 } }), /restarted it 4 times/);
  assert.match(pillOf({ state: 'working', rulesBehind: 13, waiting: { n: 2 } }), /2 messages waiting/);
  // #6398 / #6716: a card says only its pill; its own page keeps the usage sentence, never the rules one.
  assert.equal(reasonOf({ state: 'rate_limited', rulesBehind: 13, stateConfidence: 'reported' }, CARD), '');
  const limited = reasonOf({ state: 'rate_limited', rulesBehind: 13, stateConfidence: 'reported' });
  assert.doesNotMatch(limited, /working rules/);
  assert.match(limited, /[Uu]sage limit/);
});

test('#5957: only a whole positive number is said (the server sends a number or null)', () => {
  for (const v of [0, -2, 13.5, '13', NaN, Infinity]) assert.equal(pillOf({ state: 'idle', rulesBehind: v }), '', String(v));
});
