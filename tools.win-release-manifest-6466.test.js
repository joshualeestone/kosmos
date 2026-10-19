'use strict';
/**
 * #6466: the release side of the Windows signed manifest (tools/lib/win-release-manifest.js): what the build
 * writes, what the publish checks before it uploads, and how the publish tells a build that checks signatures.
 * The installed copy's side is in engine/win32update.test.js (search #6466).
 *
 *   node --test tools.win-release-manifest-6466.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const wrm = require('./tools/lib/win-release-manifest');
const mv = require('./engine/manifest-verify');
const { buildZip } = require('./test-support/zipfixture');
const { TEST_KEYS, STRANGER, sign } = require('./test-support/winreleasemanifest');

const T = { timeout: 30000 };
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-wrm-6466-'));
test.after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const V = '0.7.60';

function stageFiles(over = {}) {
  return {
    'Kosmos.exe': 'MZ launcher',
    'open-board.js': '// opener',
    '! READ ME FIRST - Windows will warn you.txt': 'read me',
    'manifest.json': JSON.stringify({ product: 'kosmos', platform: 'win32', arch: 'x64', version: V, source_sha: 'a'.repeat(40), source_dirty: false, node: { version: 'v24.19.0' } }),
    'runtime/node.exe': 'MZ node',
    'app/server.js': '// server',
    'app/package.json': JSON.stringify({ version: V }),
    'app/engine/win32update.js': `/* ${wrm.CHECKER_MARK} */`,
    'app/bin/kosmos-tunnel.exe': 'MZ tunnel',
    'bin/kosmos': '#!/bin/sh',
    ...over,
  };
}
let n = 0;
/** A stage folder and its zip, as tools/build-kosmos-windows.sh makes them. */
function build(over) {
  n += 1;
  const dir = path.join(SCRATCH, String(n));
  const stage = path.join(dir, 'stage');
  const files = stageFiles(over);
  for (const [rel, data] of Object.entries(files)) {
    if (data === null) continue;
    fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true });
    fs.writeFileSync(path.join(stage, rel), data);
  }
  const zip = buildZip(Object.entries(files).filter(([, d]) => d !== null).map(([name, data]) => ({ name, data })));
  const zipPath = path.join(dir, 'kosmos-win-x64.zip');
  fs.writeFileSync(zipPath, zip);
  return { dir, stage, zip, zipPath };
}
/** Write and sign the manifest for a build; returns its paths. */
function release(b, { key, edit } = {}) {
  const m = wrm.buildManifest({ stage: b.stage, zipBytes: b.zip, version: V, arch: 'x64', keys: TEST_KEYS });
  const bytes = Buffer.from(JSON.stringify(edit ? edit(m) : m, null, 1) + '\n');
  const manifestPath = path.join(b.dir, wrm.manifestName(V, 'x64'));
  fs.writeFileSync(manifestPath, bytes);
  fs.writeFileSync(manifestPath + '.sig', sign(bytes, key));
  return { manifestPath, sigPath: manifestPath + '.sig' };
}

test('#6466: the build tool and the updater agree on what a Windows build holds', T, () => {
  /* Required lazily: the updater pulls in the board's stores, so its roots are sandboxed first. */
  process.env.AGENT_WORKFORCE_DATA = path.join(SCRATCH, 'data');
  process.env.AGENT_WORKFORCE_PROJECTS = path.join(SCRATCH, 'projects');
  process.env.AGENT_WORKFORCE_WORKERS = path.join(SCRATCH, 'workers');
  const win32update = require('./engine/win32update');
  assert.deepEqual([...wrm.WIN_ENTRIES].sort(), [...win32update.ENTRIES].sort());
  assert.equal(win32update.releaseManifestName(V, 'x64'), wrm.manifestName(V, 'x64'));
});

test('#6466: the manifest is the Mac format plus platform, and lists every file the zip holds', T, () => {
  const b = build();
  const m = wrm.buildManifest({ stage: b.stage, zipBytes: b.zip, version: V, arch: 'x64', keys: TEST_KEYS });
  assert.equal(m.manifest, 1);
  assert.equal(m.platform, 'win32');
  assert.equal(m.version, V);
  assert.equal(m.artifact, `kosmos-${V}-win-x64.zip`);
  assert.equal(m.sha256, sha256(b.zip));
  assert.deepEqual(m.pinned_keys, TEST_KEYS);
  assert.equal(m.app.commit, 'a'.repeat(40));
  assert.deepEqual(m.files.map((f) => f.path).sort(), Object.keys(stageFiles()).sort());
  for (const f of m.files) assert.equal(f.sha256, sha256(fs.readFileSync(path.join(b.stage, f.path))), f.path);
  /* The production default pins what engine/manifest-verify.js pins, as the Mac build records. */
  assert.deepEqual(wrm.buildManifest({ stage: b.stage, zipBytes: b.zip, version: V, arch: 'x64' }).pinned_keys, mv.KEYS);
});

test('#6466: the build refuses a stage it cannot describe exactly', T, () => {
  const b = build();
  fs.writeFileSync(path.join(b.stage, 'stray.txt'), 'not part of a build');
  assert.throws(() => wrm.buildManifest({ stage: b.stage, zipBytes: b.zip, version: V, arch: 'x64', keys: TEST_KEYS }), /stray\.txt, which no Windows update may carry/);
  const b2 = build({ 'manifest.json': JSON.stringify({ version: '0.7.59' }) });
  assert.throws(() => wrm.buildManifest({ stage: b2.stage, zipBytes: b2.zip, version: V, arch: 'x64', keys: TEST_KEYS }), /manifest\.json is 0\.7\.59, not 0\.7\.60/);
  assert.throws(() => wrm.buildManifest({ stage: b2.stage, zipBytes: b2.zip, version: 'v1', arch: 'x64', keys: TEST_KEYS }), /not a version/);
  assert.throws(() => wrm.buildManifest({ stage: build().stage, zipBytes: b2.zip, version: V, arch: 'x64', keys: [] }), /pins no key/);
});

test('#6466: the publish check passes the genuine pair and refuses a tampered zip, a stranger\'s signature or an edited manifest', T, () => {
  const b = build();
  const r = release(b);
  assert.deepEqual(wrm.checkZip({ ...r, zipPath: b.zipPath, keys: TEST_KEYS }).code, 0);
  /* The real pins do not accept the suites' key: the publish uses engine/manifest-verify.js KEYS by default. */
  assert.equal(wrm.checkZip({ ...r, zipPath: b.zipPath }).code, 1);

  /* A zip with one file changed (node.exe) against the genuine manifest. */
  const tampered = build({ 'runtime/node.exe': 'MZ another node' });
  fs.copyFileSync(r.manifestPath, path.join(tampered.dir, path.basename(r.manifestPath)));
  fs.copyFileSync(r.sigPath, path.join(tampered.dir, path.basename(r.sigPath)));
  const t1 = wrm.checkZip({ manifestPath: path.join(tampered.dir, path.basename(r.manifestPath)), sigPath: path.join(tampered.dir, path.basename(r.sigPath)), zipPath: tampered.zipPath, keys: TEST_KEYS });
  assert.deepEqual(t1, { code: 1, why: 'the download does not match its signed manifest' });

  /* A manifest whose zip sha is right but one file's is not: the per-file check. */
  const b3 = build();
  const r3 = release(b3, { edit: (m) => ({ ...m, files: m.files.map((f) => (f.path === 'app/server.js' ? { ...f, sha256: '0'.repeat(64) } : f)) }) });
  assert.deepEqual(wrm.checkZip({ ...r3, zipPath: b3.zipPath, keys: TEST_KEYS }), { code: 1, why: 'app/server.js does not match the signed manifest' });

  const b4 = build();
  const r4 = release(b4, { key: STRANGER });
  assert.match(wrm.checkZip({ ...r4, zipPath: b4.zipPath, keys: TEST_KEYS }).why, /not signed by the Kosmos release key/);

  const b5 = build();
  const r5 = release(b5);
  fs.appendFileSync(r5.manifestPath, ' ');
  assert.match(wrm.checkZip({ ...r5, zipPath: b5.zipPath, keys: TEST_KEYS }).why, /not signed by the Kosmos release key/);

  const b6 = build();
  const r6 = release(b6);
  fs.rmSync(r6.sigPath);
  assert.equal(wrm.checkZip({ ...r6, zipPath: b6.zipPath, keys: TEST_KEYS }).code, 1);
  /* And the version the publish was asked for must be the manifest's. */
  assert.match(wrm.checkZip({ ...release(build()), zipPath: b.zipPath, version: '0.7.61', keys: TEST_KEYS }).why, /is for 0\.7\.60, not 0\.7\.61/);
  /* And the arch the publish serves it as, not the manifest's own word for it. */
  const b7 = build();
  const r7 = release(b7);
  assert.equal(wrm.checkZip({ ...r7, zipPath: b7.zipPath, keys: TEST_KEYS }).code, 0);
  assert.match(wrm.checkZip({ ...r7, zipPath: b7.zipPath, arch: 'arm64', keys: TEST_KEYS }).why, /the signed manifest is for "x64", not arm64/);
});

test('#6466: ships-checker tells a build whose installs refuse an unsigned update', T, () => {
  assert.equal(wrm.shipsChecker(build().zipPath), 0);
  assert.equal(wrm.shipsChecker(build({ 'app/engine/win32update.js': '// an older updater' }).zipPath), 1);
  assert.equal(wrm.shipsChecker(build({ 'app/engine/win32update.js': null }).zipPath), 1);
  const bad = path.join(SCRATCH, 'not-a-zip.zip');
  fs.writeFileSync(bad, 'not a zip');
  assert.equal(wrm.shipsChecker(bad), 2, 'cannot tell is its own answer, never "no"');
  assert.equal(wrm.shipsChecker(path.join(SCRATCH, 'missing.zip')), 2);
});

test('#6466: the Mac verifier is unchanged by the split it now shares', T, () => {
  /* verify() over files, as install/setup.sh calls it: a genuine manifest passes, an edited one is refused. */
  const dir = fs.mkdtempSync(path.join(SCRATCH, 'mac-'));
  const stage = path.join(dir, 'stage');
  for (const [rel, data] of Object.entries({ 'bin/kosmos': 'sh', 'app/server.js': 'js', 'runtime/bin/node': 'node', VERSION: V })) {
    fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true });
    fs.writeFileSync(path.join(stage, rel), data);
  }
  const tarball = path.join(dir, 'kosmos.tar.gz');
  fs.writeFileSync(tarball, 'a tarball');
  const files = mv.listFiles(stage).map((p) => ({ path: p, sha256: sha256(fs.readFileSync(path.join(stage, p))) }));
  const bytes = Buffer.from(JSON.stringify({ manifest: 1, version: V, sha256: sha256(fs.readFileSync(tarball)), files }));
  const manifest = path.join(dir, 'm.json');
  const sig = path.join(dir, 'm.sig');
  fs.writeFileSync(manifest, bytes);
  fs.writeFileSync(sig, sign(bytes));
  const args = { manifest, sig, tarball, version: V, installedVersion: '0.7.50', keys: TEST_KEYS };
  assert.equal(mv.verify({ ...args, stage: '-' }).code, 0);
  assert.equal(mv.verify({ ...args, stage }).code, 0);
  assert.equal(mv.verify({ ...args, stage, keys: [] }).code, 3);
  assert.match(mv.verify({ ...args, stage, installedVersion: '0.7.61' }).why, /older than the installed/);
  fs.writeFileSync(path.join(stage, 'app', 'server.js'), 'changed');
  assert.deepEqual(mv.verify({ ...args, stage }), { code: 1, why: 'app/server.js does not match the signed manifest' });
  fs.writeFileSync(sig, sign(bytes, STRANGER));
  assert.match(mv.verify({ ...args, stage: '-' }).why, /not signed by the Kosmos release key/);
});
