'use strict';

/**
 * kosmos#8236 (feedback from a Windows test board: agents read the project and made plans of their own in the room):
 * a project can be marked as a test project (`kosmos project test <project-id> on|off`, PUT /api/project/<id>
 * {testOnly}). Then the Assigner sends no goal nudge for it (that nudge asks for up to 3 tasks, or a room post saying
 * there is nothing), each member's instructions say to do only what is asked there, and `project show` says so.
 * Tasks on it are still handed out as usual.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.project-test-8236.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-project-test-8236-')));
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
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const assigner = require('./engine/assigner');
const projectview = require('./engine/projectview');
const fleet = require('./test-support/fleet');
const cli = require('./tools/windows/kosmos-cli');
const messages = require('./engine/messages');
const http = require('node:http');

const LINE = 'A test project: do only what you are asked here. Add no tasks, plans or posts of your own.';
let base;
let board;
test.before(async () => {
  board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  try { board.restore(); } catch { /* best effort */ }
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const stored = (id) => projects.readAll().find((p) => p.id === id);
const instructions = () => fs.readFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'mara', 'CLAUDE.md'), 'utf8');
function onProject(name) {
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'mara'), { recursive: true });
  if (!fs.existsSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'mara', 'CLAUDE.md'))) {
    fs.writeFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'mara', 'CLAUDE.md'), '# Mara\n\nYou are an agent.\n');
  }
  const p = projects.create({ name });
  projects.addAgent(p.id, 'mara', board.agents);
  return p;
}
/* The block's lines for one project: from its name line to the next project's name line. */
function entryOf(text, name) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith('- **' + name + '**'));
  if (at < 0) return null;
  const end = lines.findIndex((l, i) => i > at && /^- \*\*/.test(l));
  return lines.slice(at, end < 0 ? undefined : end);
}

test('#8236 engine: testOnly is stored on, removed off, refused unless a boolean, and is a change on its own', () => {
  const p = projects.create({ name: 'Engine Test' });
  projects.edit(p.id, { testOnly: true });
  assert.equal(stored(p.id).testOnly, true);
  assert.equal(projects.isTestOnly(stored(p.id)), true);
  projects.edit(p.id, { testOnly: false });
  assert.equal('testOnly' in stored(p.id), false, 'off left the field behind');
  assert.equal(projects.isTestOnly(stored(p.id)), false);
  for (const bad of ['true', 1, null, {}]) assert.throws(() => projects.edit(p.id, { testOnly: bad }), /testOnly must be true or false/, JSON.stringify(bad));
  assert.equal('testOnly' in stored(p.id), false, 'a refused value was written');
  assert.throws(() => projects.edit(p.id, {}), /nothing here we can change/, 'CONTROL: an empty edit is still refused');
});

test('#8236 Assigner: no goal nudge on a test project; the same project without the flag is asked (control); its tasks are still handed out', () => {
  const T0 = Date.parse('2026-11-08T08:00:00Z');
  const goals = new Map([['pt', 'check the Windows reply path']]);
  const proj = (testOnly) => [{ id: 'pt', name: 'Test board', agents: ['mara'], tasks: [], ...(testOnly ? { testOnly: true } : {}) }];
  assert.equal(assigner.goalProject('mara', proj(true), goals, new Map(), T0), null, 'a test project\'s member was asked to draft tasks');
  const asked = assigner.goalProject('mara', proj(false), goals, new Map(), T0);
  assert.ok(asked && asked.projectId === 'pt', 'CONTROL: without the flag the member is asked: ' + JSON.stringify(asked));
  const withTask = [{ id: 'pt', name: 'Test board', agents: ['mara'], testOnly: true, tasks: [{ number: 1, sentence: 'Send one reply' }] }];
  const got = assigner.pick('mara', withTask, new Set());
  assert.ok(got && got.n === 1, 'a task on a test project was not handed out: ' + JSON.stringify(got));
});

test('#8236 instructions: the test project\'s entry carries the line, first under its name; another project\'s does not (control)', () => {
  const t = onProject('Test Board One');
  const other = onProject('Ordinary One');
  projects.edit(t.id, { testOnly: true });
  projects.syncAgent('mara', board.agents);
  const text = instructions();
  const entry = entryOf(text, 'Test Board One');
  assert.ok(entry, 'fixture: the test project is not in the block: ' + text);
  assert.equal(entry[1], '  - ' + LINE, 'the line is not first under the name: ' + entry.join('\n'));
  assert.ok(!entryOf(text, 'Ordinary One').join('\n').includes(LINE), 'CONTROL: an ordinary project carries the test line');
  // Review 1: the test project's entry invites no new tasks; the ordinary one still does (control).
  assert.ok(!entry.join('\n').includes('task add'), 'a test project still invites new tasks: ' + entry.join('\n'));
  assert.ok(entryOf(text, 'Ordinary One').join('\n').includes('task add'), 'CONTROL: the ordinary project lost its task commands');
  projects.edit(t.id, { testOnly: false });
  projects.syncAgent('mara', board.agents);
  assert.ok(!instructions().includes(LINE), 'turning it off left the line');
  projects.removeAgent(t.id, 'mara'); projects.removeAgent(other.id, 'mara');
});

test('#8236 review 1: a running agent owes a re-read when its project becomes a test project; an unchanged write owes none (control)', () => {
  const t = onProject('Reread Board');
  projects.syncAgent('mara', board.agents);
  assert.notEqual(projects.syncAgent('mara', board.agents).rulesChanged, true, 'CONTROL: an unchanged write owed a re-read');
  projects.edit(t.id, { testOnly: true });
  assert.equal(projects.syncAgent('mara', board.agents).rulesChanged, true, 'becoming a test project owed no re-read, so a running agent never learns it');
  assert.notEqual(projects.syncAgent('mara', board.agents).rulesChanged, true, 'the same block again owed a re-read');
  // Review 2: turning it off is read again too, as a resume is told, or a running agent keeps holding back.
  projects.edit(t.id, { testOnly: false });
  assert.equal(projects.syncAgent('mara', board.agents).rulesChanged, true, 'turning it off owed no re-read');
  assert.notEqual(projects.syncAgent('mara', board.agents).rulesChanged, true, 'CONTROL: the same block again owed a re-read');
  projects.removeAgent(t.id, 'mara');
});

test('#8236 review 3: joining or leaving a test project owes no re-read (its own line announces it); a swap of two does', () => {
  const a = onProject('Swap A');
  projects.syncAgent('mara', board.agents);
  const t = projects.create({ name: 'Joined Test' });
  projects.edit(t.id, { testOnly: true });
  projects.addAgent(t.id, 'mara', board.agents);
  assert.notEqual(projects.syncAgent('mara', board.agents).rulesChanged, true, 'joining a test project owed a re-read as well as its join line');
  projects.removeAgent(t.id, 'mara');
  assert.notEqual(projects.syncAgent('mara', board.agents).rulesChanged, true, 'leaving a test project owed a re-read');
  // A swap: one on, another off, in one write. The count is unchanged; the projects are not.
  const b = onProject('Swap B');
  projects.edit(a.id, { testOnly: true });
  projects.syncAgent('mara', board.agents);
  projects.edit(a.id, { testOnly: false });
  projects.edit(b.id, { testOnly: true });
  assert.equal(projects.syncAgent('mara', board.agents).rulesChanged, true, 'a swap of two test projects owed no re-read');
  projects.removeAgent(a.id, 'mara'); projects.removeAgent(b.id, 'mara');
});

test('#8236 review 1: a goal give-up on a test project is not shown as stalled; on an ordinary one it is (control)', () => {
  const now = Date.parse('2026-11-08T08:00:00Z');
  const rec = { at: now - 60000, tries: 3, agent: 'Mara', session: 'mara', because: 'could_not' };
  const mem = { askGaveUp: new Map([['pg', rec]]) };
  const proj = (testOnly) => ({ id: 'pg', agents: ['mara'], tasks: [], ...(testOnly ? { testOnly: true } : {}) });
  assert.ok(assigner.goalAskGaveUp(mem, proj(false), now), 'CONTROL: an ordinary project\'s give-up is not shown');
  assert.equal(assigner.goalAskGaveUp(mem, proj(true), now), null, 'a test project, never asked, was shown as stalled');
});

test('#8236 board: PUT {testOnly} from an agent sets it, re-tells the members, and the answer carries it; a bad value is refused', async () => {
  const p = onProject('Route Board');
  projects.syncAgent('mara', board.agents);
  assert.ok(!instructions().includes(LINE), 'fixture: the line was there before');
  const put = (body) => fetch(`${base}/api/project/${p.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': 'cd'.repeat(16) }, body: JSON.stringify(body) });
  const r = await put({ testOnly: true });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.equal(j.project && j.project.testOnly, true, 'the answer does not carry the flag');
  assert.equal(stored(p.id).testOnly, true);
  assert.equal(entryOf(instructions(), 'Route Board')[1], '  - ' + LINE, 'the members were not re-told');
  const bad = await put({ testOnly: 'yes' });
  assert.equal(bad.status, 400);
  assert.equal(stored(p.id).testOnly, true, 'a refused value changed the flag');
  // Review 1: an agent's change is said in the room, once per change.
  const notes = () => messages.record().rows.filter((m) => m.kind === 'note' && m.project === p.id).map((m) => m.text);
  assert.equal(notes().filter((t) => /made this a test project/.test(t)).length, 1, 'the room was not told: ' + JSON.stringify(notes()));
  assert.equal((await put({ testOnly: true })).status, 200);
  assert.equal(notes().filter((t) => /made this a test project/.test(t)).length, 1, 'the same value again was said again');
  const off = await put({ testOnly: false });
  assert.equal(off.status, 200);
  assert.equal((await off.json()).project.testOnly, false);
  assert.ok(!instructions().includes(LINE), 'turning it off was not re-told');
  assert.equal(notes().filter((t) => /turned off test mode/.test(t)).length, 1, 'turning it off was not said in the room');
  projects.removeAgent(p.id, 'mara');
});

test('#8236 project show: says when it is a test project, and says nothing otherwise (control)', () => {
  const show = (testOnly) => projectview.renderShow({ project: { id: 'pv', name: 'Shown', folder: '/x', briefFound: false, members: [], tasks: { total: 0 }, ...(testOnly === undefined ? {} : { testOnly }) } });
  const on = show(true);
  assert.ok(on.includes('Test project: its agents do only what they are asked, and Kosmos asks none of them to add tasks for it. Turn it off: kosmos project test pv off'), on.join('\n'));
  assert.ok(!show(false).some((l) => l.startsWith('Test project')), 'CONTROL: an ordinary project said it was a test project');
  assert.ok(!show(undefined).some((l) => l.startsWith('Test project')), 'an older board\'s answer said test project');
});

// ── Windows: tools/windows/kosmos-cli.js ────────────────────────────────────
async function win(argv, url = () => base) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: url(),
    hook: { resolveUrl: () => url(), readBoardToken: () => null, agentToken: () => null },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('#8236 Windows: project test on and off, and its refusals', async () => {
  const p = projects.create({ name: 'Win Board' });
  const on = await win(['project', 'test', p.id, 'on']);
  assert.equal(on.code, 0, on.err);
  assert.equal(on.out, p.id + ' is a test project now. Its agents are told to do only what they are asked, and Kosmos asks none of them to add tasks for it.');
  assert.equal(stored(p.id).testOnly, true);
  const off = await win(['project', 'test', p.id, 'off']);
  assert.equal(off.code, 0, off.err);
  assert.match(off.out, /is not a test project any more/);
  assert.equal('testOnly' in stored(p.id), false);
  assert.equal((await win(['project', 'test', p.id])).code, 2);
  assert.equal((await win(['project', 'test', p.id, 'yes'])).code, 2);
  assert.equal((await win(['project', 'test', p.id + ' x', 'on'])).err, 'there is no project by that name');
  assert.match((await win(['project', 'test', 'no-such-project', 'on'])).err, /^Kosmos could not mark that project: /);
  const help = await win(['project']);
  assert.match(help.out + help.err, /kosmos project test <project-id> on\|off/);
});

test('#8236 Windows review 1: an older board says to update; a 200 with an empty re-read is still a success', async () => {
  const answers = [];
  const stub = http.createServer((req, res) => {
    const a = answers.shift();
    res.writeHead(a.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(a.body));
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const url = () => 'http://127.0.0.1:' + stub.address().port;
  try {
    answers.push({ status: 400, body: { error: 'nothing here we can change' } });
    const old = await win(['project', 'test', 'p1', 'on'], url);
    assert.equal(old.code, 1);
    assert.equal(old.err, 'This Kosmos is older than kosmos project test. Update it, then run this again.');
    answers.push({ status: 200, body: { project: null } });
    const empty = await win(['project', 'test', 'p1', 'on'], url);
    assert.equal(empty.code, 0, empty.err);
    assert.match(empty.out, /^p1 is a test project now\./);
    answers.push({ status: 200, body: { project: { id: 'p1' } } });
    const dropped = await win(['project', 'test', 'p1', 'on'], url);
    assert.equal(dropped.code, 1, 'CONTROL: an answer without the flag read as recorded');
    assert.match(dropped.err, /did not record it/);
  } finally { stub.close(); }
});

// ── Mac: install/kosmos (bash 3.2) ─────────────────────────────────────────
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
fs.symlinkSync(path.join(__dirname, 'engine'), path.join(MAC_HOME, 'engine'));
function mac(args, port = server.address().port) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: '' };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}

test('#8236 Mac review 3: an older board says to update; a 200 with an empty re-read is still a success; a dropped field is not', { skip: process.platform === 'win32' && 'the Mac CLI' }, async () => {
  const answers = [];
  const stub = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/api/health')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"app":"kosmos"}'); return; }
    const a = answers.shift() || { status: 500, body: { error: 'unexpected' } };
    res.writeHead(a.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(a.body));
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  try {
    const port = stub.address().port;
    answers.push({ status: 400, body: { error: 'nothing here we can change' } });
    const old = await mac(['project', 'test', 'p1', 'on'], port);
    assert.equal(old.code, 1, old.out);
    assert.equal(old.out.trim(), 'This Kosmos is older than kosmos project test. Update it, then run this again.');
    answers.push({ status: 200, body: { project: null } });
    const empty = await mac(['project', 'test', 'p1', 'on'], port);
    assert.equal(empty.code, 0, empty.out);
    assert.match(empty.out.trim(), /^p1 is a test project now\./);
    answers.push({ status: 200, body: { project: { id: 'p1' } } });
    const dropped = await mac(['project', 'test', 'p1', 'on'], port);
    assert.equal(dropped.code, 1, 'CONTROL: an answer without the flag read as recorded: ' + dropped.out);
    assert.match(dropped.out, /did not record it/);
  } finally { stub.close(); }
});

test('#8236 Mac: project test on and off say what Windows says, and its refusals', { skip: process.platform === 'win32' && 'the Mac CLI' }, async () => {
  const p = projects.create({ name: 'Mac Board' });
  const on = await mac(['project', 'test', p.id, 'on']);
  assert.equal(on.code, 0, on.out);
  assert.equal(on.out.trim(), p.id + ' is a test project now. Its agents are told to do only what they are asked, and Kosmos asks none of them to add tasks for it.');
  assert.equal(stored(p.id).testOnly, true);
  const off = await mac(['project', 'test', p.id, 'off']);
  assert.equal(off.code, 0, off.out);
  assert.equal(off.out.trim(), p.id + ' is not a test project any more. Kosmos may ask its agents to add tasks toward its goal again.');
  assert.equal('testOnly' in stored(p.id), false);
  assert.equal((await mac(['project', 'test', p.id])).code, 2);
  assert.equal((await mac(['project', 'test', p.id, 'yes'])).code, 2);
  assert.match((await mac(['project', 'test', 'no-such-project', 'on'])).out, /Kosmos could not mark that project: /);
  const help = await mac(['project']);
  assert.match(help.out, /kosmos project test <project-id> on\|off/);
  assert.match((await mac(['project', 'nope'])).out, /\| pause \| test \| role \|/);
});
