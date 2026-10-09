'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/**
 * kosmos#5434 slice 19: fourteen small setting and marker files save through store.saveFlushed, so each is flushed
 * before the rename makes it the file (#5431). A zero-filled switch reads as its default, silently undoing what the
 * person chose. engmode, limits, autoupdate, heartbeat and the first-run flag are driven through their public saves;
 * all fourteen writers are held to "saveFlushed, no bare rename" by reading their source.
 *
 *   node --test engine/switches.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'switches-fsync-')));
process.env.AGENT_WORKFORCE_DATA = SB;
process.env.AGENT_WORKFORCE_HOME = path.join(SB, 'home');
process.on('exit', () => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ } });
const store = require('./store');
fs.mkdirSync(store.ROOT, { recursive: true });

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

const engmode = require('./engmode');
const limits = require('./limits');
const autoupdate = require('./autoupdate');
const heartbeat = require('./heartbeat-setting');
const firstrun = require('./firstrun');

const DRIVEN = [
  ['engmode', engmode.FILE, () => engmode.write({ on: true })],
  ['limits', limits.FILE, () => limits.write({ on: true, perHour: limits.TIERS[0] })],
  ['autoupdate', autoupdate.FILE, () => autoupdate.write({ on: false })],
  ['heartbeat', heartbeat.FILE, () => heartbeat.setOn(true)],
  ['first-run flag', firstrun.FLAG, () => firstrun.complete()],
];

for (const [name, file, save] of DRIVEN) {
  test(`#5434 ${name}: flushed before its rename`, () => {
    const { events, out, err } = recording(save);
    assert.equal(err, null, String(err));
    if (out && typeof out === 'object' && 'ok' in out) assert.equal(out.ok, true, JSON.stringify(out));
    flushedBeforeRename(events, file);
  });
}

test('#5434 engmode: a save whose flush fails is refused and leaves the file as it was', () => {
  engmode.write({ on: false });
  const before = fs.readFileSync(engmode.FILE, 'utf8');
  const isTemp = (p) => p.startsWith(engmode.FILE + '.kosmos-') && p.endsWith('.tmp');
  const { events, out } = recording(() => engmode.write({ on: true }), isTemp);
  assert.ok(events.some((e) => e[0] === 'fsync' && isTemp(e[1] || '')), 'the temp was never flushed, so this tests nothing');
  assert.equal(out.ok, false, 'a save whose flush failed was reported as done');
  assert.equal(fs.readFileSync(engmode.FILE, 'utf8'), before);
});

test('#5434: all fourteen writers save through store.saveFlushed, with no bare rename left', () => {
  const files = ['agycap-setting.js', 'assigner-setting.js', 'autoupdate.js', 'communityindustry.js', 'communityswitch.js',
    'engmode.js', 'feedbacksend.js', 'heartbeat-setting.js', 'limits.js', 'ping.js', 'recommender-setting.js', 'tips.js',
    'guidestate.js', 'firstrun.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.match(src, /saveFlushed\(/, f + ': not saved through store.saveFlushed');
    assert.doesNotMatch(src, /renameSync\(/, f + ': still renames a hand-made temp');
  }
});
