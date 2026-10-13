'use strict';
/**
 * kosmos#6054: an agent stopped on Claude Code's permission prompt is answered from its page. The thread serves the
 * prompt's own options as pressable (`asked` set), a press goes to the pane as the option's bare digit, checked against
 * the screen right before, and words typed while it is up are not typed and never close it (Escape there means No).
 * Measured on Claude Code 2.1.296 (2026-10-13): a bare 1 approved a Write, a bare 3 rejected one, no Enter needed.
 * The screens are the real 2.1.296 captures in test-support/claude-screens.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-perm-6054-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const chat = require('./engine/chat');
const status = require('./engine/status');
const fleet = require('./test-support/fleet');

const SCREENS = path.join(__dirname, 'test-support', 'claude-screens');
const BASH = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-2.1.296.txt'), 'utf8');
const EDIT = fs.readFileSync(path.join(SCREENS, 'permission-prompt-edit-2.1.296.txt'), 'utf8');
const IDLE = '⏺ Done.\n\n────────\n❯ \n────────\n  ⏸ manual mode on';

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.close(); } catch { /* already down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const post = async (body) => {
  const res = await fetch(`${base}/api/agent/casey/thread`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const getThread = async () => (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();

/* A pane that shows `screen` until a digit or Escape reaches it, then an idle prompt (what Claude Code does). */
async function withPrompt(screen, fn) {
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen })]);
  let now = screen;
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.296\t\t0\n', err: '' };
    if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: now, err: '' };
    if (args[0] === 'send-keys' && /^(\d|Escape)$/.test(args[args.length - 1])) now = IDLE;
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(() => {});
  calls.keys = () => calls.filter((a) => a[0] === 'send-keys').map((a) => a[a.length - 1]);
  calls.pasted = () => calls.filter((a) => a[0] === 'set-buffer').map((a) => a[a.length - 1]).join('');
  try { return await fn(calls); } finally { chat.resetForTests(); board.restore(); }
}

test('#6054 status: the real permission prompts read as answerable menus, with Claude\'s own options', () => {
  const b = status.claudeAnswerableMenu(BASH);
  assert.ok(b && b.permission, 'the Bash prompt is not answerable');
  assert.deepEqual(b.options.map((o) => o.n), [1, 2, 3, 4]);
  assert.equal(b.options[0].label, 'Yes');
  assert.equal(b.options[3].label, 'No');
  const e = status.claudeAnswerableMenu(EDIT);
  assert.equal(e.question, 'Do you want to create edit-probe.txt?');
  assert.deepEqual(e.options.map((o) => o.label), ['Yes', 'Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)', 'No']);
  // CONTROL: the question menu's own reader still refuses it (it is not that menu), so the answer comes from the new reader.
  assert.equal(status.claudeQuestionMenu(BASH), null);
});

test('#6054 status: refused when it cannot be sure (each a control against the real screen)', () => {
  const noFooter = EDIT.replace(/Esc to cancel · Tab to amend/, '');
  assert.equal(status.claudePermissionPrompt(noFooter), null, 'read without its footer');
  const twoMarked = EDIT.replace('   3. No', ' ❯ 3. No');
  assert.equal(status.claudePermissionPrompt(twoMarked), null, 'read with two highlighted options');
  const gap = EDIT.replace('   3. No', '   4. No');
  assert.equal(status.claudePermissionPrompt(gap), null, 'read with a gap in its numbering');
  const otherWording = EDIT.replace('Do you want to create edit-probe.txt?', 'Pick a theme');
  assert.equal(status.claudePermissionPrompt(otherWording), null, 'a picker in other wording was read as a permission prompt');
  assert.ok(status.claudePermissionPrompt(EDIT), 'CONTROL: the unchanged screen reads');
});

test('#6054: the thread serves the prompt\'s options as pressable, and a press of Yes goes out as the bare 1', async () => {
  await withPrompt(EDIT, async (calls) => {
    const back = await getThread();
    assert.equal(back.asking, true, 'premise: the agent reads as asking');
    assert.deepEqual(back.options.map((o) => o.n), [1, 2, 3], JSON.stringify(back.options));
    assert.ok(back.asked, 'no asked: the page would draw no buttons for the prompt');
    const r = await post({ text: '1', chose: 'Yes', asked: back.asked });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.delivery.state, 'placed', JSON.stringify(r.json.delivery));
    assert.deepEqual(calls.keys(), ['1'], 'the press did not go out as the bare key');
    assert.equal(calls.pasted(), '', 'the press was pasted');
  });
});

test('#6054: a press of No goes out as No\'s own number (4 on the Bash prompt, not a fixed key)', async () => {
  await withPrompt(BASH, async (calls) => {
    const back = await getThread();
    const no = back.options.find((o) => o.label === 'No');
    assert.equal(no.n, 4, 'premise');
    const r = await post({ text: String(no.n), chose: 'No', asked: back.asked });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(calls.keys(), ['4']);
  });
});

test('#6054: a press whose number and words do not match on the screen is refused, and nothing is sent', async () => {
  await withPrompt(EDIT, async (calls) => {
    const back = await getThread();
    const r = await post({ text: '3', chose: 'Yes', asked: back.asked });
    assert.equal(r.status, 409, 'a press whose words the screen contradicts was sent');
    assert.deepEqual(calls.keys(), []);
  });
});

test('#6054: words typed while the prompt is up are not typed, never close it, and are told to use the buttons', async () => {
  await withPrompt(EDIT, async (calls) => {
    const r = await post({ text: 'yes go ahead' });
    assert.equal(calls.keys().filter((k) => k === 'Escape').length, 0, 'Escape (No) was sent to a permission prompt');
    assert.equal(calls.pasted(), '', 'the words were pasted into the prompt');
    const said = JSON.stringify(r.json);
    assert.match(said, /buttons under its question on its page in Kosmos/, 'the refusal does not point at the buttons: ' + said);
    assert.doesNotMatch(said, /in its window/, 'the refusal still points at a window: ' + said);
  });
});

test('#6054: the page ending is said only where buttons are drawn; a prompt whose options cannot be read keeps the window ending', async () => {
  // Two highlighted options: still a permission request by its wording, but its options do not read, so no buttons.
  const unreadable = EDIT.replace('   3. No', ' ❯ 3. No');
  assert.equal(status.claudePermissionPromptKind(unreadable), 'wording', 'premise: still a permission prompt by its wording');
  await withPrompt(unreadable, async (calls) => {
    const back = await getThread();
    assert.ok(!back.asked, 'premise: no buttons are drawn for it');
    const r = await post({ text: 'yes go ahead' });
    const said = JSON.stringify(r.json);
    assert.match(said, /answer it in its window first/, 'a refusal promised buttons the page does not draw: ' + said);
    assert.equal(calls.pasted(), '', 'the words were pasted into the prompt');
  });
});

test('#6054 status: a permission prompt reads "waiting for your approval", even mid-turn; the question menu keeps its own reason', () => {
  const PANE = { command: '2.1.296', title: '✶ working', session: 'x', name: 'x' };   // a native Claude pane, its title still spinning
  for (const screen of [BASH, EDIT]) {
    const c = status.classify(PANE, screen);
    assert.equal(c.state, 'needs_you');
    assert.equal(c.because, status.APPROVAL_WAITING);
  }
  // CONTROL: the question menu is not a permission request.
  const MENU = fs.readFileSync(path.join(SCREENS, 'question-menu-2.1.29x.txt'), 'utf8');
  assert.equal(status.classify(PANE, MENU).because, status.ASKING_GENERIC);
});

/* Review 1: the same Bash prompt, but for another command (its question line and its "1. Yes" are identical). */
const BASH_OTHER = BASH.replace(/uuidgen/g, 'rmdir');
/* A pane that shows `screens` in turn, one per capture, then the last one for good. */
function armSequence(screens) {
  const calls = [];
  const queue = screens.slice();
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.296\t\t0\n', err: '' };
    if (args[0] === 'capture-pane') { const s = queue.length > 1 ? queue.shift() : queue[0]; return { ran: true, spawnFailed: false, status: 0, out: s, err: '' }; }
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(() => {});
  calls.keys = () => calls.filter((a) => a[0] === 'send-keys').map((a) => a[a.length - 1]);
  return calls;
}
const idOf = (screen) => chat.questionAbove(chat.questionIn(screen, 'claude').text);

test('#6054 review 1: a wrapped option still gets its button, with its whole label, and a press of it goes out as its digit', async () => {
  const wrapped = BASH.replace('   2. Yes, and don’t ask again for: /usr/bin/uuidgen *', '   2. Yes, and don’t ask again for: /usr/bin/uuidgen --a-very-long-flag\n      --and-more *');
  assert.equal(status.claudePermissionPrompt(wrapped).options[1].label, 'Yes, and don’t ask again for: /usr/bin/uuidgen --a-very-long-flag --and-more *');
  await withPrompt(wrapped, async (calls) => {
    const back = await getThread();
    assert.ok(back.asked, 'a wrapped option left the prompt without buttons');
    assert.equal(back.options.length, 4);
    const two = back.options.find((o) => o.n === 2);
    const r = await post({ text: '2', chose: two.label, asked: back.asked });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(calls.keys(), ['2']);
  });
});

test('#6054 review 1: a typed digit at a permission prompt is not sent (it names no command); the refusal points at the buttons', async () => {
  await withPrompt(BASH, async (calls) => {
    const r = await post({ text: '1' });
    assert.deepEqual(calls.keys(), [], 'a typed 1 approved a command nobody chose on this page');
    assert.equal(calls.pasted(), '', 'the digit was pasted into the prompt');
    assert.match(JSON.stringify(r.json), /buttons under its question on its page in Kosmos/);
  });
});

test('#6054 review 1: the last look before the key refuses a prompt for another command, and a press with no identity', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: BASH })]);
  try {
    // The person saw uuidgen; by the last look the screen asks about rmdir. Same question line, same "1. Yes".
    let calls = armSequence([BASH_OTHER]);
    let r = await chat.answerQuestionMenu('casey', 1, board.agents, { question: 'Do you want to proceed?', label: 'Yes', identity: idOf(BASH) });
    assert.deepEqual([r.ok, calls.keys()], [false, []], 'Yes went to a command the person never saw');
    chat.resetForTests();
    calls = armSequence([BASH]);
    r = await chat.answerQuestionMenu('casey', 1, board.agents, { question: 'Do you want to proceed?', label: 'Yes' });
    assert.deepEqual([r.ok, calls.keys()], [false, []], 'a permission prompt was answered with no identity to check');
    chat.resetForTests();
    // CONTROL: the identity the person saw, on the same screen, is answered.
    calls = armSequence([BASH, IDLE]);
    r = await chat.answerQuestionMenu('casey', 1, board.agents, { question: 'Do you want to proceed?', label: 'Yes', identity: idOf(BASH) });
    assert.deepEqual([r.ok, calls.keys()], [true, ['1']], JSON.stringify(r));
  } finally { chat.resetForTests(); board.restore(); }
});

test('#6054 review 1: the next command\'s prompt after the key is "answered", not "still asking" (that would invite a second press)', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: BASH })]);
  try {
    let calls = armSequence([BASH, BASH_OTHER]);
    let r = await chat.answerQuestionMenu('casey', 1, board.agents, { question: 'Do you want to proceed?', label: 'Yes', identity: idOf(BASH) });
    assert.deepEqual([r.ok, r.answered, calls.keys()], [true, true, ['1']], JSON.stringify(r));
    chat.resetForTests();
    // CONTROL: the same prompt still showing after the key is reported unconfirmed.
    calls = armSequence([BASH, BASH]);
    r = await chat.answerQuestionMenu('casey', 1, board.agents, { question: 'Do you want to proceed?', label: 'Yes', identity: idOf(BASH) });
    assert.deepEqual([r.ok, r.answered], [true, false], 'the same prompt after the key was reported answered');
  } finally { chat.resetForTests(); board.restore(); }
});

/* Review 2: a long, multi-line command whose HEAD is the only difference between two prompts. */
const longCommand = (head) => BASH.replace(' /usr/bin/uuidgen\n', ` ${head} \\\n   --one \\\n   --two \\\n   --three \\\n   --four \\\n   --five\n`);

test('#6054 review 2: the identity is the whole box, so two long commands that differ only at their head are told apart', async () => {
  const a = longCommand('rm -rf build');
  const b = longCommand('ls build');
  assert.notEqual(idOf(a), idOf(b), 'two different commands shared an identity');
  assert.match(idOf(a), /rm -rf build/, 'the command\'s head is not in its identity');
  assert.match(chat.questionIn(a, 'claude').text, /^\s*Bash command/, 'the page does not show the whole box');
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: b })]);
  try {
    const calls = armSequence([a]);
    const r = await chat.answerQuestionMenu('casey', 1, board.agents, { question: 'Do you want to proceed?', label: 'Yes', identity: idOf(b) });
    assert.deepEqual([r.ok, calls.keys()], [false, []], 'Yes went to rm -rf build when the person saw ls build');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#6054 review 2: a press with no identity is refused with its own sentence, not "its question changed"', async () => {
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: BASH })]);
  try {
    const calls = armSequence([BASH]);
    const r = await chat.answerQuestionMenu('casey', 1, board.agents, { question: 'Do you want to proceed?', label: 'Yes' });
    assert.deepEqual([r.ok, calls.keys()], [false, []]);
    assert.match(r.because, /could not tell which request/);
  } finally { chat.resetForTests(); board.restore(); }
});

test('#6054 review 2: a WORKING card (the page draws no buttons for it) keeps the window ending; the same screen needs_you says buttons', async () => {
  /* The board's card is from its last snapshot; the refusal reads the screen fresh. "working" with the prompt on screen is
     that gap (the agent reached the prompt mid-turn, the snapshot not yet redrawn), so the card is built from a working
     screen and only the fresh capture shows the prompt. */
  const refusalFor = async (state) => {
    const board = fleet.install([state === 'working'
      ? fleet.agent('casey', { state, runner: 'claude', command: 'claude' })
      : fleet.agent('casey', { state, runner: 'claude', command: 'claude', screen: EDIT })]);
    armSequence([EDIT]);
    try {
      const v = await chat.deliver('casey', 'yes go ahead', board.agents);
      return String(v && v.because);
    } finally { chat.resetForTests(); board.restore(); }
  };
  assert.match(await refusalFor('working'), /answer it in its window first$/, 'a working card was promised buttons the page does not draw');
  assert.match(await refusalFor('needs_you'), /buttons under its question on its page in Kosmos$/, 'CONTROL: needs_you is told about the buttons');
});

/* Review 3: a tall heredoc command whose long body (over 2000 characters once flattened) is the same and whose END differs:
   the difference sits past any 2000-character prefix of its identity, which is what a prefix cut cannot see. */
const BODY = Array.from({ length: 60 }, (_, i) => `   echo "line ${i} of the same long generated script body"`).join('\n');
const tallCommand = (tail) => BASH.replace(' /usr/bin/uuidgen\n', ` cat > gen.sh <<'EOF'\n${BODY}\n   EOF\n   sh gen.sh && ${tail}\n`);

test('#6054 review 3: two tall commands that differ only past 2000 characters (their end) are told apart through the route (no prefix cut)', async () => {
  const a = tallCommand('rm -rf build');
  const b = tallCommand('ls build');
  assert.ok(chat.cleanMessage(idOf(a)).length > 2000, 'premise: the identity is longer than the old 2000-character cut');
  assert.equal(chat.cleanMessage(idOf(a)).slice(0, 2000), chat.cleanMessage(idOf(b)).slice(0, 2000), 'premise: the two agree on their first 2000 characters');
  assert.notEqual(idOf(a), idOf(b));
  await withPrompt(b, async (calls) => {
    const back = await getThread();
    assert.ok(back.asked, 'premise: the whole box is on screen, so it draws buttons');
    // The person saw `b`; the press carries `a`'s identity (the screen moved between the GET and the press).
    const r = await post({ text: '1', chose: 'Yes', asked: idOf(a) });
    assert.equal(r.status, 409, 'a press for rm -rf build was taken for ls build: ' + JSON.stringify(r.json));
    assert.deepEqual(calls.keys(), []);
  });
});

test('#6054 review 3: a box whose top has scrolled away gets no buttons, no key, and no promise of buttons', async () => {
  const lines = BASH.split('\n');
  const q = lines.findIndex((l) => /Do you want to proceed\?/.test(l));
  const cut = lines.slice(q - 3).join('\n');   // the command and the question, but not the rule that opens the box
  assert.ok(status.claudePermissionPrompt(cut), 'premise: still a permission prompt');
  assert.equal(chat.permissionAnswerable(cut), false);
  assert.equal(chat.permissionAnswerable(BASH), true, 'CONTROL: the whole box is answerable');
  await withPrompt(cut, async (calls) => {
    const back = await getThread();
    assert.equal(back.asked, null, 'buttons were drawn for a request whose top is not on screen');
    const r = await post({ text: 'yes go ahead' });
    assert.match(JSON.stringify(r.json), /answer it in its window first/, 'a refusal promised buttons the page does not draw');
    assert.deepEqual(calls.keys(), []);
  });
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: cut })]);
  try {
    const calls = armSequence([cut]);
    const r = await chat.answerQuestionMenu('casey', 1, board.agents, { question: 'Do you want to proceed?', label: 'Yes', identity: idOf(cut) || 'x' });
    assert.deepEqual([r.ok, calls.keys()], [false, []], 'a key went to a request whose top is not on screen');
  } finally { chat.resetForTests(); board.restore(); }
});

test('#6054 review 3: at a permission prompt the words-check refusal does not offer typing the number (typing is refused there)', async () => {
  await withPrompt(EDIT, async (calls) => {
    const back = await getThread();
    const r = await post({ text: '1', chose: 'Yes\u0007', asked: back.asked });
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.match(r.json.error, /could not check that choice's words/);
    assert.doesNotMatch(r.json.error, /typing its number/, 'it offered a way the next request refuses');
    assert.deepEqual(calls.keys(), []);
  });
});
