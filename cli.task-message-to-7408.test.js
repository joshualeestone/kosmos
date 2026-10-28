'use strict';

/**
 * #7408: kosmos task message --to <agent> tells agents besides the assignees, from both commands (Mac install/kosmos,
 * Windows tools/windows/kosmos-cli.js), against a real board and the real task engine, and from the route itself.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-message-to-7408.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskmsgto-cli-'));
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
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const taskchat = require('./engine/taskchat');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const cli = require('./tools/windows/kosmos-cli');

let base;
let projectId;
let board;
test.before(async () => {
  board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' }), fleet.agent('kai', { state: 'idle' })]);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'MsgTo' }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto'] }));   // kai is NOT on it
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  try { board.restore(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const taskOf = (n) => tasks.byNumber(projects.readAll().find((p) => p.id === projectId), n);
const isDone = (n) => tasks.progressOf(taskOf(n)).closed;
const token = (name) => sendertoken.mint(name).token;

async function win(argv, agentToken = null) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: base,
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: () => agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, text: out.concat(err).join('\n') };
}
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args, agentToken = '', port = server.address().port) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: agentToken };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, text: (stdout || '') + (stderr || '') });
    });
  });
}
const BOTH = [['Windows', win], ['Mac', mac]];

const said = (n) => taskchat.read(projectId, n).filter((x) => x.kind === 'said');
const make = (label, who) => tasks.create(projectId, { sentence: 'Message to ' + label, ...(who ? { who } : {}) }).number;
const post = (n, body) => fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${n}/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('#7408: on a task nobody holds, either command says nobody was told and how to name someone', async () => {
  for (const [label, run] of BOTH) {
    const n = make('nobody ' + label);
    const r = await run(['task', 'message', projectId, String(n), 'a ruling'], token('mara'));
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, /Nobody is assigned to it, so no agent was told\./, label + ': ' + r.text);
    assert.match(r.text, /To tell an agent anyway, name it: --to <agent>\./, label + ': ' + r.text);
    assert.equal(said(n).length, 1, label);
  }
});

test('#7408: --to tells a named agent on a task nobody holds, from either command', async () => {
  for (const [label, run] of BOTH) {
    const n = make('to ' + label);
    const r = await run(['task', 'message', projectId, String(n), '--to', 'otto', 'the', 'ruling'], token('mara'));
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.doesNotMatch(r.text, /Nobody is assigned|--to <agent>/, label + ': ' + r.text);
    assert.match(r.text, /(Told|Not told:|may have been told)[^.]*\botto\b/, label + ': the summary says what happened for otto: ' + r.text);
    assert.doesNotMatch(r.text, /does not know --to/, label);
    assert.equal(said(n).length, 1, label);
    assert.equal(said(n)[0].text, 'the ruling', label + ': --to and its name are not part of the words');
  }
});

test('#7408: --to an agent already assigned tells it once; the sender is never told', async () => {
  for (const [label, run] of BOTH) {
    const n = make('dup ' + label, 'otto');
    const r = await run(['task', 'message', projectId, String(n), '--to', 'otto', '--to', 'mara', 'once'], token('mara'));
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, /(Told|Not told:|may have been told)[^.]*\botto\b/, label + ': ' + r.text);
    assert.doesNotMatch(r.text, /mara/, label + ': the sender is not told: ' + r.text);
  }
});

test('#7408: --to an agent not on the project is refused and nothing is recorded', async () => {
  for (const [label, run] of BOTH) {
    const n = make('off ' + label);
    const r = await run(['task', 'message', projectId, String(n), '--to', 'kai', 'hello'], token('mara'));
    assert.equal(r.code, 1, label + ': ' + r.text);
    assert.match(r.text, /kai is not on this project, so that message was not recorded/, label + ': ' + r.text);
    assert.equal(said(n).length, 0, label + ': recorded anyway');
  }
});

test('#7408: a malformed --to is refused before anything is sent; past -- it is words', async () => {
  for (const [label, run] of BOTH) {
    const n = make('bad ' + label);
    for (const argv of [['--to'], ['--to', '--', 'x'], ['--to=otto', 'x'], ['--to', 'ot"to', 'x'], ['--to', 'otto']]) {
      const r = await run(['task', 'message', projectId, String(n), ...argv], token('mara'));
      assert.equal(r.code, 2, label + ' ' + argv.join(' ') + ': ' + r.text);
    }
    const eleven = Array.from({ length: 11 }, () => ['--to', 'otto']).flat();
    const many = await run(['task', 'message', projectId, String(n), ...eleven, 'x'], token('mara'));
    assert.equal(many.code, 2, label + ': ' + many.text);
    assert.match(many.text, /up to 10 agents/, label);
    assert.equal(said(n).length, 0, label + ': a refusal recorded something');
    const words = await run(['task', 'message', projectId, String(n), '--', '--to', 'otto'], token('mara'));
    assert.equal(words.code, 0, label + ': ' + words.text);
    assert.equal(said(n)[0].text, '--to otto', label + ': past -- it is the message');
  }
});

test('#7408: the route refuses a to that is not a list of 1 to 10 names, before recording', async () => {
  const n = make('route');
  for (const to of ['otto', [], [''], ['  '], [3], Array.from({ length: 11 }, () => 'otto'), ['x'.repeat(65)]]) {
    const r = await post(n, { text: 'hi', to });
    assert.equal(r.status, 400, JSON.stringify(to));
    assert.match(await r.text(), /to has to be a list of 1 to 10 agent names/, JSON.stringify(to));
  }
  const two = await post(n, { text: 'hi', to: ['kai', 'zed'] });
  assert.equal(two.status, 400);
  assert.match(await two.text(), /kai, zed are not on this project/);
  assert.equal(said(n).length, 0, 'a refusal recorded something');
  const ok = await post(n, { text: 'hi', to: ['otto'] });
  assert.equal(ok.status, 200, await ok.text());
  assert.equal(said(n).length, 1);
});

test('#7408: CONTROL, a message with no --to on an assigned task still tells the assignee only', async () => {
  for (const [label, run] of BOTH) {
    const n = make('ctl ' + label, 'otto');
    const r = await run(['task', 'message', projectId, String(n), 'plain'], token('mara'));
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, /otto/, label);
    assert.doesNotMatch(r.text, /--to <agent>/, label);
  }
});

test('#7408 review 1: the route delivers to a --to name once, also when it is assigned, and answers the names it took', async () => {
  const n = make('route-dup', 'otto');
  const r = await post(n, { text: 'once', to: ['otto', 'otto'] });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.delivered.filter((d) => d.agent === 'otto').length, 1, JSON.stringify(j.delivered));
  assert.deepEqual(j.to, ['otto']);
  const m = make('route-plain');
  const plain = await (await post(m, { text: 'no to' })).json();
  assert.equal('to' in plain, false, 'a message with no to answers none');
  const u = make('route-unassigned');
  const u1 = await (await post(u, { text: 'x', to: ['otto'] })).json();
  assert.deepEqual(u1.delivered.map((d) => d.agent), ['otto'], 'an unassigned task tells the --to name');
});

test('#7408 review 1: a sender that names only itself on a task nobody holds hears that nobody is assigned', async () => {
  for (const [label, run] of BOTH) {
    const n = make('self ' + label);
    const r = await run(['task', 'message', projectId, String(n), '--to', 'mara', 'me'], token('mara'));
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, /Nobody is assigned to it, so no agent was told\./, label + ': ' + r.text);
  }
});

test('#7408 review 1: against an older board that ignores to, both commands say the names were not told', async () => {
  const http = require('node:http');
  const old = http.createServer((req, res) => {
    if (req.method === 'POST' && /\/task\/\d+\/message$/.test(req.url)) {
      req.resume();
      req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, delivered: [], summary: 'Nobody is assigned to it, so no agent was told.' })); });
      return;
    }
    const up = http.request({ host: '127.0.0.1', port: server.address().port, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.statusCode = 502; res.end(); });
    req.pipe(up);
  });
  await new Promise((r) => old.listen(0, '127.0.0.1', r));
  const obase = 'http://127.0.0.1:' + old.address().port;
  try {
    const n = make('older');
    const argv = ['task', 'message', projectId, String(n), '--to', 'otto', 'ruling'];
    const m = await mac(argv, token('mara'), old.address().port);
    const out = []; const err = [];
    await cli.main(argv, { env: {}, url: obase, hook: { resolveUrl: () => obase, readBoardToken: () => null, agentToken: () => token('mara') }, out: (s) => out.push(s), err: (s) => err.push(s) });
    for (const [label, text] of [['Mac', m.text], ['Windows', out.concat(err).join('\n')]]) {
      assert.match(text, /This Kosmos does not know --to yet, so only the task's assignees were told\./, label + ': ' + text);
      assert.doesNotMatch(text, /name it: --to/, label + ': never tells them to do what they did: ' + text);
    }
  } finally {
    old.close();
  }
});
