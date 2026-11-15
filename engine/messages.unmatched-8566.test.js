'use strict';
/**
 * kosmos#8566: a room post whose own header names someone who is not a member ("Leo -> Josh: done") woke no one by that
 * name, and nothing told the poster. The board now says so, with the members' exact handles, in the note kosmos post
 * prints. It says only what is true whoever the name meant, and nothing for a name some member answers to.
 *
 * Every root is sandboxed, as in messages.mention-4642.test.js, whose harness this mirrors.
 *
 *   node --test engine/messages.unmatched-8566.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-unmatched-8566-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');
const messages = require('./messages');
const fleet = require('../test-support/fleet');
const roomloop = require('./roomloop');

const PROJECT = 'henderson-lease';
const MEMBERS = ['leo', 'kano', 'subzero', 'mara'];
const FLEET = () => [
  fleet.agent('leo', { state: 'idle' }),
  fleet.agent('kano', { state: 'idle' }),
  fleet.agent('subzero', { state: 'idle', displayName: 'Sub-Zero' }),
  fleet.agent('mara', { state: 'idle' }),
];

function arm() {
  chat.setRunner((args) => (args[0] === 'display-message'
    ? { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' }
    : { ran: true, spawnFailed: false, status: 0, out: '', err: '' }));
  chat.setDryRun(false);
}
function send(input, agents = FLEET(), members = MEMBERS) {
  const board = fleet.install(agents);
  try {
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    arm();
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, ...input }, board.agents, members);
    assert.equal(sent.state, chat.DELIVERY.PLACED, sent.because || '');
    return sent;
  } finally { board.restore(); }
}
const note = (text, agents, members) => send({ text }, agents, members).ambiguousNote;

test.beforeEach(() => { chat.resetForTests(); messages.resetForTests(); roomloop.resetForTests(); try { fs.rmSync(messages.LOG, { force: true }); } catch { /* fresh */ } });
test.after(() => { chat.setRunner(null); chat.setDryRun(true); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const MEMBER_LIST = 'Members you can address: @kano, Sub-Zero (@subzero), @mara.';
test('a header name that is no member is told, with the members to address', () => {
  assert.equal(note('Leo -> Josh: done'),
    'Josh is not the name of any member of this project, so this post woke no one by it (the person still sees every post here). ' + MEMBER_LIST);
});

test('beside a member it still names the one that matched no one, and the member is reached', () => {
  const sent = send({ text: 'Leo -> Kano, Josh: the numbers' });
  assert.equal(sent.outcomes.kano, 'placed', 'the member beside the name was not woken');
  assert.match(sent.ambiguousNote, /^Josh is not the name of any member of this project/);
  assert.doesNotMatch(sent.ambiguousNote, /Kano is not/);
});

test('two such names are said together', () => {
  assert.match(note('Leo -> Josh & Dana: hi'), /^Josh and Dana are not names of any member of this project, so this post woke no one by them/);
});

test('CONTROL: a header that names members, @all, or the poster says nothing', () => {
  for (const text of ['Leo -> Kano: x', 'Leo -> Sub-Zero: x', 'Leo -> all: x', 'Leo -> everyone: x', 'Leo -> Kano, Leo: x', 'Leo to Mara: x']) {
    assert.equal(note(text), undefined, text);
  }
});

test('a member named in other words than it is stored (Sub Zero, Renet Tilley, Mona Lisa) is woken and nothing is said', () => {
  const agents = [...FLEET(), fleet.agent('renet-tilley', { state: 'idle' }), fleet.agent('monalisa', { state: 'idle', displayName: 'MonaLisa' })];
  const room = [...MEMBERS, 'renet-tilley', 'monalisa'];
  for (const [text, who] of [['Leo -> Sub Zero: x', 'subzero'], ['Leo -> Renet Tilley: x', 'renet-tilley'], ['Leo -> Mona Lisa: x', 'monalisa']]) {
    const sent = send({ text }, agents, room);
    assert.equal(sent.outcomes[who], 'placed', text + ': PRE-CONTROL, the member was not woken');
    assert.equal(sent.ambiguousNote, undefined, text);
  }
});

test('a name some member answers to, even ambiguously, says nothing (it could mean them)', () => {
  const twins = [fleet.agent('leo', { state: 'idle' }), fleet.agent('a1', { state: 'idle', displayName: 'Twin Peak' }), fleet.agent('a2', { state: 'idle', displayName: 'Twin Lake' })];
  assert.equal(note('Leo -> Twin: hello', twins, ['leo', 'a1', 'a2']), undefined);
  assert.equal(note('Leo -> Twin on m702: hello', twins, ['leo', 'a1', 'a2']), undefined);
  assert.match(note('Leo -> Josh: hello', twins, ['leo', 'a1', 'a2']), /^Josh is not the name/, 'CONTROL: the same room does speak of a name nobody has');
});

test('only the poster\'s own header counts: someone else\'s, or a sentence, says nothing', () => {
  for (const text of ['Mara -> Josh: quoted', 'Before -> After: values flow', '-> Josh: no sender', 'a note for later: nothing here', 'no header at all']) {
    assert.equal(note(text), undefined, text);
  }
});

test('an agent off the project gets the outsider sentence only, not this one too', () => {
  const n = note('Leo -> Homer: please', [...FLEET(), fleet.agent('homer', { state: 'idle' })]);
  assert.equal(n, 'homer is not on this project, so this post did not reach them. To reach them: kosmos msg homer.');
});

test('a person\'s post and a room shared with another computer get no such note', () => {
  const board = fleet.install(FLEET());
  try {
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    arm();
    assert.equal(messages.sendPost({ operator: true, project: PROJECT, text: 'Leo -> Josh: hi' }, board.agents, MEMBERS).ambiguousNote, undefined);
    assert.equal(messages.sendPost({ operator: true, project: PROJECT, text: 'You -> Josh: from the screen' }, board.agents, MEMBERS).ambiguousNote, undefined, 'a person\'s own header got the note');
  } finally { board.restore(); }
  assert.equal(send({ text: 'Leo -> Josh: shared room', federated: true }).ambiguousNote, undefined);
  assert.match(send({ text: 'Leo -> Josh: this room only', federated: false }).ambiguousNote, /^Josh is not the name/, 'CONTROL: the same post unshared is told');
});

test('a post that woke every member another way (@all) says nothing about the name beside it', () => {
  assert.equal(note('Leo -> the team: @all heads up'), undefined);
  assert.match(note('Leo -> the team: heads up'), /^the team is not the name/, 'CONTROL: without @all it is said');
});

test('a long name is cut to 60 characters', () => {
  const long = 'Abcdefghijklmnopqrstuvwxyz Abcdefghijklmnopqrstuvwxyz Abcdefghijklmnopqrstuvwxyz';
  const n = note('Leo -> ' + long + ': hi');
  assert.ok(n.startsWith(long.slice(0, 60) + ' is not the name'), n);
});


test('a topic after a comma in the header is not a name and says nothing; a name beside it still does', () => {
  for (const text of ['Leo -> Kano, heads-up on #12: x', 'Leo -> Kano, #7365 room archive: x', 'Leo -> Kano, re 3 items: x']) {
    assert.equal(note(text), undefined, text);
  }
  assert.match(note('Leo -> Kano, Josh: x'), /^Josh is not the name/, 'CONTROL: a name-shaped part beside a member is still said');
});

test('a possessive of a member name, and a name with a member word in it, say nothing (they may mean the member)', () => {
  assert.equal(note("Leo -> Kano's team: x"), undefined);
  assert.equal(note('Leo -> Josh Kano: x'), undefined);
});

test('a typo beside every member named in the header is still said (only @all silences it)', () => {
  assert.match(note('Leo -> Kano, Sub-Zero, Mara, Jsoh: x'), /^Jsoh is not the name/);
});

test('the member list is capped and says how many more', () => {
  const many = ['leo', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10'];
  const n = note('Leo -> Josh: hi', many.map((m) => fleet.agent(m, { state: 'idle' })), many);
  assert.match(n, /Members you can address: @m1, @m2, @m3, @m4, @m5, @m6, @m7, @m8 and 2 more\.$/);
});

test('the note carries no double quote (kosmos post reads it with sed up to the first one) and stays the last key', () => {
  const sent = send({ text: 'Leo -> Josh: quoted check' });
  assert.match(sent.ambiguousNote, /^Josh is not the name/);
  assert.doesNotMatch(sent.ambiguousNote, /"/);
  assert.equal(Object.keys(sent).pop(), 'ambiguousNote');
  assert.equal(note('Leo -> "Josh": hi'), undefined, 'a quoted part is not name-shaped');
});
