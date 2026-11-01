'use strict';
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const { agentLines, roleLines } = require('./clilists');

test('#7748: the agent list says each agent, its role, and the word on its card', () => {
  const r = agentLines([
    { name: 'Ada', role: 'Researcher', state: 'Idle' },
    { name: 'Ben', role: null, state: 'Not running' },
    { name: 'Di', role: 'Writer' },
  ]);
  assert.deepEqual(r, { code: 0, lines: ['Ada  Researcher  Idle', 'Ben  no role recorded  Not running', 'Di  Writer  state not known'] });
});

test('#7748: no agents is said, and a bad row is skipped', () => {
  assert.deepEqual(agentLines([]).lines, ['There are no agents on this board yet.']);
  assert.deepEqual(agentLines(null).lines, ['There are no agents on this board yet.']);
  assert.deepEqual(agentLines([null, { role: 'x' }, { name: 'Ada', state: 'Idle' }]).lines, ['Ada  no role recorded  Idle']);
});

const ROLES = [
  { key: 'pm', label: 'Project Manager', group: 'Core' },
  { key: 'email', label: 'Email Assistant', group: 'Core' },
  { key: 'orders', label: 'Orders and Returns Specialist', group: 'Ecommerce' },
  { key: 'own', label: 'Describe it yourself' },
];

test('#7748: the roles come under their groups, a role with none under Other', () => {
  assert.deepEqual(roleLines(ROLES).lines, ['Core:', '  pm  Project Manager', '  email  Email Assistant', '', 'Ecommerce:', '  orders  Orders and Returns Specialist', '', 'Other:', '  own  Describe it yourself']);
});

test('#7748: a word narrows by key, label or group, in any case', () => {
  assert.deepEqual(roleLines(ROLES, 'EMAIL').lines, ['Core:', '  email  Email Assistant']);
  assert.deepEqual(roleLines(ROLES, 'returns').lines, ['Ecommerce:', '  orders  Orders and Returns Specialist']);
  assert.equal(roleLines(ROLES, 'ecommerce').lines.length, 2);
  assert.equal(roleLines(ROLES, 'email').code, 0);
});

test('#7748: no roles at all is said', () => {
  assert.deepEqual(roleLines([]), { lines: ['Kosmos has no roles to list right now.'], code: 0 });
});

test('#7748: a word that matches nothing says so and exits 1', () => {
  const r = roleLines(ROLES, 'zebra');
  assert.equal(r.code, 1);
  assert.match(r.lines[0], /No role matches "zebra"/);
});
