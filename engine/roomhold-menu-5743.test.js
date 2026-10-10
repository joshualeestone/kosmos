'use strict';
/* #5743: a colleague's room post to a Claude member whose screen shows its question menu is HELD (nothing typed into
 * the menu) and kept for that member, the #4588 hold shape; once the member is past the question, its next typed
 * arrival tells it. Same sandbox and scripted tmux as roomhold-agyhold-4588.test.js; cards from test-support/fleet,
 * the menu is the real 2.1.29x capture.
 *
 *   node --test engine/roomhold-menu-5743.test.js
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = path.join(os.tmpdir(), 'kosmos-roomhold-menu-5743-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
delete process.env.AGENT_WORKFORCE_ROOM_HOLD_OFF;

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');
const messages = require('./messages');
const roomhold = require('./roomhold');
const fleet = require('../test-support/fleet');

const MENU = fs.readFileSync(path.join(__dirname, '..', 'test-support', 'claude-screens', 'question-menu-2.1.29x.txt'), 'utf8');

function fakeTmux(screenOf) {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: screenOf(args[args.length - 1]), err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  };
  fn.typedTo = (session) => calls.filter((a) => (a[0] === 'paste-buffer' || a[0] === 'send-keys') && String(a[a.length - 1]).startsWith('=' + session));
  fn.pastedFor = (session) => {
    const out = []; let cur = '';
    for (const a of calls) {
      if (a[0] === 'set-buffer') cur += a[a.length - 1];
      else if (a[0] === 'paste-buffer') { if (String(a[a.length - 1]).startsWith('=' + session)) out.push(cur); cur = ''; }
    }
    return out;
  };
  return fn;
}
const PROJECT = 'henderson-lease';
const MEMBERS = ['leo', 'april'];

test.beforeEach(() => {
  chat.resetForTests();
  messages.resetForTests();
  for (const d of [messages.LOG, roomhold.dir()]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* fresh */ } }
});
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#5743 room: a post to a member on its question menu is held (nothing typed into the menu) and kept; the next typed arrival tells it', () => {
  // 1. april is on its menu: the post is held and kept.
  let board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('april', { state: 'needs_you', runner: 'claude', command: 'claude', screen: MENU })]);
  let first;
  try {
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    const tmux = fakeTmux(() => MENU);
    chat.setRunner(tmux); chat.setDryRun(false);
    first = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@april can you check clause 4?' }, board.agents, MEMBERS);
    assert.equal(first.outcomes.april, roomhold.HELD, JSON.stringify(first.outcomes));
    assert.deepEqual(tmux.typedTo('april'), [], 'a room post was typed into the question menu');
    assert.equal(roomhold.heldIn('april', PROJECT).length, 1, 'the held post was not kept for april');
  } finally { board.restore(); }
  // 2. april is past the question: the next post reaches it and carries the held one.
  board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('april', { state: 'idle' })]);
  try {
    chat.resetForTests();
    messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
    const tmux = fakeTmux(() => '');
    chat.setRunner(tmux); chat.setDryRun(false);
    const second = messages.sendPost({ fromPane: '%7', project: PROJECT, text: '@april and clause 5 too' }, board.agents, MEMBERS);
    assert.equal(second.state, chat.DELIVERY.PLACED, second.because || '');
    assert.notEqual(second.outcomes.april, roomhold.HELD);
    const told = tmux.pastedFor('april').join('');   // a long line goes in chunks
    assert.match(told, /and clause 5 too/, 'april was not told the new post');
    assert.ok(told.includes('(' + first.id + ')'), 'the held post did not ride the next arrival');
    assert.deepEqual(roomhold.heldIn('april', PROJECT), [], 'the held post was never released');
  } finally { board.restore(); }
});

test('#5743 room: the PERSON\'s own post to a member on its menu is refused (not held), nothing typed', () => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('april', { state: 'needs_you', runner: 'claude', command: 'claude', screen: MENU })]);
  try {
    const tmux = fakeTmux(() => MENU);
    chat.setRunner(tmux); chat.setDryRun(false);
    const sent = messages.sendPost({ operator: true, project: PROJECT, text: '@april can you check clause 4?' }, board.agents, MEMBERS);
    assert.ok(sent.outcomes && sent.outcomes.april, 'premise: april was a recipient: ' + JSON.stringify(sent));
    assert.equal(sent.outcomes.april, chat.DELIVERY.COULD_NOT, 'a person\'s post to a member on its menu was not refused: ' + JSON.stringify(sent.outcomes));
    assert.notEqual(sent.outcomes.april, roomhold.HELD, 'a person\'s post was held like a colleague\'s: ' + JSON.stringify(sent.outcomes));
    assert.deepEqual(tmux.typedTo('april'), [], 'a person\'s room post was typed into the question menu');
  } finally { board.restore(); }
});
