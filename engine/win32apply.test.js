'use strict';
/**
 * win32-update-apply (updater slice S3): the helper that swaps a staged Windows build in, its
 * rollback, and the resumers that finish an update a crash interrupted.
 *
 * Every case runs in a sandbox: a scratch Kosmos folder (ROOT, with a person's `Projects` in it)
 * holding an "old" build, a staged "new" build in its WORK folder, a scratch anchor with its
 * node.exe and engine-path, and a scratch APPDATA. The scheduler is a stub (win32board.setRunner)
 * that records every call and plays a board: `/End` stops it, `/Run` "boots" whatever app ROOT holds
 * and answers with that build's identity. The clock only moves when the code sleeps. Nothing here
 * touches a real task, board, anchor or APPDATA.
 *
 *   node --test engine/win32apply.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

// Sandbox every root before requiring anything that reads one.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-w32apply-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.APPDATA = path.join(SANDBOX, 'appdata');

const win32anchor = require('./win32anchor');
const win32apply = require('./win32apply');
const win32board = require('./win32board');
const win32orphan = require('./win32orphan');
const win32swap = require('./win32swap');
const win32update = require('./win32update');

const NO_SCHEDULER = () => { throw new Error('this case installed no scheduler stub'); };
test.afterEach(() => win32board.setRunner(NO_SCHEDULER));
test.after(() => {
  win32board.setRunner(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ }
});

const T = { timeout: 30000 };
const LONG = { timeout: 600000 };
const ON_WINDOWS = process.platform === 'win32';
const OLD = '0.6.60';
const NEW = '0.6.61';
const OLD_ID = `${OLD}@default`;
const NEW_ID = `${NEW}@default`;
const PORT = 16555;
const README = '! READ ME FIRST - Windows will warn you.txt';
const APPLY_MODULE = path.join(__dirname, 'win32apply.js');
const BOOT_REPORT_ENV = 'KOSMOS_TEST_BOOT_REPORT';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const under = (child, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || !(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel));
};
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/* ─── the sandbox ─────────────────────────────────────────────────────────────────────────── */

/** The fake board: when the logon shim runs it, it reports which build booted and who started it. */
const SERVER_JS = `if (process.env.${BOOT_REPORT_ENV}) require('node:fs').writeFileSync(process.env.${BOOT_REPORT_ENV}, 'booted ' + require('./package.json').version + ' by ' + process.env.KOSMOS_WIN32_BOARD_TASK);\n`;

function writeBuild(dir, version, tag, o = {}) {
  const files = {
    'Kosmos.exe': `MZ the ${tag} launcher`,
    'open-board.js': `// the ${tag} browser opener`,
    [README]: `${tag}: Windows will warn you`,
    'manifest.json': JSON.stringify({ platform: 'win32', arch: 'x64', version }),
    'runtime/node.exe': o.nodeBytes || `the ${tag} node.exe`,
    'runtime/LICENSE': `MIT (${tag})`,
    'app/package.json': JSON.stringify({ name: 'agent-workforce', version }),
    'app/server.js': `// the ${tag} board\n${SERVER_JS}`,
    'app/web/index.html': `<title>${tag}</title>`,
    'app/engine/kosmos-report-hook.js': `// the ${tag} report hook`,
    /* The build's copy of the updater is the module under test, so the logon shim runs it. */
    'app/engine/win32apply.js': `module.exports = require(${JSON.stringify(APPLY_MODULE)});\n`,
    'bin/kosmos-cli.js': `// the ${tag} kosmos command`,
    'bin/kosmos.ps1': `# the ${tag} PowerShell shim`,
    'bin/kosmos': '#!/bin/sh',
  };
  for (const name of o.omit || []) delete files[name];
  for (const [rel, data] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
}

let cases = 0;
/** ROOT at 0.6.60 with a person's project in it, 0.6.61 staged, and the anchor pointing at ROOT. */
function freshInstall(o = {}) {
  cases += 1;
  const dir = path.join(SANDBOX, 'cases', String(cases));
  const root = path.join(dir, 'Kosmos');
  const env = { AGENT_WORKFORCE_DATA: path.join(dir, 'machine') };
  const anchor = win32anchor.anchorDir(process.platform, os.homedir(), env);
  writeBuild(root, OLD, 'old', { omit: o.oldOmits });
  fs.mkdirSync(path.join(root, 'Projects', 'garden'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Projects', 'garden', 'notes.txt'), "a person's own work");
  const work = path.join(root, win32update.WORK_DIRNAME);
  const staged = path.join(work, win32update.STAGED_DIRNAME);
  writeBuild(staged, o.to || NEW, 'new', { nodeBytes: o.sameRuntime ? 'the old node.exe' : undefined });
  fs.writeFileSync(path.join(work, win32update.DOWNLOAD_PART_NAME), 'the download');
  fs.mkdirSync(anchor, { recursive: true });
  fs.writeFileSync(path.join(anchor, win32anchor.NODE_NAME), `the anchored node.exe of ${OLD}`);
  /* With the line ending a hand edit in Notepad leaves (the shims trim it), so H6's write really
     changes the pointer's bytes and every rollback has to put these exact bytes back. */
  fs.writeFileSync(path.join(anchor, win32anchor.POINTER_NAME), path.join(root, 'app', 'engine') + '\r\n');
  return {
    dir, root, env, anchor, work, staged, log: [],
    journal: path.join(anchor, win32anchor.UPDATE_JOURNAL_NAME),
    statusAt: path.join(anchor, win32anchor.UPDATE_STATUS_NAME),
    previous: path.join(work, `previous-${OLD}`),
  };
}

/** B5's journal, as begin() writes it once prepare() has staged the new build. */
function stage(c, o = {}) {
  return win32apply.writeStagedJournal(c.journal, {
    root: c.root, anchor: c.anchor, fromVersion: OLD, fromIdentity: OLD_ID,
    prepared: { version: o.to || NEW, expectedIdentity: o.toIdentity || NEW_ID, sha256: 'a'.repeat(64), runtimeChanged: o.runtimeChanged !== false, stagedDir: c.staged },
    board: { pid: o.boardPid === undefined ? null : o.boardPid, port: PORT }, now: clock,
  });
}

/** Every file (content hash) and folder under `top`, except the folders in `skip`. */
function hashTree(top, skip = []) {
  const seen = {};
  if (!fs.existsSync(top)) return null;
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name);
      if (skip.some((s) => path.resolve(s) === path.resolve(full))) continue;
      const rel = path.relative(top, full);
      if (e.isDirectory()) { seen[rel + path.sep] = 'folder'; walk(full); } else seen[rel] = sha256(fs.readFileSync(full));
    }
  })(top);
  return seen;
}
/** What a rollback must give back byte for byte: ROOT (outside WORK), the anchored node.exe and the pointer. */
function installState(c) {
  const node = path.join(c.anchor, win32anchor.NODE_NAME);
  return {
    root: hashTree(c.root, [c.work]),
    node: fs.existsSync(node) ? sha256(fs.readFileSync(node)) : null,
    pointer: readText(path.join(c.anchor, win32anchor.POINTER_NAME)),
  };
}

/* ─── the board, played by the stub scheduler ────────────────────────────────────────────── */

let clock = 1700000000000;

/**
 * The stub scheduler and prober. `/Run` starts a board only when none runs (IgnoreNew), from whatever
 * app ROOT holds. Options: endDoesNothing (the board never stops), newNeverStarts (a new build that
 * does not boot), answerAs (id => the identity the booted board answers with).
 */
function playBoard(c, o = {}) {
  const sim = { running: true, identity: OLD_ID, calls: [] };
  const treeIdentity = () => {
    const pkg = readText(path.join(c.root, 'app', 'package.json'));
    return pkg ? `${JSON.parse(pkg).version}@default` : null;
  };
  win32board.setRunner((args) => {
    sim.calls.push(args.join(' '));
    const verb = args[0];
    if (verb === '/End') {
      if (!o.endDoesNothing) { sim.running = false; sim.identity = null; }
      return { ok: true, out: 'SUCCESS: The scheduled task was terminated.' };
    }
    if (verb === '/Run') {
      const id = treeIdentity();
      if (!sim.running && id && !(o.newNeverStarts && id !== OLD_ID)) {
        sim.running = true;
        sim.identity = o.answerAs ? o.answerAs(id) : id;
      }
      return { ok: true, out: 'SUCCESS: Attempted to run the scheduled task.' };
    }
    if (verb === '/Query') return { ok: true, out: `TaskName: Kosmos\\board\nStatus: ${sim.running ? 'Running' : 'Ready'}\n` };
    return { ok: false, out: 'the stub scheduler does not know ' + verb };
  });
  sim.deps = (extra = {}) => ({
    probe: async () => (sim.running ? { answering: true, identity: sim.identity } : { answering: false, identity: null }),
    portFree: async () => !sim.running,
    pidGone: () => true,
    sleep: async (ms) => { clock += ms; },
    sleepSync: (ms) => { clock += ms; },
    now: () => clock,
    log: (line) => c.log.push(line),
    ...extra,
  });
  return sim;
}

function assertRolledBack(c, before, sim, r, label) {
  assert.deepEqual(installState(c), before, `${label}: the tree, node.exe and pointer are byte-identical (${JSON.stringify(r)})\n${c.log.join('\n')}`);
  const j = readJson(c.journal);
  assert.equal(j.finished, true, `${label}: the journal is finished`);
  assert.ok(['rolled-back', 'not-started'].includes(j.outcome), `${label}: ${j.outcome}`);
  const status = readJson(c.statusAt);
  assert.equal(status.sentence, `The update did not take. Kosmos is still on ${OLD}.`, label);
  assert.equal(status.version, OLD);
  assert.ok(status.because, `${label}: the status says why`);
  assert.equal(fs.existsSync(c.previous), false, `${label}: no previous folder is left`);
  if (sim) {
    assert.equal(sim.running, true, `${label}: a board is running again`);
    assert.equal(sim.identity, OLD_ID, `${label}: and it is the old one`);
    assert.deepEqual(sim.calls.filter((call) => /agent-/.test(call)), [], `${label}: no agent task is touched`);
  }
}

/* ─── the happy path and the path guard ───────────────────────────────────────────────────── */

async function recordWrites(run) {
  const written = [];
  const note = (p) => { if (p !== undefined && p !== null && typeof p !== 'number') written.push(path.resolve(String(p))); };
  const spies = {
    openSync: (p, flags) => { if (flags !== undefined && flags !== 'r' && flags !== 'rs' && flags !== 0) note(p); },
    writeFileSync: (p) => note(p), appendFileSync: (p) => note(p), mkdirSync: (p) => note(p), rmSync: (p) => note(p),
    rmdirSync: (p) => note(p), unlinkSync: (p) => note(p), renameSync: (a, b) => { note(a); note(b); },
    linkSync: (a, b) => note(b), symlinkSync: (a, b) => note(b), copyFileSync: (a, b) => note(b), cpSync: (a, b) => note(b),
    utimesSync: (p) => note(p), truncateSync: (p) => note(p),
  };
  const real = {};
  for (const [name, spy] of Object.entries(spies)) {
    real[name] = fs[name];
    fs[name] = function recorded(...args) { spy(...args); return real[name].apply(this, args); };
  }
  try { await run(); } finally { for (const name of Object.keys(spies)) fs[name] = real[name]; }
  return written;
}

/** The test's own statement of what an update may write, independent of the module's guard. */
function allowedWrite(c, p) {
  if (under(p, c.work) && path.resolve(p) !== path.resolve(c.work)) return true;
  if (win32update.ENTRIES.some((entry) => under(p, path.join(c.root, entry)))) return true;
  for (const name of [win32anchor.UPDATE_JOURNAL_NAME, win32anchor.UPDATE_STATUS_NAME, win32anchor.POINTER_NAME, win32anchor.NODE_NAME]) {
    const file = path.join(c.anchor, name);
    if (path.resolve(p) === file) return true;
    if (path.dirname(path.resolve(p)) === path.resolve(c.anchor) && path.basename(p).startsWith(name + '.')) return true;
  }
  return false;
}

function appDataKosmos() {
  const dir = path.join(process.env.APPDATA, 'Kosmos');
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, 'board.token'))) fs.writeFileSync(path.join(dir, 'board.token'), 'a token');
  return dir;
}

test('the happy path: stopped, swapped in with app last, node.exe and the pointer replaced, confirmed by identity, cleaned up', T, async () => {
  const c = freshInstall();
  fs.mkdirSync(path.join(c.work, 'previous-0.6.50', 'app'), { recursive: true });
  const oldRoot = hashTree(c.root, [c.work, path.join(c.root, 'Projects')]);
  const newTree = hashTree(c.staged);
  const projects = hashTree(path.join(c.root, 'Projects'));
  const appData = appDataKosmos();
  const appDataBefore = hashTree(appData);
  stage(c);
  const sim = playBoard(c);
  const moves = [];
  let r;
  const written = await recordWrites(async () => {
    r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step, d) => { if (d && d.entry) moves.push(`${step} ${d.entry}`); } } }));
  });
  assert.deepEqual(r, { ok: true, outcome: 'updated', version: NEW }, c.log.join('\n'));
  const order = ['runtime', 'bin', 'Kosmos.exe', 'open-board.js', README, 'manifest.json', 'app'];
  assert.deepEqual(moves, [...order.map((e) => `H3 ${e}`), ...order.map((e) => `H4 ${e}`)], 'every entry out, then every entry in, app last both ways');
  assert.deepEqual(hashTree(c.root, [c.work, path.join(c.root, 'Projects')]), newTree, 'ROOT holds exactly the new build');
  assert.deepEqual(hashTree(c.previous), oldRoot, 'previous-0.6.60 holds exactly the old build');
  assert.deepEqual(hashTree(path.join(c.root, 'Projects')), projects, "the person's projects are untouched");
  assert.deepEqual(hashTree(appData), appDataBefore, '%APPDATA%\\Kosmos is untouched');
  assert.equal(fs.readFileSync(path.join(c.anchor, 'node.exe'), 'utf8'), 'the new node.exe', 'H5 replaced the anchored interpreter');
  assert.equal(readText(path.join(c.anchor, 'engine-path')), path.join(c.root, 'app', 'engine'));
  assert.deepEqual(sim.calls, ['/End /TN Kosmos\\board', '/Run /TN Kosmos\\board'], 'one end, one run, on the board task only');
  assert.equal(sim.identity, NEW_ID);
  const j = readJson(c.journal);
  assert.equal(j.finished, true);
  assert.equal(j.outcome, 'updated');
  assert.equal(j.phase, 'confirmed');
  assert.deepEqual(readJson(c.statusAt).sentence, `Kosmos is now on ${NEW}.`);
  assert.deepEqual(fs.readdirSync(c.work).sort(), [`previous-${OLD}`],
    'the staged tree, the download, the safety copy, the older previous-0.6.50 and the lock are gone; previous-0.6.60 stays');
  assert.deepEqual(fs.readdirSync(c.previous).sort(), [...order].sort(), 'previous-0.6.60 holds the entries and nothing else');
  assert.ok(fs.readdirSync(c.anchor).some((n) => n.startsWith('node.exe.retired-')), 'the retired interpreter is left to the anchoring sweep');
  /* 🛑 THE PATH GUARD: every path written is ROOT's entries, WORK, or the anchor's four files. */
  assert.ok(written.length > 30, 'the control: the writes were recorded');
  assert.deepEqual(written.filter((p) => !allowedWrite(c, p)), [], 'written outside what an update owns');
  assert.ok(written.some((p) => p === path.join(c.root, 'app')), 'the control: ROOT\\app itself is among the writes');
  assert.deepEqual(written.filter((p) => under(p, path.join(c.root, 'Projects')) || under(p, appData)), []);
});

test('the path guard holds through a rollback too, and the module refuses a write outside what it owns', T, async () => {
  const c = freshInstall();
  const before = installState(c);
  const projects = hashTree(path.join(c.root, 'Projects'));
  stage(c);
  const sim = playBoard(c, { newNeverStarts: true });
  let r;
  const written = await recordWrites(async () => { r = await win32apply.applyJournal(c.journal, sim.deps()); });
  assertRolledBack(c, before, sim, r, 'no new identity');
  assert.ok(written.length > 30);
  assert.deepEqual(written.filter((p) => !allowedWrite(c, p)), []);
  assert.deepEqual(hashTree(path.join(c.root, 'Projects')), projects);
  const guard = win32apply.writeGuard(readJson(c.journal), c.journal);
  for (const outside of [path.join(c.root, 'Projects', 'x'), c.root, c.work, path.join(c.anchor, 'board-boot.js'), path.join(c.anchor, 'supervisor-boot.js'), path.join(c.dir, 'elsewhere')]) {
    assert.throws(() => guard(outside), /which an update does not own/, outside);
  }
  for (const inside of [path.join(c.root, 'app'), path.join(c.root, 'app', 'x.js'), path.join(c.work, 'staged'), c.journal, c.statusAt,
    path.join(c.anchor, 'engine-path.writing-1-2-3'), path.join(c.anchor, 'node.exe.retired-1-2')]) {
    assert.equal(guard(inside), path.resolve(inside));
  }
});

test('the move order is every entry, runtime then bin first, app last', T, () => {
  const order = win32apply.moveOrder();
  assert.deepEqual([...order].sort(), [...win32update.ENTRIES].sort());
  assert.deepEqual(order.slice(0, 2), ['runtime', 'bin']);
  assert.equal(order[order.length - 1], 'app');
});

/* ─── an injected failure at every step, and at every move ────────────────────────────────── */

/** Every hook point an apply passes, in order: `before H3 bin`, `after H4 app`, `before H7-run #1`... */
async function hookPoints(o = {}) {
  const c = freshInstall(o.install);
  stage(c, o.stage);
  const sim = playBoard(c, o.board);
  const points = [];
  const key = (when, step, d) => `${when} ${step}${d && d.entry ? ' ' + d.entry : ''}${d && d.run ? ' #' + d.run : ''}`;
  await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (s, d) => points.push(key('before', s, d)), after: (s, d) => points.push(key('after', s, d)) } }));
  return { points, key };
}

test('an injected failure at every H step and at every single move rolls back to a byte-identical tree', LONG, async () => {
  const { points, key } = await hookPoints();
  const failurePoints = points.filter((p) => p !== 'before H9');
  assert.ok(failurePoints.length >= 30, 'the control: the points were found: ' + points.join(', '));
  for (const step of ['before H2', 'before H3', 'before H3 app', 'after H3 app', 'before H4 runtime', 'after H4 app', 'before H5-copy', 'before H5-swap', 'after H5-swap', 'before H6-write', 'after H6-write', 'before H7-run #1']) {
    assert.ok(failurePoints.includes(step), `the control: ${step} is among the points`);
  }
  for (const point of failurePoints) {
    const c = freshInstall();
    const before = installState(c);
    stage(c);
    const sim = playBoard(c);
    const r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: {
      before: (s, d) => { if (key('before', s, d) === point) throw new Error(`injected at ${point}`); },
      after: (s, d) => { if (key('after', s, d) === point) throw new Error(`injected at ${point}`); },
    } }));
    assert.equal(r.ok, false, point);
    assertRolledBack(c, before, sim, r, point);
    assert.match(readJson(c.statusAt).because, new RegExp(`injected at ${point.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&')}`), point);
  }
});

test('H2: a board that does not stop fails the update before anything moves, and the old board keeps serving', T, async () => {
  const c = freshInstall();
  const before = installState(c);
  stage(c);
  const sim = playBoard(c, { endDoesNothing: true });
  const r = await win32apply.applyJournal(c.journal, sim.deps());
  assert.equal(r.outcome, 'not-started');
  assertRolledBack(c, before, sim, r, 'H2');
  assert.match(readJson(c.statusAt).because, /Kosmos could not stop its board \(the board did not stop within 30 seconds \(port 16555 still answers\)\)/);
  assert.deepEqual(sim.calls, ['/End /TN Kosmos\\board', '/Run /TN Kosmos\\board']);
  assert.equal(readJson(c.journal).steps.filter((s) => s.step === 'H3').length, 0, 'nothing was moved');
});

test('H2: the board\'s own pid is waited for as well as its port', T, async () => {
  const c = freshInstall();
  stage(c, { boardPid: 4321 });
  const sim = playBoard(c);
  const asked = [];
  let polls = 0;
  const r = await win32apply.applyJournal(c.journal, sim.deps({ pidGone: (pid) => { asked.push(pid); polls += 1; return polls > 3; } }));
  assert.equal(r.outcome, 'updated', c.log.join('\n'));
  assert.deepEqual([...new Set(asked)], [4321]);
  assert.ok(polls >= 4, 'the stop waited until the pid was gone');
});

/* ─── confirmation is the identity, never the task ────────────────────────────────────────── */

test('a /Run that "succeeds" and starts nothing is not a confirmation: three runs, then the rollback', T, async () => {
  const c = freshInstall();
  const before = installState(c);
  stage(c);
  const sim = playBoard(c, { newNeverStarts: true });
  const r = await win32apply.applyJournal(c.journal, sim.deps());
  assertRolledBack(c, before, sim, r, 'nothing started');
  assert.equal(sim.calls.filter((call) => call.startsWith('/Run')).length, 4, 'three runs for the new board, one for the old');
  assert.match(readJson(c.statusAt).because, /the new board did not answer as 0\.6\.61@default \(no board answered, not 0\.6\.61@default\)/);
});

test('a board that starts but answers with any other identity is not a confirmation either', T, async () => {
  for (const answerAs of [(id) => (id === NEW_ID ? OLD_ID : id), (id) => (id === NEW_ID ? `${NEW}@another-world` : id), (id) => (id === NEW_ID ? null : id)]) {
    const c = freshInstall();
    const before = installState(c);
    stage(c);
    const sim = playBoard(c, { answerAs });
    /* The new board answers wrongly and keeps the port, so the rollback must stop it: End works here. */
    const r = await win32apply.applyJournal(c.journal, sim.deps());
    assertRolledBack(c, before, sim, r, 'wrong identity');
    assert.match(readJson(c.statusAt).because, /did not answer as 0\.6\.61@default \(a board answered as/);
  }
});

/* ─── not newer, and a journal that does not match the folder ─────────────────────────────── */

test('not newer: the helper refuses a build that is not newer than ROOT, and moves nothing', T, async () => {
  for (const to of [OLD, '0.6.59']) {
    const c = freshInstall({ to });
    const before = installState(c);
    stage(c, { to, toIdentity: `${to}@default` });
    const sim = playBoard(c);
    const r = await win32apply.applyJournal(c.journal, sim.deps());
    assert.equal(r.outcome, 'not-started');
    assert.match(r.because, new RegExp(`${to.replace(/\./g, '\\.')} is not newer than 0\\.6\\.60, and Kosmos never installs an older or equal version`));
    assert.deepEqual(installState(c), before);
    assert.deepEqual(sim.calls, [], 'the board was never stopped');
    assert.equal(readJson(c.statusAt).sentence, `The update did not take. Kosmos is still on ${OLD}.`);
  }
});

test('the helper refuses a folder that changed since the update was prepared, or a staged tree that lost an entry', T, async () => {
  const c1 = freshInstall();
  stage(c1);
  fs.writeFileSync(path.join(c1.root, 'app', 'package.json'), JSON.stringify({ version: '0.6.58' }));
  const s1 = playBoard(c1);
  assert.match((await win32apply.applyJournal(c1.journal, s1.deps())).because, /the Kosmos folder is now 0\.6\.58, not the 0\.6\.60/);
  const c2 = freshInstall();
  stage(c2);
  fs.rmSync(path.join(c2.staged, 'bin'), { recursive: true });
  const s2 = playBoard(c2);
  assert.match((await win32apply.applyJournal(c2.journal, s2.deps())).because, /the staged update is missing bin/);
  assert.deepEqual([...s1.calls, ...s2.calls], []);
});

test('the helper never applies a journal that is past being staged, even when its helper is gone', T, async () => {
  const c = freshInstall();
  stage(c);
  crashAt(c, 'after H3 bin');
  const j = readJson(c.journal);
  const tree = installState(c);
  const sim = playBoard(c);
  const r = await win32apply.applyJournal(c.journal, sim.deps());
  assert.equal(r.ok, false);
  assert.match(r.because, /already past being staged \(moving-out\), so it is not waiting to be applied/);
  assert.deepEqual(readJson(c.journal), j, 'the journal is left exactly as it was, for a resumer');
  assert.deepEqual(installState(c), tree);
  assert.deepEqual(sim.calls, []);
});

test('the helper does not start while another holder has the update lock', T, async () => {
  const c = freshInstall();
  const before = installState(c);
  const j = stage(c);
  fs.writeFileSync(path.join(c.work, win32update.LOCK_NAME), JSON.stringify({ pid: process.pid, at: Date.now(), exe: 'node.exe', token: 'a prepare in flight' }));
  const sim = playBoard(c);
  const r = await win32apply.applyJournal(c.journal, sim.deps({ lockHooks: { processImage: () => 'node.exe' } }));
  assert.deepEqual(r, { ok: false, because: 'another update is already running' });
  assert.deepEqual(sim.calls, []);
  assert.deepEqual(installState(c), before);
  assert.deepEqual(readJson(c.journal), j);
});

test('H5: a safety copy that does not match the original fails the update before node.exe is touched, and rolls back', T, async () => {
  const c = freshInstall();
  const before = installState(c);
  stage(c);
  const sim = playBoard(c);
  const realCopy = fs.copyFileSync;
  fs.copyFileSync = function torn(from, to) {
    realCopy.apply(this, arguments);
    if (String(to).endsWith(win32apply.ANCHORED_NODE_COPY_NAME)) fs.writeFileSync(to, 'half a copy');
  };
  let r;
  try { r = await win32apply.applyJournal(c.journal, sim.deps()); } finally { fs.copyFileSync = realCopy; }
  assertRolledBack(c, before, sim, r, 'torn copy');
  assert.match(readJson(c.statusAt).because, /the safety copy of Kosmos's node\.exe did not match the original/);
  assert.equal(readJson(c.journal).steps.some((s) => s.step === 'H5' && s.state === 'intent'), false, 'replaceInterpreter never ran');
});

test('a journal whose paths were changed is unreadable, and nothing it names is moved', T, async () => {
  const c = freshInstall();
  const before = installState(c);
  const j = stage(c);
  for (const [field, value] of [['previous', path.join(c.dir, 'somewhere')], ['root', c.dir], ['staged', path.join(c.dir, 'staged')], ['order', ['app', 'bin']], ['recoverFrom', [path.join(c.dir, 'evil.js')]]]) {
    fs.writeFileSync(c.journal, JSON.stringify({ ...j, [field]: value }));
    const sim = playBoard(c);
    const r = await win32apply.applyJournal(c.journal, sim.deps());
    assert.equal(r.ok, false, field);
    assert.match(r.because, /the record of an earlier update .* so the updater cannot tell whether that update finished/, field);
    assert.deepEqual(sim.calls, [], field);
    assert.deepEqual(installState(c), before, field);
  }
});

test('a test process that reaches the helper or a resumer with no seams throws instead of touching a real board', T, async () => {
  const c = freshInstall();
  stage(c);
  await assert.rejects(win32apply.applyJournal(c.journal), /engine\/win32apply\.js tried to execute "apply .*" for real inside a test process/);
  await assert.rejects(win32apply.resumeJournal(c.journal), /tried to execute "resume/);
  assert.throws(() => win32apply.recoverAtBoot(c.journal), /tried to execute "recover/);
  assert.equal(readJson(c.journal).phase, 'staged');
});

/* ─── H1: no require after the dependencies are loaded ───────────────────────────────────── */

test('H1: once the helper starts, no require() runs, through an apply, a rollback and a boot recovery', T, async () => {
  const seen = [];
  let armed = false;
  const realLoad = Module._load;
  Module._load = function spied(request, parent) {
    if (armed) seen.push(`${request} (from ${parent && parent.filename})`);
    return realLoad.apply(this, arguments);
  };
  const arm = () => { armed = true; };
  try {
    /* The control: the spy sees a require, cached or not. */
    armed = true;
    require('./win32orphan');
    armed = false;
    assert.equal(seen.length, 1, 'the control: the spy records a require');
    seen.length = 0;

    const c1 = freshInstall();
    stage(c1);
    const s1 = playBoard(c1);
    assert.equal((await win32apply.applyJournal(c1.journal, s1.deps({ hooks: { afterDependencies: arm } }))).outcome, 'updated');
    armed = false;
    const c2 = freshInstall();
    stage(c2);
    const s2 = playBoard(c2, { newNeverStarts: true });
    assert.equal((await win32apply.applyJournal(c2.journal, s2.deps({ hooks: { afterDependencies: arm } }))).outcome, 'rolled-back');
    armed = false;
    const c3 = freshInstall();
    const j = stage(c3);
    const s3 = playBoard(c3);
    fs.writeFileSync(c3.journal, JSON.stringify({ ...j, phase: 'starting' }));
    assert.equal(win32apply.recoverAtBoot(c3.journal, s3.deps({ hooks: { afterDependencies: arm } })).action, 'rolled-back');
    armed = false;
  } finally {
    Module._load = realLoad;
  }
  assert.deepEqual(seen, [], 'a require ran after H1');
});

/* ─── a crash at every step ───────────────────────────────────────────────────────────────── */

/** A helper in its own process that plays the same board and kills itself, hard, at one hook point. */
const CRASH_CHILD = path.join(SANDBOX, 'crash-child.js');
fs.writeFileSync(CRASH_CHILD, `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const spec = JSON.parse(process.argv[2]);
const apply = require(${JSON.stringify(APPLY_MODULE)});
const board = require(${JSON.stringify(path.join(__dirname, 'win32board.js'))});
const sim = { running: true, identity: ${JSON.stringify(OLD_ID)} };
const treeIdentity = () => { try { return JSON.parse(fs.readFileSync(path.join(spec.root, 'app', 'package.json'), 'utf8')).version + '@default'; } catch { return null; } };
board.setRunner((args) => {
  if (args[0] === '/End') { sim.running = false; sim.identity = null; }
  if (args[0] === '/Run') { const id = treeIdentity(); if (!sim.running && id && !(spec.newNeverStarts && id !== ${JSON.stringify(OLD_ID)})) { sim.running = true; sim.identity = id; } }
  return { ok: true, out: '' };
});
let clock = ${clock};
const key = (when, step, d) => when + ' ' + step + (d && d.entry ? ' ' + d.entry : '') + (d && d.run ? ' #' + d.run : '');
const die = (k) => { if (k === spec.crashAt) process.kill(process.pid, 'SIGKILL'); };
apply.applyJournal(spec.journal, {
  probe: async () => (sim.running ? { answering: true, identity: sim.identity } : { answering: false, identity: null }),
  portFree: async () => !sim.running, pidGone: () => true,
  sleep: async (ms) => { clock += ms; }, sleepSync: (ms) => { clock += ms; }, now: () => clock, log: () => {},
  hooks: { before: (s, d) => die(key('before', s, d)), after: (s, d) => die(key('after', s, d)) },
}).then((r) => { process.stdout.write(JSON.stringify(r)); });
`);

function crashAt(c, point, o = {}) {
  const out = cp.spawnSync(process.execPath, [CRASH_CHILD, JSON.stringify({ journal: c.journal, root: c.root, crashAt: point, newNeverStarts: Boolean(o.newNeverStarts) })],
    { encoding: 'utf8', timeout: 60000, env: process.env });
  assert.equal(out.stdout, '', `the helper really died at ${point} (status ${out.status}, ${out.stderr})`);
  return out;
}

/** The board's real logon shim, run the way the task runs it, from the anchor, with ROOT as its cwd. */
function bootShim(c) {
  const shim = path.join(c.anchor, win32board.BOOT_NAME);
  fs.writeFileSync(shim, win32board.BOOT_JS);
  const report = path.join(c.dir, 'booted.txt');
  fs.rmSync(report, { force: true });
  const out = cp.spawnSync(process.execPath, [shim], { encoding: 'utf8', timeout: 120000, cwd: c.root, env: { ...process.env, [BOOT_REPORT_ENV]: report } });
  return { status: out.status, stderr: out.stderr, booted: readText(report) };
}

async function assertCrashRecovers(point, o = {}) {
  const c = freshInstall();
  const before = installState(c);
  const newTree = hashTree(c.staged);
  stage(c);
  crashAt(c, point, o);
  const phaseAtCrash = readJson(c.journal).phase;
  const boot = bootShim(c);
  assert.equal(boot.status, 0, `${point}: the shim booted (${boot.stderr})`);
  const j = readJson(c.journal);
  assert.equal(j.finished, true, `${point}: the boot recovery finished the journal (phase at the crash: ${phaseAtCrash}) ${boot.stderr}`);
  if (phaseAtCrash === 'confirmed') {
    assert.equal(boot.booted, `booted ${NEW} by Kosmos\\board`, point);
    assert.deepEqual(hashTree(c.root, [c.work, path.join(c.root, 'Projects')]), newTree, `${point}: finished forward`);
    assert.equal(readJson(c.statusAt).outcome, 'updated');
  } else {
    assert.equal(boot.booted, `booted ${OLD} by Kosmos\\board`, `${point}: the old board boots (${boot.stderr})`);
    assertRolledBack(c, before, null, null, point);
  }
  assert.equal(fs.existsSync(path.join(c.work, win32update.LOCK_NAME)), false, `${point}: the dead helper's lock was cleared and released`);
  return phaseAtCrash;
}

test('a crash at every point of an apply: the next board start rolls it back, or finishes it once confirmed', LONG, async () => {
  const { points } = await hookPoints();
  assert.ok(points.length >= 30, points.join(', '));
  const phases = new Set();
  for (const point of points) phases.add(await assertCrashRecovers(point));
  for (const phase of ['stopping', 'moving-out', 'moving-in', 'interpreter', 'pointer', 'starting', 'confirmed']) {
    assert.ok(phases.has(phase), `the control: a crash was taken during ${phase} (${[...phases]})`);
  }
});

test('a crash at every point of a rollback: the next board start finishes putting the old build back', LONG, async () => {
  const { points } = await hookPoints({ board: { newNeverStarts: true } });
  const rollbackPoints = points.filter((p) => / H8/.test(p));
  assert.ok(rollbackPoints.length >= 15, rollbackPoints.join(', '));
  for (const step of ['before H8', 'before H8-H6', 'before H8-H5', 'before H8-H4 app', 'after H8-H3 runtime', 'before H8-run #1']) {
    assert.ok(rollbackPoints.includes(step), `the control: ${step}`);
  }
  for (const point of rollbackPoints) await assertCrashRecovers(point, { newNeverStarts: true });
});

test('the logon shim: no journal boots as before; a finished one is left alone; an unreadable one is reported and the boot goes on', T, () => {
  const c = freshInstall();
  assert.deepEqual(bootShim(c), { status: 0, stderr: '', booted: `booted ${OLD} by Kosmos\\board` });
  const j = stage(c);
  fs.writeFileSync(c.journal, JSON.stringify({ ...j, finished: true, outcome: 'updated', recoverFrom: [path.join(c.dir, 'win32apply.js')] }));
  fs.writeFileSync(path.join(c.dir, 'win32apply.js'), "throw new Error('a finished journal must not load recovery code');");
  assert.deepEqual(bootShim(c), { status: 0, stderr: '', booted: `booted ${OLD} by Kosmos\\board` });
  fs.writeFileSync(c.journal, '{ torn');
  const torn = bootShim(c);
  assert.equal(torn.status, 0);
  assert.equal(torn.booted, `booted ${OLD} by Kosmos\\board`);
  assert.match(torn.stderr, /kosmos: an update that did not finish could not be recovered/);
  /* A readable journal whose content does not check out is named in words by the recovery. */
  fs.writeFileSync(c.journal, JSON.stringify({ ...j, phase: 'moving-in', order: ['app'] }));
  const odd = bootShim(c);
  assert.equal(odd.booted, `booted ${OLD} by Kosmos\\board`);
  assert.match(odd.stderr, /the record of an earlier update .* moves entries in an order this Kosmos does not use, so the updater cannot tell whether that update finished/);
});

test('the logon shim reads the journal before the pointer, and only ever loads a win32apply.js', T, () => {
  const src = win32board.BOOT_JS;
  assert.ok(src.indexOf(JSON.stringify(win32anchor.UPDATE_JOURNAL_NAME)) > 0);
  assert.ok(src.indexOf('recoverAtBoot(journal)') < src.indexOf('const pointer = '), 'recovery runs before the pointer is read');
  assert.ok(src.includes("path.basename(f) === 'win32apply.js'"));
  assert.equal(win32apply.MODULE_FILE_NAME, 'win32apply.js');
});

/* ─── the resumers never race a live helper ───────────────────────────────────────────────── */

test('a resumer leaves an update alone while its helper is alive, and takes over once it is gone', T, async () => {
  /* H3 done and H4 begun, with the update lock naming a live node.exe: the helper, still at work. */
  const c2 = freshInstall();
  const before = installState(c2);
  stage(c2);
  crashAt(c2, 'before H4 runtime');
  const lock = path.join(c2.work, win32update.LOCK_NAME);
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now(), exe: 'node.exe', token: 'a live helper' }));
  const s2 = playBoard(c2);
  const held = win32apply.recoverAtBoot(c2.journal, s2.deps({ lockHooks: { processImage: () => 'node.exe' } }));
  assert.equal(held.action, 'held');
  assert.equal(readJson(c2.journal).phase, 'moving-in', 'untouched');
  const resumed = await win32apply.resumeJournal(c2.journal, s2.deps({ lockHooks: { processImage: () => 'node.exe' } }));
  assert.equal(resumed.action, 'held');
  assert.deepEqual(s2.calls, []);
  fs.rmSync(lock);
  /* The old board was stopped by the helper's H2 before it died. */
  s2.running = false;
  s2.identity = null;
  const r = await win32apply.resumeJournal(c2.journal, s2.deps());
  assertRolledBack(c2, before, s2, r, 'resumed');
});

test('the resume helper: a new board left running is stopped and rolled back; a confirmed update is finished; a stopped board is started', T, async () => {
  /* A helper killed while the new board kept serving, and no logon comes. */
  const c1 = freshInstall();
  const before1 = installState(c1);
  stage(c1);
  crashAt(c1, 'before H7-run #1');
  const s1 = playBoard(c1);
  s1.running = false;
  s1.identity = null;
  win32board.runNow();
  assert.equal(s1.identity, NEW_ID, 'the new board is serving');
  s1.calls.length = 0;
  const r1 = await win32apply.resumeJournal(c1.journal, s1.deps());
  assertRolledBack(c1, before1, s1, r1, 'resume from starting');
  assert.deepEqual(s1.calls, ['/End /TN Kosmos\\board', '/Run /TN Kosmos\\board']);

  const c2 = freshInstall();
  const newTree = hashTree(c2.staged);
  stage(c2);
  crashAt(c2, 'before H9');
  const s2 = playBoard(c2);
  const r2 = await win32apply.resumeJournal(c2.journal, s2.deps());
  assert.equal(r2.outcome, 'updated');
  assert.deepEqual(hashTree(c2.root, [c2.work, path.join(c2.root, 'Projects')]), newTree);
  assert.deepEqual(s2.calls, [], 'a confirmed update needs no restart');

  const c3 = freshInstall();
  const before3 = installState(c3);
  stage(c3);
  crashAt(c3, 'before H3');
  const s3 = playBoard(c3);
  s3.running = false;
  s3.identity = null;
  const r3 = await win32apply.resumeJournal(c3.journal, s3.deps());
  /* The crash came in `moving-out` before any move: nothing to reverse, the old board is started. */
  assertRolledBack(c3, before3, s3, r3, 'resume from moving-out');
});

/* ─── the interpreter ─────────────────────────────────────────────────────────────────────── */

test('H5 runs only when the runtime changed', T, async () => {
  const c = freshInstall({ sameRuntime: true });
  stage(c, { runtimeChanged: false });
  const sim = playBoard(c);
  const steps = [];
  const r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (s) => steps.push(s) } }));
  assert.equal(r.outcome, 'updated');
  assert.equal(steps.some((s) => s.startsWith('H5')), false);
  assert.equal(fs.readFileSync(path.join(c.anchor, 'node.exe'), 'utf8'), `the anchored node.exe of ${OLD}`);
  assert.equal(readJson(c.journal).interpreter, null);
});

test('H5 rollback: with the safety copy and the retired original both gone, the old build\'s node.exe is restored, and the journal says so', T, async () => {
  const c = freshInstall();
  stage(c);
  crashAt(c, 'after H5-swap');
  fs.rmSync(path.join(c.previous, win32apply.ANCHORED_NODE_COPY_NAME));
  for (const name of fs.readdirSync(c.anchor)) if (name.startsWith('node.exe' + win32swap.RETIRED_INFIX)) fs.rmSync(path.join(c.anchor, name));
  const sim = playBoard(c);
  const action = win32apply.recoverAtBoot(c.journal, sim.deps());
  assert.equal(action.action, 'rolled-back', c.log.join('\n'));
  assert.equal(fs.readFileSync(path.join(c.anchor, 'node.exe'), 'utf8'), 'the old node.exe', "the old build's own interpreter");
  const j = readJson(c.journal);
  assert.equal(j.interpreter.restoredFrom, path.join(c.previous, 'runtime', 'node.exe'));
  assert.equal(fs.readFileSync(path.join(c.root, 'runtime', 'node.exe'), 'utf8'), 'the old node.exe');
});

/* ─── a handle held on a file in app (Windows) ────────────────────────────────────────────── */

const WINDOWS_ONLY = { ...T, timeout: 120000, skip: !ON_WINDOWS && 'a held handle blocks a folder rename only on Windows' };

/** A Node child holding `file` open (measured: that alone makes renaming its folder fail with EPERM). */
function holdOpen(file, releaseAfterMs) {
  const ready = path.join(SANDBOX, `held-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const script = `const fs = require('node:fs'); const fd = fs.openSync(${JSON.stringify(file)}, 'r'); fs.writeFileSync(${JSON.stringify(ready)}, '1');`
    + (releaseAfterMs ? ` setTimeout(() => { fs.closeSync(fd); process.exit(0); }, ${releaseAfterMs});` : ' setInterval(() => {}, 1000);');
  const child = cp.spawn(process.execPath, ['-e', script], { stdio: 'ignore', cwd: SANDBOX });
  const until = Date.now() + 15000;
  while (!fs.existsSync(ready)) {
    if (Date.now() > until) { child.kill(); throw new Error('the holder never opened the file'); }
    sleepSync(20);
  }
  return {
    child,
    release() {
      try { child.kill(); } catch { /* already gone */ }
      const gone = Date.now() + 10000;
      while (win32orphan.pidAlive(child.pid) && Date.now() < gone) sleepSync(50);
      sleepSync(200);
    },
  };
}

/** Counts the renames of `target` that failed, around `run`. */
async function renameFailuresOf(target, run) {
  const failures = [];
  const real = fs.renameSync;
  fs.renameSync = function counted(from) {
    try { return real.apply(this, arguments); } catch (e) {
      if (path.resolve(String(from)) === path.resolve(target)) failures.push(e.code);
      throw e;
    }
  };
  try { await run(); } finally { fs.renameSync = real; }
  return failures;
}

test('a handle on a file in app, released within the rename budget: the move waits for it and the update goes in', WINDOWS_ONLY, async () => {
  const c = freshInstall();
  stage(c);
  const sim = playBoard(c);
  let holder = null;
  let r;
  const failures = await renameFailuresOf(path.join(c.root, 'app'), async () => {
    r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (s, d) => {
      if (s === 'H3' && d.entry === 'app') holder = holdOpen(path.join(c.root, 'app', 'server.js'), 400);
    } } }));
  });
  holder.release();
  assert.equal(r.outcome, 'updated', c.log.join('\n'));
  assert.ok(failures.length >= 1 && failures.every((code) => code === 'EPERM'), `the control: the rename really met the handle (${failures})`);
});

test('a handle on a file in app, held past the rename budget: a clean rollback, byte-identical', WINDOWS_ONLY, async () => {
  const c = freshInstall();
  const before = installState(c);
  stage(c);
  const sim = playBoard(c);
  let holder = null;
  try {
    const r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (s, d) => {
      if (s === 'H3' && d.entry === 'app') holder = holdOpen(path.join(c.root, 'app', 'server.js'));
    } } }));
    assertRolledBack(c, before, sim, r, 'held past the budget');
    assert.match(readJson(c.statusAt).because, /app could not be moved \(code=EPERM\); something may have a file in it open/);
    assert.equal(fs.existsSync(path.join(c.staged)), false, 'the new build is cleared');
  } finally {
    if (holder) holder.release();
  }
});

test('a handle on the NEW app while rolling back: stuck, in words naming Kosmos.exe, then recovered once it is released', WINDOWS_ONLY, async () => {
  const c = freshInstall();
  const before = installState(c);
  stage(c);
  const sim = playBoard(c, { newNeverStarts: true });
  let holder = null;
  try {
    const r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (s) => {
      if (s === 'H6' && !holder) holder = holdOpen(path.join(c.root, 'app', 'server.js'));
    } } }));
    assert.equal(r.outcome, 'stuck', c.log.join('\n'));
    const status = readJson(c.statusAt);
    assert.equal(status.outcome, 'stuck');
    assert.equal(status.version, null);
    assert.match(status.sentence, /^The update did not take, and Kosmos could not put 0\.6\.60 back by itself \(app could not be moved \(code=EPERM\); something may have a file in it open\)\. Close any window or program that is using the Kosmos folder, then double-click Kosmos\.exe in /);
    assert.ok(status.sentence.endsWith(`double-click Kosmos.exe in ${c.root} to start it again.`), status.sentence);
    const j = readJson(c.journal);
    assert.equal(j.phase, 'stuck');
    assert.equal(j.finished, false, 'left for the next resumer');
    assert.equal(j.steps.filter((s) => s.step === 'H8-H4' && s.entry === 'app' && s.state === 'failed').length, 3, 'three passes tried it');
  } finally {
    if (holder) holder.release();
  }
  const again = win32apply.recoverAtBoot(c.journal, sim.deps());
  assert.equal(again.action, 'rolled-back', c.log.join('\n'));
  assertRolledBack(c, before, null, null, 'recovered after release');
});
