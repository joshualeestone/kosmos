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
if (process.argv[2] === 'run') {
  fs.writeFileSync(${JSON.stringify(RECORD)} + '.run-env', process.env.KOSMOS_BOARD_TOKEN_FILE || '(unset)');
  // Never the environment itself (it can hold real credentials on a shared box):
  // only the NAMES of variables holding the probe value a test planted, if any.
  let probe = '';
  try { probe = fs.readFileSync(${JSON.stringify(RECORD)} + '.probe', 'utf8'); } catch { /* no probe */ }
  const hits = probe ? Object.keys(process.env).filter((k) => String(process.env[k]).includes(probe)) : [];
  fs.writeFileSync(${JSON.stringify(RECORD)} + '.run-env-hits', JSON.stringify(hits));
}
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
  if (mode.includes('setup-409')) { process.stderr.write('Kosmos+ said no (409): The name ' + flag('--name') + ' is already in use by a Mac on this account, at ' + flag('--name') + '.kosmos.invalid. If that is this Mac, it is already set up and there is nothing more to do here. If it is a different Mac, press Turn off there first, or pick another name.\\n'); process.exit(1); }
  if (mode.includes('slow-setup')) { const until = Date.now() + Number(process.env.FAKE_REGISTER_MS || 2500); while (Date.now() < until) { /* wait */ } }
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
if (args[0] === 'signin') {
  const verb = args[1];
  if (verb === 'start') {
    // Anti-enum: the same answer whatever the email, except an unreachable
    // coordinator (email carrying 'down'), which fails like setup start.
    if ((flag('--email') || '').includes('down')) {
      process.stderr.write('the coordinator is unreachable: connect refused\\n');
      process.exit(1);
    }
    console.log(JSON.stringify({ stage: 'code_sent' }));
    process.exit(0);
  }
  if (verb === 'verify') {
    const code = flag('--code');
    if (code === '000000') { process.stderr.write('the coordinator said no (401): that code is not right\\n'); process.exit(1); }
    if (code === '222222') { console.log(JSON.stringify({ stage: 'second', challenge: 'ch_fake_123', second: 'totp', sent_to: null })); process.exit(0); }
    // #3796: an sms account, and one whose answer carries shapes the page must never render.
    if (code === '242424') { console.log(JSON.stringify({ stage: 'second', challenge: 'ch_fake_124', second: 'sms', sent_to: '\u2022\u2022\u2022 4321' })); process.exit(0); }
    if (code === '252525') { console.log(JSON.stringify({ stage: 'second', challenge: 'ch_fake_125', second: 'carrier-pigeon', sent_to: '<b>555-0100</b>' })); process.exit(0); }
    // #3796 addendum 8: a session for an account that already owns an address, and one with a bad address shape.
    if (code === '262626') { console.log(JSON.stringify({ stage: 'session', token: 'kst1.session-owned', account_address: 'josh0925-150pm.kosmosplus.com' })); process.exit(0); }
    if (code === '272727') { console.log(JSON.stringify({ stage: 'session', token: 'kst1.session-odd', account_address: 'javascript:alert(1)' })); process.exit(0); }
    if (code === '333333') { console.log(JSON.stringify({ stage: 'enrol_second_factor', enrol: true, token: 'kst1.enrol-fake', sms_available: true, why_authenticator: 'stronger than sms' })); process.exit(0); }
    if (code === '777777') { console.log(JSON.stringify({ stage: 'enrol_second_factor', enrol: true, sms_available: true })); process.exit(0); }  // enrol stage with NO token -> engine guard
    if (code === '888888') { console.log(JSON.stringify({ stage: 'enrol_second_factor', enrol: true, token: 'kst1.enrol-nomaterial', sms_available: true, why_authenticator: 'why' })); process.exit(0); }  // holds a token whose enrol answer omits the material -> engine fail-closed
    if (code === '999999') { console.log(JSON.stringify({ stage: 'enrol_second_factor', enrol: true, token: 'kst1.enrol-badtype', sms_available: true, why_authenticator: 'why' })); process.exit(0); }  // holds a token whose enrol answer returns TRUTHY NON-STRING material -> engine fail-closed
    if (code === '303030') { console.log(JSON.stringify({ stage: 'enrol_second_factor', enrol: true, token: 'kst1.enrol-sms-nomaterial', sms_available: true, why_authenticator: 'why' })); process.exit(0); }  // holds a token whose SMS enrol answer omits sent_to -> engine fail-closed (pins the sms guard branch)
    // Malformed coordinator answers, so the engine's guard paths are exercised:
    // a session with no token, a challenge with no id, and an unknown stage.
    if (code === '444444') { console.log(JSON.stringify({ stage: 'session' })); process.exit(0); }
    if (code === '555555') { console.log(JSON.stringify({ stage: 'second' })); process.exit(0); }
    if (code === '666666') { console.log(JSON.stringify({ stage: 'bogus' })); process.exit(0); }
    console.log(JSON.stringify({ stage: 'session', token: 'kst1.session-fake' }));
    process.exit(0);
  }
  if (verb === 'second') {
    if (flag('--code') === '000000') { process.stderr.write('the coordinator said no (401): that code is not right\\n'); process.exit(1); }
    console.log(JSON.stringify({ stage: 'session', token: 'kst1.second-fake' }));
    process.exit(0);
  }
  if (verb === 'enrol') {
    // The enrol-only token arrives on stdin, NEVER argv (same contract as register).
    const token = fs.readFileSync(0, 'utf8').trim();
    if (!token) { process.stderr.write('no token on stdin\\n'); process.exit(1); }
    const kind = flag('--kind');
    // A 200 whose material is present-but-EMPTY (secret:''/otpauth:'') -- the harder
    // case: a typeof check would let it through, so this proves the guard uses
    // truthiness and fails closed rather than showing a blank enrol screen.
    if (token === 'kst1.enrol-nomaterial') { console.log(JSON.stringify({ stage: 'enrolment_started', kind: 'totp', secret: '', otpauth: '', why_authenticator: 'why' })); process.exit(0); }
    // Truthy-but-NON-STRING material (secret a number, otpauth an object): the mirror
    // of the empty-string case. A truthiness-only guard would believe material is
    // present while the string-only copy drops it -> a blank screen as false success.
    if (token === 'kst1.enrol-badtype') { console.log(JSON.stringify({ stage: 'enrolment_started', kind: 'totp', secret: 123, otpauth: {}, why_authenticator: 'why' })); process.exit(0); }
    // An sms enrol answer with NO sent_to: the engine sms guard branch must fail closed
    // (pins the kind==='sms' + no-sentTo path so a future sent_to/sentTo typo goes red).
    if (token === 'kst1.enrol-sms-nomaterial') { console.log(JSON.stringify({ stage: 'enrolment_started', kind: 'sms', why_authenticator: 'why' })); process.exit(0); }
    // The coordinator's answer carries a session-bearing token; the engine allowlist
    // must strip it so it never reaches the caller (asserted at the enrol boundary below).
    // The stray sent_to is wrong-kind material a misbehaving coordinator might send on
    // a totp answer; the engine's kind-scoped copy must drop it (mirror of the sms case).
    if (kind === 'totp') { console.log(JSON.stringify({ stage: 'enrolment_started', kind: 'totp', token: 'kst1.should-be-stripped', secret: 'JBSWY3DPEHPK3PXP', otpauth: 'otpauth://totp/x', sent_to: '*** *** 9999', why_authenticator: 'why' })); process.exit(0); }
    if (kind === 'sms') {
      const phone = flag('--phone');
      if (!phone) { process.stderr.write('the coordinator said no (400): phone required for sms\\n'); process.exit(1); }
      // The phone rides argv (recorded above), so a test asserts it reached the
      // binary; the answer carries only the masked tail, never the full number.
      // Includes a STRAY secret/otpauth (wrong-kind material a misbehaving coordinator
      // might send on an sms answer): the engine's kind-scoped copy must drop them.
      console.log(JSON.stringify({ stage: 'enrolment_started', kind: 'sms', token: 'kst1.should-be-stripped', sent_to: '*** *** ' + phone.slice(-4), secret: 'STRAYSECRET', otpauth: 'otpauth://stray', why_authenticator: 'why' }));
      process.exit(0);
    }
    process.stderr.write('the coordinator said no (400): kind is totp or sms\\n'); process.exit(1);
  }
  if (verb === 'confirm-enrol') {
    const token = fs.readFileSync(0, 'utf8').trim();
    if (!token) { process.stderr.write('no token on stdin\\n'); process.exit(1); }
    if (flag('--code') === '000000') { process.stderr.write('the coordinator said no (401): that code is not right\\n'); process.exit(1); }
    // On confirm the coordinator issues the person's FIRST session.
    console.log(JSON.stringify({ stage: 'session', token: 'kst1.enrol-session-fake' }));
    process.exit(0);
  }
  if (verb === 'register') {
    // A child that exits BEFORE reading stdin, so the engine's EPIPE-swallow path
    // (setupRun's stdin.on('error')) is exercised rather than crashing the write.
    if (flag('--name') === 'earlyexit') { process.stderr.write('the coordinator said no (500): try again\\n'); process.exit(1); }
    // The token arrives on stdin, NEVER argv. Record what we received so a test
    // can assert it landed via stdin and is absent from the recorded argv.
    const token = fs.readFileSync(0, 'utf8').trim();
    if (!token) { process.stderr.write('no session token on stdin\\n'); process.exit(1); }
    const name = flag('--name');
    if (name === 'taken') { process.stderr.write('the coordinator said no (409): a Mac on this account already has that name\\n'); process.exit(1); }
    // The coordinator's own sentences, as the tunnel prints them (setup.rs: "Kosmos+ said no (<code>): <words>").
    if (mode.includes('register-409')) { process.stderr.write('Kosmos+ said no (409): The name ' + name + ' is already in use by a Mac on this account, at ' + name + '.kosmos.invalid. If that is this Mac, it is already signed in. If it is a different Mac, turn it off there first, or pick another name.\\n'); process.exit(1); }
    // A rename whose certificate step fails: the new key, id and address are
    // written (write_registration), then the fetch fails.
    if (mode.includes('slow-write-then-fail')) {
      const d4 = flag('--state-dir'); fs.mkdirSync(d4, { recursive: true });
      for (const f of ['mac_id', 'mac_key', 'coordinator_pubkey', 'allow_list']) fs.writeFileSync(path.join(d4, f), f === 'mac_id' ? 'mac-' + name : 'fake');
      fs.writeFileSync(path.join(d4, 'address'), name + '.kosmos.invalid\\n');
      const until = Date.now() + 2500; while (Date.now() < until) { /* the certificate step */ }
      process.stderr.write('Error: Kosmos+ answered 502 for /v1/mac/cert: bad gateway\\n'); process.exit(1);
    }
    if (mode.includes('write-then-fail')) {
      const d3 = flag('--state-dir'); fs.mkdirSync(d3, { recursive: true });
      for (const f of ['mac_id', 'mac_key', 'coordinator_pubkey', 'allow_list']) fs.writeFileSync(path.join(d3, f), f === 'mac_id' ? 'mac-' + name : 'fake');
      fs.writeFileSync(path.join(d3, 'address'), name + '.kosmos.invalid\\n');
      process.stderr.write('Error: Kosmos+ answered 502 for /v1/mac/cert: bad gateway\\n'); process.exit(1);
    }
    if (mode.includes('slow-fail')) { const until = Date.now() + 2500; while (Date.now() < until) { /* wait */ } process.stderr.write('Kosmos+ said no (409): that name is taken\\n'); process.exit(1); }
    if (mode.includes('register-taken')) { process.stderr.write('Kosmos+ said no (409): that name is taken\\n'); process.exit(1); }
    // #3827: a register that is still out when Sign out or Forget lands (busy wait: no timers here).
    // A register killed mid-certificate: the Mac's key and id are written, then it hangs.
    if (mode.includes('partial-register')) {
      const d0 = flag('--state-dir'); fs.mkdirSync(d0, { recursive: true });
      // What the tunnel's write_registration writes before the certificate fetch.
      for (const f of ['mac_id', 'mac_key', 'coordinator_pubkey', 'allow_list']) fs.writeFileSync(path.join(d0, f), 'fake');
      fs.writeFileSync(path.join(d0, 'address'), flag('--name') + '.kosmos.invalid\\n');
      const until = Date.now() + 15000; while (Date.now() < until) { /* hung at the certificate */ }
    }
    // A register that wrote the whole identity and then hung, so its bound kills it
    // after the write: the answer says failed while the Mac is set up.
    if (mode.includes('write-then-hang')) {
      const d1 = flag('--state-dir'); fs.mkdirSync(d1, { recursive: true });
      for (const f of ['mac_id', 'mac_key', 'coordinator_pubkey', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(d1, f), 'fake');
      fs.writeFileSync(path.join(d1, 'address'), name + '.kosmos.invalid\\n');
      const until = Date.now() + 15000; while (Date.now() < until) { /* hung after writing */ }
    }
    // Like the real register: the new key, id and address are written first, then
    // the certificate takes its time (setup.rs write_registration).
    if (mode.includes('slow-register')) {
      const d2 = flag('--state-dir'); fs.mkdirSync(d2, { recursive: true });
      for (const f of ['mac_id', 'mac_key', 'coordinator_pubkey', 'allow_list']) fs.writeFileSync(path.join(d2, f), f === 'mac_id' ? 'mac-' + name : 'fake');
      fs.writeFileSync(path.join(d2, 'address'), name + '.kosmos.invalid\\n');
      const until = Date.now() + Number(process.env.FAKE_REGISTER_MS || 2500); while (Date.now() < until) { /* wait on the certificate */ }
    }
    const dir = flag('--state-dir');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['mac_id', 'mac_key', 'coordinator_pubkey', 'tls.crt', 'tls.key']) {
      // Each registration is its own Mac at the coordinator: its own mac_id.
      fs.writeFileSync(path.join(dir, f), f === 'mac_id' ? 'mac-' + name : 'fake');
    }
    fs.writeFileSync(path.join(dir, 'address'), name + '.kosmos.invalid\\n');
    fs.writeFileSync(path.join(dir, 'stdin-token'), token);
    // The kept-certificate answer shape (setup.rs certificate_survives): JSON only, no certificate line.
    if (name === 'kept') { console.log(JSON.stringify({ stage: 'registered', mac_id: 'mac-fake', name: name, address: name + '.kosmos.invalid', standing: 'good', kept_certificate: true })); process.exit(0); }
    // As the real one does on a fresh register (setup.rs fetch_certificate), before its JSON.
    console.log('certificate for ' + name + '.kosmos.invalid written to ' + path.join(dir, 'tls.crt') + ' (key stayed here)');
    console.log(JSON.stringify({ stage: 'registered', mac_id: 'mac-fake', name: name, address: name + '.kosmos.invalid', standing: 'good', kept_certificate: false }));
    process.exit(0);
  }
  process.stderr.write('unknown signin verb\\n');
  process.exit(1);
}
// A device verb on a dead network (signed_request sets no timeout of its own).
if (args[0] === 'devices' && mode.includes('hung-devices')) { const until = Date.now() + Number(process.env.FAKE_DEVICE_HANG_MS || 3000); while (Date.now() < until) { /* wait */ } fs.appendFileSync(${JSON.stringify(RECORD)}, JSON.stringify(['devices-done']) + '\\n'); }
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
// #3827: a retire that hangs (a dead network).
if (args[0] === 'retire' && mode.includes('hung-retire')) { const until = Date.now() + 15000; while (Date.now() < until) { /* wait */ } }
if (args[0] === 'retire' && mode.includes('slow-retire')) { const until = Date.now() + 2500; while (Date.now() < until) { /* wait */ } }
// A definite refusal: Kosmos+ answered, and it will not retire this key.
// The tunnel's own sentences for a retire (crates/tunnel coordinator.rs signed_request).
if (args[0] === 'retire' && mode.includes('retire-refused')) { process.stderr.write('Error: Kosmos+ refused this Mac: this Mac was retired; set Kosmos up again to give it a new key (HTTP 401 on /v1/mac/retire)\\n'); process.exit(1); }
if (args[0] === 'retire' && mode.includes('retire-down')) { process.stderr.write('Error: Kosmos+ unreachable for /v1/mac/retire: connection refused\\n'); process.exit(1); }
if (args[0] === 'retire' && mode.includes('retire-429')) { process.stderr.write('Error: Kosmos+ refused this Mac: too many requests; wait a minute (HTTP 429 on /v1/mac/retire)\\n'); process.exit(1); }
// A gateway's error page: the tunnel prints the raw body, many lines, when it is not the API's JSON.
if (args[0] === 'retire' && mode.includes('retire-502html')) { process.stderr.write('Error: Kosmos+ answered 502 for /v1/mac/retire: <html>\\n<head><title>502 Bad Gateway</title></head>\\n<body>Bad Gateway</body>\\n</html>\\n'); process.exit(1); }
if (args[0] === 'retire' && mode.includes('retire-5xx')) { process.stderr.write('Error: Kosmos+ answered 503 for /v1/mac/retire: unavailable\\n'); process.exit(1); }
// A retire that worked prints the coordinator's answer, as the real one does.
if (args[0] === 'retire') { console.log(JSON.stringify({ retired: true })); process.exit(0); }
// A signed request: tracing logs to stdout by default (kosmos-relay main.rs), so a warn line can come first.
if (args[0] === 'mac-request' && mode.includes('hung-macreq')) { const until = Date.now() + Number(process.env.FAKE_DEVICE_HANG_MS || 700); while (Date.now() < until) { /* wait */ } fs.appendFileSync(${JSON.stringify(RECORD)}, JSON.stringify(['macreq-done']) + '\\n'); }
if (args[0] === 'mac-request') { console.log('\\u001b[33m WARN\\u001b[0m kosmos_tunnel::coordinator: could not record mac_last_signed'); console.log(JSON.stringify({ standing: 'good' })); process.exit(0); }
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

/* The same for the Settings setup's `setup complete`. */
async function setupSent() {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (recorded().some((c) => c[0] === 'setup' && c[1] === 'complete')) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('fixture: the setup was never sent');
}

/* Wait until the fake has been asked to register, so a cancel lands while the
   register is out at the coordinator, not before it was sent (#3827). */
async function registerSent() {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (recorded().some((c) => c[0] === 'signin' && c[1] === 'register')) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('fixture: the register was never sent');
}

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
  // #3796 addendum 6: capitals are accepted (lowercased); a space is still not a name.
  assert.match((await remote.setupComplete('123456', 'NO CAPS')).because, /3 to 32 letters/);
  const refused = await remote.setupComplete('000000', 'hers');
  assert.equal(refused.ok, false);
  assert.match(refused.because, /not right/);
  const done = await remote.setupComplete('123456', 'Hers');   // #3796 addendum 6: typed with a capital
  assert.equal(done.ok, true, done.because);
  assert.equal(remote.enrolled(), true);
  assert.equal(remote.address(), 'hers.kosmos.invalid', 'the name did not reach the connector lowercased');
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
  // #3796 review: typed with a capital, it is still THIS Mac (lowercased before the recognition).
  const again = await remote.setupComplete('123456', 'Hers');
  assert.equal(again.ok, true, again.because);
  assert.equal(again.alreadySetUp, true, 'a reinstall was re-enrolled instead of recognised (a capital broke the #1010 check)');
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
  assert.match(flat, /--relay relay\.kosmosplus\.com:8443\b/);
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
    assert.equal(remote.DEFAULT_RELAY, 'relay.kosmosplus.com:8443');
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

/* ---- Sign in THIS computer (#3149 journey 2). The bearer material (session
   token, phone challenge) is held in the engine and never returned to the page;
   the create-free property is the coordinator's, not asserted here. ---- */

test('signin start drives the binary, mints a STABLE device id, and does NOT persist the email', async () => {
  assert.match((await remote.signinStart('not-an-email')).because, /email address/);
  const first = await remote.signinStart('her@example.com');
  assert.equal(first.ok, true, first.because);
  assert.equal(first.data.stage, 'code_sent');
  // Sign-in must NOT write the email (unlike setup): it would make status()'s
  // not-enrolled sentence render a stale "waiting for the code" mid-flow.
  assert.equal(remote.read().email, '', 'sign-in must not persist the email');
  const call = recorded().find((c) => c[0] === 'signin' && c[1] === 'start');
  assert.ok(call, 'signin start never reached the binary');
  assert.ok(call.includes('--device-id'), 'no device id was passed');
  const id1 = call[call.indexOf('--device-id') + 1];
  assert.match(id1, /^[A-Za-z0-9_-]{1,128}$/, 'device id has the wrong shape');
  // A second start REUSES the same device id, so the account shows one "this
  // computer" row rather than a fresh device each attempt.
  fs.rmSync(RECORD, { force: true });
  await remote.signinStart('her@example.com');
  const call2 = recorded().find((c) => c[0] === 'signin' && c[1] === 'start');
  const id2 = call2[call2.indexOf('--device-id') + 1];
  assert.equal(id2, id1, 'the device id changed between sign-in attempts');
  // An unreachable coordinator surfaces its last sentence, like setup start.
  const down = await remote.signinStart('down@example.com');
  assert.equal(down.ok, false);
  assert.match(down.because, /unreachable/);
});

test('signin verify returns ONLY the stage: the session token never leaves the engine', async () => {
  await remote.signinStart('her@example.com');
  assert.match((await remote.signinVerify('her@example.com', '12345')).because, /six digits/);
  const refused = await remote.signinVerify('her@example.com', '000000');
  assert.equal(refused.ok, false);
  assert.match(refused.because, /not right/);
  const got = await remote.signinVerify('her@example.com', '111111');
  assert.equal(got.ok, true, got.because);
  assert.equal(got.data.stage, 'session');
  // The whole #874 point: the page-facing shape carries no credential.
  assert.ok(!('token' in got.data), 'the session token leaked to the caller');
  assert.ok(!('challenge' in got.data), 'a challenge leaked to the caller');
});

/* #3796: the wizard's "Sign out" drops the held sign-in. Each kind of bearer material the engine
   can hold is spent after a cancel and refused; the control (the same flow without the cancel)
   succeeds, so the refusal is the cancel's doing. */
test('signin cancel drops the held session, challenge and enrol token', async () => {
  await remote.signinStart('her@example.com');
  assert.equal((await remote.signinVerify('her@example.com', '111111')).data.stage, 'session');
  const c = remote.signinCancel();
  assert.equal(c.ok, true);
  const reg = await remote.signinRegister('hers');
  assert.equal(reg.ok, false, 'register spent a session that Sign out should have dropped');
  await remote.signinStart('her@example.com');
  assert.equal((await remote.signinVerify('her@example.com', '222222')).data.stage, 'second');
  remote.signinCancel();
  assert.equal((await remote.signinSecond('123456')).ok, false, 'a phone challenge outlived Sign out');
  await remote.signinStart('her@example.com');
  assert.equal((await remote.signinVerify('her@example.com', '333333')).data.stage, 'enrol_second_factor');
  remote.signinCancel();
  assert.equal((await remote.signinEnrol('totp')).ok, false, 'an enrol token outlived Sign out');
  // Review: a verify still in flight when Sign out lands must not bring the session back.
  await remote.signinStart('her@example.com');
  const racing = remote.signinVerify('her@example.com', '111111');   // awaiting the tunnel program
  remote.signinCancel();
  const late = await racing;
  assert.equal(late.ok, false, 'a verify in flight during Sign out still reported a session');
  assert.equal((await remote.signinRegister('hers')).ok, false, 'a verify in flight during Sign out resurrected a spendable session');
  await remote.signinStart('her@example.com');
  const racing2 = remote.signinVerify('her@example.com', '222222');
  remote.signinCancel();
  await racing2;
  assert.equal((await remote.signinSecond('123456')).ok, false, 'a verify in flight during Sign out resurrected a phone challenge');
  // CONTROL: without the cancel the held session is spendable.
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  const ok = await remote.signinRegister('hers');
  assert.equal(ok.ok, true, 'control: ' + ok.because);
});

/* #3796 addendum 3 (Josh's live test: an authenticator-only account was told to wait for a text): the
   second stage names the account's ONE factor, passed through only in the shapes the coordinator sends. */
test('signin verify names the account\'s second factor: totp, sms with its masked tail, and nothing else', async () => {
  await remote.signinStart('her@example.com');
  const totp = await remote.signinVerify('her@example.com', '222222');
  assert.equal(totp.data.second_kind, 'totp');
  assert.equal(totp.data.sent_to, '', 'a totp account has no phone to name');
  await remote.signinStart('her@example.com');
  const sms = await remote.signinVerify('her@example.com', '242424');
  assert.equal(sms.data.second_kind, 'sms');
  assert.equal(sms.data.sent_to, '\u2022\u2022\u2022 4321');
  await remote.signinStart('her@example.com');
  const odd = await remote.signinVerify('her@example.com', '252525');
  assert.equal(odd.ok, true, odd.because);
  assert.equal(odd.data.second_kind, '', 'an unknown kind was passed through to the page');
  assert.equal(odd.data.sent_to, '', 'an unmasked or marked-up sent_to was passed through to the page');
  assert.ok(!JSON.stringify(odd.data).includes('ch_fake'), 'the challenge id leaked');
});

/* #3796 addendum 8: an account that already owns an address signs in to it; the session stage carries
   the address so the name step can ask for nothing. Only the coordinator's own shape passes. */
test('signin verify passes the account\'s existing address through, and only in its own shape', async () => {
  await remote.signinStart('her@example.com');
  const owned = await remote.signinVerify('her@example.com', '262626');
  assert.equal(owned.data.stage, 'session');
  assert.equal(owned.data.account_address, 'josh0925-150pm.kosmosplus.com');
  assert.ok(!JSON.stringify(owned.data).includes('kst1.'), 'the session token leaked');
  await remote.signinStart('her@example.com');
  const odd = await remote.signinVerify('her@example.com', '272727');
  assert.equal(odd.data.account_address, '', 'an address in the wrong shape was passed to the page');
  await remote.signinStart('her@example.com');
  const plain = await remote.signinVerify('her@example.com', '111111');
  assert.equal(plain.data.account_address, '', 'an account with no address got one');
});

test('signin verify surfaces the phone-challenge and enrol stages without leaking the challenge id', async () => {
  await remote.signinStart('her@example.com');
  const second = await remote.signinVerify('her@example.com', '222222');
  assert.equal(second.ok, true, second.because);
  assert.equal(second.data.stage, 'second');
  assert.ok(!('challenge' in second.data), 'the challenge id leaked to the caller');
  // A fresh start clears the held challenge; then the enrol stage passes through,
  // surfacing sms_available + the why-authenticator copy but NOT the enrol token.
  await remote.signinStart('her@example.com');
  const enrol = await remote.signinVerify('her@example.com', '333333');
  assert.equal(enrol.ok, true, enrol.because);
  assert.equal(enrol.data.stage, 'enrol_second_factor');
  assert.equal(enrol.data.sms_available, true);
  assert.ok(!('token' in enrol.data), 'the enrol-only token leaked to the caller');
});

test('signin enrol and confirm-enrol drive an in-app second-factor setup, token held in the engine', async () => {
  // totp path: verify -> enrol_second_factor (token held) -> enrol(totp) -> confirm.
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '333333');   // enrol token held
  const started = await remote.signinEnrol('totp');
  assert.equal(started.ok, true, started.because);
  assert.equal(started.data.stage, 'enrolment_started');
  assert.equal(started.data.secret, 'JBSWY3DPEHPK3PXP', 'the totp secret the app shows is passed through');
  assert.ok(!('sent_to' in started.data), 'sms material bled into a totp answer: ' + JSON.stringify(started.data));
  assert.ok(!('token' in started.data), 'the enrol token leaked through enrol');
  assert.ok(!JSON.stringify(started.data).includes('kst1.'), 'the token value leaked under some key: ' + JSON.stringify(started.data));
  // The enrol-only token reached the binary on STDIN, never argv.
  const enrolCall = recorded().find((c) => c[0] === 'signin' && c[1] === 'enrol');
  assert.ok(enrolCall && !enrolCall.some((a) => /kst1\./.test(String(a))), 'the enrol token appeared in argv: ' + JSON.stringify(enrolCall));
  assert.match((await remote.signinConfirmEnrol('12345')).because, /six digits/);
  const done = await remote.signinConfirmEnrol('123456');
  assert.equal(done.ok, true, done.because);
  assert.equal(done.data.stage, 'session', 'confirm-enrol yields a session');
  assert.ok(!('token' in done.data), 'the session token leaked through confirm-enrol');
  assert.ok(!JSON.stringify(done.data).includes('kst1.'), 'the session token value leaked under some key: ' + JSON.stringify(done.data));
  // The session is now held, so register can spend it.
  const reg = await remote.signinRegister(' Hers ');   // #3796 addendum 6: capitals and stray spaces are fine
  assert.equal(reg.ok, true, reg.because);
  const regCall = recorded().find((c) => c[0] === 'signin' && c[1] === 'register');
  assert.ok(regCall && regCall[regCall.indexOf('--name') + 1] === 'hers', 'register did not pass the name lowercased: ' + JSON.stringify(regCall));
  assert.equal(reg.data.stage, 'registered');
});

test('signin enrol by sms passes the number on argv and returns only the masked tail', async () => {
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '333333');
  const started = await remote.signinEnrol('sms', '+12145551234');
  assert.equal(started.ok, true, started.because);
  assert.equal(started.data.kind, 'sms');
  assert.equal(started.data.sent_to, '*** *** 1234', 'the masked tail the app shows');
  assert.ok(!('phone' in started.data), 'the full number must not come back to the caller');
  // The kind-scoped copy drops wrong-kind material the coordinator strayed into the answer.
  assert.ok(!('secret' in started.data) && !('otpauth' in started.data), 'totp material bled into an sms answer: ' + JSON.stringify(started.data));
  // Stronger than the key-absence check above: the full number must not appear
  // anywhere in the app-facing payload, under any key, and the coordinator's
  // session token must be stripped by the engine allowlist.
  assert.ok(!JSON.stringify(started.data).includes('+12145551234'), 'the full number leaked into the enrol answer: ' + JSON.stringify(started.data));
  assert.ok(!('token' in started.data), 'the enrol token leaked through the sms enrol boundary');
  const call = recorded().find((c) => c[0] === 'signin' && c[1] === 'enrol');
  assert.ok(call.includes('--phone') && call.includes('+12145551234'), 'the number did not reach the binary');
  // sms with no phone is refused before spawning.
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '333333');
  const noPhone = await remote.signinEnrol('sms', '');
  assert.equal(noPhone.ok, false);
  assert.match(noPhone.because, /phone number is needed/);
  // A phone that STARTS with '-' (a CLI flag-lookalike) is refused before spawning --
  // no valid phone starts with '-', so this rejects nothing legitimate.
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '333333');
  const before = recorded().length;
  const dashPhone = await remote.signinEnrol('sms', '--coordinator');
  assert.equal(dashPhone.ok, false);
  assert.match(dashPhone.because, /does not look like a phone number/);
  assert.equal(recorded().length, before, 'a flag-lookalike phone must be refused before spawning');
});

test('enrol fails closed when the coordinator returns an enrolment-started answer with no material to show', async () => {
  // A 200 with stage enrolment_started but no secret/otpauth (totp) must not be
  // shown as a blank enrol screen -- the engine refuses instead. This exercises
  // the material guard (the stage is forced by the tunnel, so it can never fire).
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '888888');   // holds kst1.enrol-nomaterial
  const started = await remote.signinEnrol('totp');
  assert.equal(started.ok, false, 'a material-less enrol answer must be refused, not shown');
  assert.match(started.because, /authenticator secret/);
  // The mirror case: truthy but non-string material (secret:123, otpauth:{}) must also
  // fail closed, so the presence guard and the string-only copy can never disagree.
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '999999');   // holds kst1.enrol-badtype
  const badType = await remote.signinEnrol('totp');
  assert.equal(badType.ok, false, 'truthy non-string material must be refused, not shown');
  assert.match(badType.because, /authenticator secret/);
  // The sms branch of the guard, pinned in its own right (not just inferred from the
  // shared str() predicate): an sms enrol answer with no sent_to must fail closed too.
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '303030');   // holds kst1.enrol-sms-nomaterial
  const smsNoTail = await remote.signinEnrol('sms', '+12145551234');
  assert.equal(smsNoTail.ok, false, 'an sms answer with no masked tail must be refused, not shown');
  assert.match(smsNoTail.because, /where the code was sent/);
});

test('enrol refuses without a held enrolment, on a bad kind, and on a tokenless enrol answer', async () => {
  // No verify(enrol) first: nothing to enrol against.
  const early = await remote.signinEnrol('totp');
  assert.equal(early.ok, false);
  assert.match(early.because, /no enrolment waiting/);
  const earlyC = await remote.signinConfirmEnrol('123456');
  assert.equal(earlyC.ok, false);
  assert.match(earlyC.because, /no enrolment waiting/);
  // A held enrolment, but a bad kind is refused in words before spawning.
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '333333');
  assert.match((await remote.signinEnrol('nonsense')).because, /authenticator app or a text message/);
  // A verify enrol answer with NO token fails closed (no enrolment held to spend).
  await remote.signinStart('her@example.com');
  const noTok = await remote.signinVerify('her@example.com', '777777');
  assert.equal(noTok.ok, false);
  assert.match(noTok.because, /enrolment token/);
  assert.equal((await remote.signinEnrol('totp')).ok, false, 'a tokenless enrol answer must not leave an enrolment waiting');
});

test('signin second requires a challenge waiting, then finishes with a held session', async () => {
  // With no verify(second) first, there is no phone step to answer.
  const early = await remote.signinSecond('123456');
  assert.equal(early.ok, false);
  assert.match(early.because, /no phone step/);
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '222222');   // -> stage second, challenge held
  assert.match((await remote.signinSecond('12345')).because, /six digits/);
  const bad = await remote.signinSecond('000000');
  assert.equal(bad.ok, false);
  assert.match(bad.because, /not right/);
  const ok = await remote.signinSecond('123456');
  assert.equal(ok.ok, true, ok.because);
  assert.equal(ok.data.stage, 'session');
  // The engine reused the HELD challenge id -- the caller never supplied it.
  const call = recorded().find((c) => c[0] === 'signin' && c[1] === 'second');
  assert.ok(call.includes('--challenge') && call.includes('ch_fake_123'),
    'the held challenge id did not reach the binary');
});

/* #3827: a successful in-app sign-in switches Kosmos+ ON, so the tunnel actually starts. Starts from OFF
   (the full sign-in test below switches on first, which is exactly what hid this). */
test('#3827 an in-app sign-in from a switched-off computer turns Kosmos+ on and brings the tunnel up', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  remote.setOn(false);
  assert.equal(remote.read().on, false, 'CONTROL: starts switched off');
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  const reg = await remote.signinRegister('offmac');
  assert.equal(reg.ok, true, reg.because);
  assert.equal(remote.read().on, true, 'signing in left Kosmos+ switched off, so nothing connects');
  await until(() => remote.status().state === 'up', 'the tunnel to come up after sign-in from off');
  remote.setOn(false);
});

test('the full sign-in registers this computer, pipes the token off argv, and brings the tunnel up', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  remote.setOn(true);
  remote.ensure(4600);
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '222222');   // phone path
  await remote.signinSecond('123456');
  // Register needs no token argument: the engine holds it.
  // #3796 addendum 6: capitals are accepted now; the space is what refuses this one.
  assert.match((await remote.signinRegister('NO CAPS')).because, /3 to 32 letters/);
  const done = await remote.signinRegister('hers');
  assert.equal(done.ok, true, done.because);
  assert.equal(done.data.stage, 'registered');
  assert.equal(done.data.address, 'hers.kosmos.invalid');
  assert.equal(done.data.standing, 'good');
  assert.equal(remote.enrolled(), true);
  await until(() => remote.status().state === 'up', 'the tunnel to come up after sign-in');
  // SECURITY: the 30-day session token reached the binary on STDIN, never argv.
  const reg = recorded().find((c) => c[0] === 'signin' && c[1] === 'register');
  assert.ok(reg, 'register never reached the binary');
  assert.ok(!reg.some((a) => /kst1\./.test(String(a))), 'the session token appeared in argv: ' + JSON.stringify(reg));
  const piped = fs.readFileSync(nodePath.join(DATA_ROOT, 'remote', 'stdin-token'), 'utf8');
  assert.equal(piped, 'kst1.second-fake', 'the token did not arrive on stdin');
  remote.setOn(false);
});

test('a session-only account (no phone) registers straight from verify', async () => {
  await remote.signinStart('her@example.com');
  const v = await remote.signinVerify('her@example.com', '111111');   // stage session directly
  assert.equal(v.data.stage, 'session');
  const done = await remote.signinRegister('solo');
  assert.equal(done.ok, true, done.because);
  assert.equal(done.data.stage, 'registered');
  const piped = fs.readFileSync(nodePath.join(DATA_ROOT, 'remote', 'stdin-token'), 'utf8');
  assert.equal(piped, 'kst1.session-fake', 'the verify token did not reach register on stdin');
});

test('register without a held session refuses, and a failed register KEEPS the session for a retry', async () => {
  assert.match((await remote.signinRegister('nope')).because, /finish the code steps/);
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  // The coordinator says the name is taken (409). The session must survive so
  // the person can pick another name without redoing the email+phone steps.
  const taken = await remote.signinRegister('taken');
  assert.equal(taken.ok, false);
  assert.match(taken.because, /already has that name|409/);
  const retry = await remote.signinRegister('mine');
  assert.equal(retry.ok, true, retry.because);
  assert.equal(retry.data.stage, 'registered');
});

test('#1010: a survived state at the same name is recognised, not re-registered', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  remote.setOn(true);
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  await remote.signinRegister('hers');
  assert.equal(remote.enrolled(), true);
  // A repeat sign-in ending in register at the SAME name must recognise the Mac
  // and NOT re-register (which would mint a new identity and spend a cert).
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  fs.rmSync(RECORD, { force: true });
  const again = await remote.signinRegister('hers');
  assert.equal(again.ok, true, again.because);
  assert.equal(again.data.alreadySetUp, true, 'a re-sign-in re-registered instead of being recognised');
  assert.ok(!recorded().some((c) => c[0] === 'signin' && c[1] === 'register'),
    'the guard let a re-sign-in re-register: ' + JSON.stringify(recorded()));
});

test('a device name reaches the binary when valid, and is dropped (never surfaced) when malformed', async () => {
  await remote.signinStart('her@example.com', 'My Laptop');
  const withName = recorded().find((c) => c[0] === 'signin' && c[1] === 'start');
  assert.ok(withName.includes('--device-name') && withName.includes('My Laptop'),
    'a valid device name did not reach the binary');
  // A name with a newline fails DEVICE_NAME and is dropped rather than passed
  // through (a newline in argv would let a caller inject a second value).
  fs.rmSync(RECORD, { force: true });
  await remote.signinStart('her@example.com', 'bad\nname');
  const dropped = recorded().find((c) => c[0] === 'signin' && c[1] === 'start');
  assert.ok(!dropped.includes('--device-name'), 'a malformed device name was passed through: ' + JSON.stringify(dropped));
});

test('a malformed coordinator answer is refused, and no session is held to spend', async () => {
  await remote.signinStart('her@example.com');
  const noToken = await remote.signinVerify('her@example.com', '444444');   // session stage, no token
  assert.equal(noToken.ok, false);
  assert.match(noToken.because, /usable session/);
  const noChallenge = await remote.signinVerify('her@example.com', '555555'); // second stage, no challenge
  assert.equal(noChallenge.ok, false);
  assert.match(noChallenge.because, /phone challenge/);
  const unknown = await remote.signinVerify('her@example.com', '666666');    // unknown stage
  assert.equal(unknown.ok, false);
  assert.match(unknown.because, /could not read/);
  // None of those left a session behind, so register has nothing to spend.
  const reg = await remote.signinRegister('hers');
  assert.equal(reg.ok, false);
  assert.match(reg.because, /finish the code steps/);
});

test('a malformed answer AFTER a good one fails closed: the earlier session is cleared, not left spendable', async () => {
  await remote.signinStart('her@example.com');
  const good = await remote.signinVerify('her@example.com', '111111');       // session held
  assert.equal(good.data.stage, 'session');
  // A second verify returns a malformed answer; the previously-held token must
  // NOT survive it (fail closed), so register can no longer spend it.
  const bad = await remote.signinVerify('her@example.com', '444444');        // session, no token
  assert.equal(bad.ok, false);
  const reg = await remote.signinRegister('hers');
  assert.equal(reg.ok, false, 'a stale session survived a malformed answer');
  assert.match(reg.because, /finish the code steps/);
});

test('signinDeviceId replaces a stored id that fails the shape check rather than trusting it', async () => {
  // A garbage device_id survived in remote.json somehow (hand-edit, corruption).
  fs.writeFileSync(remote.FILE, JSON.stringify({ device_id: 'has spaces and / slashes' }));
  await remote.signinStart('her@example.com');
  const call = recorded().find((c) => c[0] === 'signin' && c[1] === 'start');
  const id = call[call.indexOf('--device-id') + 1];
  assert.notEqual(id, 'has spaces and / slashes', 'a malformed stored device id was trusted');
  assert.match(id, /^[A-Za-z0-9_-]{1,128}$/, 'the replacement device id has the wrong shape');
});

test('register survives a child that exits before reading the token off stdin (the EPIPE path)', async () => {
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');   // session held
  // The fake exits early on this name without reading stdin; the engine must
  // surface the failure, not crash on the broken pipe.
  const r = await remote.signinRegister('earlyexit');
  assert.equal(r.ok, false);
  assert.match(r.because, /try again|500/);
  // The session is NOT consumed by a failed register, so a retry is possible.
  const retry = await remote.signinRegister('hers');
  assert.equal(retry.ok, true, retry.because);
});

test('#3827: a Sign out while register is in flight never switches Kosmos+ on', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'slow-register';
  try {
    remote.setOn(false);
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    fs.rmSync(RECORD, { force: true });
    const racing = remote.signinRegister('hers');
    await registerSent();
    remote.signinCancel();
    const late = await racing;
    assert.equal(late.ok, false, 'a register cancelled mid-flight reported success');
    assert.equal(remote.read().on, false, 'Sign out during register left Kosmos+ switched on');
  } finally { delete process.env.FAKE_TUNNEL_MODE; }
});

test('#3827: Forget waits for a register in flight, retires it once, and leaves nothing registered', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'slow-register';
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    fs.rmSync(RECORD, { force: true });
    const racing = remote.signinRegister('hers');
    await registerSent();
    const got = await remote.forget();
    const reg = await racing;
    assert.equal(reg.ok, false, 'the register reported signed in while the Mac was being forgotten');
    assert.match(reg.because, /cancelled/);
    assert.equal(got.retired, true, 'Forget did not retire the Mac the register made: ' + got.because);
    assert.equal(recorded().filter((c) => c[0] === 'retire').length, 1, 'the Mac was retired more (or less) than once');
    assert.equal(remote.enrolled(), false, 'a register finishing after Forget left the Mac registered');
    assert.equal(remote.read().on, false);
  } finally { delete process.env.FAKE_TUNNEL_MODE; }
});

test('#3827: a register that hangs cannot hang Forget: both are bounded', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'slow-register';
  process.env.FAKE_REGISTER_MS = '15000';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    fs.rmSync(RECORD, { force: true });
    const racing = remote.signinRegister('hers');
    const t0 = Date.now();
    await registerSent();
    await remote.forget();
    assert.ok(Date.now() - t0 < 8000, 'Forget waited out a hung register (' + (Date.now() - t0) + 'ms)');
    const late = await racing;
    assert.equal(late.ok, false, 'a register killed by its bound reported success');
    assert.equal(remote.enrolled(), false);
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.FAKE_REGISTER_MS;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
  }
});

test('#3827: a register killed after writing the key and id (mid-certificate) is still retired by Forget', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'partial-register';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    const killed = await remote.signinRegister('hers');
    assert.equal(killed.ok, false, 'fixture: the register was killed by its bound');
    // Only the kill needs the short bound; a register expected to succeed gets room
    // on a loaded machine. Retires stay short so a hung one still ends quickly.
    process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '20000'; process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS = '1500';
    assert.equal(remote.enrolled(), false, 'fixture: no certificate, so not enrolled');
    fs.rmSync(RECORD, { force: true });
    const got = await remote.forget();
    assert.equal(recorded().filter((c) => c[0] === 'retire').length, 1, 'a Mac with a key and id at the coordinator was not retired');
    assert.ok(got.retired, 'Forget did not report the retire: ' + got.because);
    assert.equal(got.because, null, 'a successful retire of a half-registered Mac was reported as: ' + got.because);
    assert.equal(got.address, 'hers.kosmos.invalid', 'Forget did not say which address it retired');
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
  }
});

test('#3827: a second register while one is in flight is refused, and so is a sign-in during Forget', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'slow-register';
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    const first = remote.signinRegister('hers');
    const second = await remote.signinRegister('hers');
    assert.equal(second.ok, false, 'a second register ran beside the first');
    assert.match(second.because, /still signing in/);
    // Nor a fresh sign-in: the register still out would clear its session.
    const fresh = await remote.signinStart('her@example.com');
    assert.equal(fresh.ok, false, 'a new sign-in started while a register was still out');
    assert.match(fresh.because, /still signing in/);
    const forgetting = remote.forget();                 // waits for `first`
    const during = await remote.signinStart('her@example.com');
    assert.equal(during.ok, false, 'a sign-in started while this computer was being forgotten');
    // Both are true here; the Forget is what the person just asked for.
    assert.match(during.because, /being forgotten/);
    await first;
    await forgetting;
    assert.equal(remote.enrolled(), false);
  } finally { delete process.env.FAKE_TUNNEL_MODE; }
});

test('#3827: when the switch cannot be saved, the Mac is still registered and the switch honestly says off', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  fs.mkdirSync(nodePath.dirname(remote.FILE), { recursive: true });
  fs.mkdirSync(remote.FILE + '.tmp', { recursive: true });   // write() goes through FILE + '.tmp'
  try {
    const logged = [];
    const realWrite = process.stderr.write;
    process.stderr.write = function (chunk, ...rest) { logged.push(String(chunk)); return realWrite.call(this, chunk, ...rest); };
    let done;
    try { done = await remote.signinRegister('hers'); } finally { process.stderr.write = realWrite; }
    assert.equal(done.ok, true, 'the Mac IS registered; the sign-in did not fail: ' + done.because);
    assert.equal(remote.read().on, false, 'fixture: the switch really is off');
    assert.ok(logged.some((l) => /could not switch Kosmos\+ on/.test(l)), 'a failed switch save was not logged');
  } finally { fs.rmSync(remote.FILE + '.tmp', { recursive: true, force: true }); }
});

test('#3827: two Forgets at once retire the Mac once and both get the same answer', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  const reg = await remote.signinRegister('hers');
  assert.equal(reg.ok, true, 'fixture: registered ' + reg.because);
  fs.rmSync(RECORD, { force: true });
  const [a, b] = await Promise.all([remote.forget(), remote.forget()]);
  assert.equal(recorded().filter((c) => c[0] === 'retire').length, 1, 'two Forgets retired the Mac twice');
  assert.deepEqual(a, b, 'the second Forget got a different answer');
  assert.equal(remote.enrolled(), false);
});

test('#3827: a retire that hangs cannot hang Forget', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  const reg = await remote.signinRegister('hers');
  assert.equal(reg.ok, true, 'fixture: registered ' + reg.because);
  process.env.FAKE_TUNNEL_MODE = 'hung-retire';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
  try {
    const t0 = Date.now();
    const got = await remote.forget();
    assert.ok(Date.now() - t0 < 8000, 'Forget waited out a hung retire (' + (Date.now() - t0) + 'ms)');
    assert.equal(got.retired, false, 'a retire killed by its bound was reported as done');
    assert.equal(remote.enrolled(), false, 'the Mac is still forgotten here');
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
  }
});

test('#3827: the older Settings setup is refused while a register is in flight', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'slow-register';
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    const racing = remote.signinRegister('hers');
    const setup = await remote.setupComplete('123456', 'other');
    assert.equal(setup.ok, false, 'the Settings setup wrote the state dir beside an in-flight register');
    assert.match(setup.because, /still signing in/);
    await racing;
  } finally { delete process.env.FAKE_TUNNEL_MODE; }
});

test('#3827: a register after one cut off mid-certificate retires the half identity first, with no dead end', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'partial-register';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    const killed = await remote.signinRegister('hers');
    assert.equal(killed.ok, false, 'fixture: the register was killed by its bound');
    // Only the kill needs the short bound; a register expected to succeed gets room
    // on a loaded machine. Retires stay short so a hung one still ends quickly.
    process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '20000'; process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS = '1500';
    delete process.env.FAKE_TUNNEL_MODE;
    fs.rmSync(RECORD, { force: true });
    const again = await remote.signinRegister('hers');
    assert.equal(again.ok, true, 'the retry hit a dead end: ' + again.because);
    const calls = recorded().map((c) => (c[0] === 'signin' ? 'signin ' + c[1] : c[0]));
    assert.ok(calls.indexOf('retire') >= 0 && calls.indexOf('retire') < calls.indexOf('signin register'), 'the half identity was not retired before the new register: ' + JSON.stringify(calls));
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
    remote.setOn(false);
  }
});

test('#3827: every sign-in step is refused while a register is out', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'slow-register';
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    const racing = remote.signinRegister('hers');
    for (const [label, step] of [
      ['verify', () => remote.signinVerify('her@example.com', '111111')],
      ['second', () => remote.signinSecond('123456')],
      ['enrol', () => remote.signinEnrol('totp')],
      ['confirm', () => remote.signinConfirmEnrol('123456')],
    ]) {
      const r = await step();
      assert.equal(r.ok, false, label + ' ran while a register was out');
      assert.match(r.because, /still signing in/, label);
    }
    await racing;
  } finally { delete process.env.FAKE_TUNNEL_MODE; }
});

test('#3827: every sign-in step and the Settings setup are refused while a Forget is running', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  const reg = await remote.signinRegister('hers');
  assert.equal(reg.ok, true, 'fixture: registered ' + reg.because);
  process.env.FAKE_TUNNEL_MODE = 'hung-retire';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
  try {
    const forgetting = remote.forget();   // no register out: only the forgetting branch can refuse
    for (const [label, step] of [
      ['start', () => remote.signinStart('her@example.com')],
      ['verify', () => remote.signinVerify('her@example.com', '111111')],
      ['second', () => remote.signinSecond('123456')],
      ['enrol', () => remote.signinEnrol('totp')],
      ['confirm', () => remote.signinConfirmEnrol('123456')],
      ['register', () => remote.signinRegister('hers')],
      ['setup', () => remote.setupComplete('123456', 'other')],
    ]) {
      const r = await step();
      assert.equal(r.ok, false, label + ' ran while this computer was being forgotten');
      assert.match(r.because, /being forgotten/, label);
    }
    await forgetting;
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
  }
});

test('#3827: a half identity whose retire gets no answer is kept, the register waits, and a retry retires it', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'partial-register';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
  const logged = [];
  const orig = process.stderr.write;
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    const killed = await remote.signinRegister('hers');
    assert.equal(killed.ok, false, 'fixture: the register was killed by its bound');
    // Only the kill needs the short bound; a register expected to succeed gets room
    // on a loaded machine. Retires stay short so a hung one still ends quickly.
    process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '20000'; process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS = '1500';
    process.env.FAKE_TUNNEL_MODE = 'hung-retire';
    fs.rmSync(RECORD, { force: true });
    process.stderr.write = function (chunk, ...rest) { logged.push(String(chunk)); return orig.call(this, chunk, ...rest); };
    const again = await remote.signinRegister('hers');
    process.stderr.write = orig;
    assert.equal(again.ok, false, 'a register ran after a retire that got no answer');
    assert.match(again.because, /could not be removed.*try again/, again.because);
    assert.ok(!recorded().some((c) => c[0] === 'signin' && c[1] === 'register'), 'the register ran beside a kept half identity');
    assert.ok(logged.some((l) => /could not be retired/.test(l)), 'the failed retire was silent: ' + JSON.stringify(logged));
    // The key was kept, so a retry (the network back) retires it and registers.
    delete process.env.FAKE_TUNNEL_MODE;
    fs.rmSync(RECORD, { force: true });
    const retry = await remote.signinRegister('hers');
    assert.equal(retry.ok, true, 'the retry hit a dead end: ' + retry.because);
    const calls = recorded().map((c) => (c[0] === 'signin' ? 'signin ' + c[1] : c[0]));
    assert.ok(calls.indexOf('retire') >= 0 && calls.indexOf('retire') < calls.indexOf('signin register'), 'the kept half identity was not retired on the retry: ' + JSON.stringify(calls));
  } finally {
    process.stderr.write = orig;
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
    remote.setOn(false);
  }
});

test('#3827: after Kosmos+ refused to retire a half identity, its "already in use on this account" says it may be this computer\'s own', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
  const orig = process.stderr.write;
  const halfThen = async (mode) => {
    process.env.FAKE_TUNNEL_MODE = 'partial-register';
    process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
    const killed = await remote.signinRegister('hers');
    assert.equal(killed.ok, false, 'fixture: the register was killed by its bound');
    // Only the kill needs the short bound; a register expected to succeed gets room
    // on a loaded machine. Retires stay short so a hung one still ends quickly.
    process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '20000'; process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS = '1500';
    process.env.FAKE_TUNNEL_MODE = mode;
    return remote.signinRegister('hers');
  };
  try {
    process.stderr.write = () => true;
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    const stranded = await halfThen('retire-refused,register-409');
    assert.equal(stranded.ok, false, 'fixture: the coordinator still holds the name');
    assert.match(stranded.because, /earlier sign-in on this computer/, 'a stranded attempt read as another Mac: ' + stranded.because);
    assert.doesNotMatch(stranded.because, /already signed in|said no/, 'the coordinator\'s sentence (false here) was kept: ' + stranded.because);
    assert.doesNotMatch(stranded.because, /\.\./, 'doubled punctuation: ' + stranded.because);
    // A definite refusal is final, not "try again": with the name free, it registers.
    // Each arm below ends set up at "hers"; start the next from a forgotten Mac.
    const fresh = async () => {
      process.env.FAKE_TUNNEL_MODE = '';
      await remote.forget();
      await remote.signinStart('her@example.com');
      await remote.signinVerify('her@example.com', '111111');
    };
    const refusedThenFree = await halfThen('retire-refused');
    assert.equal(refusedThenFree.ok, true, 'a definite refusal became a dead end: ' + refusedThenFree.because);
    // Unreachable and a server error are kept for a retry.
    for (const mode of ['retire-down', 'retire-5xx', 'retire-429', 'retire-502html']) {
      await fresh();
      const kept = await halfThen(mode);
      assert.equal(kept.ok, false, mode + ': registered over a half identity that could still be retired');
      assert.match(kept.because, /try again/, mode);
      process.env.FAKE_TUNNEL_MODE = '';
      assert.equal((await remote.signinRegister('hers')).ok, true, mode + ': the retry did not clear it');
    }
    await fresh();
    // A half identity that WAS retired: the same answer is left as it is.
    const retired = await halfThen('register-409');
    assert.doesNotMatch(retired.because, /earlier sign-in on this computer/, 'a 409 after a working retire was blamed on this computer');
    // Another account's name after a refused retire: not this computer's doing.
    const other = await halfThen('retire-refused,register-taken');
    assert.doesNotMatch(other.because, /earlier sign-in on this computer/, 'another account\'s name was blamed on this computer');
  } finally {
    process.stderr.write = orig;
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
    remote.setOn(false);
  }
});

test('#3827: the Settings setup also retires a half identity before it registers', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'partial-register';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    const killed = await remote.signinRegister('hers');
    assert.equal(killed.ok, false, 'fixture: the register was killed by its bound');
    // Only the kill needs the short bound; a register expected to succeed gets room
    // on a loaded machine. Retires stay short so a hung one still ends quickly.
    process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '20000'; process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS = '1500';
    delete process.env.FAKE_TUNNEL_MODE;
    await remote.setupStart('her@example.com');
    fs.rmSync(RECORD, { force: true });
    const done = await remote.setupComplete('123456', 'hers');
    assert.equal(done.ok, true, 'the Settings setup hit a dead end: ' + done.because);
    const calls = recorded().map((c) => (c[0] === 'setup' || c[0] === 'signin' ? c[0] + ' ' + c[1] : c[0]));
    assert.ok(calls.indexOf('retire') >= 0 && calls.indexOf('retire') < calls.indexOf('setup complete'), 'the half identity was not retired before the Settings setup: ' + JSON.stringify(calls));
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
    remote.setOn(false);
  }
});

test('#3827: Kosmos+ cannot be turned on while this computer is being forgotten', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  const reg = await remote.signinRegister('hers');
  assert.equal(reg.ok, true, 'fixture: registered ' + reg.because);
  process.env.FAKE_TUNNEL_MODE = 'hung-retire';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
  try {
    const forgetting = remote.forget();
    const on = remote.setOn(true);
    assert.equal(on.ok, false, 'Kosmos+ was switched on in the middle of a Forget');
    assert.match(on.because, /being forgotten/);
    await forgetting;
    assert.equal(remote.read().on, false, 'the switch is on after the Forget');
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
  }
});

test('#3827: a Try again after a register the page gave up on is answered, not sent back to the code steps', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'slow-register';
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    const first = remote.signinRegister('hers');
    const early = await remote.signinRegister('hers');
    assert.match(early.because, /still signing in/, 'fixture: the first is still out');
    assert.equal((await first).ok, true, 'fixture: the late register succeeded');
    const late = await remote.signinRegister('hers');
    assert.equal(late.ok, true, 'a Try again after a late success hit: ' + late.because);
    assert.equal(late.data && late.data.alreadySetUp, true);
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    remote.setOn(false);
  }
});

test('#3827: a Forget during a Settings setup ends it cancelled, not "set up"', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'slow-setup';
  try {
    await remote.setupStart('her@example.com');
    fs.rmSync(RECORD, { force: true });
    const setting = remote.setupComplete('123456', 'hers');
    await setupSent();
    const forgetting = remote.forget();
    const r = await setting;
    assert.equal(r.ok, false, 'the Settings page was told it is set up while the Mac was being forgotten');
    assert.match(r.because, /cancelled/);
    await forgetting;
    assert.equal(remote.enrolled(), false, 'the Mac is still set up after the Forget');
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    remote.setOn(false);
  }
});

test('#3827: turning Kosmos+ on, or changing the relay, is refused while a register is still out', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'slow-register';
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    const racing = remote.signinRegister('hers');
    const on = remote.setOn(true);
    assert.equal(on.ok, false, 'Kosmos+ was switched on beside a register still out');
    assert.match(on.because, /still signing in/);
    const relay = remote.setRelay('127.0.0.1:9555');
    assert.equal(relay.ok, false, 'the relay was changed beside a register still out');
    assert.equal(remote.setOn(false).ok, true, 'turning off must never wait');
    const done = await racing;
    assert.equal(done.ok, true, 'fixture: the register succeeded');
    assert.equal(remote.read().on, false, 'the register switched Kosmos+ back on after the person turned it off');
    assert.equal(done.data.switchedOn, false, 'the answer said connecting about a switch that is off');
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    remote.setOn(false);
  }
});

test('#3827: the relay cannot be changed while this computer is being forgotten', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  process.env.FAKE_TUNNEL_MODE = 'hung-retire';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
  try {
    const forgetting = remote.forget();
    const relay = remote.setRelay('127.0.0.1:9555');
    assert.equal(relay.ok, false, 'the relay was changed (and the tunnel started) in the middle of a Forget');
    assert.match(relay.because, /being forgotten/);
    await forgetting;
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
    remote.setRelay('');
  }
});

test('#3827: a Sign out during a register leaves Kosmos+ off even when it was on before the sign-in', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'slow-register';
  try {
    assert.equal(remote.setOn(true).ok, true, 'fixture: switched on before signing in');
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    fs.rmSync(RECORD, { force: true });
    const racing = remote.signinRegister('hers');
    await registerSent();
    remote.signinCancel();
    const late = await racing;
    assert.match(late.because, /cancelled/);
    assert.equal(remote.read().on, false, 'the Mac would come online on the next ensure tick after a Sign out');
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    remote.setOn(false);
  }
});

test('#3827: Forget switches off before it waits on the retire, and a retire has its own shorter bound', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  assert.equal(remote.read().on, true, 'fixture: on after sign-in');
  process.env.FAKE_TUNNEL_MODE = 'hung-retire';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '6000';
  process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS = '800';
  try {
    const t0 = Date.now();
    const forgetting = remote.forget();
    await new Promise((r) => setImmediate(r));
    assert.equal(remote.read().on, false, 'the switch was still on during the retire wait (the ensure tick would restart the tunnel)');
    await forgetting;
    assert.ok(Date.now() - t0 < 4000, 'the retire waited out the register bound (' + (Date.now() - t0) + 'ms)');
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS;
    delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
  }
});

test('#3827: after a Sign out, a stale Try again at the same name does not switch Kosmos+ back on', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  remote.signinCancel();
  remote.setOn(false);
  const stale = await remote.signinRegister('hers');
  assert.equal(stale.ok, false, 'a Try again with no session undid the Sign out');
  assert.equal(remote.read().on, false, 'the switch came back on');
  assert.match(stale.because, /already signed in as hers\.kosmos\.invalid; turn Kosmos. on/, 'a set-up Mac was sent back to the code steps: ' + stale.because);
});

test('#3827: the Settings setup gets the same stranded-name answer', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
  const orig = process.stderr.write;
  try {
    process.stderr.write = () => true;
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    process.env.FAKE_TUNNEL_MODE = 'partial-register';
    assert.equal((await remote.signinRegister('hers')).ok, false, 'fixture: the register was killed by its bound');
    // Only the kill needs the short bound; a register expected to succeed gets room
    // on a loaded machine. Retires stay short so a hung one still ends quickly.
    process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '20000'; process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS = '1500';
    await remote.setupStart('her@example.com');
    process.env.FAKE_TUNNEL_MODE = 'retire-refused,setup-409';
    const r = await remote.setupComplete('123456', 'hers');
    assert.equal(r.ok, false, 'fixture: the name is still held');
    assert.match(r.because, /The name hers may be held by an earlier sign-in on this computer/, r.because);
    assert.doesNotMatch(r.because, /nothing more to do/, 'the setup sentence (false here) was kept');
  } finally {
    process.stderr.write = orig;
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
    remote.setOn(false);
  }
});

test('#3827: a Sign out lands on a register killed after it wrote the identity: the switch still goes off', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'write-then-hang';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
  try {
    assert.equal(remote.setOn(true).ok, true, 'fixture: switched on before signing in');
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    fs.rmSync(RECORD, { force: true });
    const racing = remote.signinRegister('hers');
    await registerSent();
    remote.signinCancel();
    const late = await racing;
    assert.match(late.because, /cancelled/);
    assert.equal(remote.enrolled(), true, 'fixture: the killed register left a full identity');
    assert.equal(remote.read().on, false, 'a register reported failed but set up left the switch on: the ensure tick would bring it online');
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
    await remote.forget();
  }
});

test('#3827: a set-up Mac missing only its address file is not treated as half registered', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  const dir = process.env.AGENT_WORKFORCE_TUNNEL_STATE || nodePath.join(DATA_ROOT, 'remote');
  fs.rmSync(nodePath.join(dir, 'address'), { force: true });
  assert.ok(fs.existsSync(nodePath.join(dir, 'tls.crt')), 'fixture: the certificate is still there');
  fs.rmSync(RECORD, { force: true });
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  await remote.signinRegister('hers');
  assert.ok(!recorded().some((c) => c[0] === 'retire'), 'a Mac with its certificate was retired as half registered');
  await remote.forget();
});

test('#3827: device verbs and a second-factor reset wait while this computer is being forgotten', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  process.env.FAKE_TUNNEL_MODE = 'hung-retire';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
  try {
    const forgetting = remote.forget();
    for (const [label, step] of [
      ['allow', () => remote.deviceAllow('dev-1', 'iPhone')],
      ['deny', () => remote.deviceDeny('dev-1')],
      ['remove', () => remote.deviceRemove('dev-1')],
      ['second reset', () => remote.secondReset()],
    ]) {
      const r = await step();
      assert.equal(r.ok, false, label + ' signed with a key being forgotten');
      assert.match(r.because, /being forgotten/, label);
    }
    await forgetting;
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
  }
});

test('#3827: a tunnel restart while a register is out does not start a tunnel on the half-written identity', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered and on');
  remote.ensure(4600);
  const pid = remote.currentChildPid();
  assert.ok(pid, 'fixture: a registered, switched-on Mac runs a tunnel');
  process.env.FAKE_TUNNEL_MODE = 'slow-register';
  process.env.FAKE_REGISTER_MS = '4000';
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    fs.rmSync(RECORD, { force: true });
    const racing = remote.signinRegister('theirs');   // writes the new key, id and address, then waits on the certificate
    await registerSent();
    process.kill(pid, 'SIGTERM');                      // the tunnel dies; its restart comes in ~1s, mid-register
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(remote.currentChildPid(), null, 'a tunnel was started on the new key with the old certificate');
    assert.equal((await racing).ok, true, 'fixture: the register finished');
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.FAKE_REGISTER_MS;
    remote.setOn(false);
    await remote.forget();
  }
});
test('#3827: the Settings setup also keeps a half identity whose retire got no answer', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
  const orig = process.stderr.write;
  try {
    process.stderr.write = () => true;
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    process.env.FAKE_TUNNEL_MODE = 'partial-register';
    assert.equal((await remote.signinRegister('hers')).ok, false, 'fixture: the register was killed by its bound');
    // Only the kill needs the short bound; a register expected to succeed gets room
    // on a loaded machine. Retires stay short so a hung one still ends quickly.
    process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '20000'; process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS = '1500';
    await remote.setupStart('her@example.com');
    process.env.FAKE_TUNNEL_MODE = 'retire-502html';
    fs.rmSync(RECORD, { force: true });
    const r = await remote.setupComplete('123456', 'hers');
    assert.equal(r.ok, false, 'the Settings setup ran over a half identity that could still be retired');
    assert.match(r.because, /answered 502/, 'the kept answer should name the real reason, not "</html>": ' + r.because);
    assert.ok(!recorded().some((c) => c[0] === 'setup' && c[1] === 'complete'), 'setup complete ran beside a kept half identity');
  } finally {
    process.stderr.write = orig;
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
    remote.setOn(false);
    await remote.forget();
  }
});

test('#3827: a Settings setup in flight blocks the in-app register, turning on and the device verbs', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.FAKE_TUNNEL_MODE = 'slow-setup';
  try {
    await remote.setupStart('her@example.com');
    const setting = remote.setupComplete('123456', 'hers');
    await remote.signinStart('her@example.com').catch(() => null);
    for (const [label, step] of [
      ['register', () => remote.signinRegister('theirs')],
      ['on', () => remote.setOn(true)],
      ['relay', () => remote.setRelay('127.0.0.1:9555')],
      ['allow', () => remote.deviceAllow('dev-1', 'iPhone')],
      ['second reset', () => remote.secondReset()],
    ]) {
      const r = await step();
      assert.equal(r.ok, false, label + ' ran beside a Settings setup still out');
      assert.match(r.because, /still signing in/, label);
    }
    assert.equal((await setting).ok, true, 'fixture: the Settings setup finished');
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    remote.setOn(false);
    await remote.forget();
  }
});

test('#3827: a Sign out during the half-identity retire means the register is never sent', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '1500';
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    process.env.FAKE_TUNNEL_MODE = 'partial-register';
    assert.equal((await remote.signinRegister('hers')).ok, false, 'fixture: the register was killed by its bound');
    process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '20000';
    process.env.FAKE_TUNNEL_MODE = 'slow-retire';
    fs.rmSync(RECORD, { force: true });
    const racing = remote.signinRegister('hers');
    await new Promise((r) => setTimeout(r, 300));
    remote.signinCancel();
    const late = await racing;
    assert.match(late.because, /cancelled/);
    assert.ok(recorded().some((c) => c[0] === 'retire'), 'fixture: the retire ran');
    assert.ok(!recorded().some((c) => c[0] === 'signin' && c[1] === 'register'), 'a register was sent after the person signed out');
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS;
    remote.setOn(false);
    await remote.forget();
  }
});

test('#3827: a Forget whose retire meets a gateway error page says why in one readable line', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  process.env.FAKE_TUNNEL_MODE = 'retire-502html';
  try {
    const got = await remote.forget();
    assert.equal(got.retired, false);
    assert.match(got.because, /Kosmos\+ answered 502 for \/v1\/mac\/retire/, got.because);
    assert.doesNotMatch(got.because, /<\/?html|Error:/, 'the answer carried the raw page: ' + got.because);
  } finally { delete process.env.FAKE_TUNNEL_MODE; }
});

test('#3827: a Sign out during a register that then fails leaves a Mac that was on, on', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered and on');
  process.env.FAKE_TUNNEL_MODE = 'slow-fail';
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    fs.rmSync(RECORD, { force: true });
    const racing = remote.signinRegister('other');
    await registerSent();
    remote.signinCancel();
    const late = await racing;
    assert.match(late.because, /cancelled/);
    assert.equal(remote.read().on, true, 'a register that changed nothing switched a working Mac off');
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    remote.setOn(false);
    await remote.forget();
  }
});

test('#3827: the tunnel answer is its last JSON line, and only that line', () => {
  const pick = (said) => { const got = remote.lastJsonLine(said); return got ? got.value : null; };
  assert.deepEqual(pick('certificate for hers.x written to /s/tls.crt (key stayed here)\n{"stage":"registered"}\n'), { stage: 'registered' }, 'a certificate line before the JSON');
  assert.deepEqual(pick('{"stage":"registered","kept_certificate":true}'), { stage: 'registered', kept_certificate: true }, 'JSON only (a kept certificate)');
  assert.deepEqual(pick('\u001b[33mWARN\u001b[0m could not record mac_last_signed\n{"status":200,"body":{}}\n'), { status: 200, body: {} }, 'a tracing line on stdout before the JSON');
  assert.deepEqual(pick('{"stage":"registered"}\r\n'), { stage: 'registered' }, 'CRLF');
  assert.equal(pick(''), null, 'empty stdout is no answer');
  assert.equal(pick('certificate for x written'), null, 'no JSON line is no answer');
  assert.equal(pick('{"old":true}\n{not json'), null, 'a last line that does not parse is unreadable, never the older object');
  assert.equal(pick('{\n  "stage": "registered"\n}'), null, 'pretty-printed JSON is not read line by line into something else');
});

test('#3827: a register whose answer is JSON only (the kept-certificate shape) is read as signed in too', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  const r = await remote.signinRegister('kept');
  assert.equal(r.ok, true, r.because);
  assert.equal(r.data.address, 'kept.kosmos.invalid');
  remote.setOn(false);
});

test('#3827: a signed request whose tunnel logs a line before its answer is still read', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  const r = await remote.macRequest('POST', '/v1/mac/standing', {});   // the real tunnel refuses GET
  assert.equal(r.ok, true, 'a log line on stdout made a signed request unreadable: ' + r.because);
  assert.deepEqual(r.data, { standing: 'good' });
  remote.setOn(false);
});

test('#3827: a fresh register whose tunnel prints its certificate line first is still read as signed in, and switches Kosmos+ on', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  remote.setOn(false);
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  const r = await remote.signinRegister('hers');
  assert.equal(r.ok, true, 'a real first sign-in read as a failure: ' + r.because);
  assert.equal(r.data.address, 'hers.kosmos.invalid');
  assert.equal(remote.read().on, true, 'signed in, but Kosmos+ was not switched on (the #3827 symptom)');
  remote.setOn(false);
});

test('#3838: the token VALUE reaches the tunnel in no argument and no environment variable, only its path', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  const SECRET = 'tok3838secretvalue';
  const tokenFile = nodePath.join(DATA_ROOT, 'board.token');
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  fs.writeFileSync(tokenFile, SECRET + '\n', { mode: 0o600 });
  fs.rmSync(RECORD + '.run-env', { force: true });
  fs.rmSync(RECORD + '.run-env-hits', { force: true });
  fs.writeFileSync(RECORD + '.probe', SECRET);
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    await remote.signinRegister('hers');
    remote.setOn(true);
    remote.ensure(4600);
    await until(() => remote.status().state === 'up', 'the tunnel to come up');
    assert.equal(fs.readFileSync(RECORD + '.run-env', 'utf8'), tokenFile, 'fixture: the tunnel was told the real token file');
    const leaked = JSON.parse(fs.readFileSync(RECORD + '.run-env-hits', 'utf8'));
    assert.deepEqual(leaked, [], 'the token value is in the tunnel environment under ' + leaked.join(', '));
    const run = recorded().find((c) => c[0] === 'run');
    assert.ok(!run.some((x) => String(x).includes(SECRET)), 'the token value is on the tunnel argv');
  } finally {
    remote.setOn(false);
    fs.rmSync(tokenFile, { force: true });
    fs.rmSync(RECORD + '.probe', { force: true });
    fs.rmSync(RECORD + '.run-env-hits', { force: true });
  }
});

test('#3838: a KOSMOS_BOARD_TOKEN_FILE inherited from the launcher never reaches the tunnel when no file is found', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  fs.rmSync(RECORD + '.run-env', { force: true });
  const boardauth = require('./boardauth');
  const real = boardauth.enforcedTokenPath;
  boardauth.enforcedTokenPath = () => { throw new Error('no data root'); };
  const had = process.env.KOSMOS_BOARD_TOKEN_FILE;
  process.env.KOSMOS_BOARD_TOKEN_FILE = '/stale/from/the/launcher/board.token';
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    await remote.signinRegister('hers');
    remote.setOn(true);
    remote.ensure(4600);
    await until(() => remote.status().state === 'up', 'the tunnel to come up');
    assert.equal(fs.readFileSync(RECORD + '.run-env', 'utf8'), '(unset)',
      'a stale inherited token file reached the tunnel');
  } finally {
    boardauth.enforcedTokenPath = real;
    if (had === undefined) delete process.env.KOSMOS_BOARD_TOKEN_FILE; else process.env.KOSMOS_BOARD_TOKEN_FILE = had;
    remote.setOn(false);
  }
});

test('#3838: the tunnel is told the file the board ENFORCES (enforcedTokenPath), not merely the primary path', async () => {
  // In this sandbox both would answer the same path, so the wiring is proved by
  // making them differ: whatever enforcedTokenPath answers is what the tunnel gets.
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  fs.rmSync(RECORD + '.run-env', { force: true });
  const boardauth = require('./boardauth');
  const real = boardauth.enforcedTokenPath;
  const legacyOnly = nodePath.join(SANDBOX, 'legacy-leaf', 'board.token');
  boardauth.enforcedTokenPath = () => legacyOnly;
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    await remote.signinRegister('hers');
    remote.setOn(true);
    remote.ensure(4600);
    await until(() => remote.status().state === 'up', 'the tunnel to come up');
    assert.equal(fs.readFileSync(RECORD + '.run-env', 'utf8'), legacyOnly,
      'the tunnel was told the primary path, not the file the board enforces (a legacy-only token)');
  } finally {
    boardauth.enforcedTokenPath = real;
    remote.setOn(false);
  }
});

test('#3838: the tunnel is told where the board token file is, by environment, never argv', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  fs.rmSync(RECORD + '.run-env', { force: true });   // nothing from an earlier start
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  await remote.signinRegister('hers');
  remote.setOn(true);
  remote.ensure(4600);
  await until(() => remote.status().state === 'up', 'the tunnel to come up');
  const envPath = fs.readFileSync(RECORD + '.run-env', 'utf8');
  // A literal path, not tokenPath(): the file the board writes its token to.
  assert.equal(envPath, nodePath.join(DATA_ROOT, 'board.token'), 'the tunnel was not told the board token file');
  const run = recorded().find((c) => c[0] === 'run');
  assert.ok(run, 'fixture: run reached the binary');
  assert.ok(!run.includes('--board-token-file'), 'the path went on argv, which an older bundled tunnel would refuse');
  assert.ok(!run.some((a) => String(a).includes('board.token')), 'the token file went on argv under some spelling: ' + JSON.stringify(run));
  remote.setOn(false);
});

test('#3827: a device verb hanging on a dead network cannot hang Forget', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  process.env.FAKE_TUNNEL_MODE = 'hung-devices';
  process.env.FAKE_DEVICE_HANG_MS = '4000';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '20000';
  process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS = '800';
  try {
    const allowing = remote.deviceAllow('dev-1', 'iPhone');   // out before the Forget, on a dead network
    const t0 = Date.now();
    await remote.forget();
    assert.ok(Date.now() - t0 < 3000, 'Forget waited out a hung device call (' + (Date.now() - t0) + 'ms)');
    await allowing;   // let the hung call finish inside this test
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.FAKE_DEVICE_HANG_MS;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
  }
});

test('#3827: a rename that fails after writing its new id is retired on the next try, and no tunnel runs on the mix', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  const dir = process.env.AGENT_WORKFORCE_TUNNEL_STATE || nodePath.join(DATA_ROOT, 'remote');
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  remote.ensure(4600);
  assert.ok(remote.currentChildPid(), 'fixture: a tunnel runs');
  const orig = process.stderr.write;
  try {
    process.stderr.write = () => true;
    process.env.FAKE_TUNNEL_MODE = 'write-then-fail';
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    const failed = await remote.signinRegister('theirs');
    assert.equal(failed.ok, false, 'fixture: the certificate step failed');
    assert.equal(remote.currentChildPid(), null, 'a tunnel kept running beside a new id and the old certificate');
    assert.ok(!fs.existsSync(nodePath.join(dir, 'tls.crt')), 'the old certificate was left beside the new id');
    delete process.env.FAKE_TUNNEL_MODE;
    fs.rmSync(RECORD, { force: true });
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    const again = await remote.signinRegister('theirs');
    assert.equal(again.ok, true, again.because);
    assert.notEqual(again.data && again.data.alreadySetUp, true, 'the retry was answered by the shortcut over the mixed identity');
    const calls = recorded().map((c) => (c[0] === 'signin' ? 'signin ' + c[1] : c[0]));
    assert.ok(calls.indexOf('retire') >= 0 && calls.indexOf('retire') < calls.indexOf('signin register'), 'the failed new id was not retired first: ' + JSON.stringify(calls));
  } finally {
    process.stderr.write = orig;
    delete process.env.FAKE_TUNNEL_MODE;
    remote.setOn(false);
    await remote.forget();
  }
});

test('#3827: a signed call on a dead network is ended by its own bound', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  process.env.FAKE_TUNNEL_MODE = 'hung-devices';
  process.env.FAKE_DEVICE_HANG_MS = '4000';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '20000';
  process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS = '800';
  try {
    const t0 = Date.now();
    const r = await remote.deviceAllow('dev-1', 'iPhone');
    assert.equal(r.ok, false);
    assert.ok(Date.now() - t0 < 3000, 'a hung signed call was not ended by its bound (' + (Date.now() - t0) + 'ms)');
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.FAKE_DEVICE_HANG_MS;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
    await remote.forget();
  }
});

test('#3827: Forget lets a signed call already out finish before it retires', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  process.env.FAKE_TUNNEL_MODE = 'hung-devices';
  process.env.FAKE_DEVICE_HANG_MS = '700';
  try {
    fs.rmSync(RECORD, { force: true });
    const allowing = remote.deviceAllow('dev-1', 'iPhone');
    await new Promise((r) => setTimeout(r, 100));
    await remote.forget();
    await allowing;
    const calls = recorded().map((c) => c[0]);
    assert.ok(calls.indexOf('devices-done') >= 0 && calls.indexOf('devices-done') < calls.indexOf('retire'), 'Forget retired while a signed call was still out: ' + JSON.stringify(calls));
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.FAKE_DEVICE_HANG_MS;
  }
});

test('#3827: a successful rename replaces the running tunnel with one on the new identity', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  remote.ensure(4600);
  const before = remote.currentChildPid();
  assert.ok(before, 'fixture: a tunnel runs');
  try {
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    assert.equal((await remote.signinRegister('theirs')).ok, true, 'fixture: renamed');
    const after = remote.currentChildPid();
    assert.ok(after, 'no tunnel after the rename');
    assert.notEqual(after, before, 'the tunnel from the old identity kept running after the rename');
  } finally {
    remote.setOn(false);
    await remote.forget();
  }
});

test('#3827: a standing answer about an identity replaced while it was out is not written onto the new one', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  const dir = process.env.AGENT_WORKFORCE_TUNNEL_STATE || nodePath.join(DATA_ROOT, 'remote');
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  remote.fedSetStanding('');
  try {
    await remote.refreshStandingIfStale({ ttlMs: 0, now: Date.now() + 1, fetcher: async () => {
      fs.writeFileSync(nodePath.join(dir, 'mac_id'), 'mac-someone-else');   // a Forget and a new sign-in meanwhile
      return 'good';
    } });
    assert.equal(remote.read().standing, '', 'the old identity\'s standing was written onto the new one');
  } finally {
    remote.setOn(false);
    await remote.forget();
  }
});

test('#3827: Forget lets a signed mac-request already out finish before it retires', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  process.env.FAKE_TUNNEL_MODE = 'hung-macreq';
  process.env.FAKE_DEVICE_HANG_MS = '700';
  try {
    fs.rmSync(RECORD, { force: true });
    const asking = remote.macRequest('POST', '/v1/mac/standing', {});
    await new Promise((r) => setTimeout(r, 100));
    await remote.forget();
    await asking;
    const calls = recorded().map((c) => c[0]);
    assert.ok(calls.indexOf('macreq-done') >= 0 && calls.indexOf('macreq-done') < calls.indexOf('retire'), 'Forget retired while a mac-request was still out: ' + JSON.stringify(calls));
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.FAKE_DEVICE_HANG_MS;
  }
});

test('#3827: a Sign out during a rename that then fails leaves no new id beside the old certificate', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  const dir = process.env.AGENT_WORKFORCE_TUNNEL_STATE || nodePath.join(DATA_ROOT, 'remote');
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  const orig = process.stderr.write;
  try {
    process.stderr.write = () => true;
    process.env.FAKE_TUNNEL_MODE = 'slow-write-then-fail';
    await remote.signinStart('her@example.com');
    await remote.signinVerify('her@example.com', '111111');
    fs.rmSync(RECORD, { force: true });
    const racing = remote.signinRegister('theirs');
    await registerSent();
    remote.signinCancel();
    assert.match((await racing).because, /cancelled/);
    assert.ok(!fs.existsSync(nodePath.join(dir, 'tls.crt')), 'the old certificate was left beside the new id after a Sign out');
    delete process.env.FAKE_TUNNEL_MODE;
    remote.setOn(true);
    remote.ensure(4600);
    assert.equal(remote.currentChildPid(), null, 'a tunnel started on the new id and the old certificate');
  } finally {
    process.stderr.write = orig;
    delete process.env.FAKE_TUNNEL_MODE;
    remote.setOn(false);
    await remote.forget();
  }
});

test('#3827: a signed mac-request is refused while this computer is being forgotten', async () => {
  process.env.AGENT_WORKFORCE_TUNNEL_RELAY = '127.0.0.1:9444';
  await remote.signinStart('her@example.com');
  await remote.signinVerify('her@example.com', '111111');
  assert.equal((await remote.signinRegister('hers')).ok, true, 'fixture: registered');
  process.env.FAKE_TUNNEL_MODE = 'hung-retire';
  process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS = '20000';
  process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS = '1500';
  try {
    const forgetting = remote.forget();
    const r = await remote.macRequest('POST', '/v1/mac/standing', {});
    assert.equal(r.ok, false, 'a mac-request signed with a key being retired');
    assert.match(r.because, /being forgotten/);
    await forgetting;
  } finally {
    delete process.env.FAKE_TUNNEL_MODE;
    delete process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS; delete process.env.AGENT_WORKFORCE_RETIRE_TIMEOUT_MS;
  }
});
