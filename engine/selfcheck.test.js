'use strict';
// kosmos#1920 -- tests for engine/selfcheck.js (after-install self-verification).
//
// The load-bearing test is the byte-corruption CONTROL: the SAME check must return OK on
// the bytes the manifest describes and a NAMED MISMATCH after a single byte changes. A
// verifier nobody has watched fail is not a verifier, so every assertion below either
// pairs a pass with the failure that proves the pass meant something, or asserts the
// vacuous-pass guard directly.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { verifyFiles, fetchManifest, selfCheck } = require('./selfcheck');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Build a throwaway "installed bundle" mirroring the real layout (bin app runtime VERSION
// plus app/package.json, which is where the installed version is read from), and a
// manifest.files[] over it with correct shas. Returns { root, files, cleanup }.
function fakeInstall(version = '0.6.22') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-selfcheck-'));
  const entries = {
    'VERSION': Buffer.from(version + '\n'),
    'app/package.json': Buffer.from(JSON.stringify({ name: 'kosmos', version }) + '\n'),
    'app/server.js': Buffer.from('console.log("board");\n'),
    'runtime/bin/node': Buffer.from('\x7fELF fake node binary\n'),
    'bin/kosmos': Buffer.from('#!/bin/sh\nexec node app/server.js\n'),
  };
  const files = [];
  for (const [rel, buf] of Object.entries(entries)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    files.push({ path: rel, sha256: sha(buf) });
  }
  return { root, files, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('verifyFiles passes when every installed file matches the manifest', async () => {
  const { root, files, cleanup } = fakeInstall();
  try {
    const r = await verifyFiles(root, files);
    assert.equal(r.ok, true, 'a clean bundle must verify');
    assert.equal(r.checked, files.length);
    assert.deepEqual(r.mismatches, []);
    assert.deepEqual(r.missing, []);
    assert.deepEqual(r.bad, []);
  } finally { cleanup(); }
});

test('CONTROL: corrupting one byte of an installed file is reported as a mismatch', async () => {
  const { root, files, cleanup } = fakeInstall();
  try {
    // Prove the check passes on the untouched bytes first, so the failure below is
    // caused by the corruption and not by a check that fails on everything.
    assert.equal((await verifyFiles(root, files)).ok, true, 'precondition: clean bundle verifies');

    // Flip a single byte in one installed file. The manifest still carries the ORIGINAL sha.
    const victim = path.join(root, 'app/server.js');
    const bytes = fs.readFileSync(victim);
    bytes[0] ^= 0x01;
    fs.writeFileSync(victim, bytes);

    const r = await verifyFiles(root, files);
    assert.equal(r.ok, false, 'a one-byte change MUST fail the self-check (the dangerous answer)');
    assert.equal(r.mismatches.length, 1, 'exactly the corrupted file mismatches');
    assert.equal(r.mismatches[0].path, 'app/server.js');
    assert.notEqual(r.mismatches[0].actual, r.mismatches[0].expected);
    assert.equal(r.missing.length, 0);
  } finally { cleanup(); }
});

test('a file named by the manifest but absent on disk is reported as missing', async () => {
  const { root, files, cleanup } = fakeInstall();
  try {
    fs.rmSync(path.join(root, 'bin/kosmos'));
    const r = await verifyFiles(root, files);
    assert.equal(r.ok, false);
    assert.equal(r.missing.length, 1);
    assert.equal(r.missing[0].path, 'bin/kosmos');
    assert.equal(r.mismatches.length, 0, 'the other three still match');
  } finally { cleanup(); }
});

test('an empty manifest files[] is NOT a pass (the vacuous-pass guard)', async () => {
  const { root, cleanup } = fakeInstall();
  try {
    assert.equal((await verifyFiles(root, [])).ok, false, 'nothing to verify must not read as verified');
    assert.equal((await verifyFiles(root, undefined)).ok, false);
  } finally { cleanup(); }
});

test('a manifest path escaping the bundle root is refused, not followed', async () => {
  const { root, files, cleanup } = fakeInstall();
  try {
    const outside = [...files, { path: '../escape.js', sha256: 'deadbeef' }];
    const r = await verifyFiles(root, outside);
    assert.equal(r.ok, false);
    assert.equal(r.bad.length, 1);
    assert.equal(r.bad[0].path, '../escape.js');
  } finally { cleanup(); }
});

test('fetchManifest reads the manifest via the latest.json pointer', async () => {
  const manifest = { manifest: 1, version: '0.6.22', files: [{ path: 'VERSION', sha256: 'abc' }] };
  const served = {
    'https://x/dist/latest.json': { version: '0.6.22', sha256: 'zzz', manifest: 'kosmos-0.6.22-arm64.manifest.json' },
    'https://x/dist/kosmos-0.6.22-arm64.manifest.json': manifest,
  };
  const doFetch = async (url) => ({ ok: url in served, json: async () => served[url] });
  const { manifest: got } = await fetchManifest({ base: 'https://x/dist', doFetch });
  assert.deepEqual(got.files, manifest.files);
});

test('fetchManifest fails loudly on a pre-#1920 latest.json with no manifest pointer', async () => {
  const doFetch = async () => ({ ok: true, json: async () => ({ version: '0.6.22' }) }); // version-only
  await assert.rejects(fetchManifest({ base: 'https://x/dist', doFetch }), /no manifest pointer/);
});

test('selfCheck wires the pointer, manifest and installed root end-to-end (and its control)', async () => {
  const { root, files, cleanup } = fakeInstall();
  try {
    const manifest = { manifest: 1, version: '0.6.22', files };
    const served = {
      'https://x/dist/latest.json': { version: '0.6.22', manifest: 'kosmos-0.6.22-arm64.manifest.json' },
      'https://x/dist/kosmos-0.6.22-arm64.manifest.json': manifest,
    };
    const doFetch = async (url) => ({ ok: url in served, json: async () => served[url] });

    const ok = await selfCheck({ base: 'https://x/dist', root, doFetch });
    assert.equal(ok.ok, true, 'end-to-end clean bundle verifies');
    assert.equal(ok.behind, false, 'a current install is not behind');

    // Same control at the top level: corrupt a byte, the whole pipeline must fail.
    const victim = path.join(root, 'app/server.js');
    const b = fs.readFileSync(victim); b[0] ^= 0x01; fs.writeFileSync(victim, b);
    const bad = await selfCheck({ base: 'https://x/dist', root, doFetch });
    assert.equal(bad.ok, false, 'a corrupted install must fail selfCheck end-to-end');
    assert.equal(bad.mismatches[0].path, 'app/server.js');
  } finally { cleanup(); }
});

test('selfCheck verifies a BEHIND machine against ITS version, not the latest (no false failure)', async () => {
  const behind = fakeInstall('0.6.20'); // installed one release back
  try {
    const behindManifest = { manifest: 1, version: '0.6.20', files: behind.files };
    const served = {
      'https://x/dist/latest.json': { version: '0.6.22', manifest: 'kosmos-0.6.22-arm64.manifest.json' },
      // the machine's OWN version manifest, describing the bytes it actually has:
      'https://x/dist/kosmos-0.6.20-arm64.manifest.json': behindManifest,
      // the LATEST manifest describes DIFFERENT bytes -- if selfCheck used it (the bug this
      // arm pins), every file would mismatch. A wrong VERSION sha makes that visible.
      'https://x/dist/kosmos-0.6.22-arm64.manifest.json': { manifest: 1, version: '0.6.22', files: [{ path: 'VERSION', sha256: 'deadbeef' }] },
    };
    const doFetch = async (url) => ({ ok: url in served, json: async () => served[url] });
    const r = await selfCheck({ base: 'https://x/dist', root: behind.root, doFetch });
    assert.equal(r.ok, true, 'a healthy behind-machine must verify against its own version, not read as corrupt');
    assert.equal(r.installedVersion, '0.6.20');
    assert.equal(r.latestVersion, '0.6.22');
    assert.equal(r.behind, true, 'being behind is reported as a distinct state, not a mismatch');
  } finally { behind.cleanup(); }
});

test('a file literally named "..foo" at the root is verified, not refused as escaping (NIT fix)', async () => {
  const { root, files, cleanup } = fakeInstall();
  try {
    const buf = Buffer.from('a dotdot-prefixed filename, inside root\n');
    fs.writeFileSync(path.join(root, '..foo'), buf);
    const withDotDot = [...files, { path: '..foo', sha256: sha(buf) }];
    const r = await verifyFiles(root, withDotDot);
    assert.deepEqual(r.bad, [], '..foo is a file inside root, not a "../" escape');
    assert.equal(r.ok, true);
  } finally { cleanup(); }
});

test('a manifest entry pointing at a directory is reported as bad (unreadable), not missing (NIT fix)', async () => {
  const { root, files, cleanup } = fakeInstall();
  try {
    fs.mkdirSync(path.join(root, 'adir'));
    const withDir = [...files, { path: 'adir', sha256: 'whatever' }];
    const r = await verifyFiles(root, withDir);
    assert.equal(r.missing.length, 0, 'a present-but-unreadable path is not "missing"');
    assert.equal(r.bad.length, 1, 'a directory cannot be hashed as a file');
    assert.equal(r.bad[0].path, 'adir');
  } finally { cleanup(); }
});
