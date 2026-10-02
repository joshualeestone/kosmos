'use strict';
/**
 * #2955: the agents' supervisors follow the launcher's tmux pick.
 *
 * Measured on Agent1s, 2026-10-01 13:42: the board started on Kosmos's bundled tmux 3.5a three seconds before the
 * fleet's Homebrew 3.6a took the socket, and the board could read no agent. The launcher now prefers a working system
 * tmux. But every agent's launchd job carries the tmux path it was made with, and plists are never rewritten, so a
 * supervisor still on the bundled copy would start its agent on a server the board (now on Homebrew's) cannot read.
 * The launcher records its pick in <home>/tmux/chosen; a supervisor baked with that home's bundled path uses it.
 * Both halves run the shipped code, lifted out of the files.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const SUP = fs.readFileSync(nodePath.join(__dirname, 'bin', 'agent-supervisor.sh'), 'utf8');
const LAUNCHER = fs.readFileSync(nodePath.join(__dirname, 'install', 'kosmos'), 'utf8');

function supervisorFn() {
  const at = SUP.indexOf('_kosmos_supervisor_tmux() {');
  assert.notEqual(at, -1, 'the supervisor\'s tmux follow moved or was renamed; re-point this test');
  const end = SUP.indexOf('\n}\n', at);
  assert.ok(SUP.indexOf('\n_kosmos_supervisor_tmux\n', end) !== -1, 'the follow is defined and never called');
  return SUP.slice(at, end + 3);
}
/** The supervisor's TMUX_BIN after the follow, from a baked path. */
function follow(baked) {
  const out = execFileSync('/bin/bash', ['-c', `TMUX_BIN=${JSON.stringify(baked)}\n${supervisorFn()}\n_kosmos_supervisor_tmux\nprintf '%s' "$TMUX_BIN"`], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  return out;
}
function home() {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'supchosen-'));
  const h = nodePath.join(sb, 'kosmos');
  fs.mkdirSync(nodePath.join(h, 'tmux', 'bin'), { recursive: true });
  const bundled = nodePath.join(h, 'tmux', 'bin', 'tmux');
  fs.writeFileSync(bundled, '#!/bin/sh\nexit 0\n'); fs.chmodSync(bundled, 0o755);
  const sys = nodePath.join(sb, 'sys-tmux');
  fs.writeFileSync(sys, '#!/bin/sh\nexit 0\n'); fs.chmodSync(sys, 0o755);
  return { sb, h, bundled, sys };
}

test('#2955: a supervisor baked with the bundled tmux uses the launcher\'s recorded pick', () => {
  const t = home();
  fs.writeFileSync(nodePath.join(t.h, 'tmux', 'chosen'), t.sys + '\n');
  assert.equal(follow(t.bundled), t.sys, 'the supervisor kept the bundled tmux while the board reads through another');
  fs.rmSync(t.sb, { recursive: true, force: true });
});
test('#2955: no record, an empty one, or one naming nothing runnable leaves the baked path alone', () => {
  const t = home();
  assert.equal(follow(t.bundled), t.bundled, 'no record');
  fs.writeFileSync(nodePath.join(t.h, 'tmux', 'chosen'), '');
  assert.equal(follow(t.bundled), t.bundled, 'an empty record');
  fs.writeFileSync(nodePath.join(t.h, 'tmux', 'chosen'), nodePath.join(t.sb, 'gone-tmux') + '\n');
  assert.equal(follow(t.bundled), t.bundled, 'a record naming a missing file');
  const noexec = nodePath.join(t.sb, 'noexec-tmux');
  fs.writeFileSync(noexec, '#!/bin/sh\n'); fs.chmodSync(noexec, 0o644);
  fs.writeFileSync(nodePath.join(t.h, 'tmux', 'chosen'), noexec + '\n');
  assert.equal(follow(t.bundled), t.bundled, 'a record naming a file that cannot run');
  fs.rmSync(t.sb, { recursive: true, force: true });
});
test('#2955: any other baked path is a choice somebody made, and is never redirected', () => {
  const t = home();
  fs.writeFileSync(nodePath.join(t.h, 'tmux', 'chosen'), t.sys + '\n');
  assert.equal(follow('/opt/homebrew/bin/tmux'), '/opt/homebrew/bin/tmux');
  assert.equal(follow(t.sys), t.sys);
  fs.rmSync(t.sb, { recursive: true, force: true });
});

/* The launcher half: the pick is written down, only when the launcher made it, and not rewritten when unchanged. */
function launcherRecord() {
  const at = LAUNCHER.lastIndexOf('_KOSMOS_TMUX_EXPLICIT=""', LAUNCHER.indexOf('_kosmos_pick_tmux() {'));
  const tail = 'unset _kosmos_was\n  fi\nfi\n';
  const end = LAUNCHER.indexOf(tail, at);
  assert.ok(at !== -1 && end !== -1, 'the launcher\'s pick or its record moved; re-point this test');
  return LAUNCHER.slice(at, end + tail.length);
}
function launch(h, sysDir, env) {
  execFileSync('/bin/sh', ['-c', `KOSMOS_HOME=${JSON.stringify(h)}\n${launcherRecord()}`], {
    encoding: 'utf8', env: { PATH: `${sysDir}:/usr/bin:/bin`, KOSMOS_TMUX_KNOWN: '', ...env } });
}
test('#2955: the launcher records its pick, leaves an unchanged record alone, and records no explicit choice', () => {
  const t = home();
  const sysDir = nodePath.join(t.sb, 'sysbin');
  fs.mkdirSync(sysDir);
  const sys = nodePath.join(sysDir, 'tmux');
  fs.writeFileSync(sys, '#!/bin/sh\necho "no server running on /x" >&2\nexit 1\n'); fs.chmodSync(sys, 0o755);
  const rec = nodePath.join(t.h, 'tmux', 'chosen');
  launch(t.h, sysDir, {});
  assert.equal(fs.readFileSync(rec, 'utf8'), sys + '\n', 'the launcher\'s pick was not written down for the supervisors');
  const before = fs.statSync(rec);
  launch(t.h, sysDir, {});
  const after = fs.statSync(rec);
  assert.equal(after.ino, before.ino, 'an unchanged pick was rewritten (every kosmos command would churn it)');
  fs.rmSync(rec);
  launch(t.h, sysDir, { AGENT_WORKFORCE_TMUX_BIN: '/somewhere/else/tmux' });
  assert.equal(fs.existsSync(rec), false, 'an explicit choice (the harness, a person) was recorded as the launcher\'s pick');
  fs.rmSync(t.sb, { recursive: true, force: true });
});
