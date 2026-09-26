'use strict';

/**
 * #3951: POST /api/project/:id/task/:n/built, and `kosmos task built` on Mac (install/kosmos) and Windows
 * (tools/windows/kosmos-cli.js). The engine rules (clearing on close and on a new part, the state order) are proven
 * in engine/tasks.built-3951.test.js; this proves the surfaces: who is named as the builder, the note, --clear, the
 * refusals, and that the Tasks view reads the state.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.task-built-3951.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-built-srv-'));
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
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const win32job = require('./engine/win32job');
const cli = require('./tools/windows/kosmos-cli');

let base;
let projectId;
test.before(async () => {
  win32job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.', code: 1 }));
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install([fleet.agent('mona', { state: 'idle' })]).agents;
  const p = projects.create({ name: 'Alpha' });
  projects.addAgent(p.id, 'mona', roster);
  projectId = p.id;
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const newTask = (sentence) => tasks.create(projectId, { sentence, who: 'mona' }).number;
const stored = (n) => tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n);
/* A process post (no sec-fetch-site, no allowed Origin) is an agent's CLI; a screen post carries sec-fetch-site. */
const post = async (p, body, headers = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const screen = { 'sec-fetch-site': 'same-origin' };

test('an agent token names the agent as the builder; the note is kept and the history says built', async () => {
  const n = newTask('Ship the invite page');
  const minted = sendertoken.mint('mona');
  assert.equal(minted.ok, true, minted.because);
  const r = await post(`/api/project/${projectId}/task/${n}/built`, { note: 'waiting on the release' }, { 'x-kosmos-agent-token': minted.token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const t = stored(n);
  assert.equal(t.builtBy, 'mona');
  assert.equal(t.builtNote, 'waiting on the release');
  assert.ok(taskchat.read(projectId, n).some((e) => e.kind === 'built' && e.by === 'mona'));
});

test('from the screen the builder is the person (operator); clear takes the mark off', async () => {
  const n = newTask('Write the launch post');
  assert.equal((await post(`/api/project/${projectId}/task/${n}/built`, {}, screen)).status, 200);
  assert.equal(stored(n).builtBy, 'operator');
  const c = await post(`/api/project/${projectId}/task/${n}/built`, { clear: true }, screen);
  assert.equal(c.status, 200);
  assert.equal('builtAt' in stored(n), false);
});

test('a token that does not resolve is refused (403) and marks nothing', async () => {
  const n = newTask('Refused mark');
  const r = await post(`/api/project/${projectId}/task/${n}/built`, {}, { 'x-kosmos-agent-token': 'f'.repeat(64) });
  assert.equal(r.status, 403, JSON.stringify(r.json));
  assert.equal('builtAt' in stored(n), false);
});

test('a closed task is 409, a missing task or project 404, a body that is not an object 400', async () => {
  const n = newTask('Already closed');
  tasks.close(projectId, n);
  const closed = await post(`/api/project/${projectId}/task/${n}/built`, {}, screen);
  assert.equal(closed.status, 409);
  assert.match(closed.json.error, /closed already/);
  assert.equal((await post(`/api/project/${projectId}/task/9999/built`, {}, screen)).status, 404);
  assert.equal((await post('/api/project/no-such-project/task/1/built', {}, screen)).status, 404);
  assert.equal((await post(`/api/project/${projectId}/task/${newTask('x')}/built`, [1], screen)).status, 400);
});

test('the Tasks view reads the state: a marked task is "built", with who and the note on its row', async () => {
  const n = newTask('Shown as built');
  await post(`/api/project/${projectId}/task/${n}/built`, { note: 'needs a release' }, screen);
  const rows = (await (await fetch(`${base}/api/tasks?view=tasks`)).json()).tasks;
  const row = rows.find((t) => t.projectId === projectId && t.number === n);
  assert.equal(row.state, 'built');
  assert.equal(row.builtBy, 'operator');
  assert.equal(row.builtNote, 'needs a release');
});

async function win(argv, agentToken = null) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: base,
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: () => agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('Windows `task built` marks with the agent token and a note; --clear takes it off; bad input exits 2', async () => {
  const n = newTask('Windows marks it');
  const minted = sendertoken.mint('mona');
  const r = await win(['task', 'built', projectId, String(n), 'waiting', 'on', 'QA'], minted.token);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /built, waiting to be released or checked/);
  assert.equal(stored(n).builtBy, 'mona');
  assert.equal(stored(n).builtNote, 'waiting on QA', 'the note lost a word');
  const c = await win(['task', 'built', projectId, String(n), '--clear'], minted.token);
  assert.equal(c.code, 0, c.err);
  assert.match(c.out, /Took the built mark off/);
  assert.equal('builtAt' in stored(n), false);
  assert.equal((await win(['task', 'built', projectId])).code, 2);
  assert.equal((await win(['task', 'built', projectId, 'two'])).code, 2);
  tasks.close(projectId, n);
  const refused = await win(['task', 'built', projectId, String(n)], minted.token);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /closed already/);
});

const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args, extra = {}) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: '', ...extra };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}

test('Mac `kosmos task built` marks with the agent token and a quoted note; --clear takes it off; bad input exits 2', async () => {
  const n = newTask('Mac marks it');
  const minted = sendertoken.mint('mona');
  const r = await mac(['task', 'built', projectId, String(n), 'waiting on "the" release'], { KOSMOS_AGENT_TOKEN: minted.token });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /built, waiting to be released or checked/);
  assert.equal(stored(n).builtBy, 'mona');
  assert.equal(stored(n).builtNote, 'waiting on "the" release', 'the quote in the note did not survive the JSON');
  const c = await mac(['task', 'built', projectId, String(n), '--clear'], { KOSMOS_AGENT_TOKEN: minted.token });
  assert.equal(c.code, 0, c.out);
  assert.equal('builtAt' in stored(n), false);
  assert.equal((await mac(['task', 'built', projectId])).code, 2);
  assert.equal((await mac(['task', 'built', projectId, 'two'])).code, 2);
  const help = await mac(['task']);
  assert.match(help.out, /kosmos task built <project-id> <task-number>/);
});
