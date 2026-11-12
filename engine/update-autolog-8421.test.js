'use strict';
/**
 * kosmos#8421: an automatic update wrote nothing to the board log, so the board stopping for it and coming back on a
 * new version read like a crash. The board now says, before the installer stops it, what it is installing and from
 * which channel, leaves a record beside install.status, and the next board reads that record once and says how it
 * ended. A local server stands in for the coordinator's update pause (as update-pause-6620.test.js), so nothing here
 * reaches a real server; the install root is a throwaway folder and the installer an injected child-shaped runner.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const update = require('./update');
const { version: RUNNING } = require('../package.json');

let server; let paused = false;
test.before(async () => {
  server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ updates_paused: paused })); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.KOSMOS_UPDATE_PAUSE_URL = `http://127.0.0.1:${server.address().port}/v1/meta`;
});
test.after(() => { server.close(); delete process.env.KOSMOS_UPDATE_PAUSE_URL; });

function board() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autolog-8421-'));
  const said = [];
  const children = [];
  update.resetCache();
  update.setPlatform('darwin');   // review 2: pinned, as update.test.js does, so a Windows dev box runs the Mac arms
  update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) }));
  update.setInstalledRoot(() => root);
  update.setAutoPref(() => ({ on: true, ok: true }));
  update.setAutoLog((line) => said.push(line));
  update.setInstallRunner(() => { const c = new EventEmitter(); c.unref = () => {}; children.push(c); return c; });
  return { root, said, children, record: path.join(root, 'logs', 'install.auto') };
}
function clear() {
  update.setFetcher(null); update.setInstalledRoot(null); update.setAutoPref(null); update.setInstallRunner(null); update.setAutoLog(null); update.setPlatform(null); update.resetCache();
}

test('kosmos#8421: an automatic update says, before it stops the board, what it installs and from which channel', async () => {
  const b = board();
  try {
    paused = false;
    await update.refresh();
    assert.equal(b.children.length, 1, 'control: the look did not start the automatic install');
    assert.equal(b.said.length, 1, JSON.stringify(b.said));
    assert.match(b.said[0], /^Kosmos is updating itself to 99\.0\.0 from the prod channel \(an automatic update, from /);
    assert.ok(b.said[0].includes(path.join(b.root, 'logs', 'install.log')), 'the line does not say where the installer record is');
    const rec = JSON.parse(fs.readFileSync(b.record, 'utf8'));
    assert.equal(rec.to, '99.0.0'); assert.equal(rec.from, RUNNING); assert.equal(rec.channel, 'prod');
  } finally { clear(); }
});

test('kosmos#8421: the next board says it started again on the version the automatic update installed, once', () => {
  const b = board();
  try {
    fs.mkdirSync(path.dirname(b.record), { recursive: true });
    fs.writeFileSync(b.record, JSON.stringify({ from: '0.0.1', to: RUNNING, channel: 'staging' }));
    const line = update.noteAutoUpdateAtBoot();
    assert.equal(line, `Kosmos started again on ${RUNNING} after its automatic update from 0.0.1 (staging channel).`);
    assert.deepEqual(b.said, [line], 'the line did not reach the board log');
    assert.equal(fs.existsSync(b.record), false, 'the record was kept');
    assert.equal(update.noteAutoUpdateAtBoot(), null, 'a second boot reported the same update again');
  } finally { clear(); }
});

test('kosmos#8421: a board that came back on the old version says the automatic update did not finish', async () => {
  const b = board();
  try {
    await update.refresh();   // the real start: line 1, the record for 99.0.0, and the #1728 marker with its stamp
    // The installer failed after stopping the board: its shell writes install.status with the same stamp (review 3).
    const at = JSON.parse(fs.readFileSync(b.record, 'utf8')).startedAt;
    assert.ok(at, 'control: the record carries the attempt stamp');
    fs.writeFileSync(path.join(b.root, 'logs', 'install.status'), '1 ' + at + '\n');
    const line = update.noteAutoUpdateAtBoot();   // it came back on RUNNING
    assert.match(line, new RegExp(`^Kosmos's automatic update to 99\\.0\\.0 \\(prod channel\\) did not finish; this board is running ${RUNNING.replace(/\./g, '\\.')}\\.`));
    assert.equal(b.said.length, 2, 'both lines, before and after, reach the board log: ' + JSON.stringify(b.said));
    assert.equal(fs.existsSync(b.record), false);
  } finally { clear(); }
});

test('kosmos#8421: an automatic installer that ends while the board is still up says so and leaves no record', async () => {
  const b = board();
  try {
    await update.refresh();
    b.children[0].emit('exit', 0);
    assert.match(b.said[1], /^Kosmos's automatic update to 99\.0\.0 did not finish and the board did not stop; it stays on /);
    assert.equal(fs.existsSync(b.record), false, 'the record would make the next boot report it again');
  } finally { clear(); }
});

test('kosmos#8421: CONTROLS: an install the person starts, and a paused update, say nothing of the kind', async () => {
  let b = board();
  try {
    update.setAutoPref(() => ({ on: false, ok: true }));
    await update.refresh();
    assert.equal(b.children.length, 0, 'control: automatic updates are off, so the look started nothing');
    update.beginInstall({});
    assert.equal(b.children.length, 1, 'control: the person\'s install did not launch');
    assert.deepEqual(b.said, [], 'a person\'s install was logged as automatic');
    assert.equal(fs.existsSync(b.record), false);
    b.children[0].emit('exit', 0);
    assert.deepEqual(b.said, [], 'a person\'s install that ended was logged as automatic');
  } finally { clear(); }
  b = board();
  try {
    paused = true;
    await update.refresh();
    assert.equal(b.children.length, 0, 'control: paused, nothing launched');
    assert.deepEqual(b.said, []);
  } finally { paused = false; clear(); }
});

test('kosmos#8421 review 1: an automatic installer that could not even be spawned says so and leaves no record', async () => {
  const b = board();
  try {
    await update.refresh();
    b.children[0].emit('error', new Error('EMFILE'));
    assert.match(b.said[1], /^Kosmos's automatic update to 99\.0\.0 did not finish and the board did not stop; it stays on /);
    assert.equal(fs.existsSync(b.record), false);
  } finally { clear(); }
});

test('kosmos#8421 review 1: a root that is not absolute writes no record anywhere (it once landed in the cwd)', async () => {
  const b = board();
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'autolog-cwd-'));
  const cwd = process.cwd();
  try {
    process.chdir(box);
    update.setInstalledRoot(() => 'C:\\Users\\someone\\Kosmos');
    await update.refresh();
    assert.equal(b.children.length, 1, 'control: the install still launched');
    assert.equal(b.said.length, 1, 'control: the line is still said');
    // Only this card's record is checked: the #1728 in-flight marker (install.started) is written under any root by
    // every install, a person's included, and is not this change's to fix (filed separately).
    const walk = (d) => fs.readdirSync(d).flatMap((n) => { const q = path.join(d, n); return fs.statSync(q).isDirectory() ? walk(q) : [q]; });
    assert.deepEqual(walk(box).filter((f) => f.endsWith('install.auto')), [], 'the record was written relative to the working directory');
  } finally { process.chdir(cwd); clear(); }
});

test('kosmos#8421 review 1: the version is compared as the update check compares it, not as a string', () => {
  const b = board();
  try {
    // Review 2: padding ADDED to the running version, so the arm holds whatever the version is (0.8.03 -> 00.8.03).
    const padded = '0' + RUNNING;
    assert.notEqual(padded, RUNNING);
    fs.mkdirSync(path.dirname(b.record), { recursive: true });
    fs.writeFileSync(b.record, JSON.stringify({ from: '0.0.1', to: padded, channel: 'prod' }));
    assert.match(update.noteAutoUpdateAtBoot(), /^Kosmos started again on /);
  } finally { clear(); }
});

test('kosmos#8421 review 1: on Windows the automatic update writes no line and no record (that half is specified on the card)', async () => {
  const b = board();
  try {
    update.setPlatform('win32', 'x64');
    update.setWindowsBundleRoot(() => b.root);
    update.setFetcher(async () => ({ ok: true, json: async () => ({ version: '99.0.0', sha256: 'ab'.repeat(32), artifact: 'kosmos-win-x64.zip', versioned: 'kosmos-99.0.0-win-x64.zip', arch: 'x64' }) }));
    await update.refresh();
    assert.equal(b.children.length, 1, 'control: the automatic install still launched on win32 (through the runner seam)');
    assert.deepEqual(b.said, [], 'a Windows automatic update was logged as if it stops the board');
    assert.equal(fs.existsSync(b.record), false);
  } finally { update.setPlatform(null); update.setWindowsBundleRoot(null); clear(); }
});

test('kosmos#8421 review 3: a board that restarts while the automatic installer still runs keeps the record for the next one', () => {
  const b = board();
  try {
    const at = '2026-11-11T20:00:00.000Z';
    fs.mkdirSync(path.dirname(b.record), { recursive: true });
    fs.writeFileSync(b.record, JSON.stringify({ from: RUNNING, to: '99.0.0', channel: 'staging', startedAt: at }));
    fs.writeFileSync(path.join(b.root, 'logs', 'install.started'), at + '\n');   // the #1728 marker: the attempt has not ended
    // Review 5: and a LIVE installer holds its pause name (this test's own pid stands in for the installer's).
    const pause = path.join(b.root, 'board.stopped.by-install.' + process.pid + '.tok');
    fs.writeFileSync(pause, '');
    assert.match(update.noteAutoUpdateAtBoot(), /^Kosmos started on .* while its automatic update to 99\.0\.0 \(staging channel\) is still installing;/);
    // The pause name is left in place below: a name whose pid was reused looks live, and the status must still win.
    assert.equal(fs.existsSync(b.record), true, 'the record was removed while the installer still runs, so the board it starts would say nothing');
    // The attempt then ends (install.status carries its stamp) and the board comes back on the old version: now it says so.
    fs.writeFileSync(path.join(b.root, 'logs', 'install.status'), '1 ' + at + '\n');
    assert.match(update.noteAutoUpdateAtBoot(), /^Kosmos's automatic update to 99\.0\.0 \(staging channel\) did not finish;/);
    assert.equal(fs.existsSync(b.record), false);
  } finally { clear(); }
});

test('kosmos#8421 review 3: a board newer than the update it was installing does not say that update did not finish', () => {
  const b = board();
  try {
    fs.mkdirSync(path.dirname(b.record), { recursive: true });
    fs.writeFileSync(b.record, JSON.stringify({ from: '0.0.1', to: '0.0.2', channel: 'prod' }));
    const line = update.noteAutoUpdateAtBoot();
    assert.match(line, /newer than the 0\.0\.2 its last automatic update was installing/);
    assert.doesNotMatch(line, /did not finish/);
  } finally { clear(); }
});

test('kosmos#8421 review 4: a successful update boots with the marker still on disk and still says it started again', () => {
  const b = board();
  try {
    const at = '2026-11-11T20:00:00.000Z';
    fs.mkdirSync(path.dirname(b.record), { recursive: true });
    fs.writeFileSync(b.record, JSON.stringify({ from: '0.0.1', to: RUNNING, channel: 'prod', startedAt: at }));
    fs.writeFileSync(path.join(b.root, 'logs', 'install.started'), at + '\n');   // the shell tail has not run yet
    fs.writeFileSync(path.join(b.root, 'board.stopped.by-install.' + process.pid + '.tok'), '');   // and a name that looks live
    assert.match(update.noteAutoUpdateAtBoot(), new RegExp(`^Kosmos started again on ${RUNNING.replace(/\./g, '\\.')} after its automatic update`));
    assert.equal(fs.existsSync(b.record), false);
  } finally { clear(); }
});

test('kosmos#8421 review 4: an installer killed long ago (old marker, no status) is not "still installing" forever', () => {
  const b = board();
  try {
    const at = '2026-11-11T20:00:00.000Z';
    fs.mkdirSync(path.dirname(b.record), { recursive: true });
    fs.writeFileSync(b.record, JSON.stringify({ from: RUNNING, to: '99.0.0', channel: 'prod', startedAt: at }));
    const marker = path.join(b.root, 'logs', 'install.started');
    fs.writeFileSync(marker, at + '\n');
    const old = (Date.now() - 2 * 3600 * 1000) / 1000;
    fs.utimesSync(marker, old, old);
    // A pause name that looks live (a reused pid stands in as this test's own): the marker's age must still decide.
    fs.writeFileSync(path.join(b.root, 'board.stopped.by-install.' + process.pid + '.tok'), '');
    assert.match(update.noteAutoUpdateAtBoot(), /^Kosmos's automatic update to 99\.0\.0 \(prod channel\) did not finish;/);
    assert.equal(fs.existsSync(b.record), false, 'an interrupted attempt kept its record');
  } finally { clear(); }
});

test('kosmos#8421 review 4: a newer board with the marker still on disk says it is newer, not still installing', () => {
  const b = board();
  try {
    const at = '2026-11-11T20:00:00.000Z';
    fs.mkdirSync(path.dirname(b.record), { recursive: true });
    fs.writeFileSync(b.record, JSON.stringify({ from: '0.0.1', to: '0.0.2', channel: 'prod', startedAt: at }));
    fs.writeFileSync(path.join(b.root, 'logs', 'install.started'), at + '\n');
    fs.writeFileSync(path.join(b.root, 'board.stopped.by-install.' + process.pid + '.tok'), '');
    assert.match(update.noteAutoUpdateAtBoot(), /newer than the 0\.0\.2/);
  } finally { clear(); }
});

test('kosmos#8421 review 5: the common failure order (old board put back, marker fresh, no status yet, no pause) says did not finish', () => {
  const b = board();
  try {
    const at = new Date().toISOString();
    fs.mkdirSync(path.dirname(b.record), { recursive: true });
    fs.writeFileSync(b.record, JSON.stringify({ from: RUNNING, to: '99.0.0', channel: 'prod', startedAt: at }));
    fs.writeFileSync(path.join(b.root, 'logs', 'install.started'), at + '\n');   // seconds old; the shell tail has not run
    assert.match(update.noteAutoUpdateAtBoot(), /^Kosmos's automatic update to 99\.0\.0 \(prod channel\) did not finish;/);
    assert.equal(fs.existsSync(b.record), false, 'a failed update kept its record, so its true line never comes');
  } finally { clear(); }
});

test('kosmos#8421 review 5: a pause name whose installer has ended is not a running install', () => {
  const b = board();
  try {
    const at = new Date().toISOString();
    const gone = require('node:child_process').spawnSync(process.execPath, ['-e', '0']).pid;
    fs.mkdirSync(path.dirname(b.record), { recursive: true });
    fs.writeFileSync(b.record, JSON.stringify({ from: RUNNING, to: '99.0.0', channel: 'prod', startedAt: at }));
    fs.writeFileSync(path.join(b.root, 'logs', 'install.started'), at + '\n');
    fs.writeFileSync(path.join(b.root, 'board.stopped.by-install.' + gone + '.tok'), '');
    assert.match(update.noteAutoUpdateAtBoot(), /did not finish;/);
  } finally { clear(); }
});
