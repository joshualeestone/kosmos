'use strict';

/**
 * #7407: taking a task off hold keeps whoever is on it, and the answer says who has it now (or that the next idle agent
 * will get it, and how to choose), from both commands (Mac install/kosmos, Windows tools/windows/kosmos-cli.js), against a
 * real board and the real task engine.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.unhold-owner-7407.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-unholdowner-cli-'));
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
const assigner = require('./engine/assigner');
const assignerSetting = require('./engine/assigner-setting');

let base;
let projectId;
let board;
test.before(async () => {
  board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' }), fleet.agent('kai', { state: 'idle' })]);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'Unhold' }).id;
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

const make = (label, who, made) => tasks.create(projectId, { sentence: 'Unhold ' + label, ...(who ? { who } : {}), ...(made ? { made } : {}) }).number;
const holdThenUnhold = async (run, n) => {
  const h = await run(['task', 'hold', projectId, String(n)], token('mara'));
  assert.equal(h.code, 0, h.text);
  assert.doesNotMatch(h.text, /stays with|Nobody is on it/, 'a hold says nothing about who gets it: ' + h.text);
  return run(['task', 'unhold', projectId, String(n)], token('mara'));
};

test('#7407: a task taken off hold keeps whoever was on it, and both commands say so', async () => {
  for (const [label, run] of BOTH) {
    const n = make('kept ' + label, 'otto');
    const r = await holdThenUnhold(run, n);
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, /^\s*It stays with otto\.$/m, label + ': ' + r.text);
    assert.deepEqual(tasks.whoOf(taskOf(n)), ['otto'], label + ': the owner changed');
    assert.equal(assigner.handOutable(taskOf(n)), false, label + ': the Assigner could hand it to someone else');
  }
});

test('#7407: a task nobody is on says the next idle agent will get it, and how to choose', async () => {
  for (const [label, run] of BOTH) {
    const n = make('nobody ' + label);
    const r = await holdThenUnhold(run, n);
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, /^\s*Nobody is on it, so Kosmos will give it to the next idle agent on the project\. To choose who, assign it now\.$/m, label + ': ' + r.text);
    assert.match(r.text, new RegExp('^\\s*kosmos task assign ' + projectId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ' + n + ' <agent>$', 'm'), label + ': ' + r.text);
    assert.equal(assigner.handOutable(taskOf(n)), true, label + ': CONTROL, the sentence matches what the Assigner will do');
  }
});

test('#7407: with the Assigner off, or a task it never hands out, the answer does not promise a hand-out', async () => {
  for (const [label, run] of BOTH) {
    const w = make('webhook ' + label, null, { via: 'webhook', by: 'hook' });
    const rw = await holdThenUnhold(run, w);
    assert.match(rw.text, /Nobody is on it, and Kosmos does not hand this one out on its own\./, label + ': ' + rw.text);
    assert.doesNotMatch(rw.text, /task assign/, label);
    assert.equal(assigner.handOutable(taskOf(w)), false, label);
    assignerSetting.setOn(false);
    try {
      const n = make('off ' + label);
      const r = await holdThenUnhold(run, n);
      assert.match(r.text, /Nobody is on it, and Kosmos will not give it to anyone until a person does\./, label + ': ' + r.text);
    } finally {
      assignerSetting.setOn(true);
    }
  }
});

test('#7407: the route answers next only when a task comes off hold', async () => {
  const n = make('route', 'otto');
  const hold = await (await fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${n}/hold`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"onHold":true}' })).json();
  assert.equal('next' in hold, false);
  const off = await (await fetch(`${base}/api/project/${encodeURIComponent(projectId)}/task/${n}/hold`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"onHold":false}' })).json();
  assert.equal(off.next, 'It stays with otto.');
});
