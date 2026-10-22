'use strict';
/**
 * #3417 (Josh, 2026-10-22 11:39: "id rather it just auto approve stuff like this"): Claude Code's own safety checks
 * prompt even in bypass mode, for example "Dangerous rm operation on possibly-empty variable path" for
 * rm -f "$S"/*.png. Measured with 2.1.308 (interactive, --dangerously-skip-permissions): that check reaches the
 * PermissionRequest hook, and Kosmos's allow hook answers it, so the person sees no prompt and the command runs. These
 * tests pin that the hook answers allow for those shapes, so a later narrowing of decide() cannot bring the prompt back.
 *
 * DELIBERATE, NOT AN OVERSIGHT: allowing rm -rf $X/ means an empty X runs rm -rf /. That cost was put to Josh on the
 * card and he chose auto-approve. A change that makes these red is a change to his ruling, so take it back to him.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const hook = require('./kosmos-permission-allow');
const ap = require('./agentpermission');

const bash = (command) => JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command } });

/* engine/agentpermission-5406.test.js covers the hook in general; this file pins the shapes from Josh's #3417 ruling. */
test('#3417 decide() answers allow for the shapes of Claude\'s dangerous-rm safety prompt', () => {
  for (const cmd of [
    'rm -f "$S"/*.png',
    'rm -rf $X/',
    'rm -rf "${DIR}"/build',
    'for f in a b; do rm -f "$D"/$f; done',
    'cd /tmp && rm -rf "$W"/*',
  ]) {
    assert.deepEqual(hook.decide(bash(cmd)), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }, cmd);
  }
});

test('#3417 CONTROL: the protected-place rule still stays silent for the same shape (.git, not .github)', () => {
  assert.equal(hook.decide(bash('rm -rf "$S"/.git')), null);
  assert.equal(hook.decide(bash('rm -rf "$S"/.github')).hookSpecificOutput.decision.behavior, 'allow', '.github is not .git');
});

test('#3417 the shipped hook script prints the allow for it', () => {
  const r = spawnSync(process.execPath, [ap.HOOK_SCRIPT], { input: bash('rm -f "$S"/*.png'), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.decision.behavior, 'allow');
});
