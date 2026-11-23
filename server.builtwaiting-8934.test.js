'use strict';

/**
 * kosmos#8934 (agent feedback, four installs): a built task says what it waits on, a fixed choice (person, review,
 * release) that a screen and a list can read, where the built note is only words. `kosmos task built ... --waiting <who>`
 * (both CLIs) sends it; the board keeps it as builtWaitingOn; each mark says its own; the screen's mark sends none.
 * Every refusal has a control that the same command with a good value goes through.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.builtwaiting-8934.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-builtwaiting-')));
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
const tasklist = require('./engine/tasklist');
const taskguide = require('./engine/taskguide');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const winCli = require('./tools/windows/kosmos-cli');

let base;
let projectId;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install(['mona', 'zed'].map((a) => fleet.agent(a, { state: 'idle' }))).agents;
  const p = projects.create({ name: 'Waits' });
  for (const a of ['mona', 'zed']) projects.addAgent(p.id, a, roster);
  projectId = p.id;
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const post = async (p, body, headers = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const asAgent = (name) => ({ 'x-kosmos-agent-token': sendertoken.mint(name).token });
const stored = (n) => tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n);
const newTask = (s) => tasks.create(projectId, { sentence: s, who: 'mona' }).number;

test('engine: each value is stored; an unknown one is refused and writes nothing; the person\'s mark sends none', () => {
  for (const w of tasks.WAITING_ON) {
    const n = newTask('Deliver ' + w);
    const out = tasks.setBuilt(projectId, n, { by: 'mona', note: 'done', waitingOn: w });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(stored(n).builtWaitingOn, w);
  }
  assert.deepEqual(tasks.WAITING_ON, ['person', 'review', 'release']);
  const n = newTask('Deliver something odd');
  for (const bad of ['Person', 'agents', 'constructor', '__proto__', 1, true, {}]) {
    const out = tasks.setBuilt(projectId, n, { by: 'mona', waitingOn: bad });
    assert.equal(out.ok, false, 'accepted ' + JSON.stringify(bad));
    assert.match(out.because, /person, review or release/);
    assert.equal(stored(n).builtAt, undefined, 'a refused value still marked the task');
  }
  // CONTROL: no value is the old mark, and it goes through.
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona' }).ok, true);
  assert.equal('builtWaitingOn' in stored(n), false);
  const p = newTask('Deliver from the screen');
  assert.equal(tasks.setBuilt(projectId, p, { person: true, waitingOn: 'person' }).ok, true);
  assert.equal('builtWaitingOn' in stored(p), false, 'the person\'s own mark said it waits on the person');
});

test('engine: a change of only the value is a change; the same mark again is not; a re-mark without it and a clear drop it', () => {
  const n = newTask('Deliver the report');
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', note: 'done', waitingOn: 'review' }).changed, true);
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', note: 'done', waitingOn: 'review' }).changed, false, 'the same mark again was recorded');
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', note: 'done', waitingOn: 'person' }).changed, true, 'a new value alone was skipped as the same mark');
  assert.equal(stored(n).builtWaitingOn, 'person');
  assert.equal(tasks.setBuilt(projectId, n, { by: 'mona', note: 'done' }).changed, true, 'dropping the value alone was skipped as the same mark');
  assert.equal('builtWaitingOn' in stored(n), false, 'a mark without --waiting kept the old value');
  tasks.setBuilt(projectId, n, { by: 'mona', note: 'done', waitingOn: 'release' });
  assert.equal(tasks.clearBuilt(projectId, n, { by: 'mona' }).ok, true);
  assert.equal('builtWaitingOn' in stored(n), false, 'a clear kept what it waited on');
});

test('route: an agent\'s mark records it; a bad value answers 400 and marks nothing; the screen\'s mark ignores one', async () => {
  const n = newTask('Ship the page');
  const r = await post(`/api/project/${projectId}/task/${n}/built`, { note: 'shipped', waiting_on: 'release' }, asAgent('mona'));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.task.builtWaitingOn, 'release', 'the answer does not carry it, so a CLI cannot tell it was recorded');
  assert.equal(stored(n).builtWaitingOn, 'release');
  const list = JSON.stringify(await (await fetch(base + '/api/tasks', { headers: { origin: base } })).json());
  assert.ok(list.includes('"builtWaitingOn":"release"'), 'the Tasks page is not sent it');
  const m = newTask('Ship the other page');
  const bad = await post(`/api/project/${projectId}/task/${m}/built`, { note: 'shipped', waiting_on: 'someone' }, asAgent('mona'));
  assert.equal(bad.status, 400, JSON.stringify(bad.json));
  assert.equal(stored(m).builtAt, undefined);
  const s = newTask('Ship from the screen');
  const screen = await post(`/api/project/${projectId}/task/${s}/built`, { waiting_on: 'person' }, { origin: base });
  assert.equal(screen.status, 200, JSON.stringify(screen.json));
  assert.equal(stored(s).builtWaitingOn, undefined, 'the screen\'s mark recorded a value it never sends');
});

test('the text list: the State and Built fields and the waits-on words say it; a mark without one reads as before', () => {
  const row = (extra) => ({ number: 7, sentence: 'Ship it', builtAt: new Date().toISOString(), builtBy: 'mona', ...extra });
  const show = (x) => tasklist.showLines({ tasks: [x] }, 7, projectId).lines.join('\n');
  assert.match(show(row({ builtWaitingOn: 'person' })), /State: +built, waiting on the person/);
  assert.match(show(row({ builtWaitingOn: 'release' })), /Built: .*by .*mona.*, waiting on a release/);
  // CONTROL: no value, the old words.
  const plain = show(row({}));
  assert.match(plain, /State: +built\b/);
  assert.equal(/waiting on/.test(plain), false, plain);
  // A stored value that is not one of the three says nothing (never "waiting on undefined" or a function's text).
  assert.equal(/waiting on/.test(show(row({ builtWaitingOn: 'constructor' }))), false);
});

test('the board page: the row helper says "waiting on you" for the person, and nothing for a mark without one', () => {
  const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const m = html.match(/function tskBuiltWaitsWords\(t\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'tskBuiltWaitsWords is not in web/index.html');
  const fn = new Function(m[0] + '\nreturn tskBuiltWaitsWords;')();
  assert.equal(fn({ builtWaitingOn: 'person' }), ', waiting on you');
  assert.equal(fn({ builtWaitingOn: 'review' }), ', waiting on a review');
  assert.equal(fn({ builtWaitingOn: 'release' }), ', waiting on a release');
  assert.equal(fn({}), '');
  assert.equal(fn({ builtWaitingOn: 'toString' }), '');
  // Both places a built mark is said call it: the Tasks row and the task's own page.
  assert.equal((html.match(/tskBuiltWaitsWords\(t\)/g) || []).length, 3, 'the row or the task page does not use it');
});

test('kosmos task --how says when to use each value', () => {
  const g = taskguide.guideText();
  for (const w of ['--waiting person', '--waiting review', '--waiting release']) assert.ok(g.includes(w), w);
});

const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
fs.symlinkSync(path.join(__dirname, 'engine'), path.join(MAC_HOME, 'engine'));
function mac(args, extra = {}) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: sendertoken.mint('mona').token, ...extra };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000, cwd: SANDBOX }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}
async function win(argv) {
  const out = [];
  const err = [];
  const code = await winCli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: sendertoken.mint('mona').token, KOSMOS_PORT: String(server.address().port) },
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => {
      const u = new URL(url);
      const res = await fetch(base + u.pathname + u.search, { method: init.method, headers: init.headers, body: init.body });
      return { status: res.status, text: async () => res.text() };
    },
  });
  return { code, out: out.join('\n') + '\n' + err.join('\n') };
}

for (const [name, run, skip] of [['Mac', mac, process.platform === 'win32' && 'the Mac CLI'], ['Windows', win, false]]) {
  test(`${name} \`kosmos task built --waiting\`: recorded and said; without it the option is named; the list tag says it`, { skip }, async () => {
    const n = newTask(name + ' report');
    const r = await run(['task', 'built', projectId, String(n), 'the report is done', '--waiting', 'person']);
    assert.equal(r.code, 0, r.out);
    assert.equal(stored(n).builtWaitingOn, 'person');
    assert.equal(stored(n).builtNote, 'the report is done', 'the value leaked into the note');
    assert.match(r.out, /built, waiting on the person\. Closing it clears the mark\./);
    assert.equal(/--waiting person, review or release/.test(r.out), false, 'the hint was given to a mark that said it');
    // CONTROL: the same command without --waiting goes through, reads as before, and names the option.
    const m = newTask(name + ' notes');
    const p = await run(['task', 'built', projectId, String(m), 'the notes are done']);
    assert.equal(p.code, 0, p.out);
    assert.equal('builtWaitingOn' in stored(m), false);
    assert.match(p.out, /built, waiting to be released or checked\./);
    assert.match(p.out, /mark it with --waiting person, review or release \(kosmos task --how\)/);
    const l = await run(['task', 'list', projectId]);
    assert.equal(l.code, 0, l.out);
    assert.match(l.out, new RegExp('\\[' + n + '\\] \\[built, waiting on the person\\] '), l.out);
    assert.match(l.out, new RegExp('\\[' + m + '\\] \\[built\\] '), 'a mark without one lost its plain tag: ' + l.out);
  });

  test(`${name}: an unknown value, --waiting with nothing, and --waiting with --clear are refused before the board`, { skip }, async () => {
    const n = newTask(name + ' slides');
    const bad = await run(['task', 'built', projectId, String(n), 'done', '--waiting', 'agents']);
    assert.equal(bad.code, 2, bad.out);
    assert.match(bad.out, /--waiting says what the task waits on: person, review or release \(got agents\)/);
    const empty = await run(['task', 'built', projectId, String(n), 'done', '--waiting']);
    assert.equal(empty.code, 2, empty.out);
    assert.match(empty.out, /--waiting says what the task waits on: person, review or release/);
    const both = await run(['task', 'built', projectId, String(n), '--clear', '--waiting', 'review']);
    assert.equal(both.code, 2, both.out);
    assert.match(both.out, /takes no --waiting/);
    assert.equal(stored(n).builtAt, undefined, 'a refused --waiting still marked the task');
    // CONTROL: a good value on the same task goes through.
    const ok = await run(['task', 'built', projectId, String(n), 'done', '--waiting', 'review']);
    assert.equal(ok.code, 0, ok.out);
    assert.equal(stored(n).builtWaitingOn, 'review');
  });
}
