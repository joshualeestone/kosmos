'use strict';
/**
 * The tunnel supervisor: off by default, the switch is the only starter,
 * honest states with because sentences, and every process this module
 * manages in these tests is a FAKE binary through the env seam; the suite
 * never runs the real tunnel and never reaches any network. Sandboxed data
 * root before the require.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-remote-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
// #1848: remote.js now routes its base through store.ROOT (= dataRootFor), which
// appends the `AgentWorkforce` leaf to AGENT_WORKFORCE_DATA -- so its state files
// (remote.json, remote-status.json, remote/) live under SANDBOX/AgentWorkforce, not
// the bare SANDBOX. Derive the SAME root the code does rather than hardcoding the
// leaf name, so this follows any future rename.
const DATA_ROOT = require('./store').ROOT;
const FAKE_BIN = nodePath.join(SANDBOX, 'fake-kosmos-tunnel');
const RECORD = nodePath.join(SANDBOX, 'fake-record.jsonl');
process.env.AGENT_WORKFORCE_TUNNEL_BIN = FAKE_BIN;

/* The fake speaks the binary's contract: setup start/complete exit codes
   and sentences, and run writes the status file. Its behavior bends
   through FAKE_TUNNEL_MODE so one script covers the failure shapes. */
fs.writeFileSync(FAKE_BIN, `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
fs.appendFileSync(${JSON.stringify(RECORD)}, JSON.stringify(process.argv.slice(2)) + '\\n');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const mode = process.env.FAKE_TUNNEL_MODE || '';
if (args[0] === 'setup' && args[1] === 'start') {
  if ((flag('--email') || '').includes('down')) {
    process.stderr.write('the coordinator is unreachable: connect refused\\n');
    process.exit(1);
  }
  console.log('if the address is reachable, a code is on its way');
  process.exit(0);
}
if (args[0] === 'setup' && args[1] === 'complete') {
  if (flag('--code') === '000000') {
    process.stderr.write('the coordinator said no (401): that code is not right\\n');
    process.exit(1);
  }
  const dir = flag('--state-dir');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['mac_id', 'mac_key', 'coordinator_pubkey', 'tls.crt', 'tls.key']) {
    fs.writeFileSync(path.join(dir, f), 'fake');
  }
  fs.writeFileSync(path.join(dir, 'address'), flag('--name') + '.kosmos.invalid\\n');
  console.log('registered. address: ' + flag('--name') + '.kosmos.invalid');
  process.exit(0);
}
if (args[0] === 'devices') {
  const verb = args[1];
  if (mode === 'devices-fail') {
    process.stderr.write('the coordinator said no (404): no such pending device\\n');
    process.exit(1);
  }
  if (verb === 'list') { console.log(JSON.stringify({ devices: [{ device_id: 'dev-1', name: 'iPhone', allowed_at: 1756000000, last_seen: 0, code: 'K7-3M' }] })); process.exit(0); }
  if (verb === 'pending') { console.log(JSON.stringify({ devices: [] })); process.exit(0); }
  console.log(JSON.stringify({ [verb === 'allow' ? 'allowed' : verb === 'deny' ? 'denied' : 'removed']: true, device_id: flag('--device-id') }));
  process.exit(0);
}
if (args[0] === 'run') {
  if (mode === 'crash') process.exit(3);
  const statusFile = flag('--status-file');
  const address = fs.readFileSync(path.join(flag('--state-dir'), 'address'), 'utf8').trim();
  fs.writeFileSync(statusFile, JSON.stringify({ state: 'up', address, because: null, pid: process.pid }) + '\\n');
  setInterval(() => {}, 1000);
  process.on('SIGTERM', () => process.exit(0));
}
`, { mode: 0o755 });

const remote = require('./remote');

function recorded() {
  try { return fs.readFileSync(RECORD, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); }
  catch { return []; }
}
async function until(check, what) {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail('timed out waiting for ' + what);
}
test.afterEach(() => {
  remote.resetForTests();
  delete process.env.FAKE_TUNNEL_MODE;
  fs.rmSync(remote.FILE, { force: true });
  fs.rmSync(RECORD, { force: true });
  fs.rmSync(nodePath.join(DATA_ROOT, 'remote'), { recursive: true, force: true });
  fs.rmSync(nodePath.join(DATA_ROOT, 'remote-status.json'), { force: true });
  delete process.env.AGENT_WORKFORCE_TUNNEL_RELAY;
});

test('off by default, refusals in words, and nothing spawns while off', async () => {
  assert.equal(remote.read().on, false);
  assert.equal(remote.status().state, 'off');
  assert.match(remote.setOn('yes').because, /on or off/);
  remote.ensure(3000);
  /* Deterministic: spawn() sets the child handle synchronously inside
     ensure(), so a null handle right now proves nothing spawned, with no
     timing wait that could false-green if a real spawn were merely slow. */
  assert.equal(remote.currentChildPid(), null, 'a child exists while the switch is off');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(recorded(), [], 'something spawned while the switch was off');
});

test('#2013 tripwire: remote defaults OFF, and an array config reads OFF -- the coupling that keeps the shape guard safe', () => {
  /* engine/remote.js's shape guard is `!parsed || typeof parsed !== 'object'`,
     which lets a JSON ARRAY through, because `typeof [] === 'object'`. That is
     harmless ONLY because remote reads `on: parsed.on === true` (an explicit-true
     test) and is OFF by default -- an array's undefined `.on` reads false either
     way. #2013 fixed the SAME typeof-array hole in heartbeat-setting.js, which DID
     default true and so turned a corrupt array config into phoning home.
     This test is the tripwire for the day remote's default flips. That day is a
     COMMERCIAL decision, not a technical one: Josh carved remote out of the
     on-by-default sweep (2026-09-03) because the Remote tunnel is a paid service,
     and commercial reasons change. When the default changes, one of these reds is
     the signal to fix the shape guard first -- in front of the person making the
     change, which is the one moment the connection is useful and the one moment
     nobody would go looking for it in a backlog. */
  // 1) The precondition. A missing config is OFF; if this reds, the default flipped.
  fs.rmSync(remote.FILE, { force: true });
  assert.equal(remote.read().on, false,
    'remote defaults ON. Before shipping that, fix the typeof-array hole in remote.js\'s '
    + 'shape guard (typeof parsed !== object lets an array through) -- an array config would '
    + 'read as an object and bypass corrupt-to-off, exactly as #2013 did for heartbeat.');
  // 2) The hole itself, pinned directly. An ARRAY config must read OFF; this reds the
  //    moment someone gives remote a default-true read the way heartbeat used to have.
  //    (The dir is created lazily by remote.write(); this test writes the file
  //    directly and may run before any write(), so ensure the parent exists.)
  fs.mkdirSync(nodePath.dirname(remote.FILE), { recursive: true });
  fs.writeFileSync(remote.FILE, JSON.stringify([{ on: true }]));
  assert.equal(remote.read().on, false,
    'a JSON array config read as ON -- the typeof-array hole is now live. Add Array.isArray '
    + 'to remote.js\'s shape guard, exactly as #2013 did for heartbeat-setting.js.');
});

test('on but not signed in says so, in words, and still spawns nothing', async () => {
  remote.setOn(true);
  remote.ensure(3000);
  assert.equal(remote.currentChildPid(), null, 'spawned without enrolment');
  const s = remote.status();
  assert.equal(s.state, 'connecting');
  assert.match(s.because, /sign-in/);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(recorded(), [], 'spawned without enrolment');
});

test('the email step drives the binary and failures surface its last sentence', async () => {
  assert.match((await remote.setupStart('not-an-email')).because, /email address/);
  const ok = await remote.setupStart('her@example.com');
  assert.equal(ok.ok, true);
  assert.equal(remote.read().email, 'her@example.com');
  const call = recorded()[0];
  assert.equal(call[0], 'setup');
  assert.equal(call[1], 'start');
  assert.ok(call.includes('--email') && call.includes('her@example.com'));
  const down = await remote.setupStart('down@example.com');
  assert.equal(down.ok, false);
  assert.match(down.because, /unreachable/);
});

test('the code step validates in words, enrolls through the binary, and brings the tunnel up', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  remote.setOn(true);
  remote.ensure(4100);
  await remote.setupStart('her@example.com');
  assert.match((await remote.setupComplete('12345', 'hers')).because, /six digits/);
  assert.match((await remote.setupComplete('123456', 'NO CAPS')).because, /lowercase/);
  const refused = await remote.setupComplete('000000', 'hers');
  assert.equal(refused.ok, false);
  assert.match(refused.because, /not right/);
  const done = await remote.setupComplete('123456', 'hers');
  assert.equal(done.ok, true, done.because);
  assert.equal(remote.enrolled(), true);
  assert.equal(remote.address(), 'hers.kosmos.invalid');
  await until(() => remote.status().state === 'up', 'the tunnel to come up');
  const s = remote.status();
  assert.equal(s.address, 'hers.kosmos.invalid');
  assert.equal(s.because, null);
  const run = recorded().find((c) => c[0] === 'run');
  assert.ok(run, 'the run child never spawned');
  assert.ok(run.includes('--local') && run.includes('127.0.0.1:4100'), 'the board port did not reach the child');
  assert.ok(run.includes('--status-file'), 'no status file seam');
});

test('#1010: a reinstall whose state survived is recognised, not re-enrolled, and a rename still enrols', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  remote.setOn(true);
  await remote.setupStart('her@example.com');
  // A real first enrolment writes the state (mac_id / address / tls) via the
  // fake binary; from here enrolled() reads true, as it would after an
  // install-over-the-top that kept Application Support.
  await remote.setupComplete('123456', 'hers');
  assert.equal(remote.enrolled(), true);
  // A reinstall re-runs the setup flow with the SAME name. The guard must
  // recognise the surviving state and NOT re-run enrolment -- re-running would
  // mint a new identity key and hit the coordinator's 409 about "a Mac on this
  // account". Clear the record so we count only the second attempt's calls.
  fs.rmSync(RECORD, { force: true });
  const again = await remote.setupComplete('123456', 'hers');
  assert.equal(again.ok, true, again.because);
  assert.equal(again.alreadySetUp, true, 'a reinstall was re-enrolled instead of recognised');
  assert.equal(again.address, 'hers.kosmos.invalid');
  assert.ok(
    !recorded().some((c) => c[0] === 'setup' && c[1] === 'complete'),
    'the guard let a reinstall re-run enrolment: ' + JSON.stringify(recorded()),
  );
  // CONTROL: a DIFFERENT name is a rename, not a reinstall, so it must fall
  // through and actually enrol -- proving the guard is name-specific and not a
  // blanket "already enrolled -> do nothing".
  fs.rmSync(RECORD, { force: true });
  const renamed = await remote.setupComplete('123456', 'theirs');
  assert.equal(renamed.ok, true, renamed.because);
  assert.ok(!renamed.alreadySetUp, 'a rename was wrongly recognised as a reinstall');
  assert.ok(
    recorded().some((c) => c[0] === 'setup' && c[1] === 'complete' && c.includes('theirs')),
    'a rename did not reach the binary: ' + JSON.stringify(recorded()),
  );
});

test('turning the switch off actually kills the running child, and says off', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  remote.setOn(true);
  await remote.setupStart('her@example.com');
  await remote.setupComplete('123456', 'hers');
  remote.ensure(4200);
  await until(() => remote.status().state === 'up', 'the tunnel to come up');
  const pid = remote.currentChildPid();
  assert.ok(pid, 'no running child to kill');
  remote.setOn(false);
  /* The switch off must actually kill the child, not merely make status()
     derive off from settings. Assert the recorded pid is dead; this fails if
     the child.kill() in stopChild() is removed, which status-only assertions
     could not catch. */
  await until(() => {
    try { process.kill(pid, 0); return false; } catch { return true; }
  }, 'the child to actually die after the switch off');
  const s = remote.status();
  assert.equal(s.state, 'off');
  assert.match(s.because, /switch is off/);
});

test('a crashing child renders restarting with a because, never fine', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  remote.setOn(true);
  remote.ensure(4300);
  /* Crash mode goes on BEFORE enrolment finishes: setupComplete brings the
     tunnel up itself, and that first child is the one that must crash, or
     this test would assert against a healthy leftover. */
  process.env.FAKE_TUNNEL_MODE = 'crash';
  await remote.setupStart('her@example.com');
  await remote.setupComplete('123456', 'hers');
  await until(() => remote.status().state === 'restarting', 'the crash to render as restarting');
  const s = remote.status();
  assert.match(s.because, /crash|restarting/i);
  assert.notEqual(s.state, 'up', 'a crashed child rendered as fine');
});

test('#648: enrolled with nothing set dials the REAL relay and coordinator, with no CA flag', async () => {
  /* Until 2026-08-24 this asserted "no relay set is off with the reason, not
     a spawn into nowhere": the relay's domain was undecided, so a default
     would have been an outbound call to somewhere nobody chose. The domain
     is decided and the box serves it, so the default IS the real place and
     a bundle needs nothing baked. The old state is unreachable by design. */
  delete process.env.AGENT_WORKFORCE_TUNNEL_CA;
  remote.setOn(true);
  await remote.setupStart('her@example.com');
  await remote.setupComplete('123456', 'hers');
  fs.rmSync(RECORD, { force: true });
  remote.ensure(4400);
  await until(() => recorded().length > 0, 'the connector to be spawned against the default relay');
  const args = recorded()[0];
  const flat = Array.isArray(args) ? args.join(' ') : String(args);
  assert.match(flat, /--relay relay\.plus\.installkosmos\.com:8443\b/);
  assert.match(flat, /--coordinator https:\/\/login\.kosmosplus\.com\b/);
  assert.ok(!/--tunnel-ca/.test(flat), 'a CA was baked for the production relay: ' + flat);
  remote.resetForTests();
});

test('a missing binary renders restarting and retries, not a permanent false connecting', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  remote.setOn(true);
  await remote.setupStart('her@example.com');
  await remote.setupComplete('123456', 'hers');
  remote.resetForTests();
  // Point the binary at nothing and force a start. spawn() does not throw on
  // ENOENT; without the error-handler fix the dead handle wedges status() on
  // "connecting" forever, so reaching "restarting" is the whole test.
  const goodBin = process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  process.env.AGENT_WORKFORCE_TUNNEL_BIN = nodePath.join(SANDBOX, 'no-such-binary');
  remote.ensure(4500);
  await until(() => remote.status().state === 'restarting',
    'a missing binary to render restarting, not a wedged connecting');
  assert.notEqual(remote.status().state, 'up');
  process.env.AGENT_WORKFORCE_TUNNEL_BIN = goodBin;
  remote.resetForTests();
});

test('a corrupt settings file says it is unreadable, not that the switch is off', () => {
  fs.writeFileSync(remote.FILE, '{ this is not valid json');
  const s = remote.status();
  assert.equal(s.state, 'off');
  assert.match(s.because, /could not be read|unreadable/i,
    'a corrupt settings file must not claim the switch is off');
});

test('setRelay refuses anything that is not host:port', () => {
  assert.match(remote.setRelay('garbage').because, /host:port/);
  assert.match(remote.setRelay('host-with-no-port:').because, /host:port/);
  assert.equal(remote.setRelay('relay.example.com:8443').ok, true);
  assert.equal(remote.setRelay('').ok, true, 'empty must clear, not error');
});

// ─────────────────────────────────────────────────────────────────────────────
// Devices (#567): the Allow moment's seam
// ─────────────────────────────────────────────────────────────────────────────

/* Enrolled means the four files exist; the fake's setup writes them, but a
   test of the devices seam should not depend on the setup flow. */
function enrol() {
  const dir = nodePath.join(DATA_ROOT, 'remote');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(nodePath.join(dir, f), 'fake');
  return dir;
}

test('pending is a FILE the tunnel writes: read, never spawned, and empty while off or unenrolled', () => {
  const dir = enrol();
  fs.writeFileSync(nodePath.join(dir, 'pending.json'), JSON.stringify({ devices: [
    { device_id: 'dev-9', name: 'iPhone', first_seen: 1756000000, code: 'K7-3M' },
    { device_id: '../evil', name: 'x', first_seen: 1, code: 'AAAA' },
  ] }));
  /* Off: the switch is the gate, whatever the file says. */
  assert.deepEqual(remote.pendingDevices().devices, [], 'a board with Plus off asked about a device');
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = 'relay.test:443';
  remote.setOn(true);
  const got = remote.pendingDevices();
  assert.equal(got.snapshot, true);
  assert.equal(got.devices.length, 1, 'a device id that is not an id passed through');
  assert.equal(got.devices[0].code, 'K7-3M');
  assert.equal(got.devices[0].denied_at, 0);
  assert.ok(!recorded().some((a) => a[0] === 'devices'), 'reading pending spawned the binary');
});

test('allow drives the binary with the Mac-first verb, the id and the kind; a bad id is refused in words without spawning', async () => {
  enrol();
  const bad = await remote.deviceAllow('../evil', 'iPhone');
  assert.equal(bad.ok, false);
  assert.match(bad.because, /not a device we know/);
  assert.ok(!recorded().some((a) => a[0] === 'devices'), 'a bad id reached the binary');
  const ok = await remote.deviceAllow('dev-9', 'iPhone');
  assert.equal(ok.ok, true, ok.because);
  assert.equal(ok.data.allowed, true);
  const call = recorded().find((a) => a[0] === 'devices' && a[1] === 'allow');
  assert.ok(call, 'allow never reached the binary');
  assert.equal(call[call.indexOf('--device-id') + 1], 'dev-9');
  assert.equal(call[call.indexOf('--name') + 1], 'iPhone');
  assert.ok(call.includes('--coordinator'), 'allow forgot the coordinator, so the phone would never be told');
});

test('deny remembers the No, so a re-ask from the same id carries when this Mac said no', async () => {
  const dir = enrol();
  const r = await remote.deviceDeny('dev-9');
  assert.equal(r.ok, true, r.because);
  assert.ok(remote.read().denied['dev-9'] > 1700000000, 'the No was not recorded');
  fs.writeFileSync(nodePath.join(dir, 'pending.json'), JSON.stringify({ devices: [{ device_id: 'dev-9', name: 'iPhone', first_seen: 1756000000, code: 'K7-3M' }] }));
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = 'relay.test:443';
  remote.setOn(true);
  assert.ok(remote.pendingDevices().devices[0].denied_at > 1700000000, 'the re-ask does not know it was said no to');
});

test('remove has no coordinator (the Mac list is the authority) and the binary’s refusal surfaces as its last sentence', async () => {
  enrol();
  const ok = await remote.deviceRemove('dev-1');
  assert.equal(ok.ok, true, ok.because);
  const call = recorded().find((a) => a[0] === 'devices' && a[1] === 'remove');
  assert.ok(call && !call.includes('--coordinator'), 'remove asked the coordinator, which is not where the list lives');
  process.env.FAKE_TUNNEL_MODE = 'devices-fail';
  const no = await remote.deviceDeny('dev-1');
  assert.equal(no.ok, false);
  assert.match(no.because, /no such pending device/);
});

test('list joins the sidecar for the screen, and unenrolled is an empty list without a spawn', async () => {
  const none = await remote.devicesList();
  assert.deepEqual(none.data.devices, []);
  assert.ok(!recorded().some((a) => a[0] === 'devices'), 'unenrolled list spawned the binary');
  enrol();
  const got = await remote.devicesList();
  assert.equal(got.ok, true, got.because);
  assert.equal(got.data.devices[0].name, 'iPhone');
  assert.equal(got.data.devices[0].code, 'K7-3M');
});

test('#648: with nothing set, the Mac dials the real relay and coordinator, and bakes no CA', () => {
  const prev = { r: process.env.AGENT_WORKFORCE_TUNNEL_RELAY, c: process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR, ca: process.env.AGENT_WORKFORCE_TUNNEL_CA };
  delete process.env.AGENT_WORKFORCE_TUNNEL_RELAY;
  delete process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR;
  delete process.env.AGENT_WORKFORCE_TUNNEL_CA;
  try {
    assert.equal(remote.DEFAULT_RELAY, 'relay.plus.installkosmos.com:8443');
    assert.equal(remote.DEFAULT_COORDINATOR, 'https://login.kosmosplus.com');
    /* The source, not a re-implementation: the CA flag is passed only when the env is set. */
    const src = require('node:fs').readFileSync(require.resolve('./remote'), 'utf8');
    assert.match(src, /if \(process\.env\.AGENT_WORKFORCE_TUNNEL_CA\) \{\s*args\.push\('--tunnel-ca'/);
    assert.ok(!/AGENT_WORKFORCE_TUNNEL_CA\s*\|\|/.test(src), 'the CA env has grown a default; the production relay must get none');
  } finally {
    for (const [k, v] of [['AGENT_WORKFORCE_TUNNEL_RELAY', prev.r], ['AGENT_WORKFORCE_TUNNEL_COORDINATOR', prev.c], ['AGENT_WORKFORCE_TUNNEL_CA', prev.ca]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('#793: forget retires the Mac while its key exists, then destroys the key and turns Plus off', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  remote.setOn(true);
  await remote.setupStart('her@example.com');
  await remote.setupComplete('123456', 'hers');
  assert.equal(remote.enrolled(), true, 'the fixture did not enrol');
  fs.rmSync(RECORD, { force: true });
  const got = await remote.forget();
  const calls = recorded();
  const retireCall = calls.find((c) => (Array.isArray(c) ? c : c.args || []).includes('retire'));
  assert.ok(retireCall, 'forget never told the coordinator; a name would stay held forever: ' + JSON.stringify(calls));
  assert.equal(got.ok, true);
  assert.equal(got.retired, true, 'the fake coordinator accepted retire but forget reports otherwise: ' + got.because);
  assert.equal(remote.enrolled(), false, 'the key survived forget');
  assert.equal(remote.read().on, false, 'Plus stayed on for a Mac that no longer has a key');
  remote.resetForTests();
});

test('#793: forgetting a Mac that was never set up says so and retires nothing', async () => {
  fs.rmSync(RECORD, { force: true });
  const got = await remote.forget();
  assert.equal(got.retired, false);
  assert.match(got.because, /not set up/);
  assert.deepEqual(recorded().filter((c) => (Array.isArray(c) ? c : c.args || []).includes('retire')), [], 'retire was called with no key to sign it');
});

test('#733: a second-factor reset is the enrolled Mac\'s own signed request, and an unenrolled Mac cannot ask', async () => {
  fs.rmSync(RECORD, { force: true });
  const no = await remote.secondReset();
  assert.equal(no.ok, false);
  assert.match(no.because, /not set up/);
  assert.deepEqual(recorded(), [], 'an unenrolled Mac spawned a reset with no key to sign it');
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  remote.setOn(true);
  await remote.setupStart('her@example.com');
  await remote.setupComplete('123456', 'hers');
  fs.rmSync(RECORD, { force: true });
  const yes = await remote.secondReset();
  assert.equal(yes.ok, true, yes.because);
  const call = recorded().find((c) => { const a = Array.isArray(c) ? c : c.args || []; return a.includes('second') && a.includes('reset'); });
  assert.ok(call, 'the reset never reached the connector: ' + JSON.stringify(recorded()));
  remote.resetForTests();
});

test('enrolment that lands without an ensure() call rests at "has not started" until the next ensure(), which heals it (Josh, 2026-08-26 08:50)', async () => {
  /* The exact resting state from the fresh Mac: switch on, every enrolment
     file present, a relay address, no child, no restart pending. Produced
     here the only way it can be: the state dir filled in WITHOUT going
     through setupComplete (whose own ensure() would have started the
     tunnel). The server's ensure tick is what makes the second half true in
     production; this proves ensure() itself is enough. */
  // remote.js: STATE_DIR() is AGENT_WORKFORCE_TUNNEL_STATE or <data>/remote; this file sandboxes the data dir.
  const dir = process.env.AGENT_WORKFORCE_TUNNEL_STATE || nodePath.join(DATA_ROOT, 'remote');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  remote.setOn(true);
  remote.ensure(4500);            // boot: switched on, not yet enrolled, nothing spawns
  assert.equal(remote.status().state, 'connecting');
  for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(nodePath.join(dir, f), f === 'address' ? 'hers.kosmos.invalid\n' : 'x\n');
  assert.equal(remote.enrolled(), true);
  const resting = remote.status();
  assert.equal(resting.state, 'off');
  assert.equal(resting.because, 'the board has not started the tunnel');
  remote.ensure();                // what the tick does
  assert.notEqual(remote.status().because, 'the board has not started the tunnel');
  await until(() => ['connecting', 'up'].includes(remote.status().state), 'the tunnel to leave the resting state');
  remote.setOn(false);
});
