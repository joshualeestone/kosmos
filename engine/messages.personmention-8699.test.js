'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#8699 (agent feedback 11-17): an agent's room post that named the PERSON by the name their colleagues use
 * ("@Dana", "Leo -> Dana:") reached nobody: the phone's names-you notice fired only for a reply to the person's own
 * post, and the sender was told nothing. The board now reports such a post as namesPerson (which the /api/post route
 * turns into that same notice), and a post that woke no member says it named the person instead of saying the name
 * matched no member. A word that names any agent stays that agent's.
 *
 * Every root is sandboxed, as in messages.unmatched-8566.test.js, whose harness this mirrors.
 *
 *   node --test engine/messages.personmention-8699.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-personmention-8699-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');
const messages = require('./messages');
const you = require('./you');
const fleet = require('../test-support/fleet');
const roomloop = require('./roomloop');

const PROJECT = 'henderson-lease';
const MEMBERS = ['leo', 'kano', 'mara'];
const FLEET = (extra = []) => [
  fleet.agent('leo', { state: 'idle' }),
  fleet.agent('kano', { state: 'idle' }),
  fleet.agent('mara', { state: 'idle' }),
  ...extra,
];

function arm() {
  chat.setRunner((args) => (args[0] === 'display-message'
    ? { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' }
    : { ran: true, spawnFailed: false, status: 0, out: '', err: '' }));
  chat.setDryRun(false);
}
function send(text, agents = FLEET(), extra = {}) {
  const board = fleet.install(agents);
  try {
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    arm();
    const sent = messages.sendPost({ fromPane: '%7', project: PROJECT, text, ...extra }, board.agents, MEMBERS);
    assert.equal(sent.state, chat.DELIVERY.PLACED, sent.because || '');
    return sent;
  } finally { board.restore(); }
}
const saveName = (name) => you.save({ name, does: 'Runs a small firm' });
const forget = () => { try { fs.rmSync(you.FILE, { force: true }); } catch { /* fresh */ } };

test.beforeEach(() => { chat.resetForTests(); messages.resetForTests(); roomloop.resetForTests(); forget(); try { fs.rmSync(messages.LOG, { force: true }); } catch { /* fresh */ } });
test.after(() => { chat.setRunner(null); chat.setDryRun(true); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const NAMED = /^This post names Dana, the person who runs this computer, who sees every post here; it woke no agent\.$/;

test('an @-name of the person by their first name is reported as naming them, and the sender is told', () => {
  saveName('Dana Reyes');
  const sent = send('@Dana can you approve the lease draft?');
  assert.equal(sent.namesPerson, true, 'the post that names the person must say so, or no notice reaches them');
  assert.match(String(sent.ambiguousNote), NAMED);
});

test('the note holds no double quote, which kosmos post reads the note up to, even for a name typed with one', () => {
  saveName('Dana Reyes');
  for (const text of ['@Dana can you look?', 'Leo -> Dana: look', 'Leo -> Dana re the "lease": look']) {
    const n = String(send(text).ambiguousNote || '');
    assert.match(n, /the person who runs this computer/, text);
    assert.doesNotMatch(n, /"/, text);
  }
});

test('CONTROL: with no About-you name saved, @Dana names nobody and nothing claims it reached the person', () => {
  const sent = send('@Dana can you approve the lease draft?');
  assert.equal(sent.namesPerson, undefined);
  assert.doesNotMatch(String(sent.ambiguousNote || ''), /the person who runs this computer/);
});

test('a header to the person names them, and the header note no longer says the name matched no member', () => {
  saveName('Dana Reyes');
  const sent = send('Leo -> Dana: the draft is ready for you');
  assert.equal(sent.namesPerson, true);
  assert.match(String(sent.ambiguousNote), NAMED);
  assert.doesNotMatch(String(sent.ambiguousNote), /is not the name of any member/);
});

test('CONTROL: the same header with no name saved keeps the kosmos#8566 sentence', () => {
  const sent = send('Leo -> Dana: the draft is ready for you');
  assert.equal(sent.namesPerson, undefined);
  assert.match(String(sent.ambiguousNote), /^Dana is not the name of any member of this project, so this post woke no one by it/);
});

test('one header target is never both the person and a name no member has', () => {
  saveName('Dana Reyes');
  for (const text of ["Leo -> Dana's desk: please look", 'Leo -> Dana re the lease: please look', 'Leo -> Dana Reyes: please look']) {
    const sent = send(text);
    assert.equal(sent.namesPerson, true, text);
    assert.match(String(sent.ambiguousNote), /^This post names Dana( Reyes)?, the person who runs this computer, who sees every post here; it woke no agent\.$/, text);
    assert.doesNotMatch(String(sent.ambiguousNote), /is not the name of any member/, text);
  }
});

test('an arrow header with no sender names the person, as it addresses a member', () => {
  saveName('Dana Reyes');
  assert.equal(send('-> Dana: please look').namesPerson, true);
  assert.equal(send('-> kano: please look').namesPerson, undefined, 'CONTROL: to a member it does not');
});

test('a room shared with another computer and the person\'s own post never name the person', () => {
  saveName('Dana Reyes');
  const shared = send('@Dana shared room', FLEET(), { federated: true });
  assert.equal(shared.namesPerson, undefined);
  assert.doesNotMatch(String(shared.ambiguousNote || ''), /the person who runs this computer/);
  assert.equal(send('@Dana this room only', FLEET(), { federated: false }).namesPerson, true, 'CONTROL: unshared it does');
  const board = fleet.install(FLEET());
  try {
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    arm();
    assert.equal(messages.sendPost({ operator: true, project: PROJECT, text: '@Dana note to self' }, board.agents, MEMBERS).namesPerson, undefined);
  } finally { board.restore(); }
});

test('a reply that also names the person still says so', () => {
  saveName('Dana Reyes');
  const board = fleet.install(FLEET());
  try {
    messages.setRunner(() => ({ ok: true, session: 'kano-discord' }));
    arm();
    const asked = messages.sendPost({ fromPane: '%8', project: PROJECT, text: 'Kano -> Leo: can you check?' }, board.agents, MEMBERS);
    assert.equal(asked.state, chat.DELIVERY.PLACED, asked.because || '');
    const askedId = messages.readLog().filter((m) => m && m.kind === 'post').pop().id;
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    const reply = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@Dana checked, it is fine', replyTo: askedId }, board.agents, MEMBERS);
    assert.equal(reply.repliesToPerson, false, 'PRE-CONTROL: it answers an agent, not the person');
    assert.equal(reply.namesPerson, true);
    assert.equal(reply.ambiguousNote, undefined, 'a reply gets no sender note (kosmos#8566 gives replies none)');
  } finally { board.restore(); }
});

test('the whole name and the room\'s own word for the person name them too; case and a possessive do not matter', () => {
  saveName('Dana Reyes');
  assert.equal(send('@DanaReyes please look').namesPerson, true);
  assert.equal(send('@operator please look').namesPerson, true);
  assert.equal(send('Leo -> operator notes: please look').namesPerson, undefined, 'operator as a noun in a header is not the person');
  assert.equal(send('Leo -> operator: please look').namesPerson, true, 'CONTROL: operator as the whole target is');
  assert.equal(send('@dana please look').namesPerson, true);
});

test('CONTROL: a header to a different person who shares the first name does not name the person', () => {
  saveName('Dana Reyes');
  assert.equal(send('Leo -> Dana Smith: please look').namesPerson, undefined, 'Dana Smith is not Dana Reyes');
  assert.equal(send('Leo -> Dana Reyes: please look').namesPerson, true, 'CONTROL: the whole name does');
});

test('CONTROL: a word that is not the person, in code, or a mere mention of their name without @ does not name them', () => {
  saveName('Dana Reyes');
  assert.equal(send('@Danae please look').namesPerson, undefined, 'a longer word is not the name');
  assert.equal(send('run `@Dana` in the shell').namesPerson, undefined, 'code is not a mention');
  assert.equal(send('Dana said the lease is fine').namesPerson, undefined, 'a plain word never addresses');
  assert.equal(send('@R please look').namesPerson, undefined);
});

test('a word that names an agent on this computer is the agent, never the person', () => {
  saveName('Dana Reyes');
  const withDana = FLEET([fleet.agent('dana', { state: 'idle' })]);
  assert.equal(send('@Dana please look', withDana).namesPerson, undefined, 'an off-project agent named dana keeps the name');
  assert.equal(send('Leo -> Dana: please look', withDana).namesPerson, undefined);
  const withDanaBot = FLEET([fleet.agent('danabot', { state: 'idle', displayName: 'Dana Bot' })]);
  assert.equal(send('Leo -> Dana: please look', withDanaBot).namesPerson, undefined, 'one word of an agent name is the agent');
  assert.equal(send('@DanaReyes please look', withDanaBot).namesPerson, true, 'CONTROL: the whole name still names the person');
});

test('a post that wakes a member and names the person reports it, without the woke-no-one sentence', () => {
  saveName('Dana Reyes');
  const sent = send('@kano and @Dana: the lease draft is up');
  assert.equal(sent.namesPerson, true);
  assert.doesNotMatch(String(sent.ambiguousNote || ''), /the person who runs this computer|woke no one/);
});

test('CONTROL: an ordinary post with a name saved reports nothing', () => {
  saveName('Dana Reyes');
  const sent = send('@kano the lease draft is up');
  assert.equal(sent.namesPerson, undefined);
});
