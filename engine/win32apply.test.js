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
/* A test that spawns the REAL logon shim or a real board (bootShim/bootShimAsync, and the crash- and
   boot-recovery tests that boot the shim after a crashAt) can only run on win32: the shim resolves
   Kosmos\\board paths and a win32 board. These skip off-win32 so the macOS CI lane does not red on a
   shim spawn it cannot satisfy; every pure in-process logic test stays ungated so macOS still runs it. */
const WIN32_ONLY = process.platform === 'win32' ? false : 'win32-only: spawns the real logon shim/board';
const WIN32_ONLY_T = { ...T, skip: WIN32_ONLY };
const WIN32_ONLY_LONG = { ...LONG, skip: WIN32_ONLY };
const ON_WINDOWS = process.platform === 'win32';
const OLD = '0.6.60';
const NEW = '0.6.61';
const OLD_ID = `${OLD}@default`;
const NEW_ID = `${NEW}@default`;
const PORT = 16555;
const README = '! READ ME FIRST - Windows will warn you.txt';
const APPLY_MODULE = path.join(__dirname, 'win32apply.js');
const BOOT_REPORT_ENV = 'KOSMOS_TEST_BOOT_REPORT';
const BOOT_DIR_ENV = 'KOSMOS_TEST_BOOT_DIR';

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
const SERVER_JS = `if (process.env.${BOOT_REPORT_ENV}) require('node:fs').writeFileSync(process.env.${BOOT_REPORT_ENV}, 'booted ' + require('./package.json').version + ' by ' + process.env.KOSMOS_WIN32_BOARD_TASK);\n`
  + `if (process.env.${BOOT_DIR_ENV}) require('node:fs').writeFileSync(process.env.${BOOT_DIR_ENV}, __dirname);\n`;

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
 * does not boot), answerAs (id => the identity the booted board answers with), launcherServed (the
 * board answers with its started-by-task header 0, as the launcher's own board after a hand-off fallback).
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
      /* `endFailsAfterStopping`: the board stops, and schtasks still reports a failure (its timeout). */
      if (o.endFailsAfterStopping) return { ok: false, out: 'spawnSync schtasks.exe ETIMEDOUT' };
      return { ok: true, out: 'SUCCESS: The scheduled task was terminated.' };
    }
    if (verb === '/Run') {
      /* `onRun`: what Task Scheduler would do at the moment of /Run (start the real logon shim). */
      if (o.onRun) o.onRun(sim);
      const id = treeIdentity();
      /* `blockIdentity`: a build whose identity is this one never boots (the rollback analogue of
         newNeverStarts, which is written around OLD_ID for the forward path). */
      const blocked = o.blockIdentity && id === o.blockIdentity;
      if (!sim.running && id && !(o.newNeverStarts && id !== OLD_ID) && !blocked) {
        sim.running = true;
        sim.identity = o.answerAs ? o.answerAs(id) : id;
      }
      return { ok: true, out: 'SUCCESS: Attempted to run the scheduled task.' };
    }
    if (verb === '/Query') return { ok: true, out: `TaskName: Kosmos\\board\nStatus: ${sim.running ? 'Running' : 'Ready'}\n` };
    return { ok: false, out: 'the stub scheduler does not know ' + verb };
  });
  sim.deps = (extra = {}) => ({
    probe: async () => (sim.running ? { answering: true, identity: sim.identity, startedByTask: !o.launcherServed } : { answering: false, identity: null }),
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

const rolledBackSentence = (c) => `The update did not take. Kosmos is still on ${OLD}. If Kosmos does not come back by itself, double-click Kosmos.exe in ${c.root}.`;

/** `o.cleanupPending`: the crash came after the journal was finished and before its cleanup. */
function assertRolledBack(c, before, sim, r, label, o = {}) {
  assert.deepEqual(installState(c), before, `${label}: the tree, node.exe and pointer are byte-identical (${JSON.stringify(r)})\n${c.log.join('\n')}`);
  const j = readJson(c.journal);
  assert.equal(j.finished, true, `${label}: the journal is finished`);
  assert.ok(['rolled-back', 'not-started'].includes(j.outcome), `${label}: ${j.outcome}`);
  const status = readJson(c.statusAt);
  assert.equal(status.sentence, rolledBackSentence(c), label);
  assert.equal(status.version, OLD);
  assert.ok(status.because, `${label}: the status says why`);
  if (!o.cleanupPending) assert.equal(fs.existsSync(c.previous), false, `${label}: no previous folder is left`);
  if (sim) {
    assert.equal(sim.running, true, `${label}: a board is running again`);
    assert.equal(sim.identity, OLD_ID, `${label}: and it is the old one`);
    assert.deepEqual(sim.calls.filter((call) => /agent-/.test(call)), [], `${label}: no agent task is touched`);
  }
}

/* ─── the happy path and the path guard ───────────────────────────────────────────────────── */

/** `when`, if given, records only the writes made while it returns true. */
async function recordWrites(run, when) {
  const written = [];
  const note = (p) => { if ((!when || when()) && p !== undefined && p !== null && typeof p !== 'number') written.push(path.resolve(String(p))); };
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
  /* H9's points come after the new board is confirmed: a crash there is a finish-forward case (the
     crash tests), never a rollback. */
  const failurePoints = points.filter((p) => !/ H9/.test(p));
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
    assert.equal(readJson(c.statusAt).sentence, rolledBackSentence(c));
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
  assert.equal(r.ok, false);
  assert.match(r.because, /^another update is already running \(another update is already being prepared \(process \d+\)\)$/);
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
  const elsewhere = path.join(c.dir, 'somewhere');
  /* Each change is made consistently with the fields that are derived from it, so only the one
     check for that field can catch it: a `previous` elsewhere carries a recoverFrom that agrees. */
  const changes = [
    ['previous', elsewhere, { recoverFrom: [path.join(elsewhere, 'app', 'engine', 'win32apply.js'), path.join(c.root, 'app', 'engine', 'win32apply.js')] }],
    ['root', c.dir],
    ['staged', path.join(c.dir, 'staged')],
    ['order', ['app', 'bin']],
    ['recoverFrom', [path.join(c.dir, 'evil.js')]],
  ];
  for (const [field, value, alongside] of changes) {
    fs.writeFileSync(c.journal, JSON.stringify({ ...j, [field]: value, ...(alongside || {}) }));
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
/* Die inside win32swap.replaceInterpreter, between its two renames: the Nth time a staged copy is
   renamed onto the anchored node.exe, the process is killed before that rename. */
if (spec.killOnInterpreterRename) {
  const realRename = fs.renameSync;
  let seen = 0;
  fs.renameSync = function counted(from, to) {
    if (path.basename(String(from)).includes('.staged-') && path.resolve(String(to)) === path.resolve(spec.anchoredNode)) {
      seen += 1;
      if (seen === spec.killOnInterpreterRename) process.kill(process.pid, 'SIGKILL');
    }
    return realRename.apply(this, arguments);
  };
}
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
  probe: async () => (sim.running ? { answering: true, identity: sim.identity, startedByTask: true } : { answering: false, identity: null }),
  portFree: async () => !sim.running, pidGone: () => true,
  sleep: async (ms) => { clock += ms; }, sleepSync: (ms) => { clock += ms; }, now: () => clock, log: () => {},
  hooks: { before: (s, d) => die(key('before', s, d)), after: (s, d) => die(key('after', s, d)) },
}).then((r) => { process.stdout.write(JSON.stringify(r)); });
`);

function crashAt(c, point, o = {}) {
  const out = cp.spawnSync(process.execPath, [CRASH_CHILD, JSON.stringify({
    journal: c.journal, root: c.root, crashAt: point, newNeverStarts: Boolean(o.newNeverStarts),
    killOnInterpreterRename: o.killOnInterpreterRename || 0, anchoredNode: path.join(c.anchor, win32anchor.NODE_NAME),
  })],
    { encoding: 'utf8', timeout: 60000, env: process.env });
  assert.equal(out.stdout, '', `the helper really died at ${point} (status ${out.status}, ${out.stderr})`);
  return out;
}

/** The board's real logon shim, run the way the task runs it, from the anchor, with ROOT as its cwd. */
/**
 * The board's real logon shim, run the way the task runs it, from the anchor, with ROOT as its cwd.
 * Reports which build booted (`booted`) and from which app folder (`from`). `o.preload` adds a
 * `--require` to the shim's NODE_OPTIONS (the schtasks guard stays), `o.env` extra variables.
 */
function bootShim(c, o = {}) {
  const shim = path.join(c.anchor, win32board.BOOT_NAME);
  fs.writeFileSync(shim, win32board.BOOT_JS);
  const report = path.join(c.dir, 'booted.txt');
  const fromReport = path.join(c.dir, 'booted-from.txt');
  fs.rmSync(report, { force: true });
  fs.rmSync(fromReport, { force: true });
  const env = { ...process.env, [BOOT_REPORT_ENV]: report, [BOOT_DIR_ENV]: fromReport, ...(o.env || {}) };
  if (o.preload) env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --require=${o.preload}`.trim();
  const out = cp.spawnSync(process.execPath, [shim], { encoding: 'utf8', timeout: 120000, cwd: fs.existsSync(c.root) ? c.root : c.dir, env });
  return { status: out.status, stderr: out.stderr, booted: readText(report), from: readText(fromReport) };
}

/**
 * The real logon shim started ASYNCHRONOUSLY, at the moment a stub /Run is issued, as Task Scheduler
 * starts it: it runs beside whatever the helper does next. Resolves to { status, stderr, booted, from }.
 * `o.preload` and `o.env` as for bootShim.
 */
function bootShimAsync(c, o = {}) {
  const shim = path.join(c.anchor, win32board.BOOT_NAME);
  fs.writeFileSync(shim, win32board.BOOT_JS);
  const tag = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const report = path.join(c.dir, `booted-${tag}.txt`);
  const fromReport = path.join(c.dir, `booted-from-${tag}.txt`);
  const env = { ...process.env, [BOOT_REPORT_ENV]: report, [BOOT_DIR_ENV]: fromReport, ...(o.env || {}) };
  if (o.preload) env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --require=${o.preload}`.trim();
  const child = cp.spawn(process.execPath, [shim], { cwd: fs.existsSync(c.root) ? c.root : c.dir, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  return new Promise((resolve) => child.on('exit', (status) => resolve({ status, stderr, booted: readText(report), from: readText(fromReport) })));
}

async function assertCrashRecovers(point, o = {}) {
  const c = freshInstall();
  const before = installState(c);
  const newTree = hashTree(c.staged);
  stage(c);
  crashAt(c, point, o);
  const atCrash = readJson(c.journal);
  const phaseAtCrash = atCrash.phase;
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
    assertRolledBack(c, before, null, null, point, { cleanupPending: atCrash.finished });
  }
  /* A crash after the journal was finished leaves its dead lock and cleanup to the next prepare or
     update, which clear both; before that, the boot recovery clears the lock itself. */
  if (!atCrash.finished) assert.equal(fs.existsSync(path.join(c.work, win32update.LOCK_NAME)), false, `${point}: the dead helper's lock was cleared and released`);
  return phaseAtCrash;
}

test('a crash at every point of an apply: the next board start rolls it back, or finishes it once confirmed', WIN32_ONLY_LONG, async () => {
  const { points } = await hookPoints();
  assert.ok(points.length >= 30, points.join(', '));
  const phases = new Set();
  for (const point of points) phases.add(await assertCrashRecovers(point));
  for (const phase of ['stopping', 'moving-out', 'moving-in', 'interpreter', 'pointer', 'starting', 'confirmed']) {
    assert.ok(phases.has(phase), `the control: a crash was taken during ${phase} (${[...phases]})`);
  }
});

test('a crash at every point of a rollback: the next board start finishes putting the old build back', WIN32_ONLY_LONG, async () => {
  const { points } = await hookPoints({ board: { newNeverStarts: true } });
  const rollbackPoints = points.filter((p) => / H8/.test(p));
  assert.ok(rollbackPoints.length >= 15, rollbackPoints.join(', '));
  for (const step of ['before H8', 'before H8-H6', 'before H8-H5', 'before H8-H4 app', 'after H8-H3 runtime', 'before H8-run #1']) {
    assert.ok(rollbackPoints.includes(step), `the control: ${step}`);
  }
  for (const point of rollbackPoints) await assertCrashRecovers(point, { newNeverStarts: true });
});

test('the logon shim: no journal boots as before; a finished one is left alone; an unreadable one is reported and the boot goes on', WIN32_ONLY_T, () => {
  const c = freshInstall();
  assert.deepEqual(bootShim(c), { status: 0, stderr: '', booted: `booted ${OLD} by Kosmos\\board`, from: path.join(c.root, 'app') });
  const j = stage(c);
  fs.writeFileSync(c.journal, JSON.stringify({ ...j, finished: true, outcome: 'updated', recoverFrom: [path.join(c.dir, 'win32apply.js')] }));
  fs.writeFileSync(path.join(c.dir, 'win32apply.js'), "throw new Error('a finished journal must not load recovery code');");
  assert.deepEqual(bootShim(c), { status: 0, stderr: '', booted: `booted ${OLD} by Kosmos\\board`, from: path.join(c.root, 'app') });
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

test('the resume helper: a new board answering as the new build is finished forward, one that does not is stopped and rolled back; a confirmed update is finished; a stopped board is started', T, async () => {
  /* A helper killed during H7 while the new board it started kept serving, and no logon comes. That
     board answers as H7 requires, so the update is finished forward, never rolled back (round 5). */
  const c1 = freshInstall();
  const newTree1 = hashTree(c1.staged);
  stage(c1);
  crashAt(c1, 'before H7-run #1');
  const s1 = playBoard(c1);
  s1.running = false;
  s1.identity = null;
  win32board.runNow();
  assert.equal(s1.identity, NEW_ID, 'the new board is serving');
  s1.calls.length = 0;
  const r1 = await win32apply.resumeJournal(c1.journal, s1.deps());
  assert.equal(r1.outcome, 'updated', JSON.stringify(r1) + '\n' + c1.log.join('\n'));
  assert.deepEqual(hashTree(c1.root, [c1.work, path.join(c1.root, 'Projects')]), newTree1);
  assert.deepEqual(s1.calls, [], 'the board H7 would confirm is left serving');
  assert.equal(readJson(c1.statusAt).outcome, 'updated');

  /* The same crash with no board answering as the new build: stopped, rolled back, the old one started. */
  const c1b = freshInstall();
  const before1b = installState(c1b);
  stage(c1b);
  crashAt(c1b, 'before H7-run #1');
  const s1b = playBoard(c1b, { newNeverStarts: true });
  s1b.running = false;
  s1b.identity = null;
  const r1b = await win32apply.resumeJournal(c1b.journal, s1b.deps());
  assertRolledBack(c1b, before1b, s1b, r1b, 'resume from starting');
  assert.deepEqual(s1b.calls, ['/End /TN Kosmos\\board', '/Run /TN Kosmos\\board']);

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
async function renameFailuresOf(target, run, onFailure) {
  const failures = [];
  const real = fs.renameSync;
  fs.renameSync = function counted(from) {
    try { return real.apply(this, arguments); } catch (e) {
      if (path.resolve(String(from)) === path.resolve(target)) {
        failures.push(e.code);
        if (onFailure) onFailure(failures.length);
      }
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
  /* The handle is let go at a point, not on a clock: right after the first rename it made fail, so the
     move's own retries (win32swap.renameWithRetry) are what carry the update in. */
  const failures = await renameFailuresOf(path.join(c.root, 'app'), async () => {
    r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (s, d) => {
      if (s === 'H3' && d.entry === 'app') holder = holdOpen(path.join(c.root, 'app', 'server.js'));
    } } }));
  }, (n) => { if (n === 1 && holder) holder.release(); });
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

test('a handle on the NEW app while rolling back: stuck in words; the logon shim starts the OLD app from previous while it is held, and puts it back once released', WINDOWS_ONLY, async () => {
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
    assert.match(status.sentence, /^The update did not take, and Kosmos could not put 0\.6\.60 back by itself \(app could not be moved \(code=EPERM\); something may have a file in it open\)\. Close any window or program that is using the Kosmos folder, then restart your computer, or double-click Kosmos\.exe in /);
    assert.ok(status.sentence.endsWith(`double-click Kosmos.exe in ${c.root} to start it again.`), status.sentence);
    const j = readJson(c.journal);
    assert.equal(j.phase, 'stuck');
    assert.equal(j.finished, false, 'left for the next resumer');
    assert.equal(j.steps.filter((s) => s.step === 'H8-H4' && s.entry === 'app' && s.state === 'failed').length, 3, 'three passes tried it');
    /* SAFETY 1: a logon while the handle is still held. The recovery stays stuck, and the shim starts
       the whole OLD app from previous-0.6.60 on the old interpreter H5's reversal put back, never
       the new app it could not confirm. */
    const held = bootShim(c);
    assert.equal(held.status, 0, held.stderr);
    assert.equal(held.booted, `booted ${OLD} by Kosmos\\board`, held.stderr);
    assert.equal(held.from, path.join(c.previous, 'app'), 'the old app, from previous');
    assert.match(held.stderr, /not recovered at start \(stuck: app could not be moved \(code=EPERM\)/);
    assert.match(held.stderr, /starting the previous version from .*previous-0\.6\.60.app until the update can be put back/);
    assert.equal(fs.readFileSync(path.join(c.anchor, 'node.exe'), 'utf8'), `the anchored node.exe of ${OLD}`);
    assert.equal(readJson(c.journal).finished, false);
  } finally {
    if (holder) holder.release();
  }
  const released = bootShim(c);
  assert.equal(released.booted, `booted ${OLD} by Kosmos\\board`, released.stderr);
  assert.equal(released.from, path.join(c.root, 'app'), 'once released, the old app is back in ROOT and starts from there');
  assertRolledBack(c, before, null, null, 'recovered after release');
});

/* ─── review round 1 ──────────────────────────────────────────────────────────────────────── */

/** A preload that kills the process at its Nth fs.renameSync (KOSMOS_TEST_KILL_AT_RENAME). */
const KILL_AT_RENAME = path.join(SANDBOX, 'kill-at-rename.js');
fs.writeFileSync(KILL_AT_RENAME, [
  "'use strict';",
  "const fs = require('node:fs');",
  'const realRename = fs.renameSync;',
  'const at = Number(process.env.KOSMOS_TEST_KILL_AT_RENAME || 0);',
  'let seen = 0;',
  'fs.renameSync = function counted() { seen += 1; if (seen === at) process.kill(process.pid, "SIGKILL"); return realRename.apply(this, arguments); };',
  '',
].join('\n'));

test('BUG 1: a resumer that finishes the staged journal between the helper\'s look and its lock stops the helper from applying it', T, async () => {
  const c = freshInstall();
  const before = installState(c);
  stage(c);
  const sim = playBoard(c);
  /* The interleave: the first lock draft the HELPER writes, right after its look at the journal,
     first lets a whole boot recovery run and let go of the lock. */
  const realWrite = fs.writeFileSync;
  let resumer = null;
  let inside = false;
  fs.writeFileSync = function interleaved(p, ...rest) {
    if (!resumer && !inside && String(p).endsWith('.draft')) {
      inside = true;
      try { resumer = win32apply.recoverAtBoot(c.journal, sim.deps()); } finally { inside = false; }
    }
    return realWrite.call(this, p, ...rest);
  };
  let r;
  try { r = await win32apply.applyJournal(c.journal, sim.deps()); } finally { fs.writeFileSync = realWrite; }
  assert.equal(resumer && resumer.action, 'not-started', 'the control: the resumer ran inside the helper\'s lock attempt');
  assert.deepEqual(r, { ok: false, because: 'the update was finished or replaced before this helper could start it, so it was not applied' });
  assert.deepEqual(installState(c), before, 'nothing was moved');
  assert.deepEqual(sim.calls, [], 'the board was never stopped');
  assert.equal(readJson(c.journal).outcome, 'not-started');
  assert.equal(readJson(c.statusAt).outcome, 'not-started');
});

test('BUG 1: the resume helper leaves a staged journal alone while its helper is starting, and settles it only after the grace', T, async () => {
  const c = freshInstall();
  const before = installState(c);
  stage(c);
  const j = readJson(c.journal);
  const sim = playBoard(c);
  const young = await win32apply.resumeJournal(c.journal, sim.deps({ now: () => clock + 5000 }));
  assert.deepEqual(young, { ok: true, action: 'starting' });
  assert.deepEqual(readJson(c.journal), j, 'untouched');
  assert.equal(fs.existsSync(path.join(c.work, win32update.LOCK_NAME)), false, 'not even the lock the helper needs was taken');
  const stale = await win32apply.resumeJournal(c.journal, sim.deps({ now: () => clock + win32apply.STAGED_HELPER_STARTUP_GRACE_MS + 1 }));
  assert.equal(stale.outcome, 'not-started', JSON.stringify(stale));
  assert.deepEqual(installState(c), before);
  assert.equal((await win32apply.applyJournal(c.journal, sim.deps())).ok, false, 'a helper arriving after that applies nothing');
  assert.equal(win32apply.STAGED_HELPER_STARTUP_GRACE_MS, 2 * 60 * 1000);
});

test('BUG 2: a journal whose Kosmos folder is gone is settled as abandoned, in words, by either resumer, and no longer blocks updates', T, async () => {
  for (const resumer of ['boot', 'resume']) {
    const c = freshInstall();
    stage(c);
    crashAt(c, 'after H3 bin');
    fs.rmSync(c.root, { recursive: true, force: true });
    assert.match(win32apply.unfinishedUpdateRefusal(c.anchor),
      /can never finish, because the Kosmos folder that update was changing \(.*\) no longer exists\. Asking Kosmos to update again clears that record/, 'B0 says why, truthfully');
    const sim = playBoard(c);
    const r = resumer === 'boot' ? win32apply.recoverAtBoot(c.journal, sim.deps()) : await win32apply.resumeJournal(c.journal, sim.deps());
    assert.equal(r.action, 'abandoned', `${resumer}: ${JSON.stringify(r)}`);
    const j = readJson(c.journal);
    assert.equal(j.finished, true);
    assert.equal(j.outcome, 'abandoned');
    const status = readJson(c.statusAt);
    assert.equal(status.outcome, 'abandoned');
    assert.equal(status.version, null);
    assert.equal(status.sentence, `The update to ${NEW} was stopped: the Kosmos folder that update was changing (${c.root}) no longer exists.`);
    assert.equal(win32apply.unfinishedUpdateRefusal(c.anchor), null, `${resumer}: updates are no longer blocked`);
    assert.equal(fs.existsSync(c.root), false, 'nothing made the folder again');
    assert.deepEqual(sim.calls, []);
  }
});

test('BUG 2: a journal whose working folder is gone: settled in words, stuck once entries had moved, not-started before, updated once confirmed', T, () => {
  for (const [point, action, statusOutcome] of [['after H3 bin', 'abandoned', 'stuck'], ['before H2', 'not-started', 'not-started'], ['before H9', 'updated', 'updated']]) {
    const c = freshInstall();
    stage(c);
    crashAt(c, point);
    fs.rmSync(c.work, { recursive: true, force: true });
    const sim = playBoard(c);
    const r = win32apply.recoverAtBoot(c.journal, sim.deps());
    assert.equal(r.action, action, `${point}: ${JSON.stringify(r)}\n${c.log.join('\n')}`);
    const j = readJson(c.journal);
    assert.equal(j.finished, true, point);
    const status = readJson(c.statusAt);
    assert.equal(status.outcome, statusOutcome, point);
    if (statusOutcome === 'stuck') {
      assert.equal(j.outcome, 'abandoned');
      assert.equal(status.sentence, `The update to ${NEW} did not finish, and Kosmos cannot finish or undo it by itself (its working folder ${c.work} is gone). Download a fresh copy of Kosmos, unpack it over your Kosmos folder, then double-click Kosmos.exe in ${c.root}.`);
    }
    assert.equal(win32apply.unfinishedUpdateRefusal(c.anchor), null, `${point}: updates are no longer blocked`);
    assert.deepEqual(fs.readdirSync(c.work), [], `${point}: WORK was made again only to hold the lock, and the lock was released`);
  }
});

test('BUG 2: with no copy of the updater left to put it back, the logon shim says so and begin()\'s settlement finishes it in words', WIN32_ONLY_T, () => {
  const c = freshInstall();
  stage(c);
  crashAt(c, 'after H4 app');
  for (const f of readJson(c.journal).recoverFrom) fs.rmSync(f, { force: true });
  const boot = bootShim(c);
  assert.equal(boot.status, 0, boot.stderr);
  assert.match(boot.stderr, /an update that did not finish cannot be recovered at start: none of its recovery files exist \(.*win32apply\.js, .*win32apply\.js\)/);
  assert.equal(readJson(c.journal).finished, false, 'the shim has no code to settle it with');
  assert.match(win32apply.unfinishedUpdateRefusal(c.anchor), /can never finish, because no copy of the updater that could put it back is left/);
  const sim = playBoard(c);
  assert.deepEqual(win32apply.settleUnrecoverableJournal(c.journal, sim.deps()), { action: 'abandoned', because: 'no copy of the updater that could put it back is left' });
  const status = readJson(c.statusAt);
  assert.equal(status.outcome, 'stuck');
  assert.match(status.sentence, /cannot finish or undo it by itself \(no copy of the updater that could put it back is left\)\. Download a fresh copy of Kosmos/);
  assert.equal(win32apply.unfinishedUpdateRefusal(c.anchor), null);
  /* The control: a journal a resumer can finish is left to it, with nothing written. */
  const c2 = freshInstall();
  stage(c2);
  crashAt(c2, 'after H4 app');
  const j2 = readJson(c2.journal);
  assert.deepEqual(win32apply.settleUnrecoverableJournal(c2.journal), { action: 'recoverable' });
  assert.deepEqual(readJson(c2.journal), j2);
});

test('the logon shim says so when an unfinished update is held by a live helper, and the board still boots', WIN32_ONLY_T, () => {
  const c = freshInstall();
  stage(c);
  crashAt(c, 'before H7-run #1');
  fs.writeFileSync(path.join(c.work, win32update.LOCK_NAME), JSON.stringify({ pid: process.pid, at: Date.now(), exe: path.basename(process.execPath).toLowerCase(), token: 'a live helper' }));
  const boot = bootShim(c);
  assert.equal(boot.status, 0, boot.stderr);
  assert.match(boot.stderr, /an update that did not finish was not recovered at start \(held: another update is already being prepared \(process \d+\)\)/);
  assert.equal(boot.booted, `booted ${NEW} by Kosmos\\board`, 'the tree is its helper\'s, so the app in ROOT starts');
  assert.equal(readJson(c.journal).phase, 'starting');
});

/** Apply with the new board never starting and something in app's way back to staged: stuck. */
async function stuckOnApp(c) {
  const sim = playBoard(c, { newNeverStarts: true });
  const blocker = path.join(c.staged, 'app');
  const r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (s) => { if (s === 'H8' && !fs.existsSync(blocker)) fs.mkdirSync(blocker); } } }));
  assert.equal(r.outcome, 'stuck', c.log.join('\n'));
  return blocker;
}

test('SAFETY 1: a boot recovery left stuck starts the whole OLD app from previous, never the new unconfirmed one, and puts it back once it can', WIN32_ONLY_T, async () => {
  const c = freshInstall();
  const before = installState(c);
  stage(c);
  const blocker = await stuckOnApp(c);
  const boot = bootShim(c);
  assert.equal(boot.status, 0, boot.stderr);
  assert.equal(boot.booted, `booted ${OLD} by Kosmos\\board`, boot.stderr);
  assert.equal(boot.from, path.join(c.previous, 'app'), 'the old app, from previous-0.6.60');
  assert.match(boot.stderr, /not recovered at start \(stuck: app is not back in the Kosmos folder\)/);
  assert.match(boot.stderr, /starting the previous version from .*previous-0\.6\.60.app until the update can be put back/);
  assert.equal(readJson(c.journal).phase, 'stuck');
  assert.equal(fs.readFileSync(path.join(c.anchor, 'node.exe'), 'utf8'), `the anchored node.exe of ${OLD}`, 'on the old interpreter');
  fs.rmdirSync(blocker);
  const again = bootShim(c);
  assert.equal(again.booted, `booted ${OLD} by Kosmos\\board`, again.stderr);
  assert.equal(again.from, path.join(c.root, 'app'));
  assertRolledBack(c, before, null, null, 'put back');
});

test('SAFETY 1: when the old app in previous is not whole, the shim says so and the folder\'s app starts as before', WIN32_ONLY_T, async () => {
  const c = freshInstall();
  stage(c);
  await stuckOnApp(c);
  fs.rmSync(path.join(c.previous, 'app', 'web', 'index.html'));
  const boot = bootShim(c);
  assert.equal(boot.status, 0, boot.stderr);
  assert.equal(boot.from, path.join(c.root, 'app'));
  assert.equal(boot.booted, `booted ${NEW} by Kosmos\\board`);
  assert.match(boot.stderr, /the previous version cannot be started instead \(.*index\.html is missing\), so the app in the Kosmos folder starts/);
});

test('the update lock is released when the sweep beside it throws, and the next helper applies', T, async () => {
  const c = freshInstall();
  stage(c);
  const sim = playBoard(c);
  const realSweep = win32update.sweepLockLeftovers;
  win32update.sweepLockLeftovers = () => { throw Object.assign(new Error('simulated'), { code: 'EIO' }); };
  let r;
  try { r = await win32apply.applyJournal(c.journal, sim.deps()); } finally { win32update.sweepLockLeftovers = realSweep; }
  assert.equal(r.ok, false);
  assert.match(r.because, /the update lock could not be tidied \(code=EIO\)/);
  assert.equal(fs.existsSync(path.join(c.work, win32update.LOCK_NAME)), false, 'the lock was not leaked');
  assert.equal((await win32apply.applyJournal(c.journal, sim.deps())).outcome, 'updated');
});

test('the helper refuses a staged app whose version is not the one the update was prepared for', T, async () => {
  const c = freshInstall();
  const before = installState(c);
  stage(c);
  fs.writeFileSync(path.join(c.staged, 'app', 'package.json'), JSON.stringify({ version: '0.6.99' }));
  const sim = playBoard(c);
  const r = await win32apply.applyJournal(c.journal, sim.deps());
  assert.equal(r.outcome, 'not-started');
  assert.match(r.because, /the staged update is 0\.6\.99, not the 0\.6\.61 this update was prepared for/);
  assert.deepEqual(installState(c), before);
  assert.deepEqual(sim.calls, []);
});

test('the path guard holds for every resumer: a boot recovery, the resume helper, a settlement, an abandoned staged journal', T, async () => {
  const outside = (c, written, alsoAllowed = []) => written.filter((p) => !allowedWrite(c, p) && !alsoAllowed.map((a) => path.resolve(a)).includes(p));
  {
    const c = freshInstall();
    const before = installState(c);
    stage(c);
    crashAt(c, 'after H4 bin');
    const sim = playBoard(c);
    const written = await recordWrites(async () => { win32apply.recoverAtBoot(c.journal, sim.deps()); });
    assertRolledBack(c, before, null, null, 'boot');
    assert.ok(written.length > 10);
    assert.deepEqual(outside(c, written), [], 'boot recovery');
  }
  {
    const c = freshInstall();
    const before = installState(c);
    stage(c);
    crashAt(c, 'before H7-run #1');
    /* No board answers as the new build, so the resume helper rolls back (a board that did is finished
       forward: the resume helper's own test). */
    const sim = playBoard(c, { newNeverStarts: true });
    sim.running = false;
    sim.identity = null;
    const written = await recordWrites(async () => { await win32apply.resumeJournal(c.journal, sim.deps()); });
    assertRolledBack(c, before, sim, null, 'resume');
    assert.ok(written.length > 10);
    assert.deepEqual(outside(c, written), [], 'resume helper');
  }
  {
    const c = freshInstall();
    stage(c);
    crashAt(c, 'after H3 bin');
    fs.rmSync(c.work, { recursive: true, force: true });
    const sim = playBoard(c);
    const written = await recordWrites(async () => { win32apply.recoverAtBoot(c.journal, sim.deps()); });
    assert.equal(readJson(c.journal).outcome, 'abandoned');
    assert.deepEqual(outside(c, written, [c.work]), [], 'settlement: WORK itself is made again, and nothing else outside');
  }
  {
    const c = freshInstall();
    const before = installState(c);
    stage(c);
    const sim = playBoard(c);
    const written = await recordWrites(async () => { win32apply.abandonStagedJournal(c.journal, 'no helper could be started', sim.deps()); });
    assert.equal(readJson(c.journal).outcome, 'not-started');
    assert.deepEqual(installState(c), before);
    assert.deepEqual(outside(c, written), [], 'abandoned staged journal');
  }
});

test('the path guard holds for a recovery the logon shim runs: nothing outside what an update owns changes', WIN32_ONLY_T, () => {
  const c = freshInstall();
  const before = installState(c);
  stage(c);
  crashAt(c, 'after H4 app');
  const appData = appDataKosmos();
  const skip = [path.join(c.anchor, win32board.BOOT_NAME), path.join(c.dir, 'booted.txt'), path.join(c.dir, 'booted-from.txt'), c.work, c.anchor, c.root].map((p) => path.resolve(p));
  const outside = () => Object.fromEntries(Object.entries(hashTree(c.dir)).filter(([rel]) => {
    const abs = path.resolve(c.dir, rel);
    return !skip.includes(abs) && !allowedWrite(c, abs);
  }));
  const outsideBefore = outside();
  const appDataBefore = hashTree(appData);
  assert.ok(Object.keys(outsideBefore).some((k) => k.includes('Projects')), 'the control: the person\'s projects are among what is watched');
  const boot = bootShim(c);
  assert.equal(boot.booted, `booted ${OLD} by Kosmos\\board`, boot.stderr);
  assertRolledBack(c, before, null, null, 'shim');
  assert.deepEqual(outside(), outsideBefore);
  assert.deepEqual(hashTree(appData), appDataBefore);
});

test('a power loss between replaceInterpreter\'s two renames (H5, and H8 putting it back) leaves no anchored node.exe; a recovery restores its exact bytes', WIN32_ONLY_LONG, () => {
  for (const [nth, newNeverStarts, label, phase] of [[1, false, 'H5', 'interpreter'], [2, true, 'H8-H5', 'rolling-back']]) {
    const c = freshInstall();
    const before = installState(c);
    stage(c);
    crashAt(c, null, { newNeverStarts, killOnInterpreterRename: nth });
    /* The window design section 9 names: no anchored node.exe at all, so no logon task can start and
       no shim runs. Kosmos.exe in the Kosmos folder is the way back (the status sentences name it).
       Here the recovery is run directly, as the next task start would once anything re-anchors. */
    assert.equal(fs.existsSync(path.join(c.anchor, 'node.exe')), false, `${label}: no anchored interpreter`);
    assert.ok(fs.readdirSync(c.anchor).some((n) => n.startsWith('node.exe' + win32swap.RETIRED_INFIX)), `${label}: the interpreter it replaced is aside`);
    assert.equal(readJson(c.journal).phase, phase, label);
    const boot = bootShim(c);
    assert.equal(boot.booted, `booted ${OLD} by Kosmos\\board`, `${label}: ${boot.stderr}`);
    assertRolledBack(c, before, null, null, label);
  }
});

test('a boot resumer killed mid-rollback is finished by the next boot', WIN32_ONLY_LONG, () => {
  for (const nth of [1, 3, 6, 10, 15, 25]) {
    const c = freshInstall();
    const before = installState(c);
    stage(c);
    crashAt(c, 'before H7-run #1');
    const killed = bootShim(c, { preload: KILL_AT_RENAME, env: { KOSMOS_TEST_KILL_AT_RENAME: String(nth) } });
    assert.equal(killed.booted, null, `rename ${nth}: the first boot's recovery really died (status ${killed.status}, ${killed.stderr})`);
    assert.equal(readJson(c.journal).finished, false, `rename ${nth}`);
    const boot = bootShim(c);
    assert.equal(boot.booted, `booted ${OLD} by Kosmos\\board`, `rename ${nth}: ${boot.stderr}`);
    assertRolledBack(c, before, null, null, `killed at rename ${nth}`);
  }
});

/* ─── review round 2 ──────────────────────────────────────────────────────────────────────── */

test('SAFETY 1: WORK deleted during H7 with no resumer: the helper stops at its next write, the only build stays in ROOT, and the next resumer settles it', T, async () => {
  const c = freshInstall();
  stage(c);
  const newTree = hashTree(c.staged);
  const sim = playBoard(c, { newNeverStarts: true });
  const r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step, d) => {
    if (step === 'H7-run' && d.run === 1 && fs.existsSync(c.work)) fs.rmSync(c.work, { recursive: true, force: true });
  } } }));
  assert.equal(r.outcome, 'taken-over', JSON.stringify(r) + '\n' + c.log.join('\n'));
  assert.equal(r.because, 'the update stopped here: its update lock is gone or belongs to someone else now, so nothing more was written');
  assert.deepEqual(hashTree(c.root, [c.work, path.join(c.root, 'Projects')]), newTree, 'the new build, the only one left, is still in ROOT');
  assert.equal(fs.existsSync(c.work), false, 'nothing made WORK again');
  const j = readJson(c.journal);
  assert.equal(j.finished, false);
  assert.equal(j.phase, 'starting');
  assert.match(win32apply.unfinishedUpdateRefusal(c.anchor), /can never finish, because its working folder .* is gone/);
  assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'abandoned', 'the next resumer settles it');
  assert.match(readJson(c.statusAt).sentence, /Download a fresh copy of Kosmos/);
  assert.deepEqual(hashTree(c.root, [c.work, path.join(c.root, 'Projects')]), newTree);
});

test('SAFETY 1: WORK deleted during H7 while a boot resumer settles it: the helper never resurrects the settled journal, and ROOT keeps its build', T, async () => {
  const c = freshInstall();
  stage(c);
  const newTree = hashTree(c.staged);
  const sim = playBoard(c, { newNeverStarts: true });
  let resumer = null;
  const r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step, d) => {
    if (step === 'H7-run' && d.run === 1 && !resumer) {
      fs.rmSync(c.work, { recursive: true, force: true });
      resumer = win32apply.recoverAtBoot(c.journal, sim.deps());
    }
  } } }));
  assert.equal(resumer.action, 'abandoned', JSON.stringify(resumer));
  assert.equal(r.outcome, 'taken-over', JSON.stringify(r) + '\n' + c.log.join('\n'));
  const j = readJson(c.journal);
  assert.equal(j.finished, true, 'the settled journal stays settled');
  assert.equal(j.outcome, 'abandoned');
  assert.equal(readJson(c.statusAt).outcome, 'stuck');
  assert.match(readJson(c.statusAt).sentence, /Download a fresh copy of Kosmos/);
  assert.deepEqual(hashTree(c.root, [c.work, path.join(c.root, 'Projects')]), newTree, 'ROOT keeps the only build');
  assert.deepEqual(fs.existsSync(c.staged) ? fs.readdirSync(c.staged) : [], [], 'nothing was moved into the WORK the resumer made again');
});

test('SAFETY 1: with previous-<from> gone, the rollback never moves the only build out of ROOT and never calls a new app the old tree', T, async () => {
  const c = freshInstall();
  stage(c);
  const newTree = hashTree(c.staged);
  const sim = playBoard(c, { newNeverStarts: true });
  const r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step, d) => {
    if (step === 'H7-run' && d.run === 1 && fs.existsSync(c.previous)) fs.rmSync(c.previous, { recursive: true, force: true });
  } } }));
  assert.equal(r.outcome, 'stuck', JSON.stringify(r) + '\n' + c.log.join('\n'));
  assert.equal(r.because, 'the app in the Kosmos folder is 0.6.61, not 0.6.60');
  assert.deepEqual(hashTree(c.root, [c.work, path.join(c.root, 'Projects')]), newTree, 'every entry of the only build is still in ROOT');
  assert.equal(readJson(c.journal).finished, false, 'not called whole');
  assert.equal(readJson(c.statusAt).outcome, 'stuck');
});

test('SAFETY 1: a rollback with no recovery code left settles in words first, instead of reversing by names', T, async () => {
  const c = freshInstall();
  stage(c);
  const sim = playBoard(c, { newNeverStarts: true });
  const r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step, d) => {
    if (step === 'H7-run' && d.run === 3) for (const f of readJson(c.journal).recoverFrom) fs.rmSync(f, { force: true });
  } } }));
  assert.equal(r.outcome, 'abandoned', JSON.stringify(r) + '\n' + c.log.join('\n'));
  assert.match(readJson(c.statusAt).sentence, /cannot finish or undo it by itself \(no copy of the updater that could put it back is left\)\. Download a fresh copy/);
  assert.equal(readJson(c.journal).outcome, 'abandoned');
  assert.deepEqual(sim.calls.filter((call) => call.startsWith('/End')), ['/End /TN Kosmos\\board'], 'no reversal was attempted, so no second stop');
});

test('SAFETY 2: a journal whose Kosmos folder is on a drive that is not connected is held, never abandoned', WINDOWS_ONLY, async () => {
  const letter = 'QRSTUVWXYZ'.split('').find((l) => !fs.existsSync(`${l}:\\`));
  assert.ok(letter, 'the control: a drive letter nothing is mounted on');
  const c = freshInstall();
  const j = stage(c);
  const root = `${letter}:\\Kosmos`;
  const work = path.join(root, win32update.WORK_DIRNAME);
  const previous = path.join(work, `previous-${OLD}`);
  const moved = {
    ...j, root, work, staged: path.join(work, win32update.STAGED_DIRNAME), previous, phase: 'moving-in',
    pointer: { ...j.pointer, after: path.join(root, 'app', 'engine') },
    recoverFrom: [path.join(previous, 'app', 'engine', 'win32apply.js'), path.join(root, 'app', 'engine', 'win32apply.js')],
    steps: [{ step: 'H3', entry: 'runtime', state: 'intent' }],
  };
  fs.writeFileSync(c.journal, JSON.stringify(moved, null, 2));
  assert.equal(win32apply.readJournal(c.journal).state, 'unfinished', 'the control: the journal itself reads');
  const sim = playBoard(c);
  const because = `the drive Kosmos is on (${letter}:\\) is not connected`;
  assert.deepEqual(win32apply.recoverAtBoot(c.journal, sim.deps()), { action: 'unreachable', because });
  assert.equal((await win32apply.resumeJournal(c.journal, sim.deps())).action, 'unreachable');
  assert.deepEqual(win32apply.settleUnrecoverableJournal(c.journal, sim.deps()), { action: 'unreachable', because });
  assert.deepEqual(readJson(c.journal), moved, 'the journal is left for when the drive comes back');
  assert.equal(fs.existsSync(c.statusAt), false, 'no status was written');
  assert.equal(win32apply.unfinishedUpdateRefusal(c.anchor),
    `an earlier update to ${NEW} cannot be finished right now, because ${because}. Reconnect that drive, or close any program using the Kosmos folder, then restart your computer and try again. `
    + `If that does not help, download a fresh copy of Kosmos, unpack it over your Kosmos folder, then double-click Kosmos.exe in ${root}`);
});

test('NIT 5: a staged journal is young only for 0 <= age < the grace; a clock stepped back or a createdAt in the future is not young', T, () => {
  const grace = win32apply.STAGED_HELPER_STARTUP_GRACE_MS;
  const j = { phase: 'staged', createdAt: new Date(clock).toISOString() };
  assert.equal(win32apply.stagedIsYoung(j, clock), true, 'age 0');
  assert.equal(win32apply.stagedIsYoung(j, clock + grace - 1), true);
  assert.equal(win32apply.stagedIsYoung(j, clock + grace), false);
  assert.equal(win32apply.stagedIsYoung(j, clock - 1), false, 'a clock stepped back');
  assert.equal(win32apply.stagedIsYoung({ ...j, createdAt: new Date(clock + 60 * 60 * 1000).toISOString() }, clock), false, 'a createdAt in the future');
  assert.equal(win32apply.stagedIsYoung({ ...j, phase: 'moving-in' }, clock), false);
  assert.equal(win32apply.stagedIsYoung({ ...j, createdAt: 'not a date' }, clock), false);
});

const hostExists = (f) => fs.existsSync(ON_WINDOWS ? f : f.split('\\').join('/'));

test('SAFETY 3: a board running from the updater\'s folder neither re-registers nor re-anchors, and its machine check reads "could not check"', T, () => {
  const c = freshInstall();
  const fallback = path.join(c.work, `previous-${OLD}`);
  writeBuild(fallback, OLD, 'old in previous');
  const calls = [];
  const anchored = [];
  win32board.setRunner((args) => { calls.push(args.join(' ')); return { ok: true, out: '' }; });
  win32board.setAnchorer((spec) => { anchored.push(spec); return { ok: true, node: 'n', boot: 'b', dir: c.anchor, pointer: 'p' }; });
  try {
    assert.equal(win32board.bundleRoot({ platform: 'win32', root: c.root, exists: hostExists }), c.root, 'the control: the Kosmos folder itself is the bundle');
    assert.equal(win32board.bundleRoot({ platform: 'win32', root: fallback, exists: hostExists }), null);
    const r = win32board.ensureInstalled({ platform: 'win32', root: fallback, exists: hostExists, env: c.env });
    assert.equal(r.action, 'skipped', JSON.stringify(r));
    assert.deepEqual(calls, [], 'the logon task was neither read nor registered');
    assert.deepEqual(anchored, [], 'nothing was anchored');
    assert.equal(win32board.describe({ platform: 'win32', root: fallback, exists: hostExists, env: c.env }), null, 'machine.js renders null as "we could not check"');
    assert.equal(win32board.runningFromUpdateWork({ root: fallback }), true);
    assert.equal(win32board.runningFromUpdateWork({ root: c.root }), false);
    /* #2984's Kosmos-folder row and reveal: "could not check", never "running from source". */
    const machine = require('./machine');
    const row = machine.appLocationCheck({ platform: 'win32', bundleRoot: null, bundleInUpdateWork: true });
    assert.equal(row.state, machine.STATE.UNKNOWN);
    assert.doesNotMatch(row.title + row.detail, /from source/);
    assert.throws(() => machine.revealApp({ platform: 'win32', bundleRoot: null, bundleInUpdateWork: true }),
      /running from a copy the updater is holding while it puts an update back/);
    assert.match(machine.appLocationCheck({ platform: 'win32', bundleRoot: null, bundleInUpdateWork: false }).title, /running from source/,
      'the control: a real source checkout still says so');
    assert.equal(win32anchor.bundleIsInUpdateWork(fallback), true);
    assert.equal(win32anchor.bundleIsInUpdateWork(c.root), false);
    assert.equal(win32update.WORK_DIRNAME, win32anchor.UPDATE_WORK_DIRNAME, 'one spelling of the folder name');
  } finally {
    win32board.setAnchorer(null);
  }
});

/* ─── review round 3 ──────────────────────────────────────────────────────────────────────── */

test('SAFETY A: a helper that lost the update to a boot resumer makes no scheduler call and no write after the takeover (V5 at H5\'s safety copy, V7 in H7\'s last run)', LONG, async () => {
  for (const [label, boardOptions, where] of [['V5', {}, 'H5-copy'], ['V7', { newNeverStarts: true }, 'last-run']]) {
    const c = freshInstall();
    stage(c);
    const sim = playBoard(c, boardOptions);
    const taken = { on: false, resumer: null, callsAtTakeover: null };
    const takeOver = () => {
      if (taken.resumer) return;
      fs.rmSync(c.work, { recursive: true, force: true });
      taken.resumer = win32apply.recoverAtBoot(c.journal, sim.deps());
      taken.callsAtTakeover = sim.calls.length;
      taken.on = true;
    };
    const baseProbe = sim.deps().probe;
    const extra = where === 'H5-copy'
      ? { hooks: { before: (step) => { if (step === 'H5-copy') takeOver(); } } }
      : { probe: async (port) => { if (sim.calls.filter((call) => call.startsWith('/Run')).length >= 3) takeOver(); return baseProbe(port); } };
    let r;
    const written = await recordWrites(async () => { r = await win32apply.applyJournal(c.journal, sim.deps(extra)); }, () => taken.on);
    assert.ok(taken.resumer, `${label}: the control: the takeover happened`);
    assert.equal(taken.resumer.action, 'abandoned', `${label}: ${JSON.stringify(taken.resumer)}`);
    assert.equal(r.outcome, 'taken-over', `${label}: ${JSON.stringify(r)}\n${c.log.join('\n')}`);
    assert.deepEqual(sim.calls.slice(taken.callsAtTakeover), [], `${label}: no /End and no /Run after the takeover`);
    assert.deepEqual(written, [], `${label}: no write after the takeover`);
    const j = readJson(c.journal);
    assert.equal(j.finished, true, label);
    assert.equal(j.outcome, 'abandoned', label);
    assert.match(readJson(c.statusAt).sentence, /Download a fresh copy of Kosmos/, label);
  }
});

test('NIT B: a build in the updater\'s folder is recognised through an 8.3 short name too', { ...T, skip: !ON_WINDOWS && 'short names are a Windows file-system feature' }, (t) => {
  const kosmos = path.join(SANDBOX, 'ShortNameKosmosFolder');
  const long = path.join(kosmos, win32update.WORK_DIRNAME, `previous-${OLD}`);
  fs.mkdirSync(long, { recursive: true });
  const shortOf = (p) => cp.execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${p.replace(/'/g, "''")}').ShortPath`], { encoding: 'utf8', windowsHide: true, timeout: 60000 }).trim();
  const short = shortOf(long);
  if (!short || short.toLowerCase() === long.toLowerCase() || !/~\d/.test(short)) {
    t.skip('this volume makes no 8.3 short names');
    return;
  }
  assert.notEqual(path.win32.basename(path.win32.dirname(short)).toLowerCase(), win32update.WORK_DIRNAME, 'the control: the short spelling hides the folder name');
  assert.equal(win32anchor.bundleIsInUpdateWork(short, path.win32), true);
  assert.equal(win32anchor.bundleIsInUpdateWork(shortOf(kosmos), path.win32), false, 'the Kosmos folder itself, short-named, is not inside it');
  assert.equal(win32board.bundleRoot({ platform: 'win32', root: short, exists: () => true }), null);
});

test('SAFETY 3: ensureAnchored never points engine-path into the updater\'s folder, and writes nothing there', T, () => {
  const c = freshInstall();
  const pointerAt = path.join(c.anchor, win32anchor.POINTER_NAME);
  const nodeAt = path.join(c.anchor, win32anchor.NODE_NAME);
  const before = { pointer: readText(pointerAt), node: readText(nodeAt) };
  const src = path.join(c.dir, 'other-node.exe');
  fs.writeFileSync(src, 'a different node.exe, of another size entirely');
  const fallbackEngine = path.join(c.work, `previous-${OLD}`, 'app', 'engine');
  const r = win32anchor.ensureAnchored({ platform: process.platform, home: os.homedir(), env: c.env, node: src, engineDir: fallbackEngine });
  assert.equal(r.ok, true);
  assert.match(r.untouched, /inside the updater's folder/);
  assert.deepEqual({ pointer: readText(pointerAt), node: readText(nodeAt) }, before, 'the pointer and the interpreter are untouched');
  /* NIT C: a pointer that names no app is refused in words, so a job an agent registers from such a
     board cannot look registered while its shim would exit 3. */
  const gone = path.join(c.dir, 'gone', 'app', 'engine');
  fs.writeFileSync(pointerAt, gone);
  const dangling = win32anchor.ensureAnchored({ platform: process.platform, home: os.homedir(), env: c.env, node: src, engineDir: fallbackEngine });
  assert.equal(dangling.ok, false);
  assert.match(dangling.because, /runs from inside the updater's folder .*and the engine pointer names no app .*so a job registered now could not start/);
  assert.equal(readText(pointerAt), gone, 'still untouched');
  fs.writeFileSync(pointerAt, before.pointer);
  /* The control: the Kosmos folder's own engine is anchored as always. */
  const own = win32anchor.ensureAnchored({ platform: process.platform, home: os.homedir(), env: c.env, node: src, engineDir: path.join(c.root, 'app', 'engine') });
  assert.equal(own.ok, true, own.because);
  assert.equal(own.untouched, undefined);
  assert.equal(readText(pointerAt), path.join(c.root, 'app', 'engine'));
});

/* ─── review round 4 ──────────────────────────────────────────────────────────────────────── */

/**
 * A PowerShell child holding `file` open with no sharing at all (FileShare.None), as a scanner or a
 * backup tool can: every read of it fails with EBUSY until `release()` ends the child. The round 4
 * reviewer measured exactly this handle making the live helper walk away (probe P6).
 */
function holdExclusively(file) {
  const script = `$held = [IO.File]::Open('${file.replace(/'/g, "''")}', 'Open', 'Read', 'None'); Start-Sleep -Seconds 600`;
  const child = cp.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true });
  child.on('error', () => { /* exclusiveHoldSkipReason has already proved PowerShell starts here */ });
  const readCode = () => { try { fs.readFileSync(file); return null; } catch (e) { return e.code; } };
  const until = Date.now() + 30000;
  while (readCode() !== 'EBUSY') {
    if (Date.now() > until) { try { child.kill(); } catch { /* gone */ } throw new Error('the holder never held the file'); }
    sleepSync(50);
  }
  const holder = {
    released: false,
    release() {
      if (holder.released) return;
      holder.released = true;
      try { child.kill(); } catch { /* already gone */ }
      const gone = Date.now() + 15000;
      while (readCode() === 'EBUSY' && Date.now() < gone) sleepSync(50);
    },
  };
  return holder;
}

/**
 * Why a real exclusive handle cannot be taken on this box (PowerShell does not start, or its hold never
 * takes), or null. Asked before a test that needs one, so that test skips in words instead of failing
 * after a long wait.
 */
async function exclusiveHoldSkipReason() {
  const file = path.join(SANDBOX, `hold-probe-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(file, 'probe');
  const script = `$held = [IO.File]::Open('${file.replace(/'/g, "''")}', 'Open', 'Read', 'None'); Start-Sleep -Seconds 60`;
  let child;
  try {
    child = cp.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true });
  } catch (e) {
    return `powershell.exe could not be started (${e.code || e.message})`;
  }
  let ended = null;
  child.on('error', (e) => { ended = `powershell.exe could not be started (${e.code || e.message})`; });
  child.on('exit', (code) => { if (!ended) ended = `powershell.exe exited (code ${code}) before it held a file`; });
  const until = Date.now() + 30000;
  try {
    for (;;) {
      try { fs.readFileSync(file); } catch (e) { if (e.code === 'EBUSY') return null; }
      if (ended) return ended;
      if (Date.now() > until) return 'a PowerShell child did not hold a file within 30 seconds';
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    try { child.kill(); } catch { /* gone */ }
  }
}

/** Every lstat of `target` (compared case-blind) fails with `code`, `shots` times (-1: until unfaultLstat). */
const realLstatSync = fs.lstatSync;
function faultLstat(target, code, shots) {
  const box = { left: shots, hits: 0 };
  const wanted = path.resolve(target).toLowerCase();
  fs.lstatSync = function faulty(p, ...rest) {
    if (box.left !== 0 && path.resolve(String(p)).toLowerCase() === wanted) {
      box.left -= 1;
      box.hits += 1;
      throw Object.assign(new Error(`${code}: injected, lstat '${p}'`), { code });
    }
    return realLstatSync.call(this, p, ...rest);
  };
  return box;
}
function unfaultLstat() { fs.lstatSync = realLstatSync; }

test('BUG 1: a real exclusive handle on the update lock in the forward steps: let go between two reads, the update goes in; held past the reads, it rolls back and the old board comes back', WINDOWS_ONLY, async (t) => {
  const skipWhy = await exclusiveHoldSkipReason();
  if (skipWhy) { t.skip(skipWhy); return; }
  {
    const c = freshInstall();
    stage(c);
    const sim = playBoard(c);
    const lockAt = path.join(c.work, win32update.LOCK_NAME);
    let holder = null;
    let waitsWhileHeld = 0;
    try {
      const r = await win32apply.applyJournal(c.journal, sim.deps({
        hooks: { before: (step, d) => { if (step === 'H4' && d.entry === 'bin' && !holder) holder = holdExclusively(lockAt); } },
        /* The wait between two reads is where the scanner lets go. */
        sleepSync: (ms) => { clock += ms; if (holder && !holder.released) { waitsWhileHeld += 1; holder.release(); } },
      }));
      assert.equal(waitsWhileHeld, 1, 'the control: a read of the held lock failed, and waited once');
      assert.equal(r.outcome, 'updated', JSON.stringify(r) + '\n' + c.log.join('\n'));
      assert.equal(readJson(c.journal).outcome, 'updated');
      assert.equal(sim.identity, NEW_ID);
    } finally {
      if (holder) holder.release();
    }
  }
  {
    const c = freshInstall();
    stage(c);
    const before = installState(c);
    const sim = playBoard(c);
    const lockAt = path.join(c.work, win32update.LOCK_NAME);
    let holder = null;
    try {
      const r = await win32apply.applyJournal(c.journal, sim.deps({
        hooks: { before: (step, d) => { if (step === 'H4' && d.entry === 'bin' && !holder) holder = holdExclusively(lockAt); } },
        /* It lets go once the helper has given up on the forward steps, so the rollback can check. */
        log: (line) => { c.log.push(line); if (holder && line.startsWith('the update failed during ')) holder.release(); },
      }));
      assert.equal(r.outcome, 'rolled-back', JSON.stringify(r) + '\n' + c.log.join('\n'));
      assert.ok(c.log.includes('the update failed during moving-in: the updater could not check that this update is still its own, because its update lock cannot be read (code=EBUSY)'), c.log.join('\n'));
      assertRolledBack(c, before, sim, r, 'held past the reads');
    } finally {
      if (holder) holder.release();
    }
  }
});

test('BUG 1: a real exclusive handle on the update lock inside the rollback: held, nothing more is written but the release, and once the release frees the lock the board it ended is started, whose real shim puts the old build back', WINDOWS_ONLY, async (t) => {
  const skipWhy = await exclusiveHoldSkipReason();
  if (skipWhy) { t.skip(skipWhy); return; }
  const c = freshInstall();
  stage(c);
  const before = installState(c);
  const lockAt = path.join(c.work, win32update.LOCK_NAME);
  let holder = null;
  let callsAtHold = null;
  const shims = [];
  const box = { lockAtRun: null };
  const sim = playBoard(c, { newNeverStarts: true, onRun: () => {
    if (!holder) return;
    box.lockAtRun = fs.existsSync(lockAt);
    shims.push(bootShimAsync(c));
  } });
  let r;
  try {
    const written = await recordWrites(async () => {
      r = await win32apply.applyJournal(c.journal, sim.deps({
        hooks: { before: (step) => {
          if (step === 'H8' && !holder) { holder = holdExclusively(lockAt); callsAtHold = sim.calls.length; }
        } },
        /* The scanner lets go once the rollback has stopped, so the release can free the lock. */
        log: (line) => { c.log.push(line); if (holder && line.startsWith('stopped without writing, and left the update for the next resumer')) holder.release(); },
      }));
    }, () => Boolean(holder));
    assert.ok(holder, 'the control: the rollback began');
    assert.equal(r.outcome, 'held', JSON.stringify(r) + '\n' + c.log.join('\n'));
    assert.match(r.because, /its update lock cannot be read \(code=EBUSY\)/);
    /* The shim file is this test's own write, standing in for the installed shim the /Run starts. */
    const testOwn = [path.resolve(lockAt), path.resolve(path.join(c.anchor, win32board.BOOT_NAME))];
    assert.deepEqual(written.filter((p) => !testOwn.includes(p)), [], 'nothing is written once the rollback cannot tell, but releasing its own lock');
    assert.deepEqual(sim.calls.slice(callsAtHold), ['/Run /TN Kosmos\\board'], 'one /Run of the board this helper ended');
    assert.equal(box.lockAtRun, false, 'the /Run came after the lock was released (round 9, decision 1)');
  } finally {
    if (holder) holder.release();
  }
  assert.equal(shims.length, 1);
  const shim = await shims[0];
  assert.equal(shim.status, 0, shim.stderr);
  assert.equal(shim.booted, `booted ${OLD} by Kosmos\\board`, shim.stderr);
  assertRolledBack(c, before, null, null, 'the real shim the /Run started');
});

test('BUG 1: the control: a lock that reads with another update\'s bytes is proof, and the helper stops as taken-over', T, async () => {
  const c = freshInstall();
  stage(c);
  const sim = playBoard(c);
  const lockAt = path.join(c.work, win32update.LOCK_NAME);
  const r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step, d) => {
    if (step === 'H4' && d.entry === 'bin') fs.writeFileSync(lockAt, JSON.stringify({ pid: 4242, at: clock, token: 'another update' }));
  } } }));
  assert.equal(r.outcome, 'taken-over', JSON.stringify(r) + '\n' + c.log.join('\n'));
  assert.equal(r.because, 'the update stopped here: its update lock is gone or belongs to someone else now, so nothing more was written');
});

test('BUG 2: an EBUSY from the Kosmos folder\'s lstat as the helper begins its rollback is not "folder gone": once, it is asked again and the rollback runs; past the budget, held, and the next board start rolls it back', T, async () => {
  for (const shots of [1, -1]) {
    const c = freshInstall();
    stage(c);
    const before = installState(c);
    const sim = playBoard(c, { newNeverStarts: true });
    let fault = null;
    let r;
    try {
      r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step, d) => {
        if (step === 'H7-run' && d.run === 3 && !fault) fault = faultLstat(c.root, 'EBUSY', shots);
      } } }));
    } finally {
      unfaultLstat();
    }
    if (shots === 1) {
      assert.equal(fault.hits, 1, 'the control: the Kosmos folder answered EBUSY once');
      assertRolledBack(c, before, sim, r, 'one EBUSY, asked again');
      continue;
    }
    assert.ok(fault.hits >= win32apply.OWNER_READ_BUDGET.tries, `the control: EBUSY for the whole budget (${fault.hits})`);
    assert.equal(r.outcome, 'held', JSON.stringify(r) + '\n' + c.log.join('\n'));
    assert.equal(r.because, `the Kosmos folder (${c.root}) cannot be reached right now (code=EBUSY)`);
    const j = readJson(c.journal);
    assert.equal(j.finished, false);
    assert.equal(j.phase, 'starting');
    assert.equal(fs.existsSync(c.statusAt), false, 'nothing was settled in words');
    assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'rolled-back', c.log.join('\n'));
    assert.deepEqual(installState(c), before);
  }
});

test('BUG 2: a boot resumer that sees the Kosmos folder as gone or busy while WORK is readable takes the lock first: held by the live helper, which finishes', T, async () => {
  for (const code of ['ENOENT', 'EBUSY']) {
    const c = freshInstall();
    stage(c);
    const sim = playBoard(c);
    let resumer = null;
    let hits = 0;
    const r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step, d) => {
      if (step !== 'H4' || d.entry !== 'app' || resumer) return;
      const fault = faultLstat(c.root, code, -1);
      try {
        resumer = win32apply.recoverAtBoot(c.journal, sim.deps({ log: (line) => c.log.push('[boot] ' + line) }));
      } finally {
        hits = fault.hits;
        unfaultLstat();
      }
    } } }));
    assert.ok(hits >= 1, `${code}: the control: the Kosmos folder's lstat failed for the resumer`);
    assert.equal(resumer.action, 'held', `${code}: ${JSON.stringify(resumer)}\n${c.log.join('\n')}`);
    assert.equal(r.outcome, 'updated', `${code}: ${JSON.stringify(r)}\n${c.log.join('\n')}`);
    const j = readJson(c.journal);
    assert.equal(j.outcome, 'updated', code);
    assert.equal(readJson(c.statusAt).outcome, 'updated', code);
    assert.equal(sim.identity, NEW_ID, code);
  }
});

test('TEST-GAP 3 (K02): a helper taken over while it polls after H7\'s first /Run issues no further /Run or /End', T, async () => {
  const c = freshInstall();
  stage(c);
  const sim = playBoard(c, { newNeverStarts: true });
  const taken = { resumer: null, callsAt: null };
  const baseProbe = sim.deps().probe;
  const r = await win32apply.applyJournal(c.journal, sim.deps({ probe: async (port) => {
    if (!taken.resumer && sim.calls.filter((call) => call.startsWith('/Run')).length === 1) {
      fs.rmSync(c.work, { recursive: true, force: true });
      taken.resumer = win32apply.recoverAtBoot(c.journal, sim.deps());
      taken.callsAt = sim.calls.length;
    }
    return baseProbe(port);
  } }));
  assert.ok(taken.resumer, 'the control: the takeover happened during the first run');
  assert.equal(taken.resumer.action, 'abandoned', JSON.stringify(taken.resumer));
  assert.equal(r.outcome, 'taken-over', JSON.stringify(r) + '\n' + c.log.join('\n'));
  assert.deepEqual(sim.calls.slice(taken.callsAt), [], 'no second /Run and no /End after the takeover');
});

test('TEST-GAP 3 (K18): the drive goes away while the helper is in H7: its rollback holds before stopping or writing anything, and a later boot rolls it back', T, async () => {
  const c = freshInstall();
  stage(c);
  const before = installState(c);
  let callsAtFault = null;
  const box = { lockAtRun: null };
  const sim = playBoard(c, { newNeverStarts: true, onRun: (s) => {
    if (callsAtFault !== null && s.calls.length === callsAtFault + 2) box.lockAtRun = fs.existsSync(lockOf(c));
  } });
  const volume = path.parse(c.root).root;
  let r;
  try {
    r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step, d) => {
      if (step === 'H7-run' && d.run === 3 && callsAtFault === null) { callsAtFault = sim.calls.length; faultLstat(volume, 'ENOENT', -1); }
    } } }));
    assert.equal(r.outcome, 'held', JSON.stringify(r) + '\n' + c.log.join('\n'));
    assert.equal(r.because, `the drive Kosmos is on (${volume}) is not connected`);
    assert.deepEqual(sim.calls.slice(callsAtFault), [`/Run /TN Kosmos\\board`, `/Run /TN Kosmos\\board`],
      'the third run, then one /Run of the board H2 ended once the lock is released (round 9, decision 3): no /End, so no reversal began');
    assert.equal(box.lockAtRun, false, 'the post-release /Run came after the lock was released (round 10, decision 5)');
    assert.equal(fs.existsSync(c.statusAt), false, 'no status');
    const j = readJson(c.journal);
    assert.equal(j.finished, false);
    assert.equal(j.phase, 'starting');
    assert.equal(j.steps.some((s) => String(s.step).startsWith('H8')), false, 'nothing was reversed');
  } finally {
    unfaultLstat();
  }
  assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'rolled-back', c.log.join('\n'));
  assert.deepEqual(installState(c), before);
});

test('NIT 4: a taken-over helper in production log mode (no log seam) writes nothing under WORK after the takeover, its own log included', T, async () => {
  const c = freshInstall();
  stage(c);
  const sim = playBoard(c);
  const taken = { on: false, resumer: null };
  let r;
  const written = await recordWrites(async () => {
    r = await win32apply.applyJournal(c.journal, sim.deps({ log: undefined, hooks: { before: (step) => {
      if (step !== 'H5-copy' || taken.resumer) return;
      fs.rmSync(c.work, { recursive: true, force: true });
      taken.resumer = win32apply.recoverAtBoot(c.journal, sim.deps({ log: undefined }));
      taken.on = true;
    } } }));
  }, () => taken.on);
  assert.equal(taken.resumer.action, 'abandoned', JSON.stringify(taken.resumer));
  assert.equal(r.outcome, 'taken-over', JSON.stringify(r));
  assert.deepEqual(written, [], 'no write at all after the takeover');
  const logText = readText(path.join(c.work, win32apply.APPLY_LOG_NAME)) || '';
  assert.match(logText, /\[boot \d+\] settling an update no resumer can finish \(moved\)/, 'the control: the resumer, which owns WORK now, logs there');
  assert.doesNotMatch(logText, /stopped without writing/, "the helper's own line went to stderr only");
});

test('NIT 5: losing the update during H9\'s cleanup stops the cleanup at once, and the helper still reports updated; any other failure is logged by code and message and the next removal goes on', T, async () => {
  {
    const c = freshInstall();
    stage(c);
    const sim = playBoard(c);
    const lockAt = path.join(c.work, win32update.LOCK_NAME);
    let lost = false;
    let r;
    const written = await recordWrites(async () => {
      r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step) => {
        if (step === 'H9-cleanup') { fs.rmSync(lockAt, { force: true }); lost = true; }
      } } }));
    }, () => lost);
    assert.equal(r.outcome, 'updated', JSON.stringify(r) + '\n' + c.log.join('\n'));
    assert.equal(readJson(c.journal).outcome, 'updated');
    assert.deepEqual(written, [], 'no removal after the loss');
    assert.ok(c.log.includes('stopped cleaning up, and the finished record stands: its update lock is gone or belongs to someone else now'), c.log.join('\n'));
    assert.deepEqual(c.log.filter((line) => / for later \(/.test(line)), [], 'the loss is not reported as a removal left for later');
    assert.ok(fs.existsSync(path.join(c.work, win32update.DOWNLOAD_PART_NAME)), 'the download stays too');
  }
  {
    const c = freshInstall();
    stage(c);
    const sim = playBoard(c);
    const realRm = fs.rmSync;
    fs.rmSync = function failingForStaged(p, ...rest) {
      if (path.resolve(String(p)) === path.resolve(c.staged)) throw Object.assign(new Error('EPERM: operation not permitted, the staged folder'), { code: 'EPERM' });
      return realRm.call(this, p, ...rest);
    };
    let r;
    try { r = await win32apply.applyJournal(c.journal, sim.deps()); } finally { fs.rmSync = realRm; }
    assert.equal(r.outcome, 'updated', JSON.stringify(r));
    assert.ok(c.log.includes('left the staged folder for later (EPERM: EPERM: operation not permitted, the staged folder)'), c.log.join('\n'));
    assert.equal(fs.existsSync(path.join(c.work, win32update.DOWNLOAD_PART_NAME)), false, 'the next removal went on');
  }
});

/* ─── review round 5: a held or unreadable answer is never proof of anything ───────────────── */

const realReadFileSync = fs.readFileSync;
/** Every read of `target` (compared case-blind) fails with `code`, `shots` times (-1: until unfaultRead). */
function faultRead(target, code, shots) {
  const box = { left: shots, hits: 0 };
  const wanted = path.resolve(target).toLowerCase();
  fs.readFileSync = function faulty(p, ...rest) {
    if (box.left !== 0 && typeof p === 'string' && path.resolve(p).toLowerCase() === wanted) {
      box.left -= 1;
      box.hits += 1;
      throw Object.assign(new Error(`${code}: injected, read '${p}'`), { code });
    }
    return realReadFileSync.call(this, p, ...rest);
  };
  return box;
}
function unfaultRead() { fs.readFileSync = realReadFileSync; }

/** Every lstat of each of `targets` fails with `code`, `shots` times each (-1: until unfaultLstat). */
function faultLstatEach(targets, code, shots) {
  const boxes = new Map(targets.map((f) => [path.resolve(f).toLowerCase(), { left: shots, hits: 0 }]));
  fs.lstatSync = function faulty(p, ...rest) {
    const box = boxes.get(path.resolve(String(p)).toLowerCase());
    if (box && box.left !== 0) {
      box.left -= 1;
      box.hits += 1;
      throw Object.assign(new Error(`${code}: injected, lstat '${p}'`), { code });
    }
    return realLstatSync.call(this, p, ...rest);
  };
  return [...boxes.values()];
}

/**
 * A `--require` for the real logon shim: reads of KOSMOS_TEST_HELD_FILE fail with KOSMOS_TEST_HELD_CODE
 * (EBUSY when unset) KOSMOS_TEST_HELD_READS times (-1: always). They start only once something has been
 * renamed to KOSMOS_TEST_HOLD_AFTER_RENAME_TO, and only once KOSMOS_TEST_ARM_AFTER_READS_OF has been read
 * KOSMOS_TEST_ARM_AFTER_READS times, when those are set. A scanner, as the shim's process sees one.
 */
const HELD_READS_PRELOAD = path.join(SANDBOX, 'held-reads-preload.js');
fs.writeFileSync(HELD_READS_PRELOAD, `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const env = process.env;
const target = path.resolve(env.KOSMOS_TEST_HELD_FILE).toLowerCase();
const code = env.KOSMOS_TEST_HELD_CODE || 'EBUSY';
let left = Number(env.KOSMOS_TEST_HELD_READS);
const after = env.KOSMOS_TEST_HOLD_AFTER_RENAME_TO ? path.resolve(env.KOSMOS_TEST_HOLD_AFTER_RENAME_TO).toLowerCase() : null;
const armOf = env.KOSMOS_TEST_ARM_AFTER_READS_OF ? path.resolve(env.KOSMOS_TEST_ARM_AFTER_READS_OF).toLowerCase() : null;
const armAfter = Number(env.KOSMOS_TEST_ARM_AFTER_READS || 0);
let renamed = !after;
let armReads = 0;
if (after) {
  const realRename = fs.renameSync;
  fs.renameSync = function watched(from, to) {
    const r = realRename.apply(this, arguments);
    if (path.resolve(String(to)).toLowerCase() === after) renamed = true;
    return r;
  };
}
const realRead = fs.readFileSync;
fs.readFileSync = function held(p, ...rest) {
  if (typeof p === 'string') {
    const r = path.resolve(p).toLowerCase();
    if (renamed && (!armOf || armReads >= armAfter) && left !== 0 && r === target) {
      if (left > 0) left -= 1;
      throw Object.assign(new Error(code + ': injected by the test, open ' + p), { code });
    }
    if (armOf && r === armOf) armReads += 1;
  }
  return realRead.call(this, p, ...rest);
};
`);

const endsOf = (sim) => sim.calls.filter((call) => call.startsWith('/End'));
const lockOf = (c) => path.join(c.work, win32update.LOCK_NAME);

/** A rollback left unfinished at `rolling-back` with the new build still in ROOT: the helper died at H8. */
async function rollbackLeftAtH8(c, o = {}) {
  stage(c);
  const sim = playBoard(c, { newNeverStarts: true });
  await assert.rejects(win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step, d) => {
    /* `appOut`: the update failed just before H4 moved `app` in, so the Kosmos folder has no app. */
    if (o.appOut && step === 'H4' && d && d.entry === 'app') throw new Error('failed before H4 moved app in');
    if (step === 'H8') throw new Error('the helper died at H8');
  } } })), /the helper died at H8/);
  const j = readJson(c.journal);
  assert.equal(j.phase, 'rolling-back', 'the control: left mid-rollback');
  assert.equal(j.finished, false);
  return sim;
}

test('ROUND 5 BUG 2 (P1): a lock held for about a second during H4 (EBUSY, or EIO from a share) is waited out, and the update goes in with no rollback', T, async () => {
  const shots = Math.ceil(1000 / win32apply.OWNER_READ_BUDGET.waitMs);
  assert.ok(shots < win32apply.OWNER_READ_BUDGET.tries, 'the control: a second is inside the budget');
  for (const code of ['EBUSY', 'EIO']) {
    const c = freshInstall();
    stage(c);
    const sim = playBoard(c);
    let fault = null;
    let r;
    try {
      r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step, d) => {
        if (step === 'H4' && d.entry === 'bin' && !fault) fault = faultRead(lockOf(c), code, shots);
      } } }));
    } finally {
      unfaultRead();
    }
    assert.equal(fault.hits, shots, `${code}: the control: the lock was unreadable for about a second`);
    assert.equal(r.outcome, 'updated', `${code}: ${JSON.stringify(r)}\n${c.log.join('\n')}`);
    assert.deepEqual(endsOf(sim), ['/End /TN Kosmos\\board'], `${code}: only H2's stop`);
    assert.equal(readJson(c.journal).steps.some((s) => String(s.step).startsWith('H8')), false, `${code}: nothing was reversed`);
    assert.equal(readJson(c.statusAt).outcome, 'updated', code);
  }
});

test('ROUND 5 BUG 2: a lock unreadable for longer than the helper\'s budget in the forward steps still rolls back', T, async () => {
  const c = freshInstall();
  stage(c);
  const before = installState(c);
  const sim = playBoard(c);
  let fault = null;
  let r;
  try {
    r = await win32apply.applyJournal(c.journal, sim.deps({
      hooks: { before: (step, d) => { if (step === 'H4' && d.entry === 'bin' && !fault) fault = faultRead(lockOf(c), 'EBUSY', -1); } },
      log: (line) => { c.log.push(line); if (line.startsWith('the update failed during ')) unfaultRead(); },
    }));
  } finally {
    unfaultRead();
  }
  assert.equal(fault.hits, win32apply.OWNER_READ_BUDGET.tries, 'the control: unreadable for the whole budget');
  assertRolledBack(c, before, sim, r, 'past the budget');
});

test('ROUND 5 BUG 2 (P2): a lock unreadable right after H7 confirmed the new board is never a reason to roll back; the helper records it once the lock reads again', T, async () => {
  const c = freshInstall();
  stage(c);
  const sim = playBoard(c);
  const baseProbe = sim.deps().probe;
  let fault = null;
  let r;
  try {
    r = await win32apply.applyJournal(c.journal, sim.deps({ probe: async (port) => {
      const answer = await baseProbe(port);
      if (!fault && win32apply.answersAs(answer, NEW_ID)) fault = faultRead(lockOf(c), 'EBUSY', win32apply.OWNER_READ_BUDGET.tries + 2);
      return answer;
    } }));
  } finally {
    unfaultRead();
  }
  assert.equal(fault.hits, win32apply.OWNER_READ_BUDGET.tries + 2, 'the control: past one whole budget');
  assert.equal(r.outcome, 'updated', JSON.stringify(r) + '\n' + c.log.join('\n'));
  assert.deepEqual(endsOf(sim), ['/End /TN Kosmos\\board'], 'the confirmed board was never stopped');
  assert.equal(sim.identity, NEW_ID);
  const j = readJson(c.journal);
  assert.equal(j.outcome, 'updated');
  assert.equal(j.steps.filter((s) => s.step === 'phase' && s.phase === 'confirmed').length, 1, 'confirmed is recorded once, not once per try');
  assert.equal(j.steps.some((s) => String(s.step).startsWith('H8')), false);
  assert.equal(readJson(c.statusAt).outcome, 'updated');
});

test('ROUND 5 BUG 2 (P2): past the patience the helper still reports updated and leaves `starting`; the next resume helper sees the new board answer and finishes it forward, never rolling it back', T, async () => {
  const c = freshInstall();
  stage(c);
  const sim = playBoard(c);
  const baseProbe = sim.deps().probe;
  let fault = null;
  let r;
  try {
    r = await win32apply.applyJournal(c.journal, sim.deps({ probe: async (port) => {
      const answer = await baseProbe(port);
      if (!fault && win32apply.answersAs(answer, NEW_ID)) fault = faultRead(lockOf(c), 'EBUSY', -1);
      return answer;
    } }));
  } finally {
    unfaultRead();
  }
  assert.equal(r.ok, true, JSON.stringify(r) + '\n' + c.log.join('\n'));
  assert.equal(r.outcome, 'updated');
  assert.ok(c.log.some((line) => line.startsWith(`the board answers as ${NEW_ID}, but that could not be recorded`)), c.log.join('\n'));
  const left = readJson(c.journal);
  assert.equal(left.phase, 'starting', 'the confirmation could not be recorded');
  assert.equal(left.finished, false);
  assert.equal(fs.existsSync(c.statusAt), false);
  assert.deepEqual(endsOf(sim), ['/End /TN Kosmos\\board'], 'the helper never stopped the confirmed board');
  const resumed = await win32apply.resumeJournal(c.journal, sim.deps());
  assert.equal(resumed.outcome, 'updated', JSON.stringify(resumed) + '\n' + c.log.join('\n'));
  assert.deepEqual(endsOf(sim), ['/End /TN Kosmos\\board'], 'nor did the resume helper');
  assert.equal(sim.identity, NEW_ID);
  const j = readJson(c.journal);
  assert.equal(j.finished, true);
  assert.equal(j.outcome, 'updated');
  assert.equal(readJson(c.statusAt).outcome, 'updated');
});

test('ROUND 5 BUG 1 (P3): recovery files that answer EPERM are asked again; for good, they hold the helper\'s rollback, and a later boot rolls it back', T, async () => {
  for (const shots of [1, -1]) {
    const c = freshInstall();
    const j0 = stage(c);
    const before = installState(c);
    const sim = playBoard(c, { newNeverStarts: true });
    let boxes = null;
    let r;
    try {
      r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step, d) => {
        if (step === 'H7-run' && d.run === 3 && !boxes) boxes = faultLstatEach(j0.recoverFrom, 'EPERM', shots);
      } } }));
    } finally {
      unfaultLstat();
    }
    assert.ok(boxes.every((b) => b.hits >= 1), `${shots}: the control: every recovery file answered EPERM`);
    if (shots === 1) {
      assertRolledBack(c, before, sim, r, 'EPERM once, asked again');
      continue;
    }
    assert.equal(r.outcome, 'held', JSON.stringify(r) + '\n' + c.log.join('\n'));
    assert.equal(r.because, 'no copy of the updater that could put it back can be read right now (code=EPERM)');
    const j = readJson(c.journal);
    assert.equal(j.finished, false, 'never settled as abandoned');
    assert.equal(fs.existsSync(c.statusAt), false);
    assert.deepEqual(endsOf(sim), ['/End /TN Kosmos\\board'], 'no reversal began');
    assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'rolled-back', c.log.join('\n'));
    assert.deepEqual(installState(c), before);
  }
});

test('ROUND 5 BUG 1 (P3b): a boot resumer whose recovery files stay unreadable (an access denied) holds; once they read, it rolls back', T, async () => {
  const c = freshInstall();
  const before = installState(c);
  const sim = await rollbackLeftAtH8(c);
  const j0 = readJson(c.journal);
  let boot;
  try {
    faultLstatEach(j0.recoverFrom, 'EPERM', -1);
    boot = win32apply.recoverAtBoot(c.journal, sim.deps());
  } finally {
    unfaultLstat();
  }
  assert.deepEqual(boot, { action: 'unreachable', because: 'no copy of the updater that could put it back can be read right now (code=EPERM)' });
  assert.deepEqual(readJson(c.journal), j0, 'the journal is left as it was');
  assert.equal(fs.existsSync(c.statusAt), false);
  assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'rolled-back', c.log.join('\n'));
  assert.deepEqual(installState(c), before);
});

test('ROUND 5 BUG 3 (P4): a boot recovery held with no whole app in the Kosmos folder names the whole old app to start; held once the old app is back, it names none', T, async () => {
  for (const [label, heldAt, expectBootFrom] of [['app out, old app not in', 'app', true], ['old app back', 'bin', false]]) {
    const c = freshInstall();
    const before = installState(c);
    const sim = await rollbackLeftAtH8(c);
    let boot;
    try {
      boot = win32apply.recoverAtBoot(c.journal, sim.deps({ hooks: { before: (step, d) => {
        if (step === 'H8-H3' && d.entry === heldAt) faultRead(lockOf(c), 'EBUSY', -1);
      } } }));
    } finally {
      unfaultRead();
    }
    assert.equal(boot.action, 'held', `${label}: ${JSON.stringify(boot)}\n${c.log.join('\n')}`);
    if (expectBootFrom) {
      assert.equal(fs.existsSync(path.join(c.root, 'app')), false, `${label}: the control: no app in the Kosmos folder`);
      assert.equal(boot.bootFrom, path.join(c.previous, 'app', 'server.js'), label);
    } else {
      assert.equal(readJson(path.join(c.root, 'app', 'package.json')).version, OLD, `${label}: the control: the old app is back`);
      assert.equal(boot.bootFrom, undefined, label);
    }
    assert.equal(readJson(c.journal).finished, false, label);
    assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'rolled-back', label);
    assert.deepEqual(installState(c), before, label);
  }
});

test('ROUND 5 BUG 3 (P4): the real logon shim starts the whole old app from previous when its recovery is held mid-rollback, and puts it back at the next start', WIN32_ONLY_LONG, () => {
  const c = freshInstall();
  const before = installState(c);
  stage(c);
  crashAt(c, 'before H8', { newNeverStarts: true });
  const held = bootShim(c, { preload: HELD_READS_PRELOAD, env: {
    KOSMOS_TEST_HELD_FILE: lockOf(c), KOSMOS_TEST_HELD_READS: '-1', KOSMOS_TEST_HOLD_AFTER_RENAME_TO: path.join(c.staged, 'app'),
  } });
  assert.equal(held.status, 0, held.stderr);
  assert.match(held.stderr, /not recovered at start \(held: /);
  assert.match(held.stderr, /starting the previous version from /);
  assert.equal(held.booted, `booted ${OLD} by Kosmos\\board`, held.stderr);
  assert.equal(held.from, path.join(c.previous, 'app'), 'the whole old app, from previous');
  assert.equal(readJson(c.journal).finished, false);
  const next = bootShim(c);
  assert.equal(next.booted, `booted ${OLD} by Kosmos\\board`, next.stderr);
  assert.equal(next.from, path.join(c.root, 'app'));
  assert.equal(readJson(c.journal).outcome, 'rolled-back');
  assertRolledBack(c, before, null, null, 'the next start');
});

test('ROUND 5 decision 8 and ROUND 6 F4: a journal a scanner holds when the logon shim starts is read again, for every held code, and the recovery still runs', WIN32_ONLY_LONG, () => {
  for (const code of win32update.HELD_FILE_CODES) {
    const c = freshInstall();
    const before = installState(c);
    stage(c);
    crashAt(c, 'before H8', { newNeverStarts: true });
    const boot = bootShim(c, { preload: HELD_READS_PRELOAD, env: { KOSMOS_TEST_HELD_FILE: c.journal, KOSMOS_TEST_HELD_READS: '3', KOSMOS_TEST_HELD_CODE: code } });
    assert.equal(boot.status, 0, `${code}: ${boot.stderr}`);
    assert.doesNotMatch(boot.stderr, /could not be recovered/, code);
    assert.equal(boot.booted, `booted ${OLD} by Kosmos\\board`, `${code}: ${boot.stderr}`);
    assert.equal(readJson(c.journal).outcome, 'rolled-back', code);
    assertRolledBack(c, before, null, null, `a journal held at boot with ${code}`);
  }
});

test('ROUND 5 decision 8: the logon shim\'s held read uses the updater\'s own codes and budget', T, () => {
  const src = win32board.BOOT_JS;
  const codes = /const HELD_CODES = (\[[^\]]*\]);/.exec(src);
  const tries = /tries >= (\d+)\) throw e;/.exec(src);
  const wait = /Atomics\.wait\(new Int32Array\(new SharedArrayBuffer\(4\)\), 0, 0, (\d+)\);/.exec(src);
  assert.ok(codes && tries && wait, 'the control: the shim has its held read');
  assert.deepEqual(JSON.parse(codes[1].replace(/'/g, '"')), [...win32update.HELD_FILE_CODES]);
  assert.equal(Number(tries[1]), win32apply.OWNER_READ_BUDGET.tries);
  assert.equal(Number(wait[1]), win32apply.OWNER_READ_BUDGET.waitMs);
  assert.ok(src.includes('JSON.parse(readHeld(journal))'), 'and the journal is read through it');
  assert.equal(win32apply.OWNER_READ_BUDGET.tries,
    1 + Math.ceil((win32apply.DEFAULT_APPLY_LIMITS.rollbackPasses * win32apply.DEFAULT_APPLY_LIMITS.rollbackPassWaitMs) / win32apply.DEFAULT_APPLY_LIMITS.stopPollMs));
  assert.equal(win32apply.CONFIRMED_RECORD_PATIENCE_MS, win32apply.DEFAULT_APPLY_LIMITS.confirmRuns * win32apply.DEFAULT_APPLY_LIMITS.confirmWaitPerRunMs);
});

test('ROUND 5 NIT 4 (P6): a lock another owner took, unreadable past the budget in the forward steps: nothing reaches WORK\'s log while unknown, then the loss is proved', T, async () => {
  const c = freshInstall();
  stage(c);
  const sim = playBoard(c);
  let fault = null;
  let r;
  try {
    r = await win32apply.applyJournal(c.journal, sim.deps({ log: undefined, hooks: { before: (step, d) => {
      if (step === 'H4' && d.entry === 'bin' && !fault) {
        fs.writeFileSync(lockOf(c), JSON.stringify({ pid: 4242, at: clock, token: 'another owner' }));
        fault = faultRead(lockOf(c), 'EBUSY', win32apply.OWNER_READ_BUDGET.tries);
      }
    } } }));
  } finally {
    unfaultRead();
  }
  assert.equal(fault.hits, win32apply.OWNER_READ_BUDGET.tries, 'the control: unreadable for the whole budget');
  assert.equal(r.outcome, 'taken-over', JSON.stringify(r));
  const logText = readText(path.join(c.work, win32apply.APPLY_LOG_NAME)) || '';
  assert.match(logText, /phase moving-in/, 'the control: the log was written before the hold');
  assert.doesNotMatch(logText, /failed during|stopped without/, 'nothing after it');
  assert.deepEqual(endsOf(sim), ['/End /TN Kosmos\\board'], 'and no stop for a rollback it did not own');
});

test('ROUND 5 NIT 5 (P5): with the record still being finished, B0 says the update worked, and --apply --wait counts the confirmed journal whose new board answers', T, async () => {
  const c = freshInstall();
  stage(c);
  const sim = playBoard(c);
  let r;
  try {
    r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step) => { if (step === 'H9') faultRead(lockOf(c), 'EBUSY', -1); } } }));
  } finally {
    unfaultRead();
  }
  assert.equal(r.outcome, 'updated', JSON.stringify(r));
  const j = readJson(c.journal);
  assert.equal(j.phase, 'confirmed', 'the control: the record is not finished');
  assert.equal(j.finished, false);
  assert.equal(fs.existsSync(c.statusAt), false);
  assert.equal(win32apply.unfinishedUpdateRefusal(c.anchor), `Kosmos has updated to ${NEW} and is finishing up. Try again in a minute`);
  const seams = (probe) => ({ probe, now: () => clock, sleep: async (ms) => { clock += ms; }, waitMs: 5000 });
  const done = await win32update.waitForOutcome(c.journal, j.token, seams(sim.deps().probe));
  assert.equal(done.outcome, 'updated', JSON.stringify(done));
  assert.equal(done.version, NEW);
  const silent = await win32update.waitForOutcome(c.journal, j.token, seams(async () => ({ answering: false, identity: null })));
  assert.equal(silent.outcome, null, 'the control: with no board answering, it is not a success');
  const other = await win32update.waitForOutcome(c.journal, j.token, seams(async () => ({ answering: true, identity: OLD_ID })));
  assert.equal(other.outcome, null, 'nor with the old board answering');
});

test('ROUND 5 sweep: a node.exe a scanner holds at H5 is still there, so the rollback puts its exact bytes back instead of leaving no interpreter', T, async () => {
  const c = freshInstall();
  stage(c);
  const before = installState(c);
  const sim = playBoard(c, { newNeverStarts: true });
  let fault = null;
  let r;
  try {
    r = await win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step) => {
      if (step === 'H5' && !fault) fault = faultLstat(path.join(c.anchor, win32anchor.NODE_NAME), 'EBUSY', 1);
    } } }));
  } finally {
    unfaultLstat();
  }
  assert.equal(fault.hits, 1, 'the control: node.exe answered EBUSY once');
  assert.notEqual(readJson(c.journal).interpreter.beforeSha256, null, 'recorded as there');
  assertRolledBack(c, before, sim, r, 'a held node.exe at H5');
});

test('ROUND 5 sweep: the staged journal records an entry a scanner holds as present, and refuses when it stays unknown', T, () => {
  const c = freshInstall();
  let fault;
  try {
    fault = faultLstat(path.join(c.root, 'bin'), 'EBUSY', 1);
    assert.ok(stage(c).presentBefore.includes('bin'));
  } finally {
    unfaultLstat();
  }
  assert.equal(fault.hits, 1, 'the control: bin answered EBUSY once');
  fs.rmSync(c.journal, { force: true });
  try {
    faultLstat(path.join(c.root, 'bin'), 'EBUSY', -1);
    assert.throws(() => stage(c), /bin cannot be checked right now \(code=EBUSY\)/);
  } finally {
    unfaultLstat();
  }
  assert.equal(fs.existsSync(c.journal), false, 'no journal was written');
});

test('ROUND 5 sweep: a rollback that cannot read the engine pointer back is never called whole: stuck and unfinished, and the next start finishes it', T, async () => {
  const c = freshInstall();
  const before = installState(c);
  const sim = await rollbackLeftAtH8(c);
  let boot;
  try {
    faultRead(path.join(c.anchor, win32anchor.POINTER_NAME), 'EBUSY', -1);
    boot = win32apply.recoverAtBoot(c.journal, sim.deps());
  } finally {
    unfaultRead();
  }
  /* The passes run out on the unreadable pointer (no deadline, round 7): stuck, in words. */
  assert.equal(boot.action, 'stuck', JSON.stringify(boot) + '\n' + c.log.join('\n'));
  assert.equal(boot.because, `${win32anchor.POINTER_NAME} cannot be read right now (code=EBUSY)`);
  assert.equal(readJson(c.statusAt).outcome, 'stuck', 'never a rolled-back status');
  assert.equal(readJson(c.journal).finished, false, 'never concluded as rolled back');
  {
    /* The resume helper the same: its passes run out on the unreadable pointer, stuck. */
    const c2 = freshInstall();
    const sim2 = await rollbackLeftAtH8(c2);
    let resumed;
    try {
      faultRead(path.join(c2.anchor, win32anchor.POINTER_NAME), 'EBUSY', -1);
      resumed = await win32apply.resumeJournal(c2.journal, sim2.deps());
    } finally {
      unfaultRead();
    }
    assert.equal(resumed.outcome, 'stuck', JSON.stringify(resumed) + '\n' + c2.log.join('\n'));
    assert.equal(resumed.because, `${win32anchor.POINTER_NAME} cannot be read right now (code=EBUSY)`);
    assert.equal(readJson(c2.statusAt).outcome, 'stuck', 'never a rolled-back status');
    assert.equal(readJson(c2.journal).finished, false);
  }
  assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'rolled-back', c.log.join('\n'));
  assert.deepEqual(installState(c), before);
});

test('ROUND 5 sweep: a helper that cannot read the Kosmos folder\'s version holds, writing nothing, instead of settling the update as not-started', T, async () => {
  const c = freshInstall();
  stage(c);
  const sim = playBoard(c);
  const staged = readJson(c.journal);
  let r;
  try {
    faultRead(path.join(c.root, 'app', 'package.json'), 'EBUSY', -1);
    r = await win32apply.applyJournal(c.journal, sim.deps());
  } finally {
    unfaultRead();
  }
  assert.equal(r.outcome, 'held', JSON.stringify(r));
  assert.equal(r.because, 'the update was not started, because package.json cannot be read right now (code=EBUSY)');
  assert.deepEqual(readJson(c.journal), staged, 'the staged journal is untouched');
  assert.equal(fs.existsSync(c.statusAt), false);
  assert.deepEqual(sim.calls, [], 'the board was not stopped');
});

/* ─── review round 6 ──────────────────────────────────────────────────────────────────────── */

/** Reads of `target` fail with `code` for good, once `armFile` has been read `afterReads` times. */
function faultReadAfterReadsOf(armFile, afterReads, target, code) {
  const box = { hits: 0, armReads: 0 };
  const arm = path.resolve(armFile).toLowerCase();
  const wanted = path.resolve(target).toLowerCase();
  fs.readFileSync = function faulty(p, ...rest) {
    if (typeof p === 'string') {
      const r = path.resolve(p).toLowerCase();
      if (r === wanted && box.armReads >= afterReads) {
        box.hits += 1;
        throw Object.assign(new Error(`${code}: injected, read '${p}'`), { code });
      }
      if (r === arm) box.armReads += 1;
    }
    return realReadFileSync.call(this, p, ...rest);
  };
  return box;
}

/** A helper that died at H9: the journal is left at `confirmed`, the new build serving. */
async function confirmedLeftAtH9(c) {
  stage(c);
  const sim = playBoard(c);
  await assert.rejects(win32apply.applyJournal(c.journal, sim.deps({ hooks: { before: (step) => {
    if (step === 'H9') throw new Error('the helper died at H9');
  } } })), /the helper died at H9/);
  assert.equal(readJson(c.journal).phase, 'confirmed', 'the control: left at confirmed');
  return sim;
}

test('ROUND 6 F1 (PROBE6-A): a confirmed update whose lock cannot be read at boot is held with no app named, and the real shim starts the confirmed new build', WIN32_ONLY_LONG, async () => {
  {
    const c = freshInstall();
    const sim = await confirmedLeftAtH9(c);
    let boot;
    let fault;
    try {
      fault = faultReadAfterReadsOf(c.journal, 2, lockOf(c), 'EBUSY');
      boot = win32apply.recoverAtBoot(c.journal, sim.deps());
    } finally {
      unfaultRead();
    }
    assert.ok(fault.hits >= 1, 'the control: the lock was unreadable under the lock');
    assert.equal(boot.action, 'held', JSON.stringify(boot) + '\n' + c.log.join('\n'));
    assert.equal(boot.bootFrom, undefined, 'no app is named for a confirmed update');
    assert.equal(boot.bootFromWhyNot, undefined);
    assert.equal(readJson(path.join(c.root, 'app', 'package.json')).version, NEW, 'the control: the Kosmos folder has the new build');
    assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'updated', 'finished forward once the lock reads');
  }
  {
    const c = freshInstall();
    stage(c);
    crashAt(c, 'before H9');
    assert.equal(readJson(c.journal).phase, 'confirmed', 'the control: left at confirmed');
    const boot = bootShim(c, { preload: HELD_READS_PRELOAD, env: {
      KOSMOS_TEST_HELD_FILE: lockOf(c), KOSMOS_TEST_HELD_READS: '-1', KOSMOS_TEST_ARM_AFTER_READS_OF: c.journal, KOSMOS_TEST_ARM_AFTER_READS: '3',
    } });
    assert.equal(boot.status, 0, boot.stderr);
    assert.match(boot.stderr, /not recovered at start \(held: /);
    assert.doesNotMatch(boot.stderr, /starting the previous version/);
    assert.equal(boot.booted, `booted ${NEW} by Kosmos\\board`, boot.stderr);
    assert.equal(boot.from, path.join(c.root, 'app'));
    assert.equal(readJson(c.journal).finished, false);
  }
});

test('ROUND 6 F1: a held boot may name the old app only before confirmed, or once a rollback of it began; at confirmed never', T, () => {
  const allowed = (extra) => win32apply.PHASES.filter((phase) => win32apply.previousAppMayBoot({ phase, ...extra }));
  assert.deepEqual(allowed({}), win32apply.PHASES.filter((phase) => phase !== 'confirmed'));
  assert.deepEqual(allowed({ rolledBackFrom: 'starting' }), [...win32apply.PHASES], 'a rollback that began from confirmed');
});

test('ROUND 6 F2 (PROBE6-B): a journal write held after H7 is tried again within the patience: confirmed is recorded, and a later boot has nothing to do', T, async () => {
  const c = freshInstall();
  stage(c);
  const sim = playBoard(c);
  const baseProbe = sim.deps().probe;
  const realRename = fs.renameSync;
  const journalAt = path.resolve(c.journal).toLowerCase();
  /* More failed renames than one write's own retries (win32swap.renameWithRetry), so the helper's
     patience, not the rename's, is what records `confirmed`. */
  const box = { armed: false, hits: 0, limit: 15 };
  let r;
  try {
    r = await win32apply.applyJournal(c.journal, sim.deps({ probe: async (port) => {
      const answer = await baseProbe(port);
      if (!box.armed && win32apply.answersAs(answer, NEW_ID)) {
        box.armed = true;
        fs.renameSync = function held(from, to) {
          if (box.hits < box.limit && path.resolve(String(to)).toLowerCase() === journalAt) {
            box.hits += 1;
            throw Object.assign(new Error('EBUSY: injected rename'), { code: 'EBUSY' });
          }
          return realRename.apply(this, arguments);
        };
      }
      return answer;
    } }));
  } finally {
    fs.renameSync = realRename;
  }
  assert.equal(box.hits, box.limit, 'the control: the journal write was held');
  assert.equal(r.outcome, 'updated', JSON.stringify(r) + '\n' + c.log.join('\n'));
  const j = readJson(c.journal);
  assert.equal(j.finished, true, c.log.join('\n'));
  assert.equal(j.outcome, 'updated');
  assert.equal(readJson(c.statusAt).outcome, 'updated');
  assert.deepEqual(endsOf(sim), ['/End /TN Kosmos\\board']);
  assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'nothing', 'a later boot has nothing to do');
});

test('ROUND 6 F2: a journal write held past the patience: the helper still reports updated and leaves starting, the documented residual a later boot rolls back', T, async () => {
  const c = freshInstall();
  stage(c);
  const before = installState(c);
  const sim = playBoard(c);
  const baseProbe = sim.deps().probe;
  const realRename = fs.renameSync;
  const journalAt = path.resolve(c.journal).toLowerCase();
  const box = { armed: false, hits: 0 };
  let r;
  try {
    r = await win32apply.applyJournal(c.journal, sim.deps({
      limits: { recordPatienceMs: 2 * win32apply.DEFAULT_APPLY_LIMITS.stopPollMs },
      probe: async (port) => {
        const answer = await baseProbe(port);
        if (!box.armed && win32apply.answersAs(answer, NEW_ID)) {
          box.armed = true;
          fs.renameSync = function held(from, to) {
            if (box.armed && path.resolve(String(to)).toLowerCase() === journalAt) {
              box.hits += 1;
              throw Object.assign(new Error('EBUSY: injected rename'), { code: 'EBUSY' });
            }
            return realRename.apply(this, arguments);
          };
        }
        return answer;
      },
      log: (line) => { c.log.push(line); if (line.includes('but that could not be recorded')) { box.armed = false; fs.renameSync = realRename; } },
    }));
  } finally {
    fs.renameSync = realRename;
  }
  assert.equal(r.outcome, 'updated', JSON.stringify(r) + '\n' + c.log.join('\n'));
  assert.ok(c.log.some((line) => line.includes('but that could not be recorded (HeldWrite: the journal cannot be written right now (code=EBUSY))')), c.log.join('\n'));
  const left = readJson(c.journal);
  assert.equal(left.phase, 'starting');
  assert.equal(left.finished, false);
  assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'rolled-back', 'the documented residual');
  assertRolledBack(c, before, null, null, 'past the patience');
});

test('ROUND 6 F3 (PROBE6-C): a journal that cannot be read again under the lock is held, never nothing, for every resumer; the real shim starts the whole old app and leaves the journal unfinished', WIN32_ONLY_LONG, async () => {
  {
    const c = freshInstall();
    const before = installState(c);
    const sim = await rollbackLeftAtH8(c);
    let boot;
    try {
      faultReadAfterReadsOf(c.journal, 1, c.journal, 'EBUSY');
      boot = win32apply.recoverAtBoot(c.journal, sim.deps());
    } finally {
      unfaultRead();
    }
    assert.equal(boot.action, 'held', JSON.stringify(boot));
    assert.equal(boot.because, 'its journal cannot be read right now (code=EBUSY)');
    assert.equal(boot.bootFrom, path.join(c.previous, 'app', 'server.js'), 'the new build was never confirmed');
    assert.equal(readJson(c.journal).finished, false);
    assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'rolled-back');
    assert.deepEqual(installState(c), before);
  }
  {
    const c = freshInstall();
    const sim = await rollbackLeftAtH8(c);
    let resumed;
    try {
      faultReadAfterReadsOf(c.journal, 1, c.journal, 'EBUSY');
      resumed = await win32apply.resumeJournal(c.journal, sim.deps());
    } finally {
      unfaultRead();
    }
    assert.deepEqual(resumed, { ok: true, action: 'held', because: 'its journal cannot be read right now (code=EBUSY)' });
    assert.equal(readJson(c.journal).finished, false);
  }
  {
    const c = freshInstall();
    stage(c);
    const staged = readJson(c.journal);
    const sim = playBoard(c);
    let r;
    try {
      faultReadAfterReadsOf(c.journal, 1, c.journal, 'EBUSY');
      r = await win32apply.applyJournal(c.journal, sim.deps());
    } finally {
      unfaultRead();
    }
    assert.equal(r.outcome, 'held', JSON.stringify(r));
    assert.equal(r.because, 'the update was not started, because its journal cannot be read right now (code=EBUSY)');
    assert.deepEqual(readJson(c.journal), staged);
    assert.deepEqual(sim.calls, []);
  }
  {
    const c = freshInstall();
    stage(c);
    const staged = readJson(c.journal);
    let r;
    try {
      faultReadAfterReadsOf(c.journal, 1, c.journal, 'EBUSY');
      r = win32apply.abandonStagedJournal(c.journal, 'no helper could be started', playBoard(c).deps());
    } finally {
      unfaultRead();
    }
    assert.deepEqual(r, { action: 'held', because: 'its journal cannot be read right now (code=EBUSY)' });
    assert.deepEqual(readJson(c.journal), staged);
  }
  {
    const c = freshInstall();
    const before = installState(c);
    stage(c);
    crashAt(c, 'before H8', { newNeverStarts: true });
    const boot = bootShim(c, { preload: HELD_READS_PRELOAD, env: {
      KOSMOS_TEST_HELD_FILE: c.journal, KOSMOS_TEST_HELD_READS: '-1', KOSMOS_TEST_ARM_AFTER_READS_OF: c.journal, KOSMOS_TEST_ARM_AFTER_READS: '2',
    } });
    assert.equal(boot.status, 0, boot.stderr);
    assert.match(boot.stderr, /not recovered at start \(held: its journal cannot be read right now \(code=EBUSY\)\)/);
    assert.equal(boot.booted, `booted ${OLD} by Kosmos\\board`, boot.stderr);
    assert.equal(boot.from, path.join(c.previous, 'app'), 'the whole old app, from previous');
    const j = readJson(c.journal);
    assert.equal(j.phase, 'rolling-back');
    assert.equal(j.finished, false);
    assert.equal(bootShim(c).booted, `booted ${OLD} by Kosmos\\board`);
    assertRolledBack(c, before, null, null, 'the next start');
  }
});

test('ROUND 6 F5 (PROBE6-D): B0 calls a journal it cannot read right now busy and asks to try again; only a journal that is not valid is named for removal by hand', T, () => {
  const c = freshInstall();
  stage(c);
  let sentence;
  try {
    faultRead(c.journal, 'EBUSY', -1);
    sentence = win32apply.unfinishedUpdateRefusal(c.anchor);
  } finally {
    unfaultRead();
  }
  assert.equal(sentence, `the record of an earlier update (${c.journal}) is busy right now (code=EBUSY), so the updater cannot read it yet. Try again in a minute`);
  fs.writeFileSync(c.journal, '{ torn');
  assert.equal(win32apply.unfinishedUpdateRefusal(c.anchor),
    `the record of an earlier update (${c.journal}) is not valid JSON, so the updater cannot tell whether that update finished. Remove that file by hand once Kosmos is working normally, then try again`);
});

test('ROUND 6 F6 (PROBE6-F): begin()\'s settlement and its abandoned staged journal, in the board process, wait only the quick budget on a held lock', T, () => {
  const quickMs = win32update.QUICK_HELD_READ_BUDGET.tries * win32update.QUICK_HELD_READ_BUDGET.waitMs;
  {
    const c = freshInstall();
    const j = stage(c);
    fs.writeFileSync(c.journal, JSON.stringify({ ...j, phase: 'moving-in' }));
    fs.rmSync(c.work, { recursive: true, force: true });
    const sim = playBoard(c);
    const t0 = clock;
    let r;
    let fault;
    try {
      fault = faultReadAfterReadsOf(c.journal, 2, lockOf(c), 'EBUSY');
      r = win32apply.settleUnrecoverableJournal(c.journal, sim.deps());
    } finally {
      unfaultRead();
    }
    assert.ok(fault.hits >= 1, 'the control: the lock was held');
    assert.equal(r.action, 'held', JSON.stringify(r));
    assert.ok(clock - t0 <= 2 * quickMs, `settlement waited ${clock - t0} ms`);
  }
  {
    const c = freshInstall();
    stage(c);
    const t0 = clock;
    let r;
    try {
      faultReadAfterReadsOf(c.journal, 2, lockOf(c), 'EBUSY');
      r = win32apply.abandonStagedJournal(c.journal, 'no helper could be started', playBoard(c).deps());
    } finally {
      unfaultRead();
    }
    assert.equal(r.action, 'held', JSON.stringify(r));
    assert.ok(clock - t0 <= 2 * quickMs, `abandon waited ${clock - t0} ms`);
  }
});

test('ROUND 7 A (PROBE6-E): an entry that answers EACCES for good at boot is asked about for the whole budget on every pass, then the recovery is stuck in words with the whole old app named; the next boot and the resume helper converge', T, async () => {
  for (const next of ['boot', 'resume']) {
    const c = freshInstall();
    const before = installState(c);
    const sim = await rollbackLeftAtH8(c);
    let boot;
    let fault;
    try {
      fault = faultLstat(path.join(c.root, 'bin'), 'EACCES', -1);
      boot = win32apply.recoverAtBoot(c.journal, sim.deps());
    } finally {
      unfaultLstat();
    }
    assert.ok(fault.hits >= win32apply.OWNER_READ_BUDGET.tries, `${next}: the control: asked for the whole budget (${fault.hits})`);
    assert.equal(boot.action, 'stuck', `${next}: ${JSON.stringify(boot)}\n${c.log.join('\n')}`);
    assert.equal(boot.bootFrom, path.join(c.previous, 'app', 'server.js'), `${next}: the whole old app is named`);
    assert.equal(readJson(c.journal).finished, false, next);
    if (next === 'boot') {
      assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'rolled-back', c.log.join('\n'));
      assert.deepEqual(installState(c), before);
    } else {
      const resumed = await win32apply.resumeJournal(c.journal, sim.deps());
      assertRolledBack(c, before, sim, resumed, 'the resume helper after a stuck boot');
    }
  }
});

/* ─── review round 7: no boot deadline, and no started-by-task requirement ─────────────────── */

test('ROUND 7 B: a board the launcher serves itself (started-by-task header 0) that answers as the new build confirms at H7, and the resume helper finishes forward on it; a board answering as the old build confirms nothing', T, async () => {
  {
    const c = freshInstall();
    const newTree = hashTree(c.staged);
    stage(c);
    const sim = playBoard(c, { launcherServed: true });
    const r = await win32apply.applyJournal(c.journal, sim.deps());
    assert.equal(r.outcome, 'updated', JSON.stringify(r) + '\n' + c.log.join('\n'));
    assert.deepEqual(hashTree(c.root, [c.work, path.join(c.root, 'Projects')]), newTree);
    assert.equal(sim.identity, NEW_ID);
    assert.equal(readJson(c.statusAt).outcome, 'updated');
  }
  {
    const c = freshInstall();
    const newTree = hashTree(c.staged);
    stage(c);
    crashAt(c, 'before H7-run #1');
    const sim = playBoard(c, { launcherServed: true });
    sim.running = false;
    sim.identity = null;
    win32board.runNow();
    assert.equal(sim.identity, NEW_ID, 'the control: the new build answers, served by the launcher');
    sim.calls.length = 0;
    const r = await win32apply.resumeJournal(c.journal, sim.deps());
    assert.equal(r.outcome, 'updated', JSON.stringify(r) + '\n' + c.log.join('\n'));
    assert.deepEqual(sim.calls, [], 'the confirmed board is left serving');
    assert.deepEqual(hashTree(c.root, [c.work, path.join(c.root, 'Projects')]), newTree);
  }
  {
    const c = freshInstall();
    const before = installState(c);
    stage(c);
    crashAt(c, 'before H7-run #1');
    const sim = playBoard(c, { launcherServed: true, answerAs: () => OLD_ID });
    sim.running = false;
    sim.identity = null;
    win32board.runNow();
    assert.equal(sim.identity, OLD_ID, 'the control: a board answering as the old build');
    sim.calls.length = 0;
    const r = await win32apply.resumeJournal(c.journal, sim.deps());
    assertRolledBack(c, before, sim, r, 'a board answering as the old build at starting');
    assert.deepEqual(sim.calls, ['/End /TN Kosmos\\board', '/Run /TN Kosmos\\board']);
  }
});

test('ROUND 7 A (P1): a slow boot recovery with nothing held (every hash taking 4 s) finishes rolled-back in one boot', T, async () => {
  const c = freshInstall();
  const before = installState(c);
  const sim = await rollbackLeftAtH8(c);
  const realSha = win32update.sha256OfFile;
  let hashes = 0;
  const t0 = clock;
  let boot;
  win32update.sha256OfFile = function slow(file) { hashes += 1; clock += 4000; return realSha(file); };
  try {
    boot = win32apply.recoverAtBoot(c.journal, sim.deps());
  } finally {
    win32update.sha256OfFile = realSha;
  }
  assert.equal(boot.action, 'rolled-back', JSON.stringify(boot) + '\n' + c.log.join('\n'));
  assert.ok(hashes >= 3, `the control: the recovery hashed ${hashes} times`);
  assert.ok(clock - t0 > 8000, `the control: longer than round 6's 8 s deadline allowed (${clock - t0} ms)`);
  assert.deepEqual(installState(c), before);
});

test('ROUND 7 A (P3b): the boot choice after a held recovery asks again within the budget, so a whole previous app is always named, never no app and never the unconfirmed build', T, async () => {
  for (const [label, heldAt] of [['the new app still in the Kosmos folder', 'H8-H4'], ['no app in the Kosmos folder', 'H8-H3']]) {
    const c = freshInstall();
    const sim = await rollbackLeftAtH8(c);
    const lockAt = path.resolve(lockOf(c)).toLowerCase();
    const packageAt = path.resolve(c.previous, 'app', 'package.json').toLowerCase();
    const box = { held: false, packageHits: 0 };
    fs.readFileSync = function faulty(p, ...rest) {
      if (typeof p === 'string' && box.held) {
        const r = path.resolve(p).toLowerCase();
        if (r === lockAt) throw Object.assign(new Error('EBUSY: injected, the lock'), { code: 'EBUSY' });
        if (r === packageAt && box.packageHits < 3) {
          box.packageHits += 1;
          throw Object.assign(new Error('EBUSY: injected, the old app'), { code: 'EBUSY' });
        }
      }
      return realReadFileSync.call(this, p, ...rest);
    };
    let boot;
    try {
      boot = win32apply.recoverAtBoot(c.journal, sim.deps({ hooks: { before: (step, d) => {
        if (step === heldAt && d.entry === 'app') box.held = true;
      } } }));
    } finally {
      unfaultRead();
    }
    assert.equal(boot.action, 'held', `${label}: ${JSON.stringify(boot)}\n${c.log.join('\n')}`);
    assert.equal(box.packageHits, 3, `${label}: the control: the old app's package.json was busy three times`);
    assert.equal(boot.bootFrom, path.join(c.previous, 'app', 'server.js'), `${label}: the whole old app is named`);
    assert.equal(readJson(c.journal).phase, 'rolling-back', label);
  }
});

test('ROUND 7 A (P2b): the lock release after a held recovery asks again within the budget, and releases once the hold clears', T, async () => {
  const c = freshInstall();
  const before = installState(c);
  const sim = await rollbackLeftAtH8(c);
  const shots = win32apply.OWNER_READ_BUDGET.tries + 5;
  let fault = null;
  let boot;
  try {
    boot = win32apply.recoverAtBoot(c.journal, sim.deps({ hooks: { before: (step, d) => {
      if (step === 'H8-H3' && d.entry === 'app' && !fault) fault = faultRead(lockOf(c), 'EBUSY', shots);
    } } }));
  } finally {
    unfaultRead();
  }
  assert.equal(boot.action, 'held', JSON.stringify(boot) + '\n' + c.log.join('\n'));
  assert.equal(fault.hits, shots, 'the control: the ownership check used its whole budget, and the release met 5 more');
  assert.equal(fs.existsSync(lockOf(c)), false, 'released, never left naming this live process');
  assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'rolled-back', c.log.join('\n'));
  assert.deepEqual(installState(c), before);
});

/* ─── review round 8: the held rule for writes ────────────────────────────────────────────── */

const realRenameSync = fs.renameSync;
/** Every rename onto `target` fails with EBUSY while `box.on()` says so (or always), `box.limit` times at most. */
function holdRenamesOnto(target, o = {}) {
  const box = { hits: 0, limit: o.limit === undefined ? Infinity : o.limit, on: o.on || (() => true), code: o.code || 'EBUSY' };
  const wanted = path.resolve(target).toLowerCase();
  fs.renameSync = function held(from, to) {
    if (box.on() && box.hits < box.limit && path.resolve(String(to)).toLowerCase() === wanted) {
      box.hits += 1;
      throw Object.assign(new Error(`${box.code}: injected, rename onto '${to}'`), { code: box.code });
    }
    return realRenameSync.apply(this, arguments);
  };
  return box;
}
function unholdRenames() { fs.renameSync = realRenameSync; }

/** A `--require` for the real logon shim: renames onto KOSMOS_TEST_RENAME_TARGET fail with EBUSY, and lstats
    of KOSMOS_TEST_LSTAT_TARGET with EACCES, for good. */
const HELD_WRITES_PRELOAD = path.join(SANDBOX, 'held-writes-preload.js');
fs.writeFileSync(HELD_WRITES_PRELOAD, `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const n = (p) => path.resolve(String(p)).toLowerCase();
const renameTarget = process.env.KOSMOS_TEST_RENAME_TARGET ? n(process.env.KOSMOS_TEST_RENAME_TARGET) : null;
const lstatTarget = process.env.KOSMOS_TEST_LSTAT_TARGET ? n(process.env.KOSMOS_TEST_LSTAT_TARGET) : null;
const realRename = fs.renameSync;
fs.renameSync = function held(from, to) {
  if (renameTarget && n(to) === renameTarget) throw Object.assign(new Error('EBUSY: injected by the test, rename onto ' + to), { code: 'EBUSY' });
  return realRename.apply(this, arguments);
};
const realLstat = fs.lstatSync;
fs.lstatSync = function held(p, ...rest) {
  if (lstatTarget && n(p) === lstatTarget) throw Object.assign(new Error('EACCES: injected by the test, lstat ' + p), { code: 'EACCES' });
  return realLstat.call(this, p, ...rest);
};
`);

test('ROUND 8 decisions 1 and 3 (W1, W2): a journal write held at boot mid-rollback is held with the whole old app named, in-process and in the real shim, never the unconfirmed build nor no board; the next start converges', WIN32_ONLY_LONG, async () => {
  for (const [label, appOut, crashPoint] of [['W1 the new app still in the Kosmos folder', false, 'before H8'], ['W2 no app in the Kosmos folder', true, 'before H4 app']]) {
    {
      const c = freshInstall();
      const before = installState(c);
      const sim = await rollbackLeftAtH8(c, { appOut });
      let boot;
      let box;
      try {
        box = holdRenamesOnto(c.journal);
        boot = win32apply.recoverAtBoot(c.journal, sim.deps());
      } finally {
        unholdRenames();
      }
      assert.ok(box.hits > 0, `${label}: the control: the journal write was held`);
      assert.equal(boot.action, 'held', `${label}: ${JSON.stringify(boot)}\n${c.log.join('\n')}`);
      assert.match(boot.because, /the journal cannot be written right now \(code=EBUSY\)/, label);
      assert.equal(boot.bootFrom, path.join(c.previous, 'app', 'server.js'), `${label}: the whole old app is named`);
      assert.equal(readJson(c.journal).finished, false, label);
      assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'rolled-back', `${label}: ${c.log.join('\n')}`);
      assert.deepEqual(installState(c), before, label);
    }
    {
      const c = freshInstall();
      const before = installState(c);
      stage(c);
      crashAt(c, crashPoint, { newNeverStarts: true });
      const held = bootShim(c, { preload: HELD_WRITES_PRELOAD, env: { KOSMOS_TEST_RENAME_TARGET: c.journal } });
      assert.equal(held.status, 0, `${label} real shim: ${held.stderr}`);
      assert.match(held.stderr, /not recovered at start \(held: /, label);
      assert.equal(held.booted, `booted ${OLD} by Kosmos\\board`, `${label} real shim: ${held.stderr}`);
      assert.equal(held.from, path.join(c.previous, 'app'), `${label}: the whole old app, from previous`);
      assert.equal(readJson(c.journal).finished, false, label);
      const next = bootShim(c);
      assert.equal(next.booted, `booted ${OLD} by Kosmos\\board`, `${label} next start: ${next.stderr}`);
      assertRolledBack(c, before, null, null, `${label}: the next start`);
    }
  }
});

test('ROUND 8 decision 3 (W3): a stuck boot recovery whose status write is held stays stuck with the whole old app named, in-process and in the real shim; the next start converges', WIN32_ONLY_LONG, async () => {
  {
    const c = freshInstall();
    const before = installState(c);
    const sim = await rollbackLeftAtH8(c);
    let boot;
    try {
      faultLstat(path.join(c.root, 'bin'), 'EACCES', -1);
      holdRenamesOnto(c.statusAt);
      boot = win32apply.recoverAtBoot(c.journal, sim.deps());
    } finally {
      unholdRenames();
      unfaultLstat();
    }
    assert.equal(boot.action, 'stuck', JSON.stringify(boot) + '\n' + c.log.join('\n'));
    assert.equal(boot.bootFrom, path.join(c.previous, 'app', 'server.js'));
    assert.equal(boot.statusHeld, 'the status cannot be written right now (code=EBUSY)');
    assert.equal(fs.existsSync(c.statusAt), false, 'the status was not recorded');
    const j = readJson(c.journal);
    assert.equal(j.phase, 'stuck');
    assert.equal(j.finished, false);
    assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'rolled-back', c.log.join('\n'));
    assert.deepEqual(installState(c), before);
  }
  {
    const c = freshInstall();
    const before = installState(c);
    stage(c);
    crashAt(c, 'before H8', { newNeverStarts: true });
    const held = bootShim(c, { preload: HELD_WRITES_PRELOAD, env: { KOSMOS_TEST_RENAME_TARGET: c.statusAt, KOSMOS_TEST_LSTAT_TARGET: path.join(c.root, 'bin') } });
    assert.equal(held.status, 0, held.stderr);
    assert.match(held.stderr, /not recovered at start \(stuck: /);
    assert.match(held.stderr, /starting the previous version from /);
    assert.equal(held.booted, `booted ${OLD} by Kosmos\\board`, held.stderr);
    assert.equal(held.from, path.join(c.previous, 'app'));
    assert.equal(readJson(c.journal).phase, 'stuck');
    const next = bootShim(c);
    assert.equal(next.booted, `booted ${OLD} by Kosmos\\board`, next.stderr);
    assertRolledBack(c, before, null, null, 'W3: the next start');
  }
});

test('ROUND 8 decisions 1 and 2 (W4): the helper\'s rollback tries a held journal write again within its budget; held past it, the helper ends held, starts the board it ended once, and the next boot converges', WIN32_ONLY_T, async () => {
  {
    /* Held for a rename window and a half: one try fails whole, the next succeeds, and the rollback goes on. */
    const c = freshInstall();
    stage(c);
    const before = installState(c);
    const sim = playBoard(c, { newNeverStarts: true });
    const box = { armed: false };
    let r;
    let hold;
    try {
      hold = holdRenamesOnto(c.journal, { on: () => box.armed, limit: 15 });
      r = await win32apply.applyJournal(c.journal, sim.deps({ log: (line) => { c.log.push(line); if (line.startsWith('the update failed during ')) box.armed = true; } }));
    } finally {
      unholdRenames();
    }
    assert.equal(hold.hits, 15, 'the control: the journal write was held');
    assertRolledBack(c, before, sim, r, 'a write held within the budget');
  }
  for (const appOut of [false, true]) {
    /* P1a: the new app still in the Kosmos folder, and no app in it. */
    const label = appOut ? 'no app in the Kosmos folder' : 'the new app in the Kosmos folder';
    const c = freshInstall();
    stage(c);
    const before = installState(c);
    const box = { armed: false, lockAtRun: null };
    const shims = [];
    const sim = playBoard(c, { newNeverStarts: true, onRun: () => {
      if (!box.armed) return;
      box.lockAtRun = fs.existsSync(lockOf(c));
      shims.push(bootShimAsync(c));
    } });
    let r;
    let hold;
    try {
      hold = holdRenamesOnto(c.journal, { on: () => box.armed });
      r = await win32apply.applyJournal(c.journal, sim.deps({
        log: (line) => { c.log.push(line); if (line.startsWith('the update failed during ')) box.armed = true; },
        hooks: { before: (step, d) => { if (appOut && step === 'H4' && d && d.entry === 'app') throw new Error('failed before H4 moved app in'); } },
      }));
    } finally {
      unholdRenames();
    }
    assert.ok(hold.hits > 0, `${label}: the control: the journal write was held`);
    assert.equal(r.outcome, 'held', `${label}: ${JSON.stringify(r)}\n${c.log.join('\n')}`);
    assert.match(r.because, /the journal cannot be written right now \(code=EBUSY\)/, label);
    assert.deepEqual(sim.calls.slice(sim.calls.lastIndexOf('/End /TN Kosmos\\board')), ['/End /TN Kosmos\\board', '/Run /TN Kosmos\\board'], `${label}: the board this helper ended is started once`);
    assert.equal(box.lockAtRun, false, `${label}: the /Run came after the lock was released`);
    assert.ok(c.log.includes('started the board again, so its logon shim finishes the update'), c.log.join('\n'));
    assert.equal(shims.length, 1, label);
    const shim = await shims[0];
    assert.equal(shim.status, 0, `${label}: ${shim.stderr}`);
    assert.equal(shim.booted, `booted ${OLD} by Kosmos\\board`, `${label}: never the unconfirmed build, never no board: ${shim.stderr}`);
    const next = bootShim(c);
    assert.equal(next.booted, `booted ${OLD} by Kosmos\\board`, `${label} next start: ${next.stderr}`);
    assertRolledBack(c, before, null, null, `${label}: after the shim`);
  }
});

test('ROUND 8 decision 2 (W5): the resume helper whose rollback meets a journal write held past its budget ends held and starts the board it ended once; the next boot converges', WIN32_ONLY_T, async () => {
  const c = freshInstall();
  const before = installState(c);
  stage(c);
  crashAt(c, 'before H7-run #1', { newNeverStarts: true });
  assert.equal(readJson(c.journal).phase, 'starting', 'the control: left at starting');
  const box = { armed: false, lockAtRun: null };
  const shims = [];
  const sim = playBoard(c, { newNeverStarts: true, onRun: () => {
    if (!box.armed) return;
    box.lockAtRun = fs.existsSync(lockOf(c));
    shims.push(bootShimAsync(c));
  } });
  let r;
  try {
    holdRenamesOnto(c.journal, { on: () => box.armed });
    r = await win32apply.resumeJournal(c.journal, sim.deps({ log: (line) => { c.log.push(line); if (line === 'the board is stopped') box.armed = true; } }));
  } finally {
    unholdRenames();
  }
  assert.equal(r.outcome, 'held', JSON.stringify(r) + '\n' + c.log.join('\n'));
  assert.deepEqual(sim.calls, ['/End /TN Kosmos\\board', '/Run /TN Kosmos\\board'], 'the board this resume helper ended is started once');
  assert.equal(box.lockAtRun, false, 'the /Run came after the lock was released');
  assert.equal(shims.length, 1);
  const shim = await shims[0];
  assert.equal(shim.status, 0, shim.stderr);
  assert.equal(shim.booted, `booted ${OLD} by Kosmos\\board`, shim.stderr);
  const next = bootShim(c);
  assert.equal(next.booted, `booted ${OLD} by Kosmos\\board`, next.stderr);
  assertRolledBack(c, before, null, null, 'after the shim the resume helper started');
});

test('ROUND 8 decision 4 and ROUND 9 decision 3 (P4): an error the helper cannot handle (ENOSPC on a journal write) is thrown as before, reaches update-apply.log, and after the lock is released the board it ended is started, whose real shim puts the old build back', WIN32_ONLY_T, async () => {
  const c = freshInstall();
  stage(c);
  const before = installState(c);
  const box = { armed: false, lockAtRun: null };
  const shims = [];
  /* Only the /Run after the rollback's stop (the second /End) is the post-exit restart. */
  const sim = playBoard(c, { newNeverStarts: true, onRun: (s) => {
    if (s.calls.filter((call) => call.startsWith('/End')).length < 2) return;
    box.lockAtRun = fs.existsSync(lockOf(c));
    shims.push(bootShimAsync(c));
  } });
  try {
    holdRenamesOnto(c.journal, { on: () => box.armed, code: 'ENOSPC' });
    await assert.rejects(win32apply.applyJournal(c.journal, sim.deps({ log: undefined, hooks: { before: (step, d) => {
      if (step === 'H7-run' && d.run === 3) box.armed = true;
    } } })), /ENOSPC/);
  } finally {
    unholdRenames();
  }
  const logText = readText(path.join(c.work, win32apply.APPLY_LOG_NAME)) || '';
  assert.match(logText, /the update stopped on an error it cannot handle \(ENOSPC: ENOSPC: injected, rename onto/);
  assert.match(logText, /started the board again, so its logon shim finishes the update/);
  assert.equal(sim.calls.filter((call) => call.startsWith('/Run')).length, 4, 'the three H7 runs, then one after the lock was released');
  assert.equal(sim.calls[sim.calls.length - 1], '/Run /TN Kosmos\\board');
  assert.equal(box.lockAtRun, false, 'the /Run came after the lock was released');
  assert.equal(shims.length, 1);
  const shim = await shims[0];
  assert.equal(shim.status, 0, shim.stderr);
  assert.equal(shim.booted, `booted ${OLD} by Kosmos\\board`, shim.stderr);
  const next = bootShim(c);
  assert.equal(next.booted, `booted ${OLD} by Kosmos\\board`, next.stderr);
  assertRolledBack(c, before, null, null, 'after the shim');
});

test('ROUND 8 sweep: begin()\'s journal write tries a held rename again within the quick budget, and refuses in words when it stays held', T, () => {
  const c = freshInstall();
  let hold;
  try {
    hold = holdRenamesOnto(c.journal, { limit: 10 });
    stage(c);
  } finally {
    unholdRenames();
  }
  assert.equal(hold.hits, 10, 'the control: one whole write was held');
  assert.equal(readJson(c.journal).phase, 'staged', 'written on the next try');
  try {
    holdRenamesOnto(c.journal);
    assert.throws(() => stage(c), /the update journal cannot be written right now \(code=EBUSY\)/);
  } finally {
    unholdRenames();
  }
});

/* ─── review round 9: the post-exit restart, after the lock's release ─────────────────────── */

test('ROUND 9 decision 1 (P1b): a rollback held because its lock cannot be read, whose release cannot free the lock either, issues no /Run and writes why the board was left stopped to update-apply.log; the next boot converges', T, async () => {
  const c = freshInstall();
  stage(c);
  const before = installState(c);
  const sim = playBoard(c, { newNeverStarts: true });
  let callsAtHold = null;
  let r;
  try {
    r = await win32apply.applyJournal(c.journal, sim.deps({ log: undefined, hooks: { before: (step) => {
      if (step === 'H8' && callsAtHold === null) { callsAtHold = sim.calls.length; faultRead(lockOf(c), 'EBUSY', -1); }
    } } }));
  } finally {
    unfaultRead();
  }
  assert.equal(r.outcome, 'held', JSON.stringify(r));
  assert.deepEqual(sim.calls.slice(callsAtHold), [], 'no /Run: a shim started now would meet this live process\'s lock');
  assert.ok(fs.existsSync(lockOf(c)), 'the control: the lock still names this process');
  const logText = readText(path.join(c.work, win32apply.APPLY_LOG_NAME)) || '';
  assert.match(logText, /the board was left stopped because the update lock could not be released; it will come back at the next sign-in or when Kosmos\.exe is opened/);
  assert.equal(readJson(c.journal).finished, false);
  assert.equal(win32apply.recoverAtBoot(c.journal, sim.deps()).action, 'rolled-back');
  assert.deepEqual(installState(c), before);
});

test('ROUND 9 decision 2 (P2): a rollback that waits on an unreachable working folder RETURNS held; after the lock is released the board it ended is started, and its real shim puts the old build back', WIN32_ONLY_T, async () => {
  const c = freshInstall();
  stage(c);
  const before = installState(c);
  const box = { armed: false, lockAtRun: null };
  const shims = [];
  const sim = playBoard(c, { newNeverStarts: true, onRun: () => {
    if (!box.armed) return;
    box.lockAtRun = fs.existsSync(lockOf(c));
    shims.push(bootShimAsync(c));
  } });
  let r;
  try {
    r = await win32apply.applyJournal(c.journal, sim.deps({
      log: (line) => { c.log.push(line); if (line.startsWith('the update failed during ') && !box.armed) { box.armed = true; faultLstat(c.work, 'EACCES', -1); } },
      hooks: { before: (step, d) => { if (step === 'H4' && d && d.entry === 'app') throw new Error('failed before H4 moved app in'); } },
    }));
  } finally {
    unfaultLstat();
  }
  assert.equal(r.outcome, 'held', JSON.stringify(r) + '\n' + c.log.join('\n'));
  assert.equal(r.action, 'held');
  assert.match(r.because, /cannot be reached right now \(code=EACCES\)/);
  assert.deepEqual(sim.calls, ['/End /TN Kosmos\\board', '/Run /TN Kosmos\\board'], 'H2\'s stop, then one /Run after the release');
  assert.equal(box.lockAtRun, false, 'the /Run came after the lock was released');
  assert.equal(shims.length, 1);
  const shim = await shims[0];
  assert.equal(shim.status, 0, shim.stderr);
  assert.equal(shim.booted, `booted ${OLD} by Kosmos\\board`, shim.stderr);
  const next = bootShim(c);
  assert.equal(next.booted, `booted ${OLD} by Kosmos\\board`, next.stderr);
  assertRolledBack(c, before, null, null, 'after the shim');
});

test('ROUND 9 decision 3 (P3): a helper rollback that ends stuck starts the board it ended after the lock is released, and its real shim puts the old build back', WIN32_ONLY_T, async () => {
  const c = freshInstall();
  stage(c);
  const before = installState(c);
  const box = { armed: false, lockAtRun: null };
  const shims = [];
  const sim = playBoard(c, { newNeverStarts: true, onRun: () => {
    if (!box.armed) return;
    box.lockAtRun = fs.existsSync(lockOf(c));
    shims.push(bootShimAsync(c));
  } });
  let r;
  try {
    r = await win32apply.applyJournal(c.journal, sim.deps({
      log: (line) => { c.log.push(line); if (line.startsWith('the update failed during ') && !box.armed) { box.armed = true; faultLstat(path.join(c.root, 'bin'), 'EACCES', -1); } },
    }));
  } finally {
    unfaultLstat();
  }
  assert.equal(r.outcome, 'stuck', JSON.stringify(r) + '\n' + c.log.join('\n'));
  assert.deepEqual(sim.calls.slice(sim.calls.lastIndexOf('/End /TN Kosmos\\board')), ['/End /TN Kosmos\\board', '/Run /TN Kosmos\\board'], 'one /Run after the release');
  assert.equal(box.lockAtRun, false, 'the /Run came after the lock was released');
  assert.equal(shims.length, 1);
  const shim = await shims[0];
  assert.equal(shim.status, 0, shim.stderr);
  assert.equal(shim.booted, `booted ${OLD} by Kosmos\\board`, shim.stderr);
  const next = bootShim(c);
  assert.equal(next.booted, `booted ${OLD} by Kosmos\\board`, next.stderr);
  assertRolledBack(c, before, null, null, 'after the shim');
});

/* ─── review round 10 ─────────────────────────────────────────────────────────────────────── */

test('ROUND 10 decision 1 (P8): an /End that stops the board but reports a failure still counts as ended: a run that then ends held starts the board once, after the lock is released, and its real shim puts the old build back', WIN32_ONLY_T, async () => {
  const c = freshInstall();
  stage(c);
  const before = installState(c);
  const box = { armed: false, lockAtRun: null };
  const shims = [];
  const sim = playBoard(c, { endFailsAfterStopping: true, onRun: () => {
    if (!box.armed) return;
    box.lockAtRun = fs.existsSync(lockOf(c));
    shims.push(bootShimAsync(c));
  } });
  let r;
  let hold;
  try {
    hold = holdRenamesOnto(c.journal, { on: () => box.armed });
    r = await win32apply.applyJournal(c.journal, sim.deps({ log: (line) => { c.log.push(line); if (line.startsWith('the update failed during ')) box.armed = true; } }));
  } finally {
    unholdRenames();
  }
  assert.ok(hold.hits > 0, 'the control: the rollback\'s journal write was held');
  assert.ok(c.log.some((l) => /end the board: we could not stop the board \(spawnSync schtasks\.exe ETIMEDOUT\)/.test(l)), 'the control: /End reported a failure\n' + c.log.join('\n'));
  assert.equal(r.outcome, 'held', JSON.stringify(r) + '\n' + c.log.join('\n'));
  assert.deepEqual(sim.calls, ['/End /TN Kosmos\\board', '/Run /TN Kosmos\\board'], 'the /End, then one /Run after the release');
  assert.equal(box.lockAtRun, false, 'the /Run came after the lock was released');
  assert.ok(c.log.includes('started the board again, so its logon shim finishes the update'), c.log.join('\n'));
  assert.equal(shims.length, 1);
  const shim = await shims[0];
  assert.equal(shim.status, 0, shim.stderr);
  assert.equal(shim.booted, `booted ${OLD} by Kosmos\\board`, shim.stderr);
  const next = bootShim(c);
  assert.equal(next.booted, `booted ${OLD} by Kosmos\\board`, next.stderr);
  assertRolledBack(c, before, null, null, 'after the shim');
});

test('ROUND 10 decision 3 (P9): an update abandoned after H2 ended the board (its recovery code gone) starts no board, and update-apply.log says why the board was left stopped', T, async () => {
  const c = freshInstall();
  stage(c);
  const sim = playBoard(c, { newNeverStarts: true });
  let removed = 0;
  const r = await win32apply.applyJournal(c.journal, sim.deps({ log: undefined, hooks: { before: (step, d) => {
    if (step === 'H7-run' && d.run === 3) for (const f of readJson(c.journal).recoverFrom) { fs.rmSync(f, { force: true }); removed += 1; }
  } } }));
  assert.ok(removed > 0, 'the control: the recovery code was removed');
  assert.equal(r.outcome, 'abandoned', JSON.stringify(r));
  assert.deepEqual(sim.calls, ['/End /TN Kosmos\\board', '/Run /TN Kosmos\\board', '/Run /TN Kosmos\\board', '/Run /TN Kosmos\\board'],
    'H2\'s /End and H7\'s three runs, and no /Run after them');
  const logText = readText(path.join(c.work, win32apply.APPLY_LOG_NAME)) || '';
  assert.match(logText, /the board was left stopped because this update was abandoned: nothing is left to recover it with, so no board was started; the next sign-in starts whatever the pointer names/);
});

test('ROUND 10 decision 2 (P10): a stuck rollback whose lock proves another update\'s at the release starts nothing, appends nothing more to WORK\'s log, and says so on stderr only', T, async () => {
  const c = freshInstall();
  stage(c);
  const sim = playBoard(c, { newNeverStarts: true });
  const logFile = path.join(c.work, win32apply.APPLY_LOG_NAME);
  const realAppend = fs.appendFileSync;
  const realStderrWrite = process.stderr.write;
  const stderr = [];
  const box = { armed: false, swapped: false, sizeAtSwap: null, fault: null };
  let r;
  try {
    process.stderr.write = function spy(chunk, ...rest) { stderr.push(String(chunk)); return realStderrWrite.call(this, chunk, ...rest); };
    fs.appendFileSync = function spy(p, data, ...rest) {
      const out = realAppend.call(this, p, data, ...rest);
      const line = String(data);
      if (!box.armed && line.includes('the update failed during ')) { box.armed = true; box.fault = faultLstat(path.join(c.root, 'bin'), 'EACCES', -1); }
      if (!box.swapped && line.includes('status stuck')) {
        box.swapped = true;
        fs.writeFileSync(lockOf(c), JSON.stringify({ pid: process.pid, at: 1, token: 'another-update' }));
        box.sizeAtSwap = fs.statSync(logFile).size;
      }
      return out;
    };
    r = await win32apply.applyJournal(c.journal, sim.deps({ log: undefined }));
  } finally {
    fs.appendFileSync = realAppend;
    process.stderr.write = realStderrWrite;
    unfaultLstat();
  }
  assert.ok(box.swapped, 'the control: the lock became another update\'s before the release');
  assert.equal(r.outcome, 'stuck', JSON.stringify(r));
  assert.equal(sim.calls[sim.calls.length - 1], '/End /TN Kosmos\\board', 'no /Run after the rollback\'s /End');
  assert.equal(fs.statSync(logFile).size, box.sizeAtSwap, `nothing more appended to WORK's log: ${readText(logFile).slice(box.sizeAtSwap)}`);
  assert.ok(stderr.some((s) => s.includes('another update now holds the update lock and owns recovery; this run started nothing')), stderr.join(''));
  assert.ok(fs.readFileSync(lockOf(c), 'utf8').includes('another-update'), 'the other update\'s lock is left standing');
});

test('ROUND 9 decision 3 (P5b): a rollback stuck on a held engine-path rename starts the board after the release; the real shim, meeting the same hold, starts the whole old app from previous; the next start converges', WIN32_ONLY_LONG, async () => {
  const c = freshInstall();
  stage(c);
  const before = installState(c);
  const pointerAt = path.join(c.anchor, win32anchor.POINTER_NAME);
  const box = { armed: false, lockAtRun: null };
  const shims = [];
  const sim = playBoard(c, { newNeverStarts: true, onRun: () => {
    if (!box.armed) return;
    box.lockAtRun = fs.existsSync(lockOf(c));
    shims.push(bootShimAsync(c, { preload: HELD_WRITES_PRELOAD, env: { KOSMOS_TEST_RENAME_TARGET: pointerAt } }));
  } });
  let r;
  try {
    holdRenamesOnto(pointerAt, { on: () => box.armed });
    r = await win32apply.applyJournal(c.journal, sim.deps({ log: (line) => { c.log.push(line); if (line.startsWith('the update failed during ')) box.armed = true; } }));
  } finally {
    unholdRenames();
  }
  assert.equal(r.outcome, 'stuck', JSON.stringify(r) + '\n' + c.log.join('\n'));
  assert.deepEqual(sim.calls.slice(sim.calls.lastIndexOf('/End /TN Kosmos\\board')), ['/End /TN Kosmos\\board', '/Run /TN Kosmos\\board']);
  assert.equal(box.lockAtRun, false, 'the /Run came after the lock was released');
  assert.equal(shims.length, 1);
  const shim = await shims[0];
  assert.equal(shim.status, 0, shim.stderr);
  assert.equal(shim.booted, `booted ${OLD} by Kosmos\\board`, shim.stderr);
  assert.equal(shim.from, path.join(c.previous, 'app'), 'the whole old app, from previous, while the pointer stays held');
  assert.equal(readJson(c.journal).phase, 'stuck');
  const next = bootShim(c);
  assert.equal(next.booted, `booted ${OLD} by Kosmos\\board`, next.stderr);
  assertRolledBack(c, before, null, null, 'the next start');
});

/* ─── S5 (#3017): a user-initiated rollback rides the same helper ─────────────────────────── */

/**
 * The rollback fixture is a forward install's mirror: ROOT holds the CURRENT (newer) build, and the
 * kept OLDER build sits in `staged` -- exactly where rollbackToPrevious renames previous-<old> to
 * before it starts this helper. from=NEW, to=OLD, rollback:true. The anchor runs the NEW interpreter,
 * so runtimeChanged is true and H5 restores the old one.
 */
function rollbackInstall(o = {}) {
  cases += 1;
  const dir = path.join(SANDBOX, 'cases', String(cases));
  const root = path.join(dir, 'Kosmos');
  const env = { AGENT_WORKFORCE_DATA: path.join(dir, 'machine') };
  const anchor = win32anchor.anchorDir(process.platform, os.homedir(), env);
  writeBuild(root, o.from || NEW, 'new', { nodeBytes: 'the new node.exe' });
  fs.mkdirSync(path.join(root, 'Projects', 'garden'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Projects', 'garden', 'notes.txt'), "a person's own work");
  const work = path.join(root, win32update.WORK_DIRNAME);
  const staged = path.join(work, win32update.STAGED_DIRNAME);
  writeBuild(staged, o.to || OLD, 'old', { nodeBytes: o.sameRuntime ? 'the new node.exe' : 'the old node.exe' });
  fs.writeFileSync(path.join(work, win32update.DOWNLOAD_PART_NAME), 'a leftover download');
  fs.mkdirSync(anchor, { recursive: true });
  fs.writeFileSync(path.join(anchor, win32anchor.NODE_NAME), 'the new node.exe');
  fs.writeFileSync(path.join(anchor, win32anchor.POINTER_NAME), path.join(root, 'app', 'engine') + '\r\n');
  return {
    dir, root, env, anchor, work, staged, log: [],
    journal: path.join(anchor, win32anchor.UPDATE_JOURNAL_NAME),
    statusAt: path.join(anchor, win32anchor.UPDATE_STATUS_NAME),
    previous: path.join(work, `previous-${o.from || NEW}`),
  };
}
function stageRollback(c, o = {}) {
  return win32apply.writeRollbackJournal(c.journal, {
    root: c.root, anchor: c.anchor, fromVersion: o.from || NEW, fromIdentity: o.fromIdentity || NEW_ID,
    to: { version: o.to || OLD, identity: o.toIdentity || OLD_ID }, runtimeChanged: o.runtimeChanged !== false,
    board: { pid: o.boardPid === undefined ? null : o.boardPid, port: PORT }, now: clock,
  });
}

test('S5 rollback: the current build is swapped out for the kept previous one, confirmed as the OLD identity', T, async () => {
  const c = rollbackInstall();
  const newRoot = hashTree(c.root, [c.work, path.join(c.root, 'Projects')]);
  const oldTree = hashTree(c.staged);
  const projects = hashTree(path.join(c.root, 'Projects'));
  const j0 = stageRollback(c);
  assert.equal(j0.rollback, true, 'the journal is marked rollback');
  const sim = playBoard(c);
  const r = await win32apply.applyJournal(c.journal, sim.deps());
  assert.deepEqual(r, { ok: true, outcome: 'updated', version: OLD }, c.log.join('\n'));
  assert.deepEqual(hashTree(c.root, [c.work, path.join(c.root, 'Projects')]), oldTree, 'ROOT now holds exactly the kept old build');
  assert.deepEqual(hashTree(c.previous), newRoot, `previous-${NEW} now holds exactly the build we rolled back from`);
  assert.deepEqual(hashTree(path.join(c.root, 'Projects')), projects, "the person's projects are untouched");
  assert.equal(fs.readFileSync(path.join(c.anchor, 'node.exe'), 'utf8'), 'the old node.exe', 'H5 restored the old anchored interpreter');
  assert.equal(sim.identity, OLD_ID, 'the board answers as the OLD build');
  const j = readJson(c.journal);
  assert.equal(j.finished, true);
  assert.equal(j.outcome, 'updated');
  assert.equal(readJson(c.statusAt).sentence, `Kosmos has rolled back to ${OLD}.`);
  assert.deepEqual(sim.calls.filter((call) => /agent-/.test(call)), [], 'no agent task is touched');
});

test('S5 rollback: if the kept build does not come up, H8 puts the current build back and confirms it', T, async () => {
  const c = rollbackInstall();
  const before = installState(c);
  stageRollback(c);
  /* The OLD build (the rollback target) never boots; the NEW build (what H8 restores) does. */
  const sim = playBoard(c, { blockIdentity: OLD_ID });
  const r = await win32apply.applyJournal(c.journal, sim.deps());
  assert.equal(r.outcome, 'rolled-back', JSON.stringify(r) + '\n' + c.log.join('\n'));
  assert.deepEqual(installState(c), before, 'the current build, node.exe and pointer are byte-identical again');
  assert.equal(sim.identity, NEW_ID, 'the board is back on the current build');
  const status = readJson(c.statusAt);
  assert.equal(status.sentence, `The roll back did not take. Kosmos is still on ${NEW}. If Kosmos does not come back by itself, double-click Kosmos.exe in ${c.root}.`);
  assert.equal(status.version, NEW);
  /* FIX1: a reversed rollback must PRESERVE the kept build (its only copy) so the person can retry --
     not delete it with the rest of the swap's scratch. */
  const keptDir = path.join(c.work, `previous-${OLD}`);
  assert.equal(fs.existsSync(keptDir), true, 'a reversed rollback deleted the kept build instead of keeping it for a retry');
  assert.equal(fs.existsSync(c.staged), false, 'the kept build was left in staged, where the next prepare would delete it');
  const kept = win32update.keptPreviousBuild(c.root);
  assert.equal(kept && kept.version, OLD, 'keptPreviousBuild no longer re-offers the kept build after a reversed rollback');
});

test('S5 rollback: never-downgrade is skipped, but only for a strictly-older target', T, async () => {
  /* A rollback whose `to` is NOT older than the running build is refused as nothing to roll back to;
     nothing moves (this is the guard that keeps the flag from being a covert forward install). */
  const c = rollbackInstall({ from: OLD, to: NEW });   // ROOT=OLD, staged=NEW: "rolling back" to a NEWER build
  stageRollback(c, { from: OLD, fromIdentity: OLD_ID, to: NEW, toIdentity: NEW_ID });
  const sim = playBoard(c);
  const r = await win32apply.applyJournal(c.journal, sim.deps());
  assert.equal(r.outcome, 'not-started', JSON.stringify(r));
  assert.match(r.because, new RegExp(`${NEW.replace(/\./g, '\.')} is not older than ${OLD.replace(/\./g, '\.')}`));
  assert.equal(fs.existsSync(path.join(c.root, 'bin')), true, 'nothing moved (bin still in ROOT)');
  assert.equal(fs.existsSync(c.previous), false, 'no previous folder was made');
});

test('S5 rollback: a journal with a non-boolean rollback marker is unreadable', T, () => {
  const c = rollbackInstall();
  stageRollback(c);
  const j = readJson(c.journal);
  j.rollback = 'yes';
  fs.writeFileSync(c.journal, JSON.stringify(j, null, 2) + '\n');
  const read = win32apply.readJournal(c.journal);
  assert.equal(read.state, 'unreadable');
  assert.match(read.why, /unknown rollback marker/);
});

test('S5 rollback: a forward journal is byte-compatible -- it carries no rollback field', T, () => {
  const c = freshInstall();
  const j = stage(c);
  assert.equal('rollback' in j, false, 'a forward update journal has no rollback marker');
});

test('S5 rollback FIX1: a crash at phase staged preserves the kept build as previous-<to>, so keptPreviousBuild re-offers it', T, () => {
  const c = rollbackInstall();
  const keptTree = hashTree(c.staged);   // the kept build lives ONLY in staged at this point
  stageRollback(c);                      // phase staged, before the helper moved anything
  const sim = playBoard(c);
  const r = win32apply.recoverAtBoot(c.journal, sim.deps());
  assert.equal(r.action, 'not-started', JSON.stringify(r) + '\n' + c.log.join('\n'));
  const keptDir = path.join(c.work, `previous-${OLD}`);
  assert.equal(fs.existsSync(c.staged), false, 'staged was left orphaned rather than preserved');
  assert.equal(fs.existsSync(keptDir), true, 'the kept build was not preserved as previous-<to>');
  assert.deepEqual(hashTree(keptDir), keptTree, 'the preserved tree is exactly the kept build');
  const kept = win32update.keptPreviousBuild(c.root);
  assert.equal(kept && kept.version, OLD, 'keptPreviousBuild cannot re-offer the kept build after a crash');
  assert.equal(readJson(c.journal).finished, true, 'the journal is finished');
});

test('S5 rollback FIX1: a crash at phase stopping also preserves the kept build', T, () => {
  const c = rollbackInstall();
  const keptTree = hashTree(c.staged);
  stageRollback(c);
  const j = readJson(c.journal); j.phase = 'stopping'; fs.writeFileSync(c.journal, JSON.stringify(j, null, 2) + '\n');
  const sim = playBoard(c);
  const r = win32apply.recoverAtBoot(c.journal, sim.deps());
  assert.equal(r.action, 'not-started', JSON.stringify(r) + '\n' + c.log.join('\n'));
  const keptDir = path.join(c.work, `previous-${OLD}`);
  assert.deepEqual(hashTree(keptDir), keptTree, 'the kept build was not preserved from a stopping-phase crash');
  assert.equal(win32update.keptPreviousBuild(c.root).version, OLD);
});

test('S5 rollback FIX1: a duplicate previous-<to> is not clobbered; the stray staged copy is dropped', T, () => {
  const c = rollbackInstall();
  stageRollback(c);
  /* An equivalent kept copy already exists (e.g. a resumer beat this one). The preserve must keep it
     and drop the duplicate staged, never overwrite. */
  const keptDir = path.join(c.work, `previous-${OLD}`);
  fs.mkdirSync(path.join(keptDir, 'app'), { recursive: true });
  fs.writeFileSync(path.join(keptDir, 'sentinel'), 'the pre-existing kept copy');
  const sim = playBoard(c);
  win32apply.recoverAtBoot(c.journal, sim.deps());
  assert.equal(fs.readFileSync(path.join(keptDir, 'sentinel'), 'utf8'), 'the pre-existing kept copy', 'the existing kept copy was clobbered');
  assert.equal(fs.existsSync(c.staged), false, 'the duplicate staged copy was not dropped');
});
