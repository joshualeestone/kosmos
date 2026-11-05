'use strict';
/* kosmos#8039 review 3: Claude Code's external imports question draws at startup, before the board's snapshot sees it,
 * so a just-launched card can still read idle with the question up. An idle card that has never taken a turn pays one
 * fresh read, for this question only; every other idle card pays none. Every "typed" below is measured on the argv
 * handed to tmux, as in chat.menuhold-5743.test.js.
 *
 *   node --test engine/chat.imports-idle-8039.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-imports-idle-8039-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');
const status = require('./status');
const fleet = require('../test-support/fleet');

const DIALOG = [
  '────────────────────────────────',
  '  Allow external CLAUDE.md file imports?',
  '',
  '  External imports:',
  '    /Users/someone/.claude/NOTES.md',
  '',
  '  ❯ No, disable external imports',
  '    Yes, allow external imports',
  '',
  '  Enter to confirm · Esc to cancel',
].join('\n');
const IDLE = '⏺ Done.\n\n────────\n❯ \n────────';

test.beforeEach(() => { chat.resetForTests(); });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

function arm(screen) {
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: screen, err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(() => {});
  calls.typed = () => calls.filter((a) => a[0] === 'set-buffer' || a[0] === 'paste-buffer' || a[0] === 'send-keys');
  return calls;
}
async function idleCard(screen, neverTurned, fn) {
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);
  for (const card of board.agents) card.neverTurned = neverTurned;
  try { return await fn(board, arm(screen)); } finally { chat.resetForTests(); board.restore(); }
}

test('premise: the card reads idle and the screen is the imports question', async () => {
  await idleCard(DIALOG, true, async (board) => {
    assert.equal(board.agents[0].state, status.STATE.IDLE);
    assert.equal(status.importsDialogIn(DIALOG), true);
  });
});

test('an idle card that has never taken a turn, with the question up: refused, nothing typed', async () => {
  await idleCard(DIALOG, true, async (board, calls) => {
    const v = await chat.deliverAsync('casey', 'hello', board.agents);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT, JSON.stringify(v));
    assert.match(v.because, /a message typed now would answer No/);
    assert.deepEqual(calls.typed(), [], 'something was typed at the dialog');
  });
});

test('CONTROL: the same screen on an idle card that HAS taken a turn is not read for it', async () => {
  await idleCard(DIALOG, false, async (board) => {
    const v = await chat.deliverAsync('casey', 'hello', board.agents);
    assert.doesNotMatch(String(v.because || ''), /would answer No/, JSON.stringify(v));
  });
});

test('CONTROL: a never-turned idle card at its ordinary prompt is not refused', async () => {
  await idleCard(IDLE, true, async (board) => {
    const v = await chat.deliverAsync('casey', 'hello', board.agents);
    assert.doesNotMatch(String(v.because || ''), /would answer No/, JSON.stringify(v));
  });
});
