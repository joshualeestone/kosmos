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
  // A wrapper keeps the fake's settings explicit, whatever environment a tmux server was started with.
  const wrapper = path.join(dir, 'muse');
  fs.writeFileSync(wrapper, '#!/bin/bash\nexport FAKE_MUSE_LOG=' + JSON.stringify(log) + '\nexport FAKE_MUSE_FLOW=' + flow
    + '\nexec /bin/bash ' + JSON.stringify(FAKE) + ' "$@"\n', { mode: 0o755 });
  signin.setForTests({ museBin: () => ({ installed: true, bin: wrapper }), tickMs: 200 });
  const cleanup = () => {
    try { execFileSync(TMUX, ['-L', process.env.AGENT_WORKFORCE_MUSE_SIGNIN_SOCKET, 'kill-server'], { stdio: 'ignore' }); } catch { /* none */ }
    // kill-server leaves the socket file behind (round 1: dozens piled up); remove this run's own.
    try { fs.rmSync(path.join(process.env.TMUX_TMPDIR || '/private/tmp', 'tmux-' + process.getuid(), process.env.AGENT_WORKFORCE_MUSE_SIGNIN_SOCKET), { force: true }); } catch { /* none */ }
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
    assert.doesNotMatch(log, /^stray:/m, 'a second key went to muse while it was still on the code screen: ' + log);
    assert.match(log, /^press:Enter$/m);
    assert.match(log, /^args:login$/m);
    assert.match(log, /^env:1\|1\|1$/m, 'MUSE_LOGIN, MUSE_NO_AUTO_UPDATE and MUSE_NO_MODIFY_PATH were not all set');
    assert.match(log, new RegExp('^home:' + os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'm'), 'HOME was changed for muse (it hides the Keychain on a Mac)');
    assert.match(log, /^xdg:unset$/m, 'XDG_CONFIG_HOME was set for muse');
    assert.equal(signin.status().code, undefined, 'a used code is still shown after the sign-in ended');
    assert.equal(signin.status().url, undefined, 'the used code is still served inside the address (round 5)');
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

test('#3939 round 1: a slow new code keeps the retry, and a second retry is refused rather than typed onto it', { skip: skip || (!onMac && 'the flag is Mac only'), timeout: 40000 }, async () => {
  const t = setup('slowretry');
  try {
    const { id } = signin.start();
    await until(() => signin.status().state === 'expired', 15000, 'the expiry');
    assert.deepEqual(signin.retry(id), { ok: true });
    await new Promise((r) => setTimeout(r, 1200));   // the old expiry line is still the last one drawn
    assert.equal(signin.status().state, 'starting', 'the retry fell back to expired while the new code was on its way');
    assert.equal(signin.retry(id).ok, false, 'a second retry was taken while the first was still arriving');
    await until(() => signin.status().code === 'QRST-5678', 15000, 'the second code');
    await until(() => signin.status().state === 'done', 15000, 'the sign-in to finish');
    assert.doesNotMatch(t.logText(), /^press:r$/m, 'a retry key landed on the new code screen');
  } finally { t.cleanup(); }
});

test('#3939 round 1: an Enter that did not move Muse on is sent once more', { skip: skip || (!onMac && 'the flag is Mac only'), timeout: 30000 }, async () => {
  const t = setup('deaf');
  const realNow = Date.now; let skew = 0;
  signin.setForTests({ now: () => realNow() + skew });
  try {
    signin.start();
    await until(() => /^press:Enter$/m.test(t.logText()), 15000, 'the first Enter');
    await new Promise((r) => setTimeout(r, 600));
    assert.doesNotMatch(t.logText(), /press-again/, 'CONTROL: no second Enter before the wait');
    skew = signin.RESEND_MS + 1000;
    await until(() => signin.status().state === 'done', 15000, 'the sign-in to finish after the second Enter');
    assert.match(t.logText(), /^press-again:Enter$/m);
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
  // Its drawn lines only, not its comments (round 2: a header comment matched "saving failed").
  const fake = fs.readFileSync(FAKE, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  for (const [name, re] of Object.entries(signin.SCREENS)) assert.ok(re.test(fake), 'the fake muse does not draw the ' + name + ' screen');
});

test('#3939: signed in from Muse\'s own file: a providers.meta entry counts, an empty one (after logout) does not', () => {
  const file = musestatus.authFile();
  fs.rmSync(musestatus.signedInMarker(), { force: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify({ schema_version: 1, providers: {} }));
    assert.equal(musestatus.signedIn().signedIn, false, 'an empty providers (after muse logout) read as signed in');
    fs.writeFileSync(file, JSON.stringify({ schema_version: 1, providers: { meta: {} } }));
    assert.equal(musestatus.signedIn().signedIn, false, 'an empty meta entry read as signed in (round 4)');
    fs.writeFileSync(file, JSON.stringify({ schema_version: 1, providers: { meta: { mechanism: 'oauth' } } }));
    assert.deepEqual(musestatus.signedIn(), { signedIn: true, how: 'file' });
    assert.ok(file.startsWith(process.env.AGENT_WORKFORCE_HOME), 'CONTROL: the file read is inside the sandbox home');
  } finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
});

/* Round 2: the two failure margins, with tmux stood in (no real session). Ticks are driven by hand. */
function stubbed(tmuxFn) {
  signin.resetForTests();
  process.env.AGENT_WORKFORCE_MUSE = '1';
  signin.setForTests({ tmux: tmuxFn, museBin: () => ({ installed: true, bin: '/nowhere/muse' }), tickMs: 2147483647 });
  const r = signin.start();
  assert.equal(r.ok, true, JSON.stringify(r));
  return () => { signin.resetForTests(); delete process.env.AGENT_WORKFORCE_MUSE; };
}

test('#3939 round 2: one missed session check does not end a sign-in; two in a row do', { skip: !onMac && 'the flag is Mac only' }, () => {
  let gone = false;
  const done = stubbed((args) => {
    if (gone && (args[0] === 'capture-pane' || args[0] === 'has-session')) throw Object.assign(new Error('no session'), { status: 1 });
    return args[0] === 'capture-pane' ? 'Starting...\n' : '';
  });
  try {
    signin.tickForTests();
    gone = true;
    signin.tickForTests();
    assert.equal(signin.status().state, 'starting', 'one missed check ended the sign-in');
    signin.tickForTests();
    assert.equal(signin.status().state, 'failed', 'two missed checks in a row did not end it');
  } finally { done(); }
});

test('#3939 round 2: tmux failing to send is named only after MAX_KEY_FAILURES in a row', { skip: !onMac && 'the flag is Mac only' }, () => {
  let n = 0;
  const done = stubbed((args) => {
    if (args[0] === 'send-keys') throw Object.assign(new Error('send failed'), { status: 1 });
    // One code throughout, as a real run draws (round 5): each failed send is re-armed and tried again.
    if (args[0] === 'capture-pane') { n += 1; return 'open https://auth.meta.com/device?user_code=AAAA-1000\nand enter the code: AAAA-1000\nPress Enter to open it in your browser: '; }
    return '';
  });
  try {
    const limit = signin.MAX_KEY_FAILURES;
    for (let i = 0; i < limit - 1; i += 1) signin.tickForTests();
    assert.notEqual(signin.status().state, 'stuck', 'CONTROL: not stuck before the limit');
    signin.tickForTests();
    assert.equal(signin.status().state, 'stuck');
    assert.match(signin.status().because, /could not reach Muse Code/);
  } finally { done(); }
});

/* Round 3, with tmux stood in. `screenText` is what capture-pane shows; keys sent are recorded. */
function scripted(first) {
  const st = { text: first, sent: [] };
  const realNow = Date.now; st.skew = 0;
  const done = stubbed((args) => {
    if (args[0] === 'send-keys') { st.sent.push(args.slice(3).join(' ')); return ''; }
    return args[0] === 'capture-pane' ? st.text : '';
  });
  signin.setForTests({ now: () => realNow() + st.skew });
  return { st, done };
}
const PROMPT = 'To sign in, open https://auth.meta.com/device?user_code=WXYZ-1234\nand enter the code: WXYZ-1234\nPress Enter to open it in your browser: ';
const EXPIRED_TEXT = PROMPT + '\nWaiting for approval... Esc cancel\nThe login request expired before it was approved. Press r then Enter to try again\n';

test('#3939 round 3/5: a retry that gets no new code ends the sign-in (start again), and no further retry is typed', { skip: !onMac && 'the flag is Mac only' }, () => {
  const { st, done } = scripted(EXPIRED_TEXT);
  try {
    signin.tickForTests();
    assert.equal(signin.status().state, 'expired');
    const id = signin.status().id;
    assert.deepEqual(signin.retry(id), { ok: true });
    signin.tickForTests();
    assert.equal(signin.status().state, 'starting', 'CONTROL: the retry holds while a new code may be coming');
    st.skew = signin.STUCK_MS + 1000;
    signin.tickForTests(); signin.tickForTests();
    assert.equal(signin.status().state, 'failed', 'a retry that got no new code was never given up');
    assert.match(signin.status().because, /start the sign-in again/);
    const before = st.sent.length;
    assert.equal(signin.retry(id).ok, false, 'a second retry was taken after the first was given up (round 5: its r lands on the late code)');
    assert.equal(st.sent.length, before, 'keys went to muse after the sign-in was given up');
  } finally { done(); }
});

test('#3939 round 3: while the browser opens, no second Enter; a later waiting screen clears an old reason', { skip: !onMac && 'the flag is Mac only' }, () => {
  const { st, done } = scripted(PROMPT);
  try {
    signin.tickForTests();
    assert.deepEqual(st.sent, ['Enter']);
    st.text = PROMPT + '\nOpening your browser...\n';
    st.skew = signin.RESEND_MS + 1000;
    signin.tickForTests(); signin.tickForTests();
    assert.deepEqual(st.sent, ['Enter'], 'an Enter was sent while Muse was opening the browser');
    assert.equal(signin.status().state, 'code');
    // A stuck reason from the resend path goes once Muse is waiting.
    st.text = PROMPT; st.skew += signin.RESEND_MS + 1000; signin.tickForTests();
    st.skew += signin.RESEND_MS + 1000; signin.tickForTests();
    assert.equal(signin.status().state, 'stuck', 'CONTROL: the resend path named it stuck');
    st.text = PROMPT + '\nOpening your browser...\nWaiting for approval... Esc cancel\n';
    signin.tickForTests();
    assert.equal(signin.status().state, 'code');
    assert.equal(signin.status().because, undefined, 'the old stuck reason stayed after Muse moved on');
  } finally { done(); }
});

test('#3939 round 3: retry reads the screen, not the state, before typing', { skip: !onMac && 'the flag is Mac only' }, () => {
  const { st, done } = scripted(EXPIRED_TEXT);
  try {
    signin.tickForTests();
    const id = signin.status().id;
    st.text = PROMPT;   // Muse moved on, the state has not caught up yet
    assert.equal(signin.retry(id).ok, false);
    assert.deepEqual(st.sent, [], 'r was typed onto a screen that is no longer the expired one');
  } finally { done(); }
});

test('#3939 round 5: the 20-minute limit is final, not an expiry a retry can answer', { skip: !onMac && 'the flag is Mac only' }, () => {
  const { st, done } = scripted(EXPIRED_TEXT);
  try {
    signin.tickForTests();
    assert.equal(signin.status().state, 'expired', 'CONTROL: Muse\'s own expiry is retryable');
    st.skew = signin.GIVE_UP_MS + 1000;
    signin.tickForTests();
    assert.equal(signin.status().state, 'failed');
    assert.match(signin.status().because, /waited too long/);
    assert.equal(signin.retry(signin.status().id).ok, false);
  } finally { done(); }
});

test('#3939 round 6 (convention 3): with the live-execution gate closed, a start that would run tmux for real throws in a test', { skip: !onMac && 'the flag is Mac only' }, () => {
  signin.resetForTests();
  require('./live-execution').resetForTests();
  process.env.AGENT_WORKFORCE_MUSE = '1';
  signin.setForTests({ museBin: () => ({ installed: true, bin: '/usr/bin/true' }) });
  try {
    assert.throws(() => signin.start(), /for real inside a test/);
    assert.equal(signin.status().state, 'idle', 'a sign-in was recorded although nothing may run');
  } finally { signin.resetForTests(); delete process.env.AGENT_WORKFORCE_MUSE; }
});

/* Round 7: the delivery-unknown and reset branches, each with a stubbed tmux. */
const timeoutErr = () => Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });

test('#3939 round 7: a retry send that timed out counts as sent, so no second r follows', { skip: !onMac && 'the flag is Mac only' }, () => {
  const { st, done } = scripted(EXPIRED_TEXT);
  let first = true;
  signin.setForTests({ tmux: (args) => {
    if (args[0] === 'send-keys') { st.sent.push(args.slice(3).join(' ')); if (first) { first = false; throw timeoutErr(); } return ''; }
    return args[0] === 'capture-pane' ? st.text : '';
  } });
  try {
    signin.tickForTests();
    const id = signin.status().id;
    assert.equal(signin.retry(id).ok, true, 'a timed-out retry send was treated as not sent');
    assert.equal(signin.retry(id).ok, false, 'a second retry was taken while the first may be arriving');
    assert.deepEqual(st.sent, ['r Enter']);
  } finally { done(); }
});

test('#3939 round 7: an Enter that timed out is not re-armed (it may have arrived)', { skip: !onMac && 'the flag is Mac only' }, () => {
  const { st, done } = scripted(PROMPT);
  signin.setForTests({ tmux: (args) => {
    if (args[0] === 'send-keys') { st.sent.push(args.slice(3).join(' ')); throw timeoutErr(); }
    return args[0] === 'capture-pane' ? st.text : '';
  } });
  try {
    signin.tickForTests(); signin.tickForTests(); signin.tickForTests();
    assert.deepEqual(st.sent, ['Enter'], 'a timed-out Enter was sent again before the resend wait');
  } finally { done(); }
});

test('#3939 round 7: a slow tmux is not a gone session', { skip: !onMac && 'the flag is Mac only' }, () => {
  let slow = false;
  const done = stubbed((args) => {
    if (slow && (args[0] === 'capture-pane' || args[0] === 'has-session')) throw timeoutErr();
    return args[0] === 'capture-pane' ? 'Starting...\n' : '';
  });
  try {
    signin.tickForTests();
    slow = true;
    for (let i = 0; i < 4; i += 1) signin.tickForTests();
    assert.equal(signin.status().state, 'starting', 'timeouts from tmux ended the sign-in as gone');
  } finally { done(); }
});

test('#3939 round 7: a send that goes out clears the failure count', { skip: !onMac && 'the flag is Mac only' }, () => {
  let n = 0; let failing = true;
  const done = stubbed((args) => {
    if (args[0] === 'send-keys' && failing) throw Object.assign(new Error('send failed'), { status: 1 });
    if (args[0] === 'capture-pane') { n += 1; return 'open https://auth.meta.com/device?user_code=AAAA-' + (1000 + n) + '\nand enter the code: AAAA-' + (1000 + n) + '\nPress Enter to open it in your browser: '; }
    return '';
  });
  try {
    signin.tickForTests();                 // one failure
    failing = false; signin.tickForTests(); // a send goes out
    failing = true;
    for (let i = 0; i < signin.MAX_KEY_FAILURES - 1; i += 1) signin.tickForTests();
    assert.notEqual(signin.status().state, 'stuck', 'failures before a good send still counted');
  } finally { done(); }
});

test('#3939 round 7: a retry restarts the give-up clock', { skip: !onMac && 'the flag is Mac only' }, () => {
  const { st, done } = scripted(EXPIRED_TEXT);
  try {
    signin.tickForTests();
    st.skew = signin.GIVE_UP_MS - 1000;
    signin.tickForTests();
    assert.deepEqual(signin.retry(signin.status().id), { ok: true });
    st.skew = signin.GIVE_UP_MS + 5000;   // past the first code's limit, well inside the new one's
    st.text = PROMPT.replace(/WXYZ-1234/g, 'QRST-5678');
    signin.tickForTests();
    assert.notEqual(signin.status().state, 'failed', 'the new code was ended on the old code\'s clock');
  } finally { done(); }
});

test('#3939 round 8: a sign-in Kosmos could not record is not reported done', { skip: !onMac && 'the flag is Mac only' }, () => {
  const marker = musestatus.signedInMarker();
  const { done } = scripted(PROMPT + '\nWaiting for approval... Esc cancel\nLogged in. Credential saved.\n');
  fs.rmSync(marker, { recursive: true, force: true });
  fs.mkdirSync(marker, { recursive: true });   // a folder where the mark goes: the write cannot succeed
  try {
    signin.tickForTests();
    assert.equal(signin.status().state, 'failed', 'a sign-in with no record was reported done');
    assert.match(signin.status().because, /could not record it/);
    assert.equal(fs.statSync(marker).isDirectory(), true, 'CONTROL: the obstacle was still in place');
  } finally { done(); fs.rmSync(marker, { recursive: true, force: true }); }
});

/* Round 9: Muse may draw the code and go straight to waiting, with no Press line. */
const CODE_ONLY = (c) => 'To sign in, open https://auth.meta.com/device?user_code=' + c + '\nand enter the code: ' + c + '\n';
test('#3939 round 9: a code followed straight by waiting is shown, and no Enter is sent', { skip: !onMac && 'the flag is Mac only' }, () => {
  const { st, done } = scripted(CODE_ONLY('WXYZ-1234') + 'Waiting for approval... Esc cancel\n');
  try {
    signin.tickForTests();
    assert.equal(signin.status().code, 'WXYZ-1234', 'the code was never shown');
    assert.equal(signin.status().state, 'code');
    assert.deepEqual(st.sent, [], 'an Enter went to a Muse that was already waiting');
  } finally { done(); }
});

test('#3939 round 9: after a retry, a new code drawn straight to waiting is shown; no code at all is named', { skip: !onMac && 'the flag is Mac only' }, () => {
  const { st, done } = scripted(EXPIRED_TEXT);
  try {
    signin.tickForTests();
    const id = signin.status().id;
    assert.deepEqual(signin.retry(id), { ok: true });
    st.text = EXPIRED_TEXT + CODE_ONLY('QRST-5678') + 'Waiting for approval... Esc cancel\n';
    signin.tickForTests();
    assert.equal(signin.status().code, 'QRST-5678', 'the retry\'s new code was never read');
    assert.deepEqual(st.sent, ['r Enter'], 'more than the retry\'s own keys were sent');
  } finally { done(); }
  const b = scripted('Waiting for approval... Esc cancel\n');
  try {
    signin.tickForTests();
    assert.equal(signin.status().state, 'starting', 'CONTROL: not named before the wait');
    b.st.skew = signin.STUCK_MS + 1000;
    signin.tickForTests();
    assert.equal(signin.status().state, 'stuck', 'a waiting screen with no code was waited on silently');
  } finally { b.done(); }
});

test('#3939 round 9: a failed save clears an older mark, so it cannot answer yes beside the failure', { skip: !onMac && 'the flag is Mac only' }, () => {
  const marker = musestatus.signedInMarker();
  const { done } = scripted(PROMPT + '\nWaiting for approval... Esc cancel\nlogin succeeded but saving failed: failed to write credential file\n');
  fs.writeFileSync(marker, '{"at":"earlier"}\n');
  try {
    assert.equal(musestatus.signedIn().signedIn, true, 'CONTROL: the older mark answers yes');
    signin.tickForTests();
    assert.equal(signin.status().state, 'failed');
    assert.equal(musestatus.signedIn().signedIn, false, 'an older mark still answered yes beside a failed save');
  } finally { done(); fs.rmSync(marker, { force: true }); }
});

/* Round 11: the current-try cut, and both halves of round 9's waiting path after a retry. */
test('#3939 round 11: after a retry, the expired code is never shown as the current one', { skip: !onMac && 'the flag is Mac only' }, () => {
  const { st, done } = scripted(EXPIRED_TEXT);
  try {
    signin.tickForTests();
    assert.deepEqual(signin.retry(signin.status().id), { ok: true });
    st.text = EXPIRED_TEXT + 'Waiting for approval... Esc cancel\n';   // waiting, no new code yet
    signin.tickForTests();
    assert.equal(signin.status().code, undefined, 'the expired code was shown as the current one');
    // A new code carried only in the address: the new one is shown, not the old dashed one.
    st.text = EXPIRED_TEXT + 'To sign in, open https://auth.meta.com/device?user_code=newcode77\nPress Enter to open it in your browser: ';
    signin.tickForTests();
    assert.equal(signin.status().code, 'newcode77', 'the old code was paired with the new address');
  } finally { done(); }
});

test('#3939 round 11: a retry that reaches waiting with no code ends (start again)', { skip: !onMac && 'the flag is Mac only' }, () => {
  const { st, done } = scripted(EXPIRED_TEXT);
  try {
    signin.tickForTests();
    assert.deepEqual(signin.retry(signin.status().id), { ok: true });
    st.text = EXPIRED_TEXT + 'Waiting for approval... Esc cancel\n';
    signin.tickForTests();
    st.skew = signin.STUCK_MS + 1000;
    signin.tickForTests();
    assert.equal(signin.status().state, 'failed', 'a retry stuck on waiting was left to the 20-minute limit');
    assert.match(signin.status().because, /start the sign-in again/);
  } finally { done(); }
});

test('#3939 round 11: a retry\'s code drawn straight to waiting can itself expire and be retried', { skip: !onMac && 'the flag is Mac only' }, () => {
  const { st, done } = scripted(EXPIRED_TEXT);
  try {
    signin.tickForTests();
    const id = signin.status().id;
    assert.deepEqual(signin.retry(id), { ok: true });
    st.text = EXPIRED_TEXT + CODE_ONLY('QRST-5678') + 'Waiting for approval... Esc cancel\n';
    signin.tickForTests();
    assert.equal(signin.status().code, 'QRST-5678');
    st.text += 'The login request expired before it was approved. Press r then Enter to try again\n';
    signin.tickForTests();
    assert.equal(signin.status().state, 'expired', 'the second expiry was not read as one');
    assert.equal(signin.retry(id).ok, true, 'a second retry was refused after a code drawn straight to waiting');
  } finally { done(); }
});
