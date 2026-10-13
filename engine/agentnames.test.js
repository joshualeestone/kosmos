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
  { handle: 'gemini', shown: 'Gemini' },
  { handle: 'subzero', shown: 'Sub-Zero' },
  { handle: 'kano', shown: 'kano' },
];

test('the key is the @-mention key: case, spaces, punctuation and accents do not make a new name', () => {
  for (const s of ['Gemini', 'gemini', ' GEMINI ', 'Ge-mini', 'ge.mini', 'Gémini']) {
    assert.equal(agentnames.nameKey(s), 'gemini', s);
  }
  assert.equal(agentnames.nameKey(null), '');
  // mentionedMembers (engine/messages.js) calls this same function, so its own tests (messages.mention-4642) hold it.
});

test('a display name another agent has is taken, and the sentence names it by name and handle', () => {
  const c = agentnames.clashFor('gemini', { agents: FLEET });
  assert.deepEqual(c, { handle: 'gemini', shown: 'Gemini' });
  assert.equal(agentnames.refusalFor('Sub Zero', { agents: FLEET }),
    'there is already an agent called Sub-Zero (@subzero). Pick another name, or rename that one first.');
});

test('another agent\'s HANDLE is taken too, even when its display name differs', () => {
  const c = agentnames.clashFor('SubZero', { agents: [{ handle: 'subzero', shown: 'Frost' }] });
  assert.equal(c && c.handle, 'subzero');
});

test('a free name is free (control), and a key under two characters never clashes', () => {
  assert.equal(agentnames.clashFor('Gemini Two', { agents: FLEET }), null);
  assert.equal(agentnames.refusalFor('Liu Kang', { agents: FLEET }), null);
  assert.equal(agentnames.clashFor('k', { agents: [{ handle: 'k', shown: 'K' }] }), null);
});

test('the agent being renamed never clashes with its own names (except)', () => {
  assert.equal(agentnames.clashFor('GEMINI', { agents: FLEET, except: 'gemini' }), null);
  // ...but still clashes with everyone else (control: except is not "skip the check").
  assert.equal(agentnames.clashFor('Sub-Zero', { agents: FLEET, except: 'gemini' }).handle, 'subzero');
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

test('except is the agent by its store key, so any spelling a route accepted for it excepts that agent only', () => {
  assert.equal(agentnames.clashFor('gemini', { agents: FLEET, except: 'GEMINI' }), null);
  assert.equal(agentnames.clashFor('gemini', { agents: FLEET, except: 'ge.mini' }), null);
  // Control: a spelling of ANOTHER agent's key does not except gemini.
  assert.equal(agentnames.clashFor('gemini', { agents: FLEET, except: 'SubZero' }).handle, 'gemini');
});

test('takenKey: every script counts, so non-Latin names are compared and digits alone never make a clash', () => {
  for (const s of ['Gemini', 'gemini', ' GEMINI ', 'Ge-mini', 'Gémini']) assert.equal(agentnames.takenKey(s), 'gemini', s);
  const ws = [{ handle: 'wang', shown: '王12' }, { handle: 'mei', shown: '王' }, { handle: 'ivan', shown: 'Иван' }];
  assert.equal(agentnames.clashFor('李12', { agents: ws }), null, '王12 and 李12 are two names');
  assert.equal(agentnames.clashFor('王', { agents: ws }).handle, 'mei', 'one CJK character is a whole name');
  assert.equal(agentnames.clashFor('иван', { agents: ws }).handle, 'ivan', 'Cyrillic is compared, without case');
  // Controls: one Latin letter is still too short, and a free non-Latin name is free.
  assert.equal(agentnames.clashFor('k', { agents: [{ handle: 'k', shown: 'K' }] }), null);
  assert.equal(agentnames.clashFor('李', { agents: ws }), null);
});
