'use strict';
/**
 * #3417 (Josh, 2026-10-22 11:39: "id rather it just auto approve stuff like this"): Claude Code's own safety checks
 * prompt even in bypass mode, for example "Dangerous rm operation on possibly-empty variable path" for
 * rm -f "$S"/*.png. Measured with 2.1.308 (interactive, --dangerously-skip-permissions): that check reaches the
 * PermissionRequest hook, and Kosmos's allow hook answers it, so the person sees no prompt and the command runs. These
 * tests pin that the hook answers allow for those shapes, so a later narrowing of decide() cannot bring the prompt back.
 * decide() has no rm-specific path: these pass through its general Bash allow. The payload Claude sent carried no field
 * naming the check (permission_suggestions was empty), so decide() cannot tell a safety check from an ask rule.
 *
 * DELIBERATE, NOT AN OVERSIGHT: with the variable empty, rm -f "$S"/*.png deletes /*.png. Josh chose auto-approve
 * anyway. A change that turns the allow tests red is a change to his ruling, so take it back to him.
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
    'rm -f $S/*.png',
    'rm -f "${S}"/*.png',
    'for f in a b; do rm -f "$S"/$f.png; done',
  ]) {
    assert.deepEqual(hook.decide(bash(cmd)), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }, cmd);
  }
});

test('#3417 a payload modelled on what Claude Code 2.1.308 sent for this check (2026-10-22, paths and ids replaced) is answered allow', () => {
  const real = {
    session_id: '00000000-0000-0000-0000-000000000000',
    transcript_path: '/tmp/kosmos-test/transcript.jsonl',
    cwd: '/tmp/kosmos-test/proj',
    scratchpad_dir: '/tmp/kosmos-test/scratchpad',
    prompt_id: '00000000-0000-0000-0000-000000000001',
    permission_mode: 'bypassPermissions',
    effort: { level: 'medium' },
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'rm -f "$S"/*.png', description: 'Delete PNG files in the S directory' },
    permission_suggestions: [],
  };
  assert.equal(hook.decide(JSON.stringify(real)).hookSpecificOutput.decision.behavior, 'allow');
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
