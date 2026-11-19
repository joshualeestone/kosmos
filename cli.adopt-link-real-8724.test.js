'use strict';
/**
 * kosmos#8724 item 2, against the REAL engine: `kosmos adopt` runs this branch's own engine/status.js, adopt.js and
 * linkwindow.js (KOSMOS_HOME/app is this checkout), with test-support/fake-tmux.sh answering tmux reads from fixtures
 * and swallowing writes, and every data root in a temp folder. This is the wiring cli.adopt-link-8724.test.js cannot
 * show with stand-ins: that the roster row adopt skips and the window the link checks are found by the same name.
 * Nothing here links (the fake tmux swallows writes and cannot read a mark back); --link is driven as a preview.
 *
 *   node --test cli.adopt-link-real-8724.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const fleet = require('./test-support/fleet');

const CLI = path.join(__dirname, 'install', 'kosmos');
const FAKE_TMUX = path.join(__dirname, 'test-support', 'fake-tmux.sh');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');

function run(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, ['adopt', ...args], { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('no exit code: ' + (err.signal || err.code) + ' ' + stderr)); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function withBoard(lines, fn) {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-8724-adopt-real-'));
  try {
    const home = path.join(sb, 'kosmos');
    fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
    fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
    fs.symlinkSync(__dirname, path.join(home, 'app'));
    const panes = path.join(sb, 'panes.txt');
    fs.writeFileSync(panes, lines.map((l) => fleet.line(l)).join('\n') + '\n');
    for (const d of ['home', 'data', 'workers', 'launch', 'projects']) fs.mkdirSync(path.join(sb, d), { recursive: true });
    const env = {
      PATH: process.env.PATH,
      HOME: path.join(sb, 'home'),
      KOSMOS_HOME: home,
      AGENT_WORKFORCE_HOME: path.join(sb, 'home'),
      AGENT_WORKFORCE_DATA: path.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: path.join(sb, 'workers'),
      AGENT_WORKFORCE_LAUNCH: path.join(sb, 'launch'),
      AGENT_WORKFORCE_PROJECTS: path.join(sb, 'projects'),
      AGENT_WORKFORCE_TMUX_BIN: FAKE_TMUX,
      AGENT_WORKFORCE_FAKE_PANES: panes,
      AGENT_WORKFORCE_DRY_RUN: '1',
    };
    await fn(env);
  } finally {
    fs.rmSync(sb, { recursive: true, force: true });
  }
}

/* zara: a Claude window alone in its session, no mark: the link would take it. otto: a Claude window sharing its
   session with a second pane: the link refuses it (the mark would cover the other pane too). */
const BOARD = [
  { session: 'zara', claim: '' },
  { session: 'otto', claim: '', pane: '0.0' },
  { session: 'otto', claim: '', pane: '0.1', command: 'zsh' },
];

test('#8724 real engine: adopt names the link for a lone unmarked Claude window, and not for one sharing its session', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(BOARD, async (env) => {
    const out = await run([], env);
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /^ {2}skip zara -- not one of ours; if you started it yourself, you can link it \(kosmos adopt --link zara\), then run kosmos adopt again$/m,
      'the real roster row and the real link check did not meet on the same name: ' + out.stdout);
    assert.match(out.stdout, /^ {2}skip otto -- not one of ours$/m, 'a window sharing its session was offered the link: ' + out.stdout);
  }));

test('#8724 real engine: --link previews a window the link takes, and refuses one it does not, with the engine reason', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard(BOARD, async (env) => {
    const yes = await run(['--link', 'zara'], env);
    assert.equal(yes.code, 0, yes.stdout + yes.stderr);
    assert.match(yes.stdout, /^Kosmos would link the window called zara\. Kosmos would then type /m);
    assert.match(yes.stdout, /Nothing was changed\. Run: kosmos adopt --link zara --confirm/);
    const no = await run(['--link', 'otto'], env);
    assert.equal(no.code, 1, no.stdout + no.stderr);
    assert.match(no.stdout, /^The window called otto shares its session with 1 other window/m);
  }));

/* kosmos#8724 item 3: a Codex window, through the real CLI, the real store and create.providerRunner. The profile is
   written by the real store module in the same sandboxed data root the CLI reads. */
function writeProfile(env, name, profile) {
  const store = path.join(__dirname, 'engine', 'store.js');
  const r = require('node:child_process').spawnSync(process.execPath,
    ['-e', `require(${JSON.stringify(store)}).writeProfile(${JSON.stringify(name)}, ${JSON.stringify(profile)})`], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, 'could not write the profile: ' + r.stderr);
}

test('#8724 real engine: --link previews a Codex window only for an agent whose record says it runs Codex', { skip: SKIP_POSIX_SHELL }, () =>
  withBoard([{ session: 'zara', claim: '', command: 'codex' }], async (env) => {
    let out = await run(['--link', 'zara'], env);
    assert.equal(out.code, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /^The window called zara is running Codex, but Kosmos has no record of an agent called zara, so it was not linked\.$/m);
    writeProfile(env, 'zara', { provider: 'anthropic' });
    out = await run(['--link', 'zara'], env);
    assert.equal(out.code, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /Kosmos knows zara as a Claude agent/);
    writeProfile(env, 'zara', { provider: 'openai' });
    out = await run(['--link', 'zara'], env);
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /^Kosmos would link the window called zara\. /m);
  }));
