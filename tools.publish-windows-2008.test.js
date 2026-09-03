'use strict';

/**
 * #2008: publish-kosmos-windows.sh stages a built Windows zip under a STABLE unversioned
 * alias (what the download button points at) plus a versioned copy, with sha sidecars and a
 * latest-win.json manifest -- so the button never serves a stale build after the next release.
 *
 *   node --test tools.publish-windows-2008.test.js
 *
 * The script is fast (it only stages files), so this RUNS it against a fixture zip rather than
 * reading its source -- the stronger check.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, 'tools/publish-kosmos-windows.sh');

// Build a fixture zip carrying app/package.json at the given version, the way the real build
// bakes the version in. Returns the zip path.
function fixtureZip(dir, version) {
  const app = path.join(dir, 'app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'agent-workforce', version }) + '\n');
  // A byte of payload so the zip is non-trivial and the sha is stable across runs.
  fs.writeFileSync(path.join(app, 'server.js'), '// fixture\n');
  const zip = path.join(dir, 'kosmos-win-x64.zip');
  execFileSync('zip', ['-qr', zip, 'app'], { cwd: dir });
  return zip;
}

function run(zip, site, extraEnv = {}, versionArg) {
  // versionArg exercises the explicit `[<version>]` argument, a DISTINCT code path from the
  // default: it skips the unzip + in-zip package.json read entirely.
  const argv = versionArg === undefined ? [SCRIPT, zip] : [SCRIPT, zip, versionArg];
  return execFileSync('sh', argv, {
    env: { ...process.env, KOSMOS_SITE: site, ...extraEnv },
    encoding: 'utf8',
  });
}

function freshSite() {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'pubwin-site-'));
  fs.mkdirSync(path.join(site, 'dist'), { recursive: true });
  return site;
}

test('#2008: stages the alias, a versioned copy, sha sidecars and latest-win.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pubwin-fix-'));
  const site = freshSite();
  const zip = fixtureZip(dir, '9.9.9');
  run(zip, site);
  const dist = path.join(site, 'dist');
  for (const f of ['kosmos-win-x64.zip', 'kosmos-win-x64.zip.sha256',
    'kosmos-9.9.9-win-x64.zip', 'kosmos-9.9.9-win-x64.zip.sha256', 'latest-win.json']) {
    assert.ok(fs.existsSync(path.join(dist, f)), `missing staged file: ${f}`);
  }
  // The alias and the versioned copy are the SAME bytes.
  assert.deepEqual(
    fs.readFileSync(path.join(dist, 'kosmos-win-x64.zip')),
    fs.readFileSync(path.join(dist, 'kosmos-9.9.9-win-x64.zip')),
    'the alias and the versioned copy must be identical bytes');
  // latest-win.json points at the ALIAS (the stable button target), carries the version+sha.
  const lj = JSON.parse(fs.readFileSync(path.join(dist, 'latest-win.json'), 'utf8'));
  assert.equal(lj.artifact, 'kosmos-win-x64.zip', 'latest-win.json.artifact must be the stable alias');
  assert.equal(lj.versioned, 'kosmos-9.9.9-win-x64.zip');
  assert.equal(lj.version, '9.9.9');
  assert.equal(lj.arch, 'x64');
  // The sha in the manifest is the real sha of the artifact, and the sidecar names its file.
  const realSha = require('node:crypto').createHash('sha256')
    .update(fs.readFileSync(path.join(dist, 'kosmos-win-x64.zip'))).digest('hex');
  assert.equal(lj.sha256, realSha, 'latest-win.json.sha256 must match the artifact bytes');
  const sidecar = fs.readFileSync(path.join(dist, 'kosmos-win-x64.zip.sha256'), 'utf8').trim();
  assert.match(sidecar, new RegExp(`^${realSha}\\s+kosmos-win-x64\\.zip$`),
    'the sidecar must carry the real sha AND name its own file (so shasum -c verifies in place)');
});

test('#2008: the version comes from the ZIP, not the repo -- so a versioned name never lies about the build', () => {
  // The discriminating control: the fixture is version 3.2.1, which is NOT this repo's
  // package.json version. If the script read the repo instead of the zip, the versioned name
  // and manifest would carry the wrong (repo) version. A working link to a mislabelled build
  // is the exact #2008 failure, one layer in.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pubwin-fix-'));
  const site = freshSite();
  run(fixtureZip(dir, '3.2.1'), site);
  const repoVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version;
  assert.notEqual('3.2.1', repoVersion, 'control precondition: the fixture version must differ from the repo version');
  assert.ok(fs.existsSync(path.join(site, 'dist', 'kosmos-3.2.1-win-x64.zip')),
    'the versioned name must come from the zip (3.2.1), not the repo package.json');
  const lj = JSON.parse(fs.readFileSync(path.join(site, 'dist', 'latest-win.json'), 'utf8'));
  assert.equal(lj.version, '3.2.1', 'latest-win.json.version must be the build version, not the repo version');
});

test('#2008: refuses a missing zip and a zip with no baked version, rather than staging a mislabelled artifact', () => {
  const site = freshSite();
  assert.throws(() => run(path.join(os.tmpdir(), 'no-such-file.zip'), site), /no such zip/,
    'a missing zip must be refused');
  // A zip with no app/package.json has no build version to name the artifact after.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pubwin-fix-'));
  fs.mkdirSync(path.join(dir, 'other'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'other', 'x.txt'), 'no package.json here\n');
  const badZip = path.join(dir, 'kosmos-win-x64.zip');
  execFileSync('zip', ['-qr', badZip, 'other'], { cwd: dir });
  assert.throws(() => run(badZip, site), /could not read the version/,
    'a zip with no baked version must be refused, not staged under a guessed name');
  // A crafted zip whose version could escape dist/ (a "/" in the version) must be refused before
  // any cp, or `cp` would write outside the intended directory.
  const dirEvil = fs.mkdtempSync(path.join(os.tmpdir(), 'pubwin-fix-'));
  assert.throws(() => run(fixtureZip(dirEvil, '../evil'), site), /refusing an implausible version/,
    'a version with a path separator must be refused (path-escape guard)');
  // And nothing was staged on EITHER refusal -- the whole dist stays empty, so a regression that
  // staged the alias (or any file) before the version check would fail here. (The prior filter for
  // '3.2.1' was copy-pasted from the control arm and matched nothing, making this vacuous.)
  assert.deepEqual(fs.readdirSync(path.join(site, 'dist')), [], 'a refusal must stage nothing');
});

test('#2008: the versioned name is immutable -- republishing DIFFERENT bytes under the same version is refused, same bytes is idempotent', () => {
  const site = freshSite();
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'pubwin-fix-'));
  const zipA = fixtureZip(dirA, '1.0.0');  // build the zip ONCE
  run(zipA, site);
  const versioned = path.join(site, 'dist', 'kosmos-1.0.0-win-x64.zip');
  const firstBytes = fs.readFileSync(versioned);
  // Re-running with the SAME zip FILE (byte-identical) is idempotent -- a retry after a partial
  // run must succeed, not refuse. Reuse the identical zip rather than RE-zipping the same source:
  // zip embeds each file's mtime at 2-second DOS granularity, so a re-zip across a 2s boundary
  // produces different bytes, which the immutability guard would (correctly) refuse -- a test
  // flake, not a product bug (the product defines idempotency by cmp on actual bytes).
  run(zipA, site);
  assert.deepEqual(fs.readFileSync(versioned), firstBytes, 'same-bytes republish must be idempotent');
  // A DIFFERENT build under the SAME version (an extra file changes the bytes) must be refused --
  // a versioned name is a promise of immutability, and clobbering it seeds a stale-cache incident.
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'pubwin-fix-'));
  const appB = path.join(dirB, 'app');
  fs.mkdirSync(appB, { recursive: true });
  fs.writeFileSync(path.join(appB, 'package.json'), JSON.stringify({ name: 'agent-workforce', version: '1.0.0' }) + '\n');
  fs.writeFileSync(path.join(appB, 'DIFFERENT.txt'), 'these bytes differ\n');
  const zipB = path.join(dirB, 'kosmos-win-x64.zip');
  execFileSync('zip', ['-qr', zipB, 'app'], { cwd: dirB });
  // Snapshot the WHOLE dist before the refused republish: the alias, its sidecar, latest-win.json,
  // and the versioned pair must ALL be untouched by a refusal -- not just the versioned copy. A
  // guard that ran AFTER the alias cp would leave the alias clobbered to the refused bytes with a
  // stale sidecar/manifest (an inconsistent dist that fails shasum -c), which a versioned-only
  // assertion cannot see. So assert the entire dist is byte-for-byte unchanged.
  const dist = path.join(site, 'dist');
  const snap = {};
  for (const f of fs.readdirSync(dist)) snap[f] = fs.readFileSync(path.join(dist, f));
  assert.throws(() => run(zipB, site), /refusing to republish a versioned name/,
    'different bytes under the same versioned name must be refused');
  assert.deepEqual(fs.readdirSync(dist).sort(), Object.keys(snap).sort(),
    'a refusal must not add or remove any dist file');
  for (const f of Object.keys(snap)) {
    assert.deepEqual(fs.readFileSync(path.join(dist, f)), snap[f], `a refusal must leave ${f} byte-for-byte unchanged`);
  }
});

test('#2008: an explicit <version> arg overrides the zip-baked version -- the distinct code path that skips the in-zip read', () => {
  // The zip is baked at 9.9.9, but the operator passes 7.7.7 explicitly. The explicit arg must
  // win AND the unzip/in-zip read must be skipped entirely -- a genuinely different branch from
  // every other arm here (all of which exercise the default in-zip read). If the arg were ignored
  // the versioned name would carry 9.9.9.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pubwin-fix-'));
  const site = freshSite();
  run(fixtureZip(dir, '9.9.9'), site, {}, '7.7.7');
  const dist = path.join(site, 'dist');
  assert.ok(fs.existsSync(path.join(dist, 'kosmos-7.7.7-win-x64.zip')),
    'the explicit <version> arg (7.7.7) must name the versioned copy, not the zip-baked 9.9.9');
  assert.ok(!fs.existsSync(path.join(dist, 'kosmos-9.9.9-win-x64.zip')),
    'the zip-baked version must NOT be used when an explicit version is given');
  const lj = JSON.parse(fs.readFileSync(path.join(dist, 'latest-win.json'), 'utf8'));
  assert.equal(lj.version, '7.7.7', 'latest-win.json.version must be the explicit arg');
});

test('#2008: the version guard ACCEPTS a legitimate build-metadata version (+ and _) -- proving it does not over-reject', () => {
  // The reject side of the path-escape guard is covered above (../evil). This is the positive
  // control: the charset deliberately allows semver build-metadata (`+`) and `_`, so a real build
  // named e.g. 1.2.3+win.5 must be STAGED, not refused. A guard that over-rejected a valid version
  // would block a legitimate publish -- the failure a reject-only test cannot see.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pubwin-fix-'));
  const site = freshSite();
  const V = '1.2.3+win.5_rc-2';  // exercises every allowed non-alphanumeric: . + _ -
  run(fixtureZip(dir, V), site);
  const dist = path.join(site, 'dist');
  assert.ok(fs.existsSync(path.join(dist, `kosmos-${V}-win-x64.zip`)),
    'a version using the allowed . + _ - characters must be staged, not refused');
  const lj = JSON.parse(fs.readFileSync(path.join(dist, 'latest-win.json'), 'utf8'));
  assert.equal(lj.version, V, 'latest-win.json.version must carry the build-metadata version verbatim');
});
