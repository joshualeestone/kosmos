'use strict';
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

test('the whole name and the room\'s own word for the person name them too; case and a possessive do not matter', () => {
  saveName('Dana Reyes');
  assert.equal(send('@DanaReyes please look').namesPerson, true);
  assert.equal(send('@operator please look').namesPerson, true);
  assert.equal(send('@dana please look').namesPerson, true);
  assert.equal(send("Leo -> Dana's desk: please look").namesPerson, true);
  assert.equal(send('Leo -> Dana re the lease: please look').namesPerson, true);
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
