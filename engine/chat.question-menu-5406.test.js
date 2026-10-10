'use strict';
/**
 * kosmos#5406 part 2: Claude Code's question menu (its question tool) takes an answer only by key. Measured on Claude
 * Code 2.1.29x: a bare digit selects at once; the message path's paste is ignored and its Enter takes the HIGHLIGHTED
 * option; Escape closes the menu. status.claudeQuestionMenu reads it (and refuses what it cannot be sure of), chat reads
 * it as a question with options, and answerQuestionMenu / closeQuestionMenu send only the key, checked against the
 * screen before and read again after. The screen is a real capture (test-support/claude-screens).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-qmenu-5406-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');
const status = require('./status');
const fleet = require('../test-support/fleet');

const MENU = fs.readFileSync(path.join(__dirname, '..', 'test-support', 'claude-screens', 'question-menu-2.1.29x.txt'), 'utf8');
const IDLE = '⏺ Banana\n\n────────\n❯ \n────────\n  bypass permissions on (shift+tab to cycle)';

function ok(out) { return { ran: true, spawnFailed: false, status: 0, out: out || '', err: '' }; }
function arm(screens) {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    if (args[0] === 'display-message') return ok('2.1.212\t\t0\n');
    if (args[0] === 'capture-pane') { const next = screens.length ? screens.shift() : IDLE; return next === null ? { ran: true, spawnFailed: false, status: 1, out: '', err: 'no such pane' } : ok(next); }
    return ok();
  };
  fn.keys = () => calls.filter((a) => a[0] === 'send-keys').map((a) => a[a.length - 1]);
  fn.pasted = () => calls.filter((a) => a[0] === 'set-buffer' || a[0] === 'paste-buffer' || a[0] === 'load-buffer');
  chat.setRunner(fn);
  chat.setDryRun(false);
  chat.setPauser(() => {});
  return fn;
}
function withClaude(fn) {
  const board = fleet.install([fleet.agent('casey', { state: 'needs_you', runner: 'claude', command: 'claude', screen: MENU })]);
  return Promise.resolve().then(() => fn(board)).finally(() => board.restore());
}
test.beforeEach(() => { chat.resetForTests(); });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#5406 status: the question menu is read, answers only, from the real capture', () => {
  assert.deepEqual(status.claudeQuestionMenu(MENU), {
    at: 3, question: 'Which fruit do you want?', count: 5,
    options: [{ n: 1, label: 'Apple' }, { n: 2, label: 'Banana' }, { n: 3, label: 'Cherry' }],
  });
});

test('#5406 status: refused when it cannot be sure (each a control against the real screen)', () => {
  const cases = {
    'no footer': MENU.replace(/Enter to select.*$/m, ''),
    'not the live screen': MENU + '\n⏺ Banana\n\nsome later output\nmore output\nand more',
    'several questions': MENU.replace(' ☐ Fruit', ' ☐ Fruit  ☐ Color  ✔ Submit'),
    'a gap in the numbers': MENU.replace(/^  2\. Banana\n     Banana\n/m, ''),
    'no highlighted option': MENU.replace('❯ 1. Apple', '  1. Apple'),
    'a checkbox option': MENU.replace('❯ 1. Apple', '❯ 1. [ ] Apple').replace('  2. Banana', '  2. [ ] Banana').replace('  3. Cherry', '  3. [ ] Cherry'),
  };
  for (const [why, screen] of Object.entries(cases)) assert.equal(status.claudeQuestionMenu(screen), null, why);
  assert.equal(status.claudeQuestionMenu(IDLE), null, 'an idle screen');
  assert.ok(status.claudeQuestionMenu(MENU), 'CONTROL: the real screen is read');
});

test('#5406 chat: the menu is a question with options and an identity', () => {
  const q = chat.questionIn(MENU, 'claude');
  assert.ok(q && q.text.startsWith(' ☐ Fruit'), JSON.stringify(q));
  assert.deepEqual(chat.optionsIn(q.text), [{ n: 1, label: 'Apple' }, { n: 2, label: 'Banana' }, { n: 3, label: 'Cherry' }]);
  assert.equal(chat.questionAbove(q.text), 'Which fruit do you want?');
});

test('#5406 answerQuestionMenu: the bare digit, only for the menu the person saw', async () => {
  await withClaude(async (board) => {
    let t = arm([MENU, IDLE]);
    let r = await chat.answerQuestionMenu('casey', 2, board.agents, { question: 'Which fruit do you want?', label: 'Banana' });
    assert.deepEqual([r.ok, r.answered, t.keys()], [true, true, ['2']], JSON.stringify(r));
    assert.equal(t.pasted().length, 0, 'text was pasted into the menu');
    t = arm([MENU]);
    r = await chat.answerQuestionMenu('casey', 2, board.agents, { question: 'Which fruit do you want?', label: 'Cherry' });
    assert.deepEqual([r.ok, t.keys()], [false, []], 'a label that changed was answered');
    t = arm([MENU]);
    r = await chat.answerQuestionMenu('casey', 2, board.agents, { question: 'Which colour?', label: 'Banana' });
    assert.deepEqual([r.ok, t.keys()], [false, []], 'another question was answered');
    t = arm([IDLE]);
    r = await chat.answerQuestionMenu('casey', 2, board.agents, {});
    assert.deepEqual([r.ok, t.keys()], [false, []], 'a key was sent with no menu on screen');
    t = arm([MENU]);
    r = await chat.answerQuestionMenu('casey', 4, board.agents, {});
    assert.deepEqual([r.ok, t.keys()], [false, []], '"Type something." was answered as a choice');
    t = arm([MENU, MENU]);
    r = await chat.answerQuestionMenu('casey', 1, board.agents, {});
    assert.deepEqual([r.ok, r.answered], [true, false], 'a menu still asking after the key was reported answered');
  });
});

test('#5406 closeQuestionMenu: Escape only when the menu is up, and says when it did not close', async () => {
  await withClaude(async (board) => {
    let t = arm([MENU, IDLE]);
    let r = await chat.closeQuestionMenu('casey', board.agents);
    assert.deepEqual([r.ok, r.closed, t.keys()], [true, true, ['Escape']]);
    t = arm([IDLE]);
    r = await chat.closeQuestionMenu('casey', board.agents);
    assert.deepEqual([r.ok, r.closed, t.keys()], [true, false, []], 'CONTROL: no menu, no key');
    t = arm([MENU, MENU]);
    r = await chat.closeQuestionMenu('casey', board.agents);
    assert.equal(r.ok, false, 'a menu that stayed was reported closed');
  });
});

test('#5406 review 1: a wrapped question is read whole, header kept; a permission screen with the footer is not this menu', () => {
  const wrapped = MENU.replace('Which fruit do you want?', 'Which fruit do you want for the long weekend trip, given that\nwe leave early on Saturday morning?');
  const m = status.claudeQuestionMenu(wrapped);
  assert.ok(m, 'a wrapped question was refused');
  assert.equal(m.question, 'Which fruit do you want for the long weekend trip, given that we leave early on Saturday morning?');
  assert.equal(wrapped.split('\n')[m.at].trim(), '☐ Fruit', 'the header was lost');
  const perm = 'Bash command\n\n  rm photo.jpg\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n\nEnter to select · ↑/↓ to navigate · Esc to cancel';
  assert.equal(status.claudeQuestionMenu(perm), null, 'a permission prompt with the footer was taken for the question menu');
});

test('#5406 review 1: closeQuestionMenu closes only the question the person saw', async () => {
  await withClaude(async (board) => {
    const t = arm([MENU]);
    const r = await chat.closeQuestionMenu('casey', board.agents, { question: 'Which colour?' });
    assert.deepEqual([r.ok, t.keys()], [false, []], 'a different question was closed');
  });
});

test('#5406 review 2: a menu with ten or more entries is refused (every answer must be one key)', () => {
  const many = MENU.replace('  4. Type something.', [4, 5, 6, 7, 8, 9].map((k) => '  ' + k + '. Fruit ' + k).join('\n') + '\n  10. Type something.').replace('  5. Chat about this', '  11. Chat about this');
  assert.equal(status.claudeQuestionMenu(many), null);
});

const SCREEN = (f) => fs.readFileSync(path.join(__dirname, '..', 'test-support', 'claude-screens', f), 'utf8');
test('#5406 review 3: the real multi-select and multi-question screens are refused', () => {
  assert.equal(status.claudeQuestionMenu(SCREEN('question-menu-multiselect-2.1.29x.txt')), null, 'multi-select (a digit only ticks a box)');
  assert.equal(status.claudeQuestionMenu(SCREEN('question-menu-multiquestion-2.1.29x.txt')), null, 'multi-question (Escape drops every question)');
});

test('#5406 review 3: only a Claude card, and an unreadable screen is never "answered" or "closed"', async () => {
  const codex = fleet.install([fleet.agent('sam', { state: 'unknown', runner: 'codex', command: 'node', screen: MENU })]);
  try {
    const t = arm([MENU, MENU]);
    const a = await chat.answerQuestionMenu('sam', 2, codex.agents, {});
    const c = await chat.closeQuestionMenu('sam', codex.agents);
    assert.deepEqual([a.ok, c.ok, t.keys()], [false, false, []], 'Claude keys went to a Codex card');
  } finally { codex.restore(); }
  await withClaude(async (board) => {
    let t = arm([MENU, null]);
    let r = await chat.answerQuestionMenu('casey', 2, board.agents, {});
    assert.deepEqual([r.ok, r.answered], [true, false], 'an unreadable screen after the key was reported answered');
    t = arm([MENU, null]);
    r = await chat.closeQuestionMenu('casey', board.agents);
    assert.equal(r.ok, false, 'an unreadable screen after Escape was reported closed');
    t = arm([null]);
    r = await chat.closeQuestionMenu('casey', board.agents);
    assert.deepEqual([r.ok, t.keys()], [false, []], 'an unreadable screen before was taken for no menu');
  });
});
