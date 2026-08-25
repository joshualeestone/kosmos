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
  /* Include the explicit-choice read above the function and the marker export
     below the call: the #728 chain fix lives in those two, not in the function. */
  const above = LAUNCHER.lastIndexOf('_KOSMOS_TMUX_EXPLICIT=""', at);
  const markerEnd = LAUNCHER.indexOf('export KOSMOS_TMUX_BIN_PICKED\nfi\n', end);
  assert.notEqual(above, -1, 'the explicit-choice read moved; re-point this test');
  assert.notEqual(markerEnd, -1, 'the picked marker export moved; re-point this test');
  return LAUNCHER.slice(above, markerEnd + 'export KOSMOS_TMUX_BIN_PICKED\nfi\n'.length);
}

/** Run the picker with a PATH and a fake bundled tmux, and report its choice. */
function pick({ path: PATH, sysExit, preset, picked }) {
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
      /* This Mac has a real tmux at a known location that can list a real
         server; a sandbox pretending to be a clean machine must hide it. */
      KOSMOS_TMUX_KNOWN: '',
      ...(preset ? { AGENT_WORKFORCE_TMUX_BIN: preset } : {}),
      ...(picked ? { KOSMOS_TMUX_BIN_PICKED: '1' } : {}),
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

/* #728: the inversion. The launcher puts the BUNDLED tmux first on PATH before
   the picker runs, so a probe of `command -v tmux` found the bundle every time
   and the system tmux that could see the server was never asked. The tests
   above never saw it because they ran the picker with the bundle OFF PATH,
   which the real launcher never does. This one runs it the way the launcher
   does: bundle first, the pre-export PATH saved beside it. */
function pickLikeTheLauncher({ sysExit }) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'tmuxpick-'));
  const home = nodePath.join(sb, 'home');
  fs.mkdirSync(nodePath.join(home, 'tmux', 'bin'), { recursive: true });
  const bundled = nodePath.join(home, 'tmux', 'bin', 'tmux');
  fs.writeFileSync(bundled, '#!/bin/sh\necho "server exited unexpectedly" >&2\nexit 1\n'); fs.chmodSync(bundled, 0o755);
  const bin = nodePath.join(sb, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const sys = nodePath.join(bin, 'tmux');
  fs.writeFileSync(sys, `#!/bin/sh\nexit ${sysExit}\n`); fs.chmodSync(sys, 0o755);
  const script = `KOSMOS_HOME=${JSON.stringify(home)}\n_KOSMOS_PATH_SYS="$PATH"\nexport PATH="$KOSMOS_HOME/tmux/bin:$PATH"\n${picker()}\nprintf '%s' "$AGENT_WORKFORCE_TMUX_BIN"\n`;
  const out = execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin`, KOSMOS_TMUX_KNOWN: '' } });
  return { chose: out, bundled, sys, sb };
}
test('#728: with the bundle first on PATH, a system tmux that can see the server is still found and chosen', () => {
  const r = pickLikeTheLauncher({ sysExit: 0 });
  assert.equal(r.chose, r.sys, 'the picker probed the bundle it had just put first on PATH and never asked the system tmux');
  fs.rmSync(r.sb, { recursive: true, force: true });
});
test('#728: with the bundle first on PATH and no server anywhere, the bundle still stays', () => {
  const r = pickLikeTheLauncher({ sysExit: 1 });
  assert.equal(r.chose, r.bundled);
  fs.rmSync(r.sb, { recursive: true, force: true });
});

/* #728, the other surface: `kosmos agents` must not say None through a binary
   that could not see. Runs cmd_agents with a fake tmux for each stderr shape. */
function agentsWith(stderrLine, exit) {
  const at = LAUNCHER.indexOf('cmd_agents() {');
  const end = LAUNCHER.indexOf('\n}\n', at);
  const fn = LAUNCHER.slice(at, end + 3);
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'tmuxagents-'));
  const fake = nodePath.join(sb, 'tmux');
  fs.writeFileSync(fake, `#!/bin/sh\necho ${JSON.stringify(stderrLine)} >&2\nexit ${exit}\n`); fs.chmodSync(fake, 0o755);
  const script = `say() { printf '%s\\n' "$*"; }\nAGENT_WORKFORCE_TMUX_BIN=${JSON.stringify(fake)}\n${fn}\ncmd_agents\n`;
  let out = '', code = 0;
  try { out = execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }); }
  catch (e) { out = String(e.stdout || ''); code = e.status; }
  fs.rmSync(sb, { recursive: true, force: true });
  return { out, code };
}
test('#728: a tmux that cannot read the server is said as blindness, never as None', () => {
  const r = agentsWith('server exited unexpectedly', 1);
  assert.ok(!/None\./.test(r.out), 'a confident None through a blind binary: ' + r.out);
  assert.match(r.out, /Could not see/);
  assert.match(r.out, /AGENT_WORKFORCE_TMUX_BIN=/);
  assert.equal(r.code, 2);
});
test('#728: a genuinely absent server is still an honest None', () => {
  const r = agentsWith('no server running on /private/tmp/tmux-501/default', 1);
  assert.match(r.out, /None\./);
  assert.equal(r.code, 1);
});

/* #728, the rider Pete measured on a real 0.5.24 -> 0.5.25 update: the OLD
   launcher's pick rides the environment down the update chain and the NEW
   launcher took it for a deliberate choice, so a Mac with a newer tmux stayed
   blind until a clean-env restart. A value marked as a previous launcher's
   pick is re-picked; an unmarked explicit value is still honoured. */
test('#728: a previous launcher\'s pick (marked) is re-picked, so an update does not inherit blindness', () => {
  const r = pick({ sysExit: 0, preset: '/previous/launcher/bundled/tmux', picked: true });
  assert.match(r.chose, /\/bin\/tmux$/);
  assert.notEqual(r.chose, '/previous/launcher/bundled/tmux', 'the inherited pick was taken for a person\'s choice');
  fs.rmSync(r.sb, { recursive: true, force: true });
});
test('#728: an unmarked explicit choice is still honoured (the harness, or a person)', () => {
  const r = pick({ sysExit: 0, preset: '/somewhere/else/tmux', picked: false });
  assert.equal(r.chose, '/somewhere/else/tmux');
  fs.rmSync(r.sb, { recursive: true, force: true });
});
