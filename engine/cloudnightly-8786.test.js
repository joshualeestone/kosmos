'use strict';
/**
 * kosmos#8786 S2: engine/cloudnightly.js decides whether a Kosmos Cloud box installs the newest PROD build tonight.
 * Every gate is driven alone from an all-pass baseline, so each test shows that one gate (and only it) skips the night.
 *
 *   node --test engine/cloudnightly-8786.test.js
 */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const cn = require('./cloudnightly');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cloudnightly-8786-'));
const idle = { agents: [{ sessionName: 'a', state: 'idle' }, { sessionName: 'b', state: 'needs_you' }] };
const working = { agents: [{ sessionName: 'a', state: 'idle' }, { sessionName: 'b', state: 'working' }] };

/* Everything passes: a Cloud Linux box, updates on, no install under way, the signed check there, nobody working. */
function base(over = {}) {
  const waits = [];
  const looks = [];
  const statuses = over.statuses || [idle, idle];
  const opts = {
    platform: 'linux',
    isCloud: () => true,
    updatesOn: () => ({ on: true, ok: true }),
    home: '/nowhere',
    clock: () => 1e12,
    startedAge: () => null,
    signed: () => ({ ok: true }),
    status: async () => { const s = statuses[looks.length]; looks.push(s); if (s instanceof Error) throw s; return s; },
    wait: async (ms) => { waits.push(ms); },
    ...over,
  };
  delete opts.statuses;
  return { opts, waits, looks };
}

test('CONTROL: with every gate passing the night runs, after two looks a few minutes apart', async () => {
  const { opts, waits, looks } = base();
  assert.deepEqual(await cn.decide(opts), { run: true });
  assert.equal(looks.length, 2, 'two looks at the board');
  assert.deepEqual(waits, [cn.SECOND_LOOK_MS], 'one wait, between them');
  assert.ok(cn.SECOND_LOOK_MS >= 60 * 1000, 'the second look is minutes later, not at once');
});

test('not Linux, or not a Cloud box: skipped quietly, and nothing else is asked', async () => {
  for (const over of [{ platform: 'darwin' }, { platform: 'win32' }, { isCloud: () => false }, { isCloud: () => { throw new Error('x'); } }]) {
    let asked = false;
    const { opts } = base({ ...over, updatesOn: () => { asked = true; return { on: true, ok: true }; } });
    const d = await cn.decide(opts);
    assert.equal(d.run, false);
    assert.equal(d.quiet, true, 'a computer that is not a Cloud box leaves no line: ' + JSON.stringify(over));
    assert.equal(asked, false);
  }
});

test('the Updates switch off, or unreadable, skips the night with a line', async () => {
  const off = await cn.decide(base({ updatesOn: () => ({ on: false, ok: true }) }).opts);
  assert.equal(off.run, false); assert.ok(!off.quiet); assert.match(off.why, /turned off/);
  const bad = await cn.decide(base({ updatesOn: () => ({ on: false, ok: false }) }).opts);
  assert.equal(bad.run, false); assert.match(bad.why, /could not be read/);
  const threw = await cn.decide(base({ updatesOn: () => { throw new Error('x'); } }).opts);
  assert.equal(threw.run, false);
});

test('an install started under 30 minutes ago skips; an older marker (an interrupted run) does not', async () => {
  const fresh = await cn.decide(base({ startedAge: () => cn.INSTALL_FRESH_MS - 1 }).opts);
  assert.equal(fresh.run, false); assert.match(fresh.why, /less than 30 minutes/);
  const old = await cn.decide(base({ startedAge: () => cn.INSTALL_FRESH_MS + 1 }).opts);
  assert.deepEqual(old, { run: true });
});

test('an install started during the wait between the looks skips the night', async () => {
  let n = 0;
  const { opts, waits } = base({ startedAge: () => (n++ === 0 ? null : 1000) });
  const d = await cn.decide(opts);
  assert.equal(d.run, false); assert.match(d.why, /while it was checking/);
  assert.equal(waits.length, 1, 'checked again after the wait');
});

test('the real command entry prints one line: off Linux, a quiet skip', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, [require('node:path').join(__dirname, 'cloudnightly.js'), 'decide'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, process.platform === 'linux' ? r.stdout : 'skip\tquiet\tnot Linux\n');
  assert.match(r.stdout, /^(run|skip\t(quiet|said)\t[^\t\n]+)\n$/, 'the shape cmd_cloud_update reads');
});

test('no signed check skips the night with the reason', async () => {
  const d = await cn.decide(base({ signed: () => ({ ok: false, because: 'no signing key is pinned in this install' }) }).opts);
  assert.equal(d.run, false); assert.ok(!d.quiet); assert.match(d.why, /signature check is not available: no signing key/);
  const threw = await cn.decide(base({ signed: () => { throw new Error('boom'); } }).opts);
  assert.equal(threw.run, false); assert.match(threw.why, /boom/);
});

test('an agent working at the first look skips at once; at the second look, skips too', async () => {
  const first = base({ statuses: [working, idle] });
  const d1 = await cn.decide(first.opts);
  assert.equal(d1.run, false); assert.match(d1.why, /an agent is working \(b\)$/);
  assert.equal(first.waits.length, 0, 'no wait once the first look is busy');
  const second = base({ statuses: [idle, working] });
  const d2 = await cn.decide(second.opts);
  assert.equal(d2.run, false); assert.match(d2.why, /\(b\), at the second look/);
});

test('needs_you is not working: an agent asking the person does not hold the night', async () => {
  assert.deepEqual(await cn.decide(base({ statuses: [{ agents: [{ sessionName: 'q', state: 'needs_you' }] }, idle] }).opts), { run: true });
});

test('a board that cannot be read, or answers without an agents list, skips the night', async () => {
  const down = await cn.decide(base({ statuses: [new Error('connect ECONNREFUSED')] }).opts);
  assert.equal(down.run, false); assert.match(down.why, /board could not be read \(connect ECONNREFUSED\)/);
  const shapeless = await cn.decide(base({ statuses: [{ version: '1' }] }).opts);
  assert.equal(shapeless.run, false); assert.match(shapeless.why, /no agents list/);
});

test('signedCheck: verifier, bundled node and a pinned key are each required', () => {
  const h = dir();
  assert.match(cn.signedCheck(h).because, /signature checker is missing/);
  fs.mkdirSync(path.join(h, 'app', 'engine'), { recursive: true });
  const mv = path.join(h, 'app', 'engine', 'manifest-verify.js');
  fs.writeFileSync(mv, 'module.exports = { KEYS: [] };');
  assert.match(cn.signedCheck(h).because, /bundled runtime is missing/);
  fs.mkdirSync(path.join(h, 'runtime', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(h, 'runtime', 'bin', 'node'), '');
  assert.match(cn.signedCheck(h).because, /no signing key is pinned/);
  const h2 = dir();
  fs.mkdirSync(path.join(h2, 'app', 'engine'), { recursive: true });
  fs.mkdirSync(path.join(h2, 'runtime', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(h2, 'runtime', 'bin', 'node'), '');
  fs.writeFileSync(path.join(h2, 'app', 'engine', 'manifest-verify.js'), 'module.exports = { KEYS: ["k"] };');
  assert.deepEqual(cn.signedCheck(h2), { ok: true });
});

test('installStartedAge reads logs/install.started, null when absent', () => {
  const h = dir();
  assert.equal(cn.installStartedAge(h), null);
  fs.mkdirSync(path.join(h, 'logs'));
  fs.writeFileSync(path.join(h, 'logs', 'install.started'), 'x');
  const age = cn.installStartedAge(h, Date.now() + 5000);
  assert.ok(age >= 4000 && age < 60000, String(age));
});

test('readStatus sends the board token and rejects a non-200', async () => {
  let seen = null;
  let code = 200;
  const srv = http.createServer((req, res) => {
    seen = req.headers[require('./boardauth').HEADER_NAME];
    res.statusCode = code; res.end(JSON.stringify(idle));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const { port } = srv.address();
    assert.deepEqual(await cn.readStatus({ port, token: 'tok' }), idle);
    assert.equal(seen, 'tok');
    code = 403;
    await assert.rejects(cn.readStatus({ port, token: 'tok' }), /answered 403/);
  } finally { srv.close(); }
});
