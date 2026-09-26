'use strict';
/* #3998: the hidden Antigravity sign-in, driven end to end through a REAL tmux (on a private socket)
   against test-support/fake-agy-signin.sh, which prints agy 1.2.11's screens in the same words and
   logs every key it was sent. Nothing here reaches Google or the person's own agy. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FAKE = path.join(__dirname, '..', 'test-support', 'fake-agy-signin.sh');
function findTmux() {
  for (const p of [process.env.AGENT_WORKFORCE_TMUX_BIN, '/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux']) {
    if (p && fs.existsSync(p)) return p;
  }
  try { return execFileSync('/bin/sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}
const TMUX = findTmux();
const skip = TMUX ? false : 'no tmux on this machine (CI installs it in test.yml)';

function setup(flow) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-signin-test-'));
  const log = path.join(dir, 'fake.log');
  process.env.AGENT_WORKFORCE_TMUX_BIN = TMUX;
  process.env.AGENT_WORKFORCE_AGY_SIGNIN_SOCKET = 'kosmos-agy-signin-test-' + process.pid + '-' + flow;
  const signin = require('./agysignin');
  signin.resetForTests();
  // These tests drive a real tmux on a private socket on purpose: open the live-execution gate for them.
  require('./live-execution').allowLiveExecution();
  // The fake reads its settings from the environment the tmux server hands it: a wrapper script
  // carries them, since tmux does not pass the test's own environment to a new session.
  const wrapper = path.join(dir, 'agy');
  fs.writeFileSync(wrapper, '#!/bin/bash\nexport FAKE_AGY_LOG=' + JSON.stringify(log) + '\nexport FAKE_AGY_FLOW=' + flow
    + (flow === 'wrong-folder' ? '\nexport FAKE_AGY_TRUST_DIR=' + JSON.stringify(os.homedir()) : '')
    + '\nexec /bin/bash ' + JSON.stringify(FAKE) + '\n', { mode: 0o755 });
  signin.setForTests({
    agyBin: () => ({ installed: true, bin: wrapper }),
    folderRoot: () => dir,
    confirmSignedIn: async () => ({ signedIn: fs.existsSync(log) && /(^|\n)ready\n/.test(fs.readFileSync(log, 'utf8')) }),
  });
  const cleanup = () => {
    signin.stop();
    try { execFileSync(TMUX, ['-L', process.env.AGENT_WORKFORCE_AGY_SIGNIN_SOCKET, 'kill-server'], { stdio: 'ignore' }); } catch { /* none */ }
    signin.resetForTests();
    require('./live-execution').resetForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { signin, dir, log, cleanup, logText: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '') };
}
async function until(fn, ms = 20000, what = 'the condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 200)); }
  throw new Error('timed out waiting for ' + what);
}

test('#3998: the whole sign-in runs hidden: menu, code from Kosmos, colour, terms left UNTICKED, own folder trusted', { skip }, async () => {
  const t = setup('normal');
  try {
    const started = t.signin.start();
    assert.equal(started.ok, true);
    assert.match(started.id, /^[0-9a-f]{16}$/, 'a sign-in names itself so a screen can say which one it means');
    await until(() => t.signin.status().state === 'code', 15000, 'the code step');
    assert.match(t.signin.status().url, /^https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?/, 'the sign-in address was not picked up');
    assert.match(t.logText(), /^menu:Enter$/m, 'Google OAuth was not chosen');
    // A code that is not one is refused before anything is typed.
    assert.equal(t.signin.code('rm -rf ~; echo', started.id).ok, false);
    assert.deepEqual(t.signin.code('4/0AXlqoi78ZmW2ZEDHmXTxfTTbEqk1iq3YSD1LPLn9DJBTH8v-TZgGLs9n', started.id), { ok: true });
    await until(() => t.signin.status().state === 'done', 25000, 'the sign-in to finish');
    const log = t.logText();
    assert.match(log, /^code:4\/0AXlqoi78ZmW2ZEDHmXTxfTTbEqk1iq3YSD1LPLn9DJBTH8v-TZgGLs9n$/m, 'the code did not reach agy intact');
    assert.match(log, /^theme:Enter$/m);
    assert.doesNotMatch(log, /terms:Space/, 'Kosmos pressed Space on the terms (that ticks the data-sharing box)');
    assert.doesNotMatch(log, /terms:went-back/, 'Enter on "Previous" went back a step');
    assert.match(log, /^datashare:0$/m, 'the optional data sharing was ticked for the person');
    assert.match(log, /^trust:Enter$/m, 'its own sign-in folder was not trusted');
    assert.match(log, /^ready$/m);
    // The hidden session is closed once signed in.
    assert.throws(() => execFileSync(TMUX, ['-L', process.env.AGENT_WORKFORCE_AGY_SIGNIN_SOCKET, 'has-session', '-t', t.signin.SESSION], { stdio: 'ignore' }));
  } finally { t.cleanup(); }
});

test('#3998: agy asking to trust any folder but Kosmos\'s own ends the sign-in, untrusted', { skip }, async () => {
  const t = setup('wrong-folder');
  try {
    const { id } = t.signin.start();
    await until(() => t.signin.status().state === 'code', 15000, 'the code step');
    t.signin.code('4/0AXlqoi78ZmW2ZEDHmXTxfTTbEqk1iq3YSD1LPLn9DJBTH8v-TZgGLs9n', id);
    await until(() => t.signin.status().state === 'failed', 25000, 'the refusal');
    assert.match(t.signin.status().because, /trust a folder Kosmos did not choose/);
    assert.doesNotMatch(t.logText(), /^trust:/m, 'Kosmos answered the trust question for the home folder');
  } finally { t.cleanup(); }
});

test('#3998: a screen Kosmos does not recognise is shown, not guessed at', { skip }, async () => {
  const t = setup('strange');
  const opened = [];
  t.signin.setForTests({ openFile: (file, done) => { opened.push(file); done(null); } });
  try {
    const { id } = t.signin.start();
    await until(() => t.signin.status().state === 'stuck', 20000, 'the stuck state');
    assert.match(t.signin.status().because, /does not recognise/);
    const r = await t.signin.show(id);
    assert.deepEqual(r, { ok: true });
    assert.equal(opened.length, 1);
    const script = fs.readFileSync(opened[0], 'utf8');
    assert.match(script, / attach -t agy-signin\n$/, 'the window does not attach to the hidden session');
    assert.match(script, new RegExp("-L '" + process.env.AGENT_WORKFORCE_AGY_SIGNIN_SOCKET + "' "), 'the window attaches to some other tmux (the socket is quoted)');
  } finally { t.cleanup(); }
});

test('#3998: the screen words match, and the helpers read agy\'s screens as it draws them', () => {
  const s = require('./agysignin');
  assert.equal(s.urlFrom('If not:\nhttps://accounts.google.com/o/oauth2/auth?a=1&b=2\n\n(1-20 of 24 lines)'), 'https://accounts.google.com/o/oauth2/auth?a=1&b=2');
  assert.equal(s.urlFrom('no address here'), null);
  assert.equal(s.markedLine('  Previous\n> [Done]\n'), '> [Done]');
  assert.equal(s.trustFolder('Accessing workspace:\n\n/Users/joshua\n\nDo you trust the contents of this project?'), '/Users/joshua');
  assert.ok(s.CODE_RE.test('4/0AXlqoi78ZmW2ZEDHmXTxfTTbEqk1iq3YSD1LPLn9DJBTH8v-TZgGLs9n0D2EE1ufNL-RlQ'));
  for (const bad of ['', 'short', 'has space in it ok', 'semi;colon0123456789', '$(whoami)0123456789']) assert.equal(s.CODE_RE.test(bad), false, bad);
  // The fake prints the same words the engine looks for (so the end-to-end tests are about agy's screens).
  const fake = fs.readFileSync(FAKE, 'utf8');
  for (const [name, re] of Object.entries(s.SCREENS)) assert.ok(re.test(fake), 'the fake agy does not draw the ' + name + ' screen');
});

test('#3998: a check that answers after its sign-in was stopped and restarted never touches the new one', async () => {
  const s = require('./agysignin');
  s.resetForTests();
  let release;
  const gate = new Promise((r) => { release = r; });
  const killed = [];
  s.setForTests({
    agyBin: () => ({ installed: true, bin: '/bin/true' }),
    folderRoot: () => os.tmpdir(),
    tmux: (args) => { if (args[0] === 'capture-pane') return null; if (args[0] === 'kill-session') killed.push(args.join(' ')); return ''; },
    confirmSignedIn: () => gate,   // the FIRST session's check hangs until released
  });
  try {
    const first = s.start();
    assert.equal(first.ok, true);
    s.tickForTests();              // the session looks gone: its check starts and waits
    s.stop(first.id);              // the person stops it...
    assert.equal(s.start().ok, true);   // ...and signs in again
    s.setForTests({ confirmSignedIn: async () => ({ signedIn: null }) });
    const killsBefore = killed.length;
    release({ signedIn: false });  // the OLD check answers now
    await new Promise((r) => setImmediate(r));
    assert.equal(s.status().state, 'starting', 'a stale answer ended the new sign-in');
    assert.equal(killed.length, killsBefore, 'a stale answer killed the new session');
  } finally { s.resetForTests(); }
});

test('#3998: a recognised screen that does not move on becomes stuck (a changed default is shown, not waited on for half an hour)', () => {
  const s = require('./agysignin');
  s.resetForTests();
  let t0 = 1000000;
  const sent = [];
  s.setForTests({
    agyBin: () => ({ installed: true, bin: '/bin/true' }),
    folderRoot: () => os.tmpdir(),
    now: () => t0,
    // The menu with the cursor NOT on Google OAuth: Kosmos must not press Enter, and must not wait forever.
    tmux: (args) => { if (args[0] === 'capture-pane') return 'Select login method:\n  1. Google OAuth\n> 2. Use a Google Cloud project\n'; if (args[0] === 'send-keys') sent.push(args.slice(3).join(' ')); return ''; },
  });
  try {
    s.start();
    s.tickForTests();
    t0 += 10000; s.tickForTests();
    assert.notEqual(s.status().state, 'stuck', 'CONTROL: not stuck after 10 s');
    t0 += 15000; s.tickForTests();
    assert.equal(s.status().state, 'stuck', 'a menu that never moved on was never shown');
    assert.deepEqual(sent, [], 'Kosmos pressed a key on a menu whose choice was not Google OAuth');
  } finally { s.resetForTests(); }
});

/* ---- the round-2 review's cases, on a scripted screen (no tmux) ---------------------------- */
function scripted(s, first) {
  const st = { screen: first, sent: [], killed: 0, t: 1000000, checks: 0, answer: { signedIn: null }, captureThrows: null, hasSession: true };
  s.resetForTests();
  s.setForTests({
    agyBin: () => ({ installed: true, bin: '/bin/true' }),
    folderRoot: () => os.tmpdir(),
    now: () => st.t,
    confirmSignedIn: async () => { st.checks += 1; return st.answer; },
    tmux: (args) => {
      if (args[0] === 'capture-pane') { if (st.captureThrows) throw st.captureThrows; return st.screen; }
      if (args[0] === 'has-session') { if (!st.hasSession) { const e = new Error('no session'); e.status = 1; throw e; } return ''; }
      if (args[0] === 'send-keys') st.sent.push(args.slice(3).join(' '));
      if (args[0] === 'kill-session') st.killed += 1;
      return '';
    },
  });
  return st;
}
const settle = () => new Promise((r) => setImmediate(r));
const TERMS = (marked) => 'Terms of Service & Data Use\n\n' + ['[ ] Yes, I agree', 'Previous', '[Done]']
  .map((l) => (l === marked ? '> ' : '  ') + l).join('\n') + '\n';

test('#3998 B2: after the setup, an unknown screen asks agy a few times at most, and stuck stays stuck', async () => {
  const s = require('./agysignin');
  const st = scripted(s, 'Choose your color scheme\n> terminal\n');
  try {
    s.start();
    s.tickForTests();                                   // theme: Enter
    st.screen = 'something agy draws that Kosmos has never seen';
    const seen = [];
    for (let i = 0; i < 60; i++) { st.t += 1000; s.tickForTests(); await settle(); seen.push(s.status().state); }
    assert.ok(st.checks >= 1, 'CONTROL: agy was never asked (the screen after the setup is usually its ready screen)');
    assert.ok(st.checks <= s.MAX_CHECKS, 'agy was asked ' + st.checks + ' times: each one is a prompt on the person\'s subscription');
    const first = seen.indexOf('stuck');
    assert.ok(first >= 0, 'never became stuck');
    assert.deepEqual(seen.slice(first).filter((x) => x !== 'stuck'), [], 'stuck flipped back by itself: ' + seen.join(','));
  } finally { s.resetForTests(); }
});

test('#3998 W1/W2: the terms get each key once, and a missing Done is shown, not ended', async () => {
  const s = require('./agysignin');
  const st = scripted(s, TERMS('Previous'));
  try {
    const { id } = s.start();
    s.tickForTests(); s.tickForTests(); s.tickForTests();     // the marker has not moved yet
    assert.deepEqual(st.sent, ['Down'], 'a second Down went out before the first one landed');
    st.screen = TERMS('[Done]');
    s.tickForTests(); s.tickForTests(); s.tickForTests();
    assert.deepEqual(st.sent, ['Down', 'Enter'], 'Enter went out more than once on [Done] (a slow redraw carries it onto the trust question)');
    assert.doesNotMatch(st.sent.join(' '), /Space/, 'Space ticks the optional data-sharing box');
    // A terms screen whose Done never comes under the marker:
    const st2 = scripted(s, TERMS('Previous'));
    const again = s.start();
    const marks = ['Previous', '[ ] Yes, I agree', 'Previous', '[ ] Yes, I agree', 'Previous', '[ ] Yes, I agree'];
    for (const m of marks) { st2.screen = TERMS(m); s.tickForTests(); }
    assert.equal(s.status().state, 'stuck');
    assert.match(s.status().because, /Done button/);
    assert.equal(st2.killed, 1, 'the session was killed (only the start\'s own clean-up may kill one), so Show had nothing to show');
    s.setForTests({ openFile: (f, done) => done(null) });
    assert.deepEqual(await s.show(again.id), { ok: true }, 'Show did nothing on a stuck terms screen');
    assert.equal(id === again.id, false);
  } finally { s.resetForTests(); }
});

test('#3998 W3: a code agy did not take goes back to asking for one', () => {
  const s = require('./agysignin');
  const CODE = 'Your browser should open automatically. If not:\n\nhttps://accounts.google.com/o/oauth2/auth?x=1\n\nPaste the authorization code:\n';
  const st = scripted(s, CODE);
  try {
    const { id } = s.start();
    s.tickForTests();
    assert.equal(s.status().state, 'code');
    assert.equal(s.code('4/0AXlqoi78ZmW2ZEDHmXTxfTTbEqk1iq3YSD1LPLn9DJBTH8v', id).ok, true);
    st.t += 5000; s.tickForTests();
    assert.equal(s.status().state, 'checking', 'CONTROL: a code is given a moment before it counts as refused');
    st.t += 16000; s.tickForTests();
    assert.equal(s.status().state, 'code', 'a refused code left the panel checking for half an hour');
    assert.match(s.status().because, /did not take that code/);
    assert.equal(s.code('4/0AXlqoi78ZmW2ZEDHmXTxfTTbEqk1iq3YSD1LPLn9DJBTH8v', id).ok, true, 'a second code could not be pasted');
  } finally { s.resetForTests(); }
});

test('#3998 W4: a Stop while agy is asked (after it exited) stays stopped', async () => {
  const s = require('./agysignin');
  const st = scripted(s, null);
  st.answer = { signedIn: true };
  try {
    const { id } = s.start();
    st.hasSession = false;
    s.tickForTests();                 // the session is gone: agy is asked
    s.stop(id);
    await settle();
    assert.equal(s.status().state, 'stopped', 'the answer overwrote the person\'s Stop');
  } finally { s.resetForTests(); }
});

test('#3998 W5: only a missing session is agy exiting; a slow tmux is tried again', async () => {
  const s = require('./agysignin');
  const st = scripted(s, 'x');
  try {
    s.start();
    const slow = new Error('spawnSync tmux ETIMEDOUT'); slow.code = 'ETIMEDOUT';
    st.captureThrows = slow;
    s.tickForTests(); await settle();
    assert.equal(st.checks, 0, 'a slow tmux was read as agy exiting');
    assert.equal(s.status().state, 'starting');
    st.captureThrows = new Error('can\'t find session'); st.hasSession = false;
    s.tickForTests(); await settle();
    assert.equal(s.status().state, 'failed', 'CONTROL: a session that is really gone ends the sign-in');
  } finally { s.resetForTests(); }
});

test('#3998 W6: a code, Show or Stop from an older sign-in never touches the current one', async () => {
  const s = require('./agysignin');
  scripted(s, 'Your browser should open automatically.\n');
  try {
    const old = s.start();
    const cur = s.start();
    s.tickForTests();
    assert.notEqual(old.id, cur.id);
    assert.equal(s.stop(old.id).ok, false);
    assert.equal(s.stop(undefined).ok, false);
    assert.equal(s.code('4/0AXlqoi78ZmW2ZEDHmXTxfTTbEqk1iq3YSD1LPLn9DJBTH8v', old.id).ok, false);
    assert.equal((await s.show(old.id)).ok, false);
    assert.equal(s.status().state, 'code', 'another tab\'s Stop ended this sign-in');
    assert.equal(s.stop(cur.id).ok, true, 'CONTROL: its own Stop works');
    assert.equal(s.status().state, 'stopped');
  } finally { s.resetForTests(); }
});

test('#3998 W7: Sign in again on an agy that is already signed in finishes, once agy says so', async () => {
  const s = require('./agysignin');
  const st = scripted(s, 'joshua@example.com (Antigravity Starter Quota) - Gemini 3.8 Flash (High)\n> \n');
  st.answer = { signedIn: true };
  try {
    s.start();
    s.tickForTests(); await settle();
    assert.equal(st.checks, 1, 'agy\'s own ready screen was not confirmed');
    assert.equal(s.status().state, 'done', 'an already signed-in agy was shown as stuck');
    // A first screen Kosmos does not know is given a moment before agy is asked (one ask).
    const st2 = scripted(s, 'agy 1.2.11 starting...');
    st2.answer = { signedIn: true };
    s.start();
    s.tickForTests(); await settle();
    assert.equal(st2.checks, 0, 'CONTROL: agy is given a moment to draw its first screen before being asked');
    st2.t += 9000; s.tickForTests(); await settle();
    assert.equal(st2.checks, 1);
    assert.equal(s.status().state, 'done');
  } finally { s.resetForTests(); }
});

test('#3998 C3: with the live-execution gate closed, a start that would run tmux for real throws in a test', () => {
  const s = require('./agysignin');
  s.resetForTests();
  require('./live-execution').resetForTests();
  s.setForTests({ agyBin: () => ({ installed: true, bin: '/bin/true' }), folderRoot: () => os.tmpdir() });
  try {
    assert.throws(() => s.start(), /for real inside a test/);
    assert.equal(s.status().state, 'idle');
  } finally { s.resetForTests(); }
});

test('#3998 round 3: a key tmux could not send never throws out of the loop; it is pressed again, and five in a row show the window', () => {
  const s = require('./agysignin');
  const st = scripted(s, 'Choose your color scheme\n> terminal\n');
  let failing = 1;
  const real = st;
  s.setForTests({ tmux: (args) => {
    if (args[0] === 'capture-pane') return real.screen;
    if (args[0] === 'send-keys') { if (failing > 0) { failing -= 1; const e = new Error('spawnSync tmux ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e; } real.sent.push(args.slice(3).join(' ')); }
    return '';
  } });
  try {
    s.start();
    assert.doesNotThrow(() => s.tickForTests(), 'a failed send-keys escaped the timer (it would take the board down)');
    assert.deepEqual(real.sent, [], 'CONTROL: the first press really failed');
    s.tickForTests();
    assert.deepEqual(real.sent, ['Enter'], 'the key that did not go out was never pressed again');
    s.tickForTests();
    assert.deepEqual(real.sent, ['Enter'], 'pressed twice once it went out');
    // A screen whose keys never go out: shown, not retried forever.
    const st2 = scripted(s, 'Choose your color scheme\n> terminal\n');
    s.setForTests({ tmux: (args) => { if (args[0] === 'capture-pane') return st2.screen; if (args[0] === 'send-keys') throw new Error('no server'); return ''; } });
    s.start();
    for (let i = 0; i < s.MAX_KEY_FAILURES - 1; i++) s.tickForTests();
    assert.notEqual(s.status().state, 'stuck', 'CONTROL: not stuck before the limit');
    s.tickForTests();
    assert.equal(s.status().state, 'stuck');
    assert.match(s.status().because, /could not reach/);
  } finally { s.resetForTests(); }
});

/* ---- review round 4 ---------------------------------------------------------------------- */
const CODE_SCREEN = 'Your browser should open automatically. If not:\n\nhttps://accounts.google.com/o/oauth2/auth?x=1\n\nPaste the authorization code:\n';
const CODE = '4/0AXlqoi78ZmW2ZEDHmXTxfTTbEqk1iq3YSD1LPLn9DJBTH8v';

test('#3998 round 4: a code is typed only while agy\'s code prompt is on the screen right now', () => {
  const s = require('./agysignin');
  const st = scripted(s, CODE_SCREEN);
  try {
    const { id } = s.start();
    s.tickForTests();
    assert.equal(s.status().state, 'code');
    st.screen = 'Choose your color scheme\n> terminal\n';   // agy moved on; the state is a tick behind
    const r = s.code(CODE, id);
    assert.equal(r.ok, false, 'a code was typed onto the colour screen');
    assert.deepEqual(st.sent, [], 'keys went out');
    st.screen = CODE_SCREEN;
    assert.equal(s.code(CODE, id).ok, true, 'CONTROL: on the code screen it is typed');
    assert.ok(st.sent.some((k) => k.includes(CODE)));
  } finally { s.resetForTests(); }
});

test('#3998 round 4: once the window is shown, Kosmos presses nothing, and agy\'s ready screen still finishes it', async () => {
  const s = require('./agysignin');
  const st = scripted(s, 'something Kosmos does not know');
  st.answer = { signedIn: null };
  s.setForTests({ openFile: (f, done) => done(null) });
  try {
    const { id } = s.start();
    for (let i = 0; i < 12; i++) { st.t += 1000; s.tickForTests(); await settle(); }
    assert.equal(s.status().state, 'stuck');
    assert.deepEqual(await s.show(id), { ok: true });
    const before = st.sent.length;
    for (const scr of ['Select login method:\n> 1. Google OAuth\n', 'Choose your color scheme\n> terminal\n',
      'Terms of Service & Data Use\n> Previous\n  [Done]\n']) {
      st.screen = scr; st.t += 1000; s.tickForTests(); await settle();
    }
    assert.equal(st.sent.length, before, 'Kosmos pressed keys while the person was driving: ' + st.sent.slice(before).join(','));
    // Every ask is spent by now; agy's ready screen still earns one.
    st.checks = 0; st.answer = { signedIn: true };
    st.screen = 'j@example.com (Antigravity Starter Quota) - Gemini 3.8 Flash (High)\n> \n';
    st.t += 1000; s.tickForTests(); await settle();
    assert.equal(st.checks, 1, 'the ready screen was not confirmed');
    assert.equal(s.status().state, 'done', 'a sign-in the person finished by hand stayed stuck');
  } finally { s.resetForTests(); }
});

test('#3998 round 4: the screen drawn LAST wins over words an earlier screen left behind', () => {
  const s = require('./agysignin');
  assert.equal(s.screenOf('Select login method:\n> 1. Google OAuth\n\nTerms of Service & Data Use\n  Previous\n> [Done]\n'), 'terms');
  assert.equal(s.screenOf('Terms of Service & Data Use\n...\nSelect login method:\n'), 'menu', 'CONTROL: the other order');
  assert.equal(s.screenOf('nothing known'), null);
  assert.equal(s.markedLine('> 1. Google OAuth\n...\n  Previous\n> [Done]\n'), '> [Done]', 'the marker read was the old screen\'s');
});

test('#3998 round 4: the tmux socket is this board\'s own, so two boards never share a sign-in', () => {
  const s = require('./agysignin');
  const was = process.env.AGENT_WORKFORCE_AGY_SIGNIN_SOCKET;
  delete process.env.AGENT_WORKFORCE_AGY_SIGNIN_SOCKET;
  try {
    assert.match(s.socket(), /^kosmos-agy-signin-[0-9a-f]{10}$/);
  } finally { if (was !== undefined) process.env.AGENT_WORKFORCE_AGY_SIGNIN_SOCKET = was; }
});
