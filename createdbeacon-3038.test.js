'use strict';
/*
 * kosmos#3038: the install / agent-created beacon that moves the frozen homepage
 * counts. Josh ruled the #2623 removal was an AGENT's, not his, and asked for it
 * back. This pins BOTH halves:
 *   - the transmit unit (engine/createdbeacon.js): payload contract + count values
 *     + the under-test guard, via the injected sender seam (no real network);
 *   - the SOURCE WIRING (server.js board-start install ping + create-route created
 *     ping gated on the checkbox; web create-tell checkbox default checked + sent
 *     as notifyCreated), so an edit that unwires the beacon fails the fast suite.
 *
 * The checkbox test also enforces Josh's "hardcode it so everybody knows. Don't
 * take this out." -- removing #create-tell breaks this test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandbox the data root so ping.installId() writes into a temp dir, never a real
// install's store. Must be set BEFORE requiring the module (store.ROOT is read at
// require time via BASE).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'createdbeacon-3038-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;

const beacon = require('./engine/createdbeacon');

function capture() {
  const calls = [];
  beacon.setSender((url, init) => {
    let body = null;
    try { body = JSON.parse(init && init.body); } catch { body = null; }
    calls.push({ url, method: init && init.method, body });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
  });
  return calls;
}

test('payload() pins the collector contract {installId, count, version, os}', () => {
  const p = beacon.payload(4);
  assert.deepEqual(Object.keys(p).sort(), ['count', 'installId', 'os', 'version']);
  assert.equal(p.count, 4);
  assert.equal(typeof p.installId, 'string');
  assert.ok(p.installId.length > 0);
  assert.equal(typeof p.version, 'string');
  assert.ok(p.version.length > 0);
  assert.equal(typeof p.os, 'string');
  assert.ok(p.os.length > 0);
});

test('payload() clamps a bad count to 0 (never NaN/negative)', () => {
  assert.equal(beacon.payload(-3).count, 0);
  assert.equal(beacon.payload(1.5).count, 0);
  assert.equal(beacon.payload('nope').count, 0);
  assert.equal(beacon.payload(undefined).count, 0);
});

test('pingInstall() POSTs count 0 to the created endpoint (install count, no agent info)', async () => {
  const calls = capture();
  beacon.pingInstall();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1, 'exactly one POST');
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /\/api\/created$/);
  assert.equal(calls[0].body.count, 0, 'install ping must carry count 0 -- no agent info leaves');
  beacon.setSender(null);
});

test('pingAgentCreated(n) POSTs the live agent count', async () => {
  const calls = capture();
  beacon.pingAgentCreated(7);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.count, 7, 'created ping must carry the agent count the caller passed');
  beacon.setSender(null);
});

test('an injected sender fires even under the test runner; the guard blocks only the REAL network', async () => {
  // underTest() is true here (node sets NODE_TEST_CONTEXT). With a sender injected,
  // send() must still fire -- otherwise the send path is untestable. The two tests
  // above already prove the injected-sender path fires; this pins the reasoning.
  assert.equal(beacon.underTest(), true, 'the test runner sets NODE_TEST_CONTEXT');
  const calls = capture();
  beacon.pingInstall();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1, 'an injected sender must fire under test');
  beacon.setSender(null);
});

test('the env overrides the endpoint (AGENT_WORKFORCE_CREATED_URL)', async () => {
  const prev = process.env.AGENT_WORKFORCE_CREATED_URL;
  process.env.AGENT_WORKFORCE_CREATED_URL = 'http://127.0.0.1:1/api/created';
  const calls = capture();
  beacon.pingInstall();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls[0].url, 'http://127.0.0.1:1/api/created');
  if (prev === undefined) delete process.env.AGENT_WORKFORCE_CREATED_URL; else process.env.AGENT_WORKFORCE_CREATED_URL = prev;
  beacon.setSender(null);
});

// ---- SOURCE WIRING (payload-agnostic; an unwiring edit fails here) ----

const SERVER = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const WEB = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test('the instruments read something', () => {
  assert.ok(SERVER.length > 100000 && WEB.length > 100000, 'a source read came back short');
});

test('server.js requires the beacon and fires the install ping on board start', () => {
  assert.match(SERVER, /require\('\.\/engine\/createdbeacon'\)/, 'server.js does not require createdbeacon');
  assert.match(SERVER, /createdbeacon\.pingInstall\(\)/, 'server.js never fires the install ping');
});

test('the create route fires the created ping on OUTCOME.CREATED, gated on the checkbox', () => {
  assert.match(SERVER, /createdbeacon\.pingAgentCreated\(/, 'the create route never fires the created ping');
  // Anchor on the gate expression (both clauses in ONE if) and assert the ping
  // fires within the block. Anchoring FORWARD from the gate (not backward a fixed
  // width from the call) is robust to comments added between them -- an earlier
  // fixed-width-before slice broke when a clarifying comment was added inside the
  // block. Runtime behaviour is covered end-to-end in
  // server.createdbeacon-route-3038.test.js; this pins the source wiring.
  const gi = SERVER.indexOf('result.outcome === create.OUTCOME.CREATED && body.notifyCreated !== false');
  assert.ok(gi >= 0, 'the created ping is not gated on OUTCOME.CREATED + notifyCreated (checkbox default-on)');
  assert.match(SERVER.slice(gi, gi + 1000), /createdbeacon\.pingAgentCreated\(/,
    'pingAgentCreated is not inside the CREATED + notifyCreated gate');
});

test('the create form carries the default-checked, hardcoded beacon checkbox', () => {
  // Josh: "hardcode it so everybody knows. Don't take this out." Removing #create-tell
  // (or its `checked`) fails here.
  assert.match(WEB, /<input type="checkbox" id="create-tell" checked>/, 'the create-tell checkbox is missing or not default-checked');
  assert.match(WEB, /b\.notifyCreated = document\.getElementById\('create-tell'\)\.checked/, 'the create request does not send notifyCreated from the checkbox');
});

test('cleanup the sandbox', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});
