'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/**
 * kosmos#5434 slice 17: five records Kosmos needs to start save through store.saveFlushed (securewrite), so they are
 * flushed before the rename makes them the file (#5431): projects.json, the removed-agents list, you.json and
 * policy.json through store.saveFlushed, and the worlds registry through its own writer (it keeps its dot-named temp).
 * you.json, policy.json and the registry are driven through their public saves; the four store writers are held to
 * "no bare rename" by reading their source.
 *
 *   node --test engine/state.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'state-fsync-')));
process.env.AGENT_WORKFORCE_DATA = SB;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_HOME = path.join(SB, 'home');
process.on('exit', () => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ } });
const store = require('./store');
fs.mkdirSync(store.ROOT, { recursive: true });
const you = require('./you');
const policy = require('./policy');
const worlds = require('./worlds');

function recording(fn, failFsyncOf) {
  const events = [];
  const fdPath = new Map();
  const realOpen = fs.openSync;
  const realFsync = fs.fsyncSync;
  const realRename = fs.renameSync;
  fs.openSync = (p, ...rest) => { const fd = realOpen.call(fs, p, ...rest); fdPath.set(fd, String(p)); return fd; };
  fs.fsyncSync = (fd) => {
    const p = fdPath.get(fd);
    events.push(['fsync', p]);
    if (failFsyncOf && p && failFsyncOf(p)) { const e = new Error('injected'); e.code = 'EIO'; throw e; }
    return realFsync(fd);
  };
  fs.renameSync = (a, b) => { events.push(['rename', String(a), String(b)]); return realRename(a, b); };
  let out;
  let err = null;
  try { out = fn(); } catch (e) { err = e; } finally { fs.openSync = realOpen; fs.fsyncSync = realFsync; fs.renameSync = realRename; }
  return { events, out, err };
}
function flushedBeforeRename(events, file) {
  const r = events.findIndex((e) => e[0] === 'rename' && e[2] === file);
  assert.ok(r >= 0, 'no rename into ' + path.basename(file) + ': ' + JSON.stringify(events));
  assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]), path.basename(file) + ': the temp was not flushed before its rename');
}

test('#5434 you.json: flushed before its rename', () => {
  const { events, err } = recording(() => you.save({ name: 'Sam', does: 'runs a bakery', know: '' }));
  assert.equal(err, null, String(err));
  flushedBeforeRename(events, you.FILE);
});

test('#5434 you.json: a failed flush throws and leaves the old file', () => {
  you.save({ name: 'Sam', does: 'runs a bakery', know: '' });
  const before = fs.readFileSync(you.FILE, 'utf8');
  const isTemp = (p) => p.startsWith(you.FILE + '.kosmos-') && p.endsWith('.tmp');
  const { events, err } = recording(() => you.save({ name: 'Alex', does: 'writes code', know: '' }), isTemp);
  assert.ok(events.some((e) => e[0] === 'fsync' && isTemp(e[1] || '')), 'the temp was never flushed, so this tests nothing');
  assert.ok(err, 'a save whose flush failed was reported as done');
  assert.equal(fs.readFileSync(you.FILE, 'utf8'), before, 'a save whose flush failed changed you.json');
});

test('#5434 policy.json: flushed before its rename', () => {
  const { events, err } = recording(() => policy.add({ name: 'House rules', text: 'Be kind to customers.', source: 'pasted' }));
  assert.equal(err, null, String(err));
  flushedBeforeRename(events, policy.FILE);
});

test('#5434 worlds registry: flushed before its rename (review 1)', () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'state-fsync-worlds-')));
  try {
    const { events, err } = recording(() => worlds.createWorld(base, 'Shop'));
    assert.equal(err, null, String(err));
    flushedBeforeRename(events, worlds.registryPath(base));
    // review 2: the temp keeps the dot name the guide's sandbox rules and Undo's protected paths recognise
    const r = events.find((e) => e[0] === 'rename' && e[2] === worlds.registryPath(base));
    assert.match(path.basename(r[1]), /^\.worlds\.json\.\d+\.tmp$/, 'the registry temp lost the dot name its guards match: ' + r[1]);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('#5434 worlds registry: a failed flush throws, keeps the registry, and leaves no temp (review 3)', () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'state-fsync-worlds-')));
  try {
    worlds.createWorld(base, 'First');
    const before = fs.readFileSync(worlds.registryPath(base), 'utf8');
    const isTemp = (p) => /[\\/]\.worlds\.json\.\d+\.tmp$/.test(p);
    const { events, err } = recording(() => worlds.createWorld(base, 'Second'), isTemp);
    assert.ok(events.some((e) => e[0] === 'fsync' && isTemp(e[1] || '')), 'the registry temp was never flushed, so this tests nothing');
    assert.ok(err, 'a registry save whose flush failed was reported as done');
    assert.equal(fs.readFileSync(worlds.registryPath(base), 'utf8'), before, 'a save whose flush failed changed the registry');
    assert.deepEqual(fs.readdirSync(base).filter((n) => /^\.worlds\.json\..*\.tmp$/.test(n)), [], 'the registry temp was left behind');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('#5434: none of the four store writers renames a hand-made temp any more', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const body = (src, header) => {
    const i = src.indexOf(header);
    assert.ok(i >= 0, header + ' not found');
    const j = src.indexOf('\n}\n', i);
    return src.slice(i, j);
  };
  const writers = [
    ['projects.js', 'function writeAll('],
    ['remove.js', 'function writeRemoved('],
    ['you.js', 'function save('],
    ['policy.js', 'function persist('],
  ];
  for (const [file, header] of writers) {
    const b = body(read(file), header);
    assert.match(b, /saveFlushed\(/, `${file} ${header}: not saved through store.saveFlushed`);
    assert.doesNotMatch(b, /renameSync\(/, `${file} ${header}: still renames a hand-made temp`);
  }
});
