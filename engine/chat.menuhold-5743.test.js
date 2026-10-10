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

/* Up = either kind (wording or shape); the floor refuses on both. */
const permissionUp = (t) => status.claudePermissionPromptKind(t) !== null;
const SCREENS = path.join(__dirname, '..', 'test-support', 'claude-screens');
const MENU = fs.readFileSync(path.join(SCREENS, 'question-menu-2.1.29x.txt'), 'utf8');
const MULTISELECT = fs.readFileSync(path.join(SCREENS, 'question-menu-multiselect-2.1.29x.txt'), 'utf8');
const MULTIQUESTION = fs.readFileSync(path.join(SCREENS, 'question-menu-multiquestion-2.1.29x.txt'), 'utf8');
/* #5754: Claude's permission prompts, real captures (2.1.296) and a SYNTHETIC one with the select footer (not captured). Not the question menu (no
   free-answer entry), but the floor refuses and holds on them too: their Enter approves the highlighted Yes. */
const PERM_BASH = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-2.1.296.txt'), 'utf8');
const PERM_EDIT = fs.readFileSync(path.join(SCREENS, 'permission-prompt-edit-2.1.296.txt'), 'utf8');
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
  assert.equal(status.claudeQuestionMenuUp(MENU + '\n\n⏺ Apple it is.\n\n' + PERMISSION), false, 'an old menu in scrollback above a live permission prompt read as live');
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
      assert.match(v.because, /showing a question on its screen/);
      // The direct-message route answers only the single-select form by number, so only that form is pointed there.
      if (name === 'single-select') assert.match(v.because, /by its number in its direct messages/);
      else assert.doesNotMatch(v.because, /direct messages/, 'a form the direct messages cannot answer was pointed there');
      assert.deepEqual(calls.typed(), [], 'something was typed into the menu');
      const h = await chat.deliverAutomaticAsync('casey', 'A line for Casey.', board.agents);
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
    const v = chat.deliver('casey', 'A line for Casey.', board.agents);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT, JSON.stringify(v));
    assert.deepEqual(calls.typed(), []);
  });
});

test('#5743 CONTROL: an idle agent is typed into as before, and pays no screen read', async () => {
  await onScreen('⏺ Done.\n\n────────\n❯ \n────────\n  bypass permissions on (shift+tab to cycle)', 'idle', async (board, calls) => {
    const v = await chat.deliverAutomaticAsync('casey', 'A line for Casey.', board.agents);
    assert.notEqual(v.held, true, JSON.stringify(v));
    assert.ok(calls.typed().length > 0, 'nothing was typed to an idle agent');
    // An idle card's screen is not read (it cannot be showing any of the three screens).
    assert.equal(calls.filter((c) => c[0] === 'capture-pane').length, 0, 'an idle agent\'s screen was read before typing');
  });
});

test('#5754 the detector: both real permission prompts and an older footer are up; the question menus, trust and idle are not', () => {
  for (const [name, t] of [['bash', PERM_BASH], ['edit', PERM_EDIT], ['older footer', PERMISSION]]) {
    assert.equal(permissionUp(t), true, name);
  }
  for (const [name, t] of [['menu', MENU], ['multiselect', MULTISELECT], ['multiquestion', MULTIQUESTION]]) {
    assert.equal(permissionUp(t), false, name + ' read as a permission prompt');
  }
  // A question MENU whose question begins "Do you want to" is the menu (its own sentence), not a permission prompt.
  const DWT = MENU.replace('Which fruit do you want?', 'Do you want to use TypeScript?');
  assert.equal(status.claudeQuestionMenuUp(DWT), true, 'premise: the reworded menu is still the menu');
  assert.equal(permissionUp(DWT), false, 'a "Do you want to" question menu read as a permission prompt');
  // The plan-approval wording (not yet captured; same select dialog).
  assert.equal(permissionUp(' Would you like to proceed?\n ❯ 1. Yes, and auto-accept edits\n   2. No, keep planning\n\n Esc to cancel · Tab to amend'), true);
  const TRUST = ' Quick safety check: Is this a project you created or one you trust?\n\n ❯ No, exit\n   Yes, I trust this folder\n\n Enter to confirm · Esc to cancel';
  assert.equal(permissionUp(TRUST), false, 'the trust dialog (its own floor) read as a permission prompt');
  const IDLE_UNDER = '\n\n⏺ Done.\n\n' + '─'.repeat(40) + '\n❯ \n' + '─'.repeat(40) + '\n  bypass permissions on (shift+tab to cycle)\n';
  assert.equal(permissionUp(PERM_BASH + IDLE_UNDER), false, 'an answered prompt in scrollback read as live');
});

for (const [name, screen] of [['bash', PERM_BASH], ['edit', PERM_EDIT], ['older footer', PERMISSION]]) {
  test(`#5754 a ${name} permission prompt: a sender is refused with nothing typed (its Enter would approve), a timer line is HELD`, async () => {
    await onScreen(screen, 'needs_you', async (board, calls) => {
      const v = await chat.deliverAsync('casey', 'A room post for Casey.', board.agents);
      assert.equal(v.state, chat.DELIVERY.COULD_NOT, JSON.stringify(v));
      assert.match(v.because, /asking for permission on its screen/);
      assert.doesNotMatch(v.because, /direct messages/, 'pointed at a route that cannot answer a permission prompt');
      const h = await chat.deliverAutomaticAsync('casey', 'A timer line for Casey.', board.agents);
      assert.equal(h.held, true, JSON.stringify(h));
      assert.equal(h.heldBy, 'menu');
      assert.equal(chat.deliverAutomatic('casey', 'A timer line for Casey.', board.agents).held, true);
      assert.equal(chat.deliver('casey', 'A task line for Casey.', board.agents).state, chat.DELIVERY.COULD_NOT);
      assert.deepEqual(calls.typed(), [], 'something was typed into the permission prompt');
    });
  });
}

test('#5743 decided: a screen read that FAILS is not a refusal (needs_you covers every question; refusing would block replies on one bad capture)', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: MENU })]);
  try {
    const calls = [];
    chat.setRunner((args) => {
      calls.push(args);
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 1, out: '', err: 'no pane' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false); chat.setPauser(() => {});
    const v = await chat.deliverAsync('casey', 'A room post for Casey.', board.agents);
    assert.doesNotMatch(String(v.because), /on its screen/, 'a failed read was taken as one of the screens');
    assert.ok(calls.some((c) => c[0] === 'capture-pane'), 'premise: the screen was asked for');
    assert.ok(calls.some((c) => c[0] === 'paste-buffer'), 'a failed read refused an ordinary reply (the decision is fail open)');
    // EXCEPT: the card itself reports it is asking permission (its PermissionRequest self-report). Then nothing typed.
    calls.length = 0;
    const asking = board.agents.map((c) => ({ ...c, because: 'asking permission to use Bash: rm -rf build' }));
    const p = await chat.deliverAsync('casey', 'A room post for Casey.', asking);
    assert.equal(p.state, chat.DELIVERY.COULD_NOT, JSON.stringify(p));
    assert.match(p.because, /asking for permission/);
    assert.ok(!calls.some((c) => c[0] === 'paste-buffer' || c[0] === 'send-keys'), 'typed into an agent reporting a permission request');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5743 only Claude agents: another runner on the same screen is not refused by this floor', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'gemini', command: 'claude', screen: MENU })]);
  try {
    const calls = arm(MENU);
    const v = await chat.deliverAsync('casey', 'A room post for Casey.', board.agents);
    assert.doesNotMatch(String(v.because), /showing a question on its screen/, JSON.stringify(v));
    assert.ok(calls.typed().length > 0, 'a non-Claude agent was refused by the Claude menu floor');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5743 menuHeld (for sweeps that decide before typing): true on the menu, false for an idle agent', async () => {
  await onScreen(MENU, 'needs_you', async (board, calls) => {
    assert.equal(chat.menuHeld('casey', board.agents), true);
    assert.deepEqual(calls.typed(), [], 'asking whether it is held typed something');
  });
  await onScreen(null, 'idle', async (board) => {
    assert.equal(chat.menuHeld('casey', board.agents), false);
  });
});

test('#5743 pin: the recommender\'s hold hook asks about the menu too, so a stuck agent on its menu is not convened or charged', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('const out = recommender.runOnce({');
  assert.notEqual(at, -1, 'premise: the recommender sweep was found');
  const call = src.slice(at, src.indexOf('});', at));
  assert.match(call, /heldUntil: \(session\) => agyQuota\.heldForAgy\(session, roster, Date\.now\(\)\)\s*\?\? \(chat\.menuHeld\(session, roster\)/, 'the recommender hold hook does not ask about the menu');
});

test('#5754 a question menu that begins "Do you want to" gets the menu sentence (with its direct-message clause), not the permission one', async () => {
  const DWT = MENU.replace('Which fruit do you want?', 'Do you want to use TypeScript?');
  await onScreen(DWT, 'needs_you', async (board, calls) => {
    const v = await chat.deliverAsync('casey', 'A room post for Casey.', board.agents);
    assert.match(v.because, /showing a question on its screen/);
    assert.match(v.because, /by its number in its direct messages/, 'the single-select form on a needs_you card is answerable there');
    assert.doesNotMatch(v.because, /asking for permission/);
    assert.deepEqual(calls.typed(), []);
  });
});

/* The safeguards model-switch menu (#5051), as engine/status.test.js draws it. */
const SAFEGUARDS = ['│ which can sometimes flag non-cybersecurity work. Switch to Opus 4.8 and keep going whenever this happens?', '',
  '─'.repeat(80), '❯ 1. Switch automatically', '     Continue on Opus 4.8 now, and switch without asking from now on',
  '  2. Stay on Opus 5.5', '     Stop here without switching, and ask me each time a message is flagged',
  '  3. Type something.', '  4. Chat about this', 'Enter to select · ↑/↓ to navigate · Esc to cancel'].join('\n') + '\n';
test('#5743 review 10: the safeguards model-switch menu is refused and held (its own sentence); one left in scrollback is not', async () => {
  assert.equal(status.claudeSafeguardsMenuUp(SAFEGUARDS), true);
  assert.equal(status.claudeQuestionMenuUp(SAFEGUARDS), false, 'premise: the question-menu detector leaves it out on purpose');
  const IDLE_UNDER = '\n\n⏺ Done.\n\n' + '─'.repeat(40) + '\n❯ \n' + '─'.repeat(40) + '\n  bypass permissions on (shift+tab to cycle)\n';
  assert.equal(status.claudeSafeguardsMenuUp(SAFEGUARDS + IDLE_UNDER), false, 'an answered safeguards menu in scrollback read as live');
  await onScreen(SAFEGUARDS, 'needs_you', async (board, calls) => {
    const v = await chat.deliverAsync('casey', 'A room post for Casey.', board.agents);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT, JSON.stringify(v));
    assert.match(v.because, /whether to switch models/);
    assert.equal((await chat.deliverAutomaticAsync('casey', 'A timer line.', board.agents)).held, true);
    assert.deepEqual(calls.typed(), [], 'something was typed into the safeguards menu');
  });
});

test('#5743 CONTROL: a needs_you Claude card whose screen shows none of the three is typed into (the detectors do not fire on every needs_you screen)', async () => {
  const OTHER = 'Which environment should I deploy to?\n❯ 1. Staging\n  2. Production\n';   // needs_you by its marked option, no footer
  await onScreen(OTHER, 'needs_you', async (board, calls) => {
    const v = await chat.deliverAsync('casey', 'It is in the vault.', board.agents);
    assert.doesNotMatch(String(v.because), /on its screen/, JSON.stringify(v));
    assert.ok(calls.typed().length > 0, 'an ordinary needs_you screen was refused');
  });
});

test('#5754 review 11: a WORKING card that reached a permission prompt mid-turn is read and refused too', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'working' })]);
  try {
    const calls = arm(PERM_BASH);
    const roster = board.agents.map((c) => ({ ...c }));   // the snapshot predates the prompt: it still reads working
    assert.equal(roster[0].state, 'working', 'premise: the card reads working');
    const v = await chat.deliverAsync('casey', 'A room post for Casey.', roster);
    assert.equal(v.state, chat.DELIVERY.COULD_NOT, JSON.stringify(v));
    assert.match(v.because, /asking for permission/);
    assert.equal((await chat.deliverAutomaticAsync('casey', 'A timer line.', roster)).held, true);
    assert.deepEqual(calls.typed(), [], 'typed into a permission prompt behind a working card');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5754 review 11: a permission prompt in other wording is caught by its shape (highlighted numbered option over the footer)', () => {
  assert.equal(permissionUp(' Allow Claude to fetch example.com?\n ❯ 1. Yes\n   2. No\n\n Esc to cancel · Tab to amend'), true);
  // CONTROL: the same wording with no highlighted numbered option and no footer is not a prompt.
  assert.equal(permissionUp('⏺ Allow Claude to fetch example.com? I think so.\n\n❯ \n'), false);
});

test('#5754 review 12 CONTROL: a WORKING card on an ordinary working screen is typed into (its screen is read, nothing matches)', async () => {
  const WORKING = '⏺ Running the tests now.\n\n✻ Cogitating… (12s · ↓ 1.2k tokens · esc to interrupt)\n\n' + '─'.repeat(40)
    + '\n❯ \n' + '─'.repeat(40) + '\n  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt\n';
  const board = fleet.install([fleet.agent('casey', { state: 'working' })]);
  try {
    const calls = arm(WORKING);
    const v = await chat.deliverAsync('casey', 'A room post for Casey.', board.agents);
    assert.ok(calls.some((c) => c[0] === 'capture-pane'), 'premise: a working card\'s screen is read');
    assert.doesNotMatch(String(v.because), /on its screen/, JSON.stringify(v));
    assert.ok(calls.typed().length > 0, 'an ordinary working screen was refused');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5754 review 13: a shape-only match (other wording, or a picker) is refused with the neutral sentence, never "asking for permission"', async () => {
  const PICKER = ' Select model\n ❯ 1. Opus\n   2. Sonnet\n\n Esc to cancel';
  assert.equal(status.claudePermissionPromptKind(PICKER), 'shape');
  assert.equal(status.claudePermissionPromptKind(PERM_BASH), 'wording', 'CONTROL: the real prompt is matched by its wording');
  const board = fleet.install([fleet.agent('casey', { state: 'working' })]);
  try {
    const calls = arm(PICKER);
    const v = await chat.deliverAsync('casey', 'A room post for Casey.', board.agents.map((c) => ({ ...c })));
    assert.equal(v.state, chat.DELIVERY.COULD_NOT, JSON.stringify(v));
    assert.match(v.because, /waiting for an answer on its screen/);
    assert.doesNotMatch(v.because, /permission/, 'a picker was described as a permission request');
    assert.deepEqual(calls.typed(), []);
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5754 review 14: a WORKING card on the single-select menu is not pointed at the direct messages (that route answers needs_you cards only)', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'working' })]);
  try {
    const calls = arm(MENU);
    const v = await chat.deliverAsync('casey', 'A room post for Casey.', board.agents.map((c) => ({ ...c })));
    assert.match(v.because, /showing a question on its screen/);
    assert.doesNotMatch(v.because, /direct messages/);
    assert.deepEqual(calls.typed(), []);
  } finally { chat.resetForTests(); board.restore(); }
});

test('#5754 review 17: agent prose that merely ends in "Esc to cancel" under a "Do you want to" line is not a permission prompt', () => {
  const PROSE = '⏺ Do you want to keep the old config? I will ask before changing it.\n  If a dialog opens, press Esc to cancel';
  assert.equal(status.claudePermissionPromptKind(PROSE), null, 'prose ending in the footer words read as a permission prompt');
  // CONTROL: both real footer forms still count.
  assert.equal(status.claudePermissionPromptKind(PERM_BASH), 'wording');
  assert.equal(status.claudePermissionPromptKind(PERMISSION), 'wording');
});
