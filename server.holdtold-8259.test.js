'use strict';

/**
 * kosmos#8259, through POST /api/project/:id/task/:n/message: the person writing in a for-you hold's task conversation
 * reaches its holder with the unhold sentence on the same line, and the hold is marked answered; the holder writing
 * there marks the person told. A control: the same message on an ordinary hold carries no such sentence.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE.
 *
 *   node --test server.holdtold-8259.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-holdtold-8259-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const chat = require('./engine/chat');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const sendertoken = require('./engine/sendertoken');
const limitqueue = require('./engine/limitqueue');

/* As server.limittask-5805.test.js: a Claude screen out of its weekly usage until three days from now. */
function chicagoDay(ms) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.month} ${p.day}`;
}
const RULE = '\u2500'.repeat(80) + '\n';
const LIMIT_SCREEN = '\u276f hello\n'
  + `  \u23bf  You've hit your weekly limit \u00b7 resets ${chicagoDay(Date.now() + 3 * 24 * 3600e3)} at 3pm (America/Chicago)\n`
  + '\u273b Saut\u00e9ed for 0s \u00b7 done 10:35 PM\n' + RULE + '\u276f \n' + RULE + '  leo \u00b7 Opus 4.8 \u00b7 7d 100%\n';

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

let seq = 0;
/* A board with leo, a project with leo on it, and a task leo holds, on hold (for the person when forYou). Sends one
   message to it with `headers` and returns the response and everything pasted into a pane. */
async function send(forYou, headers, text = 'yes, go with 40', limited = false) {
  const board = fleet.install([fleet.agent('leo', limited ? { state: 'rate_limited', runner: 'claude', command: 'claude', screen: LIMIT_SCREEN } : { state: 'idle' })]);
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: limited ? LIMIT_SCREEN : '', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(() => {});
  try {
    const p = projects.create({ name: 'Told Route ' + (++seq) });
    projects.addAgent(p.id, 'leo', board.agents);
    const t = tasks.create(p.id, { sentence: 'pick a price', who: 'leo' }, board.agents);
    tasks.setOnHold(p.id, t.number, true, forYou ? { forPerson: true, because: 'needs your yes' } : {});
    const res = await fetch(`${base}/api/project/${encodeURIComponent(p.id)}/task/${t.number}/message`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ text }),
    });
    const json = JSON.parse(await res.text());
    const pasted = calls.filter((a) => a[0] === 'set-buffer').map((a) => a[a.length - 1]).join('');
    return { code: res.status, json, pasted, kept: limitqueue.list('leo'), id: p.id, n: t.number, after: tasks.byNumber(projects.get(p.id), t.number) };
  } finally {
    chat.setRunner(null); chat.setDryRun(true); board.restore();
  }
}

test('the person writing on a for-you hold: the holder is typed the unhold sentence, and it is marked answered', async () => {
  const r = await send(true, { 'sec-fetch-site': 'same-origin' });
  assert.equal(r.code, 200, JSON.stringify(r.json));
  assert.match(r.pasted, /\[Kosmos task \d+ - Told Route \d+\] The person said: "yes, go with 40"/, 'the line was typed');
  assert.match(r.pasted, new RegExp('\\[kosmos\\] you have task #' + r.n + ' in Told Route \\d+ on hold waiting on this person\\..*kosmos task unhold ' + r.id + ' ' + r.n));
  assert.equal(typeof r.after.onHoldAnsweredAt, 'string');
});

test('control: the same message on an ordinary hold carries no unhold sentence and marks nothing', async () => {
  const r = await send(false, { 'sec-fetch-site': 'same-origin' });
  assert.equal(r.code, 200, JSON.stringify(r.json));
  assert.match(r.pasted, /The person said: "yes, go with 40"/, 'the line was typed, so the absence below means something');
  assert.doesNotMatch(r.pasted, /unhold/);
  assert.equal(r.after.onHoldAnsweredAt, undefined);
});

test('the holder writing on its for-you hold marks the person told, by the task', async () => {
  const r = await send(true, { 'x-kosmos-agent-token': sendertoken.mint('leo').token }, 'can you decide the price?');
  assert.equal(r.code, 200, JSON.stringify(r.json));
  assert.equal(r.after.onHoldToldVia, 'task');
  assert.equal(typeof r.after.onHoldToldAt, 'string');
});

test('directly: a reply naming the hold marks the person told; the person\'s next message carries the unhold note, once', async () => {
  const board = fleet.install([fleet.agent('cy', { state: 'idle' })]);
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(() => {});
  const SCREEN = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  const dm = (text) => fetch(`${base}/api/agent/cy/thread`, { method: 'POST', headers: SCREEN, body: JSON.stringify({ text }) });
  const pasted = () => calls.filter((a) => a[0] === 'set-buffer').map((a) => a[a.length - 1]).join('');
  try {
    const p = projects.create({ name: 'Told Direct ' + (++seq) });
    projects.addAgent(p.id, 'cy', board.agents);
    const t = tasks.create(p.id, { sentence: 'pick a price', who: 'cy' }, board.agents);
    tasks.setOnHold(p.id, t.number, true, { forPerson: true });
    const now = () => tasks.byNumber(projects.get(p.id), t.number);
    // CONTROL: before any tell, the person's message carries no note.
    calls.length = 0;
    assert.equal((await dm('hello')).status, 200);
    assert.ok(pasted().includes('hello'), 'control: typed: ' + pasted());
    assert.ok(!pasted().includes('unhold'), 'a note before any tell: ' + pasted());
    const reply = await fetch(`${base}/api/reply`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': sendertoken.mint('cy').token },
      body: JSON.stringify({ text: 'About task ' + t.number + ': is 40 the price?' }) });
    assert.equal(reply.status, 200, await reply.text());
    assert.equal(now().onHoldToldVia, 'reply', JSON.stringify(now()));
    calls.length = 0;
    assert.equal((await dm('yes, 40')).status, 200);
    assert.match(pasted(), new RegExp('\\[kosmos\\] you have task #' + t.number + ' in Told Direct \\d+ on hold waiting on this person.*kosmos task unhold ' + p.id + ' ' + t.number), pasted());
    assert.equal(typeof now().onHoldAnsweredAt, 'string');
    calls.length = 0;
    assert.equal((await dm('and thanks')).status, 200);
    assert.ok(pasted().includes('and thanks'), 'control: typed: ' + pasted());
    assert.ok(!pasted().includes('unhold'), 'the note was repeated: ' + pasted());
  } finally {
    chat.setRunner(null); chat.setDryRun(true); board.restore();
  }
});

test('round 1 W2: a holder out of usage gets the line kept for later, and the kept line carries no unhold sentence', async () => {
  limitqueue.resetForTests(); fs.rmSync(limitqueue.dir(), { recursive: true, force: true });
  const r = await send(true, { 'sec-fetch-site': 'same-origin' }, 'yes, go with 40', true);
  assert.equal(r.code, 200, JSON.stringify(r.json));
  assert.equal(r.kept.length, 1, 'CONTROL: the line was kept for leo, so the absence below means something: ' + JSON.stringify(r.json.delivered));
  assert.match(r.kept[0].envelope, /The person said: "yes, go with 40"/);
  assert.doesNotMatch(r.kept[0].envelope + (r.kept[0].trailer || ''), /unhold/);
  assert.doesNotMatch(r.pasted, /unhold/);
});
