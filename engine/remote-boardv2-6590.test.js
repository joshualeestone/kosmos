'use strict';
require('../test-support/tmpscope');
/* kosmos#6590 (S-7d branch c, c6): the board writes the board-v2 marker that turns the v2 gate on, only when everything
   it turns on is here, and never removes it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-boardv2-6590-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const STATE = path.join(SANDBOX, 'tunnel-state');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
process.env.AGENT_WORKFORCE_TUNNEL_BIN = '/usr/bin/false';
process.env.AGENT_WORKFORCE_TUNNEL_RELAY = 'relay.test:443';
const remote = require('./remote');

const MARKER = path.join(STATE, 'board-v2');
const WITH = () => new Set(['session-headers', 'device-proof-v2']);
const WITHOUT = () => new Set(['session-headers']);
function setup({ on = true, enrolled = true } = {}) {
  remote.resetForTests();
  fs.rmSync(STATE, { recursive: true, force: true });
  fs.mkdirSync(STATE, { recursive: true });
  if (enrolled) for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'fake');
  remote.setOn(on);
}
test.after(() => { remote.resetForTests(); delete process.env.KOSMOS_BOARD_V2; fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('c6: written only when on, enrolled and the connector carries device-proof-v2; owner-only; once', () => {
  setup();
  assert.equal(remote.writeBoardV2IfReadyForTests(WITHOUT), false, 'a connector without the capability');
  assert.ok(!fs.existsSync(MARKER));
  assert.equal(remote.writeBoardV2IfReadyForTests(WITH), true);
  assert.ok(fs.existsSync(MARKER));
  if (process.platform !== 'win32') assert.equal(fs.statSync(MARKER).mode & 0o777, 0o600);
  assert.equal(remote.boardV2(), true);
  assert.equal(remote.writeBoardV2IfReadyForTests(WITH), false, 'written again though it is there');
  assert.deepEqual(fs.readdirSync(STATE).filter((f) => f.startsWith('board-v2.new-')), [], 'a temporary file was left');
});

test('c6: not while off, not before enrolment, and not when KOSMOS_BOARD_V2=0 holds it back', () => {
  setup({ on: false });
  assert.equal(remote.writeBoardV2IfReadyForTests(WITH), false);
  setup({ enrolled: false });
  assert.equal(remote.writeBoardV2IfReadyForTests(WITH), false);
  setup();
  process.env.KOSMOS_BOARD_V2 = '0';
  try { assert.equal(remote.writeBoardV2IfReadyForTests(WITH), false); } finally { delete process.env.KOSMOS_BOARD_V2; }
  assert.ok(!fs.existsSync(MARKER));
  assert.equal(remote.writeBoardV2IfReadyForTests(WITH), true, 'control: the same state without the hold writes it');
});

test('c6: the marker turns on what is built for it, and nothing in the board removes it', () => {
  // Every part it switches on must be here (c1 to c4); c6 must never ship without them.
  for (const name of ['boardV2', 'devicesWaiting', 'deviceAllowCode', 'deviceDropWaiting', 'devicesClearWaiting', 'deviceCtAck', 'listedAsComputer']) {
    assert.equal(typeof remote[name], 'function', name + ' is missing: the marker would switch on a board that cannot let anyone in');
  }
  const src = fs.readFileSync(path.join(__dirname, 'remote.js'), 'utf8');
  for (const piece of ['function deviceAckSelf(', 'function vouchStepV2(', 'function deviceAllowVouched(']) assert.ok(src.includes(piece), piece);
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.ok(page.includes('id="plus-waiting"') && page.includes('data-wait="ctack"'), 'the page that lets a browser in is missing');
  // Never removed by the board on its own (review 1: a regex for unlink(...BOARD_V2_FILE) could not match the
  // path.join form, so it guarded nothing). The marker's name is used in exactly three places: where it is declared,
  // the writer, and the reader. A removal anywhere needs a fourth, and the writer never removes its target.
  const uses = src.split('\n').filter((l) => l.includes('BOARD_V2_FILE'));
  assert.equal(uses.length, 3, 'the marker name is used somewhere new (a removal?):\n' + uses.join('\n'));
  assert.ok(uses[0].includes("const BOARD_V2_FILE = 'board-v2'") && uses[2].includes('existsSync'), uses.join('\n'));
  for (const l of uses) assert.doesNotMatch(l, /\b(unlink|rm|rmdir)(Sync)?\s*\(/, 'a line that names the marker removes something: ' + l);
  const writer = src.slice(src.indexOf('function writeBoardV2IfReady('), src.indexOf('function boardV2()'));
  assert.ok(writer.length > 0 && !/(unlink|rm)Sync\(\s*target\b/.test(writer), 'the writer removes its own target');
  // ...and no other board file names the marker as a quoted string (comments may mention it).
  for (const f of ['server.js', path.join('engine', 'enrolment.js')]) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), /['"`]board-v2['"`]/, f + ' names the marker');
  }
  // The tick writes it: ensure() calls the writer (review 1: deleting the call kept every test green).
  const ensure = src.slice(src.indexOf('function ensure(port)'), src.indexOf('function ensure(port)') + 1200);
  assert.ok(/\n\s*writeBoardV2IfReady\(\);/.test(ensure), 'ensure() no longer writes the marker');
});

test('c6 review 1: any KOSMOS_BOARD_V2 but unset, 1 or on holds the write back (a mistyped off is still off)', () => {
  try {
    for (const v of ['0', '0 ', 'false', 'OFF', 'no', 'hold', ' 0']) {
      setup();
      process.env.KOSMOS_BOARD_V2 = v;
      assert.equal(remote.writeBoardV2IfReadyForTests(WITH), false, JSON.stringify(v) + ' did not hold it');
      assert.ok(!fs.existsSync(MARKER));
    }
    for (const v of ['1', 'on', ' ON ', '']) {
      setup();
      process.env.KOSMOS_BOARD_V2 = v;
      assert.equal(remote.writeBoardV2IfReadyForTests(WITH), true, 'control: ' + JSON.stringify(v) + ' writes it');
    }
  } finally { delete process.env.KOSMOS_BOARD_V2; }
});

test('c6 review 1: not while this computer still waits for an older computer\'s Allow', () => {
  setup({ enrolled: false });
  for (const f of ['mac_id', 'address', 'held']) fs.writeFileSync(path.join(STATE, f), 'fake');
  assert.equal(remote.writeBoardV2IfReadyForTests(WITH), false, 'written mid-join');
  fs.rmSync(path.join(STATE, 'held'));
  for (const f of ['tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'fake');
  assert.equal(remote.writeBoardV2IfReadyForTests(WITH), true, 'control: once joined it is written');
});

test('c6 review 1: the default capabilities are the connector\'s own (a connector that lists nothing writes nothing)', () => {
  setup();
  // AGENT_WORKFORCE_TUNNEL_BIN is /usr/bin/false here: it lists no capability.
  assert.equal(remote.writeBoardV2IfReadyForTests(), false);
  assert.ok(!fs.existsSync(MARKER));
  assert.equal(remote.writeBoardV2IfReadyForTests(WITH), true, 'control: the same state with the capability');
});

test('c6 review 1: a failed write leaves no temporary file, and a failure that lasts is said once', () => {
  setup();
  const realRename = fs.renameSync;
  const realWrite = process.stderr.write;
  const said = [];
  fs.renameSync = () => { const e = new Error('refused'); e.code = 'EACCES'; throw e; };
  process.stderr.write = (chunk, ...rest) => { if (/board-v2 marker/.test(String(chunk))) { said.push(String(chunk)); return true; } return realWrite.call(process.stderr, chunk, ...rest); };
  try {
    for (let i = 0; i < 3; i++) assert.equal(remote.writeBoardV2IfReadyForTests(WITH), false);
  } finally { fs.renameSync = realRename; process.stderr.write = realWrite; }
  assert.deepEqual(fs.readdirSync(STATE).filter((f) => f.startsWith('board-v2')), [], 'a temporary file was left');
  assert.equal(said.length, 1, 'said ' + said.length + ' times');
  assert.equal(remote.writeBoardV2IfReadyForTests(WITH), true, 'control: once the folder takes it, it is written');
});
