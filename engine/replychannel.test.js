'use strict';
/* kosmos#5805 part 2: engine/replychannel.js, the declared reply channel. Pure, with an injected store.
     node --test engine/replychannel.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const rc = require('./replychannel');

test('kosmos#5805: normalize keeps words on one line, clears on empty or "kosmos", refuses the rest', () => {
  assert.equal(rc.normalize('  the   Discord channel '), 'the Discord channel');
  assert.equal(rc.normalize('x'.repeat(rc.MAX_LEN)), 'x'.repeat(rc.MAX_LEN), 'the longest allowed value was refused');
  for (const clear of [null, undefined, '', '   ', 'kosmos', ' KOSMOS ']) assert.equal(rc.normalize(clear), null, JSON.stringify(clear) + ' did not clear');
  assert.throws(() => rc.normalize('x'.repeat(rc.MAX_LEN + 1)), /keep the channel to 60 characters/);
  for (const two of ['Discord\nthen this', 'Discord\rx', 'a\tb', 'a\u2028b', 'a\u0000b']) assert.throws(() => rc.normalize(two), /one line/, JSON.stringify(two));
  for (const odd of [42, true, {}, []]) assert.throws(() => rc.normalize(odd), /in words/, JSON.stringify(odd));
  for (const flag of ['-x', '--clear Discord', ' -x', '\u00a0-x']) assert.throws(() => rc.normalize(flag), /cannot start with -/, JSON.stringify(flag));
  assert.equal(rc.normalize('a-b'), 'a-b', 'a dash inside a channel was refused');
});

test('kosmos#5805: of() reads a profile; a stored value the command would refuse is no declaration', () => {
  assert.equal(rc.of({ replyChannel: 'Discord' }), 'Discord');
  assert.equal(rc.of({}), null);
  assert.equal(rc.of(null), null);
  assert.equal(rc.of({ replyChannel: 'kosmos' }), null);
  assert.equal(rc.of({ replyChannel: 'x'.repeat(rc.MAX_LEN + 1) }), null, 'a hand-edited over-long value silenced the reminders');
  assert.equal(rc.of({ replyChannel: 'a\nb' }), null);
  assert.equal(rc.of({ replyChannel: 7 }), null);
});

test('kosmos#5805: set writes through the store; forAgent never throws', () => {
  const written = [];
  const fake = { readProfile: () => ({ replyChannel: ' Slack ' }), writeProfile: (n, p) => written.push([n, p]) };
  assert.equal(rc.set('ada', '  Slack  ', fake), 'Slack');
  assert.equal(rc.set('ada', '', fake), null);
  assert.deepEqual(written, [['ada', { replyChannel: 'Slack' }], ['ada', { replyChannel: null }]]);
  assert.throws(() => rc.set('ada', 'a\nb', fake), /one line/);
  assert.equal(written.length, 2, 'a refused value reached the store');
  assert.equal(rc.forAgent('ada', fake), 'Slack');
  assert.equal(rc.forAgent('', fake), null);
  assert.equal(rc.forAgent('ada', { readProfile: () => { throw new Error('unreadable'); } }), null);
});
