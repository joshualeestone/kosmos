'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('every role carries the summary rhythm, and only the two overseers carry the sweep (#518, #519)', () => {
  const roles = require('./roles');
  for (const r of roles.ROLES) {
    const text = roles.instructionsFor(r.key, 'Ava');
    assert.match(text, /Every four hours while you are working, write a short summary file/,
      r.key + ' lost the summary rhythm');
    assert.match(text, /summaries\/YYYY-MM-DD-HH\.md/, r.key + ' does not name the file convention');
    const sweeps = /every fifteen minutes while you are working, read the open tasks/.test(text);
    const shouldSweep = r.key === 'pm' || r.key === 'director';
    assert.equal(sweeps, shouldSweep,
      r.key + (shouldSweep ? ' lost the task sweep' : ' gained a sweep only overseers carry'));
    if (shouldSweep) {
      assert.match(text, /keeping their summary\s+files current/, r.key + ' does not verify the fleet’s summaries');
      assert.match(text, /never a tracker of your own/, r.key + ' may invent a parallel tracker');
    }
  }
  // The preview and the boot file cannot differ: the raw entry already
  // carries the clause, so any consumer reading .instructions sees it too.
  const pm = roles.byKey('pm');
  assert.match(pm.instructions, /summary file/, 'the served preview lacks the clause the boot file has');
});
