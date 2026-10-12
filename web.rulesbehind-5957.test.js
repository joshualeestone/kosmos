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
  `${page.lift(SCRIPT, 'quotaResetWords')}\n${page.lift(SCRIPT, 'waitingLine')}\n${page.lift(SCRIPT, 'stateReason')}\nreturn stateReason(a, opts);`)(a, opts);
const SAID = 'Its working rules are 13 versions behind. Open it to update them.';

test('#5957: an idle agent far behind says so; with no number it says nothing (control)', () => {
  assert.equal(reasonOf({ state: 'idle', rulesBehind: 13 }), SAID);
  assert.equal(reasonOf({ state: 'idle', rulesBehind: null }), '');
  assert.equal(reasonOf({ state: 'idle' }), '');
});

test('#5957: anything more urgent wins', () => {
  assert.match(reasonOf({ state: 'idle', rulesBehind: 13, crashLoop: { looping: true, count: 4 } }), /restarted it 4 times/);
  assert.match(reasonOf({ state: 'working', rulesBehind: 13, waiting: { n: 2 } }), /2 messages waiting/);
  const limited = reasonOf({ state: 'rate_limited', rulesBehind: 13, stateConfidence: 'reported' });
  assert.doesNotMatch(limited, /working rules/);
  assert.match(limited, /[Uu]sage limit/);
});

test('#5957: only a whole positive number is said (the server sends a number or null)', () => {
  for (const v of [0, -2, 13.5, '13', NaN, Infinity]) assert.equal(reasonOf({ state: 'idle', rulesBehind: v }), '', String(v));
});
