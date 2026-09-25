'use strict';
/**
 * The Gemini CLI and the Grok CLI install on Windows (#3713's Windows half).
 *
 * Measured on a Windows 11 box, 2026-09-25: xAI publishes @xai-official/grok-win32-x64 and
 * -win32-arm64 (one brotli-compressed grok.exe each), and Gemini's bundle runs on the node
 * Kosmos ships. Both installed through runners.install and answered --version there.
 *
 * The first block runs everywhere (platform and arch are parameters, so the win32 answer is
 * asserted from a Mac). The last block runs the real unpack with the Windows tar.exe and a
 * real prove through spawnTarget, and is skipped off win32.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-runners-win32-gg-'));
process.env.AGENT_WORKFORCE_RUNNERS_DIR = path.join(SANDBOX, 'runners');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
delete process.env.AGENT_WORKFORCE_GEMINI_BIN;
delete process.env.AGENT_WORKFORCE_GROK_BIN;
const runners = require('./runners');
const platformGate = require('./platform');

/* #3795: a win32-shaped path handed to fs on macOS/Linux is ONE relative filename with
   backslashes in it, created in the cwd (the repo root), so arms that WRITE to such a path
   run on Windows only. This guard fails the file if any run leaves a backslash-named entry
   behind in the cwd, the leak that made clean validations record "dirty". */
const onWin = process.platform === 'win32';
const cwdBefore = new Set(fs.readdirSync(process.cwd()));
test.after(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  const leaked = fs.readdirSync(process.cwd()).filter((n) => !cwdBefore.has(n) && n.includes('\\'));
  assert.deepEqual(leaked, [], 'win32-shaped paths leaked into the cwd as files');
});
test.afterEach(() => runners.resetForTests());

const LEGACY_GEMINI = path.join(SANDBOX, 'legacy', 'gemini');
const LEGACY_GROK = path.join(SANDBOX, 'legacy', 'grok');
const clear = (p) => fs.rmSync(path.join(runners.managedRoot(), p), { recursive: true, force: true });

test('the keyed-runner gate lets Windows through for Gemini and Grok; the Claude link path stays darwin-only', () => {
  assert.equal(platformGate.canDownloadKeyedRunner('win32'), true);
  assert.equal(platformGate.canDownloadKeyedRunner('darwin'), true);
  for (const p of ['linux', 'aix', '', null]) assert.equal(platformGate.canDownloadKeyedRunner(p), false, String(p) + ' fails closed');
  assert.deepEqual(platformGate.KEYED_RUNNER_DOWNLOADS, ['darwin', 'win32']);
  assert.ok(Object.isFrozen(platformGate.KEYED_RUNNER_DOWNLOADS));
  assert.equal(platformGate.canDownloadRunner('win32'), false, 'RUNNER_DOWNLOADS is unchanged');
  assert.match(runners.install('claude', { platform: 'win32' }).because, /not supported/);
});

test('manifestFor picks the Windows Grok build per CPU, and keeps one Gemini tarball with a .cmd name', () => {
  const x64 = runners.manifestFor('grok', 'win32', 'x64');
  const arm = runners.manifestFor('grok', 'win32', 'arm64');
  assert.match(x64.url, /grok-win32-x64-1\.0\.41\.tgz$/);
  assert.match(arm.url, /grok-win32-arm64-1\.0\.41\.tgz$/);
  assert.notEqual(x64.integrity, arm.integrity);
  for (const m of [x64, arm]) {
    assert.match(m.integrity, /^sha512-/);
    assert.equal(m.brotliFrom, 'bin/grok.exe.br');
    assert.equal(m.binInPackage, 'bin/grok.exe');
    assert.equal(m.binName, 'grok.exe');
    assert.equal(m.version, runners.MANIFEST.grok.version, 'one pinned release across platforms');
    assert.doesNotMatch(m.url, /darwin/);
  }
  assert.equal(x64.downloadBytes, 46487197);
  assert.equal(arm.downloadBytes, 41583124);
  // A CPU with no build gets the x64 entry, which the arch guard refuses by name.
  assert.equal(runners.manifestFor('grok', 'win32', 'ia32').arch, 'x64');
  const g = runners.manifestFor('gemini', 'win32', 'x64');
  assert.equal(g.url, runners.MANIFEST.gemini.url, 'the same bundle as the Mac');
  assert.equal(g.integrity, runners.MANIFEST.gemini.integrity);
  assert.equal(g.binName, 'gemini.cmd');
  assert.equal(g.launcher, 'node');
  // The Mac answers are untouched.
  assert.equal(runners.manifestFor('gemini', 'darwin', 'arm64'), runners.MANIFEST.gemini);
  assert.equal(runners.manifestFor('grok', 'darwin', 'arm64'), runners.MANIFEST.grok);
});

test('on win32 Grok is the exe inside its tree and Gemini is the .cmd launcher beside its tree', () => {
  const root = runners.managedRoot();
  assert.equal(runners.managedBin(runners.manifestFor('grok', 'win32', 'x64'), 'win32', 'grok'),
    path.win32.join(root, 'grok', 'pkg', 'bin', 'grok.exe'));
  assert.equal(runners.managedBin(runners.manifestFor('gemini', 'win32', 'x64'), 'win32', 'gemini'),
    path.win32.join(root, 'gemini', 'gemini.cmd'));
  assert.equal(runners.verifiedMarker('win32', 'grok'), path.win32.join(root, 'grok', '.verified'));
  assert.equal(runners.verifiedMarker('win32'), path.win32.join(root, 'openai', '.verified'), "codex's marker is where it always was");
});

test('an x64 Windows install of each passes the gate and starts downloading the Windows build', async () => {
  for (const p of ['gemini', 'grok']) {
    let fetchedUrl = null;
    const job = runners.install(p, {
      platform: 'win32', arch: 'x64', legacyBin: p === 'gemini' ? LEGACY_GEMINI : LEGACY_GROK,
      download: (url) => { fetchedUrl = url; return Promise.reject(Object.assign(new Error('offline in a test'), { code: 'ENOTFOUND' })); },
    });
    assert.notEqual(job.phase, 'failed', p + ': not refused at the gate: ' + (job.because || ''));
    await job.settled;
    assert.equal(fetchedUrl, runners.manifestFor(p, 'win32', 'x64').url, p + ': the Windows build was fetched');
    assert.match(job.because, /could not reach the download server/, p + ': a network failure is said plainly');
  }
});

test('a Windows CPU with no published Grok build is refused by name before a byte moves', () => {
  let fetched = false;
  const job = runners.install('grok', { platform: 'win32', arch: 'ia32', legacyBin: LEGACY_GROK, download: () => { fetched = true; return Promise.resolve(); } });
  assert.equal(job.phase, 'failed');
  assert.match(job.because, /is x64 and this computer is ia32/);
  assert.equal(fetched, false);
});

test('winNodeLauncher: a CRLF .cmd that records its node and script, runs node on the bundle, and doubles a percent', () => {
  const text = runners.winNodeLauncher('C:\\Program Files\\Kosmos 100%\\runtime\\node.exe', 'bundle/gemini.js');
  assert.ok(text.includes('\r\n'), 'CRLF');
  assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/, 'no bare LF');
  assert.match(text, /^@echo off\r\n/);
  assert.ok(text.includes('rem kosmos-node: "C:\\\\Program Files\\\\Kosmos 100%\\\\runtime\\\\node.exe"'), 'the node, JSON-encoded');
  assert.ok(text.includes('rem kosmos-script: "bundle/gemini.js"'));
  assert.ok(text.includes('"C:\\Program Files\\Kosmos 100%%\\runtime\\node.exe" "%~dp0pkg\\bundle\\gemini.js" %*'), 'the percent is doubled for cmd');
  assert.ok(text.includes('exit /b 127'), 'no node: a clear exit, not a hang');
});

test('spawnTarget: node on the bundle for our .cmd launcher; the plain file for everything else', () => {
  const dir = path.join(SANDBOX, 'st');
  fs.mkdirSync(dir, { recursive: true });
  const cmd = path.join(dir, 'gemini.cmd');
  fs.writeFileSync(cmd, runners.winNodeLauncher(process.execPath, 'bundle/gemini.js'));
  const t = runners.spawnTarget(cmd, 'win32');
  assert.equal(t.file, process.execPath, 'the recorded node, still there');
  assert.deepEqual(t.args, [path.win32.join(path.win32.dirname(cmd), 'pkg', 'bundle', 'gemini.js')]);
  // A recorded node that has gone falls back to the node this process runs on.
  fs.writeFileSync(cmd, runners.winNodeLauncher(path.join(dir, 'gone', 'node.exe'), 'bundle/gemini.js'));
  assert.equal(runners.spawnTarget(cmd, 'win32', 'C:\\k\\runtime\\node.exe').file, 'C:\\k\\runtime\\node.exe');
  // Not ours, not a .cmd, or not Windows: spawned exactly as given.
  const other = path.join(dir, 'other.cmd');
  fs.writeFileSync(other, '@echo off\r\necho hi\r\n');
  assert.deepEqual(runners.spawnTarget(other, 'win32'), { file: other, args: [] });
  assert.deepEqual(runners.spawnTarget('C:\\x\\grok.exe', 'win32'), { file: 'C:\\x\\grok.exe', args: [] });
  assert.deepEqual(runners.spawnTarget(cmd, 'darwin'), { file: cmd, args: [] });
});

test('on win32 a Gemini or Grok that exists but carries no verified marker is not present', { skip: !onWin && 'win32 only: it writes to win32-shaped paths (#3795)' }, () => {
  for (const p of ['gemini', 'grok']) {
    clear(p);
    const m = runners.manifestFor(p, 'win32', 'x64');
    const bin = runners.managedBin(m, 'win32', p);
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, p === 'gemini' ? runners.winNodeLauncher(process.execPath, m.binInPackage) : 'x', { mode: 0o755 });
    const legacyBin = p === 'gemini' ? LEGACY_GEMINI : LEGACY_GROK;
    assert.equal(runners.resolveBin(p, { platform: 'win32', arch: 'x64', legacyBin }).present, false, p + ': no marker, not present');
    fs.writeFileSync(runners.verifiedMarker('win32', p), `${m.version} ${m.binInPackage}\n`);
    const r = runners.resolveBin(p, { platform: 'win32', arch: 'x64', legacyBin });
    assert.deepEqual({ present: r.present, managed: r.managed, bin: r.bin }, { present: true, managed: true, bin }, p + ': vouched for, present');
    fs.writeFileSync(runners.verifiedMarker('win32', p), `0.0.1 ${m.binInPackage}\n`);
    assert.equal(runners.resolveBin(p, { platform: 'win32', arch: 'x64', legacyBin }).present, false, p + ': a marker for another build vouches for nothing');
    clear(p);
  }
});

/* ------------------------------------------------------------------------- */
/* The real Windows pipeline: tar.exe, the brotli expand, the .cmd launcher, and a real prove. */

function winFixture(files) {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'fix-'));
  for (const [rel, bytes] of files) {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, bytes);
  }
  const tgz = path.join(dir, 'fixture.tgz');
  execFileSync(runners.tarBin('win32'), ['-czf', tgz, '-C', dir, 'package']);
  const integrity = 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(tgz)).digest('base64');
  return { tgz, integrity };
}
const downloadFrom = (src) => (url, file, job) => {
  const bytes = fs.readFileSync(src);
  job.totalBytes = bytes.length; job.receivedBytes = bytes.length;
  fs.writeFileSync(file, bytes);
  return Promise.resolve();
};

test('win32: Grok unpacks with tar.exe, expands grok.exe.br, proves, and is vouched for', { skip: !onWin && 'win32 only' }, async () => {
  clear('grok');
  // The "grok.exe" is a copy of this node.exe, compressed as the vendor ships it; the real
  // prove runs it with --version, which node answers.
  const { tgz, integrity } = winFixture([['package/bin/grok.exe.br', zlib.brotliCompressSync(fs.readFileSync(process.execPath), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } })]]);
  const job = runners.install('grok', { legacyBin: LEGACY_GROK, download: downloadFrom(tgz), integrity });
  await job.settled;
  assert.equal(job.phase, 'installed', job.because || '');
  assert.equal(job.proved, process.version, 'the expanded exe is the one that ran');
  const r = runners.resolveBin('grok', { legacyBin: LEGACY_GROK });
  assert.deepEqual({ present: r.present, managed: r.managed }, { present: true, managed: true });
  assert.equal(r.bin, path.join(runners.managedRoot(), 'grok', 'pkg', 'bin', 'grok.exe'));
  assert.equal(fs.existsSync(path.join(runners.managedRoot(), 'grok', 'pkg', 'bin', 'grok.exe.br')), false, 'the compressed copy is not kept');
  assert.ok(fs.existsSync(runners.verifiedMarker('win32', 'grok')));
  clear('grok');
});

test('win32: Gemini installs as gemini.cmd, proved by running node on its bundle', { skip: !onWin && 'win32 only' }, async () => {
  clear('gemini');
  const { tgz, integrity } = winFixture([['package/bundle/gemini.js', "console.log('0.61.0-fixture ' + process.argv.slice(2).join(' '));\n"]]);
  const job = runners.install('gemini', { legacyBin: LEGACY_GEMINI, download: downloadFrom(tgz), integrity, nodeBin: process.execPath });
  await job.settled;
  assert.equal(job.phase, 'installed', job.because || '');
  assert.equal(job.proved, '0.61.0-fixture --version');
  const r = runners.resolveBin('gemini', { legacyBin: LEGACY_GEMINI });
  assert.equal(r.present, true);
  assert.equal(r.bin, path.join(runners.managedRoot(), 'gemini', 'gemini.cmd'));
  // The launcher also works for a person, through cmd.
  const viaCmd = execFileSync('cmd.exe', ['/d', '/c', r.bin, 'hello'], { encoding: 'utf8' }).trim();
  assert.equal(viaCmd, '0.61.0-fixture hello');
  clear('gemini');
});

test('win32: a Gemini bundle that does not run is never left present, launcher and tree both gone', { skip: !onWin && 'win32 only' }, async () => {
  clear('gemini');
  const { tgz, integrity } = winFixture([['package/bundle/gemini.js', 'process.exit(3);\n']]);
  const job = runners.install('gemini', { legacyBin: LEGACY_GEMINI, download: downloadFrom(tgz), integrity, nodeBin: process.execPath });
  await job.settled;
  assert.equal(job.phase, 'failed');
  assert.match(job.because, /did not run on this computer/);
  assert.equal(runners.resolveBin('gemini', { legacyBin: LEGACY_GEMINI }).present, false);
  assert.equal(fs.existsSync(path.join(runners.managedRoot(), 'gemini', 'gemini.cmd')), false);
  assert.equal(fs.existsSync(runners.verifiedMarker('win32', 'gemini')), false);
  clear('gemini');
});
