'use strict';
/**
 * #3417 (Josh, 2026-10-22 11:25: "I shouldn't get these warnings"): Claude Code's own "Dangerous rm operation on
 * possibly-empty variable path" check prompts even in bypass mode. Kosmos's PermissionRequest hook answers it with a
 * deny that carries the rewrite, so the person sees nothing and the agent retries safely (measured with 2.1.308:
 * the agent reran it as "${S:?}"/*.png, which ran with no prompt). Everything else is still allowed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const hook = require('./kosmos-permission-allow');
const ap = require('./agentpermission');

const bash = (command) => JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command } });
const decision = (command) => hook.decide(bash(command)).hookSpecificOutput.decision;

test('#3417 an rm whose path starts with a possibly-empty variable is denied with the rewrite', () => {
  for (const [cmd, name] of [
    ['rm -f "$S"/*.png', 'S'],
    ['rm -rf $X/', 'X'],
    ['rm -rf "${DIR}"/build', 'DIR'],
    ['rm -f ${OUT}/a.txt', 'OUT'],
    ['rm -rf "$TMP/cache"', 'TMP'],
    ['cd /tmp && rm -rf "$W"/*', 'W'],
    ['sudo rm -rf "$X"/', 'X'],
    ['FOO=1 /bin/rm -f "$S"/x', 'S'],
    ['echo start; rm -f "$S"/*.png; echo done', 'S'],
    ['x=$(rm -f "$S"/y)', 'S'],
  ]) {
    const d = decision(cmd);
    assert.equal(d.behavior, 'deny', cmd);
    assert.match(d.message, new RegExp('\\$\\{' + name + ':\\?\\}'), 'the message gives the guarded spelling for ' + cmd);
    assert.equal(hook.rmDanger(cmd), name, cmd);
  }
});

test('#3417 the guarded rewrite, literal paths and other commands are still allowed', () => {
  for (const cmd of [
    'rm -f "${S:?}"/*.png',
    'rm -rf "${X:?not set}"/',
    'rm -f /tmp/kosmos/a.png',
    'rm -f "$S"',
    'ls "$S"/*.png',
    'echo rm -f "$S"/x',
    'git rm --cached "$F"',
    'npm run rmdist',
    'grep -r "rm -rf" .',
  ]) {
    assert.equal(decision(cmd).behavior, 'allow', cmd);
    assert.equal(hook.rmDanger(cmd), null, cmd);
  }
});

test('#3417 only Bash is judged, and a protected place still stays silent', () => {
  const write = JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: { content: 'rm -f "$S"/x' } });
  assert.equal(hook.decide(write).hookSpecificOutput.decision.behavior, 'allow', 'text in a file is not a command');
  assert.equal(hook.decide(bash('rm -rf "$S"/.git')), null, 'CONTROL: the protected-place rule still wins');
  assert.equal(hook.rmDanger(undefined), null);
});

test('#3417 the hook script itself prints the deny', () => {
  const r = spawnSync(process.execPath, [ap.HOOK_SCRIPT], { input: bash('rm -f "$S"/*.png'), encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0);
  const d = JSON.parse(r.stdout).hookSpecificOutput.decision;
  assert.equal(d.behavior, 'deny');
  assert.match(d.message, /\$\{S:\?\}/);
});
