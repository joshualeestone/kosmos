'use strict';

/**
 * kosmos#8318: every page route that answers with a whole task leaves out this computer's file paths (the delivered
 * file's `builtFilePath`, #8214), as the page's list views already do (#8227) and the built route's own mark does
 * (#8307). An agent's token answer keeps the path: the CLI reads it. One helper, `taskForCaller` in server.js, does it;
 * the source guard at the end keeps every `task:` answer going through it.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.nopath-8318.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-nopath-8318-'));
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
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');

let base;
let projectId;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install([
    fleet.agent('mona', { state: 'idle' }), fleet.agent('zed', { state: 'idle' }), fleet.agent('ivy', { state: 'idle' }),
  ]).agents;
  const p = projects.create({ name: 'Alpha' });
  for (const a of ['mona', 'zed', 'ivy']) projects.addAgent(p.id, a, roster);
  projectId = p.id;
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const PAGE = { 'sec-fetch-site': 'same-origin' };
const post = async (p, body, headers = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const asAgent = (name) => {
  const m = sendertoken.mint(name);
  assert.equal(m.ok, true, m.because);
  return { 'x-kosmos-agent-token': m.token };
};
const FILE = path.join(SANDBOX, 'flyer.pdf');
const FP = 'sha256:' + 'c'.repeat(64);

/* A task Mona delivered a file on, so its stored record carries builtFilePath. */
async function delivered(sentence) {
  const n = tasks.create(projectId, { sentence, who: 'mona' }).number;
  const r = await post(`/api/project/${projectId}/task/${n}/built`, { fingerprint: FP, file_path: FILE }, asAgent('mona'));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.task.builtFilePath, FILE, 'CONTROL: the stored task carries the delivered file\'s path');
  return n;
}
const stored = (n) => tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n);
/* One route, called by the page on a task freshly delivered for it: 200, that whole task, no path, and the stored task
   STILL carries the path, so its absence in the answer is the strip and not a mark the call cleared. */
async function pageGetsNoPath(label, suffix, body, prep) {
  const n = await delivered('Task for ' + label);
  if (prep) await prep(n);
  const r = await post(`/api/project/${projectId}/task/${n}/${suffix}`, body, PAGE);
  assert.equal(r.status, 200, `${label}: ${JSON.stringify(r.json)}`);
  assert.ok(r.json.task && typeof r.json.task === 'object', `${label}: CONTROL: the answer carries a whole task`);
  assert.equal(r.json.task.number, n, `${label}: CONTROL: it is that task`);
  assert.equal(stored(n).builtFilePath, FILE, `${label}: CONTROL: the stored task still has the path, so the test can see a strip`);
  assert.equal('builtFilePath' in r.json.task, false, `${label}: the page was sent the delivered file's path`);
}

/* Adding a part, closing a task and setting a repeat all clear the built mark, so the part, close, reopen and repeat
   routes have no path left to send, and the check route refuses the page: the source guard below covers those answers. */
test('#8318: each page route that answers with a whole task leaves the delivered file\'s path out', async () => {
  await pageGetsNoPath('due', 'due', { dueDate: '2026-12-31' });
  await pageGetsNoPath('done-when', 'done-when', { doneWhen: ['the flyer opens'] });
  await pageGetsNoPath('hold', 'hold', { onHold: true, because: 'waiting on the photo' });
  await pageGetsNoPath('unhold', 'hold', { onHold: false }, (n) => post(`/api/project/${projectId}/task/${n}/hold`, { onHold: true, because: 'x' }, PAGE));
  const other = tasks.create(projectId, { sentence: 'Print run', who: 'zed' }).number;
  await pageGetsNoPath('parent', 'parent', { parent: other });
});

test('#8318: an agent\'s token answer keeps the path (the CLI reads it), on the same routes', async () => {
  for (const [label, suffix, body] of [
    ['due', 'due', { dueDate: '2026-12-31' }],
    ['hold', 'hold', { onHold: true, because: 'waiting' }],
    ['done-when', 'done-when', { doneWhen: ['it opens'] }],
  ]) {
    const n = await delivered('Agent task for ' + label);
    const r = await post(`/api/project/${projectId}/task/${n}/${suffix}`, body, asAgent('mona'));
    assert.equal(r.status, 200, `${label}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.task.builtFilePath, FILE, `${label}: the agent's answer lost the path`);
  }
});

/* The guard: every answer in server.js that sends a whole task under `task:` goes through taskForCaller, except the
   built route, which strips through its own viaScreen line (#8307, kept as server.communitytaskdone-5313.test.js reads
   it), and task add's 201, whose `task` is a number. A new route that sends `task: t` straight fails here. */
test('#8318: every task: answer in server.js goes through taskForCaller (source guard)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const lines = src.split('\n');
  const answers = [];
  lines.forEach((l, i) => { if (/sendJson\(res, *\d+, *\{/.test(l) && /[{,] *task *[:,}]/.test(l)) answers.push([i + 1, l.trim()]); });
  assert.ok(answers.length >= 12, `CONTROL: the scan found the task answers (found ${answers.length})`);
  const bare = answers.filter(([, l]) => !/task: *taskForCaller\(/.test(l)
    && !/task: out\.task, changed: out\.changed === true/.test(l)    // the built route: its viaScreen line strips it
    && !/task: made && made\.number/.test(l));                       // task add: the number, not a task
  assert.deepEqual(bare, [], 'a task answer that skips taskForCaller:\n' + bare.map(([n, l]) => `  server.js:${n}: ${l.slice(0, 120)}`).join('\n'));
  const built = src.indexOf('task: out.task, changed: out.changed === true');
  assert.ok(built > 0 && /if \(viaScreen\) out\.task = tasks\.withoutFilePaths\(out\.task\);/.test(src.slice(built - 400, built)),
    'the built route no longer strips its page answer just above its sendJson');
});
