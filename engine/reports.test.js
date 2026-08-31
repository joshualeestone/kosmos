'use strict';
/**
 * kosmos#1676. The "Who you report to" block is written into every agent's
 * instructions, and NOTHING asserted a word of it. PigeonPete measured that
 * while reviewing the fix: the wording could be deleted and the suite stayed
 * green, which is the shape this repo keeps paying for.
 *
 * ⚠️ WHY A TEST AND NOT A FINGERPRINT. `engine/defaults.js` pins a hash of its
 * whole block against DOCTRINE_VERSION, so deleting a section there reds
 * immediately (measured: removing the #1673 section reproduces the pinned v6
 * hash exactly). This block has no such pin and no version, so the properties
 * have to be named one at a time.
 *
 * These assert PROPERTIES, never the exact sentences. A test that pins the
 * prose becomes the stale assertion it was written to prevent, which is the
 * defect kosmos#1663 fixed one file over.
 */
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const reports = require('./reports');

/* The person's name comes from `you.read()`. Swapping it is how both halves of
   `personLine` get exercised: the record is empty on most machines, so the
   named arm would otherwise never run and the fallback would look like the
   only behaviour. */
function withPersonNamed(name, fn) {
  const orig = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === './you') return { read: () => ({ state: 'saved', you: { name } }) };
    return orig.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve('./reports')];
    return fn(require('./reports'));
  } finally {
    Module.prototype.require = orig;
    delete require.cache[require.resolve('./reports')];
  }
}

test('a managed agent is told that reporting is not the same as being spoken to (#1676)', () => {
  const body = reports.blockBody({ role: 'Operations Manager', reportsTo: 'marcus' });
  assert.match(body, /not the same as being spoken to/,
    'the escalation-versus-conversation distinction is gone: an agent with a manager has only that name and greets them instead of the sender');
});

test('a managed agent is told to answer the sender, not the manager (#1676)', () => {
  const body = reports.blockBody({ role: 'Operations Manager', reportsTo: 'marcus' });
  assert.match(body, /answer whoever sent the message/i,
    'the answer-the-sender rule is gone, which is the "Hi Marcus" defect');
});

test('the MANAGED branch names the operator too, not only the manager (#1676)', () => {
  /* The bug was structural rather than verbal: `personName()` was called only
     in the no-manager branch, so a managed agent never learned the operator
     existed and had exactly one human's name to use. */
  const managed = reports.blockBody({ role: 'Operations Manager', reportsTo: 'marcus' });
  assert.match(managed, /This computer is run by/,
    'the managed branch no longer names the operator at all, which is the original #1676 mechanism');
});

test('personLine names the person when the record has a name, and does not invent one when it does not', () => {
  const anon = reports.blockBody({ reportsTo: 'marcus' });
  assert.match(anon, /This computer is run by a person\./,
    'the no-name fallback is wrong');
  assert.doesNotMatch(anon, /run by \*\*the person who runs this computer\*\*/,
    'the fallback phrase is being bolded as if it were a name, which is the sentence this helper exists to prevent');

  withPersonNamed('Josh', (mod) => {
    const named = mod.blockBody({ reportsTo: 'marcus' });
    assert.match(named, /This computer is run by \*\*Josh\*\*\./,
      'a recorded operator name does not reach the managed branch');
  });
});

test('CONTROL: the no-manager branch still names the operator, so these tests can tell the branches apart', () => {
  const solo = reports.blockBody({ role: 'Operations Manager', reportsTo: null });
  assert.match(solo, /You report to \*\*the person who runs this computer\*\* directly/,
    'the no-manager branch changed, which none of this card touched');
  /* The distinction only belongs in the managed branch: with no manager there
     is exactly one human and nothing to confuse. */
  assert.doesNotMatch(solo, /not the same as being spoken to/,
    'the managed-only sentence leaked into the branch that has no manager');
});
