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
    assert.match(script, new RegExp('-L ' + process.env.AGENT_WORKFORCE_AGY_SIGNIN_SOCKET), 'the window attaches to some other tmux');
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
