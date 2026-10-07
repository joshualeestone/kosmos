'use strict';
/**
 * #5406 Part 1 (Josh, 2026-10-07): a Kosmos-launched Claude agent does not stop on a permission prompt the person's own
 * ask rules raise. Kosmos passes its own settings file (one PermissionRequest hook answering allow) with --settings, on
 * macOS and Linux (bin/agent-supervisor.sh) and Windows (win32launch); the person's ~/.claude/settings.json is never
 * written. The live measurement (arm B: the ask rule alone stops `rm`; arm G: with this file it runs; arm H: a deny
 * rule still blocks) is the last test here, opt-in because it needs a signed-in Claude Code.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-perm5406-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));

const ap = require('./agentpermission');
const hook = require('./kosmos-permission-allow');
const win32launch = require('./win32launch');

const req = (tool) => JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: {} });

test('#5406 the hook allows a tool\'s permission prompt', () => {
  assert.deepEqual(hook.decide(req('Bash')), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  assert.deepEqual(hook.decide(req('Write')).hookSpecificOutput.decision, { behavior: 'allow' });
});

test('#5406 the hook stays silent for a question to the person and for anything it cannot read', () => {
  assert.equal(hook.decide(req('AskUserQuestion')), null, 'allowing a question would answer it with nothing');
  assert.equal(hook.decide('not json'), null);
  assert.equal(hook.decide(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash' })), null, 'another event');
  assert.equal(hook.decide(JSON.stringify({ hook_event_name: 'PermissionRequest' })), null, 'no tool name');
});

test('#5406 the hook stays silent for a protected place (.claude, .claude.json, .git), and only there', () => {
  const r = (tool, input) => hook.decide(JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: input }));
  for (const [tool, input] of [['Write', { file_path: '/p/.claude/settings.json' }], ['Edit', { file_path: '/Users/x/.claude.json' }],
    ['Bash', { command: 'cat x > .git/hooks/pre-commit' }], ['Bash', { command: 'echo y >> ~/.claude/settings.json' }],
    ['NotebookEdit', { notebook_path: '/p/.claude/n.ipynb' }],
    ['Write', { file_path: 'C:\\proj\\.claude\\settings.json' }], ['Edit', { file_path: 'C:\\proj\\.git\\config' }],
    ['Write', { file_path: '/p/.CLAUDE/settings.json' }], ['Bash', { command: 'cat>.git/hooks/x' }],
    ['Bash', { command: 'ls .claude;echo' }], ['Bash', { command: 'cd .git&&ls' }],
    ['Bash', { command: 'cat ~/.claude-acct/settings.json > x' }], ['Write', { file_path: '/Users/x/.claude-work/settings.json' }],
    ['MultiEdit', { edits: [{ file_path: '/p/.claude/settings.json' }] }]]) {
    assert.equal(r(tool, input), null, tool + ' ' + JSON.stringify(input));
  }
  // CONTROL: names that only contain the words are not protected places.
  for (const [tool, input] of [['Bash', { command: 'rm photo.jpg' }], ['Write', { file_path: '/p/claude-notes.md' }],
    ['Bash', { command: 'git status' }], ['Write', { file_path: '/p/my.github/x' }], ['ExitPlanMode', {}],
    ['Bash', { command: 'ls .github' }], ['Write', { file_path: '/p/repo.git/readme' }], ['Write', { file_path: '/p/my.claude-notes' }]]) {
    assert.ok(r(tool, input), tool + ' ' + JSON.stringify(input));
  }
});

test('#5406 the hook script itself answers on stdout and always exits 0', () => {
  const run = (input) => spawnSync(process.execPath, [ap.HOOK_SCRIPT], { input, encoding: 'utf8', timeout: 20000 });
  const yes = run(req('Bash'));
  assert.equal(yes.status, 0);
  assert.equal(JSON.parse(yes.stdout).hookSpecificOutput.decision.behavior, 'allow');
  const quiet = run(req('AskUserQuestion'));
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, '', 'CONTROL: silent for a question');
  const junk = run('{');
  assert.equal(junk.status, 0);
  assert.equal(junk.stdout, '');
});

test('#5406 the settings file holds one PermissionRequest hook and nothing else, per platform', () => {
  const mac = JSON.parse(ap.settingsText({ platform: 'darwin', node: '/opt/kosmos/node', script: '/opt/kosmos/engine/kosmos-permission-allow.js' }));
  assert.deepEqual(Object.keys(mac), ['hooks']);
  assert.deepEqual(Object.keys(mac.hooks), ['PermissionRequest'], 'no permission rules, no other hooks');
  assert.equal(mac.hooks.PermissionRequest[0].hooks[0].command, '"/opt/kosmos/node" "/opt/kosmos/engine/kosmos-permission-allow.js"');
  const win = JSON.parse(ap.settingsText({ platform: 'win32', node: 'C:\\Kosmos\\node.exe', script: 'C:\\Kosmos\\engine\\kosmos-permission-allow.js' }));
  const h = win.hooks.PermissionRequest[0].hooks[0];
  assert.equal(h.command, 'C:\\Kosmos\\node.exe', 'Windows: the exec form, no shell (as the report hook, #570)');
  assert.deepEqual(h.args, ['C:\\Kosmos\\engine\\kosmos-permission-allow.js']);
  assert.equal(ap.settingsText({ platform: 'darwin', node: '/odd"path/node' }), null, 'a path that cannot ride in a command: no file');
});

test('#5406 ensureSettings writes the file under Kosmos\'s own data folder, once, and never the person\'s settings', () => {
  const p = ap.ensureSettings();
  assert.ok(p && p.startsWith(SB), 'inside the sandboxed data root: ' + p);
  assert.notEqual(path.basename(p), 'settings.json', 'not a Claude settings.json of the person\'s');
  const first = fs.statSync(p).mtimeMs;
  assert.equal(ap.ensureSettings(), p);
  assert.equal(fs.statSync(p).mtimeMs, first, 'unchanged content is not rewritten');
  if (process.platform !== 'win32') assert.equal((fs.statSync(p).mode & 0o777).toString(8), '600');   // Windows has no POSIX modes
  assert.equal(ap.ensureSettings({ platform: 'darwin', node: '/odd"path/node' }), null, 'refused paths: none (the agent launches as before)');
});

test('#5406 Windows launches a Claude agent with --settings, and no other runner', () => {
  const prepared = { launchArgs: ['--session-id', 'x'] };
  const c = win32launch.argvFor(prepared, { runner: 'claude', mcpConfig: 'browser.json', permissionSettings: 'C:\\K\\perm.json' });
  assert.equal(c[c.indexOf('--settings') + 1], 'C:\\K\\perm.json');
  assert.ok(c.indexOf('--settings') > c.indexOf('--mcp-config') + 1, 'after the browser config, which a flag ends');
  assert.ok(!win32launch.argvFor(prepared, { runner: 'codex', permissionSettings: 'x.json' }).includes('--settings'), 'CONTROL: codex');
  assert.ok(!win32launch.argvFor(prepared, { runner: 'claude' }).includes('--settings'), 'CONTROL: none asked, none passed');
  const s = win32launch.streamArgvFor(prepared, { runner: 'claude', permissionSettings: 'p.json' });
  assert.equal(s[s.indexOf('--settings') + 1], 'p.json', 'the streaming launch too');
});

test('#5406 the macOS and Linux supervisor passes --settings from the shim, before the autonomy flag', () => {
  const sup = fs.readFileSync(path.join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  assert.match(sup, /"\$NODE_BIN" "\$_eng\/agent-permission-config\.js"/);
  assert.match(sup, /case "\$_perm" in \/\*\) if \[ -f "\$_perm" \]; then PERM_ARGS=\(--settings "\$_perm"\)/, 'absolute and existing only');
  // The Claude arm's two launches (with and without a model) are the ones that carry the agent browser's MCP_ARGS.
  const launches = sup.split('\n').filter((l) => /launch_pane "\$CLAUDE"/.test(l) && /MCP_ARGS/.test(l));
  assert.equal(launches.length, 2);
  for (const l of launches) assert.ok(l.indexOf('PERM_ARGS') > 0 && l.indexOf('PERM_ARGS') < l.indexOf('--dangerously-skip-permissions'), l);
  const out = spawnSync(process.execPath, [path.join(__dirname, 'agent-permission-config.js')], { encoding: 'utf8', env: process.env });
  assert.equal(out.status, 0);
  assert.ok(fs.existsSync(out.stdout.trim()), 'the shim printed a file that exists: ' + out.stdout);
});

/* The proof Josh asked for (arm B): an ask rule `Bash(rm *)` stops the rm; with Kosmos's file the agent runs it with no
   prompt; a deny rule still blocks. Needs a signed-in Claude Code and spends a few requests: KOSMOS_LIVE_CLAUDE=1. */
test('#5406 LIVE: an ask rule no longer stops a Kosmos agent; a deny rule still does', { skip: process.env.KOSMOS_LIVE_CLAUDE !== '1' && 'set KOSMOS_LIVE_CLAUDE=1 to run against a signed-in Claude Code' }, () => {
  const settings = ap.ensureSettings();
  const ask = '{"permissions":{"ask":["Bash(rm *)"]}}';
  const deny = '{"permissions":{"deny":["Bash(rm *)"]}}';
  const arm = (rules, withKosmos) => {
    const dir = fs.mkdtempSync(path.join(SB, 'arm-'));
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), rules);
    fs.writeFileSync(path.join(dir, 'photo.jpg'), 'jpg');
    const args = ['-p', 'Run exactly this one shell command with the Bash tool: rm photo.jpg', '--dangerously-skip-permissions',
      '--setting-sources', 'project,local', ...(withKosmos ? ['--settings', settings] : [])];
    spawnSync('claude', args, { cwd: dir, encoding: 'utf8', timeout: 180000, input: '' });
    return fs.existsSync(path.join(dir, 'photo.jpg'));
  };
  assert.equal(arm(ask, false), true, 'arm B (CONTROL): the ask rule alone stops the rm');
  assert.equal(arm(ask, true), false, 'arm G: with Kosmos\'s settings the rm runs, no prompt');
  assert.equal(arm(deny, true), true, 'arm H: a deny rule still blocks');
});
