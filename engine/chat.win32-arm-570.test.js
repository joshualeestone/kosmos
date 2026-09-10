'use strict';
/**
 * #570 7c-4: the board talks to a Windows agent through its supervisor's pipe.
 *
 * ⚠️ EVERY CARD COMES FROM `test-support/fleet`, shaped exactly as
 * `engine/win32roster` emits a Windows row: session = name, claim = name,
 * command = `win32roster.WIN32_COMMAND`. A hand-built card could carry fields
 * `snapshot()` never emits, which is the class the fixture lint exists for.
 *
 * ⚠️ AND NOTHING HERE CAN REACH A REAL PIPE. The channel is injected with
 * `chat.setChannel`, the way tmux is injected with `setRunner`, and the suite
 * starts in dry-run like its sibling.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-chat-win32-570-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');

const chat = require('./chat');
const win32roster = require('./win32roster');
const fleet = require('../test-support/fleet');

/** A Windows agent as the win32 roster describes one. */
function windowsAgent(name, opts) {
  return fleet.agent(name, Object.assign({ ours: 'claim', command: win32roster.WIN32_COMMAND, state: 'unknown' }, opts));
}

function withFleet(specs, fn) {
  const board = fleet.install(specs);
  try { return fn(board); } finally { board.restore(); }
}

/** A scripted channel that records what it was asked to deliver. */
function fakeChannel(answer) {
  const calls = [];
  const fn = (name, text) => {
    calls.push({ name, text });
    if (typeof answer === 'function') return answer(name, text);
    return answer;
  };
  fn.calls = calls;
  return fn;
}

/** A tmux runner that records calls, so a test can prove tmux was never asked. */
function recordingTmux() {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  };
  fn.calls = calls;
  return fn;
}

test.beforeEach(() => { chat.resetForTests(); });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#570 7c-4 a message to a Windows agent goes down its channel and is PLACED, with no tmux at all', () => {
  withFleet([windowsAgent('winstream')], (board) => {
    const tmux = recordingTmux();
    chat.setRunner(tmux);
    const say = fakeChannel({ ok: true });
    chat.setChannel(say);

    const verdict = chat.deliver('winstream', 'have a look at the lease', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.PLACED);
    assert.deepEqual(say.calls, [{ name: 'winstream', text: 'have a look at the lease' }]);
    assert.equal(tmux.calls.length, 0, 'a Windows card must never reach tmux, not even the probe');
  });
});

test('#570 7c-4 the wire is the envelope, the words and the trailer, unescaped for tmux', () => {
  /* `wireText` exists because tmux reads a trailing `;` as a command separator.
     A JSON line has no such hazard, so escaping it would change the message. */
  withFleet([windowsAgent('winstream')], (board) => {
    const say = fakeChannel({ ok: true });
    chat.setChannel(say);
    chat.deliver('winstream', 'ship it;', board.agents, '[from Josh]', ' C:\\Users\\joshu\\notes.txt');
    assert.deepEqual(say.calls.map((c) => c.text), ['[from Josh] ship it; C:\\Users\\joshu\\notes.txt']);
  });
});

test('#570 7c-4 a supervisor that is down is COULD_NOT, with its sentence, so re-sending is safe', () => {
  withFleet([windowsAgent('winstream')], (board) => {
    chat.setChannel(fakeChannel({ ok: false, down: true, because: 'it is not running just now, so we did not type anything' }));
    const verdict = chat.deliver('winstream', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
    assert.match(verdict.because, /not running just now/);
  });
});

test('#570 7c-4 a refusal from the channel is COULD_NOT, and its own sentence is kept', () => {
  withFleet([windowsAgent('winstream')], (board) => {
    chat.setChannel(fakeChannel({ ok: false, because: 'that is not a caller this agent answers' }));
    const verdict = chat.deliver('winstream', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
    assert.match(verdict.because, /not a caller this agent answers/);
  });
});

test('#570 7c-4 an UNSURE channel answer is UNCONFIRMED, never could_not', () => {
  /* The one mapping that decides whether somebody sends a message twice. */
  withFleet([windowsAgent('winstream')], (board) => {
    chat.setChannel(fakeChannel({ ok: false, unsure: true, because: 'it did not answer us in time, so we cannot tell whether it arrived' }));
    const verdict = chat.deliver('winstream', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.UNCONFIRMED);
    assert.match(verdict.because, /cannot tell whether it arrived/);
  });
});

test('#570 7c-4 a channel that THROWS is UNCONFIRMED: we cannot claim nothing was typed', () => {
  withFleet([windowsAgent('winstream')], (board) => {
    chat.setChannel(() => { const e = new Error('boom'); e.code = 'EBOOM'; throw e; });
    const verdict = chat.deliver('winstream', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.UNCONFIRMED);
    assert.match(verdict.because, /EBOOM/);
  });
});

test('#570 7c-4 the shared gates still refuse FIRST, and the channel is never asked', () => {
  withFleet([windowsAgent('winstream'), windowsAgent('squatter', { ours: false })], (board) => {
    const say = fakeChannel({ ok: true });
    chat.setChannel(say);
    const cases = [
      ['an empty message', () => chat.deliver('winstream', '   ', board.agents)],
      ['a roster we could not read', () => chat.deliver('winstream', 'hi', null)],
      ['a name we cannot see', () => chat.deliver('nobody', 'hi', board.agents)],
      ['a session we cannot tie to this agent', () => chat.deliver('squatter', 'hi', board.agents)],
      ['a trailer with a newline in it', () => chat.deliver('winstream', 'hi', board.agents, null, 'a\nb')],
    ];
    for (const [label, send] of cases) {
      assert.equal(send().state, chat.DELIVERY.COULD_NOT, label);
    }
    assert.equal(say.calls.length, 0, 'no refused message may reach a Windows agent');
  });
});

test('#570 7c-4 a Mac card still goes through tmux, and the channel is not asked', () => {
  withFleet([fleet.agent('casey', { state: 'idle' })], (board) => {
    const tmux = recordingTmux();
    chat.setRunner(tmux);
    chat.setDryRun(false);
    const say = fakeChannel({ ok: true });
    chat.setChannel(say);

    const verdict = chat.deliver('casey', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.PLACED);
    assert.equal(say.calls.length, 0);
    assert.ok(tmux.calls.some((args) => args[0] === 'send-keys'), 'the Mac path is unchanged');
  });
});

test('#570 7c-4 in dry-run with no channel, nothing is sent and the verdict says so', () => {
  withFleet([windowsAgent('winstream')], (board) => {
    assert.equal(chat.DRY_RUN, true);
    const verdict = chat.deliver('winstream', 'hello', board.agents);
    assert.equal(verdict.state, chat.DELIVERY.COULD_NOT);
    assert.match(verdict.because, /without permission to touch agents/);
  });
});

test('#570 7c-4 clearing the channel re-arms dry-run, the same interlock as the tmux seam', () => {
  chat.setRunner(recordingTmux());
  chat.setDryRun(false);
  chat.setChannel(fakeChannel({ ok: true }));
  chat.setChannel(null);
  assert.equal(chat.DRY_RUN, true);
});
