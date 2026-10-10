'use strict';
/* #5743: while Claude Code's question menu is on an agent's screen, nothing is typed into that pane. Measured on 2.1.29x
 * (#5406): the menu ignores a paste and the Enter after it takes the HIGHLIGHTED answer. A timer's line is HELD (the
 * #4588 hold shape, so a room keeps it for the next idle flush); every other sender is refused with nothing typed.
 * chat.test.js's sandbox and scripted tmux: every "typed" below is measured on the argv handed to tmux. Cards come
 * from test-support/fleet; the screens are the real captures in test-support/claude-screens.
 *
 *   node --test engine/chat.menuhold-5743.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-menuhold-5743-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');
const status = require('./status');
const fleet = require('../test-support/fleet');

const SCREENS = path.join(__dirname, '..', 'test-support', 'claude-screens');
const MENU = fs.readFileSync(path.join(SCREENS, 'question-menu-2.1.29x.txt'), 'utf8');
const MULTISELECT = fs.readFileSync(path.join(SCREENS, 'question-menu-multiselect-2.1.29x.txt'), 'utf8');
const MULTIQUESTION = fs.readFileSync(path.join(SCREENS, 'question-menu-multiquestion-2.1.29x.txt'), 'utf8');
/* A permission prompt drawn with the same footer: not this menu (no free-answer entry), so this card leaves it alone. */
const PERMISSION = 'Bash command\n\n  ls\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No, and tell Claude what to do differently (esc)\n\nEnter to select · ↑/↓ to navigate · Esc to cancel';

test.beforeEach(() => { chat.resetForTests(); });
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
async function onScreen(screen, state, fn) {
  const spec = state === 'idle' ? { state } : { state, runner: 'claude', command: 'claude', screen };   // idle: the fleet's own idle screen
  const board = fleet.install([fleet.agent('casey', spec)]);
  try { return await fn(board, arm(screen)); } finally { chat.resetForTests(); board.restore(); }
}

test('#5743 the detector: every real menu form is up, a permission prompt and an idle screen are not', () => {
  for (const [name, s] of [['single', MENU], ['multiselect', MULTISELECT], ['multiquestion', MULTIQUESTION]]) {
    assert.equal(status.claudeQuestionMenuUp(s), true, name);
  }
  assert.equal(status.claudeQuestionMenuUp(PERMISSION), false, 'a permission prompt read as the question menu');
  assert.equal(status.claudeQuestionMenuUp('⏺ Done.\n\n────────\n❯ \n────────'), false);
  // The footer must be at the bottom: a menu scrolled up above an idle prompt is not on screen.
  const IDLE_UNDER = '\n\n⏺ Apple it is.\n\n' + '─'.repeat(40) + '\n❯ \n' + '─'.repeat(40) + '\n  bypass permissions on (shift+tab to cycle)\n';
  assert.equal(status.claudeQuestionMenuUp(MENU + IDLE_UNDER), false, 'an old menu above the prompt read as live');
});

for (const [name, screen] of [['single-select', MENU], ['multi-select', MULTISELECT], ['multi-question', MULTIQUESTION]]) {
  test(`#5743 a ${name} menu: a sender is refused with nothing typed, and a timer's line is HELD`, async () => {
    await onScreen(screen, 'needs_you', async (board, calls) => {
      const v = await chat.deliverAsync('casey', 'A room post for Casey.', board.agents);
      assert.equal(v.state, chat.DELIVERY.COULD_NOT, JSON.stringify(v));
      assert.equal(v.menu, true);
      assert.match(v.because, /showing a question on its screen/);
      assert.deepEqual(calls.typed(), [], 'something was typed into the menu');
      const h = await chat.deliverAutomaticAsync('casey', 'A task line for Casey.', board.agents);
      assert.equal(h.held, true, JSON.stringify(h));
      assert.equal(h.heldBy, 'menu');
      assert.equal(h.state, chat.DELIVERY.COULD_NOT);
      const s = chat.deliverAutomatic('casey', 'A timer line for Casey.', board.agents);
      assert.equal(s.held, true, 'the sync automatic sender typed into the menu');
      assert.deepEqual(calls.typed(), [], 'something was typed into the menu');
    });
  });
}

test('#5743 the synchronous sender is refused too', async () => {
  await onScreen(MENU, 'needs_you', async (board, calls) => {
    const v = chat.deliver('casey', 'A task line for Casey.', board.agents);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT, JSON.stringify(v));
    assert.equal(v.menu, true);
    assert.deepEqual(calls.typed(), []);
  });
});

test('#5743 CONTROLS: an idle agent and a permission prompt are typed into as before', async () => {
  await onScreen('⏺ Done.\n\n────────\n❯ \n────────\n  bypass permissions on (shift+tab to cycle)', 'idle', async (board, calls) => {
    const v = await chat.deliverAutomaticAsync('casey', 'A task line for Casey.', board.agents);
    assert.notEqual(v.held, true, JSON.stringify(v));
    assert.ok(calls.typed().length > 0, 'nothing was typed to an idle agent');
    // An ordinary delivery pays no extra screen read: only a card the snapshot already calls needs_you is looked at.
    assert.equal(calls.filter((c) => c[0] === 'capture-pane').length, 0, 'an idle agent\'s screen was read before typing');
  });
  await onScreen(PERMISSION, 'needs_you', async (board, calls) => {
    const v = await chat.deliverAsync('casey', 'A room post for Casey.', board.agents);
    assert.notEqual(v.menu, true, 'a permission prompt was refused as the question menu');
    assert.ok(calls.typed().length > 0, 'the permission-prompt path changed');
  });
});
