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
const DEPS = { platform: 'darwin', dataRoot: store.ROOT, home: HOME, runner: 'claude', runnerOf: () => 'claude', workersRoot: path.join(SANDBOX, 'workers'), managedDir: MANAGED, ...LAUNCH_PIN };

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

test('#5774: a linked script has its target denied too; an uncarriable path is named only when it exists', () => {
  const dir = agentDir('pilot-link');
  const real = path.join(SANDBOX, 'real-scripts', 'target.sh');
  touch(real);
  const link = path.join(SANDBOX, 'scripts', 'linked.sh');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.rmSync(link, { force: true });
  fs.symlinkSync(real, link);
  const odd = path.join(SANDBOX, 'odd (dir)', 'x.sh');
  writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `bash ${link}; sed 's/(a)/b/' f; bash "${odd}"` }] }] } });
  try {
    // The odd path does not exist: it is skipped, so the guard is whole (a sed expression looks the same).
    let g = setup.guardTokenOnlyFolder(dir, 'pilot-link', DEPS);
    assert.equal(g.ok, true, JSON.stringify(g));
    const deny = readSettings(dir).permissions.deny;
    assert.ok(editDeniedBy(deny, link).length > 0, 'the link by its own name');
    assert.ok(editDeniedBy(deny, fs.realpathSync.native(real)).length > 0, 'and the file it points at, by its real path');
    // Once it exists, it is a script the rules cannot carry: named, not whole.
    touch(odd);
    g = setup.guardTokenOnlyFolder(dir, 'pilot-link', DEPS);
    assert.equal(g.ok, false, JSON.stringify(g));
    assert.match(String(g.because), /odd \(dir\)/);
  } finally { fs.rmSync(path.join(HOME, '.claude', 'settings.json'), { force: true }); }
});

test('#5774: the command splitter: quotes, variables, substitutions, redirections and the program word', () => {
  const v = { HOME: '/H', CLAUDE_PROJECT_DIR: '/A' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), '/A', v);
  assert.deepEqual(paths('bash ~/.x/s.sh').paths, ['/H/.x/s.sh']);
  assert.deepEqual(paths('"${HOME}/a b.sh" --flag').paths, ['/H/a b.sh']);
  assert.deepEqual(paths("echo '$HOME/not' | /bin/t.sh").paths, ['/bin/t.sh']);   // single quotes keep $ literal; an argument in the agent folder is its work
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
  assert.deepEqual(cmds[1], { program: '/My Dir/srv', args: [] }, 'review 2: a server is started directly, so its command is one word even with no args');
});

test('#5774 review 1: a folder a command names is never denied (cd into the agent folder, a search of the home or the root)', () => {
  const dir = agentDir('pilot-cd');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'mine\n');
  fs.mkdirSync(path.join(HOME, 'work'), { recursive: true });
  touch(path.join(SANDBOX, 'scripts', 'lint.sh'));
  writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `cd "$CLAUDE_PROJECT_DIR" && npm run lint; rg TODO ~/work; find / -name foo; cd ~; bash ${path.join(SANDBOX, 'scripts', 'lint.sh')}` }] }] } });
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
  writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `bash check.sh; BASH_ENV=${path.join(SANDBOX, 'benv.sh')} bash -c true` }] }] } });
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
  writeJson(path.join(plug, 'custom', 'h.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: `bash ${out}; \${CLAUDE_PLUGIN_DATA}/venv/bin/python x.py` }] }] } });
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
  writeJson(path.join(HOME, '.claude', 'settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'jq . package.json | tee log/hook.log; jq . "$CLAUDE_PROJECT_DIR/package.json"; nohup bash tools/run.sh' }] }] } });
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
