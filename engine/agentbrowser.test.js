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

test('the supervisor shim prints the path once installed, prints nothing otherwise, and always exits 0', async (t) => {
  const { spawnSync } = require('node:child_process');
  const shim = path.join(__dirname, 'agent-browser-config.js');
  /* Without NODE_TEST_CONTEXT, which would stop kickInstall on its own and hide a
     shim that asked for an install: a started install creates its staging folder
     before its first await, so an empty folder here is a real observation. */
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.KOSMOS_AGENT_BROWSER;                           // an operator's own opt-out must not decide this test
  const run = (env) => spawnSync(process.execPath, [shim], { env: { ...childEnv, ...env }, encoding: 'utf8' });
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
    assert.equal((await ab.ensureShell(shellSeams(process.arch))).ok, true);
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

test('an install sweeps what interrupted ones left: dead owners\' staging and old versions, never a live owner\'s', async () => {
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

test('the board stops retrying after three checksum failures in a row, and says so', async () => {
  const lines = [];
  let calls = 0;
  await new Promise((resolve) => {
    ab.installWithRetry({
      env: {}, firstDelayMs: 5, maxDelayMs: 10, log: (l) => { lines.push(l); if (/not trying again/.test(l)) setTimeout(resolve, 40); },
      kick: () => { calls += 1; return Promise.resolve({ ok: false, because: 'the browser download did not match its pinned checksum, so it was not used' }); },
    });
  });
  assert.equal(calls, 3);
  assert.match(lines[lines.length - 1], /checksum 3 times in a row/);
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
    kick: () => { calls += 1; return Promise.resolve({ ok: false, because: 'no pinned browser for this Mac CPU (ppc)' }); } });
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
  const code = fs.readFileSync(path.join(__dirname, 'agentbrowser.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // comments do not read anything
  assert.equal((code.match(/process\.arch/g) || []).length, 1, 'process.arch is read in exactly one place (hostArch)');
});
