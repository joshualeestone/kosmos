'use strict';
/**
 * win32-swap-atomic: the rename-swap primitives the anchor and the Windows updater
 * share (engine/win32swap.js), and the atomic write of the `engine-path` pointer.
 *
 * Every arm works in a temp sandbox and derives the anchor from it; nothing here
 * touches the real anchor under LOCALAPPDATA.
 *
 *   node --test engine/win32swap.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Convention 2: the data root is sandboxed BEFORE win32anchor (and the store it
   requires) is loaded. Every anchoring below also passes its own sandbox as env. */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-win32swap-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');

const swap = require('./win32swap');
const anchor = require('./win32anchor');

test.after(() => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ }
});

let cases = 0;
function tmp() {
  const dir = path.join(SANDBOX, 'case-' + (++cases));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* Replace one `fs` function for the length of `body`. win32swap calls the shared
   `fs` object, so this reaches its calls; the original is always put back. */
function withFs(name, makeFake, body) {
  const real = fs[name];
  fs[name] = makeFake(real);
  try { return body(); } finally { fs[name] = real; }
}
function failure(code) { return Object.assign(new Error('simulated ' + code), { code }); }

function anchoringOf(dir, src, engineDir) {
  return { platform: process.platform, home: os.homedir(), env: { AGENT_WORKFORCE_DATA: dir }, node: src, engineDir };
}
function readPointerOf(dir) {
  return anchor.readPointer(process.platform, os.homedir(), { AGENT_WORKFORCE_DATA: dir });
}
function pointerSideFiles(runtime) {
  return fs.readdirSync(runtime).filter((n) => n.startsWith(anchor.POINTER_NAME + '.'));
}

/* ---------------------------------------------------------------- exports */

test('win32swap exports exactly the primitives the anchor and the updater share', () => {
  assert.deepEqual(Object.keys(swap).sort(), [
    'RETIRED_INFIX', 'RETIRED_SWEEP_MIN_AGE_MS', 'STAGED_INFIX',
    'renameWithRetry', 'replaceInterpreter', 'retireLeftoverInterpreters', 'writeFileAtomic',
  ]);
  for (const name of ['renameWithRetry', 'replaceInterpreter', 'retireLeftoverInterpreters', 'writeFileAtomic']) {
    assert.equal(typeof swap[name], 'function', name);
  }
});

test('win32anchor keeps the surface it had, and its swap constants come from win32swap', () => {
  assert.deepEqual(Object.keys(anchor).sort(), [
    'APP', 'BOOT_JS', 'BOOT_NAME', 'NODE_NAME', 'POINTER_NAME', 'RETIRED_INFIX',
    'RETIRED_SWEEP_MIN_AGE_MS', 'STAGED_INFIX', 'anchorDir', 'ensureAnchored', 'readPointer',
  ]);
  assert.equal(anchor.STAGED_INFIX, swap.STAGED_INFIX);
  assert.equal(anchor.RETIRED_INFIX, swap.RETIRED_INFIX);
  assert.equal(anchor.RETIRED_SWEEP_MIN_AGE_MS, swap.RETIRED_SWEEP_MIN_AGE_MS);
});

test('ONE copy of each primitive: win32anchor defines none of them and requires win32swap', () => {
  /* Convention 5. Equal values above would also pass with a second copy in the
     anchor, which is how two copies drift, so the source is read. */
  const src = fs.readFileSync(path.join(__dirname, 'win32anchor.js'), 'utf8');
  for (const name of ['pauseSync', 'renameWithRetry', 'replaceInterpreter', 'retireLeftoverInterpreters', 'writeFileAtomic']) {
    assert.doesNotMatch(src, new RegExp('function ' + name + '\\b'), 'win32anchor.js defines its own ' + name);
  }
  for (const name of ['STAGED_INFIX', 'RETIRED_INFIX', 'RENAME_ATTEMPTS', 'RENAME_RETRY_DELAY_MS',
    'TRANSIENT_RENAME_CODES', 'SWAP_RENAMES_AT_WORST', 'RETIRED_SWEEP_MIN_AGE_MS', 'STAGED_SWEEP_MIN_AGE_MS']) {
    assert.doesNotMatch(src, new RegExp('const ' + name + '\\s*='), 'win32anchor.js defines its own ' + name);
  }
  assert.match(src, /require\('\.\/win32swap'\)/);
});

test('win32swap needs only Node built-ins, and requiring it touches no file', () => {
  const src = fs.readFileSync(path.join(__dirname, 'win32swap.js'), 'utf8');
  const required = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.ok(required.length > 0, 'sanity: the scan found its requires');
  for (const name of required) assert.match(name, /^node:/, 'win32swap requires a non-built-in: ' + name);

  /* A child arms every fs call that changes the disk to exit 7, then requires the
     module. The CONTROL then calls writeFileAtomic, which must hit the trap: it
     proves the trap is armed, so a clean require is evidence rather than luck. */
  const dir = tmp();
  const probe = path.join(dir, 'probe.js');
  fs.writeFileSync(probe, [
    "const fs = require('node:fs');",
    "for (const k of ['openSync', 'writeSync', 'writeFileSync', 'fsyncSync', 'renameSync', 'unlinkSync', 'copyFileSync', 'mkdirSync', 'rmSync', 'readdirSync']) {",
    "  fs[k] = () => { process.stderr.write('touched ' + k); process.exit(7); };",
    '}',
    'const swap = require(' + JSON.stringify(path.join(__dirname, 'win32swap.js')) + ');',
    "if (process.argv[2] === 'control') swap.writeFileAtomic(" + JSON.stringify(path.join(dir, 'x')) + ", 'x');",
    "process.stdout.write('loaded');",
  ].join('\n'), 'utf8');
  const loaded = cp.spawnSync(process.execPath, [probe], { encoding: 'utf8' });
  assert.equal(loaded.status, 0, loaded.stderr);
  assert.equal(loaded.stdout, 'loaded');
  const control = cp.spawnSync(process.execPath, [probe, 'control'], { encoding: 'utf8' });
  assert.equal(control.status, 7, 'control: the trap must catch a real write: ' + control.stderr);
});

/* ---------------------------------------------------------- writeFileAtomic */

test('writeFileAtomic replaces the target and leaves nothing beside it', () => {
  const dir = tmp();
  const target = path.join(dir, 'engine-path');
  fs.writeFileSync(target, 'C:\\Kosmos\\an-old-and-much-longer-path\\app\\engine', 'utf8');
  swap.writeFileAtomic(target, 'C:\\Kosmos\\new\\app\\engine');
  assert.equal(fs.readFileSync(target, 'utf8'), 'C:\\Kosmos\\new\\app\\engine');
  swap.writeFileAtomic(path.join(dir, 'fresh'), Buffer.from('bytes'));
  assert.equal(fs.readFileSync(path.join(dir, 'fresh'), 'utf8'), 'bytes', 'a target that did not exist is created');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['engine-path', 'fresh'], 'no temp is left after a write');
});

test('the temp is flushed to disk BEFORE it takes the target name', () => {
  const dir = tmp();
  const target = path.join(dir, 'engine-path');
  const events = [];
  withFs('fsyncSync', (real) => (fd) => { events.push('fsync'); return real(fd); }, () =>
    withFs('renameSync', (real) => (from, to) => { events.push('rename'); return real(from, to); }, () =>
      swap.writeFileAtomic(target, 'C:\\Kosmos\\new\\app\\engine')));
  assert.deepEqual(events, ['fsync', 'rename']);
});

test('a rename that fails removes the temp and leaves the target as it was', () => {
  const dir = tmp();
  const target = path.join(dir, 'engine-path');
  fs.writeFileSync(target, 'old', 'utf8');
  assert.throws(() => withFs('renameSync', () => () => { throw failure('EIO'); }, () =>
    swap.writeFileAtomic(target, 'new')), /simulated EIO/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'old');
  assert.deepEqual(fs.readdirSync(dir), ['engine-path'], 'the temp this call made is removed');
});

test('writeFileAtomic rides out a sharing violation on its rename', () => {
  const dir = tmp();
  const target = path.join(dir, 'engine-path');
  fs.writeFileSync(target, 'old', 'utf8');
  let calls = 0;
  withFs('renameSync', (real) => (from, to) => {
    calls += 1;
    if (calls === 1) throw failure('EPERM');   // antivirus holding the target a moment
    return real(from, to);
  }, () => swap.writeFileAtomic(target, 'new'));
  assert.equal(calls, 2, 'the rename is retried, not given up on');
  assert.equal(fs.readFileSync(target, 'utf8'), 'new');
});

/* ---------------------------------------------------------- renameWithRetry */

for (const code of ['EBUSY', 'EPERM']) {
  test('renameWithRetry retries a transient ' + code + ' until the rename lands', () => {
    const dir = tmp();
    const from = path.join(dir, 'a');
    const to = path.join(dir, 'b');
    fs.writeFileSync(from, 'x', 'utf8');
    let calls = 0;
    withFs('renameSync', (real) => (f, t) => {
      calls += 1;
      if (calls < 3) throw failure(code);
      return real(f, t);
    }, () => swap.renameWithRetry(from, to));
    assert.equal(calls, 3);
    assert.equal(fs.readFileSync(to, 'utf8'), 'x');
  });
}

test('renameWithRetry reports a real failure at once', () => {
  let calls = 0;
  assert.throws(() => withFs('renameSync', () => () => { calls += 1; throw failure('EIO'); }, () =>
    swap.renameWithRetry('a', 'b')), /simulated EIO/);
  assert.equal(calls, 1);
});

test('renameWithRetry gives up on a lock that never clears, and rethrows it', () => {
  let calls = 0;
  assert.throws(() => withFs('renameSync', () => () => { calls += 1; throw failure('EBUSY'); }, () =>
    swap.renameWithRetry('a', 'b')), /simulated EBUSY/);
  assert.ok(calls > 1, 'retried before giving up: ' + calls);
});

/* ------------------------------------- the pointer, through ensureAnchored */

/* A child that anchors against a sandbox and DIES partway through writing the
   pointer. `rename` exits the process when the pointer's temp is about to take
   the pointer's name; `write` writes half the pointer's bytes and exits. A real
   exit, so no `finally` or `catch` runs: that is what a crash or a power cut is. */
const CRASH_EXIT = 9;
function anchorThatDies(dir, mode, engineDir, src) {
  const script = path.join(dir, 'dies-' + mode + '.js');
  fs.writeFileSync(script, [
    "'use strict';",
    "const fs = require('node:fs');",
    "const os = require('node:os');",
    "const path = require('node:path');",
    'const [dataDir, engineDir, srcNode, mode] = process.argv.slice(2);',
    'process.env.AGENT_WORKFORCE_DATA = dataDir;',
    'const anchor = require(' + JSON.stringify(path.join(__dirname, 'win32anchor.js')) + ');',
    "if (mode === 'rename') {",
    '  const real = fs.renameSync;',
    '  fs.renameSync = (from, to) => {',
    '    if (path.basename(String(to)) === anchor.POINTER_NAME) process.exit(' + CRASH_EXIT + ');',
    '    return real(from, to);',
    '  };',
    '} else {',
    '  const real = fs.writeSync;',
    '  fs.writeSync = (fd, buf, off, len, pos) => {',
    '    if (fd === 1 || fd === 2) return real(fd, buf, off, len, pos);',
    '    real(fd, buf, off, Math.floor(len / 2), pos);',
    '    process.exit(' + CRASH_EXIT + ');',
    '  };',
    '}',
    'const r = anchor.ensureAnchored({ platform: process.platform, home: os.homedir(),',
    '  env: { AGENT_WORKFORCE_DATA: dataDir }, node: srcNode, engineDir });',
    'process.stdout.write(JSON.stringify(r));',
  ].join('\n'), 'utf8');
  return cp.spawnSync(process.execPath, [script, dir, engineDir, src, mode], { encoding: 'utf8' });
}

function anchoredAt(oldEngine) {
  const dir = tmp();
  const src = path.join(dir, 'src-node.exe');
  fs.writeFileSync(src, 'stand-in for an interpreter', 'utf8');
  const first = anchor.ensureAnchored(anchoringOf(dir, src, oldEngine));
  assert.equal(first.ok, true, first.because || '');
  assert.equal(fs.readFileSync(first.pointer, 'utf8'), oldEngine, 'sanity: the old pointer is in place');
  return { dir, src, first };
}

const OLD_ENGINE = 'C:\\Users\\jo\\Kosmos\\kosmos-0.6.55-win-x64\\app\\engine';
const NEW_ENGINE = 'C:\\Users\\jo\\Kosmos\\kosmos-0.6.60-win-x64-with-a-longer-name\\app\\engine';

test('A CRASH BETWEEN THE POINTER\'S TEMP AND ITS RENAME LEAVES THE OLD POINTER WHOLE', () => {
  /* 🛑 The defect: a plain writeFileSync truncated engine-path at open, so a death
     before the bytes landed left it empty, and the board and every agent exited 3
     at the next logon. */
  const { dir, src, first } = anchoredAt(OLD_ENGINE);
  const out = anchorThatDies(dir, 'rename', NEW_ENGINE, src);
  assert.equal(fs.readFileSync(first.pointer, 'utf8'), OLD_ENGINE,
    'the pointer must still hold the old engine, complete (child exit ' + out.status + ', ' + out.stdout + out.stderr + ')');
  assert.equal(out.status, CRASH_EXIT, 'sanity: the child really died at the pointer rename: ' + out.stdout + out.stderr);
  assert.equal(readPointerOf(dir), OLD_ENGINE, 'a reader sees the old engine');

  const leftovers = pointerSideFiles(first.dir);
  assert.equal(leftovers.length, 1, 'the dead writer left its temp: ' + leftovers);
  assert.equal(fs.readFileSync(path.join(first.dir, leftovers[0]), 'utf8'), NEW_ENGINE,
    'the new bytes were complete in the temp before the rename, so the rename is the only step that publishes them');

  /* The leftover is harmless: the next anchoring writes the pointer as normal, and
     nothing reads the temp. */
  const again = anchor.ensureAnchored(anchoringOf(dir, src, NEW_ENGINE));
  assert.equal(again.ok, true, again.because || '');
  assert.equal(fs.readFileSync(again.pointer, 'utf8'), NEW_ENGINE);
  assert.equal(readPointerOf(dir), NEW_ENGINE);
  assert.deepEqual(pointerSideFiles(first.dir), leftovers, 'only the dead writer\'s temp remains, and no new one');
});

test('a write torn part-way lands in the temp, never in the pointer', () => {
  const { dir, src, first } = anchoredAt(OLD_ENGINE);
  const out = anchorThatDies(dir, 'write', NEW_ENGINE, src);
  assert.equal(fs.readFileSync(first.pointer, 'utf8'), OLD_ENGINE,
    'a torn write must never reach the pointer (child exit ' + out.status + ', ' + out.stdout + out.stderr + ')');
  assert.equal(out.status, CRASH_EXIT, 'sanity: the child really died mid-write: ' + out.stdout + out.stderr);
  const leftovers = pointerSideFiles(first.dir);
  assert.equal(leftovers.length, 1, 'the torn bytes are in the temp: ' + leftovers);
  const torn = fs.readFileSync(path.join(first.dir, leftovers[0]), 'utf8');
  assert.ok(torn.length < NEW_ENGINE.length && NEW_ENGINE.startsWith(torn), 'sanity: the temp really is partial: ' + torn);
});

test('an anchoring whose pointer rename fails says so, and keeps the old pointer', () => {
  const { dir, src, first } = anchoredAt(OLD_ENGINE);
  const r = withFs('renameSync', (real) => (from, to) => {
    if (path.basename(String(to)) === anchor.POINTER_NAME) throw failure('EIO');
    return real(from, to);
  }, () => anchor.ensureAnchored(anchoringOf(dir, src, NEW_ENGINE)));
  assert.equal(r.ok, false);
  assert.match(r.because, /simulated EIO/);
  assert.equal(fs.readFileSync(first.pointer, 'utf8'), OLD_ENGINE);
  assert.deepEqual(pointerSideFiles(first.dir), [], 'the temp is removed');
});

/* ------------------------------------------ the interpreter swap, directly */

test('replaceInterpreter swaps the file in and keeps the old one aside', () => {
  const dir = tmp();
  const nodeAt = path.join(dir, 'node.exe');
  const src = path.join(dir, 'src.exe');
  fs.writeFileSync(nodeAt, 'old', 'utf8');
  fs.writeFileSync(src, 'new', 'utf8');
  swap.replaceInterpreter(src, nodeAt, () => Date.now());
  assert.equal(fs.readFileSync(nodeAt, 'utf8'), 'new');
  const side = fs.readdirSync(dir).filter((n) => n.startsWith('node.exe.'));
  assert.equal(side.length, 1, 'one retired file: ' + side);
  assert.ok(side[0].startsWith('node.exe' + swap.RETIRED_INFIX), side[0]);
  assert.equal(fs.readFileSync(path.join(dir, side[0]), 'utf8'), 'old');
});

test('retireLeftoverInterpreters sweeps only that interpreter\'s old side files', () => {
  const dir = tmp();
  const nodeAt = path.join(dir, 'node.exe');
  fs.writeFileSync(nodeAt, 'current', 'utf8');
  const young = 'node.exe' + swap.STAGED_INFIX + Date.now() + '-1';
  const keep = [
    'node.exe', young,
    'engine-path', 'engine-path.writing-1-1-1',   // a pointer temp is not an interpreter's
    'other.exe' + swap.RETIRED_INFIX + '1-1',       // nor is another executable's side file
  ];
  const sweep = ['node.exe' + swap.RETIRED_INFIX + '1-1', 'node.exe' + swap.STAGED_INFIX + '1-1'];
  for (const name of [...keep, ...sweep]) if (name !== 'node.exe') fs.writeFileSync(path.join(dir, name), 'x', 'utf8');
  swap.retireLeftoverInterpreters(nodeAt, () => Date.now());
  assert.deepEqual(fs.readdirSync(dir).sort(), keep.slice().sort());
});
