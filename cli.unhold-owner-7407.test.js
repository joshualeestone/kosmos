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
    // Review 1: CONTROL against the Assigner itself, not the function the sentence reads: pick gives it out.
    const p = projects.readAll().find((x) => x.id === projectId);
    const only = { ...p, tasks: [taskOf(n)] };
    assert.equal((assigner.pick('mara', [only], new Set()) || {}).n, n, label + ': pick hands it to an idle agent');
  }
});

test('#7407: with the Assigner off, or a task it never hands out, the answer does not promise a hand-out', async () => {
  for (const [label, run] of BOTH) {
    const w = make('webhook ' + label, null, { via: 'webhook', by: 'hook' });
    const rw = await holdThenUnhold(run, w);
    assert.match(rw.text, /Nobody is on it, and Kosmos does not hand this one out on its own\. To choose who, assign it now\./, label + ': ' + rw.text);
    assert.match(rw.text, /kosmos task assign /, label + ': assigning is the only way it moves, so the command is shown');
    assert.equal(assigner.handOutable(taskOf(w)), false, label);
    assignerSetting.setOn(false);
    try {
      const n = make('off ' + label);
      const r = await holdThenUnhold(run, n);
      assert.match(r.text, /Nobody is on it, and the Assigner is off, so it waits for a person\. To choose who, assign it now\./, label + ': ' + r.text);
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

const unholdNext = async (n) => {
  const url = `${base}/api/project/${encodeURIComponent(projectId)}/task/${n}/hold`;
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"onHold":true}' });
  return (await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"onHold":false}' })).json()).next;
};
const projectNow = () => projects.readAll().find((x) => x.id === projectId);

test('#7407 review 1: someone who finished a part does not have the task; nobody on its open parts is said, and the Assigner agrees', async () => {
  const n = make('finished part', 'otto');
  const second = tasks.addPart(projectId, n, { sentence: 'the rest' });
  const first = tasks.progressOf(taskOf(n)).parts.find((x) => x.who === 'otto');
  tasks.setPartClosed(projectId, n, first.id, new Date().toISOString());
  assert.ok(second, 'setup: a second part');
  const next = await unholdNext(n);
  assert.doesNotMatch(next, /stays with otto/, next);
  assert.match(next, /^Nobody is on its open parts, and Kosmos does not hand out a task someone has worked on\. To choose who, assign it now\.$/, next);
  assert.equal(assigner.pick('mara', [{ ...projectNow(), tasks: [taskOf(n)] }], new Set()), null, 'CONTROL: pick does not hand it out either');
});

test('#7407 review 1: no agent that takes work here, a paused project, or a parent whose subtasks go first: no hand-out is promised', async () => {
  // Every agent on the project has swarm work switched off.
  projects.mutate(projectId, (p) => ({ ...p, swarmOff: ['mara', 'otto'] }));
  try {
    const n = make('swarm off');
    const next = await unholdNext(n);
    assert.match(next, /^Nobody is on it, and no agent on the project can be given it now .*To choose who, assign it now\.$/, next);
    assert.equal(assigner.pick('mara', [{ ...projectNow(), tasks: [taskOf(n)] }], new Set()), null, 'CONTROL: pick agrees');
  } finally {
    projects.mutate(projectId, (p) => ({ ...p, swarmOff: [] }));
  }
  // A parent with an open subtask that will move: the subtask goes first.
  const parent = make('parent');
  const child = make('child');
  tasks.setParent(projectId, child, parent);
  const pn = await unholdNext(parent);
  assert.match(pn, /^Nobody is on it, and no agent on the project can be given it now/, pn);
  // Paused: said as paused, with what happens on resume.
  const paused = make('paused');
  projects.mutate(projectId, (p) => ({ ...p, paused: true }));
  try {
    if (projects.isPaused(projectNow())) {
      const next = await unholdNext(paused);
      assert.match(next, /^Nobody is on it\. The project is paused; when it is resumed, Kosmos will give it to an idle agent on it\. To choose who, assign it now\.$/, next);
    } else {
      assert.fail('setup: could not pause the project with paused: true; find the field projects.isPaused reads');
    }
  } finally {
    projects.mutate(projectId, (p) => { const q = { ...p }; delete q.paused; return q; });
  }
});

test('#7407 review 1: with failover on, "stays with" says a limited holder\'s part may move', async () => {
  const n = make('failover', 'otto');
  const was = assignerSetting.read();
  assignerSetting.setFailover && assignerSetting.setFailover(true);
  try {
    if (assignerSetting.read().failover !== true) assert.fail('setup: could not switch failover on');
    const next = await unholdNext(n);
    assert.match(next, /^It stays with otto\. If they hit a usage limit, Kosmos may move it to an idle agent\.$/, next);
  } finally {
    assignerSetting.setFailover && assignerSetting.setFailover(was.failover === true);
  }
});
