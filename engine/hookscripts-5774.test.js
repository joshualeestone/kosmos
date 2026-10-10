'use strict';
require('../test-support/tmpscope');   // first: every mkdtemp in this file lands in a per-process dir removed on exit (#4273)

/*
 * #5774 part 1: the token-only guard denies the scripts that Claude Code's start-time commands run outside the sandbox
 * (hooks, the status line, auth helpers, servers' program files, installed plugins' folders), wherever they sit. The
 * config itself is #5516 part 2. These tests assert the CONFIG WRITTEN, as the #4491 and #5516 tests do.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'hookscripts-5774-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });

const setup = require('./setup-assistant');
const store = require('./store');
const sc = require('./startcommands');

fs.mkdirSync(store.ROOT, { recursive: true });
const HOME = process.env.AGENT_WORKFORCE_HOME;
const MANAGED = path.join(SANDBOX, 'managed');
// The launch-PATH part is pinned empty, as in configstart-5516.test.js, so this host's PATH is not read.
const LAUNCH_PIN = { panePath: path.join(SANDBOX, 'no-launch-path'), ownPath: '', launchFixed: [], ownProgramDirs: [], launchFiles: [], launchConfigDirs: [], launchTemps: [], launchRunProgs: [] };
const DEPS = { platform: 'darwin', dataRoot: store.ROOT, home: HOME, runner: 'claude', runnerOf: () => 'claude', workersRoot: path.join(SANDBOX, 'workers'), managedDir: MANAGED, managedPrefsDir: null, ...LAUNCH_PIN };   // review 19: no real managed preferences read in tests

function agentDir(name) { const d = path.join(SANDBOX, 'workers', name); fs.mkdirSync(d, { recursive: true }); return d; }
function readSettings(dir) { return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')); }
function writeJson(file, j) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(j, null, 2)); }
function touch(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '#!/bin/sh\n'); }
/* Whether ANY Edit rule in a deny list covers path p, by Claude Code's rule shape (copied from configstart-5516.test.js,
   review 9 there: a control that looks for one literal rule cannot see a glob that denies the same path). */
function editDeniedBy(deny, p) {
  const abs = path.resolve(p);
  return deny.filter((r) => {
    const m = /^Edit\((.*)\)$/.exec(r);
    if (!m) return false;
    const pat = m[1].replace(/^\/\//, '/');
    const re = '^' + pat.split(/(\*\*|\*)/).map((t) => (t === '**' ? '.*' : t === '*' ? '[^/]*' : t.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('') + '(/.*)?$';
    return new RegExp(re).test(abs);
  });
}
function realOrLeaf(p) {
  const abs = path.resolve(p); let dir = path.dirname(abs); const tail = [path.basename(abs)];
  for (;;) {
    try { return path.join(fs.realpathSync.native(dir), ...tail); } catch { /* climb */ }
    const parent = path.dirname(dir); if (parent === dir) return abs;
    tail.unshift(path.basename(dir)); dir = parent;
  }
}
/* Whether the sandbox's denyWrite covers p (a listed path, or a folder above it). */
function sandboxDenies(dw, p) { const r = realOrLeaf(p); return dw.some((d) => r === d || r.startsWith(d + path.sep)); }

fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.mkdirSync(path.join(HOME, '.claude-acct'), { recursive: true });

test('#5774: every start-time command tier has its script denied in both layers, wherever the script sits', () => {
  const dir = agentDir('pilot-cmds');
  const S = (n) => path.join(SANDBOX, 'scripts', n);
  for (const n of ['hook.sh', 'status.sh', 'key.sh', 'server.js', 'mine.js', 'above.js', 'managed.sh', 'managedd.sh', 'mmcp.js', 'remote.sh', 'local.sh', 'plugin-out.sh', 'inline.py']) touch(S(n));
  touch(path.join(dir, 'tools', 'proj.sh'));
  touch(path.join(HOME, 'bin', 'tilde.sh'));
  // User tier, both config homes; a status line; an auth helper; a hook given inline to bash -c.
  writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `bash "${S('hook.sh')}"` }, { type: 'command', command: `bash -c "python3 ${S('inline.py')}"` }] }] }, apiKeyHelper: S('key.sh') });
  writeJson(path.join(HOME, '.claude-acct', 'settings.json'), { statusLine: { type: 'command', command: `bash ${S('status.sh')}` }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash ~/bin/tilde.sh' }] }] } });
  writeJson(path.join(HOME, '.claude-acct', 'settings.local.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: S('local.sh') }] }] } });
  writeJson(path.join(HOME, '.claude-acct', 'remote-settings.json'), { otelHeadersHelper: S('remote.sh') });
  // Project tier: the agent folder's own settings (a relative script, by its variable) and a folder above it.
  writeJson(path.join(dir, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/tools/proj.sh' }] }] } });
  writeJson(path.join(SANDBOX, '.mcp.json'), { mcpServers: { above: { command: 'node', args: [S('above.js')] } } });
  // Servers: the global config's own, and its entry for this agent folder.
  writeJson(path.join(HOME, '.claude.json'), { mcpServers: { s: { command: 'node', args: [S('server.js')] } }, projects: { [dir]: { mcpServers: { m: { command: 'node', args: [S('mine.js')] } } } } });
  // Managed tier, and its drop-in folder.
  writeJson(path.join(MANAGED, 'managed-settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: S('managed.sh') }] }] } });
  writeJson(path.join(MANAGED, 'managed-settings.d', '10-x.json'), { proxyAuthHelper: S('managedd.sh') });
  writeJson(path.join(MANAGED, 'managed-mcp.json'), { mcpServers: { mm: { command: 'node', args: [S('mmcp.js')] } } });
  // An installed plugin whose folder sits outside every config home, with a hook naming a script outside it too.
  const plug = path.join(SANDBOX, 'my-plugins', 'p1');
  writeJson(path.join(plug, 'hooks', 'hooks.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `\${CLAUDE_PLUGIN_ROOT}/run.sh && ${S('plugin-out.sh')}` }] }] } });
  writeJson(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'p1@local': [{ scope: 'user', installPath: plug }] } });
  try {
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-cmds', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.equal(g.warning, undefined);
    const s = readSettings(dir);
    const deny = s.permissions.deny;
    const dw = s.sandbox.filesystem.denyWrite;
    const want = [S('hook.sh'), S('inline.py'), S('key.sh'), S('status.sh'), path.join(HOME, 'bin', 'tilde.sh'), S('local.sh'), S('remote.sh'), path.join(dir, 'tools', 'proj.sh'), S('above.js'), S('server.js'), S('mine.js'), S('managed.sh'), S('managedd.sh'), S('mmcp.js'), S('plugin-out.sh'), path.join(plug, 'run.sh')];
    for (const p of want) {
      assert.ok(editDeniedBy(deny, p).length > 0, `file tools must be denied ${p}`);
      assert.ok(sandboxDenies(dw, p), `the sandbox must deny writes to ${p}`);
    }
    // The plugin's folder is denied whole (its own code runs), so its run.sh needs no rule of its own.
    assert.ok(deny.includes(`Edit(//${plug.replace(/^\/+/, '')}/**)`), 'an installed plugin outside the config homes is denied whole');
    assert.ok(!deny.includes(`Edit(//${path.join(plug, 'run.sh').replace(/^\/+/, '')})`), 'review 9: a script inside it needs no rule of its own (profile size)');
  } finally {
    for (const f of [path.join(HOME, '.claude', 'settings.json'), path.join(HOME, '.claude-acct', 'settings.json'), path.join(HOME, '.claude-acct', 'settings.local.json'), path.join(HOME, '.claude-acct', 'remote-settings.json'), path.join(SANDBOX, '.mcp.json'), path.join(HOME, '.claude.json'), path.join(HOME, '.claude', 'plugins', 'installed_plugins.json')]) fs.rmSync(f, { force: true });
    fs.rmSync(MANAGED, { recursive: true, force: true });
  }
});

test('#5774: controls: what a command writes, another folder\'s servers, a URL and the agent\'s own files stay open', () => {
  const dir = agentDir('pilot-ctl');
  const other = path.join(SANDBOX, 'elsewhere');
  touch(path.join(SANDBOX, 'scripts', 'other.js'));
  touch(path.join(SANDBOX, 'scripts', 'ok.sh'));
  fs.writeFileSync(path.join(dir, 'notes.md'), 'mine\n');
  writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `bash ${path.join(SANDBOX, 'scripts', 'ok.sh')} >> "$CLAUDE_PROJECT_DIR/notes.md" 2>&1; curl -s https://example.invalid/a/b` }] }] } });
  writeJson(path.join(HOME, '.claude.json'), { projects: { [other]: { mcpServers: { o: { command: 'node', args: [path.join(SANDBOX, 'scripts', 'other.js')] } } } } });
  try {
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-ctl', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    const s = readSettings(dir);
    const deny = s.permissions.deny;
    const dw = s.sandbox.filesystem.denyWrite;
    // The control that it CAN deny, in this same run: the script the same hook runs.
    assert.ok(editDeniedBy(deny, path.join(SANDBOX, 'scripts', 'ok.sh')).length > 0, 'the hook\'s script is denied');
    assert.deepEqual(editDeniedBy(deny, path.join(dir, 'notes.md')), [], 'a redirection target is written by the hook, not run: the agent keeps its own file');
    assert.ok(!sandboxDenies(dw, path.join(dir, 'notes.md')), 'nor in the sandbox');
    assert.deepEqual(editDeniedBy(deny, path.join(SANDBOX, 'scripts', 'other.js')), [], 'a server registered for another folder does not start for this agent');
    assert.ok(!deny.some((r) => r.includes('example.invalid')), 'a URL is not a file');
  } finally {
    fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true });
    fs.rmSync(path.join(HOME, '.claude.json'), { force: true });
  }
});

test('#5774: a script path built when the command runs cannot be read, so the guard says it is not whole and names it', () => {
  const dir = agentDir('pilot-dyn');
  writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash "$(dirname "$0")/later.sh"' }] }] } });
  try {
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-dyn', DEPS);
    assert.equal(g.ok, false, JSON.stringify(g));
    assert.match(String(g.because), /later\.sh/);
    assert.match(String(g.because), /cannot read/);
  } finally { fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true }); }
  // Control: the same hook with a known variable is read, and the guard is whole.
  writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash "$HOME/later.sh"' }] }] } });
  try {
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-dyn', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.ok(editDeniedBy(readSettings(dir).permissions.deny, path.join(HOME, 'later.sh')).length > 0);
  } finally { fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true }); }
});

test('#5774: a linked script has its target denied too; an uncarriable path is named where it runs, or when it exists', () => {
  const dir = agentDir('pilot-link');
  const real = path.join(SANDBOX, 'real-scripts', 'target.sh');
  touch(real);
  const link = path.join(SANDBOX, 'scripts', 'linked.sh');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.rmSync(link, { force: true });
  fs.symlinkSync(real, link);
  const odd = path.join(SANDBOX, 'odd (dir)', 'x.sh');
  const oddArg = path.join(SANDBOX, 'odd (arg)', 'data.txt');
  try {
    // A sed expression and a file an argument names, with pattern characters and nothing there: skipped, so whole.
    writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `bash ${link}; sed 's/(a)/b/' f; cat "${oddArg}"` }] }] } });
    let g = setup.guardTokenOnlyFolder(dir, 'pilot-link', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    const deny = readSettings(dir).permissions.deny;
    assert.ok(editDeniedBy(deny, link).length > 0, 'the link by its own name');
    assert.ok(editDeniedBy(deny, fs.realpathSync.native(real)).length > 0, 'and the file it points at, by its real path');
    // Review 3: the same characters where a script RUNS, though not there yet: named, not whole (the agent could create it).
    writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `bash "${odd}"` }] }] } });
    g = setup.guardTokenOnlyFolder(dir, 'pilot-link', DEPS);
    assert.equal(g.ok, false, JSON.stringify(g));
    assert.match(String(g.because), /odd \(dir\)/);
    // And an argument's file once it exists: named too.
    writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `cat "${oddArg}"` }] }] } });
    touch(oddArg);
    g = setup.guardTokenOnlyFolder(dir, 'pilot-link', DEPS);
    assert.equal(g.ok, false, JSON.stringify(g));
    assert.match(String(g.because), /odd \(arg\)/);
  } finally { fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true }); }
});

test('#5774: the command splitter: quotes, variables, substitutions, redirections and the program word', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  assert.deepEqual(paths('bash ~/.x/s.sh').paths, ['/H/.x/s.sh']);
  assert.deepEqual(paths('"${HOME}/a b.sh" --flag').paths, ['/H/a b.sh']);
  assert.deepEqual(paths("echo '$HOME/not' | /opt/t.sh").paths, ['/opt/t.sh']);   // single quotes keep $ literal; an argument in the agent folder is its work
  // Review 2: a wrapper or keyword before the program, a runner's subcommand, a descriptor before a redirection.
  for (const c of ['env X=1 bash run.sh', 'nohup bash run.sh', 'sudo -u bob bash run.sh', 'if true; then bash run.sh; fi', '{ bash run.sh; }', '2>/dev/null bash run.sh', 'bash \\\n run.sh']) assert.deepEqual(paths(c).paths, ['/A/run.sh'], c);
  assert.deepEqual(paths('timeout -s KILL 5 node t.js').paths, ['/A/t.js']);
  assert.deepEqual(paths('deno run s.ts').paths, ['/A/s.ts']);
  assert.deepEqual(paths('uv pip install x').paths, []);
  assert.deepEqual(paths('echo hi &> /o.log; echo >| /c.sh; bash <<EOF').paths, []);   // written targets, and a delimiter is not bash's script
  assert.equal(paths('bash /h/*.sh').unsafe.length, 1);   // a pattern where a script is named
  assert.deepEqual(paths('rm /tmp/*.log').unsafe, []);   // a pattern an argument names is not run
  assert.deepEqual(paths('node --require=/r.js main.js').paths, ['/r.js', '/A/main.js']);   // review 1: an interpreter's script counts before it exists
  assert.deepEqual(paths('FOO=1 ./run.sh').paths, ['/A/run.sh']);
  assert.deepEqual(paths('bash /a.sh > /out.log 2>/dev/null').paths, ['/a.sh']);
  assert.deepEqual(paths('bash < /in.sh').paths, ['/in.sh']);   // input to a shell IS what it runs
  assert.deepEqual(paths('jq . | grep x').paths, []);   // bare programs are PATH's (#5516 part 1)
  assert.deepEqual(paths('$(dirname $0)/x.sh').unsafe.length, 1);
  assert.deepEqual(paths('`pwd`/x.sh').unsafe.length, 1);
  assert.deepEqual(paths('echo $1 $UNKNOWN').unsafe, []);   // a variable with no slash names no path
  // A server's args are literal words, no shell: a space stays inside one argument.
  const cmds = sc.commandsIn({ mcpServers: { a: { command: '/srv/a', args: ['--x', '/srv/b c.js'] }, b: { command: '/My Dir/srv' } }, apiKeyHelper: '/k.sh', foo: { command: 'x' } });
  assert.equal(cmds.length, 4);
  assert.deepEqual(cmds[1], { program: '/My Dir/srv', args: [], server: true }, 'review 2: a server is started directly, so its command is one word even with no args');
});

test('#5774 review 1: a folder a command names is never denied (cd into the agent folder, a search of the home or the root)', () => {
  const dir = agentDir('pilot-cd');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'mine\n');
  fs.mkdirSync(path.join(HOME, 'work'), { recursive: true });
  touch(path.join(SANDBOX, 'scripts', 'lint.sh'));
  writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `cd "$CLAUDE_PROJECT_DIR" && ls; rg TODO ~/work; find / -name foo; cd ~; bash ${path.join(SANDBOX, 'scripts', 'lint.sh')}` }] }] } });
  try {
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-cd', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    const s = readSettings(dir);
    const deny = s.permissions.deny;
    const dw = s.sandbox.filesystem.denyWrite;
    assert.ok(editDeniedBy(deny, path.join(SANDBOX, 'scripts', 'lint.sh')).length > 0, 'control: the same hook\'s script is denied');
    for (const p of [path.join(dir, 'notes.md'), path.join(HOME, 'work', 'x.md'), path.join(HOME, 'y.md')]) {
      assert.deepEqual(editDeniedBy(deny, p), [], `${p} stays writable to the file tools`);
      assert.ok(!sandboxDenies(dw, p), `${p} stays writable to the shell`);
    }
    assert.ok(!dw.includes('/'), 'the root is never in denyWrite');
  } finally { fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true }); }
});

test('#5774 review 1: an interpreter\'s script is denied even before it exists; an inline assignment\'s file is read', () => {
  const dir = agentDir('pilot-slot');
  writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `cd "$CLAUDE_PROJECT_DIR" && bash check.sh; BASH_ENV=${path.join(SANDBOX, 'benv.sh')} bash -c true` }] }] } });
  try {
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-slot', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    const s = readSettings(dir);
    assert.ok(!fs.existsSync(path.join(dir, 'check.sh')), 'precondition: the script does not exist yet');
    assert.ok(editDeniedBy(s.permissions.deny, path.join(dir, 'check.sh')).length > 0, 'the agent cannot create the script the hook runs');
    assert.ok(sandboxDenies(s.sandbox.filesystem.denyWrite, path.join(dir, 'check.sh')), 'nor from its shell');
    assert.ok(editDeniedBy(s.permissions.deny, path.join(SANDBOX, 'benv.sh')).length > 0, 'BASH_ENV=<file> runs that file');
  } finally { fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true }); }
});

test('#5774 review 1: a script named by a variable is read from the settings env when every tier agrees, and is a gap when not', () => {
  const dir = agentDir('pilot-env');
  const hook = path.join(SANDBOX, 'scripts', 'env-hook.sh');
  touch(hook);
  const hooks = { Stop: [{ hooks: [{ type: 'command', command: 'bash "$MY_HOOK"' }] }] };
  try {
    writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks });
    let g = setup.guardTokenOnlyFolder(dir, 'pilot-env', DEPS);
    assert.equal(g.ok, false, 'unknown variable as the script: not whole');
    assert.match(String(g.because), /cannot read/);
    writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks, env: { MY_HOOK: hook } });
    g = setup.guardTokenOnlyFolder(dir, 'pilot-env', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.ok(editDeniedBy(readSettings(dir).permissions.deny, hook).length > 0, 'read through the settings env');
    writeJson(path.join(HOME, '.claude-acct', 'settings.json'), { env: { MY_HOOK: '/elsewhere.sh' } });
    g = setup.guardTokenOnlyFolder(dir, 'pilot-env', DEPS);
    assert.equal(g.ok, false, 'two tiers disagree: Kosmos cannot tell which applies');
  } finally {
    fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true });
    fs.rmSync(path.join(HOME, '.claude-acct', 'settings.json'), { force: true });
  }
});

test('#5774 review 1: a plugin\'s manifest can point at its own hook file; its data folder is a known place', () => {
  const dir = agentDir('pilot-plug');
  const plug = path.join(SANDBOX, 'my-plugins', 'p2');
  const out = path.join(SANDBOX, 'scripts', 'from-manifest.sh');
  touch(out);
  writeJson(path.join(plug, '.claude-plugin', 'plugin.json'), { name: 'p2', hooks: './custom/h.json' });
  writeJson(path.join(plug, 'custom', 'h.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `bash ${out}; \${CLAUDE_PLUGIN_DATA}/venv/bin/python \${CLAUDE_PLUGIN_ROOT}/x.py` }] }] } });
  writeJson(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'p2@local': [{ scope: 'user', installPath: plug }] } });
  try {
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-plug', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.ok(editDeniedBy(readSettings(dir).permissions.deny, out).length > 0, 'a hook file the manifest names is read');
  } finally { fs.rmSync(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { force: true }); }
});

test('#5774 review 1: control: with no config naming them, the same scripts are not denied', () => {
  const dir = agentDir('pilot-none');
  const S = (n) => path.join(SANDBOX, 'scripts', n);
  for (const n of ['hook.sh', 'status.sh', 'server.js', 'lint.sh', 'env-hook.sh']) touch(S(n));   // review 2: made here, so the control holds run alone
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-none', DEPS);
  assert.equal(g.ok, true, JSON.stringify(g));
  const s = readSettings(dir);
  for (const n of ['hook.sh', 'status.sh', 'server.js', 'lint.sh', 'env-hook.sh']) {
    assert.deepEqual(editDeniedBy(s.permissions.deny, S(n)), [], `${n} is denied only because a command names it`);
    assert.ok(!sandboxDenies(s.sandbox.filesystem.denyWrite, S(n)));
  }
});

test('#5774 review 1: a scan that throws leaves the rest of the guard written and says it is not whole', () => {
  const dir = agentDir('pilot-throw');
  const real = sc.startCommandScripts;
  sc.startCommandScripts = () => { throw new Error('boom'); };
  try {
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-throw', DEPS);
    assert.equal(g.ok, false, JSON.stringify(g));
    assert.match(String(g.because), /boom/);
    assert.ok(readSettings(dir).permissions.deny.length > 0, 'the rest of the guard is written');
  } finally { sc.startCommandScripts = real; }
});

test('#5774 review 2: the agent\'s own files a command only reads or writes stay its own', () => {
  const dir = agentDir('pilot-data');
  for (const f of ['package.json', path.join('log', 'hook.log')]) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), '{}\n'); }
  touch(path.join(dir, 'tools', 'run.sh'));
  writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'jq . package.json | tee log/hook.log; jq . "$CLAUDE_PROJECT_DIR/package.json"; nohup bash "$CLAUDE_PROJECT_DIR"/tools/run.sh' }] }] } });
  try {
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-data', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    const s = readSettings(dir);
    assert.ok(editDeniedBy(s.permissions.deny, path.join(dir, 'tools', 'run.sh')).length > 0, 'control: the script the same hook runs is denied');
    for (const f of ['package.json', path.join('log', 'hook.log')]) {
      assert.deepEqual(editDeniedBy(s.permissions.deny, path.join(dir, f)), [], `${f} is read or written by the hook, not run`);
      assert.ok(!sandboxDenies(s.sandbox.filesystem.denyWrite, path.join(dir, f)));
    }
  } finally { fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true }); }
});

test('#5774 review 2: a server command with a space is one program; a script pattern and an unreadable config are named', () => {
  const dir = agentDir('pilot-srv');
  const srv = path.join(SANDBOX, 'My Servers', 'srv');
  touch(srv);
  writeJson(path.join(HOME, '.claude.json'), { mcpServers: { s: { command: srv } } });
  try {
    let g = setup.guardTokenOnlyFolder(dir, 'pilot-srv', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.ok(editDeniedBy(readSettings(dir).permissions.deny, srv).length > 0, 'the server program, space and all');
    writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `bash ${path.join(SANDBOX, 'scripts')}/*.sh` }] }] } });
    g = setup.guardTokenOnlyFolder(dir, 'pilot-srv', DEPS);
    assert.equal(g.ok, false, 'a pattern where a script is named is not expanded, so not whole');
    assert.match(String(g.because), /pattern/);
    fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), '{ "hooks": ');
    g = setup.guardTokenOnlyFolder(dir, 'pilot-srv', DEPS);
    assert.equal(g.ok, false, 'a settings file that cannot be read: its commands are unknown');
    assert.match(String(g.because), /could not be read/);
    fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true });
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{ "hooks": ');
    g = setup.guardTokenOnlyFolder(dir, 'pilot-srv', DEPS);
    assert.equal(g.ok, true, 'the agent folder\'s own settings are rewritten by the guard, so their old text never loads');
  } finally {
    fs.rmSync(path.join(HOME, '.claude.json'), { force: true });
    fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true });
  }
});

test('#5774 review 2: a plugin whose folder is the agent folder, or not a full path, is named and never denied whole', () => {
  const dir = agentDir('pilot-plugdir');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'mine\n');
  try {
    writeJson(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'odd@x': [{ scope: 'project', installPath: dir }] } });
    let g = setup.guardTokenOnlyFolder(dir, 'pilot-plugdir', DEPS);
    assert.equal(g.ok, false, JSON.stringify(g));
    assert.match(String(g.because), /odd@x/);
    const s = readSettings(dir);
    assert.deepEqual(editDeniedBy(s.permissions.deny, path.join(dir, 'notes.md')), [], 'the agent keeps its own folder');
    assert.ok(!sandboxDenies(s.sandbox.filesystem.denyWrite, path.join(dir, 'notes.md')));
    writeJson(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'rel@x': [{ scope: 'user', installPath: 'plugins/rel' }] } });
    g = setup.guardTokenOnlyFolder(dir, 'pilot-plugdir', DEPS);
    assert.equal(g.ok, false, JSON.stringify(g));
    assert.match(String(g.because), /rel@x/);
  } finally { fs.rmSync(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { force: true }); }
});

test('#5774 review 3: the test command is not a pattern; script flags; managed preferences; a plugin folder that resolves to the agent folder or is a config home', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  assert.deepEqual(paths('[ -f "$CLAUDE_PROJECT_DIR/x" ] && bash run.sh'), { paths: ['/A/run.sh'], runPaths: ['/A/run.sh'], codePaths: ['/A/run.sh'], unsafe: [] });
  assert.deepEqual(paths('[[ -n $FOO ]] && echo hi').unsafe, []);
  assert.deepEqual(paths('java -jar tools/hook.jar').runPaths, ['/A/tools/hook.jar']);
  assert.deepEqual(paths('awk -f tools/x.awk in.txt').runPaths, ['/A/tools/x.awk']);
  assert.deepEqual(paths('bash -p run.sh').runPaths, ['/A/run.sh']);   // -p is not an inline flag for a shell
  assert.deepEqual(paths('bash "tools (v2)/run.sh"').runPaths, ['/A/tools (v2)/run.sh']);   // a quoted word is the path itself, brackets and all
  assert.deepEqual(paths('curl --header="$H" x').unsafe, []);
  assert.equal(paths('node --require="$X"/y.js s.js').unsafe.length, 1);
  const dir = agentDir('pilot-r3');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'mine\n');
  const hook = path.join(SANDBOX, 'scripts', 'r3.sh');
  touch(hook);
  const prefs = path.join(SANDBOX, 'prefs');
  fs.mkdirSync(prefs, { recursive: true });
  const plist = path.join(prefs, 'com.anthropic.claudecode.plist');
  writeJson(plist + '.json', { hooks: { Stop: [{ hooks: [{ type: 'command', command: `[ -f x ] && bash ${hook}` }] }] } });
  require('child_process').execFileSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', plist, plist + '.json']);
  const D = { ...DEPS, managedPrefsDir: prefs };
  const linkToAgent = path.join(SANDBOX, 'plugin-link-to-agent');
  fs.rmSync(linkToAgent, { force: true });
  fs.symlinkSync(dir, linkToAgent);
  try {
    let g = setup.guardTokenOnlyFolder(dir, 'pilot-r3', D);
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.ok(editDeniedBy(readSettings(dir).permissions.deny, hook).length > 0, 'a hook in the managed preferences is read');
    for (const installPath of [linkToAgent, path.join(HOME, '.claude-acct')]) {
      writeJson(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'bad@x': [{ scope: 'user', installPath }] } });
      g = setup.guardTokenOnlyFolder(dir, 'pilot-r3', D);
      assert.equal(g.ok, false, installPath);
      const s = readSettings(dir);
      assert.deepEqual(editDeniedBy(s.permissions.deny, path.join(dir, 'notes.md')), [], `${installPath}: the agent keeps its own folder`);
      assert.deepEqual(editDeniedBy(s.permissions.deny, path.join(HOME, '.claude-acct', 'projects', 'm.md')), [], `${installPath}: a config home is not denied whole`);
    }
    fs.writeFileSync(plist, 'not a plist');
    fs.rmSync(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { force: true });
    g = setup.guardTokenOnlyFolder(dir, 'pilot-r3', D);
    assert.equal(g.ok, false, 'managed preferences that cannot be converted are named');
  } finally {
    fs.rmSync(prefs, { recursive: true, force: true });
    fs.rmSync(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { force: true });
  }
});

test('#5774 review 4: cd moves where a relative script is read; find -exec, env -S, runner flags, flag values and package names', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  assert.ok(paths('cd /opt/hooks && bash x.sh').runPaths.includes('/opt/hooks/x.sh'), 'the script read from where cd went');
  assert.ok(paths('cd ~/scripts && ./run.sh').runPaths.includes('/H/scripts/run.sh'));
  assert.ok(paths('bash -c "cd /opt && ./a.sh"').runPaths.includes('/opt/a.sh'), 'inside an inline script too');
  assert.ok(paths('cd /opt && bash -c "./a.sh"').runPaths.includes('/opt/a.sh'), 'an inline script starts where the outer cd went');
  assert.ok(paths('cd; ./h.sh').runPaths.includes('/H/h.sh'), 'a bare cd goes home');
  assert.equal(paths('cd "$D" && ./b.sh').unsafe.length, 1, 'a cd Kosmos cannot follow leaves a relative script unknowable');
  assert.deepEqual(paths('cd "$D" && /abs/c.sh').unsafe, [], 'control: an absolute script after it is still known');
  assert.deepEqual(paths('find . -exec bash x.sh {} \;').runPaths, ['/A/x.sh']);
  assert.deepEqual(paths('env -S "bash /opt/x.sh"').runPaths, ['/opt/x.sh']);
  assert.deepEqual(paths('uv run --with requests script.py').runPaths, ['/A/script.py']);
  assert.deepEqual(paths('node --max-old-space-size=4096 /opt/x.js').paths, ['/opt/x.js'], 'a flag value that is no path is not denied');
  assert.deepEqual(paths('python3 -m foo').paths, [], 'a module, not a script file');
  assert.deepEqual(paths('npx -y @modelcontextprotocol/server-filesystem /data').runPaths, [], 'a package name is not a path');
  assert.deepEqual(paths('node -r ./hook.js main.js').runPaths, ['/A/hook.js', '/A/main.js'], 'what -r loads runs, and the script slot stays open');
});

test('#5774 review 4: an empty config file holds nothing; a plugin inside the agent folder is named, not denied whole', () => {
  const dir = agentDir('pilot-r4');
  const plug = path.join(dir, 'vendor', 'plug');
  fs.mkdirSync(plug, { recursive: true });
  fs.writeFileSync(path.join(dir, 'vendor', 'notes.md'), 'mine\n');
  fs.writeFileSync(path.join(HOME, '.claude', 'settings.local.json'), '﻿  \n');
  try {
    let g = setup.guardTokenOnlyFolder(dir, 'pilot-r4', DEPS);
    assert.equal(g.ok, true, 'an empty settings file is no gap: ' + JSON.stringify(g));
    writeJson(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'in@x': [{ scope: 'project', installPath: plug }] } });
    g = setup.guardTokenOnlyFolder(dir, 'pilot-r4', DEPS);
    assert.equal(g.ok, false, JSON.stringify(g));
    assert.match(String(g.because), /in@x/);
    assert.deepEqual(editDeniedBy(readSettings(dir).permissions.deny, path.join(plug, 'x.js')), [], 'the agent keeps its own subfolder');
  } finally {
    fs.rmSync(path.join(HOME, '.claude', 'settings.local.json'), { force: true });
    fs.rmSync(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { force: true });
  }
});

test('#5774 review 5: a quoted value before the program, an interpreter\'s value flags, -ce, ${VAR:-x}, PWD and a joined line', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PWD: '/A' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  assert.deepEqual(paths('FOO="bar" bash scripts/h.sh').runPaths, ['/A/scripts/h.sh'], 'NAME="value" is an assignment; bash is the program');
  assert.deepEqual(paths("DEBUG='1' python3 run.py").runPaths, ['/A/run.py']);
  assert.deepEqual(paths('"FOO"=bar ./x.txt').runPaths, [], 'control: a quoted name is no assignment, so ./x.txt is its argument');
  assert.ok(paths('bash -euo pipefail scripts/h.sh').runPaths.includes('/A/scripts/h.sh'), 'a flag value does not take the script slot');
  assert.ok(paths('ruby -I lib hook.rb').runPaths.includes('/A/hook.rb'));
  assert.deepEqual(paths('bash -ce "python3 /x.py"').runPaths, ['/x.py']);
  assert.deepEqual(paths('node "${CLAUDE_PROJECT_DIR:-.}/x.ts"'), { paths: ['/A/x.ts'], runPaths: ['/A/x.ts'], codePaths: ['/A/x.ts'], unsafe: [] });
  assert.equal(paths('node "${NOPE:-.}/x.ts"').unsafe.length, 1, 'control: an unknown variable with a default is still unknown');
  assert.deepEqual(paths('ba\\\nsh x.sh').runPaths, ['/A/x.sh'], 'a line continuation joins the word');
});

test('#5774 review 5: a hook with a quoted assignment in front has its script denied; a suffixed global config is read', () => {
  const dir = agentDir('pilot-r5');
  touch(path.join(dir, 'hook.py'));
  const srv = path.join(SANDBOX, 'scripts', 'staging-srv.js');
  touch(srv);
  writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'cd "$CLAUDE_PROJECT_DIR" && PYTHONUNBUFFERED="1" python3 hook.py' }] }] } });
  writeJson(path.join(HOME, '.claude-staging-oauth.json'), { mcpServers: { s: { command: 'node', args: [srv] } } });
  try {
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-r5', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    const deny = readSettings(dir).permissions.deny;
    assert.ok(editDeniedBy(deny, path.join(dir, 'hook.py')).length > 0, 'the script after a quoted assignment');
    assert.ok(editDeniedBy(deny, srv).length > 0, 'a server in a suffixed global config');
  } finally {
    fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true });
    fs.rmSync(path.join(HOME, '.claude-staging-oauth.json'), { force: true });
  }
});

test('#5774 review 6: comments, here-documents, an unclosed quote, PATH=, unlisted wrappers and code the agent folder supplies', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PWD: '/A', PATH: '\u0000PATH' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  assert.deepEqual(paths("# don't run twice\nbash /h/x.sh").runPaths, ['/h/x.sh'], 'an apostrophe in a comment opens no quote');
  assert.deepEqual(paths("echo hi # it's done\nbash /h/x.sh").runPaths, ['/h/x.sh']);
  assert.deepEqual(paths('bash /h/x.sh # $UNK /h/c.sh').unsafe, [], 'a comment names nothing');
  assert.deepEqual(paths("cat <<EOF\ndon't\nEOF\nbash /h/x.sh").runPaths, ['/h/x.sh'], 'a here-document body is no command');
  assert.deepEqual(paths('bash <<EOF\n./run.sh\nEOF').runPaths, ['/A/run.sh'], 'but given to a shell it is its script');
  assert.equal(paths('echo "unterminated\nbash /h/x.sh').unsafe.length, 1, 'an unclosed quote: where the command ends is unknown');
  assert.ok(paths('PATH="$HOME/.bun/bin:$PATH" bun run x.ts').runPaths.includes('/H/.bun/bin/bun'), 'the program is found in the folder PATH= put first');
  assert.deepEqual(paths('export PATH=tools:$PATH; lint').runPaths, ['/A/tools/lint']);
  assert.equal(paths('PATH="$UNK:$PATH" lint').unsafe.length, 1);
  for (const c of ['setsid bash x.sh', 'flock /tmp/l bash x.sh', 'script -q -c "bash x.sh" /dev/null', 'some-runner x.sh']) assert.deepEqual(paths(c).runPaths, ['/A/x.sh'], c);
  assert.equal(paths('npm run lint').unsafe.length, 1, 'npm in the agent folder runs the agent\'s package.json');
  assert.equal(paths('python3 -m pytest').unsafe.length, 1);
  assert.match(String(paths('cd /opt/p && npm test').unsafe), /npm run in \/opt\/p/, 'review 15: another folder\'s package.json is code too, and named where it is');
  assert.deepEqual(paths('echo $PATH').paths, []);
});

test('#5774 review 6: a commented multi-line hook still has its script denied; npm in the agent folder says not whole', () => {
  const dir = agentDir('pilot-r6');
  const hook = path.join(SANDBOX, 'scripts', 'r6.sh');
  touch(hook);
  try {
    writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `# don't run this twice\nbash ${hook}` }] }] } });
    let g = setup.guardTokenOnlyFolder(dir, 'pilot-r6', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.ok(editDeniedBy(readSettings(dir).permissions.deny, hook).length > 0);
    writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'npm run lint' }] }] } });
    g = setup.guardTokenOnlyFolder(dir, 'pilot-r6', DEPS);
    assert.equal(g.ok, false, JSON.stringify(g));
    assert.match(String(g.because), /npm run in the agent folder/);
  } finally { fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true }); }
});

test('#5774 review 7: a runner\'s change-folder flag, a folder run as code, patterns with a script extension, a runner after an unknown cd', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PWD: '/A', PATH: '\u0000PATH' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  assert.ok(paths('uv --directory /ABS/weather run weather.py').runPaths.includes('/ABS/weather/weather.py'), 'the MCP quickstart shape');
  assert.match(String(paths('make -C /opt/p').unsafe), /make run in \/opt\/p/, 'review 15: named in the folder the flag moved it to');
  assert.match(String(paths('git -C /opt/r status').unsafe), /\/opt\/r/);
  assert.match(String(paths('npm --prefix=/opt/x run b').unsafe), /\/opt\/x/);
  assert.equal(paths('make').unsafe.length, 1, 'control: make in the agent folder is named');
  assert.match(String(paths('make -C "$U"').unsafe), /cannot read/, 'a change-folder flag Kosmos cannot read');
  assert.equal(paths('cd "$U" && npm test').unsafe.length, 1, 'after a cd Kosmos cannot follow, the folder may be the agent\'s');
  assert.equal(paths('cd /tmp && cd - && npm test').unsafe.length, 1);
  for (const c of ['case "$f" in *.py) black "$f";; esac', 'if [[ "$F" == *.ts ]]; then echo y; fi', "find . -name '*.py'", 'grep -r foo --include="*.ts" .']) {
    assert.deepEqual(paths(c).unsafe, [], c);
    assert.deepEqual(paths(c).runPaths, [], c);
  }
  assert.deepEqual(paths('java -cp ~/lib Main').codePaths, ['/H/lib']);
  assert.deepEqual(paths('ruby -I lib hook.rb').codePaths, ['/A/hook.rb'], 'a value flag does not take the code position');
});

test('#5774 review 7: a folder an interpreter runs is named, never denied whole', () => {
  const dir = agentDir('pilot-r7');
  const srv = path.join(SANDBOX, 'nodesrv');
  fs.mkdirSync(srv, { recursive: true });
  fs.writeFileSync(path.join(srv, 'index.js'), '');
  writeJson(path.join(HOME, '.claude.json'), { mcpServers: { s: { command: 'node', args: [srv] } } });
  try {
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-r7', DEPS);
    assert.equal(g.ok, false, JSON.stringify(g));
    assert.match(String(g.because), /runs as code/);
    assert.deepEqual(editDeniedBy(readSettings(dir).permissions.deny, path.join(srv, 'index.js')), [], 'not denied whole');
  } finally { fs.rmSync(path.join(HOME, '.claude.json'), { force: true }); }
});

test('#5774 review 8: ~ in an assignment, package-script runners, jq filters, and nesting too deep to read', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PWD: '/A', PATH: '\u0000PATH' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  assert.deepEqual(paths('PATH=~/bin:$PATH myhook').runPaths, ['/H/bin/myhook'], '~ after = is the home');
  assert.deepEqual(paths('export PATH=/x:~/bin:$PATH; myhook').runPaths, ['/x/myhook', '/H/bin/myhook'], '~ after : too');
  assert.deepEqual(paths('PATH=/x:~:$PATH myhook').runPaths, ['/x/myhook', '/H/myhook'], 'a bare ~ between colons is the home');
  assert.deepEqual(paths('FOO=a~b x').runPaths, [], 'control: a ~ inside a value is literal');
  for (const c of ['bun run start', 'bun start', 'bun test', 'deno task start', 'uv run hook']) assert.match(String(paths(c).unsafe), /agent folder/, c);
  for (const c of ['bun run x.ts', 'bun x.ts', 'deno run main.ts', 'uv run x.py']) assert.deepEqual(paths(c).unsafe, [], c);
  assert.match(String(paths('bun run --cwd /opt/p start').unsafe), /\/opt\/p/, 'review 15: a package script in another folder is named there');
  assert.deepEqual(paths("jq -r '.tool_input.command'").paths, [], 'a jq filter is not a script');
  assert.match(String(paths('bash -c "bash -c \\"bash -c \\\\\\"bash -c /x.sh\\\\\\"\\""').unsafe), /nested too deep/);
});

test('#5774 review 9: processWrapper and helper paths, $\'...\' quoting, perl -pe, login variables, an unlistable drop-in folder', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PWD: '/A', PATH: '\u0000PATH' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  assert.deepEqual(sc.commandsIn({ processWrapper: '/opt/launch', policyHelper: { path: '/opt/ph' } }), [{ line: '/opt/launch' }, { program: '/opt/ph', args: [], exec: true }]);
  assert.deepEqual(paths("printf $'%s\\n' hi; ~/bin/hook"), { paths: ['/H/bin/hook'], runPaths: ['/H/bin/hook'], codePaths: ['/H/bin/hook'], unsafe: [] }, "$'...' is a quote, not an unclosed one");
  assert.deepEqual(paths("IFS=$'\\n' x").unsafe, []);
  assert.deepEqual(paths('echo $"hi" /x.sh').runPaths, ['/x.sh']);
  assert.deepEqual(paths('perl -pe "s/a/b/" ~/x').runPaths, [], 'perl code is not read as shell, and is not a script path');
  assert.deepEqual(paths('node -e "require(\'/opt/x.js\')"').runPaths, ['/opt/x.js'], 'an absolute path inside inline code still counts');
  const dir = agentDir('pilot-r9');
  const user = require('os').userInfo().username;
  const hook = path.join(SANDBOX, 'scripts', 'r9.sh');
  touch(hook);
  writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `bash "/nonexistent/$USER/x.sh"; bash ${hook}` }] }] }, processWrapper: path.join(SANDBOX, 'scripts', 'launch.sh') });
  const dropIns = path.join(MANAGED, 'managed-settings.d');
  try {
    let g = setup.guardTokenOnlyFolder(dir, 'pilot-r9', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    const deny = readSettings(dir).permissions.deny;
    assert.ok(editDeniedBy(deny, path.join('/nonexistent', user, 'x.sh')).length > 0, '$USER is the login');
    assert.ok(editDeniedBy(deny, path.join(SANDBOX, 'scripts', 'launch.sh')).length > 0, 'processWrapper names a program');
    fs.mkdirSync(dropIns, { recursive: true });
    fs.chmodSync(dropIns, 0o000);
    g = setup.guardTokenOnlyFolder(dir, 'pilot-r9', DEPS);
    assert.equal(g.ok, false, 'a drop-in folder that cannot be listed is named');
    assert.match(String(g.because), /managed-settings\.d/);
  } finally {
    try { fs.chmodSync(dropIns, 0o755); } catch { /* not made */ }
    fs.rmSync(MANAGED, { recursive: true, force: true });
    fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true });
  }
});

test('#5774 review 10: input to a program that only reads it, a here-string given to a shell, a message that ends like a script', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PWD: '/A', PATH: '\u0000PATH' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  assert.deepEqual(paths('jq .name < package.json').paths, [], 'jq reads it: the agent keeps its state file');
  assert.deepEqual(paths('bash < in.sh').runPaths, ['/A/in.sh'], 'control: a shell runs its input');
  assert.deepEqual(paths('sh <<< "bash $HOME/x.sh"').runPaths, ['/H/x.sh'], 'a here-string given to a shell is its script');
  assert.equal(paths('bash <<< "$CMD"').unsafe.length, 1);
  assert.deepEqual(paths('cat <<< "x.sh"').paths, [], 'control: given to cat it is text');
  assert.deepEqual(paths('echo "see README.md and a.ts"').paths, [], 'a sentence is not a script path');
});

test('#5774 review 10: a config file caught mid-write is read once more before it is named', () => {
  const dir = agentDir('pilot-r10');
  const srv = path.join(SANDBOX, 'scripts', 'midwrite.js');
  touch(srv);
  const file = path.join(HOME, '.claude.json');
  writeJson(file, { mcpServers: { s: { command: 'node', args: [srv] } } });
  const real = fs.readFileSync;
  let first = true;
  fs.readFileSync = function (p, ...rest) {
    if (first && path.resolve(String(p)) === file) { first = false; return '{ "mcpServers": '; }
    return real.call(this, p, ...rest);
  };
  try {
    const r = sc.startCommandScripts(dir, { homes: [path.join(HOME, '.claude')], home: HOME, platform: 'darwin', managedDir: null, managedPrefsDir: null });
    assert.equal(first, false, 'precondition: the half-written read happened');
    assert.deepEqual(r.unsafe, [], 'the second read is whole, so nothing is named');
    assert.ok(r.files.includes(srv));
  } finally {
    fs.readFileSync = real;
    fs.rmSync(file, { force: true });
  }
});

test('#5774 review 11: a hook runs in the session\'s current folder, so a relative script is named unless the line anchors it', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PATH: '\u0000PATH' };
  const line = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v, 0, null, false);
  for (const c of ['bash scripts/check.sh', '.claude/hooks/fmt.sh', 'python3 hook.py', 'cd sub && ./x.sh', 'bash -c "./a.sh"', 'bash "$PWD/x.sh"']) assert.ok(line(c).unsafe.length > 0, c);
  for (const c of ['"$CLAUDE_PROJECT_DIR"/tools/x.sh', 'cd "$CLAUDE_PROJECT_DIR" && ./x.sh', 'cd /opt && ./x.sh', 'cd && ./x.sh']) assert.deepEqual(line(c).unsafe, [], `anchored: ${c}`);
  assert.deepEqual(line('bash "/abs/kosmos-report-hook.sh" start').unsafe, [], 'a later argument (the report hook\'s mode word) is not a script position');
  const dir = agentDir('pilot-r11');
  const prefix = path.join(SANDBOX, 'scripts', 'prefix.sh');
  touch(prefix);
  try {
    writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash scripts/check.sh' }] }] } });
    let g = setup.guardTokenOnlyFolder(dir, 'pilot-r11', DEPS);
    assert.equal(g.ok, false, JSON.stringify(g));
    assert.match(String(g.because), /relative to the folder the session is in/);
    writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash "$PWD/x.sh"' }] }] } });
    g = setup.guardTokenOnlyFolder(dir, 'pilot-r11', DEPS);
    assert.equal(g.ok, false, '$PWD is the session\'s folder, which Kosmos cannot know');
    fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true });
    writeJson(path.join(HOME, '.claude.json'), { mcpServers: { s: { command: 'node', args: ['server.js'] } } });
    g = setup.guardTokenOnlyFolder(dir, 'pilot-r11', DEPS);
    fs.rmSync(path.join(HOME, '.claude.json'), { force: true });
    assert.equal(g.ok, true, 'a server starts in the project folder, so its relative script is known: ' + JSON.stringify(g));
    assert.ok(editDeniedBy(readSettings(dir).permissions.deny, path.join(dir, 'server.js')).length > 0);
    writeJson(path.join(HOME, '.claude', 'settings.json'), { env: { CLAUDE_CODE_SHELL_PREFIX: prefix } });
    g = setup.guardTokenOnlyFolder(dir, 'pilot-r11', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.ok(editDeniedBy(readSettings(dir).permissions.deny, prefix).length > 0, 'the shell prefix every hook runs through');
    writeJson(path.join(HOME, '.claude-acct', 'settings.json'), { env: { CLAUDE_CODE_SHELL_PREFIX: '/other' } });
    g = setup.guardTokenOnlyFolder(dir, 'pilot-r11', DEPS);
    assert.equal(g.ok, false, 'set two ways: unknown');
  } finally {
    fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true });
    fs.rmSync(path.join(HOME, '.claude-acct', 'settings.json'), { force: true });
  }
});

test('#5774 review 12: an unknown argument after the script is not a gap; the agent\'s own settings.local.json hooks are read', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PATH: '\u0000PATH' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  for (const c of ['node ~/x.js "$FOO"', 'python3 ~/hooks/x.py "$CLAUDE_ENV_FILE"', 'bash ~/x.sh $1', 'sh ~/h.sh "$@"']) assert.deepEqual(paths(c).unsafe, [], c);
  for (const c of ['bash "$S"', '"$P" x']) assert.equal(paths(c).unsafe.length, 1, `control: ${c}`);
  const dir = agentDir('pilot-r12');
  const hook = path.join(SANDBOX, 'scripts', 'local-hook.sh');
  touch(hook);
  writeJson(path.join(dir, '.claude', 'settings.local.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `bash ${hook}` }] }] } });
  const g = setup.guardTokenOnlyFolder(dir, 'pilot-r12', DEPS);
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8')).hooks, 'precondition: the guard leaves the hooks there, so they run');
  assert.ok(editDeniedBy(readSettings(dir).permissions.deny, hook).length > 0, 'so their script is denied');
});

test('#5774 review 13: an exec-form hook runs in the session folder with only Claude Code\'s own variables; value flags that load code', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PATH: '\u0000PATH' };
  const line = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v, 0, null, false);
  assert.deepEqual(line('node --env-file ~/.env ~/x.js').runPaths, ['/H/.env', '/H/x.js'], 'an env file is code the program loads');
  assert.deepEqual(line('ruby -r /h/pre.rb ~/x.rb').runPaths, ['/h/pre.rb', '/H/x.rb']);
  assert.deepEqual(line('ruby -r/h/pre.rb ~/x.rb').runPaths, ['/h/pre.rb', '/H/x.rb'], 'the glued spelling too');
  assert.deepEqual(line('python3 -X utf8 ~/s.py'), { paths: ['/H/s.py'], runPaths: ['/H/s.py'], codePaths: ['/H/s.py'], unsafe: [] }, 'control: a value that is no file is skipped');
  assert.deepEqual(line('bash +x ~/x').unsafe, [], '+x is an option');
  assert.deepEqual(line('< data/state.json jq .'), { paths: [], runPaths: [], codePaths: [], unsafe: [] }, 'a redirection before the program: jq is the program, the file its input');
  const dir = agentDir('pilot-r13');
  try {
    writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PROJECT_DIR}/h.js'] }] }] } });
    let g = setup.guardTokenOnlyFolder(dir, 'pilot-r13', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.ok(editDeniedBy(readSettings(dir).permissions.deny, path.join(dir, 'h.js')).length > 0, 'control: anchored by the variable Claude Code expands');
    for (const arg of ['scripts/hook.js', '$HOME/x.js']) {
      writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args: [arg] }] }] } });
      g = setup.guardTokenOnlyFolder(dir, 'pilot-r13', DEPS);
      assert.equal(g.ok, false, `${arg}: an exec-form hook runs in the session's folder (and $HOME is not expanded there)`);
    }
  } finally { fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true }); }
});

test('#5774 review 14: a plugin\'s monitors (default file and manifest path) and a trap\'s command line', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PATH: '\u0000PATH' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  assert.deepEqual(paths("trap '~/h/clean.sh' EXIT; true").runPaths, ['/H/h/clean.sh'], 'a trap runs its command later');
  assert.deepEqual(paths('trap - EXIT').paths, [], 'control: resetting a trap names nothing');
  const dir = agentDir('pilot-r14');
  const plug = path.join(SANDBOX, 'my-plugins', 'p14');
  const outA = path.join(SANDBOX, 'scripts', 'monitor-default.sh');
  const outB = path.join(SANDBOX, 'scripts', 'monitor-manifest.sh');
  touch(outA); touch(outB);
  writeJson(path.join(plug, 'monitors', 'monitors.json'), [{ name: 'a', command: `bash ${outA}` }]);
  writeJson(path.join(plug, '.claude-plugin', 'plugin.json'), { name: 'p14', experimental: { monitors: './extra/mon.json' } });
  writeJson(path.join(plug, 'extra', 'mon.json'), [{ name: 'b', command: `bash ${outB}` }]);
  writeJson(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'p14@local': [{ scope: 'user', installPath: plug }] } });
  try {
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-r14', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    const deny = readSettings(dir).permissions.deny;
    assert.ok(editDeniedBy(deny, outA).length > 0, 'the default monitors file is read');
    assert.ok(editDeniedBy(deny, outB).length > 0, 'a monitors file the manifest names is read');
  } finally { fs.rmSync(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { force: true }); }
});

test('#5774 review 15: a folder runner is named wherever it runs; a folder as the program; plugin server files; project entries', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PATH: '\u0000PATH' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  for (const c of ['cd ~/work/notes && git add -A', 'cd /opt/proj && make hook']) assert.equal(paths(c).unsafe.length, 1, c);
  assert.deepEqual(paths('uvx --from=/x/dir mytool').codePaths, ['/x/dir'], 'a wrapper flag\'s path value is where the program comes from');
  const dir = agentDir('pilot-r15');
  const src = path.join(SANDBOX, 'uvx-src');
  fs.mkdirSync(src, { recursive: true });
  const plug = path.join(SANDBOX, 'my-plugins', 'p15');
  touch(path.join(dir, 'lsp.js'));
  writeJson(path.join(plug, '.lsp.json'), { ts: { command: 'node', args: ['lsp.js'] } });
  writeJson(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'p15@local': [{ scope: 'user', installPath: plug }] } });
  writeJson(path.join(HOME, '.claude.json'), { projects: { [dir]: { mcpServers: {}, lastRun: { command: '/should/not/be/read.sh' } } } });
  try {
    let g = setup.guardTokenOnlyFolder(dir, 'pilot-r15', DEPS);
    assert.equal(g.ok, true, 'a plugin .lsp.json server starts in the project folder, and a project entry\'s runtime state is not a command: ' + JSON.stringify(g));
    const deny = readSettings(dir).permissions.deny;
    assert.ok(editDeniedBy(deny, path.join(dir, 'lsp.js')).length > 0);
    assert.deepEqual(editDeniedBy(deny, '/should/not/be/read.sh'), []);
    writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `uvx --from ${src} mytool` }] }] } });
    g = setup.guardTokenOnlyFolder(dir, 'pilot-r15', DEPS);
    assert.equal(g.ok, false, 'a folder in the program position is named');
    assert.match(String(g.because), /runs as code/);
  } finally {
    fs.rmSync(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { force: true });
    fs.rmSync(path.join(HOME, '.claude.json'), { force: true });
    fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true });
  }
});

test('#5774 review 15: a folder runner inside a folder the guard denies whole (a plugin\'s own) is covered; elsewhere it is named', () => {
  const dir = agentDir('pilot-r15b');
  const plug = path.join(SANDBOX, 'my-plugins', 'p15b');
  writeJson(path.join(plug, '.mcp.json'), { mcpServers: { d: { command: 'bun', args: ['run', '--cwd', '${CLAUDE_PLUGIN_ROOT}', '--silent', 'start'] } } });
  writeJson(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'p15b@local': [{ scope: 'user', installPath: plug }] } });
  const other = path.join(SANDBOX, 'not-a-plugin');
  fs.mkdirSync(other, { recursive: true });
  try {
    let g = setup.guardTokenOnlyFolder(dir, 'pilot-r15b', DEPS);
    assert.equal(g.ok, true, 'the plugin folder is denied whole, so the package.json its server runs is covered: ' + JSON.stringify(g));
    fs.mkdirSync(path.join(HOME, '.claude', 'skills', 'tool'), { recursive: true });
    writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `cd ${path.join(HOME, '.claude', 'skills', 'tool')} && make` }] }] } });
    g = setup.guardTokenOnlyFolder(dir, 'pilot-r15b', DEPS);
    fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true });
    assert.equal(g.ok, true, 'a config home\'s code folder (denied whole by the guard) covers a runner there too: ' + JSON.stringify(g));
    writeJson(path.join(HOME, '.claude.json'), { mcpServers: { e: { command: 'bun', args: ['run', '--cwd', other, 'start'] } } });
    g = setup.guardTokenOnlyFolder(dir, 'pilot-r15b', DEPS);
    assert.equal(g.ok, false, 'control: the same server shape in an uncovered folder is named');
    assert.match(String(g.because), /not-a-plugin/);
  } finally {
    fs.rmSync(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { force: true });
    fs.rmSync(path.join(HOME, '.claude.json'), { force: true });
  }
});

test('#5774 review 16: .command scripts, awk and sed program text, runner specifiers, sealed system paths, a config too deep', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PATH: '\u0000PATH' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  assert.deepEqual(paths('open ./x.command').runPaths, ['/A/x.command'], 'a .command path is a script, even in the agent folder');
  assert.deepEqual(paths("jq -r '.tool_input.command'").paths, [], 'control: a jq filter ending in .command is not');
  assert.deepEqual(paths('awk \'BEGIN{system("/opt/x.sh")}\'').runPaths, ['/opt/x.sh'], 'awk\'s program text is code');
  assert.deepEqual(paths('awk -f ~/p.awk f').runPaths, ['/H/p.awk'], 'counted once');
  for (const c of ['deno run -A npm:foo', 'deno run jsr:@std/http/file-server']) assert.deepEqual(paths(c), { paths: [], runPaths: [], codePaths: [], unsafe: [] }, c);
  assert.deepEqual(paths('afplay /System/Library/Sounds/Glass.aiff').paths, [], 'a sealed system path needs no rule');
  assert.deepEqual(paths('bash /usr/local/bin/h.sh').runPaths, ['/usr/local/bin/h.sh'], 'control: /usr/local is writable, so it counts');
  let deep = { command: '/x.sh' };
  for (let i = 0; i < 40; i++) deep = { a: deep };
  assert.ok(sc.commandsIn(deep).some((c) => c.tooDeep), 'a config nested past the limit is marked, so the scan names it');
});

test('#5774 review 17: a program from a package folder, inline python or node in the agent folder, formatters and linters', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PATH: '\u0000PATH' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  for (const c of ['"$CLAUDE_PROJECT_DIR"/node_modules/.bin/prettier --write x', '"$CLAUDE_PROJECT_DIR"/.venv/bin/python ~/hooks/x.py', 'python3 -c "import foo"', 'node -e "require(\'./x\')"', 'eslint .', 'cd /opt/p && prettier --write .', 'swift build']) {
    assert.ok(paths(c).unsafe.length > 0, c);
  }
  for (const c of ['python3 ~/x.py', 'bash -c "echo hi"', 'perl -e "print 1"']) assert.deepEqual(paths(c).unsafe, [], `control: ${c}`);
  assert.deepEqual(paths('exec -a name "$CLAUDE_PROJECT_DIR"/bin/hook').runPaths, ['/A/bin/hook'], 'exec -a takes a value');
});

test('#5774 review 18: 2>&1 after an interpreter, inline python and node narrowed, a data argument after an unknown cd', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PATH: '\u0000PATH' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  const line = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v, 0, null, false);
  for (const c of ['python3 ~/h/x.py 2>&1', 'python3 ~/h/x.py >&2', 'node ~/x.js <&0']) assert.deepEqual(paths(c).paths.filter((p) => p.startsWith('/A/')), [], `${c}: a descriptor is no file`);
  assert.deepEqual(line('cd "$X" && python3 ~/x.py 2>&1').unsafe, [], 'not a refusal after an unknown cd either');
  assert.deepEqual(line('cd "$X" && python3 ~/x.py data').unsafe, [], 'a data argument after an unknown cd names no script');
  assert.equal(line('cd "$X" && python3 ./x.py').unsafe.length, 1, 'control: the script itself, relative after an unknown cd, is named');
  assert.equal(paths('python3 -c "import json,sys"').unsafe.length, 1, 'python imports from the folder it runs in');
  assert.deepEqual(paths('python3 -I -c "import json"').unsafe, [], 'unless isolated');
  assert.deepEqual(paths('python3 -P -c "import json"').unsafe, []);
  assert.deepEqual(paths('node -e "console.log(1)"').unsafe, [], 'node code that loads no module');
  assert.equal(paths('node -e "require(\'x\')"').unsafe.length, 1);
});

test('#5774 review 19: an assignment value is not a command; -eo pipefail; package-folder wording', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PATH: '\u0000PATH' };
  const line = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v, 0, null, false);
  assert.deepEqual(line('TZ=America/Chicago date +%H:%M'), { paths: [], runPaths: [], codePaths: [], unsafe: [] }, 'a time zone is no script');
  assert.deepEqual(line('PYTHONPATH=/opt/lib python3 ~/h.py').codePaths, ['/H/h.py'], 'a folder value is not the program');
  assert.deepEqual(line('BASH_ENV=/x/env.sh bash -c true').runPaths, ['/x/env.sh'], 'control: an absolute file in a value still counts');
  assert.deepEqual(line('NODE_OPTIONS=--require=/x/pre.js node ~/s.js').runPaths, ['/x/pre.js', '/H/s.js']);
  for (const c of ['bash -eo pipefail ~/h/x.sh', 'bash -euo pipefail ~/h/x.sh']) assert.deepEqual(line(c), { paths: ['/H/h/x.sh'], runPaths: ['/H/h/x.sh'], codePaths: ['/H/h/x.sh'], unsafe: [] }, c);
  assert.deepEqual(line('python3.12 -X utf8 ~/s.py').unsafe, [], 'python3.12 uses python\'s table');
  assert.match(String(line('node /opt/homebrew/lib/node_modules/srv/dist/index.js').unsafe), /package folder/, 'a package folder anywhere is named, in its own words');
});

test('#5774 review 21: plugin source commands and producer folders, marketplaces, python on stdin, uv tool run, flag values, jq //', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PATH: '\u0000PATH' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  assert.equal(paths("python3 - <<'EOF'\nimport json\nEOF").unsafe.length, 1, 'python reading a here-document imports from where it runs');
  assert.equal(paths("python3 <<'EOF'\nimport json\nEOF").unsafe.length, 1, 'with no - too');
  assert.equal(paths('python3 < /abs/hook.py').unsafe.length, 1, 'and from standard input');
  assert.deepEqual(paths('python3 -I - <<EOF\nimport json\nEOF').unsafe, [], 'control: isolated');
  assert.deepEqual(paths('uv tool run mcp-server-fetch').unsafe, [], 'uv tool run is uvx, not a package script');
  const line = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v, 0, null, false);
  assert.deepEqual(line('ruff check --config=ruff.toml').unsafe.filter((u) => /relative to the folder/.test(u)), [], 'a config file value is data, not a script');
  assert.equal(line('node --require=./pre.js ~/s.js').unsafe.length, 1, 'control: a script value still is');
  assert.deepEqual(paths('jq -r \'.x // "none"\'').paths, [], 'jq\'s // is no path');
  const dir = agentDir('pilot-r21');
  const plug = path.join(SANDBOX, 'my-plugins', 'p21');
  const producer = path.join(SANDBOX, 'producer-p21');
  fs.mkdirSync(producer, { recursive: true });
  const build = path.join(SANDBOX, 'scripts', 'build-plugin.sh');
  const mkt = path.join(SANDBOX, 'mkt21');
  const mktCmd = path.join(SANDBOX, 'scripts', 'mkt.sh');
  touch(build); touch(mktCmd);
  writeJson(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'p21@m': [{ scope: 'user', installPath: plug, sourceProducerPath: producer, sourceCommand: `bash ${build}` }] } });
  writeJson(path.join(HOME, '.claude', 'plugins', 'known_marketplaces.json'), { m: { source: { source: 'command', command: `bash ${mktCmd}` }, installLocation: mkt } });
  try {
    const g = setup.guardTokenOnlyFolder(dir, 'pilot-r21', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    const deny = readSettings(dir).permissions.deny;
    assert.ok(editDeniedBy(deny, build).length > 0, 'a plugin\'s source command is read');
    assert.ok(editDeniedBy(deny, mktCmd).length > 0, 'a marketplace\'s command is read');
    assert.ok(editDeniedBy(deny, path.join(producer, 'x.js')).length > 0, 'a producer folder is denied whole');
  } finally {
    fs.rmSync(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), { force: true });
    fs.rmSync(path.join(HOME, '.claude', 'plugins', 'known_marketplaces.json'), { force: true });
  }
});

test('#5774 review 23: a cd that does not last (subshell, background, popd, conditional) anchors nothing; PATH= reaches bash -c', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A', PATH: '\u0000PATH' };
  const line = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v, 0, null, false);
  for (const c of ['(cd /opt && true); ./x.sh', 'cd /opt & bash scripts/y.sh', 'pushd /opt; popd; bash scripts/x.sh', 'case "$x" in a) cd /opt;; esac; ./z.sh', '[ -d /opt ] && cd /opt; ./x.sh']) {
    assert.equal(line(c).unsafe.length, 1, `${c}: the session's folder may still be one the agent chose`);
  }
  for (const c of ['cd /opt && ./x.sh', 'cd "$CLAUDE_PROJECT_DIR" && ./x.sh', 'cd; ./h.sh', 'bash -c "cd /opt && ./a.sh"']) assert.deepEqual(line(c).unsafe, [], `control: ${c}`);
  assert.ok(line('PATH="$HOME/bin:$PATH" bash -c "myhook"').runPaths.includes('/H/bin/myhook'), 'PATH= carries into bash -c');
  assert.match(String(line('cd /opt && (cd /tmp && true) && make').unsafe), /make run in \/opt /, 'after the subshell the line is back in /opt');
  assert.deepEqual(line('bash -s -- arg < "$CLAUDE_PROJECT_DIR/bin/hook"').unsafe, [], 'bash -s: arg is an argument, the script is the input');
});
