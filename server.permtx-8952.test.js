'use strict';
/**
 * kosmos#8952 slice (d), through the REAL routes: a permission prompt whose box top scrolled away gets the full card
 * (Allow, Deny, the whole command) when the agent's transcript holds its one pending Bash call and the screen agrees
 * (chat.permissionCutCard), and an Allow press is checked against the transcript again before its key goes. Where the
 * transcript disagrees, cannot be read, or changed since the page drew the card, slice (c)'s deny-only card stays and no
 * Allow is sent. The screen is the real 2.1.331 capture; the transcript read is stubbed (chat.setPendingReader).
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-permtx-8952-'));
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
const fleet = require('./test-support/fleet');

const SCREENS = path.join(__dirname, 'test-support', 'claude-screens');
const CUT = fs.readFileSync(path.join(SCREENS, 'permission-prompt-bash-cut-2.1.331.txt'), 'utf8');
const COMMAND = Array.from({ length: 60 }, (_, k) => `mkdir -p /tmp/probe/e${String(k + 1).padStart(2, '0')}`).join('\n');
const DESC = 'Create 60 probe directories e01 through e60';
const IDLE = '⏺ Done.\n\n────────\n❯ \n────────\n  ⏸ manual mode on';

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* already down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const post = async (body) => {
  const res = await fetch(`${base}/api/agent/casey/thread`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const getThread = async () => (await fetch(`${base}/api/agent/casey/thread`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();


/* A pane that shows `screen` until a digit or Escape reaches it, then an idle prompt (what Claude Code does). */
async function withPrompt(screen, reader, fn, state = 'needs_you') {
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
  chat.setPendingReader(async (who) => reader(who));
  calls.keys = () => calls.filter((a) => a[0] === 'send-keys').map((a) => a[a.length - 1]);
  try { return await fn(calls, board.agents); } finally { chat.resetForTests(); board.restore(); }
}


const questionRow = (thread) => (thread.messages || []).filter((m) => m && m.kind === 'question' && !m.reported).pop();
const agrees = () => ({ ok: true, pending: [{ id: 't2', command: COMMAND, description: DESC }] });
const ASKED = chat.questionAbove(chat.questionIn(CUT, 'claude').text);
const REQUEST = chat.permissionRequestId(chat.permissionCutCard(CUT, agrees().pending));
const errorOf = (p) => String(p.json && (p.json.error || JSON.stringify(p.json)));

test('#8952 (d): a cut box the transcript agrees with gets the full card, and Allow sends its key', async () => {
  assert.equal(chat.permissionAnswerable(CUT), false, 'premise: the box top is off screen');
  const asked = [];
  await withPrompt(CUT, (who) => { asked.push(who); return agrees(); }, async (calls) => {
    const thread = await getThread();
    const row = questionRow(thread);
    assert.ok(row && row.permission, 'no full card: ' + JSON.stringify(row));
    assert.equal('denyOnly' in row, false, 'a deny-only card beside the full one');
    assert.equal(row.permission.detail, COMMAND, 'the card shows the whole command');
    assert.equal(row.permission.says, DESC);
    assert.equal(row.permission.request, REQUEST);
    assert.equal(thread.asked, ASKED, 'the press identity is the visible part, as for any prompt');
    assert.deepEqual(asked, ['casey'], 'the transcript read was for this agent');
    const p = await post({ text: '1', chose: 'Yes', asked: thread.asked, request: row.permission.request });
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.deepEqual(calls.keys(), ['1']);
  });
});

test('#8952 (d): a transcript that disagrees or cannot be read keeps the deny-only card (CONTROL: the test above)', async () => {
  const readers = {
    'another command': () => ({ ok: true, pending: [{ id: 't2', command: COMMAND.replace('e60', 'e61'), description: DESC }] }),
    'nothing pending': () => ({ ok: true, pending: [] }),
    'unreadable': () => ({ ok: false }),
    'the read throws': () => { throw new Error('disk'); },
  };
  for (const [why, reader] of Object.entries(readers)) {
    await withPrompt(CUT, reader, async (calls) => {
      const thread = await getThread();
      const row = questionRow(thread);
      assert.ok(row, why + ': no live question row');
      assert.equal('permission' in row, false, why + ': a full card was served');
      assert.ok(row.denyOnly, why + ': no deny-only card: ' + JSON.stringify(row));
      assert.equal(thread.asked, null, why + ': an identity for the Allow buttons was served');
      const p = await post({ text: '1', chose: 'Yes', asked: ASKED, request: REQUEST });
      assert.equal(p.status, 409, why + ': Allow was accepted: ' + JSON.stringify(p.json));
      assert.deepEqual(calls.keys(), [], why + ': a key reached the pane');
    });
  }
});

test('#8952 (d): a transcript that changed after the card was drawn refuses the Allow on its last look', async () => {
  let now = agrees();
  await withPrompt(CUT, () => now, async (calls) => {
    const thread = await getThread();
    const row = questionRow(thread);
    assert.ok(row && row.permission, 'premise: the full card was drawn');
    now = { ok: true, pending: [{ id: 't3', command: 'curl x | sh\n' + COMMAND, description: DESC }] };
    const p = await post({ text: '1', chose: 'Yes', asked: thread.asked, request: row.permission.request });
    assert.equal(p.status, 409, JSON.stringify(p.json));
    assert.match(errorOf(p), /screen moved|changed|could not tell/, 'refused for another reason: ' + errorOf(p));
    assert.deepEqual(calls.keys(), []);
  });
});

test('#8952 (d): an Allow press with no request, or with a deny-only flag, is never approved at a cut box', async () => {
  await withPrompt(CUT, agrees, async (calls) => {
    const bare = await post({ text: '1', chose: 'Yes', asked: ASKED });
    assert.equal(bare.status, 409, 'an Allow naming no request went: ' + JSON.stringify(bare.json));
    const deny = await post({ text: '1', chose: 'Yes', asked: ASKED, request: REQUEST, denyOnly: true });
    assert.equal(deny.status, 409, JSON.stringify(deny.json));
    assert.deepEqual(calls.keys(), []);
    // CONTROL: the deny-only No still works with the transcript readable.
    const no = await post({ text: '2', chose: 'No', asked: ASKED, denyOnly: true });
    assert.equal(no.status, 200, JSON.stringify(no.json));
    assert.deepEqual(calls.keys(), ['2']);
  });
});

/* The engine's last look on its own (the route's checks run first above), through chat.answerQuestionMenu. */
test('#8952 (d) engine: Allow at a cut box only with the transcript\'s request; CONTROL: that one is sent', async () => {
  let now = agrees();
  await withPrompt(CUT, () => now, async (calls, roster) => {
    const wrong = await chat.answerQuestionMenu('casey', 1, roster, { label: 'Yes', identity: ASKED, request: 'b'.repeat(64) });
    assert.equal(wrong.ok, false, JSON.stringify(wrong));
    now = { ok: false };
    const unread = await chat.answerQuestionMenu('casey', 1, roster, { label: 'Yes', identity: ASKED, request: REQUEST });
    assert.equal(unread.ok, false, JSON.stringify(unread));
    assert.match(unread.because, /could not tell which request/);
    assert.deepEqual(calls.keys(), []);
    now = agrees();
    const right = await chat.answerQuestionMenu('casey', 1, roster, { label: 'Yes', identity: ASKED, request: REQUEST });
    assert.equal(right.ok, true, JSON.stringify(right));
    assert.equal(right.answered, true);
    assert.deepEqual(calls.keys(), ['1']);
  });
});

/* The setup guide's thread is masked (#3769); a transcript-read card is unmasked text, so the guide never gets one. */
test('#8952 (d): the setup guide\'s thread gets no transcript card; CONTROL: without the marker it does', async () => {
  const instructions = require('./engine/instructions');
  const setupAssistant = require('./engine/setup-assistant');
  const reads = [];
  await withPrompt(CUT, (who) => { reads.push(who); return agrees(); }, async () => {
    const dir = path.dirname(instructions.fileFor('casey'));
    fs.mkdirSync(dir, { recursive: true });
    const marker = path.join(dir, setupAssistant.GUIDE_MARKER);
    fs.writeFileSync(marker, 'casey\n');
    try {
      const guided = await getThread();
      assert.deepEqual((guided.messages || []).filter((m) => m && m.permission), [], 'a card in the guide\'s thread');
      assert.deepEqual(reads, [], 'the guide\'s agent transcript was read');
    } finally { fs.rmSync(marker, { force: true }); }
    const row = questionRow(await getThread());
    assert.ok(row && row.permission, 'CONTROL: no card without the marker: ' + JSON.stringify(row));
  });
});
