'use strict';

/**
 * #4624: an agent's `idle` report (its turn ended) tells it, in one typed line, about the room posts
 * held for it while it worked. A `working` report does not (control), and the line is typed into that
 * agent's own pane.
 *
 * Same sandbox posture as server.liveness-refused-2558.test.js; the tmux runner is scripted so the
 * pasted text can be read.
 *
 *   node --test server.roomhold-idle-4624.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-4624-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
delete process.env.AGENT_WORKFORCE_ROOM_HOLD_OFF;

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const chat = require('./engine/chat');
const messages = require('./engine/messages');
const sendertoken = require('./engine/sendertoken');
const selfreport = require('./engine/selfreport');
const roomhold = require('./engine/roomhold');

const WHO = 'leo';
const PROJECT = 'henderson-lease';
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
});
test.beforeEach(() => {
  for (const dir of [sendertoken.DIR, selfreport.DIR, roomhold.dir()]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* not there yet */ }
  }
});
test.after(() => {
  chat.setRunner(null);
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* A tmux that answers every call as a healthy Claude pane, recording what was pasted and where. */
function scriptedTmux() {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  };
  fn.pasted = () => {
    const out = [];
    let cur = '';
    let target = null;
    for (const a of calls) {
      if (a[0] === 'set-buffer') cur += a[a.length - 1];
      else if (a[0] === 'paste-buffer') target = a[a.length - 1];
      else if (a[0] === 'send-keys' && a[a.length - 1] === 'Enter' && cur) { out.push({ text: cur, target }); cur = ''; }
    }
    return out;
  };
  return fn;
}

async function report(tok, body) {
  const res = await fetch(base + '/api/report', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok }, body: JSON.stringify(body),
  });
  return res.json();
}

async function until(pred, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await new Promise((r) => setTimeout(r, 20)); }
  return pred();
}

test('#4624: an idle report types one line about the held posts into the agent\'s pane; a working report does not', async () => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  const tmux = scriptedTmux();
  chat.setRunner(tmux);
  chat.setDryRun(false);
  const tok = sendertoken.mint(WHO).token;
  try {
    roomhold.hold(WHO, PROJECT, 'm7');
    roomhold.hold(WHO, PROJECT, 'm8');

    const w = await report(tok, { state: 'working' });
    assert.equal(w.recorded, true, JSON.stringify(w));
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(tmux.pasted(), [], 'CONTROL: a working report typed something');
    assert.deepEqual(roomhold.heldIn(WHO, PROJECT), ['m7', 'm8']);

    const i = await report(tok, { state: 'idle', auto: true });
    assert.equal(i.recorded, true, JSON.stringify(i));
    assert.ok(await until(() => roomhold.heldIn(WHO, PROJECT).length === 0, 3000), 'the idle report did not tell the agent');
    const typed = tmux.pasted();
    assert.equal(typed.length, 1, 'one line, not one per held post: ' + JSON.stringify(typed));
    assert.ok(typed[0].text.includes('2 room posts not addressed to you') && typed[0].text.includes('m7, m8'), typed[0].text);
    assert.ok(String(typed[0].target).startsWith('=leo'), 'typed into another pane: ' + typed[0].target);
  } finally {
    sendertoken.revoke(WHO);
    messages.setRunner(null);
    chat.setRunner(null);
    board.restore();
  }
});
