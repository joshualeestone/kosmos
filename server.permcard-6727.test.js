'use strict';
/**
 * kosmos#6727: the thread route serves a permission prompt read off the screen as a card (the question row's
 * `permission`, chat.permissionCard), so the page draws the short card and not the screen. Harness from
 * server.permission-answer-6054.test.js (kosmos#6054: an agent stopped on Claude Code's permission prompt is answered from its page). The thread serves the
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

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-perm-6727-'));
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
const MENU = fs.readFileSync(path.join(SCREENS, 'question-menu-2.1.29x.txt'), 'utf8');
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

const questionRow = (j) => (Array.isArray(j.messages) ? j.messages : []).find((m) => m && m.kind === 'question');

test('#6727 the route serves the permission prompt as a card, the same reading as chat.permissionCard', async () => {
  for (const [name, screen] of [['bash', BASH], ['edit', EDIT]]) {
    await withPrompt(screen, async () => {
      const j = await getThread();
      const row = questionRow(j);
      assert.ok(row, name + ': no question row: ' + JSON.stringify(j).slice(0, 300));
      const card = chat.permissionCard(screen);
      assert.deepEqual(row.permission, { ...card, request: chat.permissionRequestId(card) }, name + ' (kosmos#7017: with its fingerprint)');
      assert.ok(row.permission && row.permission.allow === 1, name + ': premise, Allow is option 1');
    });
  }
});

test('#6727 CONTROL: a question menu, served as a question, is not a permission card', async () => {
  await withPrompt(MENU, async () => {
    const row = questionRow(await getThread());
    assert.ok(row, 'premise: the menu is served as a question');
    assert.equal('permission' in row, false, 'a question menu was served as a permission card');
  });
});

test('#6727 review 1: no buttons, no card. A prompt whose box top scrolled away is served without Allow or Deny, so as its text', async () => {
  const cut = BASH.split('\n').filter((l) => !/^─{8,}/.test(l)).join('\n');
  assert.equal(chat.permissionAnswerable(cut), false, 'premise: the cut box is not answerable');
  await withPrompt(cut, async () => {
    const j = await getThread();
    const row = questionRow(j);
    assert.ok(row, 'premise: the prompt is still served as a question: ' + JSON.stringify(j).slice(0, 200));
    assert.equal(j.asked, null, 'premise: no buttons are offered');
    assert.equal('permission' in row, false, 'a card was served where no button is');
  });
});

test('#6727 review 1: no card in the setup guide thread, whose text is masked (the card would carry the screen raw)', async () => {
  const setup = require('./engine/setup-assistant');
  const file = require('./engine/instructions').fileFor('casey');
  assert.ok(typeof file === 'string' && file, 'premise: casey has an instructions path');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const marker = path.join(path.dirname(file), '.kosmos-setup-guide');
  fs.writeFileSync(marker, '');
  try {
    assert.equal(setup.isGuideFolder('casey'), true, 'premise: casey is the setup guide now');
    assert.ok(chat.permissionCard(BASH), 'premise: the screen alone would make a card');
    await withPrompt(BASH, async () => {
      const j = await getThread();
      const row = questionRow(j);
      assert.ok(row, 'premise: the prompt is served as a question: ' + JSON.stringify(j).slice(0, 200));
      assert.equal('permission' in row, false, 'a card (the screen unmasked) was served in the guide thread');
    });
  } finally { fs.rmSync(marker, { force: true }); }
});

