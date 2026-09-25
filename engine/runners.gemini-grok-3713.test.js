'use strict';
/**
 * #3713: Kosmos installs the Gemini CLI and the Grok CLI itself, pinned and checksum-verified,
 * through the same install() as OpenAI's Codex. Two shapes are new here:
 *  - Grok's tarball holds ONE brotli-compressed binary (bin/grok.br) that must be expanded
 *    after the checksum passes, the one step its vendor postinstall does.
 *  - Gemini is a node program, so its stable path is a launcher that runs the bundle with the
 *    node this board runs on (a fresh Mac has no `node` on its PATH).
 * Fixture tarballs and a fixture download, as runners.test.js uses: nothing here fetches or
 * runs a real vendor build.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

/* Sandbox every root this module reads or writes before requiring it (runners.test.js's rule). */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-runners-3713-'));
process.env.AGENT_WORKFORCE_RUNNERS_DIR = nodePath.join(SANDBOX, 'runners');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
delete process.env.AGENT_WORKFORCE_GEMINI_BIN;
delete process.env.AGENT_WORKFORCE_GROK_BIN;
const runners = require('./runners');
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const LEGACY_GEMINI = nodePath.join(SANDBOX, 'legacy', 'gemini');
const LEGACY_GROK = nodePath.join(SANDBOX, 'legacy', 'grok');
const MANAGED_GEMINI = nodePath.join(SANDBOX, 'runners', 'gemini', 'gemini');
const MANAGED_GROK = nodePath.join(SANDBOX, 'runners', 'grok', 'grok');

/* A real .tgz in the npm layout, built with the same /usr/bin/tar install() unpacks with. */
function tarball(files) {
  const dir = fs.mkdtempSync(nodePath.join(SANDBOX, 'fix-'));
  for (const [rel, bytes, mode] of files) {
    const abs = nodePath.join(dir, rel);
    fs.mkdirSync(nodePath.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, bytes);
    if (mode) fs.chmodSync(abs, mode);
  }
  const tgz = nodePath.join(dir, 'fixture.tgz');
  execFileSync('/usr/bin/tar', ['-czf', tgz, '-C', dir, 'package']);
  const integrity = 'sha512-' + crypto.createHash('sha512').update(fs.readFileSync(tgz)).digest('base64');
  return { tgz, integrity };
}
const downloadFrom = (src) => (url, file, job) => {
  const bytes = fs.readFileSync(src);
  job.totalBytes = bytes.length;
  job.receivedBytes = bytes.length;
  fs.writeFileSync(file, bytes);
  return Promise.resolve();
};
const clean = () => {
  for (const p of ['gemini', 'grok']) fs.rmSync(nodePath.join(SANDBOX, 'runners', p), { recursive: true, force: true });
};

test('#3713: Grok installs from its compressed binary, expanded after the checksum, and runs from the managed path', async () => {
  clean();
  const program = '#!/bin/sh\necho "grok 1.0.41 $1"\n';
  const { tgz, integrity } = tarball([['package/bin/grok.br', zlib.brotliCompressSync(Buffer.from(program))],
    ['package/package.json', '{"name":"@xai-official/grok-darwin-arm64","version":"1.0.41"}']]);
  let provedBin = null;
  const job = runners.install('grok', {
    platform: 'darwin', arch: 'arm64', legacyBin: LEGACY_GROK, download: downloadFrom(tgz), integrity,
    prove: (bin, done) => { provedBin = bin; execFileSyncDone(bin, done); },
  });
  await job.settled;
  assert.equal(job.phase, 'installed', job.because || '');
  assert.equal(provedBin, MANAGED_GROK, 'the prove step ran the managed path');
  assert.equal(job.proved, 'grok 1.0.41 --version', 'the expanded program is the one that ran');
  const native = nodePath.join(SANDBOX, 'runners', 'grok', 'pkg', 'bin', 'grok-native');
  assert.equal(fs.readFileSync(native, 'utf8'), program, 'grok.br was expanded byte for byte');
  assert.ok((fs.statSync(native).mode & 0o111) !== 0, 'and made executable');
  assert.equal(fs.existsSync(nodePath.join(SANDBOX, 'runners', 'grok', 'pkg', 'bin', 'grok.br')), false, 'the compressed copy is not kept');
  const r = runners.resolveBin('grok', { legacyBin: LEGACY_GROK });
  assert.deepEqual({ bin: r.bin, present: r.present, managed: r.managed }, { bin: MANAGED_GROK, present: true, managed: true });
  clean();
});

test('#3713: a Grok download whose compressed binary will not expand is refused, and nothing is installed', async () => {
  clean();
  const { tgz, integrity } = tarball([['package/bin/grok.br', Buffer.from('this is not brotli at all')]]);
  const job = runners.install('grok', {
    platform: 'darwin', arch: 'arm64', legacyBin: LEGACY_GROK, download: downloadFrom(tgz), integrity,
    prove: () => { throw new Error('prove must never run when the binary did not expand'); },
  });
  await job.settled;
  assert.equal(job.phase, 'failed');
  assert.ok(job.because && !/undefined|\bat \w+ \(/.test(job.because), 'a plain sentence: ' + job.because);
  assert.match(job.because, /could not be unpacked/, 'a bad archive is said as one, not as a disk problem');
  assert.doesNotMatch(job.because, /disk space/);
  assert.equal(fs.existsSync(MANAGED_GROK), false, 'nothing is left at the managed path');
  assert.equal(runners.resolveBin('grok', { legacyBin: LEGACY_GROK }).present, false);
  clean();
});

test('#3713: Gemini installs as a launcher that runs its bundle with the board\'s node, and it really runs', async () => {
  clean();
  const bundle = "console.log('gemini ' + process.argv.slice(2).join(' '));\n";
  const { tgz, integrity } = tarball([['package/bundle/gemini.js', bundle],
    ['package/package.json', '{"name":"@google/gemini-cli","version":"0.61.0"}']]);
  // The DEFAULT prove (execFile <managed> --version), so the launcher itself is what is run.
  const job = runners.install('gemini', {
    platform: 'darwin', legacyBin: LEGACY_GEMINI, download: downloadFrom(tgz), integrity, nodeBin: process.execPath,
  });
  await job.settled;
  assert.equal(job.phase, 'installed', job.because || '');
  assert.equal(job.proved, 'gemini --version', 'the launcher ran the bundle with node and passed the arguments through');
  const launcher = fs.readFileSync(MANAGED_GEMINI, 'utf8');
  assert.match(launcher, /^#!\/bin\/sh\n/);
  assert.ok(launcher.includes("'" + process.execPath + "'"), 'it names the node it was installed with');
  assert.ok(launcher.includes('"$d/pkg/"\'bundle/gemini.js\''), 'and finds the bundle relative to itself, so a moved folder carries it');
  assert.ok(launcher.includes('"$d/../../runtime/bin/node"'), 'and tries Kosmos\'s own runtime first');
  assert.ok((fs.statSync(MANAGED_GEMINI).mode & 0o111) !== 0, 'the launcher is executable');
  // It runs with NO node on the PATH, which is the fresh-Mac case this launcher exists for.
  const out = execFileSync(MANAGED_GEMINI, ['hello'], { env: { PATH: '/usr/bin:/bin' } }).toString().trim();
  assert.equal(out, 'gemini hello');
  const r = runners.resolveBin('gemini', { legacyBin: LEGACY_GEMINI });
  assert.deepEqual({ bin: r.bin, present: r.present, managed: r.managed }, { bin: MANAGED_GEMINI, present: true, managed: true });
  clean();
});

test('#3713: the Gemini launcher survives a node path with a space and a quote in it', async () => {
  clean();
  const odd = nodePath.join(SANDBOX, "node dir's", 'node');
  fs.mkdirSync(nodePath.dirname(odd), { recursive: true });
  fs.symlinkSync(process.execPath, odd);
  const { tgz, integrity } = tarball([['package/bundle/gemini.js', "console.log('ran ' + process.argv[2]);\n"]]);
  const job = runners.install('gemini', {
    platform: 'darwin', legacyBin: LEGACY_GEMINI, download: downloadFrom(tgz), integrity, nodeBin: odd,
  });
  await job.settled;
  assert.equal(job.phase, 'installed', job.because || '');
  assert.equal(job.proved, 'ran --version');
  clean();
});

test('#3713: a Gemini launcher whose node cannot start is failed at the prove step, never left installed', async () => {
  clean();
  const { tgz, integrity } = tarball([['package/bundle/gemini.js', "console.log('x');\n"]]);
  const job = runners.install('gemini', {
    platform: 'darwin', legacyBin: LEGACY_GEMINI, download: downloadFrom(tgz), integrity,
    nodeBin: nodePath.join(SANDBOX, 'no-such-node'),
  });
  await job.settled;
  assert.equal(job.phase, 'failed');
  assert.match(job.because, /did not run on this computer/);
  assert.equal(fs.existsSync(MANAGED_GEMINI), false, 'the launcher is removed');
  clean();
});

test('#3713: the pins: one Gemini tarball for every Mac, a Grok build per CPU, and Windows refused before a byte moves', async () => {
  const gArm = runners.manifestFor('gemini', 'darwin', 'arm64');
  const gX64 = runners.manifestFor('gemini', 'darwin', 'x64');
  assert.equal(gArm.url, gX64.url);
  assert.equal(gArm.arch, undefined, 'the Gemini bundle is the same for every CPU');
  const xArm = runners.manifestFor('grok', 'darwin', 'arm64');
  const xX64 = runners.manifestFor('grok', 'darwin', 'x64');
  assert.match(xArm.url, /grok-darwin-arm64-1\.0\.41\.tgz$/);
  assert.match(xX64.url, /grok-darwin-x64-1\.0\.41\.tgz$/);
  assert.notEqual(xArm.integrity, xX64.integrity);
  assert.equal(xX64.arch, 'x64', 'an Intel Mac gets the Intel build, not a refusal');
  assert.equal(xX64.brotliFrom, 'bin/grok.br', 'and the same expand step');
  for (const p of ['gemini', 'grok']) {
    let fetched = false;
    const job = runners.install(p, { platform: 'win32', arch: 'x64', download: () => { fetched = true; return Promise.resolve(); } });
    assert.equal(job.phase, 'failed');
    assert.match(job.because, /not supported on this kind of computer \(win32\)/);
    assert.equal(fetched, false, p + ': nothing was downloaded on Windows');
  }
  // status() now reports both, so a screen can read their size and progress.
  const st = runners.status();
  assert.equal(st.gemini.pinnedVersion, '0.61.0');
  assert.equal(st.grok.pinnedVersion, '1.0.41');
});

test('#3713: a launcher whose recorded node is gone reads missing, and Kosmos\'s own runtime node beside the runners folder revives it', async () => {
  clean();
  // A node that can move, as a Homebrew upgrade moves a versioned Cellar folder (review pass 1).
  const cellar = nodePath.join(SANDBOX, 'Cellar', 'node', '26.8.1', 'bin');
  fs.mkdirSync(cellar, { recursive: true });
  const moving = nodePath.join(cellar, 'node');
  fs.symlinkSync(process.execPath, moving);
  const { tgz, integrity } = tarball([['package/bundle/gemini.js', "console.log('ran ' + process.argv[2]);\n"]]);
  const job = runners.install('gemini', { platform: 'darwin', legacyBin: LEGACY_GEMINI, download: downloadFrom(tgz), integrity, nodeBin: moving });
  await job.settled;
  assert.equal(job.phase, 'installed', job.because || '');
  assert.equal(runners.resolveBin('gemini', { legacyBin: LEGACY_GEMINI }).present, true);
  // The upgrade removes that node: the launcher can no longer start, so it must not read present
  // (else Connect never offers the download that would fix it), and install must download again.
  fs.rmSync(nodePath.join(SANDBOX, 'Cellar'), { recursive: true, force: true });
  assert.equal(runners.resolveBin('gemini', { legacyBin: LEGACY_GEMINI }).present, false, 'a launcher with no node is not present');
  let fetched = false;
  const again = runners.install('gemini', { platform: 'darwin', legacyBin: LEGACY_GEMINI, integrity, nodeBin: process.execPath,
    download: (u, f, j) => { fetched = true; return downloadFrom(tgz)(u, f, j); } });
  await again.settled;
  assert.ok(fetched && again.phase === 'installed', 'Connect can reinstall it: ' + (again.because || again.phase));
  // Kosmos's own runtime (KOSMOS_HOME/runtime/bin/node, beside runners/) is used first, whatever was recorded.
  const runtime = nodePath.join(SANDBOX, 'runtime', 'bin');
  fs.mkdirSync(runtime, { recursive: true });
  fs.symlinkSync(process.execPath, nodePath.join(runtime, 'node'));
  const launcher = MANAGED_GEMINI;
  fs.writeFileSync(launcher, fs.readFileSync(launcher, 'utf8').replace(JSON.stringify(process.execPath), JSON.stringify('/no/such/node'))
    .replace("'" + process.execPath + "'", "'/no/such/node'"));
  assert.equal(runners.launcherHasNode(launcher), true, 'the runtime beside the runners folder counts');
  assert.equal(execFileSync(launcher, ['x'], { env: { PATH: '/usr/bin:/bin' } }).toString().trim(), 'ran x', 'and is the node it runs with');
  fs.rmSync(nodePath.join(SANDBOX, 'runtime'), { recursive: true, force: true });
  assert.equal(runners.launcherHasNode(launcher), false, 'control: with neither node, it is not runnable');
  clean();
});

test('#3713: a tool still proving its own install reads as installing, though its path already exists', async () => {
  clean();
  const { tgz, integrity } = tarball([['package/bin/grok.br', zlib.brotliCompressSync(Buffer.from('#!/bin/sh\necho grok\n'))]]);
  let release;
  const held = new Promise((r) => { release = r; });
  let seen = null;
  const job = runners.install('grok', {
    platform: 'darwin', arch: 'arm64', legacyBin: LEGACY_GROK, download: downloadFrom(tgz), integrity,
    prove: (bin, done) => {
      seen = { present: runners.resolveBin('grok', { legacyBin: LEGACY_GROK }).present, installing: runners.installing('grok') };
      held.then(() => done(null, 'grok 1.0.41'));
    },
  });
  while (!seen) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(seen, { present: true, installing: true }, 'the path exists while it is being proved, and it is still installing');
  release();
  await job.settled;
  assert.equal(runners.installing('grok'), false, 'and is not once installed');
  clean();
});

/* The prove seam, run for real on the fixture program: execFile with --version, as the default does. */
function execFileSyncDone(bin, done) {
  try { done(null, execFileSync(bin, ['--version']).toString()); } catch (e) { done(e); }
}
