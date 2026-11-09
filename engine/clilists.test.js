'use strict';
process.env.TZ = 'UTC';   // kosmos#8288: the times in these lines are this computer's, and these fixtures are UTC
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const { agentLines, roleLines, rosterRow } = require('./clilists');

test('#7748: the agent list says each agent, its role, and the word on its card', () => {
  const r = agentLines([
    { name: 'Ada', role: 'Researcher', state: 'Idle' },
    { name: 'Roo', role: null, state: 'Not running' },
    { name: 'Di', role: 'Writer' },
  ]);
  assert.deepEqual(r, { code: 0, lines: ['Ada  Researcher  Idle', 'Roo  no role recorded  Not running', 'Di  Writer  state not known'] });
});

const T = '2026-11-09T08:12:00.000Z';

test('kosmos#8288: an agent in an app-only state gets an indented line under its row; one in none gets nothing', () => {
  const r = agentLines([
    { name: 'Ada', role: 'R', state: 'Idle', unsentSince: T },
    { name: 'Roo', role: 'R', state: 'Idle' },
    { name: 'Di', role: 'R', state: 'Working', oneStepSince: T },
    { name: 'Lu', role: 'R', state: 'Idle', noMessageSince: T, restartsLately: 4 },
  ]);
  assert.deepEqual(r, { code: 0, lines: [
    'Ada  R  Idle',
    '  text unsent in its input box since 2026-11-09 08:12',
    'Roo  R  Idle',
    'Di  R  Working',
    '  on one step since 2026-11-09 08:12, with messages waiting behind it',
    'Lu  R  Idle',
    '  no message seen to reach it since 2026-11-09 08:12',
    '  restarted 4 times in the last half hour, stopping within minutes each time',
  ] });
});

test('kosmos#8288: a time that cannot be read says so rather than printing NaN', () => {
  const lines = agentLines([{ name: 'Ada', state: 'Idle', unsentSince: 'not a time' }]).lines;
  assert.equal(lines[1], '  text unsent in its input box since a time Kosmos could not read');
});

test('kosmos#8288: the roster row carries when, and never the words in the box', () => {
  const secret = 'my private note in the box';
  const row = rosterRow({ name: 'Ada', cardWord: 'Idle', role: 'R', unsentInput: { since: T, text: secret }, composerText: secret });
  assert.deepEqual(row, { name: 'Ada', role: 'R', state: 'Idle', unsentSince: T });
  assert.doesNotMatch(JSON.stringify(row), /private note/);
});

test('kosmos#8288: the roster row follows the card: which stall, a crash loop, and nothing for a healthy agent', () => {
  assert.deepEqual(rosterRow({ name: 'H', cardWord: 'Idle', unsentInput: null, deliveryStall: null, crashLoop: null }), { name: 'H', role: null, state: 'Idle' });
  assert.equal(rosterRow({ name: 'A', deliveryStall: { since: T, lastWhy: 'turn', count: 2 } }).oneStepSince, T);
  const words = rosterRow({ name: 'B', deliveryStall: { since: T, words: 'it may be busy' } });
  assert.equal(words.noMessageSince, T);
  assert.equal(words.oneStepSince, undefined);
  assert.equal(rosterRow({ name: 'C', deliveryStall: { since: T } }).noMessageSince, undefined, 'the page shows nothing without its words');
  assert.equal(rosterRow({ name: 'D', crashLoop: { looping: true, count: 5 } }).restartsLately, 5);
  assert.equal(rosterRow({ name: 'E', crashLoop: { looping: false, count: 5 } }).restartsLately, undefined);
  assert.deepEqual(rosterRow({ name: 'F', profile: { role: 'From profile' }, role: 'parsed' }).role, 'From profile');
});

test('#7748: a partial list says so, and an empty partial list does not say there are none', () => {
  const some = agentLines([{ name: 'Ada', state: 'Idle' }], true).lines;
  assert.equal(some.length, 2);
  assert.match(some[1], /may be incomplete/);
  const none = agentLines([], true).lines;
  assert.equal(none.length, 1);
  assert.doesNotMatch(none[0], /no agents/);
  assert.match(none[0], /may be incomplete/);
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
