'use strict';
/**
 * kosmos#6589 (S-7c): tlsPin asks the tunnel which TLS key another of the person's computers vouches for. Every tunnel
 * call goes to a FAKE binary through AGENT_WORKFORCE_TUNNEL_BIN; nothing reaches a network.
 *  - it runs `tls-pin --state-dir <dir> --to https://<address>`, local only;
 *  - it passes on `pinned` only with well-formed key hashes, `none` as none, and EVERY other answer as `required`;
 *  - a connector from before tls-pin answers none (it never pinned anything); before the sign-up nothing is spawned;
 *  - a definite answer is cached for five minutes, `fresh` asks again, and `required` is never cached.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-tlspin-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const DATA_ROOT = require('./store').ROOT;
const FAKE_BIN = nodePath.join(SANDBOX, 'fake-kosmos-tunnel');
const RECORD = nodePath.join(SANDBOX, 'fake-record.jsonl');
const MODE = nodePath.join(SANDBOX, 'fake-mode');
process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_BIN;
process.env.AGENT_WORKFORCE_TUNNEL_RELAY = 'relay.test:443';
const KEY = 'a'.repeat(64);

/* The fake prints what kosmos-relay's `tls-pin` prints (main.rs, tlspin.rs Answer::printed); the mode file picks the
   answer, so a cached answer can be told from a fresh one. */
fs.writeFileSync(FAKE_BIN, `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(RECORD)}, JSON.stringify(args) + '\\n');
let mode = ''; try { mode = fs.readFileSync(${JSON.stringify(MODE)}, 'utf8').trim(); } catch {}
if (args[0] === 'tls-pin') {
  if (mode === 'slow') {
    fs.appendFileSync(${JSON.stringify(RECORD)} + '.times', 'start ' + Date.now() + '\\n');
    setTimeout(() => { fs.appendFileSync(${JSON.stringify(RECORD)} + '.times', 'end ' + Date.now() + '\\n'); console.log(JSON.stringify({ state: 'pinned', spki: ['${KEY}'], from: 'mac-b' })); process.exit(0); }, 600);
    return;
  }
  if (mode === 'old') { process.stderr.write("error: unrecognized subcommand 'tls-pin'\\n"); process.exit(2); }
  if (mode === 'none') { console.log(JSON.stringify({ state: 'none', because: 'the computer answered 404' })); process.exit(0); }
  if (mode === 'required') { console.log(JSON.stringify({ state: 'required', because: 'statement refused: other_peer' })); process.exit(0); }
  if (mode === 'badkey') { console.log(JSON.stringify({ state: 'pinned', spki: ['ABC'], from: 'mac-b' })); process.exit(0); }
  if (mode === 'nokey') { console.log(JSON.stringify({ state: 'pinned', spki: [], from: 'mac-b' })); process.exit(0); }
  if (mode === 'odd') { console.log(JSON.stringify({ state: 'maybe' })); process.exit(0); }
  if (mode === 'crash') { process.stderr.write('boom at /Users/someone/secret/path\\n'); process.exit(1); }
  if (mode === 'six') { console.log(JSON.stringify({ state: 'pinned', spki: ['1','2','3','4','5','6'].map((c) => c.repeat(64)), from: 'mac-b' })); process.exit(0); }
  if (mode === 'other') { console.log(JSON.stringify({ state: 'pinned', spki: ['${'b'.repeat(64)}'], from: 'mac-b' })); process.exit(0); }
  console.log(JSON.stringify({ state: 'pinned', spki: ['${KEY}'], from: 'mac-b' }));
  process.exit(0);
}
process.stderr.write('fake: unexpected ' + args.join(' ') + '\\n');
process.exit(9);
`, { mode: 0o755 });

const remote = require('./remote');

function enrol() {
  const dir = nodePath.join(DATA_ROOT, 'remote');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(nodePath.join(dir, f), 'fake');
  return dir;
}
function unenrol() { fs.rmSync(nodePath.join(DATA_ROOT, 'remote'), { recursive: true, force: true }); }
function recorded() {
  try { return fs.readFileSync(RECORD, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; }
}
const mode = (m) => fs.writeFileSync(MODE, m);
test.beforeEach(() => { fs.rmSync(RECORD, { force: true }); mode(''); });
test.afterEach(() => { remote.resetForTests(); unenrol(); });
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('#6589: tlsPin runs tls-pin locally for the other computer and hands back only its key hashes', async () => {
  const dir = enrol();
  const got = await remote.tlsPin('tmnt.kosmosplus.com');
  assert.deepEqual(got, { ok: true, because: null, data: { state: 'pinned', spki: [KEY] } });
  assert.deepEqual(recorded(), [['tls-pin', '--state-dir', dir, '--to', 'https://tmnt.kosmosplus.com']]);
});

test('#6589: none passes as none; every other answer, a malformed pinned one included, is required', async () => {
  enrol();
  mode('none');
  assert.equal((await remote.tlsPin('a.kosmosplus.com')).data.state, 'none');
  for (const m of ['required', 'badkey', 'nokey', 'odd', 'crash']) {
    remote.resetForTests(); mode(m);
    const got = await remote.tlsPin('b.kosmosplus.com');
    assert.deepEqual(got.data, { state: 'required', because: "this computer's certificate could not be checked" }, m);
    assert.ok(!JSON.stringify(got).includes('/Users/'), 'the tunnel\'s own words stay here');
  }
});

test('kosmos#7193: a required answer says why in the board log, once a minute per address, with no computer name', async () => {
  enrol();
  const lines = [];
  const was = console.error;
  console.error = (...a) => lines.push(a.join(' '));
  try {
    mode('required');
    await remote.tlsPin('e.kosmosplus.com');
    await remote.tlsPin('e.kosmosplus.com');   // within the minute: not said again
    mode('crash');
    await remote.tlsPin('f.kosmosplus.com');   // another address: said
    mode('none');
    await remote.tlsPin('g.kosmosplus.com');   // CONTROL: a definite answer says nothing
  } finally { console.error = was; }
  const said = lines.filter((l) => l.startsWith('remote: tls-pin answered required'));
  assert.equal(said.length, 2, JSON.stringify(lines));
  assert.match(said[0], /statement refused: other_peer/, 'the tunnel\'s own reason is in the line');
  assert.match(said[1], /boom at/, 'a crash says what the tunnel printed');
  assert.ok(said.every((l) => !l.includes('kosmosplus.com')), 'no computer name in the line');
});

test('#6589: a connector from before tls-pin answers none; before the sign-up nothing is spawned', async () => {
  enrol(); mode('old');
  assert.equal((await remote.tlsPin('c.kosmosplus.com')).data.state, 'none');
  unenrol(); fs.rmSync(RECORD, { force: true }); remote.resetForTests();
  assert.equal((await remote.tlsPin('c.kosmosplus.com')).data.state, 'none');
  assert.deepEqual(recorded(), [], 'not enrolled: no spawn');
});

test('#6589: a definite answer is cached five minutes, fresh asks again, and required is never cached', async () => {
  enrol();
  assert.deepEqual((await remote.tlsPin('d.kosmosplus.com')).data.spki, [KEY]);
  mode('other');
  // Cached: the renewed key is not seen yet.
  assert.deepEqual((await remote.tlsPin('d.kosmosplus.com')).data.spki, [KEY]);
  assert.equal(recorded().length, 1);
  // fresh: the app's one retry on a mismatch sees the renewal.
  assert.deepEqual((await remote.tlsPin('d.kosmosplus.com', { fresh: true })).data.spki, ['b'.repeat(64)]);
  assert.equal(recorded().length, 2);
  // required is asked again every time.
  mode('required');
  await remote.tlsPin('e.kosmosplus.com'); await remote.tlsPin('e.kosmosplus.com');
  assert.equal(recorded().filter((a) => a[4] === 'https://e.kosmosplus.com').length, 2);
  assert.equal(remote.TLS_PIN_TTL_MS, 5 * 60 * 1000);
});

test('#6589 (review 1): parallel asks share one tunnel run; a sign-out or removal forgets the cache; the list warms pins', async () => {
  enrol();
  const [a, b] = await Promise.all([remote.tlsPin('f.kosmosplus.com'), remote.tlsPin('f.kosmosplus.com')]);
  assert.deepEqual(a, b);
  assert.equal(recorded().filter((r) => r[4] === 'https://f.kosmosplus.com').length, 1, 'one run for two parallel asks');
  remote.forgetTlsPins();
  await remote.tlsPin('f.kosmosplus.com');
  assert.equal(recorded().filter((r) => r[4] === 'https://f.kosmosplus.com').length, 2, 'asked again after the cache was forgotten');
  fs.rmSync(RECORD, { force: true });
  remote.warmTlsPins([{ address: 'g.kosmosplus.com' }, { address: 'self.kosmosplus.com', this: true }, null, { address: 7 }]);
  for (let i = 0; i < 100 && !recorded().length; i++) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(recorded().map((r) => r[4]), ['https://g.kosmosplus.com'], 'only the other computers, never this one');
});

test('#6589 (review 2): a forget while an ask runs keeps nothing; warming leaves a required computer alone a minute', async () => {
  enrol();
  const pending = remote.tlsPin('h.kosmosplus.com');
  remote.forgetTlsPins();                       // a sign-out lands while the ask is still running
  assert.equal((await pending).data.state, 'pinned', 'the running ask still answers its caller');
  mode('other');
  assert.deepEqual((await remote.tlsPin('h.kosmosplus.com')).data.spki, ['b'.repeat(64)], 'nothing from before the forget was kept');
  fs.rmSync(RECORD, { force: true }); mode('required');
  const settle = async (n) => { for (let i = 0; i < 100 && recorded().length < n; i++) await new Promise((r) => setTimeout(r, 20)); await new Promise((r) => setTimeout(r, 100)); };
  remote.warmTlsPins([{ address: 'i.kosmosplus.com' }]); await settle(1);
  remote.warmTlsPins([{ address: 'i.kosmosplus.com' }]); await settle(2);
  assert.equal(recorded().length, 1, 'a required computer is not asked again by warming within the minute');
  await remote.tlsPin('i.kosmosplus.com');
  assert.equal(recorded().length, 2, 'the app\'s own ask is never held back');
});

test('#6589 (review 3): warming asks at most ten computers; at most four key hashes are kept', async () => {
  enrol();
  remote.warmTlsPins(Array.from({ length: 12 }, (_, i) => ({ address: 'w' + i + '.kosmosplus.com' })));
  for (let i = 0; i < 150 && recorded().length < 10; i++) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(recorded().length, 10, 'ten, never twelve');
  mode('six');
  assert.equal((await remote.tlsPin('six.kosmosplus.com')).data.spki.length, 4);
});

test('#6589 (review 5): a fresh ask after a slow one sees the newer key (the cache-write guard is a backstop since review 7); a forgotten ask never steals a newer run', async () => {
  enrol();
  // A slow plain ask, then a fresh one that finishes first with another key: the cache keeps the fresh key.
  mode('slow');
  const slow = remote.tlsPin('j.kosmosplus.com');
  await new Promise((r) => setTimeout(r, 150));
  mode('other');
  assert.deepEqual((await remote.tlsPin('j.kosmosplus.com', { fresh: true })).data.spki, ['b'.repeat(64)]);
  await slow;
  mode('required');   // a cache miss would now answer required
  assert.deepEqual((await remote.tlsPin('j.kosmosplus.com')).data.spki, ['b'.repeat(64)], 'the older, slower answer did not overwrite the newer one');
  // An ask out when a forget lands (review 8): a new ask JOINS the running one rather than running beside it, and
  // what the running one answers is not kept.
  remote.forgetTlsPins();
  mode('slow');
  fs.rmSync(RECORD, { force: true });
  const first = remote.tlsPin('k.kosmosplus.com');
  await new Promise((r) => setTimeout(r, 150));
  remote.forgetTlsPins();
  const second = remote.tlsPin('k.kosmosplus.com');
  await Promise.all([first, second]);
  assert.equal(recorded().filter((r) => r[4] === 'https://k.kosmosplus.com').length, 1, 'one run, never two at once across a forget');
  mode('other');
  assert.deepEqual((await remote.tlsPin('k.kosmosplus.com')).data.spki, ['b'.repeat(64)], 'nothing from the run that straddled the forget was kept');
});

test('#6589 (reviews 7 and 9): one run per address: a fresh ask runs only AFTER a running plain one ends', async () => {
  enrol(); mode('slow');
  fs.rmSync(RECORD + '.times', { force: true });
  const plain = remote.tlsPin('m.kosmosplus.com');
  await new Promise((r) => setTimeout(r, 100));
  const fresh = remote.tlsPin('m.kosmosplus.com', { fresh: true });
  await plain;
  // The plain run is over and the fresh one is running: another FRESH ask (a plain one would just read the cache) must
  // JOIN it, which needs the fresh run's entry to survive the plain run finishing.
  const joined = remote.tlsPin('m.kosmosplus.com', { fresh: true });
  await Promise.all([fresh, joined]);
  assert.equal(recorded().filter((r) => r[4] === 'https://m.kosmosplus.com').length, 2, 'never a third run');
  const t = fs.readFileSync(RECORD + '.times', 'utf8').trim().split('\n').map((l) => l.split(' '));
  assert.deepEqual(t.map((x) => x[0]), ['start', 'end', 'start', 'end'], 'the two runs never overlapped');
  assert.ok(Number(t[2][1]) >= Number(t[1][1]), 'the fresh run started after the plain one ended');
});

test('#6589 (review 9): a sign-out and a device removal forget the cache, and the computer list warms it (the call sites)', () => {
  const src = fs.readFileSync(nodePath.join(__dirname, 'remote.js'), 'utf8');
  const fn = (name) => src.slice(src.indexOf(name), src.indexOf('\n}\n', src.indexOf(name)));
  assert.match(fn('async function forget({ anyway = false } = {}) {'), /^async function forget\(\{ anyway = false \} = \{\}\) \{\n\s+forgetTlsPins\(\);/);
  assert.match(fn('function forgetVouched(id, answer) {'), /^function forgetVouched\(id, answer\) \{\n\s+forgetTlsPins\(\);/);
  const server = fs.readFileSync(nodePath.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /accountComputers\.fetchComputers\(\)\n\s+\.then\(\(r\) => \{ if \(r && r\.ok\) remote\.warmTlsPins\(r\.computers\); sendJson\(res, 200, r\); \}\)/);
  assert.match(src, /function forgetTlsPins\(\) \{ tlsPinGeneration \+= 1; tlsPinCache\.clear\(\); tlsPinWarmQuiet\.clear\(\); \}/);
});

test('#6589 (review 11): a cached answer expires after five minutes and is asked again; signing out answers required', async () => {
  enrol();
  const realNow = Date.now;
  try {
    await remote.tlsPin('n.kosmosplus.com');
    await remote.tlsPin('n.kosmosplus.com');
    assert.equal(recorded().filter((r) => r[4] === 'https://n.kosmosplus.com').length, 1, 'cached within the five minutes');
    const later = realNow() + remote.TLS_PIN_TTL_MS + 1;
    Date.now = () => later;
    await remote.tlsPin('n.kosmosplus.com');
    assert.equal(recorded().filter((r) => r[4] === 'https://n.kosmosplus.com').length, 2, 'asked again once it expired');
  } finally {
    Date.now = realNow;
  }
  // The signing-out rule is a guard at the top of tlsPin (a full sign-out is not driven here): pinned to its place.
  const src = fs.readFileSync(nodePath.join(__dirname, 'remote.js'), 'utf8');
  assert.match(src, /async function tlsPin\(address, \{ fresh = false \} = \{\}\) \{\n[^\n]*\n\s+if \(forgetting\) return \{ ok: true, because: null, data: \{ state: 'required'/);
});
