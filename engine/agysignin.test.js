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
    assert.deepEqual(t.signin.start(), { ok: true });
    await until(() => t.signin.status().state === 'code', 15000, 'the code step');
    assert.match(t.signin.status().url, /^https:\/\/accounts\.google\.com\/o\/oauth2\/auth\?/, 'the sign-in address was not picked up');
    assert.match(t.logText(), /^menu:Enter$/m, 'Google OAuth was not chosen');
    // A code that is not one is refused before anything is typed.
    assert.equal(t.signin.code('rm -rf ~; echo').ok, false);
    assert.deepEqual(t.signin.code('4/0AXlqoi78ZmW2ZEDHmXTxfTTbEqk1iq3YSD1LPLn9DJBTH8v-TZgGLs9n'), { ok: true });
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
    t.signin.start();
    await until(() => t.signin.status().state === 'code', 15000, 'the code step');
    t.signin.code('4/0AXlqoi78ZmW2ZEDHmXTxfTTbEqk1iq3YSD1LPLn9DJBTH8v-TZgGLs9n');
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
    t.signin.start();
    await until(() => t.signin.status().state === 'stuck', 20000, 'the stuck state');
    assert.match(t.signin.status().because, /does not recognise/);
    const r = await t.signin.show();
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
    assert.equal(s.start().ok, true);
    s.tickForTests();              // the session looks gone: its check starts and waits
    s.stop();                      // the person stops it...
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
