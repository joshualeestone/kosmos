'use strict';
/**
 * win32-installer-native, round 1 finding 3: a board booting from a real Kosmos build points the
 * engine pointer at ITSELF, whatever state the board's logon task is in, and registers nothing.
 *
 * 🛑 THE DEFECT. The pointer moved only inside `install()`, which ensureInstalled reaches only for a
 * task it registers or refreshes. With the task switched off, removed or unreadable, a moved or newly
 * extracted Kosmos booted while every agent's task kept starting the OLD folder.
 *
 * No real schtasks and no real anchor: the runner and the anchorer are stubs, and the anchor's own
 * folder is a scratch folder.
 *
 *   node --test engine/win32board.reanchor.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const board = require('./win32board');

/* The two anchor-guard arms below drive anchorBundle down its REAL guard (no anchorer injected), which reads
   win32job.schtasksMayRunInThisProcess(). That is HOST-dependent: on a non-win32 host schtasks does not exist,
   so it returns false and the guard never engages, and the assertions ('a test must install an anchorer';
   the child returns action 'refused') do not hold. anchorBundle only ever runs on win32 in production
   (ensureInstalled is win32-only; the "a Mac never anchors" arm below proves the darwin refusal cross-platform),
   so this is host-only test scope, not a bug. Everything else in this file injects both seams and is
   host-independent. */
const WIN32_HOST = { skip: process.platform === 'win32' ? false : 'win32-host-only: the anchor guard reads win32job.schtasksMayRunInThisProcess(), which only engages on a win32 host' };

const ANCHOR = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-reanchor-'));
test.after(() => fs.rmSync(ANCHOR, { recursive: true, force: true }));

const MOVED = 'C:\\Users\\sam\\AppData\\Local\\Programs\\Kosmos';
const REAL_BUILD = () => ({ product: 'kosmos', platform: 'win32', version: '0.6.60' });

function definition(enabled) {
  return { ok: true, out: '<?xml version="1.0"?><Task><Settings>' + (enabled ? '' : '<Enabled>false</Enabled>') + '</Settings></Task>' };
}

/** Boot ensureInstalled from the moved bundle with the task answering `xml`; record every command and anchor. */
function boot(xml, extra) {
  const calls = [];
  const anchored = [];
  board.setRunner((args) => {
    calls.push(args.join(' '));
    if (args[0] === '/Query' && args.includes('/XML')) return xml;
    if (args[0] === '/Query' && !args.includes('/TN')) return xml.ok ? { ok: true, out: '"\\Kosmos\\board","N/A","Ready"\r\n' } : xml;
    if (args[0] === '/Query') return { ok: false, out: 'ERROR: The system cannot find the file specified.' };
    return { ok: true, out: 'SUCCESS' };
  });
  board.setAnchorer((spec) => {
    anchored.push(spec);
    return extra && extra.anchorFails
      ? { ok: false, because: 'the disk is full' }
      : { ok: true, node: path.join(ANCHOR, 'node.exe'), boot: path.join(ANCHOR, 'supervisor-boot.js'), dir: ANCHOR, pointer: path.join(ANCHOR, 'engine-path') };
  });
  try {
    const r = board.ensureInstalled({
      platform: 'win32', root: MOVED, exists: () => true, readManifest: REAL_BUILD,
      env: { USERNAME: 'sam', USERDOMAIN: 'BOX', LOCALAPPDATA: path.join(ANCHOR, 'Local') }, home: 'C:\\Users\\sam',
      ...(extra && extra.opts),
    });
    return { r, calls, anchored };
  } finally { board.setRunner(null); board.setAnchorer(null); }
}

test('🛑 a board task the person switched off: the moved copy still takes the pointer, and the task stays off', () => {
  const { r, calls, anchored } = boot(definition(false));
  assert.equal(r.action, 'left-disabled');
  assert.equal(anchored.length, 1, 'a switched-off task left the pointer on the old folder');
  assert.ok(!calls.some((c) => /^\/(Create|Change|Run|Delete)/.test(c)), 'anchoring registered or changed the task: ' + calls.join(' | '));
});

test('a board task that cannot be read: nothing is registered, and the pointer still follows this folder', () => {
  const { r, calls, anchored } = boot({ ok: false, out: 'ERROR: Access is denied.' });
  assert.equal(r.action, 'unknown');
  assert.equal(anchored.length, 1);
  assert.ok(!calls.some((c) => /^\/(Create|Change)/.test(c)));
});

test('a board task switched on is refreshed as before, and the pointer follows this folder', () => {
  const { r, anchored } = boot(definition(true));
  assert.equal(r.action, 'refreshed', JSON.stringify(r));
  assert.ok(anchored.length >= 1);
  assert.equal(r.anchor, undefined, 'a successful anchor changed ensureInstalled\'s answer');
});

test('an anchor that fails is reported on the answer, and the task\'s own state is still reported', () => {
  const { r } = boot(definition(false), { anchorFails: true });
  assert.equal(r.action, 'left-disabled');
  assert.deepEqual(r.anchor, { ok: false, action: 'failed', because: 'the disk is full' });
});

/** A real Kosmos build on disk, as bundleRoot and the manifest check read it, with scratch roots. */
function realBundle() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-anchor-guard-'));
  const root = path.join(base, 'bundle');
  fs.mkdirSync(path.join(root, 'app', 'engine'), { recursive: true });
  fs.mkdirSync(path.join(root, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app', 'server.js'), '');
  fs.writeFileSync(path.join(root, 'runtime', 'node.exe'), 'node');
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ product: 'kosmos', platform: 'win32', version: '0.6.61' }));
  const env = { LOCALAPPDATA: path.join(base, 'Local'), APPDATA: path.join(base, 'Roaming'), USERNAME: 'x' };
  return { base, root, env, pointer: path.join(env.LOCALAPPDATA, 'Kosmos', 'runtime', 'engine-path') };
}

test('🛑 round 2 finding 1: with no anchorer, a test process never reaches the real anchor, and writes nothing', WIN32_HOST, () => {
  const b = realBundle();
  try {
    board.setAnchorer(null);
    assert.throws(() => board.anchorBundle({ platform: 'win32', root: b.root, env: b.env, home: path.join(b.base, 'home'),
      node: path.join(b.root, 'runtime', 'node.exe'), engineDir: path.join(b.root, 'app', 'engine') }), /a test must install an anchorer/);
    assert.ok(!fs.existsSync(b.pointer), 'the real anchor wrote the engine pointer from a test process');
  } finally { fs.rmSync(b.base, { recursive: true, force: true }); }
});

test('🛑 round 2 finding 1: outside a test, the real anchor needs live execution armed', WIN32_HOST, () => {
  const b = realBundle();
  try {
    const script = [
      "const board = require(" + JSON.stringify(path.join(__dirname, 'win32board.js')) + ");",
      'const r = board.anchorBundle(' + JSON.stringify({ platform: 'win32', root: b.root, env: b.env, home: path.join(b.base, 'home'),
        node: path.join(b.root, 'runtime', 'node.exe'), engineDir: path.join(b.root, 'app', 'engine') }) + ');',
      'process.stdout.write(JSON.stringify(r));',
    ].join('\n');
    /* Not a test process, and not a child one either: the first guard is proven above, this arm is the second. */
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
    assert.equal(r.status, 0, r.stderr);
    const said = JSON.parse(r.stdout);
    assert.equal(said.action, 'refused', 'a process that never armed live execution anchored: ' + r.stdout);
    assert.ok(!fs.existsSync(b.pointer), 'the engine pointer was written without live execution');
  } finally { fs.rmSync(b.base, { recursive: true, force: true }); }
});

test('🛑 a Mac, a source checkout, and a folder with no Kosmos manifest never anchor', () => {
  assert.equal(boot(definition(false), { opts: { platform: 'darwin' } }).anchored.length, 0, 'a Mac anchored');
  assert.equal(boot(definition(false), { opts: { exists: () => false } }).anchored.length, 0, 'a source checkout anchored');
  assert.equal(boot(definition(false), { opts: { readManifest: () => { throw new Error('ENOENT'); } } }).anchored.length, 0, 'a folder with no manifest anchored');
  assert.equal(boot(definition(false), { opts: { readManifest: () => ({ product: 'kosmos', platform: 'darwin' }) } }).anchored.length, 0, 'a Mac build\'s manifest anchored');
});
