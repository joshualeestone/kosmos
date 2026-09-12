'use strict';
/**
 * kosmos#2790: the codex ChatGPT sign-in liveness detection.
 *
 * Two layers:
 *  - engine/codexsigninlive.js `classify()` / `liveness()`: parse codex doctor --json into
 *    live/dead/unknown, cached per home. The doctor shapes below are REAL, captured on this
 *    box (codex-cli 0.149.1): a live sign-in and a synthetic dead one (bogus token).
 *  - openaiaccounts.checkLive's chatgpt branch: maps that verdict to the 3-outcome contract
 *    Ice Cream Kitty's #2338 consumers read (CONNECTED / NONE+reauthRequired / UNKNOWN).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Seal every home root BEFORE requiring the modules, the same discipline the sibling
// account tests use, so nothing reads the operator's real ~/.codex.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-signin-live-2790-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const live = require('./engine/codexsigninlive');
const openai = require('./engine/openaiaccounts');

// Real captured shapes, trimmed to the fields classify() reads.
const DOC_LIVE = JSON.stringify({ checks: {
  'network.websocket_reachability': { status: 'ok', details: { 'handshake result': 'HTTP 101 Switching Protocols' } },
  'network.provider_reachability': { status: 'ok', details: { 'reachability mode': 'ChatGPT auth' } },
} });
const DOC_DEAD = JSON.stringify({ checks: {
  'network.websocket_reachability': { status: 'warning', details: { 'handshake transport error': '<redacted>' } },
  'network.provider_reachability': { status: 'ok' },
} });
const DOC_NETWORK = JSON.stringify({ checks: {
  'network.websocket_reachability': { status: 'error' },
  'network.provider_reachability': { status: 'error' },
} });

test('classify: live handshake (ws ok) -> live', () => {
  assert.equal(live.classify(DOC_LIVE), 'live');
});

test('classify: handshake refused (ws not-ok) but endpoint reachable -> dead', () => {
  assert.equal(live.classify(DOC_DEAD), 'dead');
});

test('classify: endpoint itself unreachable (provider not-ok) -> unknown, never dead (the #1930 never-false-red rule)', () => {
  // The dangerous mistake would be reading a network fault as a dead credential. Pin that it does not.
  assert.equal(live.classify(DOC_NETWORK), 'unknown');
});

test('classify: unparseable / missing checks -> unknown', () => {
  assert.equal(live.classify('not json'), 'unknown');
  assert.equal(live.classify('{}'), 'unknown');
  assert.equal(live.classify(JSON.stringify({ checks: {} })), 'unknown');
});

test('classify control: ws ok with provider MISSING still reads live (status is codex own verdict)', () => {
  // Guards that the live arm keys on ws.status === "ok" and does not accidentally require provider.
  assert.equal(live.classify(JSON.stringify({ checks: { 'network.websocket_reachability': { status: 'ok' } } })), 'live');
});

test('classify control: ws not-ok with provider MISSING is unknown, not dead', () => {
  // Dead requires positive evidence the endpoint was reachable; a missing provider check is not that.
  assert.equal(live.classify(JSON.stringify({ checks: { 'network.websocket_reachability': { status: 'warning' } } })), 'unknown');
});

// --- the NAMED cause (auth vs transport), the #2790 UPDATE's discriminator ---

test('classifyDetailed: names the cause for every arm, and NEVER confuses transport with auth', () => {
  // live: nothing failed, so no cause.
  assert.deepEqual(live.classifyDetailed(DOC_LIVE), { verdict: 'live', cause: null });
  // dead: endpoint reachable, handshake refused -> the credential.
  assert.deepEqual(live.classifyDetailed(DOC_DEAD), { verdict: 'dead', cause: 'authentication_rejected' });
  // the load-bearing distinction: a ws failure with the endpoint ALSO unreachable is the network,
  // never the credential -- unknown/transport_unreachable, and specifically NOT authentication_rejected.
  assert.deepEqual(live.classifyDetailed(DOC_NETWORK), { verdict: 'unknown', cause: 'transport_unreachable' });
  assert.notEqual(live.classifyDetailed(DOC_NETWORK).cause, 'authentication_rejected',
    'a network fault must never be attributed to the credential (the #1930 never-false-red rule, at the cause layer)');
});

test('classifyDetailed: no usable signal is indeterminate, distinct from transport_unreachable', () => {
  for (const bad of ['not json', '{}', JSON.stringify({ checks: {} })]) {
    assert.deepEqual(live.classifyDetailed(bad), { verdict: 'unknown', cause: 'indeterminate' },
      'unparseable/missing-checks must be indeterminate, not a transport claim: ' + bad);
  }
  // ws present but no status at all -> indeterminate (we saw no verdict), not transport.
  assert.deepEqual(live.classifyDetailed(JSON.stringify({ checks: { 'network.websocket_reachability': {} } })),
    { verdict: 'unknown', cause: 'indeterminate' });
});

test('classifyDetailed control: ws not-ok with provider MISSING is transport_unreachable, not dead', () => {
  // A missing provider check is not positive evidence the endpoint was reachable, so the handshake
  // failure cannot be blamed on the credential -- unknown, and the cause names the transport doubt.
  assert.deepEqual(live.classifyDetailed(JSON.stringify({ checks: { 'network.websocket_reachability': { status: 'warning' } } })),
    { verdict: 'unknown', cause: 'transport_unreachable' });
});

test('classify() is exactly classifyDetailed().verdict on every arm (one derivation, cannot drift)', () => {
  for (const doc of [DOC_LIVE, DOC_DEAD, DOC_NETWORK, 'not json', '{}',
      JSON.stringify({ checks: { 'network.websocket_reachability': { status: 'ok' } } })]) {
    assert.equal(live.classify(doc), live.classifyDetailed(doc).verdict,
      'classify() and classifyDetailed() disagreed, so they are deriving the verdict twice: ' + doc);
  }
});

test('livenessDetailed: returns { verdict, cause }, caches the pair, and a failed runner is indeterminate (never dead)', async () => {
  live.resetForTest();
  let calls = 0;
  live.setRunner(async () => { calls += 1; return { ok: true, stdout: DOC_DEAD }; });
  assert.deepEqual(await live.livenessDetailed('/acct/cause-a', 1000), { verdict: 'dead', cause: 'authentication_rejected' });
  // cached pair within the TTL, and the plain liveness() projection reads the SAME cache entry.
  assert.deepEqual(await live.livenessDetailed('/acct/cause-a', 1000 + live.TTL_MS - 1), { verdict: 'dead', cause: 'authentication_rejected' });
  assert.equal(await live.liveness('/acct/cause-a', 1000 + live.TTL_MS - 1), 'dead', 'liveness() must share livenessDetailed cache');
  assert.equal(calls, 1, 'the detailed + plain reads spawned more than one doctor, so they are not sharing the cache');
  // a runner that could not produce a report is indeterminate, never a false dead.
  live.resetForTest();
  live.setRunner(async () => ({ ok: false }));
  assert.deepEqual(await live.livenessDetailed('/acct/cause-b', 1000), { verdict: 'unknown', cause: 'indeterminate' });
});

test('liveness: maps the injected runner output and CACHES within the TTL', async () => {
  live.resetForTest();
  let calls = 0;
  live.setRunner(async () => { calls += 1; return { ok: true, stdout: DOC_DEAD }; });
  assert.equal(await live.liveness('/acct/a', 1000), 'dead');
  assert.equal(await live.liveness('/acct/a', 1000 + live.TTL_MS - 1), 'dead', 'a call within the TTL must reuse the cached verdict');
  assert.equal(calls, 1, 'the runner ran more than once inside the TTL, so it is not cached');
});

test('liveness: re-runs after the TTL expires', async () => {
  live.resetForTest();
  let calls = 0;
  const outs = [DOC_DEAD, DOC_LIVE];
  live.setRunner(async () => { const s = outs[calls] || DOC_LIVE; calls += 1; return { ok: true, stdout: s }; });
  assert.equal(await live.liveness('/acct/b', 1000), 'dead');
  assert.equal(await live.liveness('/acct/b', 1000 + live.TTL_MS), 'live', 'past the TTL the verdict must refresh');
  assert.equal(calls, 2);
});

test('liveness: a failed/empty runner is unknown, never dead (an errored check must not redden)', async () => {
  live.resetForTest();
  live.setRunner(async () => ({ ok: false }));
  assert.equal(await live.liveness('/acct/c', 1000), 'unknown');
  live.resetForTest();
  live.setRunner(async () => { throw new Error('spawn blew up'); });
  assert.equal(await live.liveness('/acct/c', 1000), 'unknown');
});

test('liveness: concurrent callers on a miss share ONE runner invocation', async () => {
  live.resetForTest();
  let calls = 0;
  live.setRunner(() => new Promise((r) => { calls += 1; setTimeout(() => r({ ok: true, stdout: DOC_LIVE }), 5); }));
  const [a, b, c] = await Promise.all([live.liveness('/acct/d', 1000), live.liveness('/acct/d', 1000), live.liveness('/acct/d', 1000)]);
  assert.deepEqual([a, b, c], ['live', 'live', 'live']);
  assert.equal(calls, 1, 'three concurrent callers spawned three doctors instead of sharing one');
});

// --- checkLive integration: the 3-outcome contract Ice Cream Kitty's #2338 consumers read ---

function seedChatgpt(label) {
  const dir = path.join(SANDBOX, '.codex-' + label);
  fs.mkdirSync(dir, { recursive: true });
  // A minimal chatgpt-shaped auth.json (identityFromData needs auth_mode + an id_token to
  // decode; the email is cosmetic here). No real token: liveness is driven by the injected runner.
  const payload = Buffer.from(JSON.stringify({ email: label + '@example.com' })).toString('base64url');
  fs.writeFileSync(path.join(dir, 'auth.json'),
    JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: 'h.' + payload + '.s' } }));
  return dir;
}

test('checkLive(chatgpt) LIVE -> CONNECTED, reauthRequired:false', async () => {
  live.resetForTest();
  live.setRunner(async () => ({ ok: true, stdout: DOC_LIVE }));
  const r = await openai.checkLive(seedChatgpt('livecase'));
  assert.equal(r.state, 'connected');
  assert.equal(r.reauthRequired, false);
});

test('checkLive(chatgpt) DEAD -> NONE, reauthRequired:true (the "sign in again" case)', async () => {
  live.resetForTest();
  live.setRunner(async () => ({ ok: true, stdout: DOC_DEAD }));
  const r = await openai.checkLive(seedChatgpt('deadcase'));
  assert.equal(r.state, 'none');
  assert.equal(r.reauthRequired, true, 'a dead sign-in must be distinguishable from never-signed-in so the driver offers "sign in again"');
});

test('checkLive(chatgpt) network-uncheckable -> UNKNOWN, reauthRequired:false (no red on a network blip)', async () => {
  live.resetForTest();
  live.setRunner(async () => ({ ok: true, stdout: DOC_NETWORK }));
  const r = await openai.checkLive(seedChatgpt('netcase'));
  assert.equal(r.state, 'unknown');
  assert.equal(r.reauthRequired, false);
});

test('checkLive control: never-signed-in (no auth.json) -> NONE, reauthRequired:false (the DISTINCT "sign in" case)', async () => {
  live.resetForTest();
  // A runner that would say LIVE if it ran, to prove the absent path does NOT consult it.
  live.setRunner(async () => ({ ok: true, stdout: DOC_LIVE }));
  const empty = path.join(SANDBOX, '.codex-nobody');
  fs.mkdirSync(empty, { recursive: true });
  const r = await openai.checkLive(empty);
  assert.equal(r.state, 'none');
  assert.equal(r.reauthRequired, false);
  // and it is distinct from the dead case by reauthRequired, which is the whole (b)-vs-(c) split.
});

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* temp */ } });
