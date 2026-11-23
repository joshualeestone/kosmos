'use strict';
/**
 * The agents' own private browser (engine/agentbrowser.js).
 *
 * Every arm runs on any host: the platform is a parameter, the install's network,
 * tar and prove steps are seams, and the managed root is a sandbox. The live proof
 * (a real `claude -p` reading a JS-rendered page through this config) is recorded
 * on the PR, because no suite may drive a real browser.
 *
 *   node --test engine/agentbrowser.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentbrowser-')));
process.env.AGENT_WORKFORCE_RUNNERS_DIR = path.join(SANDBOX, 'runners');

const ab = require('./agentbrowser');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* A fake install: every step succeeds without the network, tar or a real server. */
const fakeSeams = (over) => Object.assign({
  download: async (url, file) => fs.writeFileSync(file, url),
  integrityOf: async (file) => ab.PIN.packages.find((p) => p.url === fs.readFileSync(file, 'utf8')).integrity,
  unpack: async (tgz, dest) => fs.writeFileSync(path.join(dest, dest.endsWith('mcp') ? 'cli.js' : 'package.json'), '//'),
  prove: async () => 'Version ' + ab.PIN.version + '\n',
}, over || {});

test('the pin is exact: three registry tarballs at fixed versions with sha512 integrity', () => {
  assert.equal(ab.PIN.version, '0.0.82');
  assert.deepEqual(ab.PIN.packages.map((p) => p.name), ['@playwright/mcp', 'playwright', 'playwright-core']);
  for (const p of ab.PIN.packages) {
    assert.match(p.url, /^https:\/\/registry\.npmjs\.org\/.+-\d[^/]*\.tgz$/, 'a versioned tarball, never a "latest"');
    assert.match(p.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
  }
  assert.ok(Object.isFrozen(ab.PIN) && Object.isFrozen(ab.PIN.packages[0]), 'the trust anchors cannot be repointed in-process');
});

test('the config: Edge, headless, isolated profile, output kept out of the agent folder', () => {
  const cfg = ab.configFor({ node: 'C:\\K\\runtime\\node.exe', cli: 'C:\\R\\cli.js', outputDir: 'C:\\T\\out' });
  assert.deepEqual(cfg, {
    mcpServers: {
      'kosmos-browser': {
        type: 'stdio',
        command: 'C:\\K\\runtime\\node.exe',
        args: ['C:\\R\\cli.js', '--browser', 'msedge', '--headless', '--isolated', '--output-dir', 'C:\\T\\out'],
      },
    },
  });
  const args = cfg.mcpServers['kosmos-browser'].args;
  for (const never of ['--extension', '--user-data-dir', '--cdp-endpoint', '--profile-dir-name']) {
    assert.ok(!args.includes(never), never + ' would reach the person\'s own browser or profile');
  }
});

test('launchConfig is Windows and Mac only, honours the opt-out, and is null until installed', () => {
  assert.equal(ab.launchConfig({ platform: 'linux', install: false , env: {} }), null, 'any other platform is untouched');
  assert.equal(ab.launchConfig({ platform: 'darwin', install: false , env: {} }), null, 'a Mac with nothing installed gets no flag');
  assert.equal(ab.launchConfig({ platform: 'win32', env: { KOSMOS_AGENT_BROWSER: 'off' } }), null);
  assert.equal(ab.isInstalled(), false);
  assert.equal(ab.launchConfig({ platform: 'win32', install: false , env: {} }), null,
    'not installed yet = launch without a browser, never a flag naming a file that is not there');
  assert.equal(fs.existsSync(ab.configPath()), false);
});

test('a checksum mismatch installs nothing', async () => {
  const r = await ab.ensureInstalled(fakeSeams({ integrityOf: async () => 'sha512-wrong' }));
  assert.equal(r.ok, false);
  assert.match(r.because, /checksum/);
  assert.equal(ab.isInstalled(), false);
  assert.equal(fs.existsSync(ab.treeDir()), false, 'no tree under the live name');
  assert.deepEqual(fs.readdirSync(ab.homeDir()).filter((f) => f.startsWith('.staging')), [], 'staging cleaned up');
});

test('a server that does not answer with its version installs nothing', async () => {
  const r = await ab.ensureInstalled(fakeSeams({ prove: async () => 'something else' }));
  assert.equal(r.ok, false);
  assert.equal(ab.isInstalled(), false);
});

test('a proven install, then every launch gets a flag for a file holding exactly the config', async () => {
  const r = await ab.ensureInstalled(fakeSeams());
  assert.deepEqual(r, { ok: true });
  assert.equal(ab.isInstalled(), true);
  assert.deepEqual(await ab.ensureInstalled(fakeSeams({ download: async () => { throw new Error('must not download again'); } })),
    { ok: true, already: true });

  const p = ab.launchConfig({ platform: 'win32', node: 'C:\\K\\node.exe' , env: {} });
  assert.equal(p, ab.configPath());
  const written = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.deepEqual(written, ab.configFor({ node: 'C:\\K\\node.exe', cli: ab.cliPath(), outputDir: ab.outputDir() }));

  /* A damaged file is repaired, because a bad --mcp-config stops claude starting. */
  fs.writeFileSync(p, '{ not json');
  assert.equal(ab.launchConfig({ platform: 'win32', node: 'C:\\K\\node.exe' , env: {} }), p);
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')), written);
});

/* kosmos#8929: the one rule of agentbrowser's own (a temp folder inside a run root; the rest is the store's
   isTestProcess, tested there), and a sandboxed call still writes. The refusal itself is proven through the shim below,
   the path the bug took, since this file's own runners folder is sandboxed. */
test('#8929 a temp folder inside a run root marks a test run; CONTROL: a plain temp folder and kt-like names do not', () => {
  assert.equal(ab.inKtRunRoot('/var/folders/ab/cd/T/kt23905'), true, 'the run root the live config named');
  assert.equal(ab.inKtRunRoot('/tmp/kt9/x'), true, 'inside a run root under /tmp');
  assert.equal(ab.inKtRunRoot('/var/folders/ab/cd/T'), false, 'CONTROL: a real board');
  assert.equal(ab.inKtRunRoot('/var/T/ktx9'), false, 'CONTROL: a folder that only starts with kt');
  assert.equal(ab.inKtRunRoot('C:\\Users\\kt1\\AppData\\Local\\Temp'), false, 'CONTROL: a Windows user named kt1');
  assert.equal(ab.inKtRunRoot('/home/kt12/tmp'), false, 'CONTROL: a home folder named kt12');
  assert.equal(ab.inKtRunRoot('/var/TEMP/kt3'), false, 'CONTROL: the machine-wide rule is case-sensitive, nothing wider');
  assert.equal(ab.inKtRunRoot(undefined), false, 'CONTROL: no temp folder');
  assert.equal(ab.isInstalled(), true, 'fixture: the earlier test installed the fake tree');
  /* This process IS a test and its runners folder IS sandboxed: it writes. */
  assert.equal(ab.launchConfig({ platform: 'win32', node: 'C:\\T\\node.exe', env: {} }), ab.configPath(),
    'a sandboxed test run was refused');
});

/* kosmos#8928: one config and one output folder per agent, named for it; no name keeps the shared file. */
test('#8928 each agent gets its own config and output folder; a hostile name stays inside; CONTROL: no name keeps the shared file', (t) => {
  /* Only the two folders this test makes, by test-only names: run directly, os.tmpdir() is the real temp folder, where
     live agents' output folders sit beside them. */
  t.after(() => {
    for (const n of ['t8928-alpha', 't8928-beta']) { try { fs.rmSync(ab.outputDir(n), { recursive: true, force: true }); } catch { /* best effort */ } }
    try { fs.rmdirSync(path.dirname(ab.outputDir('t8928-alpha'))); } catch { /* not empty (live agents' folders) or gone: left as it is */ }
  });
  assert.equal(ab.isInstalled(), true, 'fixture: the earlier test installed the fake tree');
  const a = ab.launchConfig({ platform: 'win32', node: 'C:\\T\\node.exe', env: {}, agent: 't8928-alpha' });
  const b = ab.launchConfig({ platform: 'win32', node: 'C:\\T\\node.exe', env: {}, agent: 't8928-beta' });
  assert.equal(a, path.join(ab.homeDir(), 'agents', 't8928-alpha.json'));
  assert.equal(b, path.join(ab.homeDir(), 'agents', 't8928-beta.json'));
  const args = (f) => JSON.parse(fs.readFileSync(f, 'utf8')).mcpServers['kosmos-browser'].args;
  const out = (f) => args(f)[args(f).indexOf('--output-dir') + 1];
  assert.equal(out(a), path.join(os.tmpdir(), 'kosmos-agent-browser', 't8928-alpha'), 'the output folder names the agent');
  assert.ok(fs.statSync(out(a)).isDirectory(), 'the agent\'s output folder exists before its server starts');
  assert.equal(out(b), path.join(os.tmpdir(), 'kosmos-agent-browser', 't8928-beta'));
  /* Every name, hostile or not, lands directly in the agents folder with a key of only safe characters. */
  const names = ['../../escape', 'a/b', 'a\\b', '..', '.', '_', 'a b', 'a_b', 'Foo', 'foo', 'con', 'NUL.txt', 'com1', 'a.', 'a', 'x'.repeat(300), '\u65e5\u672c'];
  for (const n of names) {
    const k = ab.agentKey(n);
    assert.match(k, /^[a-z0-9._-]{1,49}(~[0-9a-f]{8})?$/, 'unsafe key for ' + JSON.stringify(n) + ': ' + k);
    assert.ok(!/\.$/.test(k), 'a key ends in a dot: ' + k);
    assert.ok(!/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/.test(k), 'a Windows device name: ' + k);
    assert.equal(path.dirname(ab.configPath(n)), path.join(ab.homeDir(), 'agents'), 'left the agents folder: ' + JSON.stringify(n));
    assert.equal(path.dirname(ab.outputDir(n)), path.join(os.tmpdir(), 'kosmos-agent-browser'), 'output left its parent: ' + JSON.stringify(n));
  }
  /* Distinct names never share a file, even when they clean to the same text or differ only by case. */
  const keys = names.map((n) => ab.agentKey(n).toLowerCase());
  assert.equal(new Set(keys).size, names.length, 'two names share a key: ' + JSON.stringify(keys));
  assert.equal(ab.agentKey('mona-lisa'), 'mona-lisa', 'CONTROL: an ordinary name is used as it is');
  assert.equal(ab.agentKey(''), '', 'CONTROL: no name keeps the shared file');
  const shared = ab.launchConfig({ platform: 'win32', node: 'C:\\T\\node.exe', env: {} });
  assert.equal(shared, path.join(ab.homeDir(), 'mcp-config.json'), 'CONTROL: no name keeps the shared file');
  assert.equal(out(shared), path.join(os.tmpdir(), 'kosmos-agent-browser'));
});

/* kosmos#8928 slice 2: which leftover servers are ended. Every "never touch" case over a plain table. */
test('#8928 slice 2: only this agent\'s own server whose parent is gone is selected; CONTROL: every near miss is left', async (t) => {
  t.after(() => {   // only the output folder this test's launch makes, and the parent only if empty
    try { fs.rmSync(ab.outputDir('t8928-orphan'), { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmdirSync(path.dirname(ab.outputDir('t8928-orphan'))); } catch { /* not empty or gone */ }
  });
  const cli = '/R/playwright-mcp/0.0.82/node_modules/@playwright/mcp/cli.js';
  const mine = '/T/kosmos-agent-browser/mona';
  const cmd = (dir, c) => '/K/node ' + (c || cli) + ' --browser chromium --headless --isolated --output-dir ' + dir;
  const procs = [
    { pid: 101, ppid: 1, command: cmd(mine) },                                    // mine, orphaned: ENDED
    { pid: 102, ppid: 900, command: cmd(mine) },                                  // mine, parent alive: left
    { pid: 103, ppid: 1, command: cmd('/T/kosmos-agent-browser/mona-lisa') },     // another agent whose name starts the same: left
    { pid: 104, ppid: 1, command: cmd('/T/kosmos-agent-browser/pigeonpete') },    // another agent: left
    { pid: 105, ppid: 1, command: cmd(mine, '/OTHER/node_modules/@playwright/mcp/cli.js') },   // another install: left
    { pid: 106, ppid: 1, command: 'vim ' + mine },                                // not a server: left
    { pid: 107, ppid: 1, command: cmd('/T/kosmos-agent-browser') },               // the shared folder: left
    { pid: 108, ppid: 901, command: cmd(mine) },                                  // mine, parent gone (not 1): ENDED
    { pid: 109, ppid: 1, command: '"C:\\K\\node.exe" "' + cli + '" --output-dir "' + mine + '"' },   // quoted, Windows style: ENDED
    { pid: 110, ppid: 1, command: cmd(mine) },                                    // this very process: left
  ];
  const alive = new Set([900]);
  const got = ab.orphanedServers(procs, { cli, outputDir: mine, self: 110, parentGone: (pp) => pp === 1 || !alive.has(pp) });
  assert.deepEqual(got, [101, 108, 109]);
  assert.deepEqual(ab.orphanedServers(procs, { cli, outputDir: mine }), [], 'CONTROL: with no way to tell a parent is gone, nothing is selected');
  assert.deepEqual(ab.orphanedServers(procs, { cli: '', outputDir: mine, parentGone: () => true }), [], 'CONTROL: no cli path, nothing');
  /* endOrphanedServers: children first, then the server; each pid re-read before it is ended and skipped unless it is
     still what was selected; a failure ending one does not stop the rest. */
  const dir = ab.outputDir('t8928-orphan');
  const table = [
    { pid: 201, ppid: 1, command: cmd(dir, ab.cliPath()) },        // orphaned server
    { pid: 211, ppid: 201, command: 'chrome-headless-shell --a' },  // its browser
    { pid: 212, ppid: 211, command: 'chrome renderer' },            // the browser's child
    { pid: 202, ppid: 1, command: cmd(dir, ab.cliPath()) },        // a second orphaned server, whose pid is reused before the end
    { pid: 203, ppid: 1, command: cmd(ab.outputDir('t8928-other'), ab.cliPath()) },
  ];
  const ended = [];
  const r = ab.endOrphanedServers('t8928-orphan', {
    platform: 'darwin', procs: () => table, alive: () => true,
    recheck: (pid) => (pid === 202 ? { pid, ppid: 77, command: 'something else now' } : table.find((x) => x.pid === pid) || null),
    end: (pid) => { if (pid === 212) throw new Error('ESRCH'); ended.push(pid); },
  });
  assert.deepEqual(ended, [211, 201], 'the browser, then its server; the reused pid 202 and the other agent are left');
  assert.deepEqual(r, [211, 201], 'a pid that could not be ended is not reported as ended');
  assert.deepEqual(ab.endingOrder(table, 201), [{ pid: 212, parent: 211 }, { pid: 211, parent: 201 }, { pid: 201, parent: null }], 'deepest first');
  /* A child that has moved to another parent by the time it is ended is left. */
  const moved = [];
  ab.endOrphanedServers('t8928-orphan', {
    platform: 'darwin', procs: () => table.slice(0, 2), alive: () => true,
    recheck: (pid) => (pid === 211 ? { pid, ppid: 999, command: 'x' } : table.find((x) => x.pid === pid)),
    end: (pid) => moved.push(pid),
  });
  assert.deepEqual(moved, [201], 'a re-parented child is not ended');
  assert.deepEqual(ab.endOrphanedServers('', { procs: () => { throw new Error('must not be asked'); } }), [], 'CONTROL: no name, no listing');
  /* Inside a node --test process nothing is listed or signalled unless an ender is handed in. */
  /* launchConfig really calls it, for the agent it launches, on its own platform. */
  const viaLaunch = [];
  assert.ok(ab.launchConfig({ platform: 'win32', node: 'C:\\K\\node.exe', env: {}, agent: 't8928-orphan', orphans: {
    platform: 'darwin', procs: () => table, alive: () => true, recheck: (pid) => table.find((x) => x.pid === pid) || null,
    end: (pid) => viaLaunch.push(pid) } }));
  assert.deepEqual(viaLaunch, [212, 211, 201, 202], 'launchConfig ended the agent\'s orphaned servers and their browsers');
  /* Each one ended is written down. */
  const log = fs.readFileSync(path.join(ab.homeDir(), 'ended-servers.log'), 'utf8');
  assert.match(log, / t8928-orphan pid 201 .*--output-dir/);
  /* Windows: one fresh listing, each pid alone, and a "child" created before its server (a reused parent pid) is never
     ended. Async, so the launch never waits on it. */
  const wtable = [
    { pid: 301, ppid: 50, created: '20261123120000.000000', command: '"C:\\K\\node.exe" "' + ab.cliPath() + '" --output-dir "' + dir + '"' },
    { pid: 311, ppid: 301, created: '20261123120001.000000', command: 'chrome.exe --headless' },
    { pid: 321, ppid: 301, created: '20261123110000.000000', command: 'notepad.exe' },   // older than 301: its parent pid was reused
  ];
  const wended = [];
  const pending = ab.endOrphanedServers('t8928-orphan', { platform: 'win32', procs: () => wtable, alive: (pid) => pid !== 50, end: async (pid) => { wended.push(pid); } });
  assert.equal(typeof pending.then, 'function', 'Windows answers a promise: the launch does not wait');
  assert.deepEqual(await pending, [311, 301]);
  assert.deepEqual(wended, [311, 301], 'the older process under a reused parent pid was not spared');
  assert.deepEqual(await ab.endOrphanedServers('t8928-orphan', { platform: 'win32', procs: () => wtable, alive: () => true, end: async (pid) => { wended.push(pid); } }), [], 'CONTROL: a live parent on Windows, nothing ended');
  let asked = false;
  assert.deepEqual(ab.endOrphanedServers('t8928-orphan', { platform: 'darwin', procs: () => { asked = true; return []; } }), []);
  assert.equal(asked, false, 'a test process with no ender listed processes (it must stop before, so it can never signal one)');
});

/* ── the Mac half (#3633) ───────────────────────────────────────────────── */

const shellSeams = (arch, over) => Object.assign({
  arch,
  download: async (url, file) => fs.writeFileSync(file, url),
  expectBytes: Buffer.byteLength(ab.SHELL.builds[arch] ? ab.SHELL.builds[arch].url : ''),   // the fake body is the url
  sha256Of: async () => ab.SHELL.builds[arch].sha256,
  unzip: async (zip, dest) => {
    const d = path.join(dest, ab.SHELL.builds[arch].folder);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'chrome-headless-shell'), '');
  },
  proveShell: async () => 'Google Chrome for Testing ' + ab.SHELL.version + '\n',
}, over || {});

/* Fixtures, so each Mac test makes the state it needs rather than leaning on an
   earlier test's leftovers. Idempotent: a no-op when the state is already there. */
const ensureHome = () => fs.mkdirSync(ab.homeDir(), { recursive: true });
const ensureTree = async () => { if (!ab.isInstalled()) assert.equal((await ab.ensureInstalled(fakeSeams())).ok, true); };
const ensureShellFor = async (arch) => {
  await ensureTree();
  if (!ab.shellInstalled(arch)) assert.equal((await ab.ensureShell(shellSeams(arch))).ok, true);
};

test('the Mac pin: one sha256-pinned headless shell per Mac CPU, at the version the pinned Playwright asks for', () => {
  assert.equal(ab.SHELL.version, '154.0.8037.0');
  for (const arch of ['arm64', 'x64']) {
    const b = ab.SHELL.builds[arch];
    assert.equal(b.url, 'https://cdn.playwright.dev/builds/cft/' + ab.SHELL.version + '/mac-' + arch + '/chrome-headless-shell-mac-' + arch + '.zip');
    assert.match(b.sha256, /^[0-9a-f]{64}$/);
  }
  assert.ok(Object.isFrozen(ab.SHELL) && Object.isFrozen(ab.SHELL.builds.arm64), 'the trust anchors cannot be repointed in-process');
});

test('the Mac config: the pinned shell by path, headless, isolated, and nothing that reaches the person\'s browser', () => {
  assert.throws(() => ab.configFor({ platform: 'darwin', node: '/K/node', cli: '/R/cli.js', outputDir: '/T/out' }),
    /needs the shell/, 'a Mac config with no path never becomes an Edge config');
  const cfg = ab.configFor({ platform: 'darwin', node: '/K/node', cli: '/R/cli.js', outputDir: '/T/out', executablePath: '/R/shell' });
  assert.deepEqual(cfg.mcpServers['kosmos-browser'].args,
    ['/R/cli.js', '--browser', 'chromium', '--executable-path', '/R/shell', '--headless', '--isolated', '--output-dir', '/T/out']);
  const args = cfg.mcpServers['kosmos-browser'].args;
  for (const never of ['--extension', '--user-data-dir', '--cdp-endpoint', '--profile-dir-name', 'chrome', 'msedge']) {
    assert.ok(!args.includes(never), never + ' would reach an installed browser or a profile');
  }
});

test('a Mac CPU with no pinned build installs nothing and says so', async () => {
  const r = await ab.ensureShell({ arch: 'ppc' });
  assert.equal(r.ok, false);
  assert.match(r.because, /no pinned browser/);
});

test('a shell checksum mismatch installs nothing', async () => {
  const r = await ab.ensureShell(shellSeams('arm64', { sha256Of: async () => '0'.repeat(64) }));
  assert.equal(r.ok, false);
  assert.match(r.because, /checksum/);
  assert.equal(ab.shellInstalled('arm64'), false);
  assert.deepEqual(fs.readdirSync(ab.homeDir()).filter((f) => f.startsWith('.shell-staging')), [], 'staging cleaned up');
});

test('a shell that does not answer with its version installs nothing', async () => {
  const r = await ab.ensureShell(shellSeams('arm64', { proveShell: async () => 'something else' }));
  assert.equal(r.ok, false);
  assert.equal(ab.shellInstalled('arm64'), false);
  assert.deepEqual(fs.readdirSync(ab.homeDir()).filter((f) => f.startsWith('.shell-staging')), [], 'staging cleaned up');
});

test('a proven shell, then a Mac launch gets a flag for a file naming exactly that shell', async () => {
  await ensureTree();
  fs.rmSync(ab.shellDir('arm64'), { recursive: true, force: true });
  assert.equal(ab.launchConfig({ platform: 'darwin', arch: 'arm64', install: false , env: {} }), null,
    'the server alone is not enough on a Mac: no shell, no flag');
  assert.deepEqual(await ab.ensureShell(shellSeams('arm64')), { ok: true });
  assert.equal(ab.shellInstalled('arm64'), true);
  assert.equal(ab.shellInstalled('x64'), false, 'a marker for one CPU never vouches for the other');
  assert.deepEqual(await ab.ensureShell(shellSeams('arm64', { download: async () => { throw new Error('must not download again'); } })),
    { ok: true, already: true });

  const p = ab.launchConfig({ platform: 'darwin', arch: 'arm64', node: '/K/node', install: false , env: {} });
  assert.equal(p, ab.configPath());
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')),
    ab.configFor({ platform: 'darwin', node: '/K/node', cli: ab.cliPath(), outputDir: ab.outputDir(), executablePath: ab.shellExe('arm64') }));
  assert.equal(ab.launchConfig({ platform: 'darwin', arch: 'x64', install: false , env: {} }), null, 'the other CPU is not installed');
});

/* kosmos#8929, the path the bug took: the supervisor's shim, as a child process, with NO runners sandbox, so it falls
   back to HOME's .local/share/kosmos/runners as it does from a worktree. HOME is a sandbox holding a copy of the fake
   install, so the fallback lands on a file this test owns. */
test('#8929 the shim inside a test run leaves the fallback config untouched; CONTROL: outside a test run it writes it', { skip: process.platform !== 'darwin' && 'the shim writes a config only on a Mac or Windows; this arm runs where the suite runs, a Mac' }, (t) => {
  const { spawnSync } = require('node:child_process');
  assert.equal(ab.isInstalled(), true, 'fixture: the fake tree is installed');
  assert.equal(ab.shellInstalled(), true, 'fixture: this CPU\'s fake shell is installed (the Mac test above)');
  const home = path.join(SANDBOX, 'home-8929');
  const root = path.join(home, '.local', 'share', 'kosmos', 'runners');
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(ab.homeDir(), path.join(root, 'playwright-mcp'), { recursive: true });
  fs.rmSync(path.join(root, 'playwright-mcp', 'agents'), { recursive: true, force: true });   // the copy carries earlier tests' per-agent files
  const cfg = path.join(root, 'playwright-mcp', 'mcp-config.json');
  fs.writeFileSync(cfg, 'LIVE CONFIG 8929\n');
  /* Review 2: the plain temp folder must sit OUTSIDE any run root. Under tools/run-tests.sh this file's own os.tmpdir()
     IS a kt<pid> run root, so a folder made inside SANDBOX would count as a test run and the controls would go silent. */
  const plainTmp = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'plain-tmp-8929-')));
  t.after(() => { try { fs.rmSync(plainTmp, { recursive: true, force: true }); } catch { /* best effort */ } });
  assert.equal(ab.inKtRunRoot(plainTmp), false, 'fixture: the plain temp folder is not itself inside a run root');
  const runRoot = path.join(SANDBOX, 'tmp', 'kt8929');
  fs.mkdirSync(runRoot, { recursive: true });
  const base = { ...process.env, HOME: home, TMPDIR: plainTmp };
  for (const k of ['AGENT_WORKFORCE_RUNNERS_DIR', 'NODE_TEST_CONTEXT', 'KOSMOS_TEST_RUN', 'KOSMOS_AGENT_BROWSER']) delete base[k];
  const shim = path.join(__dirname, 'agent-browser-config.js');
  const run = (extra, name) => spawnSync(process.execPath, name ? [shim, name] : [shim], { env: { ...base, ...extra }, encoding: 'utf8', timeout: 30000 });
  /* kosmos#8928: the supervisor now passes the agent's name, so every refusing arm is also run with one, and the
     per-agent folder under the fallback root must stay absent. */
  const agentsDir = path.join(root, 'playwright-mcp', 'agents');
  const refusesNamed = (extra, what) => {
    const r = run(extra, 'mona-lisa');
    assert.equal(r.status, 0, 'the shim exited');
    assert.equal(r.stdout.trim(), '', what + ', named, asked for a config');
    assert.equal(fs.existsSync(agentsDir), false, what + ', named, wrote under the fallback agents folder');
  };
  /* Two arms below are meant to WRITE. Before any arm runs, ask a child with the same env where the runners folder is:
     from an installed layout managedRoot() ignores HOME and names the real install's folder, and those arms would
     then rewrite the live config, the damage this card is about. */
  const where = spawnSync(process.execPath, ['-e', 'process.stdout.write(require(process.argv[1]).managedRoot())', path.join(__dirname, 'runners.js')],
    { env: base, encoding: 'utf8', timeout: 30000 });
  assert.equal(where.status === 0 && path.resolve(where.stdout), root,
    'the runners folder does not resolve into this test\'s HOME, so a writing arm could reach a real one; no arm ran');
  refusesNamed({ KOSMOS_TEST_RUN: runRoot, TMPDIR: runRoot }, 'the shim inside a test run');
  const inRun = run({ KOSMOS_TEST_RUN: runRoot, TMPDIR: runRoot });
  assert.equal(inRun.status, 0);
  assert.equal(inRun.stdout.trim(), '', 'the shim inside a test run asked for a config');
  assert.equal(fs.readFileSync(cfg, 'utf8'), 'LIVE CONFIG 8929\n', 'the shim inside a test run rewrote the fallback config');
  /* A node --test test that spawns the shim with its own env: NODE_TEST_CONTEXT and nothing else. */
  refusesNamed({ NODE_TEST_CONTEXT: 'child-v8' }, 'a node --test child');
  const nodeTest = run({ NODE_TEST_CONTEXT: 'child-v8' });
  assert.equal(nodeTest.status, 0, 'the shim exited');
  assert.equal(nodeTest.stdout.trim(), '', 'a node --test child asked for a config');
  assert.equal(fs.readFileSync(cfg, 'utf8'), 'LIVE CONFIG 8929\n', 'a node --test child rewrote the fallback config');
  /* The store's rule alone: KOSMOS_TEST_RUN names a plain folder and the temp folder is inside it, no kt folder. */
  const storeOnly = path.join(plainTmp, 'run-sub');
  fs.mkdirSync(storeOnly, { recursive: true });
  refusesNamed({ KOSMOS_TEST_RUN: plainTmp, TMPDIR: storeOnly }, 'a run-tests.sh child with no kt folder');
  const byStore = run({ KOSMOS_TEST_RUN: plainTmp, TMPDIR: storeOnly });
  assert.equal(byStore.status, 0, 'the shim exited');
  assert.equal(byStore.stdout.trim(), '', 'a run-tests.sh child with no kt folder asked for a config');
  assert.equal(fs.readFileSync(cfg, 'utf8'), 'LIVE CONFIG 8929\n', 'a run-tests.sh child with no kt folder rewrote the fallback config');
  /* Review 1: a test that scrubbed its environment (no markers at all) but kept the run's temp folder. */
  refusesNamed({ TMPDIR: runRoot }, 'a scrubbed test child');
  const scrubbed = run({ TMPDIR: runRoot });
  assert.equal(scrubbed.status, 0, 'the shim exited');
  assert.equal(scrubbed.stdout.trim(), '', 'a scrubbed test child with a run root as its temp folder asked for a config');
  assert.equal(fs.readFileSync(cfg, 'utf8'), 'LIVE CONFIG 8929\n', 'a scrubbed test child rewrote the fallback config');
  /* Review 1, CONTROL for the store's rule: the variable alone, with a plain temp folder, is not a test run. */
  const stray = run({ KOSMOS_TEST_RUN: runRoot });
  assert.equal(stray.status, 0, 'the shim exited');
  assert.equal(stray.stdout.trim(), cfg, 'CONTROL: a stray KOSMOS_TEST_RUN switched a real launch off');
  fs.writeFileSync(cfg, 'LIVE CONFIG 8929\n');
  const outside = run({});
  assert.equal(outside.status, 0);
  assert.equal(outside.stdout.trim(), cfg, 'CONTROL: outside a test run the shim did not write (the guard is what refused above)');
  assert.notEqual(fs.readFileSync(cfg, 'utf8'), 'LIVE CONFIG 8929\n');
  /* CONTROL for the named arms: outside a test run a named launch does write its own file, so the absence above is the
     guard refusing, not a name that never reaches the writer. */
  const named = run({}, 'mona-lisa');
  assert.equal(named.status, 0);
  assert.equal(named.stdout.trim(), path.join(agentsDir, 'mona-lisa.json'), 'CONTROL: a named launch outside a test run did not write its own file');
});

test('the supervisor shim prints the path once installed, prints nothing otherwise, and always exits 0', async (t) => {
  const { spawnSync } = require('node:child_process');
  const shim = path.join(__dirname, 'agent-browser-config.js');
  /* Without NODE_TEST_CONTEXT, which would stop kickInstall on its own and hide a
     shim that asked for an install: a started install creates its staging folder
     before its first await, so an empty folder here is a real observation. */
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.KOSMOS_AGENT_BROWSER;                           // an operator's own opt-out must not decide this test
  /* A timeout, so a regressed shim that starts a real download shows up red rather
     than waiting on the network. */
  const run = (env) => spawnSync(process.execPath, [shim], { env: { ...childEnv, ...env }, encoding: 'utf8', timeout: 20000 });
  const empty = fs.mkdtempSync(path.join(SANDBOX, 'empty-'));
  const none = run({ AGENT_WORKFORCE_RUNNERS_DIR: empty });
  assert.equal(none.status, 0);
  assert.equal(none.stdout, '', 'nothing installed: no path');
  assert.deepEqual(fs.readdirSync(empty), [], 'and the shim never starts an install');
  /* The installed arm needs this host to be a Mac with a pinned build: the shim asks
     for this host's platform and CPU, as the real supervisor does. */
  if (!(process.platform === 'darwin' && ab.SHELL.builds[process.arch])) {
    t.diagnostic('installed arm skipped: this host is not a Mac with a pinned browser build');
  } else {
    await ensureShellFor(process.arch);
    const got = run({ AGENT_WORKFORCE_RUNNERS_DIR: process.env.AGENT_WORKFORCE_RUNNERS_DIR });
    assert.equal(got.status, 0);
    const printed = got.stdout.trim();
    assert.equal(printed, ab.configPath());
    assert.ok(fs.existsSync(printed), 'the path names a file that exists');
  }
});

test('the opt-out file turns the browser off on a Mac, where the supervisor never sees the operator\'s env', async () => {
  await ensureShellFor('arm64');
  assert.ok(ab.launchConfig({ platform: 'darwin', arch: 'arm64', install: false, env: {} }), 'on before the file');
  fs.writeFileSync(ab.optOutPath(), '');
  try {
    assert.equal(ab.disabled({}), true);
    assert.equal(ab.launchConfig({ platform: 'darwin', arch: 'arm64', install: false, env: {} }), null);
    let kicked = 0;
    ab.installWithRetry({ env: {}, log: () => {}, kick: () => { kicked += 1; return Promise.resolve({ ok: true }); } })();
    assert.equal(kicked, 0, 'an opted-out board does not download anything');
  } finally { fs.rmSync(ab.optOutPath(), { force: true }); }
});

test('one Mac browser install at a time: a live owner\'s lock refuses, a dead owner\'s lock is taken over', { skip: process.platform !== 'darwin' ? 'uses 999999 as a pid that cannot exist, true only on macOS' : false }, async () => {
  ensureHome();
  fs.rmSync(ab.shellDir('arm64'), { recursive: true, force: true });
  fs.writeFileSync(ab.lockPath(), String(process.ppid));          // alive: the test runner
  let r = await ab.ensureShell(shellSeams('arm64'));
  assert.equal(r.ok, false);
  assert.match(r.because, /another browser install/);
  assert.equal(fs.readFileSync(ab.lockPath(), 'utf8'), String(process.ppid), 'a live owner\'s lock is left alone');

  /* An empty lock, touched just now: created by a live owner that has not written
     its pid yet. It must not be taken. */
  fs.writeFileSync(ab.lockPath(), '');
  r = await ab.ensureShell(shellSeams('arm64'));
  assert.equal(r.ok, false, 'a fresh lock with no readable pid is live');
  assert.match(r.because, /another browser install/);

  fs.writeFileSync(ab.lockPath(), '999999');                      // no such process on macOS (pids stop at 99998)
  r = await ab.ensureShell(shellSeams('arm64'));
  assert.deepEqual(r, { ok: true });
  assert.equal(fs.existsSync(ab.lockPath()), false, 'the lock is released after the install');

  /* A live pid whose heartbeat stopped: a dead owner whose pid was reused. */
  fs.rmSync(ab.shellDir('arm64'), { recursive: true, force: true });
  fs.writeFileSync(ab.lockPath(), String(process.ppid));
  const quiet = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(ab.lockPath(), quiet, quiet);
  r = await ab.ensureShell(shellSeams('arm64'));
  assert.deepEqual(r, { ok: true }, 'a lock that stopped beating is taken over even though its pid is alive');
});

test('an install sweeps what interrupted ones left: dead owners\' staging and old versions, never a live owner\'s', { skip: process.platform !== 'darwin' ? 'uses 999999 and 999998 as pids that cannot exist, true only on macOS' : false }, async () => {
  fs.rmSync(ab.shellDir('arm64'), { recursive: true, force: true });
  const home = ab.homeDir();
  const dead = path.join(home, '.shell-staging-999999-1');
  const deadTree = path.join(home, '.staging-999998-1');
  const live = path.join(home, '.shell-staging-' + process.ppid + '-1');
  const oldest = path.join(home, 'chrome-headless-shell', '1.0.0');
  const previous = path.join(home, 'chrome-headless-shell', '2.0.0');
  for (const d of [dead, deadTree, live, oldest, previous]) fs.mkdirSync(d, { recursive: true });
  const long = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(oldest, long, long);
  assert.deepEqual(await ab.ensureShell(shellSeams('arm64')), { ok: true });
  assert.equal(fs.existsSync(dead), false);
  assert.equal(fs.existsSync(deadTree), false);
  assert.equal(fs.existsSync(oldest), false, 'versions older than the previous one are removed');
  assert.equal(fs.existsSync(previous), true, 'the previous version stays for agents still running under it');
  fs.rmSync(previous, { recursive: true, force: true });

  /* Version order, not modification time, and only version-named folders. */
  fs.rmSync(ab.shellDir('arm64'), { recursive: true, force: true });
  const shells = path.join(home, 'chrome-headless-shell');
  const v9 = path.join(shells, '9.0.0'); const v10 = path.join(shells, '10.0.0'); const v2 = path.join(shells, '2.0.0');
  for (const d of [v9, v10, v2]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(shells, '.DS_Store'), '');
  const later = new Date(Date.now() + 60 * 1000);
  fs.utimesSync(v2, later, later);                                // newest by mtime, oldest by version
  assert.deepEqual(await ab.ensureShell(shellSeams('arm64')), { ok: true });
  assert.equal(fs.existsSync(v10), true, '10.0.0 is the highest other version, so it is kept');
  assert.equal(fs.existsSync(v9), false);
  assert.equal(fs.existsSync(v2), false, 'a recent mtime does not save a lower version');
  fs.rmSync(v10, { recursive: true, force: true });
  fs.rmSync(path.join(shells, '.DS_Store'), { force: true });
  assert.equal(fs.existsSync(live), true, 'a staging folder whose owner is running is not touched');
  fs.rmSync(live, { recursive: true, force: true });
});

test('the board retries a failed install with backoff, says why each time, and stops at success', async () => {
  const lines = [];
  const results = [{ ok: false, because: 'no network' }, { ok: false, because: 'still no network' }, { ok: true }];
  let calls = 0;
  const done = new Promise((resolve) => {
    ab.installWithRetry({
      env: {}, firstDelayMs: 5, maxDelayMs: 20, log: (l) => lines.push(l),
      kick: () => { const r = results[calls]; calls += 1; if (calls === results.length) setTimeout(resolve, 30); return Promise.resolve(r); },
    });
  });
  await done;
  assert.equal(calls, 3, 'tried until it succeeded, then stopped');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /no network/);
  assert.match(lines[1], /still no network/);
  assert.match(lines[2], /installed/, 'a success after retries is logged, so the log does not end on failures');
});

test('installing one Mac CPU\'s shell never touches another\'s', async () => {
  /* The shim test installs this host's CPU, which is x64 on an Intel Mac. */
  fs.rmSync(ab.shellDir('x64'), { recursive: true, force: true });
  await ensureShellFor('arm64');
  assert.deepEqual(await ab.ensureShell(shellSeams('x64')), { ok: true });
  assert.equal(ab.shellInstalled('x64'), true);
  assert.equal(ab.shellInstalled('arm64'), true, 'the arm64 install survives an x64 install');
  assert.ok(fs.existsSync(ab.shellExe('arm64')) && fs.existsSync(ab.shellExe('x64')));
  assert.notEqual(ab.shellDir('arm64'), ab.shellDir('x64'));
});

test('a sandboxed board (AGENT_WORKFORCE_DRY_RUN=1) never starts the browser download', () => {
  let kicked = 0;
  ab.installWithRetry({ env: { AGENT_WORKFORCE_DRY_RUN: '1' }, kick: () => { kicked += 1; return Promise.resolve({ ok: true }); } })();
  assert.equal(kicked, 0);
});

test('a lock that cannot be written says why, not "another install is running"', { skip: process.platform === 'win32' ? 'a read-only folder does not stop file creation on Windows' : (process.getuid && process.getuid() === 0 ? 'root ignores the read-only folder this relies on' : false) }, async () => {
  ensureHome();
  fs.rmSync(ab.shellDir('arm64'), { recursive: true, force: true });
  fs.rmSync(ab.lockPath(), { force: true });
  fs.chmodSync(ab.homeDir(), 0o555);                              // the lock file cannot be created
  try {
    const r = await ab.ensureShell(shellSeams('arm64'));
    assert.equal(r.ok, false);
    assert.match(r.because, /EACCES|permission/i);
  } finally { fs.chmodSync(ab.homeDir(), 0o755); }
});

test('an install never replaces a proven one that appeared while it was downloading', async () => {
  fs.rmSync(ab.shellDir('arm64'), { recursive: true, force: true });
  let otherMarker = '';
  const r = await ab.ensureShell(shellSeams('arm64', {
    download: async (url, file) => {
      /* Another process's install lands first, while this one is still downloading:
         a proven folder (binary + marker), exactly what its swap leaves. */
      const b = ab.SHELL.builds.arm64;
      const other = ab.shellDir('arm64');
      fs.mkdirSync(path.join(other, b.folder), { recursive: true });
      fs.writeFileSync(path.join(other, b.folder, 'chrome-headless-shell'), 'the other install');
      otherMarker = ab.SHELL.version + ' arm64 ' + b.sha256 + '\n';
      fs.writeFileSync(path.join(other, '.verified'), otherMarker);
      fs.writeFileSync(file, url);
    },
  }));
  assert.equal(r.ok, true);
  assert.equal(ab.shellInstalled('arm64'), true);
  assert.equal(fs.readFileSync(path.join(ab.shellDir('arm64'), '.verified'), 'utf8'), otherMarker, 'the first proven install is the one in place');
  assert.equal(fs.readFileSync(ab.shellExe('arm64'), 'utf8'), 'the other install', 'its binary was not replaced');
});

test('the board stops retrying after three failures in a row past a complete download, and says so', async () => {
  const lines = [];
  let calls = 0;
  await new Promise((resolve) => {
    ab.installWithRetry({
      env: {}, firstDelayMs: 5, maxDelayMs: 10, log: (l) => { lines.push(l); if (/not trying again/.test(l)) setTimeout(resolve, 40); },
      kick: () => { calls += 1; return Promise.resolve({ ok: false, afterDownload: true, because: 'the browser did not answer with its version' }); },
    });
  });
  assert.equal(calls, 3);
  assert.match(lines[lines.length - 1], /3 times in a row \(the browser did not answer/);
});

test('a download of the wrong size (a captive portal\'s page) is a network problem, not a checksum mismatch', async () => {
  fs.rmSync(ab.shellDir('arm64'), { recursive: true, force: true });
  const r = await ab.ensureShell(shellSeams('arm64', {
    download: async (url, file) => fs.writeFileSync(file, '<html>sign in to the wifi</html>'),
    sha256Of: async () => { throw new Error('the hash must not even be computed'); },
  }));
  assert.equal(r.ok, false);
  assert.match(r.because, /bytes, not the/);
  assert.doesNotMatch(r.because, /checksum/, 'so the board keeps retrying instead of giving up');
  assert.equal(ab.shellInstalled('arm64'), false);
});

test('kickInstall on a Mac installs the server and then the shell; on Windows, only the server', async () => {
  const seams = (arch) => Object.assign({}, fakeSeams(), shellSeams(arch), {
    download: async (url, file) => fs.writeFileSync(file, url),
  });
  const saved = process.env.AGENT_WORKFORCE_RUNNERS_DIR;
  try {
    process.env.AGENT_WORKFORCE_RUNNERS_DIR = fs.mkdtempSync(path.join(SANDBOX, 'kick-mac-'));
    const mac = await ab.kickInstall(Object.assign(seams('arm64'), { force: true, platform: 'darwin' }));
    assert.equal(mac.ok, true);
    assert.equal(ab.isInstalled(), true);
    assert.equal(ab.shellInstalled('arm64'), true, 'the Mac kick goes on to the shell');

    process.env.AGENT_WORKFORCE_RUNNERS_DIR = fs.mkdtempSync(path.join(SANDBOX, 'kick-win-'));
    const win = await ab.kickInstall(Object.assign(seams('arm64'), { force: true, platform: 'win32' }));
    assert.equal(win.ok, true);
    assert.equal(ab.isInstalled(), true);
    assert.equal(ab.shellInstalled('arm64'), false, 'a Windows kick never fetches the Mac shell');
  } finally { process.env.AGENT_WORKFORCE_RUNNERS_DIR = saved; }
});

test('the board stops for good when this Mac CPU has no pinned browser', async () => {
  const lines = [];
  let calls = 0;
  ab.installWithRetry({ env: {}, firstDelayMs: 5, log: (l) => lines.push(l),
    kick: () => { calls += 1; return ab.ensureShell({ arch: 'ppc' }); } });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls, 1, 'tried once, never again');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /not trying again/);
});

test('the retry delay doubles from the first delay and stops at the maximum', async () => {
  const delays = [];
  let calls = 0;
  await new Promise((resolve) => {
    ab.installWithRetry({
      env: {}, firstDelayMs: 100, maxDelayMs: 350, log: () => {},
      schedule: (fn, ms) => { delays.push(ms); setImmediate(fn); return null; },
      kick: () => { calls += 1; if (calls === 5) setImmediate(resolve); return Promise.resolve(calls === 5 ? { ok: true } : { ok: false, because: 'no network' }); },
    });
  });
  assert.deepEqual(delays, [100, 200, 350, 350]);
});

test('an opted-out board says so in its log', () => {
  const lines = [];
  ensureHome();
  fs.writeFileSync(ab.optOutPath(), '');
  try { ab.installWithRetry({ env: {}, log: (l) => lines.push(l), kick: () => Promise.resolve({ ok: true }) }); }
  finally { fs.rmSync(ab.optOutPath(), { force: true }); }
  assert.match(lines.join('\n'), /off \(opt-out\)/);
});

test('the CPU default has one source: every shell path defaults to hostArch()', () => {
  const a = ab.hostArch();
  assert.equal(a, process.arch);
  assert.equal(ab.shellDir(), ab.shellDir(a));
  assert.equal(ab.shellExe(), ab.shellExe(a));
  assert.equal(ab.shellInstalled(), ab.shellInstalled(a));
  /* Counted in the raw source, comments included: a mention in a comment over-counts
     (the safe direction), where stripping comments could hide a real read. */
  const src = fs.readFileSync(path.join(__dirname, 'agentbrowser.js'), 'utf8');
  assert.equal((src.match(/process\.arch/g) || []).length, 1, 'process.arch appears in exactly one place (hostArch)');
});

test('which step failed decides whether it counts toward giving up', async () => {
  fs.rmSync(ab.shellDir('arm64'), { recursive: true, force: true });
  const cut = await ab.ensureShell(shellSeams('arm64', { download: async (u, f) => fs.writeFileSync(f, 'x') }));
  assert.equal(cut.afterDownload, false, 'a cut download is a network problem');
  const hash = await ab.ensureShell(shellSeams('arm64', { sha256Of: async () => '0'.repeat(64) }));
  assert.equal(hash.afterDownload, true);
  const unzip = await ab.ensureShell(shellSeams('arm64', { unzip: async () => { throw new Error('ENOSPC'); } }));
  assert.equal(unzip.afterDownload, true);
  const prove = await ab.ensureShell(shellSeams('arm64', { proveShell: async () => 'nope' }));
  assert.equal(prove.afterDownload, true);
});

test('a lock or staging folder carrying our own pid, not held by us, is a leftover from before a restart', async () => {
  ensureHome();
  fs.rmSync(ab.shellDir('arm64'), { recursive: true, force: true });
  fs.writeFileSync(ab.lockPath(), String(process.pid));
  const mine = path.join(ab.homeDir(), '.shell-staging-' + process.pid + '-1');
  fs.mkdirSync(mine, { recursive: true });
  assert.deepEqual(await ab.ensureShell(shellSeams('arm64')), { ok: true });
  assert.equal(fs.existsSync(mine), false);
});

test('the board sweeps a dead install\'s leftovers at start, even when the shell is already installed', { skip: process.platform !== 'darwin' ? 'uses 999997 as a pid that cannot exist, true only on macOS' : false }, async () => {
  await ensureShellFor('arm64');
  const left = path.join(ab.homeDir(), '.staging-999997-1');
  fs.mkdirSync(left, { recursive: true });
  ab.installWithRetry({ env: {}, log: () => {}, kick: () => Promise.resolve({ ok: true, already: true }) })();
  assert.equal(fs.existsSync(left), false);
});

test('the board stops after its attempt ceiling for this run, whatever the cause, and says so', async () => {
  const lines = [];
  let calls = 0;
  await new Promise((resolve) => {
    ab.installWithRetry({
      env: {}, maxAttempts: 4, log: (l) => { lines.push(l); if (/attempts this run/.test(l)) resolve(); },
      schedule: (fn) => { setImmediate(fn); return null; },
      /* Ends on its own after 10 calls, so a missing ceiling fails below instead of spinning. */
      kick: () => { calls += 1; if (calls >= 10) setImmediate(resolve); return calls >= 10 ? Promise.resolve({ ok: true }) : Promise.resolve({ ok: false, afterDownload: false, because: 'the browser download was 5 bytes' }); },
    });
  });
  assert.equal(calls, 4);
  assert.match(lines[lines.length - 1], /4 attempts this run/);
});

test('a first-try install is logged; an install that was already there is not', async () => {
  const fresh = []; const already = [];
  ab.installWithRetry({ env: {}, log: (l) => fresh.push(l), kick: () => Promise.resolve({ ok: true }) });
  ab.installWithRetry({ env: {}, log: (l) => already.push(l), kick: () => Promise.resolve({ ok: true, already: true }) });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(fresh, ['agent browser: installed']);
  assert.deepEqual(already, []);
});

/* kosmos#8928 slice 2, end to end on a Mac with real processes: a stand-in "server" (a node script AT this sandbox's
   cli.js path, so it matches exactly) that starts its own stand-in "browser" child, orphaned by a parent that exits;
   the agent's next launch ends both. CONTROLS: a stand-in whose parent is alive, and one for another agent, survive
   with their children. Cleanup signals only processes it can still identify by this test's own marker. */
test('#8928 slice 2: an agent\'s launch ends its own orphaned server and its browser; CONTROL: a live-parented one and another agent\'s survive', { skip: process.platform !== 'darwin' && 'ppid 1 for an orphan is the macOS shape this arm uses' }, async (t) => {
  const { spawn, spawnSync } = require('node:child_process');
  await ensureShellFor(process.arch);
  const MARK = 't8928-e2e-stand-in';
  const cli = ab.cliPath();
  const keepCli = fs.readFileSync(cli);
  fs.writeFileSync(cli, "require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '" + MARK + "'], { stdio: 'ignore' });\nsetInterval(() => {}, 1000);\n");
  const table = () => spawnSync('/bin/ps', ['-axww', '-o', 'pid=,ppid=,stat=,command='], { encoding: 'utf8' }).stdout.split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l)).filter(Boolean).map((m) => ({ pid: +m[1], ppid: +m[2], stat: m[3], command: m[4] }));
  /* Only pids this test recorded, and only while each is still this test's stand-in: its command starts with this
     node binary and names the stand-in. Never a match on the marker alone: any process (a shell grepping for it, say)
     can carry the text. */
  const recorded = [];
  const stillOurs = (p) => p.command.startsWith(process.execPath + ' ') && (p.command.includes(MARK) || p.command.includes(cli));
  t.after(() => {
    const now = table();
    for (const x of now) if (recorded.includes(x.ppid) && !recorded.includes(x.pid)) recorded.push(x.pid);   // children not yet recorded
    for (const pid of recorded) {
      const p = now.find((x) => x.pid === pid);
      if (p && !p.stat.startsWith('Z') && stillOurs(p)) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    }
    fs.writeFileSync(cli, keepCli);
    for (const n of ['t8928-e2e', 't8928-e2e-other']) { try { fs.rmSync(ab.outputDir(n), { recursive: true, force: true }); } catch { /* best effort */ } }
    try { fs.rmdirSync(path.dirname(ab.outputDir('t8928-e2e'))); } catch { /* not empty or gone */ }
  });
  /* From ps state, not kill(pid, 0): an ended child of this process stays a zombie until reaped. */
  const alive = (pid) => { const p = table().find((x) => x.pid === pid); return !!p && !p.stat.startsWith('Z'); };
  const childOf = (pid) => (table().find((x) => x.ppid === pid && x.command.includes(MARK)) || {}).pid;
  const orphan = (agent) => {
    const r = spawnSync('/bin/sh', ['-c', '"$1" "$2" --output-dir "$3" >/dev/null 2>&1 & echo $!', 'sh', process.execPath, cli, ab.outputDir(agent)], { encoding: 'utf8' });
    const pid = Number(r.stdout.trim());
    assert.ok(pid > 1, 'fixture: the stand-in started');
    return pid;
  };
  const mine = orphan('t8928-e2e');
  const other = orphan('t8928-e2e-other');
  const live = spawn(process.execPath, [cli, '--output-dir', ab.outputDir('t8928-e2e')], { stdio: 'ignore' }).pid;
  recorded.push(mine, other, live);   // at once, so a failed fixture below still cleans them up
  const ppid = (pid) => (table().find((x) => x.pid === pid) || {}).ppid;
  for (let i = 0; i < 50 && (ppid(mine) !== 1 || ppid(other) !== 1 || !childOf(mine) || !childOf(other) || !childOf(live)); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(ppid(mine), 1, 'fixture: the stand-in is orphaned');
  const mineChild = childOf(mine);
  const otherChild = childOf(other);
  const liveChild = childOf(live);
  assert.ok(mineChild && otherChild && liveChild, 'fixture: each stand-in started its browser');
  recorded.push(mineChild, otherChild, liveChild);
  /* The real Mac ender, handed in on purpose: inside a test process nothing is signalled without one. */
  const ended = ab.endOrphanedServers('t8928-e2e', { platform: 'darwin', end: ab.defaultEnd('darwin') });
  assert.deepEqual(ended, [mineChild, mine], 'ended its browser, then the server');
  for (let i = 0; i < 50 && (alive(mine) || alive(mineChild)); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(alive(mine), false, 'the agent\'s own orphaned server was not ended');
  assert.equal(alive(mineChild), false, 'its browser was not ended');
  assert.equal(alive(live) && alive(liveChild), true, 'CONTROL: a server whose session is alive, or its browser, was ended');
  assert.equal(alive(other) && alive(otherChild), true, 'CONTROL: another agent\'s orphaned server, or its browser, was ended');
  /* And launchConfig calls it: in a test process with no ender it lists nothing and the launch still gets its config. */
  assert.ok(ab.launchConfig({ platform: 'darwin', arch: process.arch, install: false, env: {}, agent: 't8928-e2e' }), 'the launch still gets its config');
});
