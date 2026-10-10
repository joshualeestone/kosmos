'use strict';
/* #5732 with the #5743/#5754 floor: the own-computer nudge types nothing into a Claude agent whose screen waits on a
 * permission prompt or the question menu (an Enter there would take the highlighted answer), and its gap is not spent,
 * so the next post nudges once the screen is idle. The harness is chat.menuhold-5743.test.js's: real screen captures,
 * every "typed" measured on the argv handed to tmux.
 *
 *   node --test engine/messages.ownroomnudge-5732.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-ownroomnudge-5732-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');
const messages = require('./messages');
const fleet = require('../test-support/fleet');

const SCREENS = path.join(__dirname, '..', 'test-support', 'claude-screens');
const MENU = fs.readFileSync(path.join(SCREENS, 'question-menu-2.1.29x.txt'), 'utf8');
const PERM_BASH = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-2.1.296.txt'), 'utf8');
const IDLE = '⏺ Done.\n\n────────\n❯ \n────────\n  bypass permissions on (shift+tab to cycle)';

test.beforeEach(() => { chat.resetForTests(); messages._resetOwnPostNudgesForTests(); });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* A pane that always shows `screen`; records every tmux call. */
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
const claudeOn = (screen) => fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen });

for (const [what, screen] of [['a permission prompt', PERM_BASH], ['the question menu', MENU]]) {
  test(`#5732 a nudge to a Claude agent on ${what} types nothing, and goes out once the screen is idle`, () => {
    const now = Date.now();
    let board = fleet.install([claudeOn(screen)]);
    try {
      const calls = arm(screen);
      const r = messages.nudgeOwnComputerPost('p1', 'Plans', 'post-1', ['casey'], board.agents, now);
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(r.nudged, [], 'a held nudge was counted as sent');
      assert.deepEqual(calls.typed(), [], `typed into ${what}`);
    } finally { chat.resetForTests(); board.restore(); }
    /* The gap was not spent: a later post, a second later, reaches the agent once it is idle. */
    board = fleet.install([fleet.agent('casey', { state: 'idle' })]);
    try {
      const calls = arm(IDLE);
      const r = messages.nudgeOwnComputerPost('p1', 'Plans', 'post-2', ['casey'], board.agents, now + 1000);
      assert.equal(r.nudged.length, 1, 'the held nudge spent the gap: ' + JSON.stringify(r));
      assert.ok(calls.typed().length > 0, 'nothing was typed to the idle agent');
    } finally { chat.resetForTests(); board.restore(); }
  });
}

test('#5732 CONTROL: an idle Claude agent is nudged, with no post text in the line', () => {
  const board = fleet.install([fleet.agent('casey', { state: 'idle' })]);
  try {
    const calls = arm(IDLE);
    const r = messages.nudgeOwnComputerPost('p1', 'Plans', 'post-1', ['casey'], board.agents, Date.now());
    assert.equal(r.nudged.length, 1, JSON.stringify(r));
    const typed = calls.typed().map((a) => a.join(' ')).join('\n');
    assert.match(typed, /a new post from your other computer is in the room Plans; read it with: kosmos room p1/);
  } finally { chat.resetForTests(); board.restore(); }
});
