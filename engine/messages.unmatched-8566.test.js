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
test('a post that woke no one, headed to a name no member has, is told which name and whom it can address', () => {
  assert.equal(note('Leo -> Josh: done'),
    'Josh is not the name of any member of this project, so this post woke no one by it (the person still sees every post here). ' + MEMBER_LIST);
  assert.match(note('Leo → Josh: arrow'), /^Josh is not the name/);
  assert.match(note('Leo -> the team: hi'), /^The team is not the name/, 'a group word that woke no one is worth saying (capitalised to start the sentence)');
});

test('two such names are said together', () => {
  assert.match(note('Leo -> Josh & Dana: hi'), /^Josh and Dana are not names of any member of this project, so this post woke no one by them/);
});

test('a post that woke anyone says nothing: a member beside the name, an @-name, or @all', () => {
  for (const text of ['Leo -> Kano, Josh: x', 'Leo -> Josh: @kano look', 'Leo -> Josh: @all heads up', 'Leo -> Kano, heads up: x', 'Leo -> Kano, Blocked: x']) {
    const sent = send({ text });
    assert.ok(Object.values(sent.outcomes).includes('placed'), text + ': PRE-CONTROL, someone was woken');
    assert.equal(sent.ambiguousNote, undefined, text);
  }
  assert.match(note('Leo -> Josh: heads up'), /^Josh is not the name/, 'CONTROL: the same name alone is said');
});

test('CONTROL: a header that names members, @all, or the poster says nothing', () => {
  for (const text of ['Leo -> Kano: x', 'Leo -> Sub-Zero: x', 'Leo -> all: x', 'Leo -> everyone: x', 'Leo -> Leo: x']) {
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

test('a name that may mean a member says nothing: a word, a hyphen part, a possessive, or a run inside a run-together name', () => {
  const agents = [...FLEET(), fleet.agent('renet-tilley', { state: 'idle' }), fleet.agent('monalisa', { state: 'idle', displayName: 'MonaLisa' }),
    fleet.agent('icecreamkitty', { state: 'idle' }), fleet.agent('pigeonpete', { state: 'idle', displayName: 'PigeonPete' })];
  const room = [...MEMBERS, 'renet-tilley', 'monalisa', 'icecreamkitty', 'pigeonpete'];
  for (const text of ['Leo -> Renet: x', 'Leo -> Zero: x', "Leo -> Kano's team: x", 'Leo -> Josh Kano: x', 'Leo -> Kitty: x', 'Leo -> Mona: x', 'Leo -> Pete: x']) {
    assert.equal(note(text, agents, room), undefined, text);
  }
  assert.match(note('Leo -> Josh: x', agents, room), /^Josh is not the name/, 'CONTROL: the same room speaks of a name nobody has');
  assert.match(note('Leo -> Ma: x', agents, room), /^Ma is not the name/, 'a two-letter name inside a member name (mara) is too short to mean them');
});

test('a name members share, even ambiguously, says nothing (it could mean them)', () => {
  const twins = [fleet.agent('leo', { state: 'idle' }), fleet.agent('a1', { state: 'idle', displayName: 'Twin Peak' }), fleet.agent('a2', { state: 'idle', displayName: 'Twin Lake' })];
  assert.equal(note('Leo -> Twin: hello', twins, ['leo', 'a1', 'a2']), undefined);
  assert.match(note('Leo -> Josh: hello', twins, ['leo', 'a1', 'a2']), /^Josh is not the name/, 'CONTROL');
});

test('only the poster\'s own arrow header counts: someone else\'s, the word form, a topic, or a sentence say nothing', () => {
  for (const text of ['Mara -> Josh: quoted', 'Before -> After: values flow', '-> Josh: no sender', 'Leo to Josh: word form', 'Leo for the record: x',
    'Leo -> Josh on m702: x', 'Leo -> heads-up on #12: x', 'Leo -> Everyone on the project now: x', 'a note for later: nothing here', 'no header at all',
    'Leo -> Josh\tDana: tab']) {
    assert.equal(note(text), undefined, text);
  }
});

test('an agent off the project gets the outsider sentence only, not this one too', () => {
  const n = note('Leo -> Homer: please', [...FLEET(), fleet.agent('homer', { state: 'idle' })]);
  assert.equal(n, 'homer is not on this project, so this post did not reach them. To reach them: kosmos msg homer.');
});

test('a reply says nothing (it wakes the author it answers, whatever its header names)', () => {
  const board = fleet.install(FLEET());
  try {
    messages.setRunner(() => ({ ok: true, session: 'kano-discord' }));
    arm();
    const asked = messages.sendPost({ fromPane: '%8', project: PROJECT, text: 'Kano -> Leo: can you check?' }, board.agents, MEMBERS);
    assert.equal(asked.state, chat.DELIVERY.PLACED, asked.because || '');
    const askedId = messages.readLog().filter((m) => m && m.kind === 'post').pop().id;
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    const reply = messages.sendPost({ fromPane: '%7', project: PROJECT, text: 'Leo -> Josh: done', replyTo: askedId }, board.agents, MEMBERS);
    assert.equal(reply.outcomes.kano, 'placed', 'PRE-CONTROL: the reply woke the author it answered');
    assert.equal(reply.ambiguousNote, undefined);
  } finally { board.restore(); }
});

test('a room of the poster alone says nothing (there is no one to address; the CLI says it woke no one, kosmos#8569)', () => {
  for (const text of ['Leo -> all: x', 'Leo -> Everyone: y', 'Leo -> Josh: z']) assert.equal(note(text, FLEET(), ['leo']), undefined, text);
  assert.match(note('Leo -> Josh: z2', FLEET(), ['leo', 'kano']), /^Josh is not the name/, 'CONTROL: one other member and it is said');
});

test('a long display name with a wide character at the cut leaves no lone surrogate', () => {
  const agents = [fleet.agent('leo', { state: 'idle' }), fleet.agent('wide', { state: 'idle', displayName: 'Q'.repeat(39) + '\u{1F600}x' })];
  const n = note('Leo -> Josh: hi', agents, ['leo', 'wide']);
  assert.doesNotMatch(JSON.stringify(n), /\\ud8/i, n);
});

test('a person\'s post and a room shared with another computer get no such note', () => {
  const board = fleet.install(FLEET());
  try {
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    arm();
    assert.equal(messages.sendPost({ operator: true, project: PROJECT, text: 'Leo -> Josh: hi' }, board.agents, MEMBERS).ambiguousNote, undefined);
    assert.equal(messages.sendPost({ operator: true, project: PROJECT, text: 'You -> Josh: from the screen' }, board.agents, MEMBERS).ambiguousNote, undefined);
  } finally { board.restore(); }
  assert.equal(send({ text: 'Leo -> Josh: shared room', federated: true }).ambiguousNote, undefined);
  assert.match(send({ text: 'Leo -> Josh: this room only', federated: false }).ambiguousNote, /^Josh is not the name/, 'CONTROL: the same post unshared is told');
});

test('a long name is cut to 60 characters, and a long member display name to 40', () => {
  const long = 'Abcdefghijklmnopqrstuvwxyz Bcdefghijklmnopqrstuvwxyz Cdefghijklmnopqrstuvwxyz';
  assert.ok(note('Leo -> ' + long + ': hi').startsWith(long.slice(0, 60) + ' is not the name'));
  const agents = [fleet.agent('leo', { state: 'idle' }), fleet.agent('longone', { state: 'idle', displayName: 'Q'.repeat(70) })];
  assert.match(note('Leo -> Josh: hi', agents, ['leo', 'longone']), new RegExp('Members you can address: ' + 'Q'.repeat(40) + ' \\(@longone\\)\\.$'));
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

/* kosmos#8569 item 2: one name in two spellings is said once, and a possessive is said as the name. */
test('kosmos#8569: a name given twice in different case is said once, and a possessive is said as the name', () => {
  assert.match(note('Leo -> Josh & josh: hi'), /^Josh is not the name of any member of this project, so this post woke no one by it/);
  const poss = note("Leo -> Josh's: hi");   // one post: the same text again would fold as a retry and carry no note
  assert.match(poss, /^Josh is not the name of any member/);
  assert.doesNotMatch(poss, /Josh's/, 'the possessive was printed as written');
  assert.match(note('Leo -> Josh & Dana: hi'), /^Josh and Dana are not names/, 'CONTROL: two different names are both said');
});

test("kosmos#8569: a possessive naming an agent off the project is read as that agent, so it gets the outsider sentence", () => {
  const n = note("Leo -> Homer's: please", [...FLEET(), fleet.agent('homer', { state: 'idle' })]);
  assert.equal(n, 'homer is not on this project, so this post did not reach them. To reach them: kosmos msg homer.');
});
