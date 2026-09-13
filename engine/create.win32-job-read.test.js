'use strict';
/**
 * win32-agent-job-read: an agent's job on Windows is its Scheduled Task, and the
 * setters and Trust & Restart read and change it there.
 *
 * 🛑 THE DEFECT. `create.readJob` read only the launchd plist, so on Windows it
 * answered null for every agent: changing a model, provider or account refused
 * with "was not started by Kosmos", and Trust & Restart skipped its trust write.
 *
 * 🔑 THE PLATFORM IS INJECTED (`platform: 'win32'`) so a Mac drives the win32 arm,
 * and EVERY win32job seam is stubbed: the runner (never the real schtasks) and the
 * anchorer (never the real interpreter copy under %LOCALAPPDATA%).
 *
 *   node --test engine/create.win32-job-read.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* SANDBOX EVERY ROOT BEFORE ANY REQUIRE (convention 2): store.ROOT freezes at
   require, and the trust writers fall back to real configs through overrides. */
const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'create-win32-jobread-')));
const HOME = path.join(SANDBOX, 'home');
for (const d of ['home', 'data', 'workers', 'launch', 'projects']) fs.mkdirSync(path.join(SANDBOX, d), { recursive: true });
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
delete process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;
delete process.env.KOSMOS_WORLD;
/* A runnable binary on every host, for setProvider's runner check. */
process.env.AGENT_WORKFORCE_CLAUDE_BIN = process.execPath;
process.env.AGENT_WORKFORCE_CODEX_BIN = process.execPath;

/* The default Claude account, so setAccount has somewhere to move an agent. */
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'first@example.com' } }));
/* A labelled codex account, for setCodexAccount. */
const CODEX_WORK = path.join(HOME, '.codex-work');
fs.mkdirSync(CODEX_WORK, { recursive: true });
fs.writeFileSync(path.join(CODEX_WORK, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-testtestJOBREAD01' }));

const cp = require('node:child_process');
const create = require('./create');
const job = require('./win32job');
const { specFromArgv } = require('./win32argv');
const { KEY } = require('./trust');

const XML_ENV = { USERNAME: 'kitty', USERDOMAIN: 'BOX', SystemRoot: 'C:\\Windows' };
const NO_SUCH = { ok: false, out: 'ERROR: The system cannot find the file specified.' };

/**
 * A Task Scheduler that holds `tasks` (task name -> the spec taskXml registered),
 * answers `/Query /XML` with the XML the real writer produces, and records every
 * `/Create` together with the definition it was handed (read from the transient
 * XML file while it still exists).
 */
function scheduler(tasks, opts) {
  const o = opts || {};
  const calls = [];
  job.setAnchorer(() => ({ ok: true, node: 'C:\\Anchor\\node.exe', boot: 'C:\\Anchor\\boot.js' }));
  job.setRunner((args) => {
    const rec = { args: args.slice() };
    calls.push(rec);
    const tn = args[args.indexOf('/TN') + 1];
    if (args[0] === '/Query' && args.includes('/XML')) {
      if (o.queryFails) return { ok: false, out: o.queryFails };
      const spec = tasks[tn];
      return spec ? { ok: true, out: job.taskXml(spec, XML_ENV) } : NO_SUCH;
    }
    if (args[0] === '/Create') {
      rec.xml = fs.readFileSync(args[args.indexOf('/XML') + 1]).toString('utf16le');
      if (o.createFails) return { ok: false, out: o.createFails };
      return { ok: true, out: '' };
    }
    return { ok: true, out: '' };
  });
  return calls;
}

/* The argv a /Create registered, parsed by the ONE parser the supervisor uses. */
function registeredSpec(rec) {
  const m = /<Arguments>([\s\S]*?)<\/Arguments>/.exec(rec.xml);
  assert.ok(m, 'the registered definition has no argument line: ' + rec.xml);
  const toks = [];
  const re = /"([^"]*)"/g;
  let t;
  const line = job.xmlUnescape(m[1]);
  while ((t = re.exec(line)) !== null) toks.push(t[1]);
  return specFromArgv(toks.slice(2));
}
const creates = (calls) => calls.filter((c) => c.args[0] === '/Create');
const queries = (calls) => calls.filter((c) => c.args[0] === '/Query');

function taskFor(name, fields) {
  return { name, cwd: 'C:\\work\\' + name, node: 'C:\\n.exe', supervisor: 'C:\\s.js', ...fields };
}

test.after(() => {
  job.setRunner(null);
  job.setAnchorer(null);
  delete process.env.KOSMOS_WORLD;
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

/* ── the readJob win32 arm ─────────────────────────────────────────────────── */

test('readJob on win32 reads the agent task in the default world', () => {
  const calls = scheduler({
    'Kosmos\\agent-ava': taskFor('ava', { model: 'claude-opus-x', configDir: 'C:\\Users\\kitty\\.claude-work', runner: 'claude', claudeBin: 'C:\\bin\\claude.exe' }),
  });
  assert.deepEqual(create.readJob('ava', undefined, 'win32'), {
    claude: 'C:\\bin\\claude.exe', tmux: null, model: 'claude-opus-x', configDir: 'C:\\Users\\kitty\\.claude-work', runner: 'claude',
  });
  assert.equal(queries(calls)[0].args[2], 'Kosmos\\agent-ava', 'it did not ask for the default world task name');
});

test('readJob on win32 reads a named Kosmos agent from agent-name+world', () => {
  const calls = scheduler({
    'Kosmos\\agent-ava+qa': taskFor('ava', { runner: 'codex', configDir: 'C:\\h\\.codex-qa', world: 'qa' }),
  });
  const explicit = create.readJob('ava', 'qa', 'win32');
  assert.deepEqual(explicit, { claude: null, tmux: null, model: null, configDir: 'C:\\h\\.codex-qa', runner: 'codex' });
  assert.equal(queries(calls)[0].args[2], 'Kosmos\\agent-ava+qa');
  /* Control: the default world has no task of that name, so the key is doing the work. */
  assert.equal(create.readJob('ava', undefined, 'win32'), null, 'the default world read another Kosmos task');
  /* And a board booted into the named world reaches it with no world passed. */
  process.env.KOSMOS_WORLD = 'qa';
  try {
    assert.equal(create.readJob('ava', undefined, 'win32').runner, 'codex');
  } finally { delete process.env.KOSMOS_WORLD; }
});

test('readJobVerdict on win32 tells an absent task from one it could not read', () => {
  scheduler({});
  assert.deepEqual(create.readJobVerdict('ghost', undefined, 'win32'), { job: null, win32: true, absent: true });
  scheduler({}, { queryFails: 'ERROR: Access is denied.' });
  const v = create.readJobVerdict('locked', undefined, 'win32');
  assert.equal(v.job, null);
  assert.equal(v.absent, undefined, 'a failed look was reported as an absence');
  assert.match(v.because, /Access is denied/);
});

test('readJob on win32 is answered from the #2717 cache, and a re-register forgets it', () => {
  const tasks = { 'Kosmos\\agent-ava': taskFor('ava', { runner: 'claude', claudeBin: 'C:\\bin\\claude.exe' }) };
  const calls = scheduler(tasks);
  create.readJob('ava', undefined, 'win32');
  create.readJob('ava', undefined, 'win32');
  assert.equal(queries(calls).length, 1, 'every read spawned schtasks, which on the five-second poll is one spawn per agent');
  const r = create.setModel('ava', create.modelsFor('anthropic')[0].key, { platform: 'win32' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  create.readJob('ava', undefined, 'win32');
  assert.equal(queries(calls).length, 2, 'the re-register did not forget the remembered definition');
});

/* ── the setters re-register the task ──────────────────────────────────────── */

test('setModel on win32 re-registers the task with the new model and keeps account and binary', () => {
  const calls = scheduler({
    'Kosmos\\agent-ava': taskFor('ava', { model: 'old-model', configDir: 'C:\\acct', runner: 'claude', claudeBin: 'C:\\bin\\claude.exe' }),
  });
  const m = create.modelsFor('anthropic')[0];
  const r = create.setModel('ava', m.key, { platform: 'win32' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, 'the change was refused: ' + r.because);
  const made = creates(calls);
  assert.equal(made.length, 1, 'the task was not re-registered');
  assert.deepEqual(made[0].args.slice(0, 4), ['/Create', '/F', '/TN', 'Kosmos\\agent-ava']);
  const spec = registeredSpec(made[0]);
  assert.equal(spec.name, 'ava');
  assert.equal(spec.model, m.arg, 'the new model is not on the task line');
  assert.equal(spec.configDir, 'C:\\acct', 'the account was dropped by a model change');
  assert.equal(spec.runner, 'claude');
  assert.equal(spec.claudeBin, 'C:\\bin\\claude.exe', 'the recorded runner binary was dropped');
});

test('setModel on win32 in a named Kosmos re-registers that world task and keeps the world on its line', () => {
  const calls = scheduler({ 'Kosmos\\agent-ava+qa': taskFor('ava', { runner: 'claude', world: 'qa' }) });
  process.env.KOSMOS_WORLD = 'qa';
  try {
    const r = create.setModel('ava', create.modelsFor('anthropic')[0].key, { platform: 'win32' });
    assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  } finally { delete process.env.KOSMOS_WORLD; }
  const made = creates(calls);
  assert.equal(made.length, 1);
  assert.equal(made[0].args[3], 'Kosmos\\agent-ava+qa', 'a named Kosmos agent was re-registered under the default world name');
  assert.equal(registeredSpec(made[0]).world, 'qa');
});

test('setAccount on win32 moves a Claude agent to the default account through the task', () => {
  const calls = scheduler({ 'Kosmos\\agent-ava': taskFor('ava', { model: 'kept-model', configDir: 'C:\\acct', runner: 'claude' }) });
  fs.mkdirSync(create.workerDir('ava'), { recursive: true });
  const r = create.setAccount('ava', '', { platform: 'win32' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, 'the account change was refused: ' + r.because);
  const made = creates(calls);
  assert.equal(made.length, 1, 'the task was not re-registered');
  const spec = registeredSpec(made[0]);
  assert.equal(spec.configDir, undefined, 'the default account must write no configDir');
  assert.equal(spec.model, 'kept-model', 'the model was dropped by an account change');
});

test('setAccount on win32 moves a codex agent to another OpenAI home through the task', () => {
  const calls = scheduler({ 'Kosmos\\agent-cx': taskFor('cx', { runner: 'codex', model: 'gpt-x', claudeBin: 'C:\\bin\\codex.exe' }) });
  fs.mkdirSync(create.workerDir('cx'), { recursive: true });
  const r = create.setAccount('cx', CODEX_WORK, { platform: 'win32' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, 'the codex account change was refused: ' + r.because);
  const spec = registeredSpec(creates(calls)[0]);
  assert.equal(spec.runner, 'codex');
  assert.equal(spec.configDir, path.resolve(CODEX_WORK));
  assert.equal(spec.model, 'gpt-x');
  assert.equal(spec.claudeBin, 'C:\\bin\\codex.exe');
});

test('setProvider on win32 switches a codex agent to Claude through the task, dropping model and account', () => {
  const calls = scheduler({ 'Kosmos\\agent-sw': taskFor('sw', { runner: 'codex', model: 'gpt-x', configDir: 'C:\\h\\.codex-a' }) });
  fs.mkdirSync(create.workerDir('sw'), { recursive: true });
  const r = create.setProvider('sw', 'anthropic', { platform: 'win32', claudeBin: process.execPath });
  assert.equal(r.outcome, create.OUTCOME.CREATED, 'the provider switch was refused: ' + r.because);
  const spec = registeredSpec(creates(calls)[0]);
  assert.equal(spec.runner, 'claude');
  assert.equal(spec.model, undefined);
  assert.equal(spec.configDir, undefined);
  assert.equal(spec.claudeBin, process.execPath);
});

/* ── the refusals name what is actually wrong ──────────────────────────────── */

test('on win32 a missing task, an unreadable task and a failed re-register each say so, never "not started by Kosmos"', () => {
  const key = create.modelsFor('anthropic')[0].key;
  scheduler({});
  const missing = create.setModel('ghost', key, { platform: 'win32' });
  assert.equal(missing.outcome, create.OUTCOME.REFUSED);
  assert.match(missing.because, /no startup task in Task Scheduler \(Kosmos\\agent-ghost\)/);
  assert.doesNotMatch(missing.because, /not started by Kosmos/);

  scheduler({}, { queryFails: 'ERROR: Access is denied.' });
  const unreadable = create.setProvider('locked', 'openai', { platform: 'win32' });
  assert.match(unreadable.because, /could not read .*startup task in Task Scheduler \(ERROR: Access is denied\.\)/);
  const acct = create.setAccount('locked', '', { platform: 'win32' });
  assert.match(acct.because, /could not read .*startup task in Task Scheduler \(ERROR: Access is denied\.\)/);

  const calls = scheduler({ 'Kosmos\\agent-ava': taskFor('ava', { runner: 'claude' }) }, { createFails: 'ERROR: Access is denied.' });
  const failed = create.setModel('ava', key, { platform: 'win32' });
  assert.equal(failed.outcome, create.OUTCOME.REFUSED, 'a failed re-register was reported as a change');
  assert.match(failed.because, /could not update .*startup task in Task Scheduler .*Access is denied/);
  assert.equal(creates(calls).length, 1, 'control: the re-register was attempted');
});

test('the win32 re-register stays behind the live-execution gate (#1598)', () => {
  const calls = scheduler({ 'Kosmos\\agent-ava': taskFor('ava', { runner: 'claude' }) });
  const real = job.commandsAreReal;
  job.commandsAreReal = () => false;
  try {
    assert.throws(() => create.setModel('ava', create.modelsFor('anthropic')[0].key, { platform: 'win32' }),
      /tried to execute "schtasks\.exe \/Create/, 'an unauthorized re-register did not refuse');
  } finally { job.commandsAreReal = real; }
  assert.equal(creates(calls).length, 0, 'the task was re-registered without authorization');
  /* The predicate itself: no runner and no opt-in is not authorized. */
  job.setRunner(null);
  assert.equal(job.commandsAreReal(), false);
});

test('win32job never spawns schtasks from a test process that installed no runner', () => {
  job.setRunner(null);
  let spawned = 0;
  const realExec = cp.execFileSync;
  cp.execFileSync = () => { spawned += 1; throw Object.assign(new Error('stubbed'), { stderr: 'ERROR: stubbed' }); };
  try {
    const p = job.presence('guard-probe');
    assert.equal(spawned, 0, 'a test process reached execFileSync for schtasks');
    assert.equal(p.known, false, 'a refused look must not read as an answer');
    assert.equal(p.because, job.REFUSED_IN_TEST);
  } finally { cp.execFileSync = realExec; }
});

test('a board a test spawns (no --test in its execArgv) never spawns schtasks either', () => {
  /* The shape server.leftover-removable and its siblings use: `node -e` with the
     test's env. The child stubs its OWN execFileSync first, so even with the guard
     reverted it counts an attempt and never reaches the real Task Scheduler. */
  const script = [
    "const cp = require('node:child_process');",
    'let spawned = 0;',
    "cp.execFileSync = () => { spawned += 1; throw Object.assign(new Error('stubbed'), { stderr: 'ERROR: stubbed' }); };",
    'const job = require(' + JSON.stringify(path.join(__dirname, 'win32job.js')) + ');',
    "const p = job.presence('guard-child');",
    'process.stdout.write(JSON.stringify({ spawned, testFlag: process.execArgv.some((a) => a.startsWith("--test")), because: p.because }));',
  ].join('\n');
  const out = JSON.parse(cp.execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env } }));
  assert.equal(out.testFlag, false, 'control: the child must look like a spawned board, not a test process');
  assert.equal(out.spawned, 0, 'a board spawned by a test reached execFileSync for schtasks');
  assert.equal(out.because, job.REFUSED_IN_TEST);
});

/* ── Trust & Restart ───────────────────────────────────────────────────────── */

test('trustAgentFolder on win32 writes the trust entry for a task-started Claude agent', () => {
  scheduler({ 'Kosmos\\agent-trusty': taskFor('trusty', { runner: 'claude' }) });
  const folder = create.workerDir('trusty');
  fs.mkdirSync(folder, { recursive: true });
  const t = create.trustAgentFolder('trusty', { platform: 'win32' });
  assert.equal(t.wrote, true, 'the trust step was skipped on win32: ' + JSON.stringify(t));
  assert.equal(t.runner, 'claude');
  const cfg = JSON.parse(fs.readFileSync(path.join(HOME, '.claude.json'), 'utf8'));
  /* Compared with separators normalised: the trust writer keys a Windows folder with
     forward slashes, a Mac one natively, and this arm is about WHETHER the entry was
     written, not its spelling (server.trust-restart-fallback-2129 pins that). */
  const want = fs.realpathSync.native(create.workerDir('trusty')).replace(/\\/g, '/');
  const hit = Object.keys(cfg.projects || {}).find((k) => k.replace(/\\/g, '/') === want);
  assert.ok(hit && cfg.projects[hit][KEY] === true,
    'no trust entry for the agent folder: ' + JSON.stringify(Object.keys(cfg.projects || {})));
});

test('trustAgentFolder on win32 says whether the task is missing or unreadable', () => {
  scheduler({});
  assert.match(create.trustAgentFolder('ghost', { platform: 'win32' }).because, /no startup task in Task Scheduler/);
  scheduler({}, { queryFails: 'ERROR: Access is denied.' });
  assert.match(create.trustAgentFolder('locked', { platform: 'win32' }).because, /could not read .*startup task .*Access is denied/);
});

test('the Trust & Restart route takes its trust step from create.trustAgentFolder', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf("trust-and-restart$/);");
  assert.ok(at > -1, 'the route is gone');
  assert.match(src.slice(at, at + 1500), /create\.trustAgentFolder\(clean\)/,
    'the route does its own plist-only job read again');
});

/* ── the Mac arm is unchanged ──────────────────────────────────────────────── */

test('on darwin readJob still reads the plist, and setModel rewrites it without touching schtasks', () => {
  const calls = scheduler({});
  const name = 'macagent';
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, '/opt/bin/claude', '/opt/bin/tmux', null, '/Users/k/.claude-work', 'claude'), 'utf8');
  assert.deepEqual(create.readJob(name, undefined, 'darwin'), {
    claude: '/opt/bin/claude', tmux: '/opt/bin/tmux', model: null, configDir: '/Users/k/.claude-work', runner: 'claude',
  });
  const m = create.modelsFor('anthropic')[0];
  const r = create.setModel(name, m.key, { platform: 'darwin' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  const after = create.readJob(name, undefined, 'darwin');
  assert.equal(after.model, m.arg, 'the plist was not rewritten with the model');
  assert.equal(after.configDir, '/Users/k/.claude-work', 'the account was dropped');
  /* No task is registered by the Mac arm. (A /Query can still appear on a Windows
     host: spokenName's identity lookup reads the recorded runner through a
     platform-defaulted readJob, which is that host's correct behaviour.) */
  assert.equal(creates(calls).length, 0, 'the Mac arm registered a Scheduled Task: ' + JSON.stringify(calls.map((c) => c.args)));
  const gone = create.setModel('nomac', m.key, { platform: 'darwin' });
  assert.equal(gone.because, 'nomac was not started by Kosmos, so we cannot change what it runs on.');
  assert.equal(create.trustAgentFolder('nomac', { platform: 'darwin' }).because,
    'this agent has no Kosmos launch job, so there was no folder to trust');
});
