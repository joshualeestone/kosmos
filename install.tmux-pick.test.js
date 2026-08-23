'use strict';
/**
 * Which tmux Kosmos looks through.
 *
 * 🛑 THE FAILURE THIS IS FOR, AND IT COST US THE ENTIRE ADOPT AUDIENCE. Kosmos
 * ships a tmux (3.5a). Two tmux binaries of different versions share one socket
 * and cannot read each other's server -- the older answers "server exited
 * unexpectedly" and sees nothing. Measured on the fleet machine on 2026-08-22:
 * Homebrew's 3.6a listed thirteen sessions and the bundled copy refused the same
 * socket outright.
 *
 * Josh's sister installed Kosmos on a Mac already running two agents in tmux, in
 * our own shape, and Kosmos saw neither. Not the naming and not the mark: it was
 * looking through a binary that could not reach the server. Everyone who already
 * has agents has a tmux, so anyone whose tmux is newer than ours was invisible
 * to us -- which is precisely the person the "you already have agents here"
 * screen exists for. It had never been seen outside this team, and this team all
 * run the version we ship against.
 *
 * ⚠️ THE RULE IS A PROBE, NOT A PREFERENCE. A tmux that can LIST a running
 * server is the one that can see this machine's agents. Anything less -- no
 * tmux, no server, a refusal -- establishes nothing, and the bundled copy stays,
 * which is the clean-Mac case the export was written for.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const LAUNCHER = fs.readFileSync(nodePath.join(__dirname, 'install', 'kosmos'), 'utf8');

/* The picker, lifted out of the launcher so the test runs the shipped code
   rather than a restatement of it. */
function picker() {
  const at = LAUNCHER.indexOf('_kosmos_pick_tmux() {');
  assert.notEqual(at, -1, 'the tmux picker moved or was renamed; re-point this test');
  const end = LAUNCHER.indexOf('\n_kosmos_pick_tmux\n', at);
  assert.notEqual(end, -1, 'the picker is defined and never called');
  return LAUNCHER.slice(at, end + '\n_kosmos_pick_tmux\n'.length);
}

/** Run the picker with a PATH and a fake bundled tmux, and report its choice. */
function pick({ path: PATH, sysExit, preset }) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'tmuxpick-'));
  const home = nodePath.join(sb, 'home');
  fs.mkdirSync(nodePath.join(home, 'tmux', 'bin'), { recursive: true });
  const bundled = nodePath.join(home, 'tmux', 'bin', 'tmux');
  fs.writeFileSync(bundled, '#!/bin/sh\nexit 1\n'); fs.chmodSync(bundled, 0o755);

  const bin = nodePath.join(sb, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  if (sysExit !== null) {
    const sys = nodePath.join(bin, 'tmux');
    fs.writeFileSync(sys, `#!/bin/sh\nexit ${sysExit}\n`); fs.chmodSync(sys, 0o755);
  }
  const script = `KOSMOS_HOME=${JSON.stringify(home)}\n${picker()}\nprintf '%s' "$AGENT_WORKFORCE_TMUX_BIN"\n`;
  const out = execFileSync('/bin/sh', ['-c', script], {
    encoding: 'utf8',
    env: {
      PATH: PATH === undefined ? `${bin}:/usr/bin:/bin` : PATH,
      ...(preset ? { AGENT_WORKFORCE_TMUX_BIN: preset } : {}),
    },
  });
  return { chose: out, bundled, sb };
}

test('a tmux that can reach a running server is the one we look through', () => {
  /* 🔑 THE CASE THAT WAS BROKEN. `exit 0` from `list-sessions` is the whole
     signal: something answered, so there is a server and this binary can read
     it. Her agents are in that server. */
  const r = pick({ sysExit: 0 });
  assert.match(r.chose, /\/bin\/tmux$/);
  assert.notEqual(r.chose, r.bundled, 'the bundled tmux won over one that can actually see the machine');
  fs.rmSync(r.sb, { recursive: true, force: true });
});

test('a machine with no tmux at all still gets the one we ship', () => {
  /* The clean Mac this export was added for, and the reason the bundle exists.
     A regression here means a brand-new user cannot create their first agent. */
  const r = pick({ sysExit: null, path: '/usr/bin:/bin' });
  assert.equal(r.chose, r.bundled);
  fs.rmSync(r.sb, { recursive: true, force: true });
});

test('a tmux that cannot list a server establishes nothing, so ours stays', () => {
  /* ⚠️ THE DIRECTION THAT MATTERS. A tmux with no server running, or one that
     refuses for any reason, has told us nothing about what it can see -- and
     preferring it on the strength of merely existing is how a clean install
     would end up pointed at a binary that has never worked. */
  const r = pick({ sysExit: 1 });
  assert.equal(r.chose, r.bundled);
  fs.rmSync(r.sb, { recursive: true, force: true });
});

test('an explicit choice beats both, because the harness makes one', () => {
  const r = pick({ sysExit: 0, preset: '/somewhere/else/tmux' });
  assert.equal(r.chose, '/somewhere/else/tmux');
  fs.rmSync(r.sb, { recursive: true, force: true });
});
