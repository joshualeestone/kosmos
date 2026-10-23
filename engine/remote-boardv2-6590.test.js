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
  // Never removed by the board: no unlink of the marker anywhere in the engine.
  assert.doesNotMatch(src, /(unlink|rm)Sync\([^)]*BOARD_V2_FILE/, 'the board removes the marker somewhere');
});
