'use strict';

/**
 * A new agent is never asked about a renderer (#1160).
 *
 * Josh met Claude Code's fullscreen-renderer question on a brand-new agent's
 * FIRST screen, about half the time, and reported it three times. The half is
 * an A/B on a server-side flag in the runner, not a race here, which is why it
 * is frequent and not reproducible on demand -- and why a test that tried to
 * drive the runner could never pin this. What CAN be pinned is the one thing
 * that makes the runner not ask: the variable our own job carries.
 *
 * ⚠️ THE NEGATIVE ARM IS THE POINT, not decoration. `plistFor` builds one
 * template string, so an assertion that the key is somewhere in it passes for a
 * key written outside `EnvironmentVariables`, where launchd would ignore it and
 * the agent would still be asked. Both arms below read the env block only.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// ⚠️ SANDBOX BEFORE REQUIRING, the same four roots and for the same reasons as
// create.test.js: this module resolves them at load and writes real launchd
// jobs, worker folders and ~/.claude.json entries when it does not.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'no-upsell-test-'));
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

/**
 * The `EnvironmentVariables` dict alone, so an assertion cannot be satisfied by
 * the key appearing anywhere else in the job.
 */
function envBlock(plist) {
  const at = plist.indexOf('<key>EnvironmentVariables</key>');
  assert.notEqual(at, -1, 'the job has an EnvironmentVariables block');
  const open = plist.indexOf('<dict>', at);
  const close = plist.indexOf('</dict>', open);
  assert.ok(open !== -1 && close > open, 'that block is a dict');
  return plist.slice(open, close);
}

function claudeJob() {
  return create.plistFor('fixture-no-upsell', '/bin/echo', '/opt/homebrew/bin/tmux', null, null, undefined);
}

test('a new claude agent\'s job turns the fullscreen renderer off, so its first screen is its own', () => {
  const env = envBlock(claudeJob());
  assert.ok(env.includes(`<key>${KEY}</key>`), `${KEY} is in the job's environment`);
  // The value launchd hands over, read rather than assumed: the runner's own
  // sentence is "CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 forces that any time",
  // and an empty or "0" string is a different instruction.
  const m = env.match(new RegExp(`<key>${KEY}</key><string>([^<]*)</string>`));
  assert.ok(m, `${KEY} carries a value`);
  assert.equal(m[1], '1');
});

/**
 * ⚠️ THE CONTROL THAT MAKES THE ARM ABOVE MEAN SOMETHING. This variable is
 * Claude Code's. A codex agent runs a different program that has never heard of
 * it, and stamping it there would be cargo -- the kind that reads as deliberate
 * to the next person and is impossible to date.
 *
 * It also proves the assertion above can distinguish: a `plistFor` that wrote
 * the key unconditionally would pass the first test and fail this one.
 */
test('a codex agent\'s job does not carry a variable belonging to another runner', () => {
  const env = envBlock(create.plistFor('fixture-no-upsell-codex', '/bin/echo', '/opt/homebrew/bin/tmux', null, null, 'codex'));
  assert.ok(!env.includes(KEY), `${KEY} is absent from a codex job`);
  // Positive control on the same block, so an empty or malformed env dict
  // cannot pass this by having nothing in it at all.
  assert.ok(env.includes('<key>LANG</key>'), 'the codex job still has its environment');
});

/**
 * The variable is ours to set and the person's to override. Nothing here reads
 * or writes a settings file, an agent folder or `~/.claude` -- the job is the
 * only surface this fix touches, which is what keeps it out of the person's own
 * terminal and out of any repo of theirs.
 */
test('the fix touches the job and nothing else', () => {
  const plist = claudeJob();
  assert.ok(!plist.includes('settings.json'), 'no settings file is named by the job');
  assert.ok(!plist.includes('"tui"') && !plist.includes('<key>tui</key>'), 'no renderer setting is written');
});
