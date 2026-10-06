'use strict';
/**
 * kosmos#5358 (beta-day report, a Windows install): "the `kosmos` CLI is still not on PATH in an agent's own shell".
 * Kosmos's own launch path is meant to make it work in every shell an agent uses (engine/win32launch.childEnv puts
 * <zip>\bin first on PATH, and gives the PowerShell runners the process-scope policy, #3380). Until now that was
 * measured by hand on one box; these arms measure it on the Windows CI runner, so a red names which half broke:
 *   - Git Bash, as Claude Code's Bash tool runs it (`bash -c`, measured in #570's cli-verbs plan): finds `kosmos` on
 *     the agent's PATH;
 *   - PowerShell with the flags Claude Code's tool passes (a premise from #570, not measured here): finds and runs
 *     kosmos.ps1 under a Restricted policy;
 *   - Codex's `powershell -Command`: refused under Restricted WITHOUT the variable (the control), runs WITH it.
 * Plus pure arms (any OS) for the one fix this card makes: the policy variable is ONE key whatever case it arrives in.
 *
 * Windows arms use a zip-shaped folder with the real shims and a stub CLI. The policy arms change the CurrentUser
 * policy, so they run only on GitHub Actions and put it back.
 *
 *   node --test engine/win32-kosmos-shell-5358.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const launcher = require('./win32launch');
// A just-exited node.exe can hold its folder for a moment on Windows (#5010, #5074): remove with the shared retry.
const { removeTree } = require('../test-support/remove-tree');

const keysOf = (env, name) => Object.keys(env).filter((k) => k.toUpperCase() === name.toUpperCase());

test('#5358: a PowerShell runner\'s policy is ONE key whatever case it arrives in; claude gets none (#3380)', () => {
  for (const runner of ['codex', 'gemini', 'grok', 'antigravity']) {
    const env = launcher.childEnv({ psexecutionpolicypreference: 'AllSigned' }, 't', null, 'C:\\K\\bin', runner);
    assert.deepEqual(keysOf(env, 'PSExecutionPolicyPreference'), ['PSExecutionPolicyPreference'], runner + ': one key, spelled as usual');
    assert.equal(env.PSExecutionPolicyPreference, 'Bypass', runner);
    assert.equal(launcher.childEnv({}, 't', null, 'C:\\K\\bin', runner).PSExecutionPolicyPreference, 'Bypass', runner + ' (no key before)');
    // Node on Windows sorts env names and keeps the first case-insensitive match, so an inherited UPPERCASE key used to
    // win over the Bypass this added beside it.
    const upper = launcher.childEnv({ PSEXECUTIONPOLICYPREFERENCE: 'AllSigned' }, 't', null, 'C:\\K\\bin', runner);
    assert.deepEqual(keysOf(upper, 'PSExecutionPolicyPreference'), ['PSExecutionPolicyPreference'], runner + ': uppercase');
    assert.equal(upper.PSExecutionPolicyPreference, 'Bypass', runner + ': uppercase');
    const two = launcher.childEnv({ psexecutionpolicypreference: 'RemoteSigned', PSEXECUTIONPOLICYPREFERENCE: 'AllSigned' }, 't', null, 'C:\\K\\bin', runner);
    assert.equal(keysOf(two, 'PSExecutionPolicyPreference').length, 1, runner + ': two spellings in, one key out');
    assert.equal(two.PSExecutionPolicyPreference, 'Bypass', runner + ': two spellings in');
    const same = launcher.childEnv({ PSExecutionPolicyPreference: 'AllSigned' }, 't', null, 'C:\\K\\bin', runner);
    assert.deepEqual(keysOf(same, 'PSExecutionPolicyPreference'), ['PSExecutionPolicyPreference'], runner + ': the usual spelling');
    assert.equal(same.PSExecutionPolicyPreference, 'Bypass', runner);
  }
  assert.deepEqual(keysOf(launcher.childEnv({}, 't', null, 'C:\\K\\bin', 'claude'), 'PSExecutionPolicyPreference'), [],
    'control: a claude child is left as #3380 decided (its PowerShell tool passes its own policy flag)');
  assert.equal(launcher.childEnv({ PSEXECUTIONPOLICYPREFERENCE: 'AllSigned' }, 't', null, 'C:\\K\\bin', 'claude').PSEXECUTIONPOLICYPREFERENCE, 'AllSigned',
    'control: a claude child keeps an inherited value untouched');
});

test('#5358 review 9: every name childEnv removes or sets is matched whatever its case (the #2129 account leak too)', () => {
  // A default-account agent inherits no account folder, however the engine's spelling of it.
  const dflt = launcher.childEnv({ Claude_Config_Dir: 'C:\\engine', kosmos_agent_token: 'someone-else', claudecode: '1' }, null, null, null, 'claude');
  assert.deepEqual(keysOf(dflt, 'CLAUDE_CONFIG_DIR'), [], 'the engine\'s account folder leaked to a default-account agent');
  assert.deepEqual(keysOf(dflt, 'KOSMOS_AGENT_TOKEN'), [], 'another agent\'s token was inherited');
  assert.deepEqual(keysOf(dflt, 'CLAUDECODE'), [], 'a child-session marker survived in another spelling');
  // A named account and a token are set as ONE key each.
  const named = launcher.childEnv({ Claude_Config_Dir: 'C:\\engine', kosmos_agent_token: 'x' }, 'mine', 'C:\\acct', null, 'claude');
  assert.deepEqual(keysOf(named, 'CLAUDE_CONFIG_DIR'), ['CLAUDE_CONFIG_DIR']);
  assert.equal(named.CLAUDE_CONFIG_DIR, 'C:\\acct');
  assert.deepEqual(keysOf(named, 'KOSMOS_AGENT_TOKEN'), ['KOSMOS_AGENT_TOKEN']);
  assert.equal(named.KOSMOS_AGENT_TOKEN, 'mine');
  const codex = launcher.childEnv({ codex_home: 'C:\\old' }, 't', 'C:\\h\\.codex-w', null, 'codex');
  assert.deepEqual(keysOf(codex, 'CODEX_HOME'), ['CODEX_HOME']);
  assert.equal(codex.CODEX_HOME, 'C:\\h\\.codex-w');
});

test('#5358 review 11: the shared helpers, and the Gemini/Grok/agy turn env, drop an account folder in any spelling', () => {
  const { envDelete, envSet } = require('./win32env');
  assert.deepEqual(envDelete({ Claude_Config_Dir: 'x', KEEP: '1' }, 'CLAUDE_CONFIG_DIR'), { KEEP: '1' });
  const one = envSet({ claude_config_dir: 'a', CLAUDE_CONFIG_DIR: 'b' }, 'CLAUDE_CONFIG_DIR', 'c');
  assert.deepEqual(one, { CLAUDE_CONFIG_DIR: 'c' }, 'one key, spelled as given');
  // A named Gemini account through childEnv keeps one key, and the agy per-turn env then drops the Claude folder.
  const gem = launcher.childEnv({ gemini_cli_home: 'C:\\old' }, 't', 'C:\\h\\.gemini-w', null, 'gemini');
  assert.deepEqual(keysOf(gem, 'GEMINI_CLI_HOME'), ['GEMINI_CLI_HOME'], 'one Gemini home key, spelled as later code reads it');
  assert.equal(gem.GEMINI_CLI_HOME, 'C:\\h\\.gemini-w');
  const turn = require('./win32agy').turnEnv({ Claude_Config_Dir: 'C:\\engine', PATH: 'x' });
  assert.deepEqual(keysOf(turn, 'CLAUDE_CONFIG_DIR'), [], 'the agy turn kept an oddly spelled Claude folder');
});

/* ---------- Windows only: the shells themselves ---------- */

const onWindows = process.platform === 'win32';
const onCi = process.env.GITHUB_ACTIONS === 'true';
const SYSROOT = process.env.SystemRoot || 'C:\\Windows';
const POWERSHELL = path.join(SYSROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const GIT_BASH = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find((p) => fs.existsSync(p));
const STUB = /KOSMOS-STUB \["--version"\]/;

/* A zip-shaped folder: bin\ with the real shims and a stub kosmos-cli.js, runtime\node.exe. */
function stageZip() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'k5358-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(root, 'runtime'));
  const repo = path.join(__dirname, '..');
  fs.copyFileSync(path.join(repo, 'tools', 'windows', 'kosmos.ps1'), path.join(bin, 'kosmos.ps1'));
  fs.writeFileSync(path.join(bin, 'kosmos'), fs.readFileSync(path.join(repo, 'tools', 'windows', 'kosmos.sh'), 'utf8').replace(/\r/g, ''));
  // The stub answers with its arguments, read the way kosmos-cli.js reads them (the ps1 shim sends a JSON file).
  fs.writeFileSync(path.join(bin, 'kosmos-cli.js'), [
    "const a = process.argv.slice(2);",
    "const i = a.indexOf('--kosmos-argv-file');",
    "const words = i === -1 ? a : JSON.parse(require('fs').readFileSync(a[i + 1], 'utf8'));",
    "console.log('KOSMOS-STUB ' + JSON.stringify(words));",
  ].join('\n'));
  try { fs.linkSync(process.execPath, path.join(root, 'runtime', 'node.exe')); }
  catch { fs.copyFileSync(process.execPath, path.join(root, 'runtime', 'node.exe')); }
  return { root, bin };
}

/* The runner's own environment with no policy variable in it, so every arm's policy is the one it states. And no
   PSModulePath: the CI step runs under PowerShell 7, whose module path, inherited, stops Windows PowerShell 5.1 loading
   Microsoft.PowerShell.Security (measured on the runner 10-06: Set-ExecutionPolicy "could not be loaded"). With none,
   5.1 uses its own default, which is what a board started by Explorer or its logon task passes on. NOT MODELLED: a
   board started from a PowerShell 7 terminal, which would pass pwsh 7's path to its agents (#5385). */
function baseEnv() {
  const env = { ...process.env };
  for (const k of [...keysOf(env, 'PSExecutionPolicyPreference'), ...keysOf(env, 'PSModulePath')]) delete env[k];
  return env;
}
const agentEnv = (bin, runner) => launcher.childEnv(baseEnv(), null, null, bin, runner);
const run = (cmd, args, env) => spawnSync(cmd, args, { env, encoding: 'utf8', timeout: 30000 });
const said = (r) => 'status ' + r.status + (r.error ? ' (' + (r.error.code || r.error.message) + ')' : '') + '\nstdout ' + r.stdout + '\nstderr ' + r.stderr;

test('#5358 Windows: in Git Bash run as Claude Code\'s Bash tool runs it (bash -c), a bare kosmos is found on the agent\'s PATH',
  // On the CI runner a missing Git Bash FAILS rather than skipping: a skip there would read as green with no evidence.
  { skip: !onWindows ? 'Windows only' : !GIT_BASH && !onCi ? 'no Git Bash on this machine' : false }, () => {
    assert.ok(GIT_BASH, 'no Git Bash on the CI runner, so this arm measured nothing');
    const z = stageZip();
    try {
      const r = run(GIT_BASH, ['-c', 'kosmos --version'], agentEnv(z.bin, 'claude'));
      // Two different reds: "command not found" is the PATH half; the shim's own cygpath line means it was found but
      // could not run (bash's PATH lacked Git's usr\bin).
      assert.match(String(r.stdout), STUB, (/cygpath/.test(String(r.stderr)) ? 'kosmos was FOUND but its shim could not run: ' : 'kosmos was not found or did not answer: ') + said(r));
      const none = run(GIT_BASH, ['-c', 'kosmos --version'], baseEnv());
      assert.doesNotMatch(String(none.stdout), STUB, 'control: kosmos was found without the agent\'s PATH');
    } finally { try { removeTree(z.root); } catch { /* a leftover temp folder must never hide the arm's own result */ } }
  });

test('#5358 Windows: under a Restricted policy, kosmos.ps1 is found on PATH and runs with Claude Code\'s flags; codex\'s PowerShell needs the agent\'s variable',
  // Its own timeout: several PowerShell starts, past the runner script's 60 s per test default.
  { timeout: 300000, skip: !onWindows ? 'Windows only' : !onCi ? 'changes the CurrentUser script policy, so only on GitHub Actions' : false }, () => {
    const z = stageZip();
    const ps = (env, command, flags = []) => run(POWERSHELL, ['-NoProfile', '-NonInteractive', ...flags, '-Command', command], env);
    // If this read fails, the restore writes Undefined (the policy a fresh GitHub runner has at this scope).
    const read = String(ps(baseEnv(), 'Get-ExecutionPolicy -Scope CurrentUser').stdout || '').trim();
    if (!read) process.stderr.write('#5358: could not read the CurrentUser policy; it will be restored as Undefined\n');
    const was = read || 'Undefined';
    let failed = null;
    try {
      const set = ps(baseEnv(), 'Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Restricted -Force');
      assert.equal(set.status, 0, 'could not set the CurrentUser policy: ' + set.stderr);
      assert.equal(String(ps(baseEnv(), 'Get-ExecutionPolicy').stdout || '').trim(), 'Restricted',
        'control: this runner\'s effective policy is not Restricted (a higher scope sets it), so no arm here can show a refusal');
      // Claude Code's PowerShell tool passes its own process-scope policy (#570's measurement, taken as a premise here):
      // this checks that PATH and the shim work under it, not the flag itself.
      const claude = ps(agentEnv(z.bin, 'claude'), 'kosmos --version', ['-ExecutionPolicy', 'Bypass']);
      assert.match(String(claude.stdout), STUB, 'Claude Code\'s PowerShell: ' + said(claude));
      // Codex's `powershell -Command`, without and with what childEnv gives a codex agent.
      const bare = { ...agentEnv(z.bin, 'codex') };
      for (const k of keysOf(bare, 'PSExecutionPolicyPreference')) delete bare[k];
      const refused = ps(bare, 'kosmos --version');
      assert.doesNotMatch(String(refused.stdout), STUB, 'control: a Restricted policy did not stop kosmos.ps1');
      // PowerShell's English wording: the runner is en-US.
      assert.match(String(refused.stderr) + String(refused.stdout), /scripts is disabled|UnauthorizedAccess|PSSecurityException/i, 'control: refused for another reason: ' + said(refused));
      const codex = agentEnv(z.bin, 'codex');
      assert.equal(codex.PSExecutionPolicyPreference, 'Bypass', 'the policy must come from childEnv (baseEnv carries none)');
      const ran = ps(codex, 'kosmos --version');
      assert.match(String(ran.stdout), STUB, 'codex\'s PowerShell with the agent\'s variable: ' + said(ran));
    } catch (e) { failed = e; throw e; } finally {
      const back = ps(baseEnv(), 'Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy ' + (/^[A-Za-z]+$/.test(was) ? was : 'Undefined') + ' -Force');
      try { removeTree(z.root); } catch { /* a leftover temp folder must never hide the policy check below */ }
      // A policy left Restricted would turn later Windows tests red for no reason of their own: say so loudly, and fail
      // here unless this arm already failed (its own reason comes first).
      if (back.status !== 0) {
        process.stderr.write('#5358: COULD NOT RESTORE the CurrentUser script policy to ' + was + '; later reds in this job may be this.\n' + said(back) + '\n');
        if (!failed) assert.fail('could not restore the CurrentUser script policy: ' + said(back));
      }
    }
  });
