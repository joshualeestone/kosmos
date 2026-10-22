'use strict';
/**
 * #3417 (Josh, 2026-10-22 11:39: "id rather it just auto approve stuff like this"): Claude Code's own safety checks
 * prompt even in bypass mode, for example "Dangerous rm operation on possibly-empty variable path" for
 * rm -f "$S"/*.png. Measured with 2.1.308 (interactive, --dangerously-skip-permissions): that check reaches the
 * PermissionRequest hook, and Kosmos's allow hook answers it, so the person sees no prompt and the command runs. These
 * tests pin that the hook answers allow for those shapes, so a later narrowing of decide() cannot bring the prompt back.
 * decide() has no rm-specific path: these pass through its general Bash allow. The payload Claude sent carried no field
 * naming the check (permission_suggestions was empty), so decide() cannot tell a safety check from an ask rule. That was
 * measured on Claude Code 2.1.308 only (kosmos#6913): a later version may name the check, and this file would not know.
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

/* kosmos#6913: not a control for the allow tests above. It pins the boundary beside them: #5406's protected-place rule
   still holds for this same shape, so the allow is not a blanket one. agentpermission-5406.test.js covers the rule in
   general; this keeps the boundary in the file a reader of #3417 opens. */
test('#3417 the protected-place rule still holds for the same shape: .git stays silent, .github is allowed', () => {
  assert.equal(hook.decide(bash('rm -rf "$S"/.git')), null);
  assert.equal(hook.decide(bash('rm -rf "$S"/.github')).hookSpecificOutput.decision.behavior, 'allow', '.github is not .git');
});

test('#3417 a .claude working folder does not change the answer: only the command is read (kosmos#6913)', () => {
  /* Agents run inside folders that hold .claude. A later change that scans the whole request (cwd, transcript_path)
     for protected places, not just tool_input, would make every rm in such a folder prompt again: this goes red then.
     CONTROL: the same command with .git in the COMMAND is still silent (the rule reads the command). */
  const inClaude = { hook_event_name: 'PermissionRequest', tool_name: 'Bash', cwd: '/tmp/kosmos-test/.claude/proj',
    transcript_path: '/tmp/kosmos-test/.claude/projects/x/transcript.jsonl', tool_input: { command: 'rm -f "$S"/*.png' } };
  assert.equal(hook.decide(JSON.stringify(inClaude)).hookSpecificOutput.decision.behavior, 'allow');
  assert.equal(hook.decide(JSON.stringify({ ...inClaude, tool_input: { command: 'rm -rf "$S"/.git' } })), null, 'CONTROL: .git in the command');
});

test('#3417 the shipped hook script prints the allow for it', () => {
  const r = spawnSync(process.execPath, [ap.HOOK_SCRIPT], { input: bash('rm -f "$S"/*.png'), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.decision.behavior, 'allow');
});
