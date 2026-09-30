'use strict';

/**
 * #4607: the PERSON answers Codex's "Hooks need review" from the board (chat.answerCodexHooks), while every message
 * path stays refused (#4589's floor). Keys measured 2026-09-30 on a live pane, Codex 0.149.1: menu "2" trusts all,
 * "3" continues without trusting; table "t" trusts all and stays on a "view hooks" table that Escape closes, Escape
 * alone skips; one hook's page goes back to the table on Escape. Screens are real captures in
 * test-support/codex-screens/ (the trusted table added here).
 *
 * Pins: each screen and choice presses exactly the measured keys, in order; every key is preceded by a fresh read
 * showing the screen it was measured on (a screen that changed presses nothing); a screen that does not move stops;
 * a non-Codex agent, a bad choice and a Windows agent are refused; the message path still types nothing into the
 * dialog, not even "2" (the control that this function did not loosen the floor).
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-codex-hooks-4607-'));
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
const read = (f) => fs.readFileSync(path.join(SCREENS, f), 'utf8');
const MENU = read('hook-review-menu-0.149.1.txt');
const TABLE = read('hook-review-table-0.149.1.txt');
const HOOK = read('hook-review-hook-0.149.1.txt');
const TRUSTED = read('hook-review-table-trusted-0.149.1.txt');
const IDLE = `╭────────────────────────────────────────────────╮
│ >_ OpenAI Codex (v0.149.1)                     │
╰────────────────────────────────────────────────╯
› Ask Codex to do anything
  gpt-5.6-sol default · ~/projects/newsletter`;

function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }
const okProbe = () => ok('2.1.212\t\t0\n');
/* Scripted tmux: display-message is the pane probe; every capture takes the next SCREEN; every send-keys succeeds. */
/* The dialog the person was shown: the first screen a test scripts (what the thread route would have sent). */
let SHOWN = null;
function arm(screens) {
  SHOWN = screens.length ? status.codexHookSummary(screens[0]) : null;
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return okProbe();
    if (args[0] === 'capture-pane') return screens.length ? ok(screens.shift()) : ok(IDLE);
    return ok();
  };
  fn.keys = () => calls.filter((a) => a[0] === 'send-keys').map((a) => a[a.length - 1]);
  fn.typed = () => calls.filter((a) => a[0] === 'set-buffer' || a[0] === 'paste-buffer' || a[0] === 'send-keys');
  chat.setRunner(fn);
  chat.setDryRun(false);
  chat.setPauser(() => {});
  return fn;
}
function withCodex(screen, fn, extra) {
  const state = (status.codexHookReview(screen) || status.codexHookTrustedTable(screen)) ? 'needs_you' : 'idle';
  const board = fleet.install([fleet.agent('sam', Object.assign({ state, runner: 'codex', command: 'node', screen }, extra || {}))]);
  return Promise.resolve().then(() => fn(board)).finally(() => board.restore());
}

test.beforeEach(() => { chat.resetForTests(); });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#4607 status: the trusted table is recognised, and only it', () => {
  assert.equal(status.codexHookTrustedTable(TRUSTED), true);
  for (const s of [MENU, TABLE, HOOK, IDLE, '']) assert.equal(status.codexHookTrustedTable(s), false);
  // The footer words alone, as tool output would show them, are not the screen.
  assert.equal(status.codexHookTrustedTable('grep says:\n  Press enter to view hooks; esc to close'), false);
});

test('#4607 status: what the card shows, from each screen', () => {
  assert.deepEqual(status.codexHookSummary(MENU), { screen: 'menu', count: 2, events: [], source: null, command: null });
  assert.deepEqual(status.codexHookSummary(TABLE), { screen: 'table', count: 2, events: [{ event: 'SubagentStop', count: 1 }, { event: 'Stop', count: 1 }], source: null, command: null });
  const hook = status.codexHookSummary(HOOK);
  assert.equal(hook.screen, 'hook');
  assert.deepEqual(hook.events, [{ event: 'SubagentStop', count: 1 }]);
  assert.equal(hook.source, 'Project config - /Users/you/projects/newsletter/.codex/hooks.json');
  assert.equal(hook.command, 'true', 'the hook page shows what it runs');
  assert.equal(status.codexHookSummary(IDLE), null);
});

/* screen and choice -> the captures the function will read, and the keys it must press, in order. Each key is
   preceded by two reads (the step's screen, and the re-read immediately before the key) except the first, whose
   first read is the opening look; after each key, one read. */
const CASES = [
  { name: 'menu, trust', choice: 'trust', screens: [MENU, MENU, IDLE], keys: ['2'] },
  { name: 'menu, skip', choice: 'skip', screens: [MENU, MENU, IDLE], keys: ['3'] },
  { name: 'table, trust', choice: 'trust', screens: [TABLE, TABLE, TRUSTED, TRUSTED, IDLE], keys: ['t', 'Escape'] },
  { name: 'table, skip', choice: 'skip', screens: [TABLE, TABLE, IDLE], keys: ['Escape'] },
  { name: 'hook, skip', choice: 'skip', screens: [HOOK, HOOK, TABLE, TABLE, IDLE], keys: ['Escape', 'Escape'] },
];
for (const c of CASES) {
  test(`#4607 answer: ${c.name} presses exactly ${JSON.stringify(c.keys)}`, () => withCodex(c.screens[0], async (board) => {
    const t = arm(c.screens.slice());
    const r = await chat.answerCodexHooks('sam', c.choice, board.agents, SHOWN);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(t.keys(), c.keys);
    assert.deepEqual(r.keys, c.keys);
  }));
}

test('#4607 answer: nothing is pressed when the dialog is not on screen now', () => withCodex(MENU, async (board) => {
  const t = arm([IDLE]);
  const r = await chat.answerCodexHooks('sam', 'trust', board.agents, SHOWN);
  assert.equal(r.ok, false);
  assert.match(r.because, /not on its screen now/);
  assert.deepEqual(t.keys(), []);
}));

test('#4607 answer: a screen that changes between the look and the key gets no key', () => withCodex(MENU, async (board) => {
  const t = arm([MENU, TABLE]);
  const r = await chat.answerCodexHooks('sam', 'trust', board.agents, SHOWN);
  assert.equal(r.ok, false);
  assert.match(r.because, /changed before we could answer/);
  assert.deepEqual(t.keys(), []);
}));

test('#4607 answer: a screen that does not move after a key stops, with one key pressed', () => withCodex(MENU, async (board) => {
  const t = arm([MENU, MENU, MENU]);
  const r = await chat.answerCodexHooks('sam', 'skip', board.agents, SHOWN);
  assert.equal(r.ok, false);
  assert.match(r.because, /did not change/);
  assert.deepEqual(t.keys(), ['3']);
}));

test('#4607 answer: an unreadable screen presses nothing', () => withCodex(MENU, async (board) => {
  const calls = [];
  chat.setRunner((args) => { calls.push(args); return args[0] === 'display-message' ? okProbe() : { ran: true, spawnFailed: false, status: 1, out: '', err: 'no' }; });
  chat.setDryRun(false);
  chat.setPauser(() => {});
  const r = await chat.answerCodexHooks('sam', 'trust', board.agents, SHOWN);
  assert.equal(r.ok, false);
  assert.match(r.because, /could not see its screen/);
  assert.equal(calls.filter((a) => a[0] === 'send-keys').length, 0);
}));

test('#4607 answer: an already-trusted open list is not answered for the person', () => withCodex(MENU, async (board) => {
  const t = arm([TRUSTED]);
  const r = await chat.answerCodexHooks('sam', 'skip', board.agents, SHOWN);
  assert.equal(r.ok, false);
  assert.match(r.because, /already trusted/);
  assert.deepEqual(t.keys(), []);
}));

test('#4607 answer: a bad choice, a non-Codex agent and a Windows agent are refused, nothing pressed', async () => {
  await withCodex(MENU, async (board) => {
    const t = arm([MENU, MENU, IDLE]);
    for (const bad of ['', 'all', '2', undefined]) {
      const r = await chat.answerCodexHooks('sam', bad, board.agents, SHOWN);
      assert.equal(r.ok, false);
    }
    assert.deepEqual(t.keys(), []);
  });
  const board = fleet.install([fleet.agent('ann', { state: 'idle', runner: 'claude' })]);
  try {
    const t = arm([MENU, MENU, IDLE]);
    const r = await chat.answerCodexHooks('ann', 'trust', board.agents, SHOWN);
    assert.equal(r.ok, false);
    assert.match(r.because, /not a Codex agent/);
    assert.deepEqual(t.keys(), []);
  } finally { board.restore(); }
  await withCodex(MENU, async (board2) => {
    const card = board2.agents.find((c) => c.name === 'sam' || c.sessionName === 'sam');
    if (card) card.reachedByChannel = true;
    const t = arm([MENU, MENU, IDLE]);
    const r = await chat.answerCodexHooks('sam', 'trust', board2.agents, SHOWN);
    assert.equal(r.ok, false);
    assert.deepEqual(t.keys(), []);
  });
});

test('#4607 CONTROL: the message path still types nothing into the dialog, not even "2"', () => withCodex(MENU, (board) => {
  for (const text of ['2', 't', 'please trust the hooks']) {
    const t = arm([MENU, MENU, MENU]);
    const r = chat.deliver('sam', text, board.agents);
    assert.notEqual(r.state, 'placed', text);
    assert.deepEqual(t.typed(), [], text);
  }
}));

/* Review round 1. */
const SWAPPED = MENU.replace('2. Trust all and continue', '2. @@').replace('3. Continue without trusting', '2. Continue without trusting').replace('2. @@', '3. Trust all and continue');
const NO_SKIP = MENU.split('\n').filter((r) => !/Continue without trusting/.test(r)).join('\n');

test('#4607 round 1: the menu key is the digit beside the chosen words, not its position', async () => {
  assert.ok(status.codexHookReview(SWAPPED), 'fixture: the relabelled menu is still the dialog');
  assert.deepEqual(status.codexHookMenuKeys(SWAPPED), { trust: '3', skip: '2' });
  await withCodex(MENU, async (board) => {
    const t = arm([SWAPPED, SWAPPED, IDLE]);
    const r = await chat.answerCodexHooks('sam', 'skip', board.agents, SHOWN);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(t.keys(), ['2'], 'skip must press the digit beside "Continue without trusting"');
  });
  await withCodex(MENU, async (board) => {
    const t = arm([SWAPPED, SWAPPED, IDLE]);
    await chat.answerCodexHooks('sam', 'trust', board.agents, SHOWN);
    assert.deepEqual(t.keys(), ['3']);
  });
});

test('#4607 round 1: a menu without the chosen option presses nothing', () => withCodex(MENU, async (board) => {
  assert.ok(status.codexHookReview(NO_SKIP), 'fixture: still the dialog by title and footer');
  const t = arm([NO_SKIP, NO_SKIP, IDLE]);
  const r = await chat.answerCodexHooks('sam', 'skip', board.agents, SHOWN);
  assert.equal(r.ok, false);
  assert.match(r.because, /does not show that choice/);
  assert.deepEqual(t.keys(), []);
}));

test('#4607 round 1: a second answer while one is in flight is refused, and presses nothing', () => withCodex(MENU, async (board) => {
  const t = arm([MENU, MENU, IDLE]);
  let release;
  chat.setPauser(() => new Promise((r) => { release = r; }));
  const first = chat.answerCodexHooks('sam', 'skip', board.agents, SHOWN);
  await new Promise((r) => setImmediate(r));
  const second = await chat.answerCodexHooks('sam', 'trust', board.agents, SHOWN);
  assert.equal(second.ok, false);
  assert.match(second.because, /already being sent/);
  release();
  const r1 = await first;
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.deepEqual(t.keys(), ['3'], 'only the first answer pressed anything');
  const third = await (async () => { arm([IDLE]); return chat.answerCodexHooks('sam', 'skip', board.agents, SHOWN); })();
  assert.doesNotMatch(third.because || '', /already being sent/, 'the lock is released after the first answer');
}));

test('#4607 round 1: the trusted-but-open list takes only Close', async () => {
  assert.deepEqual(status.codexHookSummary(TRUSTED), { screen: 'trusted', count: null, events: [], source: null, command: null });
  await withCodex(TRUSTED, async (board) => {
    const t = arm([TRUSTED, TRUSTED, IDLE]);
    const r = await chat.answerCodexHooks('sam', 'close', board.agents, SHOWN);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(t.keys(), ['Escape']);
  });
  await withCodex(TRUSTED, async (board) => {
    const t = arm([TRUSTED]);
    const r = await chat.answerCodexHooks('sam', 'skip', board.agents, SHOWN);
    assert.equal(r.ok, false);
    assert.deepEqual(t.keys(), []);
  });
  await withCodex(MENU, async (board) => {
    const t = arm([MENU]);
    const r = await chat.answerCodexHooks('sam', 'close', board.agents, SHOWN);
    assert.equal(r.ok, false);
    assert.match(r.because, /no open hook list/);
    assert.deepEqual(t.keys(), []);
  });
});

test('#4607 round 1: the open list reads as needing you, and the message floor refuses it', () => withCodex(TRUSTED, (board) => {
  const card = board.agents.find((c) => c.sessionName === 'sam' || c.name === 'sam');
  assert.equal(card && card.state, 'needs_you');
  for (const text of ['hello', 't']) {
    const t = arm([TRUSTED, TRUSTED]);
    const r = chat.deliver('sam', text, board.agents);
    assert.notEqual(r.state, 'placed', text);
    assert.deepEqual(t.typed(), [], text);
  }
}));

/* Review round 2. */
test('#4607 round 2: the lock is the pane, so another spelling of the name cannot answer at the same time', () => withCodex(MENU, async (board) => {
  const t = arm([MENU, MENU, IDLE]);
  let release;
  chat.setPauser(() => new Promise((r) => { release = r; }));
  const first = chat.answerCodexHooks('sam', 'skip', board.agents, SHOWN);
  await new Promise((r) => setImmediate(r));
  const second = await chat.answerCodexHooks('SAM', 'trust', board.agents, SHOWN);
  assert.equal(second.ok, false, JSON.stringify(second));
  assert.match(second.because, /already being sent/);
  release();
  await first;
  assert.deepEqual(t.keys(), ['3']);
}));

test('#4607 round 2: the summary reads the dialog, not scrollback above it', () => {
  const staleMenu = '  9 hooks are new or changed.\n' + '\n'.repeat(40) + MENU;
  assert.equal(status.codexHookSummary(staleMenu).count, 2);
  const staleHook = '  Event     PreToolUse\n  Source    Someone else - /tmp/old/hooks.json\n' + '\n'.repeat(40) + HOOK;
  const h = status.codexHookSummary(staleHook);
  assert.deepEqual(h.events, [{ event: 'SubagentStop', count: 1 }]);
  assert.match(h.source, /projects\/newsletter/);
  const long = HOOK.replace(/Source    Project config - [^\n]*/, 'Source    ' + 'x'.repeat(400));
  assert.ok(status.codexHookSummary(long).source.length <= 160);
});

test('#4607 round 2: a blank screen after a key is not taken as the question gone', () => withCodex(MENU, async (board) => {
  const t = arm([MENU, MENU, '   \n  \n']);
  const r = await chat.answerCodexHooks('sam', 'skip', board.agents, SHOWN);
  assert.equal(r.ok, false);
  assert.match(r.because, /blank when we checked/);
  assert.deepEqual(t.keys(), ['3']);
}));

/* Review round 3. */
test('#4607 round 3: an option echoed above a reworded menu cannot supply the digit', () => {
  const reworded = MENU.replace('2. Trust all and continue', '2. Trust every hook').replace('3. Continue without trusting', "3. Don't trust");
  const echoed = '• agent output:\n  2. Continue without trusting (hooks won\'t run)\n  3. Trust all and continue\n' + reworded;
  assert.ok(status.codexHookReview(echoed), 'fixture: still the dialog by title and footer');
  assert.deepEqual(status.codexHookMenuKeys(echoed), { trust: null, skip: null });
  assert.deepEqual(status.codexHookMenuKeys(MENU), { trust: '2', skip: '3' }, 'CONTROL: the real menu still reads');
});

test('#4607 round 3: an open hooks viewer with nothing active is not "trusted"', () => {
  const empty = TRUSTED.replace(/^(\s*(?:SubagentStop|Stop)\s+)1(\s+)1/gm, '$10$20');
  assert.equal(status.codexHookTrustedTable(TRUSTED), true, 'CONTROL');
  assert.equal(status.codexHookTrustedTable(empty), false);
});

test('#4607 round 3: the open list has its own refusal sentence, pointing at the agent page', () => withCodex(TRUSTED, (board) => {
  arm([TRUSTED, TRUSTED]);
  const r = chat.deliver('sam', 'hello', board.agents);
  assert.equal(r.because, status.CODEX_HOOK_LIST_SENTENCE);
  assert.match(status.CODEX_HOOK_LIST_SENTENCE, /agent page/);
  assert.match(status.CODEX_HOOK_DIALOG_SENTENCE, /agent page/);
  assert.doesNotMatch(status.CODEX_HOOK_DIALOG_SENTENCE + status.CODEX_HOOK_LIST_SENTENCE, /terminal/);
}));

/* Review round 4. */
test('#4607 round 4: an answer about a dialog that has since changed presses nothing', () => withCodex(TABLE, async (board) => {
  const t = arm([TABLE, TABLE, TRUSTED, TRUSTED, IDLE]);
  const shownMenu = status.codexHookSummary(MENU);   // the person read the menu; the table is up now
  const r = await chat.answerCodexHooks('sam', 'trust', board.agents, shownMenu);
  assert.equal(r.ok, false);
  assert.match(r.because, /changed since you read it/);
  assert.deepEqual(t.keys(), []);
}));

test('#4607 round 4: an answer that says nothing about what was shown presses nothing', () => withCodex(MENU, async (board) => {
  const t = arm([MENU, MENU, IDLE]);
  for (const seen of [null, undefined, {}, 'menu']) {
    const r = await chat.answerCodexHooks('sam', 'skip', board.agents, seen);
    assert.equal(r.ok, false);
  }
  assert.deepEqual(t.keys(), []);
}));

/* Review round 5: only measured steps. */
test('#4607 round 5: Trust from one hook\'s page only goes back to the full list, and asks again', () => withCodex(HOOK, async (board) => {
  const t = arm([HOOK, HOOK, TABLE]);
  const r = await chat.answerCodexHooks('sam', 'trust', board.agents, SHOWN);
  assert.equal(r.ok, false);
  assert.equal(r.reread, true);
  assert.match(r.because, /full list of hooks is showing now/);
  assert.deepEqual(t.keys(), ['Escape'], 'no "t" was pressed: the person has not seen the full list');
}));

test('#4607 round 5: a Trust that lands on an unmeasured menu presses nothing there', () => withCodex(TABLE, async (board) => {
  const t = arm([TABLE, TABLE, TRUSTED, TRUSTED, MENU]);
  const r = await chat.answerCodexHooks('sam', 'trust', board.agents, SHOWN);
  assert.equal(r.ok, false);
  assert.match(r.because, /not measured/);
  assert.deepEqual(t.keys(), ['t', 'Escape'], 'the menu after the list got no "2"');
}));

test('#4607 round 5: Close that reaches a menu presses nothing there', () => withCodex(TRUSTED, async (board) => {
  const t = arm([TRUSTED, TRUSTED, MENU]);
  const r = await chat.answerCodexHooks('sam', 'close', board.agents, SHOWN);
  assert.equal(r.ok, false);
  assert.deepEqual(t.keys(), ['Escape']);
}));

test('#4607 round 5: the refusal sentences say the PERSON answers it, for an agent to pass on', () => {
  for (const s of [status.CODEX_HOOK_DIALOG_SENTENCE, status.CODEX_HOOK_LIST_SENTENCE]) assert.match(s, /The person (answers|closes) it on its agent page/);
});
