'use strict';

/**
 * kosmos#8961: POST /api/msg/status, through the real server: a message sent with POST /api/msg, then the recipient's
 * report hook rows (selfreport.record, auto), then the status. Only the sender or the recipient is answered, and the
 * answer carries no message text. Then the bash CLI (`kosmos msg --status`) and the Windows CLI read the same route.
 *
 * Senders are named by their agent tokens (the header form `kosmos msg` uses); the roster comes through
 * status.setPaneSource, so this runs on every platform except the bash CLI arm, which needs bash and curl.
 *
 *   node --test server.msg-status-8961.test.js
 */
require('./test-support/tmpscope');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-msg-status-8961-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
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
const app = require('./server');
const { start, server } = app;
const status = require('./engine/status');
const create = require('./engine/create');
const chat = require('./engine/chat');
const selfreport = require('./engine/selfreport');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');

const NAMES = ['writer', 'mara', 'kai'];
const tokens = {};
let base;

test.before(async () => {
  status.setPaneSource(() => NAMES.map((n) => fleet.line({ session: n, claim: n })).join('\n') + '\n');
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const n of NAMES) {
    fs.mkdirSync(create.workerDir(n), { recursive: true });
    const minted = sendertoken.mint(n);
    assert.ok(minted.ok, 'could not mint a token for ' + n + ': ' + minted.because);
    tokens[n] = minted.token;
  }
  // Each agent has reported before (a turn ended earlier), so "no history" is not what these tests meet.
  for (const n of NAMES) assert.equal(selfreport.record(n, { state: 'idle', because: 'finished responding', auto: true }).recorded, true);
  await new Promise((done) => setTimeout(done, 5));
  // Typing is the tmux runner: the check before typing is answered as the agent's own live Claude pane.
  chat.setRunner((args) => {
    if (args[0] !== 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    const target = String(args[args.indexOf('-t') + 1] || '');
    const session = target.split(':')[0].replace(/^=/, '');
    return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t' + session + '\t0\n', err: '' };
  });
  chat.setDryRun(false);
});
test.after(() => {
  chat.setRunner(null);
  chat.setDryRun(true);
  status.setPaneSource(null);
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function post(route, from, body) {
  const res = await fetch(base + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tokens[from] },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function send(from, to, text, extra) {
  const r = await post('/api/msg', from, { to, text, ...(extra || {}) });
  assert.equal(r.json && r.json.delivery && r.json.delivery.state, 'placed', JSON.stringify(r.json));
  return r.json.delivery.id;
}
const hook = (who, state, because) => assert.equal(selfreport.record(who, { state, because, auto: true }).recorded, true);
const tick = () => new Promise((done) => setTimeout(done, 5));   // so a report's time is after the send's

test('#8961 a turn after delivery that ends with nothing sent back: read with no answer, no message text', async () => {
  const id = await send('writer', 'mara', 'the secret plan is 42');
  let r = await post('/api/msg/status', 'writer', { id });
  assert.equal(r.json.status, 'not_yet', JSON.stringify(r.json));
  await tick(); hook('mara', 'working', 'answering a prompt');
  r = await post('/api/msg/status', 'writer', { id });
  assert.equal(r.json.status, 'reading', JSON.stringify(r.json));
  await tick(); hook('mara', 'idle', 'finished responding');
  r = await post('/api/msg/status', 'writer', { id });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'read_no_answer', JSON.stringify(r.json));
  assert.match(r.json.sentence, /mara started a turn after your message arrived .* without sending you anything by command/);
  assert.doesNotMatch(JSON.stringify(r.json), /secret plan/, 'the status carried the message text');
  // The recipient may ask too; a third agent may not.
  assert.equal((await post('/api/msg/status', 'mara', { id })).json.status, 'read_no_answer');
  const out = await post('/api/msg/status', 'kai', { id });
  assert.equal(out.json.found, false);
  assert.match(out.json.sentence, /there is no direct message m\d+ sent by you or to you/);
});

test('#8961 history() marks only the hook\'s own turn sentences', async () => {
  assert.equal(selfreport.record('kai', { state: 'working', because: 'answering a prompt' }).recorded, true);   // the agent's own: no mark
  hook('kai', 'working', 'running Bash');   // a heartbeat: no mark
  hook('kai', 'working', 'answering a prompt');
  hook('kai', 'idle', 'finished responding');
  const rows = selfreport.history('kai').slice(-4);
  assert.deepEqual(rows.map((r) => r.turn || null), [null, null, 'start', 'end']);
});

test('#8961 an answer by command reads as answered, citing the message', async () => {
  const id = await send('writer', 'kai', 'ping');
  await tick();
  const back = await send('kai', 'writer', 'pong', { in_reply_to: id });
  const r = await post('/api/msg/status', 'writer', { id });
  assert.equal(r.json.status, 'answered', JSON.stringify(r.json));
  assert.equal(r.json.answer, back);
  assert.equal(r.json.cites, true);
});

test('#8961 a bad body or id is refused in words', async () => {
  assert.equal((await post('/api/msg/status', 'writer', {})).status, 400);
  const r = await post('/api/msg/status', 'writer', { id: 'x1' });
  assert.equal(r.json.found, false);
  assert.match(r.json.sentence, /not a message id/);
});

test('#8961 the bash CLI prints the board\'s sentence', { skip: process.platform === 'win32' }, async () => {
  const id = await send('writer', 'mara', 'second');
  await tick(); hook('mara', 'working', 'answering a prompt');
  await tick(); hook('mara', 'idle', 'finished responding');
  const port = String(server.address().port);
  // Async, never spawnSync: the board answering the CLI runs in this same process.
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME, KOSMOS_HOME: HOME, KOSMOS_PORT: port, TMPDIR: os.tmpdir(),
    AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh'), KOSMOS_AGENT_TOKEN: tokens.writer };
  const cli = (args) => run('bash', [path.join(__dirname, 'install', 'kosmos'), 'msg', ...args], { env, timeout: 30000 })
    .then((r) => ({ code: 0, text: r.stdout + r.stderr }), (e) => ({ code: e.code, text: String(e.stdout) + String(e.stderr) }));
  const ok = await cli(['--status', id]);
  assert.equal(ok.code, 0, ok.text);
  assert.match(ok.text, /mara started a turn after your message arrived .* without sending you anything by command/);
  const bad = await cli(['--status', 'nope']);
  assert.equal(bad.code, 2, bad.text);
  assert.match(bad.text, /Usage: kosmos msg --status <message id>/);
  const missing = await cli(['--status', 'm99999']);
  assert.equal(missing.code, 1, missing.text);
  assert.match(missing.text, /there is no direct message m99999/);
});

test('#8961 the Windows CLI prints the board\'s sentence', async () => {
  const id = await send('writer', 'mara', 'third');
  const wincli = require('./tools/windows/kosmos-cli.js');
  const winRun = async (argv) => {
    const out = []; const err = [];
    const hook = { resolveUrl: () => base, readBoardToken: () => null,
      agentToken: (e) => (/^[0-9a-f]+$/.test(e.KOSMOS_AGENT_TOKEN || '') ? e.KOSMOS_AGENT_TOKEN : null) };
    const code = await wincli.main(argv, { env: { KOSMOS_AGENT_TOKEN: tokens.writer }, hook, url: base,
      out: (x) => out.push(x), err: (x) => err.push(x) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  const ok = await winRun(['msg', '--status', id]);
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /mara has not started or finished a turn since your message arrived/);
  const bad = await winRun(['msg', '--status', 'bad']);
  assert.equal(bad.code, 2, bad.out + bad.err);
  assert.match(bad.err, /Usage: kosmos msg --status <message id>/);
});
