'use strict';

/**
 * #1561: a switch onto OpenAI, on a computer whose OpenAI sign-ins are ALL dead,
 * must refuse rather than state a default onto a dead account.
 *
 * The page's picker already filters live accounts (connection.state !== 'none');
 * when every one is dead the filtered list is empty, the picker hides, and the
 * submit sent account:null. The engine's openai.list() has NO liveness filter, so
 * on account:null it took its first account, dead or not, and named it. This card
 * closes that: openaiAllDead() is the shared decision, fillSwitchAccounts says so,
 * and changeProviderNow refuses the submit.
 *
 * 🔑 THE PREDICATE IS EXTRACTED AND RUN, not pattern-matched. Its whole subject is
 * a THREE-way distinction (zero accounts / all dead / unreadable) that a regex
 * cannot see, and getting the third one wrong would fire the refusal on a machine
 * that is merely unreadable, which is exactly the false negative to avoid.
 *
 *   node --test web.openai-alldead-1561.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/* Population floor, module scope, before any test: an absence assertion on an
   empty read passes by examining nothing. A control string each thing uniquely
   contains proves we are reading the page we think we are. */
for (const control of ['function openaiAllDead(', 'SWITCH_ACCT_ALLDEAD', 'function changeProviderNow(']) {
  if (PAGE.indexOf(control) === -1) {
    throw new Error('population floor: web/index.html does not contain ' + JSON.stringify(control)
      + '. Every assertion below would examine nothing.');
  }
}

function loadAllDead() {
  const at = PAGE.indexOf('function openaiAllDead(');
  assert.notEqual(at, -1, 'openaiAllDead is gone from the page');
  const src = PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
  return new Function(src + '; return openaiAllDead;')();
}
const openaiAllDead = loadAllDead();

const oa = (state) => ({ provider: 'openai', connection: state == null ? undefined : { state } });

test('#1561 all OpenAI accounts dead (state none) -> true (the fix fires)', () => {
  assert.equal(openaiAllDead([oa('none'), oa('none')], false), true);
});

test('#1561 one live account among dead -> false (does not over-fire)', () => {
  // control: this MUST come back false, or the refusal would block a valid switch
  assert.equal(openaiAllDead([oa('none'), oa('connected')], false), false);
});

test('#1561 unreadable list -> false even when the accounts look dead (the third state)', () => {
  // Angel's catch: "we could not read the list" is not "we checked and none works".
  // Firing here would refuse a switch on a machine that is perfectly fine.
  assert.equal(openaiAllDead([oa('none'), oa('none')], true), false);
});

test('#1561 zero OpenAI accounts -> false (the engine keeps its own add-an-account remedy)', () => {
  assert.equal(openaiAllDead([], false), false);
  assert.equal(openaiAllDead([{ provider: 'anthropic', connection: { state: 'none' } }], false), false);
});

test('#1561 an account with no connection is treated as live, not dead -> false', () => {
  // Matches the picker's own filter (!x.connection || state !== 'none'): an
  // unprobed account is not a confirmed-dead one.
  assert.equal(openaiAllDead([oa(null)], false), false);
});

test('#1561 state UNKNOWN is not dead -> false', () => {
  // Only 'none' is dead. UNKNOWN (unreadable auth, ChatGPT-mode, unreachable
  // probe) must not be treated as dead, same reason as the unreadable list.
  assert.equal(openaiAllDead([oa('unknown')], false), false);
});

test('#1561 both call sites actually use the shared predicate (it is wired, not just defined)', () => {
  const fill = PAGE.indexOf('function fillSwitchAccounts(');
  const fillEnd = PAGE.indexOf('\n  const nameOf', fill);
  const fillBody = PAGE.slice(fill, fillEnd > fill ? fillEnd : fill + 4000);
  assert.match(fillBody, /openaiAllDead\(ACCOUNTS, ACCOUNTS_UNREADABLE\)/,
    'fillSwitchAccounts does not call openaiAllDead, so the all-dead sentence is not shown');
  assert.match(fillBody, /SWITCH_ACCT_ALLDEAD/, 'the all-dead sentence is not set in fillSwitchAccounts');

  const chg = PAGE.indexOf('async function changeProviderNow(');
  const chgBody = PAGE.slice(chg, chg + 2500);
  assert.match(chgBody, /want === 'openai' && openaiAllDead\(ACCOUNTS, ACCOUNTS_UNREADABLE\)/,
    'changeProviderNow does not guard on openaiAllDead, so it can still submit onto a dead account');
  // The guard must return BEFORE the fetch, or it does not actually refuse.
  const guardAt = chgBody.indexOf('openaiAllDead(ACCOUNTS, ACCOUNTS_UNREADABLE)');
  const fetchAt = chgBody.indexOf("fetch('/api/agent/");
  assert.ok(guardAt > -1 && fetchAt > -1 && guardAt < fetchAt,
    'the all-dead guard is not before the fetch, so the refusal would not prevent the submit');
});

test('#1561 the all-dead sentence is distinct from the unreadable one', () => {
  const alldead = PAGE.match(/const SWITCH_ACCT_ALLDEAD = '([^']+)'/);
  const unreadable = PAGE.match(/const SWITCH_ACCT_UNREADABLE = '([^']+)'/);
  assert.ok(alldead && unreadable, 'one of the two sentences is missing');
  assert.notEqual(alldead[1], unreadable[1],
    'all-dead and unreadable must read differently: they are different facts about the same empty picker');
});
