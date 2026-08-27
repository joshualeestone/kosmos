'use strict';

/**
 * kosmos#979: the prerequisite is step one, not a refusal after the fact.
 *
 * Picking OpenAI on a Mac with no runner used to accept a key, submit it, and
 * answer "we could not find the OpenAI runner on this computer" -- a dead end
 * reached only after the person had gone and found an API key.
 *
 * 🔑 THE DECIDING FUNCTION IS EXTRACTED AND RUN, not matched. Which step shows
 * is a three-way decision (present / absent / could-not-look) and the middle of
 * those is the one a regex cannot see.
 *
 *   node --test web.runner-first-979.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

function stepFn() {
  const a = PAGE.indexOf('function acctOpenaiStep(present) {');
  assert.ok(a > -1, 'acctOpenaiStep moved; re-anchor this test');
  const b = PAGE.indexOf('\nasync function acctOpenaiLook', a);
  assert.ok(b > a, 'the function no longer ends where expected');
  const src = PAGE.slice(a, b);
  const els = { 'acct-openai-install': { hidden: null }, 'acct-openai-key-step': { hidden: null } };
  // eslint-disable-next-line no-new-func
  const make = new Function('document', src + '; return acctOpenaiStep;');
  return { fn: make({ getElementById: (id) => els[id] || null }), els };
}

test('a missing runner shows the install step and hides the key', () => {
  const { fn, els } = stepFn();
  fn(false);
  assert.equal(els['acct-openai-install'].hidden, false, 'the install step stayed hidden with no runner present');
  assert.equal(els['acct-openai-key-step'].hidden, true, 'the key field is still offered with no runner to use it');
});

test('a present runner shows the key and hides the install step', () => {
  const { fn, els } = stepFn();
  fn(true);
  assert.equal(els['acct-openai-install'].hidden, true, 'the install step shows for a runner that is already there');
  assert.equal(els['acct-openai-key-step'].hidden, false, 'the key field is hidden even though the runner is present');
});

/* ⚠️ THE ARM THAT MATTERS MOST, and the one a two-state boolean would have got
   wrong. "We could not look" is not "it is missing". An unreachable board must
   never send somebody off to install a runner they may already have -- so
   unknown falls back to the state this form has always opened in. */
test('could-not-look is not treated as missing', () => {
  for (const unknown of [null, undefined]) {
    const { fn, els } = stepFn();
    fn(unknown);
    assert.equal(els['acct-openai-install'].hidden, true,
      `a ${String(unknown)} runner answer offered an install; we do not know that it is missing`);
    assert.equal(els['acct-openai-key-step'].hidden, false,
      `a ${String(unknown)} runner answer hid the key field on a board we simply could not read`);
  }
});

test('the submit race reveals the install step in place', () => {
  assert.match(PAGE, /e\.needsRunner = !!\(out && out\.needsRunner\)/,
    'the add error no longer carries needsRunner, so a runner that vanished mid-form leaves a refusal with nothing to do about it');
  assert.match(PAGE, /if \(err && err\.needsRunner\) \{ ACCT_OPENAI_READY = false; acctOpenaiStep\(false\); \}/,
    'nothing reveals the install step when the engine says the runner is missing');
});

/* A failed install must say so and offer the button again, or the panel sits on
   "Installing..." for ever -- the stale-screen family this card belongs to. */
test('a failed install is an outcome, not a spinner', () => {
  const i = PAGE.indexOf('function acctOpenaiWatch()');
  assert.ok(i > -1, 'acctOpenaiWatch moved');
  const body = PAGE.slice(i, PAGE.indexOf('\nfunction ', i + 1));
  assert.match(body, /job\.phase === 'failed'/, 'the watcher no longer notices a failed install');
  assert.match(body, /go\.disabled = false/, 'a failed install leaves the button dead, with no way to try again');
});
