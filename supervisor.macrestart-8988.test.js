'use strict';
/**
 * kosmos#8988: a Mac Claude agent's death is recorded, so its card can say "Restarted at <time>: <why>".
 *
 * Runs the SHIPPED bin/agent-supervisor.sh against a REAL tmux, on a private socket inside this test's own folder (never
 * the person's server: a two-line wrapper adds `-S <socket> -f /dev/null`), with a fake runner that exits when told.
 *
 *   CRASH     the runner exits 7: the pane-died hook writes "<epoch> status 7" and ends the session, the supervisor
 *             exits as it does today, and after the relaunch engine/macrestart.js reads "exit code 7".
 *   STOP      a deliberate kill-session records nothing (the death file is unchanged).
 *   SIGNAL    the runner is ended by SIGTERM: "signal term", read as "(signal SIGTERM)".
 *   WAIT      the hook is gone (unset by the test): the supervisor's own wait loop finds the dead pane, records it
 *             and ends the session.
 *   STARTUP   a session of ours whose pane is dead (kept by remain-on-exit, no hook) is not adopted as alive: a launch
 *             records it and replaces it with a live one.
 *
 *   node --test supervisor.macrestart-8988.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs the supervisor (bin/agent-supervisor.sh) and a real tmux through /bin/bash');

const REPO = __dirname;
const SHIPPED = process.env.SUPERVISOR_UNDER_TEST || path.join(REPO, 'bin', 'agent-supervisor.sh');
const REAL_TMUX = (() => {
  for (const p of ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux']) if (fs.existsSync(p)) return p;
  const r = spawnSync('/bin/sh', ['-c', 'command -v tmux'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
})();
const SKIP = SKIP_POSIX_SHELL || (REAL_TMUX ? false : 'no tmux on this machine');
const NAME = 'macrestart8988';

function fixture() {
  /* A short root: a tmux socket path must fit in sun_path (104 bytes on macOS). */
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mr8988-')));
  for (const dir of ['bin', 'data', 'work', 'shim', 'home', 'ctl']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.symlinkSync(SHIPPED, path.join(root, 'bin', 'agent-supervisor.sh'));
  fs.symlinkSync(path.join(REPO, 'engine'), path.join(root, 'engine'));
  const sock = path.join(root, 's');
  const tmux = path.join(root, 'tmux.sh');
  fs.writeFileSync(tmux, `#!/bin/bash\nexec ${JSON.stringify(REAL_TMUX)} -S ${JSON.stringify(sock)} -f /dev/null "$@"\n`, { mode: 0o755 });
  const ctl = path.join(root, 'ctl');
  /* The runner waits for ctl/go, then does what ctl/how says: "exit N" or "term". */
  const runner = path.join(root, 'runner.sh');
  fs.writeFileSync(runner, [
    '#!/bin/bash',
    '[ "${1:-}" = --version ] && { echo "2.1.282 (Claude Code)"; exit 0; }',
    `while [ ! -f ${JSON.stringify(path.join(ctl, 'go'))} ]; do /bin/sleep 0.05; done`,
    `rm -f ${JSON.stringify(path.join(ctl, 'go'))}`,
    `how="$(cat ${JSON.stringify(path.join(ctl, 'how'))} 2>/dev/null)"`,
    'case "$how" in term) kill -TERM $$; /bin/sleep 5 ;; exit*) exit "${how#exit }" ;; *) exit 0 ;; esac',
  ].join('\n') + '\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'shim', 'sleep'), '#!/bin/bash\n/bin/sleep 0.1\n', { mode: 0o755 });
  const env = {
    PATH: path.join(root, 'shim') + ':' + process.env.PATH,
    HOME: path.join(root, 'home'),
    TMUX_TMPDIR: root,
    AGENT_WORKFORCE_HOME: root,
    AGENT_WORKFORCE_DATA: path.join(root, 'data'),
    AGENT_WORKFORCE_CLAUDE_CONFIG: path.join(root, 'home', '.claude.json'),
    CLAUDE_CONFIG_DIR: path.join(root, 'home', '.claude'),
    KOSMOS_AGENT_BROWSER: 'off',
  };
  const args = [path.join(root, 'bin', 'agent-supervisor.sh'), NAME, path.join(root, 'work'), runner, tmux, '', '', 'claude'];
  const kids = [];
  const start = () => { const c = spawn('/bin/bash', args, { env, stdio: 'ignore' }); kids.push(c); return c; };
  const ends = (child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve({ code: child.exitCode });
    child.on('exit', (code) => resolve({ code }));
  });
  const tx = (...a) => spawnSync(tmux, a, { encoding: 'utf8', env });
  const alive = () => tx('has-session', '-t', '=' + NAME).status === 0;
  const paneDead = () => (tx('list-panes', '-s', '-t', '=' + NAME, '-F', '#{pane_dead}').stdout || '').trim();
  const until = async (fn, what) => {
    for (let i = 0; i < 400; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 50)); }
    assert.fail('timed out waiting for ' + what);
  };
  const diedPath = path.join(root, 'data', 'Kosmos', 'runs', NAME + '.died');
  const died = () => (fs.existsSync(diedPath) ? fs.readFileSync(diedPath, 'utf8') : null);
  const tell = (how) => { fs.writeFileSync(path.join(ctl, 'how'), how); fs.writeFileSync(path.join(ctl, 'go'), ''); };
  /* engine/macrestart.js in a child with this data root, so this file never fixes store.ROOT on the real store. */
  const card = () => {
    const r = spawnSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(REPO, 'engine', 'macrestart.js'))}).restartedFor(${JSON.stringify(NAME)})))`],
      { encoding: 'utf8', env: { ...process.env, AGENT_WORKFORCE_DATA: env.AGENT_WORKFORCE_DATA } });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const cleanup = () => {
    tx('kill-server');
    for (const c of kids) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  };
  return { root, start, ends, tx, alive, paneDead, until, died, tell, card, cleanup };
}

test('#8988 CRASH and STOP: an exit is recorded by the hook and read on the card after the relaunch; a stop records nothing', { skip: SKIP }, async () => {
  const f = fixture();
  try {
    const one = f.start();
    await f.until(f.alive, 'the first session');
    assert.equal(f.died(), null, 'CONTROL: nothing recorded before any death');
    assert.equal(f.card(), null, 'CONTROL: no restart line before any death');
    f.tell('exit 7');
    await f.ends(one);
    assert.equal(f.alive(), false, 'the hook ended the session, so the supervisor exited as it does today');
    assert.match(String(f.died()), /^\d{9,11} status 7\n$/);
    const two = f.start();   // launchd's restart
    await f.until(f.alive, 'the relaunched session');
    await f.until(() => f.card() !== null, 'the restart line');
    assert.equal(f.card().why, 'Claude stopped unexpectedly (exit code 7).');
    const before = f.died();
    f.tx('kill-session', '-t', '=' + NAME);   // a deliberate stop
    await f.ends(two);
    assert.equal(f.died(), before, 'a stop is not a death: nothing new recorded');
  } finally { f.cleanup(); }
});

test('#8988 SIGNAL: a process ended by a signal is recorded by name', { skip: SKIP }, async () => {
  const f = fixture();
  try {
    const one = f.start();
    await f.until(f.alive, 'the session');
    f.tell('term');
    await f.ends(one);
    assert.match(String(f.died()), /^\d{9,11} signal term\n$/i);
    require('./engine/win32streamstate');   // sanity: the words come from the shared restartWhy
    assert.equal(require('./engine/macrestart').parseDied(f.died()).signal, 'SIGTERM');
  } finally { f.cleanup(); }
});

test('#8988 WAIT: with the hook gone, the supervisor itself records a dead pane and ends the session', { skip: SKIP }, async () => {
  const f = fixture();
  try {
    const one = f.start();
    await f.until(f.alive, 'the session');
    const unset = f.tx('set-hook', '-u', '-t', '=' + NAME + ':', 'pane-died');
    assert.equal(unset.status, 0, unset.stderr);
    f.tell('exit 3');
    await f.ends(one);
    assert.equal(f.alive(), false, 'a dead pane never holds the agent stopped');
    assert.match(String(f.died()), /^\d{9,11} status 3\n$/);
  } finally { f.cleanup(); }
});

test('#8988 STARTUP: a dead session of ours is recorded and replaced, never adopted as alive', { skip: SKIP }, async () => {
  const f = fixture();
  try {
    const made = f.tx('new-session', '-d', '-s', NAME, '/bin/sleep 0.4; exit 9');
    assert.equal(made.status, 0, made.stderr);
    f.tx('set-option', '-w', '-t', '=' + NAME + ':', 'remain-on-exit', 'on');
    const mark = f.tx('set-option', '-t', NAME, '@kosmos_agent', NAME);   // ours, as the supervisor marks it (and reads it, by plain name)
    assert.equal(mark.status, 0, mark.stderr);
    await f.until(() => f.paneDead() === '1', 'the planted pane to die');
    const one = f.start();
    await f.until(() => f.paneDead() === '0', 'a live replacement');
    assert.match(String(f.died()), /^\d{9,11} status 9\n$/);
    f.tell('exit 0');
    await f.ends(one);
  } finally { f.cleanup(); }
});
