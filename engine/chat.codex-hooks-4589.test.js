'use strict';

/**
 * #4589 (Josh, 2026-09-29 11:42): a new Codex agent stopped on Codex's "hooks need review" dialog, and Kosmos
 * typed the person's first message into it: the text vanished and Enter opened the review table. Reproduced on
 * this Mac with Codex 0.149.1 and one project hook; both screens are real captures in test-support/codex-screens/.
 *
 * Pins: the detector finds both screens and only when the dialog is the last thing on screen; the card says
 * "waiting on a Codex hook approval"; delivery reads the screen FRESH and types nothing into the dialog, not even
 * an option number, whatever the snapshot says; a stale snapshot does not refuse once the screen shows the prompt
 * again. The CONTROL arms prove the harness types, including into this very screen when the floor does not apply.
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
/* Round 5: one hook's review, reached by Enter on the table; its footer is "Press t to trust; esc to go back". */
const HOOK = fs.readFileSync(path.join(SCREENS, 'hook-review-hook-0.149.1.txt'), 'utf8');
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

test('#4589 no option number either: whoever sends it, nothing chooses for the person', () => {
  /* deliverWithGap cannot tell the person's button from another agent's message, a task line or a room post, and
     "Trust all and continue" lets hooks run outside the sandbox. So even a number the menu offers is refused. */
  for (const [name, screen, raw] of [['menu 2 (Trust all)', MENU, '2'], ['menu 3', MENU, '3'], ['table 2', TABLE, '2'], ['table t', TABLE, 't']]) {
    withCodex(screen, (board) => {
      const tmux = arm([ok(screen)]);
      assert.equal(chat.deliver('sam', raw, board.agents).state, chat.DELIVERY.COULD_NOT, name);
      assert.deepEqual(tmux.typedInto(), [], name + ': nothing reached the pane');
    });
  }
});

test('#4589 CONTROL: the same real dialog screen on an agent the floor does not cover IS typed into', () => {
  /* The regression direction, pinned in-tree: take away the Codex runner (the floor's only key) and the identical
     screen and message go straight into the pane with Enter, which is what main did to every Codex agent. */
  const board = fleet.install([fleet.agent('sam', { state: 'unknown', screen: MENU })]);
  try {
    const tmux = arm([]);
    const v = chat.deliver('sam', 'Hello Sam, please summarise the brief', board.agents);
    assert.equal(v.state, chat.DELIVERY.PLACED, v.because);
    assert.ok(tmux.typedInto().some((a) => a[0] === 'paste-buffer'));
    assert.ok(tmux.typedInto().some((a) => a[0] === 'send-keys' && a[a.length - 1] === 'Enter'));
  } finally { board.restore(); }
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
    const v = chat.deliver('ada', 'hello', board.agents);
    assert.equal(v.state, chat.DELIVERY.PLACED, 'the send went through, so the zero below is "sent without a read": ' + v.because);
    assert.equal(tmux.captures().length, 0, 'a Claude agent is not captured before a send');
  } finally { board.restore(); }
});

/* Blind review round 1 (2026-09-29): two ways a message still reached the dialog as raw keystrokes. */
const narrow = (txt, w) => txt.split('\n').flatMap((r) => {
  r = r.replace(/\s+$/, '');
  if (!r) return [''];
  const out = [];
  for (let i = 0; i < r.length; i += w) out.push(r.slice(i, i + w));
  return out;
}).join('\n');

test('#4589 round 1: a fresh read that comes back BLANK (Codex still drawing) types nothing', () => {
  withCodex(IDLE, (board) => {   // the startup snapshot: not the dialog
    for (const blank of ['', '\n\n   \n']) {
      const tmux = arm([ok(blank)]);
      const v = chat.deliver('sam', 'Hello Sam, 2 things to do', board.agents);
      assert.equal(v.state, chat.DELIVERY.COULD_NOT, JSON.stringify(blank));
      assert.equal(v.because, status.CODEX_STARTING_SENTENCE);
      assert.deepEqual(tmux.typedInto(), [], 'text reached a pane whose screen was blank');
    }
  });
});

test('#4589 round 1: the footer wrapped on a narrow pane is still the dialog, and nothing is typed', () => {
  for (const [name, screen] of [['table@50', narrow(TABLE, 50)], ['table@30', narrow(TABLE, 30)], ['menu@30', narrow(MENU, 30)], ['menu@20', narrow(MENU, 20)]]) {
    assert.ok(status.codexHookReview(screen), name + ' was not recognised once its footer wrapped');
    withCodex(IDLE, (board) => {
      const tmux = arm([ok(screen)]);
      assert.equal(chat.deliver('sam', 'the letter t', board.agents).state, chat.DELIVERY.COULD_NOT, name);
      assert.deepEqual(tmux.typedInto(), [], name + ': typed into a wrapped dialog');
    });
  }
  /* CONTROL: the wrapped dialog quoted in the agent's output, with its prompt below, is still not the dialog. */
  assert.equal(status.codexHookReview(narrow(TABLE, 30).trimEnd() + '\n\n' + IDLE), null);
});

/* Blind review round 2 (2026-09-29). */
test('#4589 round 2: a fresh read that FAILS is not proof there is no dialog: nothing is typed, even on an idle snapshot', () => {
  withCodex(IDLE, (board) => {
    const tmux = arm([refused()]);
    const v = chat.deliver('sam', 'hello', board.agents);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT);
    assert.equal(v.because, status.CODEX_UNSEEN_SENTENCE);
    assert.deepEqual(tmux.typedInto(), []);
  });
});

test('#4589 round 2: Stop now\'s keys obey the same rule (no Escape into the dialog); CONTROL at the prompt', () => {
  withCodex(TABLE, (board) => {
    const tmux = arm([ok(TABLE)]);
    const r = chat.interrupt('sam', board.agents);
    assert.equal(r.ok, false);
    assert.equal(r.because, status.CODEX_HOOK_DIALOG_SENTENCE);
    assert.deepEqual(tmux.typedInto(), [], 'Stop now pressed a key into the hook dialog');
  });
  withCodex(IDLE, (board) => {
    const tmux = arm([ok(IDLE)]);
    assert.equal(chat.interrupt('sam', board.agents).ok, true, 'CONTROL: at its prompt a Codex agent can still be stopped');
    assert.ok(tmux.typedInto().some((a) => a[0] === 'send-keys' && a[a.length - 1] === 'Escape'));
  });
});

test('#4589 round 2: a native codex pane before its runner tag lands is Codex, so the fresh read still guards it', () => {
  /* Asked for as needs_you: the engine must see this untagged pane as Codex to classify the menu at all. */
  const board = fleet.install([fleet.agent('sam', { state: 'needs_you', runner: '', command: 'codex', screen: MENU })]);
  try {
    const card = board.agents.find((a) => a.name === 'sam');
    assert.equal(card.runner, 'codex', 'an untagged native codex pane read as ' + card.runner);
    const tmux = arm([ok(MENU)]);
    assert.equal(chat.deliver('sam', 'hello', board.agents).state, chat.DELIVERY.COULD_NOT);
    assert.deepEqual(tmux.typedInto(), []);
  } finally { board.restore(); }
});

test('#4589 round 4: a demo board (dry-run, no runner) gets the dry-run answer, not "we could not see its screen"', () => {
  withCodex(TABLE, (board) => {
    chat.setRunner(null);   // no runner: dry-run, as a demo or fixture board runs (setRunner(null) forces it)
    const v = chat.deliver('sam', 'hello', board.agents);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT);
    assert.notEqual(v.because, status.CODEX_UNSEEN_SENTENCE, 'a demo board was told it could not see the screen');
    assert.match(v.because, /without permission to touch agents/, 'not the dry-run answer: ' + v.because);
  });
});

test('#4589 round 4: with an injected runner the rule still applies even under dry-run (the runner types)', () => {
  withCodex(TABLE, (board) => {
    const tmux = arm([ok(TABLE)]);
    chat.setDryRun(true);
    assert.equal(chat.deliver('sam', 'hello', board.agents).because, status.CODEX_HOOK_DIALOG_SENTENCE);
    assert.deepEqual(tmux.typedInto(), []);
  });
});

test('#4589 round 5: the per-hook review screen (a single "t" trusts that hook) is recognised and nothing is typed', () => {
  assert.equal(status.codexHookReview(HOOK).screen, 'hook');
  assert.equal(status.codexHookReview(narrow(HOOK, 30)).screen, 'hook', 'wrapped at 30 columns');
  assert.equal(status.codexHookReview('some output\n  Press t to trust; esc to go back'), null, 'the footer words alone are not the screen');
  assert.equal(status.codexHookReview(HOOK.trimEnd() + '\n\n' + IDLE), null, 'CONTROL: quoted, with the prompt below');
  withCodex(HOOK, (board) => {
    const tmux = arm([ok(HOOK)]);
    const v = chat.deliver('sam', 'the letter t', board.agents);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT);
    assert.equal(v.because, status.CODEX_HOOK_DIALOG_SENTENCE);
    assert.deepEqual(tmux.typedInto(), [], 'typed into one hook\'s review');
  });
});

test('#4589 round 6: a hook with a very long command (its anchors far above) is still the per-hook screen', () => {
  const rows = HOOK.split('\n');
  const at = rows.findIndex((r) => /^\s*Command\s/.test(r));
  assert.ok(at > 0, 'the fixture has no Command row');
  const long = Array.from({ length: 40 }, (_, i) => '            echo line ' + i + ' of an inline hook script');
  const screen = [...rows.slice(0, at + 1), ...long, ...rows.slice(at + 1)].join('\n');
  const r = status.codexHookReview(screen);
  assert.ok(r && r.screen === 'hook', 'a 40-line command hid the per-hook screen');
  withCodex(HOOK, (board) => {
    const tmux = arm([ok(screen)]);
    assert.equal(chat.deliver('sam', 'the letter t', board.agents).state, chat.DELIVERY.COULD_NOT);
    assert.deepEqual(tmux.typedInto(), []);
  });
});
