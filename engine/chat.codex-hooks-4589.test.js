'use strict';

/**
 * #4589 (Josh, 2026-09-29 11:42): a new Codex agent stopped on Codex's "hooks need review" dialog, and Kosmos
 * typed the person's first message into it: the text vanished and Enter opened the review table. Reproduced on
 * this Mac with Codex 0.149.1 and one project hook; both screens are real captures in test-support/codex-screens/.
 *
 * Pins: the detector finds both screens and only when the dialog is the last thing on screen; the card says
 * "waiting on a Codex hook approval"; delivery reads the screen FRESH and types nothing into the dialog, whatever
 * the snapshot says; a bare option number the menu offers still goes through (the person answering it); a stale
 * snapshot does not refuse once the screen shows the prompt again. The CONTROL arms prove the harness types.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-codex-hooks-4589-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');

const chat = require('./chat');
const status = require('./status');
const fleet = require('../test-support/fleet');

const SCREENS = path.join(__dirname, '..', 'test-support', 'codex-screens');
const MENU = fs.readFileSync(path.join(SCREENS, 'hook-review-menu-0.149.1.txt'), 'utf8');
const TABLE = fs.readFileSync(path.join(SCREENS, 'hook-review-table-0.149.1.txt'), 'utf8');
const IDLE = `╭────────────────────────────────────────────────╮
│ >_ OpenAI Codex (v0.149.1)                     │
╰────────────────────────────────────────────────╯
› Ask Codex to do anything
  gpt-5.6-sol default · ~/projects/newsletter`;
const DIR_TRUST = `> You are in /Users/you/projects/newsletter
  Do you trust the contents of this directory?
› 1. Yes, continue
  2. No, quit
  Press enter to continue`;

function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }
function refused() { return { ran: true, spawnFailed: false, status: 1, out: '', err: 'no' }; }
const okProbe = () => ok('2.1.212\t\t0\n');
/* The chat suite's scripted tmux, reduced: display-message is the pane probe; every other call takes the next
   scripted answer, so the FIRST answer is the capture the new floor takes. */
function arm(answers) {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return okProbe();
    return answers.length ? answers.shift() : ok();
  };
  fn.calls = calls;
  fn.captures = () => calls.filter((a) => a[0] === 'capture-pane');
  fn.typedInto = () => calls.filter((a) => a[0] === 'set-buffer' || a[0] === 'paste-buffer' || a[0] === 'send-keys');
  chat.setRunner(fn);
  chat.setDryRun(false);
  chat.setPauser(() => {});
  return fn;
}
/* The fleet fixture checks the engine classifies each screen as the state asked for, so the dialog screens are
   asked for as needs_you: that check is itself the card pin's first half. */
function withCodex(screen, fn) {
  const state = status.codexHookReview(screen) ? 'needs_you' : 'idle';
  const board = fleet.install([fleet.agent('sam', { state, runner: 'codex', command: 'node', screen })]);
  try { return fn(board); } finally { board.restore(); }
}

test.beforeEach(() => { chat.resetForTests(); });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#4589 detector: both captured screens, read from the raw padded capture', () => {
  assert.deepEqual(status.codexHookReview(MENU), { screen: 'menu', evidence: 'Hooks need review' });
  assert.deepEqual(status.codexHookReview(TABLE), { screen: 'table', evidence: '2 hooks need review before they can run.' });
  assert.ok(MENU.split('\n').length > 40 && MENU.split('\n').slice(-25).every((r) => !r.trim()),
    'the fixture keeps the real padding: the menu is at the top and the last 25 rows are blank');
  // The card's own wording (Josh's agent, four plugin hooks), as one table screen would draw it.
  assert.equal(status.codexHookReview('  ⚠ 4 hooks need review before they can run.\n  Stop  2  0  2\n  Press t to trust all; enter to review hooks; esc to close').screen, 'table');
});

test('#4589 detector: not the prompt, not another dialog, not the words in an agent\'s output', () => {
  assert.equal(status.codexHookReview(IDLE), null);
  assert.equal(status.codexHookReview(DIR_TRUST), null, 'the directory-trust prompt is a different dialog, handled by trustCodexFolder');
  assert.equal(status.codexHookReview(''), null);
  assert.equal(status.codexHookReview(null), null);
  // The dialog's words quoted in tool output, with Codex's prompt below: the dialog is not the last thing on screen.
  assert.equal(status.codexHookReview(TABLE.trimEnd() + '\n\n' + IDLE), null);
  assert.equal(status.codexHookReview(MENU.trimEnd() + '\n• I saw that screen earlier.\n› Ask Codex to do anything'), null);
  // The menu footer alone is generic Codex wording: without the "Hooks need review" title it is not this dialog.
  assert.equal(status.codexHookReview('› 1. Something\n  2. Else\n  Press enter to confirm or esc to go back'), null);
});

test('#4589 the card: a Codex agent on either screen needs the person, and says what for', () => {
  for (const [name, screen] of [['menu', MENU], ['table', TABLE]]) {
    withCodex(screen, (board) => {
      const card = board.agents.find((a) => a.name === 'sam');
      assert.equal(card.state, status.STATE.NEEDS_YOU, name + ': ' + card.state + ' / ' + card.because);
      assert.equal(card.because, 'it is waiting on a Codex hook approval', name);
      assert.ok(status.isCodexHookEvidence(card.stateEvidence), name + ' evidence: ' + card.stateEvidence);
    });
  }
  withCodex(IDLE, (board) => {
    assert.equal(board.agents.find((a) => a.name === 'sam').state, status.STATE.IDLE, 'CONTROL: the prompt is still idle');
  });
});

test('#4589 delivery: nothing is typed into either screen; the sender is told why', () => {
  for (const [name, screen] of [['menu', MENU], ['table', TABLE]]) {
    withCodex(IDLE, (board) => {   // the snapshot says idle: the dialog drew after it, the startup case
      const tmux = arm([ok(screen)]);
      const v = chat.deliver('sam', 'Hello Sam, please summarise the brief', board.agents);
      assert.equal(v.state, chat.DELIVERY.COULD_NOT, name);
      assert.equal(v.because, status.CODEX_HOOK_DIALOG_SENTENCE, name);
      assert.equal(tmux.captures().length, 1, name + ': the screen was read fresh');
      assert.deepEqual(tmux.typedInto(), [], name + ': nothing reached the pane');
    });
  }
});

test('#4589 CONTROL: the same send to a Codex agent at its prompt is typed and submitted', () => {
  withCodex(IDLE, (board) => {
    const tmux = arm([ok(IDLE)]);
    const v = chat.deliver('sam', 'Hello Sam, please summarise the brief', board.agents);
    assert.equal(v.state, chat.DELIVERY.PLACED, v.because);
    assert.ok(tmux.typedInto().some((a) => a[0] === 'paste-buffer'), 'the harness can type, so the refusal above is the floor');
    assert.ok(tmux.typedInto().some((a) => a[0] === 'send-keys' && a[a.length - 1] === 'Enter'));
  });
});

test('#4589 answering the menu from the card: an offered option number goes through; anything else does not', () => {
  withCodex(MENU, (board) => {
    const tmux = arm([ok(MENU)]);
    const v = chat.deliver('sam', '3', board.agents);
    assert.equal(v.state, chat.DELIVERY.PLACED, 'the person chose "Continue without trusting": ' + v.because);
    assert.ok(tmux.typedInto().length > 0);
  });
  withCodex(MENU, (board) => {
    const tmux = arm([ok(MENU)]);
    assert.equal(chat.deliver('sam', '7', board.agents).state, chat.DELIVERY.COULD_NOT, 'the menu offers no 7');
    assert.deepEqual(tmux.typedInto(), []);
  });
  withCodex(TABLE, (board) => {
    const tmux = arm([ok(TABLE)]);
    assert.equal(chat.deliver('sam', '2', board.agents).state, chat.DELIVERY.COULD_NOT, 'the table has no numbered options: a 2 is text');
    assert.deepEqual(tmux.typedInto(), []);
  });
});

test('#4589 the snapshot: refuses when the fresh read fails, never when the fresh read shows the prompt', () => {
  withCodex(TABLE, (board) => {   // the snapshot names the dialog
    const tmux = arm([refused()]);
    const v = chat.deliver('sam', 'hello', board.agents);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT, 'a read that failed does not let a known dialog through');
    assert.deepEqual(tmux.typedInto(), []);
  });
  withCodex(TABLE, (board) => {
    const tmux = arm([ok(IDLE)]);
    const v = chat.deliver('sam', 'hello', board.agents);
    assert.equal(v.state, chat.DELIVERY.PLACED, 'the person has answered: a snapshot one poll old must not refuse: ' + v.because);
    assert.ok(tmux.typedInto().length > 0);
  });
});

test('#4589 only Codex agents pay the extra read', () => {
  const board = fleet.install([fleet.agent('ada', { state: 'idle' })]);
  try {
    const tmux = arm([]);
    chat.deliver('ada', 'hello', board.agents);
    assert.equal(tmux.captures().length, 0, 'a Claude agent is not captured before a send');
  } finally { board.restore(); }
});
