'use strict';
/**
 * kosmos#5957 slice 1: no two agents share a display name (engine/agentnames.js).
 *
 *   node --test engine/agentnames.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const agentnames = require('./agentnames');

const FLEET = [
  { sessionName: 'gemini', shown: 'Gemini' },
  { sessionName: 'subzero', shown: 'Sub-Zero' },
  { sessionName: 'kano', shown: 'kano' },
];

test('the key is the @-mention key: case, spaces, punctuation and accents do not make a new name', () => {
  for (const s of ['Gemini', 'gemini', ' GEMINI ', 'Ge-mini', 'ge.mini', 'Gémini']) {
    assert.equal(agentnames.nameKey(s), 'gemini', s);
  }
  assert.equal(agentnames.nameKey(null), '');
  // The SAME function mentionedMembers uses, so the two cannot drift.
  const { mentionedMembers } = require('./messages');
  const got = mentionedMembers('hi @GE-MINI', ['gemini'], [{ sessionName: 'gemini', name: 'Gemini' }]);
  assert.deepEqual([...got.mentioned], ['gemini']);
});

test('a display name another agent has is taken, and the sentence names it by name and handle', () => {
  const c = agentnames.clashFor('gemini', { agents: FLEET });
  assert.deepEqual(c, { sessionName: 'gemini', shown: 'Gemini' });
  assert.equal(agentnames.refusalFor('Sub Zero', { agents: FLEET }),
    'there is already an agent called Sub-Zero (@subzero). Pick another name, or rename that one first.');
});

test('another agent\'s HANDLE is taken too, even when its display name differs', () => {
  const c = agentnames.clashFor('SubZero', { agents: [{ sessionName: 'subzero', shown: 'Frost' }] });
  assert.equal(c && c.sessionName, 'subzero');
});

test('a free name is free (control), and a key under two characters never clashes', () => {
  assert.equal(agentnames.clashFor('Gemini Two', { agents: FLEET }), null);
  assert.equal(agentnames.refusalFor('Liu Kang', { agents: FLEET }), null);
  assert.equal(agentnames.clashFor('k', { agents: [{ sessionName: 'k', shown: 'K' }] }), null);
});

test('the agent being renamed never clashes with its own names (except)', () => {
  assert.equal(agentnames.clashFor('GEMINI', { agents: FLEET, except: 'gemini' }), null);
  // ...but still clashes with everyone else (control: except is not "skip the check").
  assert.equal(agentnames.clashFor('Sub-Zero', { agents: FLEET, except: 'gemini' }).sessionName, 'subzero');
});

test('the wired source: none wired is no clash; a source that throws or answers junk refuses', (t) => {
  t.after(() => agentnames.setFleetSource(null));
  agentnames.setFleetSource(null);
  assert.equal(agentnames.refusalFor('Gemini'), null);

  agentnames.setFleetSource(() => FLEET);
  assert.match(agentnames.refusalFor('gemini'), /already an agent called Gemini \(@gemini\)/);

  agentnames.setFleetSource(() => { throw new Error('tmux is gone'); });
  assert.equal(agentnames.refusalFor('Anything'), agentnames.COULD_NOT_CHECK);
  assert.throws(() => agentnames.clashFor('Anything'));

  agentnames.setFleetSource(() => null);
  assert.equal(agentnames.refusalFor('Anything'), agentnames.COULD_NOT_CHECK);
});
