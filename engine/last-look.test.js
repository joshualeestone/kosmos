'use strict';

/**
 * What tmux said, kept instead of thrown away.
 *
 * 🛑 THE ANSWER EXISTED AND WAS DISCARDED ONE LAYER DOWN. `shDetail` keeps the
 * stderr; `tmuxPanes` flattened any failure to `null`, so the board could say
 * "we cannot read your agents" and nothing anywhere could say why. Josh's Mac,
 * 2026-08-22: the board came back after a reboot, the agents call returned 500,
 * and finding out what tmux had actually said took a terminal, a person and two
 * rounds of messages. The machine knew the whole time.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');

/**
 * ⚠️ A REAL `tmux` ON A REAL SOCKET, in a child process, because the thing under
 * test is what a failing binary WRITES TO STDERR. A stub returning a string
 * would be asserting my idea of the message, which is the half that has been
 * wrong all day.
 *
 * `-L <name>` picks a socket that does not exist, which is how you get a
 * genuine tmux failure without touching any session on this machine.
 */
function ask(env) {
  const script = `
    const status = require(${JSON.stringify(path.join(REPO, 'engine', 'status'))});
    let threw = null;
    try { status.readPanes; status.snapshot(); } catch (e) { threw = e.message; }
    process.stdout.write(JSON.stringify({ threw, problem: status.lastLookProblem() }));
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return JSON.parse(out);
}

test('a tmux that is not there is said in words, not as a null', () => {
  /* PATH is emptied, so the spawn fails outright: `ran` is false and there is
     no stderr to quote. Quoting an empty string would put an empty pair of
     quotes on somebody's screen. */
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-look-'));
  const got = ask({
    PATH: sb,
    AGENT_WORKFORCE_DATA: path.join(sb, 'data'),
    AGENT_WORKFORCE_WORKERS: path.join(sb, 'workers'),
  });
  assert.match(got.threw || '', /could not see what is running/);
  assert.equal(got.problem, 'we could not run tmux at all on this computer');
  fs.rmSync(sb, { recursive: true, force: true });
});

test('a tmux that answers is not a problem, and clears an older one', () => {
  /* 📌 The control this pair needs: with a working tmux the field is null, so a
     screen cannot show yesterday's problem beside today's healthy board. */
  /* #5073: its OWN tmux server, not this machine's. Reading the default socket made the result depend on who was
     running on the box, and on the caller's locale: with no UTF-8 LANG, tmux replaces its field tabs with
     underscores, and a cut launched through `tmux run-shell` (no LANG) read a real agent's pane as one garbage line.
     TMUX_TMPDIR moves the default socket into a folder of ours (short, under /tmp: a socket path has a length
     limit), and the locale is set here, all three names, so no caller's locale reaches this server. The server is
     made with the same tmux status.js reads through (AGENT_WORKFORCE_TMUX_BIN when set), so a version difference
     between two tmux binaries cannot red it, and its one pane runs `sleep`, not a login shell. */
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-look-'));
  const sock = fs.mkdtempSync('/tmp/kl5073-');
  const own = { TMUX_TMPDIR: sock, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', LC_CTYPE: 'en_US.UTF-8' };
  const tmuxEnv = { ...process.env, ...own };
  delete tmuxEnv.TMUX;   // a test run from inside tmux must not attach to the caller's server
  const TMUX_BIN = process.env.AGENT_WORKFORCE_TMUX_BIN || 'tmux';
  try {
    try {
      execFileSync(TMUX_BIN, ['new-session', '-d', '-s', 'look5073', 'sleep 600'], { env: tmuxEnv });
    } catch (e) {
      if (e && e.code === 'ENOENT') assert.fail('this test needs tmux installed (' + TMUX_BIN + ' was not found); it reads a tmux server of its own');
      throw e;
    }
    const got = ask({
      ...own,
      TMUX: '',
      AGENT_WORKFORCE_DATA: path.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: path.join(sb, 'workers'),
    });
    assert.equal(got.threw, null, 'reading our own server threw: ' + got.threw);
    assert.equal(got.problem, null, 'a healthy look left a problem standing: ' + got.problem);
  } finally {
    try { execFileSync(TMUX_BIN, ['kill-server'], { env: tmuxEnv, stdio: 'ignore' }); } catch { /* already gone */ }
    fs.rmSync(sb, { recursive: true, force: true });
    fs.rmSync(sock, { recursive: true, force: true });
  }
});

test('the message is one line and bounded, because it reaches a screen', () => {
  const status = require('./status');
  const src = fs.readFileSync(path.join(REPO, 'engine', 'status.js'), 'utf8');
  assert.match(src, /oneLine\(got\.err, 300\)/, 'the quoted message is no longer bounded');
  assert.equal(typeof status.lastLookProblem, 'function');
});

test('an answer we cannot read shows a line of what came back', () => {
  /* 🛑 THE SENTENCE WAS HONEST AND UNACTIONABLE. Josh's board said "we could
     not make sense of what came back" for an hour; the mangled line underneath
     it read `anna_0.0_2.1.237_0___` and points straight at the cause. */
  const status = require('./status');
  status.setPaneSource(() => 'anna_0.0_2.1.237_0___ a title\nava_0.0_node_0___ another');
  assert.throws(() => status.readPanes && status.snapshot(), /make sense of what came back/);
  const said = status.lastLookProblem();
  status.setPaneSource(null);
  assert.match(said, /came back like this/);
  assert.match(said, /anna_0\.0_2\.1\.237/, 'the sample is missing, so the message names nothing');
  /* ⚠️ ONE LINE ONLY. A pane title is arbitrary text an agent wrote and this
     reaches a screen. */
  assert.ok(!/\n/.test(said));
  assert.ok(said.length < 260, 'the sample is unbounded: ' + said.length);
});

test('a locale is exported wherever the board is started from', () => {
  /* 🛑 THE FIX FOR THE ABOVE, and it is one line in the one file every start
     goes through. tmux sanitises its own format output without a UTF-8 locale,
     replacing the tab separators, so every line is rejected. The board's login
     job set LANG; the app icon and the command itself did not, and a Terminal
     hid it from everybody here. */
  const kosmos = fs.readFileSync(path.join(REPO, 'install', 'kosmos'), 'utf8');
  assert.match(kosmos, /export LANG="\$\{LANG:-en_US\.UTF-8\}"/);
  /* ⚠️ Only the empty case is filled: a person whose Mac runs in another
     language has a UTF-8 locale of their own, and overriding it would make this
     command decide what language their agents' titles are shown in. */
  assert.ok(!/export LANG="en_US\.UTF-8"/.test(kosmos), 'it overrides a locale the person already set');
});
