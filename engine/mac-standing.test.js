'use strict';

/**
 * Federation Kosmos+ gate, W1 refresh: engine/mac-standing.js -- the board-side
 * mac-cert POST /v1/mac/standing.
 *
 *   node --test engine/mac-standing.test.js
 *
 * The transport is FAKED (setRequestFactory), so enrolment, the cert read and the URL
 * derivation all still run -- only the network is replaced. The properties that make
 * this a safe paid-feature source: it fetches ONLY when enrolled + switched on, it maps
 * the coordinator's answer to a standing string, and EVERY failure resolves to null
 * (upstream then keeps the last-known value; the fed-route 403 is the hard gate).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-macstanding-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-macstanding-state-'));
process.env.AGENT_WORKFORCE_TUNNEL_STATE = STATE;
process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'https://coord.example';
const remote = require('../engine/remote');
const macStanding = require('../engine/mac-standing');

function enroll(on) {
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(STATE, f), 'x');
  fs.mkdirSync(path.dirname(remote.FILE), { recursive: true });
  fs.writeFileSync(remote.FILE, JSON.stringify({ on: on !== false, standing: '' }) + '\n');
}
function unenroll() { for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) { try { fs.rmSync(path.join(STATE, f), { force: true }); } catch { /* ignore */ } } }

// A fake transport that captures opts and drives one response. `mode`:
//  {status, body} -> emit a response; {error:true} -> emit 'error'; {timeout:true} -> 'timeout'.
let lastOpts = null;
function fake(mode) {
  return (opts) => {
    lastOpts = opts;
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () => {
      process.nextTick(() => {
        if (mode.error) { req.emit('error', new Error('down')); return; }
        if (mode.timeout) { req.emit('timeout'); return; }
        const res = new EventEmitter();
        res.statusCode = mode.status;
        res.setEncoding = () => {};
        res.resume = () => {};
        req.emit('response', res);
        process.nextTick(() => {
          if (typeof mode.body === 'string') res.emit('data', mode.body);
          res.emit('end');
        });
      });
    };
    return req;
  };
}
function withFake(mode, fn) { macStanding.setRequestFactory(fake(mode)); return Promise.resolve(fn()).finally(() => macStanding.setRequestFactory(null)); }

test('parseStanding: standing string wins; kosmos_plus bool maps; else null', () => {
  assert.equal(macStanding.parseStanding('{"standing":"good"}'), 'good');
  assert.equal(macStanding.parseStanding('{"standing":"lapsed"}'), 'lapsed');
  assert.equal(macStanding.parseStanding('{"kosmos_plus":true}'), 'good');
  assert.equal(macStanding.parseStanding('{"kosmos_plus":false}'), 'none');
  assert.equal(macStanding.parseStanding('{"standing":"good","kosmos_plus":false}'), 'good', 'the explicit string wins over the bool');
  assert.equal(macStanding.parseStanding('not json'), null);
  assert.equal(macStanding.parseStanding('{"other":1}'), null);
  assert.equal(macStanding.parseStanding('42'), null);
});

test('fetchStanding: NULL and NO request when not enrolled', async () => {
  unenroll();
  lastOpts = null;
  const r = await withFake({ status: 200, body: '{"standing":"good"}' }, () => macStanding.fetchStanding());
  assert.equal(r, null, 'not enrolled -> null');
  assert.equal(lastOpts, null, 'and no request was built');
});

test('fetchStanding: NULL when the switch is off (a paid route is not called)', async () => {
  enroll(false);   // enrolled but on:false
  lastOpts = null;
  const r = await withFake({ status: 200, body: '{"standing":"good"}' }, () => macStanding.fetchStanding());
  assert.equal(r, null, 'off -> null');
  assert.equal(lastOpts, null, 'no request');
});

test('fetchStanding: a 200 good body -> "good", and it used the mac cert + the standing route', async () => {
  enroll();
  const r = await withFake({ status: 200, body: '{"standing":"good"}' }, () => macStanding.fetchStanding());
  assert.equal(r, 'good');
  assert.equal(lastOpts.method, 'POST', 'POST, not GET (verify_mac_request requires POST)');
  assert.ok(String(lastOpts.path).endsWith('/v1/mac/standing'), 'hit the standing route: ' + lastOpts.path);
  assert.ok(lastOpts.cert && lastOpts.key, 'the mac signature = the mTLS client cert + key (same as updating.js)');
  assert.match(String(lastOpts.headers['content-type']), /application\/json/, 'JSON content-type');
  assert.equal(lastOpts.hostname, 'coord.example', 'to the coordinator host');
});

test('fetchStanding: the kosmos_plus bool shape maps too (upgrade + non-member)', async () => {
  enroll();
  assert.equal(await withFake({ status: 200, body: '{"kosmos_plus":true}' }, () => macStanding.fetchStanding()), 'good');
  assert.equal(await withFake({ status: 200, body: '{"kosmos_plus":false}' }, () => macStanding.fetchStanding()), 'none');
});

test('fetchStanding: a non-2xx -> null (keep last-known upstream)', async () => {
  enroll();
  assert.equal(await withFake({ status: 403, body: '{"error":"nope"}' }, () => macStanding.fetchStanding()), null);
  assert.equal(await withFake({ status: 500, body: 'oops' }, () => macStanding.fetchStanding()), null);
});

test('fetchStanding: an unparseable 200 body -> null', async () => {
  enroll();
  assert.equal(await withFake({ status: 200, body: 'not json at all' }, () => macStanding.fetchStanding()), null);
});

test('the SUITE GUARD prevents any real coordinator dial (no injected transport) -- non-vacuous', async () => {
  // NODE_TEST_CONTEXT is set by node --test. With NO injected factory, the guard must fire
  // BEFORE the default transport is reached, so nothing dials login.kosmosplus.com with the
  // bogus test cert. Spy on the DEFAULT transport (module.exports.dispatch, which fetchStanding
  // uses when no factory is set): if the guard regressed, the spy would be called -> this fails.
  enroll();
  macStanding.setRequestFactory(null);
  const realDispatch = macStanding.dispatch;
  let dialed = false;
  macStanding.dispatch = () => { dialed = true; throw new Error('the guard should have prevented a real dial'); };
  try {
    const r = await macStanding.fetchStanding();
    assert.equal(dialed, false, 'the default transport was NEVER invoked -- no real coordinator dial under test');
    assert.equal(r, null, 'and it returned null');
  } finally { macStanding.dispatch = realDispatch; }
});

test('fetchStanding: a transport error or timeout -> null, never throws', async () => {
  enroll();
  await assert.doesNotReject(async () => {
    assert.equal(await withFake({ error: true }, () => macStanding.fetchStanding()), null);
    assert.equal(await withFake({ timeout: true }, () => macStanding.fetchStanding()), null);
  });
});
