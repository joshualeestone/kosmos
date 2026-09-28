'use strict';
/**
 * #4308 (Liu Kang's ruling on the card): an unreadable remote-access settings file must
 *   1. not be produced by an interrupted write (the old file stays whole),
 *   2. stay visible until the PERSON repairs it (a background write must not quietly rewrite it as "off"),
 *   3. be repaired by the person turning remote access on,
 *   4. never be taken as permission for the remote-access STANDING call (mac-standing.fetchStanding). This is
 *      that one call only: federation's own signed calls are gated on enrolment, not on this switch (#4318).
 * Sandboxed data root and a FAKE tunnel program before the require; nothing reaches a network.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-remote-4308-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const EMPTY_STATE = nodePath.join(SANDBOX, 'not-enrolled');
const ENROLLED_STATE = nodePath.join(SANDBOX, 'enrolled');
fs.mkdirSync(EMPTY_STATE, { recursive: true });
fs.mkdirSync(ENROLLED_STATE, { recursive: true });
for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(nodePath.join(ENROLLED_STATE, f), 'x\n');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = EMPTY_STATE;   // not enrolled, so the switch starts no tunnel

const RECORD = nodePath.join(SANDBOX, 'tunnel-calls.jsonl');
const FAKE_BIN = nodePath.join(SANDBOX, 'fake-kosmos-tunnel');
fs.writeFileSync(FAKE_BIN, `#!/usr/bin/env node
require('node:fs').appendFileSync(${JSON.stringify(RECORD)}, JSON.stringify(process.argv.slice(2)) + '\\n');
process.stdout.write('{}\\n');
`, { mode: 0o755 });
process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_BIN;

const remote = require('./remote');
const standing = require('./mac-standing');
const FILE = remote.FILE;
const DIR = nodePath.dirname(FILE);
const DAMAGED = '{"on": true, "relay": "rel';   // cut short, as an interrupted write would leave it

function saveGood(obj) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(obj) + '\n'); }
function leftovers() { return fs.readdirSync(DIR).filter((n) => n.startsWith('remote.json.') && n.endsWith('.tmp')); }
function calls() { try { return fs.readFileSync(RECORD, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } }

test('1a. a write interrupted before the rename leaves the previous file whole and readable', () => {
  saveGood({ on: false, relay: 'old.example:443' });
  const before = fs.readFileSync(FILE, 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated crash before the rename'); };
  let r;
  try { r = remote.setRelay('new.example:443'); } finally { fs.renameSync = rename; }
  assert.equal(r.ok, false, 'the interrupted save claimed success');
  assert.equal(fs.readFileSync(FILE, 'utf8'), before, 'the previous file changed');
  assert.equal(remote.read().ok, true);
  assert.equal(remote.read().relay, 'old.example:443');
  assert.deepEqual(leftovers(), [], 'a temporary file was left behind');
});

test('1b. a write cut off half-way through its bytes leaves the previous file whole and readable', () => {
  saveGood({ on: false, relay: 'old.example:443' });
  const before = fs.readFileSync(FILE, 'utf8');
  const writeSync = fs.writeSync;
  fs.writeSync = (fd, data) => { writeSync(fd, String(data).slice(0, 7)); throw new Error('simulated crash mid-write'); };
  let r;
  try { r = remote.setRelay('new.example:443'); } finally { fs.writeSync = writeSync; }
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(FILE, 'utf8'), before, 'half a write reached the real file');
  assert.equal(remote.read().ok, true);
  assert.deepEqual(leftovers(), []);
});

test('1c. a completed write is flushed before the rename, and leaves no temporary file', () => {
  saveGood({ on: false });
  const order = [];
  const fsync = fs.fsyncSync; const rename = fs.renameSync;
  fs.fsyncSync = (fd) => { order.push('fsync'); return fsync(fd); };
  fs.renameSync = (a, b) => { order.push('rename'); return rename(a, b); };
  try { assert.equal(remote.setRelay('new.example:443').ok, true); } finally { fs.fsyncSync = fsync; fs.renameSync = rename; }
  assert.equal(order[0], 'fsync', 'the bytes were not flushed before the rename: ' + order.join(','));
  assert.ok(order.includes('rename'));
  assert.equal(remote.read().relay, 'new.example:443');
  assert.deepEqual(leftovers(), []);
});

test('2. a background write leaves a damaged file exactly as it is, so the person can still be told', () => {
  saveGood({});
  fs.writeFileSync(FILE, DAMAGED);
  assert.equal(remote.read().ok, false, 'the fixture is not unreadable');
  remote.fedSetStanding('member');   // the standing cache: a background write
  assert.equal(fs.readFileSync(FILE, 'utf8'), DAMAGED, 'a background write rewrote the damaged file');
  assert.equal(remote.read().ok, false, 'the unreadable state was erased before the person saw it');
});

test('3. the person turning remote access on repairs the file', () => {
  fs.writeFileSync(FILE, DAMAGED);
  assert.equal(remote.setOn(true).ok, true);
  const now = remote.read();
  assert.equal(now.ok, true, 'the switch did not repair the file');
  assert.equal(now.on, true);
  remote.setOn(false);
});

test('4. no remote-access standing call while the file is unreadable; the same enrolled Mac with a readable ON file does call', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_STATE = ENROLLED_STATE;
  try {
    // Control first: the test can see a call when one is allowed.
    saveGood({ on: true });
    fs.rmSync(RECORD, { force: true });
    await standing.fetchStanding();
    assert.ok(calls().length > 0, 'control: an enrolled, switched-on Mac made no call, so this test cannot see one');

    fs.writeFileSync(FILE, DAMAGED);
    fs.rmSync(RECORD, { force: true });
    assert.equal(await standing.fetchStanding(), null);
    assert.deepEqual(calls(), [], 'the standing call went out on an unreadable settings file');
  } finally {
    process.env.AGENT_WORKFORCE_TUNNEL_STATE = EMPTY_STATE;
  }
});

test('5. a sign-in on a damaged file keeps its device id through the repair (no second "this computer")', async () => {
  remote.resetForTests();
  fs.writeFileSync(FILE, DAMAGED);
  fs.rmSync(RECORD, { force: true });
  await remote.signinStart('her@example.com');   // mints the device id; its own write is refused on the damaged file
  const start = calls().map((l) => JSON.parse(l)).find((a) => a[0] === 'signin' && a[1] === 'start');
  assert.ok(start, 'control: the sign-in never reached the tunnel, so no device id was minted');
  const minted = start[start.indexOf('--device-id') + 1];
  assert.match(minted, /^[A-Za-z0-9_-]+$/);
  assert.equal(fs.readFileSync(FILE, 'utf8'), DAMAGED, 'the mint repaired the file on its own');
  assert.equal(remote.setOn(true).ok, true);        // the person's repair
  assert.equal(remote.read().device_id, minted, 'the repair dropped the device id the sign-in used');
  remote.setOn(false);
  remote.resetForTests();
});

test('6. a save removes temporary files left by a killed write, but never a fresh one', () => {
  saveGood({ on: false });
  // A pid that is certainly dead: a child that has already exited.
  const deadPid = require('node:child_process').spawnSync(process.execPath, ['-e', '0']).pid;
  const stale = FILE + '.' + deadPid + '.deadbeef.tmp';
  const fresh = FILE + '.99998.cafef00d.tmp';
  const liveOld = FILE + '.' + process.ppid + '.0badc0de.tmp';   // an OLD file whose writer is still running
  fs.writeFileSync(stale, '{"on":true,"email":"old@example.com"}');
  fs.writeFileSync(fresh, '{"on":true}');
  fs.writeFileSync(liveOld, '{"on":true}');
  const old = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(stale, old, old);
  fs.utimesSync(liveOld, old, old);
  assert.equal(remote.setRelay('sweep.example:443').ok, true);
  assert.equal(fs.existsSync(stale), false, 'a stale temporary file (with a copy of the settings) was left');
  assert.equal(fs.existsSync(fresh), true, 'a fresh temporary file, possibly a live writer, was removed');
  assert.equal(fs.existsSync(liveOld), true, 'an old temporary file of a still-running writer was removed');
  // Past a day even a live pid does not shelter it: pids are reused, and no save stalls that long.
  const ancient = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  fs.utimesSync(liveOld, ancient, ancient);
  assert.equal(remote.setRelay('sweep2.example:443').ok, true);
  assert.equal(fs.existsSync(liveOld), false, 'a day-old temporary file survived because its pid is in use');
  fs.rmSync(fresh, { force: true });
});
