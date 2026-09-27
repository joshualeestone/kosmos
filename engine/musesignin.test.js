'use strict';
/* #3939 slice 3: Muse Code's sign-in, driven end to end through a REAL tmux (on a private socket) against
   test-support/fake-muse-login.sh, which prints `muse login`'s screens in the words Homer captured and logs
   every key it was sent. Nothing here reaches Meta, the person's own muse, or the Keychain.

     node --test engine/musesignin.test.js
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'muse-signin-data-'));
process.env.AGENT_WORKFORCE_DATA = DATA;
process.env.AGENT_WORKFORCE_HOME = path.join(DATA, 'home');
delete process.env.XDG_CONFIG_HOME;
const FAKE = path.join(__dirname, '..', 'test-support', 'fake-muse-login.sh');
function findTmux() {
  for (const p of [process.env.AGENT_WORKFORCE_TMUX_BIN, '/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux']) {
    if (p && fs.existsSync(p)) return p;
  }
  try { return execFileSync('/bin/sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}
const TMUX = findTmux();
const skip = TMUX ? false : 'no tmux on this machine (CI installs it in test.yml)';
const signin = require('./musesignin');
const musestatus = require('./musestatus');
test.after(() => { signin.resetForTests(); fs.rmSync(DATA, { recursive: true, force: true }); });

function setup(flow) {
  const dir = fs.mkdtempSync(path.join(DATA, 'run-'));
  const log = path.join(dir, 'fake.log');
  process.env.AGENT_WORKFORCE_TMUX_BIN = TMUX;
  process.env.AGENT_WORKFORCE_MUSE_SIGNIN_SOCKET = 'kosmos-muse-signin-test-' + process.pid + '-' + flow;
  process.env.AGENT_WORKFORCE_MUSE = '1';
  signin.resetForTests();
  fs.rmSync(musestatus.signedInMarker(), { force: true });
  require('./live-execution').allowLiveExecution();   // a real tmux on a private socket, on purpose
  // tmux does not hand a new session the test's environment: a wrapper carries the fake's settings.
  const wrapper = path.join(dir, 'muse');
  fs.writeFileSync(wrapper, '#!/bin/bash\nexport FAKE_MUSE_LOG=' + JSON.stringify(log) + '\nexport FAKE_MUSE_FLOW=' + flow
    + '\nexec /bin/bash ' + JSON.stringify(FAKE) + ' "$@"\n', { mode: 0o755 });
  signin.setForTests({ museBin: () => ({ installed: true, bin: wrapper }), folderRoot: () => dir, tickMs: 200 });
  const cleanup = () => {
    try { execFileSync(TMUX, ['-L', process.env.AGENT_WORKFORCE_MUSE_SIGNIN_SOCKET, 'kill-server'], { stdio: 'ignore' }); } catch { /* none */ }
    signin.resetForTests();
    require('./live-execution').resetForTests();
    delete process.env.AGENT_WORKFORCE_MUSE;
  };
  return { dir, log, cleanup, logText: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '') };
}
async function until(fn, ms = 15000, what = 'the condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('timed out waiting for ' + what + ' (state ' + JSON.stringify(signin.status()) + ')');
}
const onMac = process.platform === 'darwin';

test('#3939: the sign-in shows Meta\'s code, presses Enter once, and ends signed in', { skip: skip || (!onMac && 'the flag is Mac only'), timeout: 30000 }, async () => {
  const t = setup('normal');
  try {
    assert.equal(musestatus.signedIn().signedIn, false, 'CONTROL: not signed in before');
    const started = signin.start();
    assert.equal(started.ok, true, JSON.stringify(started));
    await until(() => signin.status().code === 'WXYZ-1234', 15000, 'the code');
    assert.equal(signin.status().url, 'https://auth.meta.com/device?user_code=WXYZ-1234');
    await until(() => signin.status().state === 'done', 15000, 'the sign-in to finish');
    const log = t.logText();
    assert.equal((log.match(/^press:/gm) || []).length, 1, 'Enter was not pressed exactly once: ' + log);
    assert.match(log, /^press:Enter$/m);
    assert.match(log, /^args:login$/m);
    assert.match(log, /^env:1\|1\|1$/m, 'MUSE_LOGIN, MUSE_NO_AUTO_UPDATE and MUSE_NO_MODIFY_PATH were not all set');
    assert.match(log, new RegExp('^home:' + os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'm'), 'HOME was changed for muse (it hides the Keychain on a Mac)');
    assert.match(log, /^xdg:unset$/m, 'XDG_CONFIG_HOME was set for muse');
    assert.equal(signin.status().code, undefined, 'a used code is still shown after the sign-in ended');
    assert.deepEqual(musestatus.signedIn(), { signedIn: true, how: 'kosmos' });
    assert.throws(() => execFileSync(TMUX, ['-L', process.env.AGENT_WORKFORCE_MUSE_SIGNIN_SOCKET, 'has-session', '-t', signin.SESSION], { stdio: 'ignore' }), 'the session outlived the sign-in');
  } finally { t.cleanup(); }
});

test('#3939: an expired code is replaced on retry, and only the new code is shown', { skip: skip || (!onMac && 'the flag is Mac only'), timeout: 30000 }, async () => {
  const t = setup('expire');
  try {
    const { id } = signin.start();
    await until(() => signin.status().state === 'expired', 15000, 'the expiry');
    assert.equal(signin.status().code, undefined, 'an expired code is still shown');
    assert.equal(signin.retry('not-this-one').ok, false, 'a retry from another sign-in was taken');
    assert.deepEqual(signin.retry(id), { ok: true });
    await until(() => signin.status().code === 'QRST-5678', 15000, 'the second code');
    await until(() => signin.status().state === 'done', 15000, 'the sign-in to finish');
    const log = t.logText();
    assert.match(log, /^retry:r$/m); assert.match(log, /^retry2:Enter$/m);
    assert.equal((log.match(/^press:Enter$/gm) || []).length, 2, 'each code gets exactly one Enter: ' + log);
  } finally { t.cleanup(); }
});

test('#3939: a failed save, an early exit and a strange screen each end in words', { skip: skip || (!onMac && 'the flag is Mac only'), timeout: 60000 }, async () => {
  let t = setup('unsaved');
  try {
    signin.start();
    await until(() => signin.status().state === 'failed', 15000, 'the failure');
    assert.match(signin.status().because, /could not save the sign-in/);
    assert.equal(musestatus.signedIn().signedIn, false, 'a sign-in that was not saved was recorded as signed in');
  } finally { t.cleanup(); }
  t = setup('quit');
  try {
    signin.start();
    await until(() => signin.status().state === 'failed', 15000, 'the early exit');
    assert.match(signin.status().because, /closed before it finished/);
  } finally { t.cleanup(); }
  t = setup('strange');
  try {
    const realNow = Date.now; let skew = 0;
    signin.setForTests({ now: () => realNow() + skew });
    signin.start();
    await new Promise((r) => setTimeout(r, 1500));
    assert.notEqual(signin.status().state, 'stuck', 'CONTROL: not stuck before the wait');
    skew = signin.STUCK_MS + 1000;
    await until(() => signin.status().state === 'stuck', 5000, 'stuck');
    assert.match(signin.status().because, /does not recognise/);
  } finally { t.cleanup(); }
});

test('#3939: with the flag off, nothing starts', { timeout: 5000 }, () => {
  signin.resetForTests();
  delete process.env.AGENT_WORKFORCE_MUSE;
  let ran = false;
  signin.setForTests({ tmux: () => { ran = true; return ''; }, museBin: () => ({ installed: true, bin: '/nowhere/muse' }) });
  const r = signin.start();
  assert.equal(r.ok, false);
  assert.match(r.because, /not turned on/);
  assert.equal(ran, false, 'tmux ran with the flag off');
  assert.equal(musestatus.enabled('darwin'), false);
  process.env.AGENT_WORKFORCE_MUSE = '1';
  try {
    assert.equal(musestatus.enabled('darwin'), true, 'CONTROL: the flag turns it on');
    assert.equal(musestatus.enabled('win32'), false, 'the flag turned it on off a Mac');
  } finally { delete process.env.AGENT_WORKFORCE_MUSE; signin.resetForTests(); }
});

test('#3939: the screen words: the last one drawn counts, and the code is the current try\'s', () => {
  const first = 'To sign in, open https://auth.meta.com/device?user_code=AAAA-1111\nand enter the code: AAAA-1111\nPress Enter to open it in your browser: \nWaiting for approval... Esc cancel\n';
  const expired = first + 'The login request expired before it was approved. Press r then Enter to try again\n';
  const second = expired + 'To sign in, open https://auth.meta.com/device?user_code=BBBB-2222\nand enter the code: BBBB-2222\nPress Enter to open it in your browser: ';
  assert.equal(signin.screenOf(first), 'waiting');
  assert.equal(signin.screenOf(expired), 'expired');
  assert.equal(signin.screenOf(second), 'press');
  assert.deepEqual(signin.promptOf(second), { url: 'https://auth.meta.com/device?user_code=BBBB-2222', code: 'BBBB-2222' });
  assert.equal(signin.screenOf(second + '\nLogged in. Credential saved.'), 'done');
  // The fake draws every screen the engine reads, in the same words.
  const fake = fs.readFileSync(FAKE, 'utf8');
  for (const [name, re] of Object.entries(signin.SCREENS)) assert.ok(re.test(fake), 'the fake muse does not draw the ' + name + ' screen');
});

test('#3939: signed in from Muse\'s own file: a providers.meta entry counts, an empty one (after logout) does not', () => {
  const file = musestatus.authFile();
  fs.rmSync(musestatus.signedInMarker(), { force: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify({ schema_version: 1, providers: {} }));
    assert.equal(musestatus.signedIn().signedIn, false, 'an empty providers (after muse logout) read as signed in');
    fs.writeFileSync(file, JSON.stringify({ schema_version: 1, providers: { meta: { mechanism: 'oauth' } } }));
    assert.deepEqual(musestatus.signedIn(), { signedIn: true, how: 'file' });
    assert.ok(file.startsWith(process.env.AGENT_WORKFORCE_HOME), 'CONTROL: the file read is inside the sandbox home');
  } finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
});
