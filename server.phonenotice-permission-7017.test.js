'use strict';
/**
 * kosmos#7017 part 2, through the REAL GET /api/phone/notice route: a needs_you raised while the agent is stopped on
 * Claude Code's permission prompt carries Allow and Deny (`permission`), the prompt's own "Yes" and "No" options and
 * the question's identity, exactly where the board's thread route draws that card's buttons (dmPressable and
 * chat.permissionCard, one answer for both). The press the phone then sends ({ text: n, chose: label, asked }, the
 * board's dmChoicePress) goes out as the option's bare digit. CONTROLS: a question menu, a box whose top scrolled away,
 * an agent no longer asking, and an agent's direct reply carry no `permission`. Never a lasting choice. Harness from
 * server.permcard-6727.test.js; the screens are the real 2.1.296 captures in test-support/claude-screens.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pnperm-7017-'));
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
const selfreport = require('./engine/selfreport');
const fleet = require('./test-support/fleet');

const SCREENS = path.join(__dirname, 'test-support', 'claude-screens');
const BASH = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-2.1.296.txt'), 'utf8');
const EDIT = fs.readFileSync(path.join(SCREENS, 'permission-prompt-edit-2.1.296.txt'), 'utf8');
const MENU = fs.readFileSync(path.join(SCREENS, 'question-menu-2.1.29x.txt'), 'utf8');
const IDLE = '⏺ Done.\n\n────────\n❯ \n────────\n  ⏸ manual mode on';

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* already down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const notice = async (id) => {
  const res = await fetch(base + '/api/phone/notice?id=' + encodeURIComponent(id));
  return { status: res.status, json: await res.json().catch(() => null) };
};
const post = async (body) => {
  const res = await fetch(`${base}/api/agent/casey/thread`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const getThread = async () => (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();

/* The permission hook's needs_you, as recorded; its id is what phonenotify sends. */
function reportId() {
  const kept = selfreport.record('casey', { state: 'needs_you', because: 'Claude needs your permission to use Bash' });
  assert.ok(kept && kept.at, 'premise: the report was recorded: ' + JSON.stringify(kept));
  return 'report:' + kept.at + ':casey';
}

/* A pane that shows `screen` until a digit or Escape reaches it, then an idle prompt (what Claude Code does). */
async function withPrompt(screen, fn, state = 'needs_you') {
  const board = fleet.install([fleet.agent('casey', { state, runner: 'claude', command: 'claude', screen })]);
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
  try { return await fn(calls); } finally { chat.resetForTests(); board.restore(); }
}

test('#7017 a permission prompt\'s notice carries Allow and Deny: its own Yes and No, and the identity the board presses with', async () => {
  for (const [name, screen] of [['bash', BASH], ['edit', EDIT]]) {
    await withPrompt(screen, async () => {
      const r = await notice(reportId());
      assert.equal(r.status, 200, name + ': ' + JSON.stringify(r.json));
      const p = r.json.permission;
      assert.ok(p, name + ': no permission on the notice: ' + JSON.stringify(r.json));
      const card = chat.permissionCard(screen);
      assert.equal(p.kind, card.kind, name);
      assert.deepEqual(p.allow, { n: card.allow, label: 'Yes' }, name);
      assert.equal(p.deny.n, card.deny, name);
      assert.match(p.deny.label, /^No\b/, name);
      const thread = await getThread();
      assert.equal(p.asked, thread.asked, name + ': the phone would press with a different identity than the board');
      assert.match(p.request, /^[0-9a-f]{64}$/, name + ': no fingerprint');
      const row = (thread.messages || []).find((m) => m && m.kind === 'question');
      assert.equal(row && row.permission && row.permission.request, p.request, name + ': the thread card and the notice disagree on the fingerprint the phone checks');
      const offered = (thread.options || []).filter((o) => o.lasting === true).map((o) => o.n);
      assert.ok(offered.length > 0, name + ': premise, the prompt has a lasting choice');
      assert.ok(!offered.includes(p.allow.n) && !offered.includes(p.deny.n), name + ': a lasting choice was offered from the notification');
    });
  }
});

test('#7017 the phone\'s press (the board\'s own body) goes out as the option\'s bare digit, for Allow and for Deny', async () => {
  for (const which of ['allow', 'deny']) {
    await withPrompt(BASH, async (calls) => {
      const p = (await notice(reportId())).json.permission;
      assert.ok(p, 'premise: the notice carries the permission');
      const r = await post({ text: String(p[which].n), chose: p[which].label, asked: p.asked });
      assert.equal(r.status, 200, which + ': ' + JSON.stringify(r.json));
      assert.equal(r.json.delivery.state, 'placed', which + ': ' + JSON.stringify(r.json.delivery));
      assert.deepEqual(calls.keys(), [String(p[which].n)], which + ': not the bare key');
    });
  }
});

test('#7017 CONTROL: a question menu, a box whose top scrolled away, and an agent no longer asking carry no permission', async () => {
  const cut = BASH.split('\n').filter((l) => !/^─{8,}/.test(l)).join('\n');
  assert.equal(chat.permissionAnswerable(cut), false, 'premise: the cut box is not answerable');
  for (const [name, screen] of [['menu', MENU], ['cut', cut]]) {
    await withPrompt(screen, async () => {
      const r = await notice(reportId());
      assert.equal(r.status, 200, name + ': premise, the words are still served: ' + JSON.stringify(r.json));
      assert.equal('permission' in r.json, false, name + ': permission offered: ' + JSON.stringify(r.json.permission));
    });
  }
  // Answered on the computer since: the agent reports working again, and its notice's words stay but Allow and Deny go.
  const id = reportId();
  selfreport.record('casey', { state: 'working', because: 'running the command' });
  await withPrompt(IDLE, async () => {
    const r = await notice(id);
    assert.equal(r.status, 200, 'working: premise, the words are still served: ' + JSON.stringify(r.json));
    assert.equal('permission' in r.json, false, 'working: permission offered: ' + JSON.stringify(r.json.permission));
  }, 'working');
});

test('#7017 CONTROL: an agent\'s direct reply never carries a permission, even with the prompt on screen', async () => {
  await withPrompt(BASH, async () => {
    const at = new Date().toISOString();
    chat.appendMessage(chat.DIRECT, 'casey', { text: 'One moment, checking.', at, from: 'casey' });
    const r = await notice('reply:' + at + ':casey');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal('permission' in r.json, false, JSON.stringify(r.json));
  });
});

test('#7017 the fingerprint tells two requests with the same question and options apart, and reads the same twice', () => {
  const a = chat.permissionCard(BASH);
  const b = chat.permissionCard(BASH.replace(/uuidgen/g, 'rm -rf ~'));
  assert.ok(a && b, 'premise: both read as cards');
  assert.notEqual(a.detail, b.detail, 'premise: a different command');
  assert.equal(chat.permissionRequestId(a), chat.permissionRequestId(chat.permissionCard(BASH)), 'not stable across two reads');
  assert.notEqual(chat.permissionRequestId(a), chat.permissionRequestId(b), 'two different commands share a fingerprint');
  assert.equal(chat.permissionRequestId(null), null);
});
