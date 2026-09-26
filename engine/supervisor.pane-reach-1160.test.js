'use strict';

/**
 * The renderer preference reaches the PANE, not just the job (#1160).
 *
 * 🛑 THIS TEST EXISTS BECAUSE THE FIRST FIX WAS INERT AND EVERY TEST PASSED.
 * I put `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` in the launchd job, asserted it
 * was in the job's `EnvironmentVariables`, watched 2629 tests go green, and
 * shipped something that could not work: tmux does not hand a client's
 * environment to a session it makes on an already-running server. The
 * supervisor says so in its own words, twelve lines above where the fix
 * belonged, and had measured it: "probed: 0 of 1 variables arrive".
 *
 * ⇒ The plist was a PROXY for the pane. It has the right shape, it is easy to
 * assert, and it measures the wrong thing. So this file pins the pane.
 *
 *   node --test engine/supervisor.pane-reach-1160.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'pane-reach-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.on('exit', () => {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const create = require('./create');
const KEY = 'CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN';
const script = () => fs.readFileSync(create.supervisorSource(), 'utf8');

/**
 * The guard, RUN rather than matched.
 *
 * ⚠️ A regex can prove the line is present and cannot prove it is reachable, or
 * that it selects the right runner. This lifts the `if` that wraps the append
 * and executes it under bash for a given RUNNER, so the assertion is about
 * behaviour.
 */
function paneEnvFor(runner) {
  const src = script();
  const m = src.match(/if \[ "\$RUNNER" != codex \] && \[ "\$RUNNER" != antigravity \]; then\n\s*PANE_ENV\+=\([^\n]*\)\n\s*fi/);
  assert.ok(m, 'the renderer guard is gone from the supervisor');
  const frag = `PANE_ENV=()\nRUNNER=${runner}\n${m[0]}\nprintf '%s\\n' "\${PANE_ENV[@]:-}"\n`;
  return execFileSync('/bin/bash', ['-c', frag], { encoding: 'utf8' }).trim();
}

test('a claude agent gets the preference handed into its pane', () => {
  const out = paneEnvFor('claude');
  assert.match(out, /-e/, 'it rides as a tmux -e flag');
  assert.match(out, new RegExp(`${KEY}=1`), `${KEY} is set to 1 for the pane`);
});

test('a codex agent does not, because the variable is not its runner\'s', () => {
  assert.equal(paneEnvFor('codex'), '', 'a codex pane carries no claude-only variable');
});

/* #3568: the per-var forwarding loop, RUN like the guard above: an agy pane never receives a
   CLAUDE_CONFIG_DIR from the supervisor's env, and a claude pane still does. */
function forwardedFor(runner) {
  const m = script().match(/  for _var in HOME [^\n]*; do\n[\s\S]*?\n  done\n/);
  assert.ok(m, 'the forwarding loop is gone from the supervisor');
  const frag = `PANE_ENV=()\nRUNNER=${runner}\nCLAUDE_CONFIG_DIR=/acct\nHOME=/h\n${m[0]}printf '%s\\n' "\${PANE_ENV[@]:-}"\n`;
  return execFileSync('/bin/bash', ['-c', frag], { encoding: 'utf8', env: { PATH: process.env.PATH } }).trim();
}

test('the forwarding loop hands CLAUDE_CONFIG_DIR to a claude pane and not to an agy pane (#3568)', () => {
  assert.match(forwardedFor('claude'), /CLAUDE_CONFIG_DIR=\/acct/, 'CONTROL: a claude pane still gets its account folder');
  const agy = forwardedFor('antigravity');
  assert.doesNotMatch(agy, /CLAUDE_CONFIG_DIR/, 'an agy pane carries no Claude account folder');
  assert.match(agy, /HOME=\/h/, 'CONTROL: the rest of the loop still runs for an agy pane');
});

/* #3568: the adopt path's "is this pane a live agent or a crashed shell" test, RUN under bash.
   Without agy in it, a live Antigravity agent reads as a crashed shell and the supervisor kills
   its session whenever it re-runs. */
function aliveFor(paneCmd) {
  const m = script().match(/      if \[\[ "\$pane_cmd" =~[^\n]*\\\n[^\n]*\\\n[^\n]*; then\n\s*alive=1\n\s*fi/);
  assert.ok(m, 'the adopt allowlist is gone from the supervisor');
  const frag = `alive=0\npane_cmd=${JSON.stringify(paneCmd)}\n${m[0]}\necho "$alive"\n`;
  return execFileSync('/bin/bash', ['-c', frag], { encoding: 'utf8' }).trim();
}

test('the supervisor counts a live agy pane as an agent, not a crashed shell (#3568)', () => {
  assert.equal(aliveFor('agy'), '1', 'a live Antigravity agent would be killed as a crashed shell');
  assert.equal(aliveFor('codex'), '1', 'CONTROL: codex still counts');
  assert.equal(aliveFor('-zsh'), '0', 'CONTROL: a shell is still a crashed pane');
  // #3953: and a live Grok agent, by every name the board counts as Grok.
  for (const g of ['grok-native', 'grok', 'grok.exe']) assert.equal(aliveFor(g), '1', `a live Grok agent (${g}) would be killed as a crashed shell`);
});

/* #3568 round 14: the SECOND guard that keeps a Claude account out of an agy pane -- the one that
   pins the tmux server-global CLAUDE_CONFIG_DIR for a default-account agent -- RUN under bash. */
function pinsCcdFor(runner) {
  const m = script().match(/  if \[ "\$RUNNER" != codex \] && \[ "\$RUNNER" != antigravity \] && \[ -z "\$EFFECTIVE_CCD" \]; then/);
  assert.ok(m, 'the server-global CLAUDE_CONFIG_DIR guard is gone or no longer excludes antigravity');
  const frag = `RUNNER=${runner}\nEFFECTIVE_CCD=\n${m[0]} echo pin; else echo skip; fi\n`;
  return execFileSync('/bin/bash', ['-c', frag], { encoding: 'utf8' }).trim();
}

test('the server-global CLAUDE_CONFIG_DIR pin runs for a claude pane and not for an agy pane (#3568)', () => {
  assert.equal(pinsCcdFor('claude'), 'pin', 'CONTROL: a default-account claude pane is still pinned');
  assert.equal(pinsCcdFor('antigravity'), 'skip', 'an agy pane would be pinned to a Claude account');
});

/* #3568 spike: agy asks "trust this folder?" on every new folder and has no flag to skip it, so the
   antigravity arm runs engine/agytrust.js on the agent's folder BEFORE it starts the pane. */
test('the antigravity arm pre-answers agy folder trust before it starts the pane (#3568)', () => {
  const src = script();
  const at = src.indexOf('elif [ "$RUNNER" = antigravity ]; then');
  assert.ok(at > -1, 'the antigravity launch arm is gone');
  const arm = src.slice(at, src.indexOf('\n  else\n', at));
  const trust = arm.indexOf('"$_eng/agytrust.js" "$WORKDIR"');
  const launch = arm.indexOf('new-session');
  assert.ok(trust > -1, 'the antigravity arm does not run agytrust.js on the agent folder');
  assert.ok(launch > trust, 'agytrust.js must run before the pane starts, or agy asks first');
});

test('an Antigravity agent does not either (#3568)', () => {
  assert.equal(paneEnvFor('antigravity'), '', 'an agy pane carries no claude-only variable');
});

/**
 * 🔑 THE ASSERTION THAT WOULD HAVE CAUGHT THE ORIGINAL MISTAKE, stated as the
 * coupling rather than as a location: a variable the RUNNER must read has to be
 * in the supervisor's `-e` list, and being in the launchd job instead is the
 * failure, not a second way of doing it.
 */
test('the preference is in the pane list and NOT in the launchd job', () => {
  const src = script();
  const at = src.indexOf(KEY);
  assert.notEqual(at, -1, `${KEY} is gone from the supervisor`);
  // It is appended to PANE_ENV, which is the only thing new-session reads.
  assert.match(src.slice(at - 200, at + 80), /PANE_ENV\+=/,
    `${KEY} is in the supervisor but not on the PANE_ENV path, so the pane never sees it`);

  const plist = create.plistFor('fixture-pane-reach', '/bin/echo', '/opt/homebrew/bin/tmux');
  assert.ok(!plist.includes(`<key>${KEY}</key>`),
    'the job carries it again, which is the inert version of this fix');
  // Control: the job really does carry environment, so the assertion above is
  // not passing because the block is empty.
  assert.ok(plist.includes('<key>LANG</key>'), 'the job still has an environment block');
});

/**
 * ⚠️ AND THE REASON, PINNED. The supervisor's own comment is what I failed to
 * read, and it is the only place that records why the job route cannot work.
 * If somebody deletes it the next person repeats the mistake with no warning.
 */
test('the supervisor still records why a job variable does not reach a pane', () => {
  assert.match(script(), /tmux\s*\n?\s*#?\s*does NOT hand a client's environment/,
    'the note explaining why PANE_ENV exists at all was removed');
});
