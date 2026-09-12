'use strict';

/**
 * #2008: publish-kosmos-windows.sh stages a built Windows zip under a STABLE unversioned
 * alias (what the download button points at) plus a versioned copy, with sha sidecars and a
 * latest-win.json manifest -- so the button never serves a stale build after the next release.
 *
 * The Windows staging channel (2026-09-12): the same script now publishes on a CHANNEL,
 * KOSMOS_CUT_CHANNEL, defaulting to STAGING -- only the versioned pair plus
 * latest-win-staging.json, leaving the alias and latest-win.json alone until a promote. The
 * #2008 arms below pin the PROD channel (today's behaviour); the channel arms follow them.
 *
 *   node --test tools.publish-windows-2008.test.js
 *
 * The script is fast (it only stages files), so this RUNS it against a fixture zip rather than
 * reading its source -- the stronger check.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

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

// The channel is an environment variable, so an operator's exported KOSMOS_WIN_CUT_CHANNEL (or the
// Mac cut's KOSMOS_CUT_CHANNEL, or a break-glass approval) must not leak into an arm. Every run
// starts from the inherited environment minus those; an arm that wants prod says so with PROD.
const PROD = { KOSMOS_WIN_CUT_CHANNEL: 'prod' };
// A prod publish is the BREAK-GLASS: it needs Josh's go for its exact zip. The #2008 arms test what
// a prod publish WRITES, not the approval, so the helper supplies the approval for the zip being
// published unless an arm sets the variables itself (an explicit '' withholds one). Approvals go to
// a throwaway log, never the operator's.
const TEST_APPROVAL_LOG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pubwin-approvals-')), 'approvals.log');
function publishEnvironment(site, extraEnv, zip) {
  const env = { ...process.env, KOSMOS_SITE: site, KOSMOS_WIN_PROMOTE_LOG: TEST_APPROVAL_LOG };
  for (const name of ['KOSMOS_CUT_CHANNEL', 'KOSMOS_WIN_CUT_CHANNEL', 'KOSMOS_WIN_PROD_APPROVED_SHA', 'KOSMOS_WIN_PROD_APPROVAL_REF']) delete env[name];
  const merged = { ...env, ...extraEnv };
  if (merged.KOSMOS_WIN_CUT_CHANNEL === 'prod') {
    if (!('KOSMOS_WIN_PROD_APPROVED_SHA' in extraEnv) && zip && fs.existsSync(zip)) merged.KOSMOS_WIN_PROD_APPROVED_SHA = sha256OfFile(zip);
    if (!('KOSMOS_WIN_PROD_APPROVAL_REF' in extraEnv)) merged.KOSMOS_WIN_PROD_APPROVAL_REF = 'test-approval-ref';
  }
  return merged;
}

function run(zip, site, extraEnv = {}, versionArg) {
  // versionArg exercises the explicit `[<version>]` argument, a DISTINCT code path from the
  // default: it skips the unzip + in-zip package.json read entirely.
  const argv = versionArg === undefined ? [SCRIPT, zip] : [SCRIPT, zip, versionArg];
  return execFileSync('sh', argv, {
    env: publishEnvironment(site, extraEnv, zip),
    encoding: 'utf8',
  });
}

// Like run(), but returns the whole result (status, stdout, stderr) and never throws, for the arms
// that assert a refusal's message or a success's stderr.
function runResult(zip, site, extraEnv = {}) {
  return spawnSync('sh', [SCRIPT, zip], { env: publishEnvironment(site, extraEnv, zip), encoding: 'utf8' });
}

function freshSite() {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'pubwin-site-'));
  fs.mkdirSync(path.join(site, 'dist'), { recursive: true });
  return site;
}

// Like run(), but captures stderr on a SUCCESSFUL run (execFileSync returns only stdout), so the
// NOTICE-on-stderr arm can assert what was and was not printed. Asserts a clean exit itself.
function runCaptureStderr(zip, site, extraEnv = {}) {
  const r = spawnSync('sh', [SCRIPT, zip], {
    env: publishEnvironment(site, extraEnv, zip),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `publish must succeed; stderr:\n${r.stderr}`);
  return r.stderr;
}

// fixtureZip writes kosmos-win-x64.zip into `dir`, so each version needs its own dir to coexist.
function fixtureZipIn(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pubwin-fix-'));
  return fixtureZip(dir, version);
}

function sha256OfFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function snapshotDist(dist) {
  const snapshot = {};
  for (const f of fs.readdirSync(dist)) snapshot[f] = fs.readFileSync(path.join(dist, f));
  return snapshot;
}

test('#2008: stages the alias, a versioned copy, sha sidecars and latest-win.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pubwin-fix-'));
  const site = freshSite();
  const zip = fixtureZip(dir, '9.9.9');
  run(zip, site, PROD);
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
  const realSha = sha256OfFile(path.join(dist, 'kosmos-win-x64.zip'));
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
  run(fixtureZip(dir, '3.2.1'), site, PROD);
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
  run(zipA, site, PROD);
  const versioned = path.join(site, 'dist', 'kosmos-1.0.0-win-x64.zip');
  const firstBytes = fs.readFileSync(versioned);
  // Re-running with the SAME zip FILE (byte-identical) is idempotent -- a retry after a partial
  // run must succeed, not refuse. Reuse the identical zip rather than RE-zipping the same source:
  // zip embeds each file's mtime at 2-second DOS granularity, so a re-zip across a 2s boundary
  // produces different bytes, which the immutability guard would (correctly) refuse -- a test
  // flake, not a product bug (the product defines idempotency by cmp on actual bytes).
  run(zipA, site, PROD);
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
  const snap = snapshotDist(dist);
  assert.throws(() => run(zipB, site, PROD), /refusing to republish a versioned name/,
    'different bytes under the same versioned name must be refused');
  // ...and on the staging channel too: the staged versioned name is the one a promote points prod at.
  assert.throws(() => run(zipB, site), /refusing to republish a versioned name/,
    'a staging publish must refuse different bytes under a published versioned name as well');
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
  run(fixtureZip(dir, '9.9.9'), site, PROD, '7.7.7');
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
  run(fixtureZip(dir, V), site, PROD);
  const dist = path.join(site, 'dist');
  assert.ok(fs.existsSync(path.join(dist, `kosmos-${V}-win-x64.zip`)),
    'a version using the allowed . + _ - characters must be staged, not refused');
  const lj = JSON.parse(fs.readFileSync(path.join(dist, 'latest-win.json'), 'utf8'));
  assert.equal(lj.version, V, 'latest-win.json.version must carry the build-metadata version verbatim');
});

test('#2008: the ARCH path-escape guard refuses an arch with a path separator, staging nothing', () => {
  // ARCH feeds the same staged filenames as VERSION; a "/" in it (KOSMOS_WIN_ARCH=../x) would make
  // cp write outside dist/. The reject side of the VERSION guard is covered (../evil); this is the
  // matching reject test for ARCH, so the guard cannot regress silently.
  const site = freshSite();
  assert.throws(() => run(fixtureZipIn('1.0.0'), site, { KOSMOS_WIN_ARCH: '../x' }),
    /refusing an implausible arch/, 'an arch with a path separator must be refused');
  assert.deepEqual(fs.readdirSync(path.join(site, 'dist')), [], 'a refused arch must stage nothing');
});

test('#2008: the repoint NOTICE fires only on re-publishing an already-present version, not on a forward release or a same-version rerun', () => {
  const site = freshSite();
  const zip1 = fixtureZipIn('1.0.0');
  const zip2 = fixtureZipIn('2.0.0');
  // Forward release of a NEW version: no NOTICE (2.0.0 was never in dist).
  runCaptureStderr(zip1, site, PROD);
  const fwd = runCaptureStderr(zip2, site, PROD);
  assert.doesNotMatch(fwd, /repoints the alias/,
    'a forward release of a not-yet-present version must NOT print the repoint notice');
  // Same-version rerun (idempotent re-stage of the CURRENT alias version): no NOTICE.
  const same = runCaptureStderr(zip2, site, PROD);
  assert.doesNotMatch(same, /repoints the alias/,
    'a same-version rerun must NOT print the repoint notice (PREV_V == VERSION)');
  // Re-publishing an ALREADY-PRESENT version while the alias is on a different one (the sidecar-
  // regen / rollback shape): NOTICE fires, naming both versions. zip1's versioned copy still exists
  // from the first publish, and its bytes are identical (same file), so the immutability guard passes.
  const back = runCaptureStderr(zip1, site, PROD);
  assert.match(back, /re-publishing already-present version 1\.0\.0 repoints the alias .* off the current 2\.0\.0/,
    're-publishing an already-present version must print the repoint notice naming both versions');
  // And it actually moved: the alias now serves 1.0.0.
  const lj = JSON.parse(fs.readFileSync(path.join(site, 'dist', 'latest-win.json'), 'utf8'));
  assert.equal(lj.version, '1.0.0', 'the alias manifest must reflect the repointed version');
  // A STAGING re-publish of an already-present version never moves the alias, so it has nothing to
  // warn about: the NOTICE is prod-only.
  const staged = runCaptureStderr(zip2, site);
  assert.doesNotMatch(staged, /repoints the alias/, 'a staging publish must not print the alias repoint notice');
});

// ---------------------------------------------------------------------------------------------
// The channel (Josh, 2026-09-12: every cut goes to STAGING first, and to prod only after his go).
// ---------------------------------------------------------------------------------------------

test('staging (the default): stages ONLY the versioned zip, its sidecar and latest-win-staging.json', () => {
  const site = freshSite();
  const dist = path.join(site, 'dist');
  const out = run(fixtureZipIn('4.0.0'), site);
  assert.deepEqual(fs.readdirSync(dist).sort(),
    ['kosmos-4.0.0-win-x64.zip', 'kosmos-4.0.0-win-x64.zip.sha256', 'latest-win-staging.json'],
    'a staging publish must write exactly the versioned pair and the staging pointer -- no alias, no latest-win.json');
  const sha = sha256OfFile(path.join(dist, 'kosmos-4.0.0-win-x64.zip'));
  assert.match(fs.readFileSync(path.join(dist, 'kosmos-4.0.0-win-x64.zip.sha256'), 'utf8').trim(),
    new RegExp(`^${sha}\\s+kosmos-4\\.0\\.0-win-x64\\.zip$`), 'the versioned sidecar must carry the real sha and name its own file');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dist, 'latest-win-staging.json'), 'utf8')), {
    version: '4.0.0', sha256: sha, artifact: 'kosmos-win-x64.zip', versioned: 'kosmos-4.0.0-win-x64.zip', arch: 'x64',
  }, 'the staging pointer has the prod pointer shape, naming the versioned build');
  assert.match(out, /on the STAGING channel/, 'the publish must say it staged, not published to prod');
});

test('staging leaves the alias, its sidecar and latest-win.json byte-identical', () => {
  const site = freshSite();
  const dist = path.join(site, 'dist');
  run(fixtureZipIn('1.0.0'), site, PROD);   // prod today: 1.0.0
  const before = snapshotDist(dist);
  run(fixtureZipIn('2.0.0'), site);         // stage 2.0.0 (the default channel)
  for (const f of Object.keys(before)) {
    assert.deepEqual(fs.readFileSync(path.join(dist, f)), before[f], `a staging publish must leave ${f} byte-for-byte unchanged`);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(dist, 'latest-win.json'), 'utf8')).version, '1.0.0',
    'prod still names the prior build');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dist, 'latest-win-staging.json'), 'utf8')).version, '2.0.0',
    'the staging pointer names the new build');
});

test('prod (KOSMOS_CUT_CHANNEL=prod) keeps today\'s outputs: the five files, the exact pointer bytes, no staging pointer', () => {
  const site = freshSite();
  const dist = path.join(site, 'dist');
  const out = run(fixtureZipIn('5.0.0'), site, PROD);
  assert.deepEqual(fs.readdirSync(dist).sort(), [
    'kosmos-5.0.0-win-x64.zip', 'kosmos-5.0.0-win-x64.zip.sha256',
    'kosmos-win-x64.zip', 'kosmos-win-x64.zip.sha256', 'latest-win.json',
  ], 'a prod publish writes exactly what it always has, and never a staging pointer');
  const sha = sha256OfFile(path.join(dist, 'kosmos-win-x64.zip'));
  // The bytes the inline writer produced before the shared writer existed: this key order, one
  // line, a trailing newline.
  assert.equal(fs.readFileSync(path.join(dist, 'latest-win.json'), 'utf8'),
    JSON.stringify({ version: '5.0.0', sha256: sha, artifact: 'kosmos-win-x64.zip', versioned: 'kosmos-5.0.0-win-x64.zip', arch: 'x64' }) + '\n',
    'latest-win.json must be byte-for-byte what a prod publish always wrote');
  assert.match(out, /^publish-win: staged into .* \(NOT deployed\):$/m);
  assert.match(out, /^ {3}alias: {5}kosmos-win-x64\.zip \([0-9a-f]{64}\)$/m);
});

test('one pointer writer: the staging pointer and the prod pointer for one build are the same bytes', () => {
  // promote-channel.sh --family win copies latest-win-staging.json onto latest-win.json. That is
  // only a faithful promote if a staging publish and a prod publish of the same build write the
  // same bytes -- which holds only while both go through tools/lib/write-latest-win-pointer.js.
  const zip = fixtureZipIn('6.0.0');
  const stagingSite = freshSite();
  const prodSite = freshSite();
  run(zip, stagingSite);
  run(zip, prodSite, PROD);
  assert.deepEqual(
    fs.readFileSync(path.join(stagingSite, 'dist', 'latest-win-staging.json')),
    fs.readFileSync(path.join(prodSite, 'dist', 'latest-win.json')),
    'the staging pointer must equal the prod pointer byte for byte');
});

test('an unknown KOSMOS_WIN_CUT_CHANNEL is refused before anything is staged', () => {
  const site = freshSite();
  assert.throws(() => run(fixtureZipIn('7.0.0'), site, { KOSMOS_WIN_CUT_CHANNEL: 'Prod' }),
    /KOSMOS_WIN_CUT_CHANNEL must be 'staging' or 'prod' \(got 'Prod'\)/, 'a mistyped channel must be refused, not guessed');
  assert.deepEqual(fs.readdirSync(path.join(site, 'dist')), [], 'a refused channel must stage nothing');
});

test('the Mac cut\'s KOSMOS_CUT_CHANNEL=prod does NOT move Windows prod: a bare publish still stages', () => {
  // The shared variable defaults to prod in release.sh. When it was shared, an operator who
  // exported it for a Mac cut published Windows straight to prod with no log line.
  const site = freshSite();
  const dist = path.join(site, 'dist');
  run(fixtureZipIn('1.0.0'), site, PROD);
  const prodBefore = fs.readFileSync(path.join(dist, 'latest-win.json'));
  const r = runResult(fixtureZipIn('2.0.0'), site, { KOSMOS_CUT_CHANNEL: 'prod' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readFileSync(path.join(dist, 'latest-win.json')), prodBefore, 'latest-win.json must not move');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dist, 'latest-win-staging.json'), 'utf8')).version, '2.0.0', 'it staged instead');
  assert.match(r.stderr, /KOSMOS_CUT_CHANNEL=prod is the Mac cut's channel and is ignored here/, 'the operator is told the variable was ignored');
});

// ---------------------------------------------------------------------------------------------
// The break-glass: KOSMOS_WIN_CUT_CHANNEL=prod needs Josh's go for this exact zip, logged first.
// ---------------------------------------------------------------------------------------------

function freshApprovalLog() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pubwin-log-')), 'approvals.log');
}

test('break-glass: a direct prod publish without Josh\'s go for this exact zip is refused, staging and logging nothing', () => {
  const zip = fixtureZipIn('8.0.0');
  const sha = sha256OfFile(zip);
  const refusals = [
    { label: 'no approved sha', env: { KOSMOS_WIN_PROD_APPROVED_SHA: '' }, message: /Josh's go is required/ },
    { label: 'no approval reference', env: { KOSMOS_WIN_PROD_APPROVAL_REF: '' }, message: /Josh's go is required/ },
    { label: 'another build\'s sha', env: { KOSMOS_WIN_PROD_APPROVED_SHA: '0'.repeat(64) }, message: /is not this zip's sha256/ },
    { label: 'a reference that is not a Slack ts or permalink', env: { KOSMOS_WIN_PROD_APPROVAL_REF: 'josh said yes' }, message: /is not a Slack message ts or permalink/ },
  ];
  for (const { label, env, message } of refusals) {
    const site = freshSite();
    const log = freshApprovalLog();
    const r = runResult(zip, site, { ...PROD, KOSMOS_WIN_PROMOTE_LOG: log, ...env });
    assert.notEqual(r.status, 0, `${label}: must refuse`);
    assert.match(r.stderr, message, `${label}: must say why`);
    assert.deepEqual(fs.readdirSync(path.join(site, 'dist')), [], `${label}: must stage nothing`);
    assert.ok(!fs.existsSync(log), `${label}: must log no approval`);
    // The approval has to come from Josh's message, so no refusal hands out the sha to paste.
    assert.ok(!r.stderr.includes(sha), `${label}: must not print the zip's sha to paste`);
  }
});

test('break-glass: an approval that cannot be logged is refused, staging nothing', () => {
  const site = freshSite();
  const notADirectory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pubwin-log-')), 'a-file');
  fs.writeFileSync(notADirectory, '');
  const r = runResult(fixtureZipIn('8.1.0'), site, { ...PROD, KOSMOS_WIN_PROMOTE_LOG: path.join(notADirectory, 'approvals.log') });
  assert.notEqual(r.status, 0, 'an unwritable approval log must refuse');
  assert.match(r.stderr, /could not record Josh's go/);
  assert.deepEqual(fs.readdirSync(path.join(site, 'dist')), [], 'a refusal must stage nothing');
});

test('break-glass: with the approved sha and a reference it publishes prod, logs path=direct first, and prints a banner', () => {
  const site = freshSite();
  const log = freshApprovalLog();
  const zip = fixtureZipIn('8.2.0');
  const sha = sha256OfFile(zip);
  const ref = 'https://kosmos.slack.com/archives/C0/p1789228393821399';
  const r = runResult(zip, site, { ...PROD, KOSMOS_WIN_PROMOTE_LOG: log, KOSMOS_WIN_PROD_APPROVED_SHA: sha, KOSMOS_WIN_PROD_APPROVAL_REF: ref });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(site, 'dist', 'latest-win.json'), 'utf8')).version, '8.2.0');
  assert.match(fs.readFileSync(log, 'utf8'),
    new RegExp(`^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z family=win path=direct version=8\\.2\\.0 sha256=${sha} approval_ref=${ref.replace(/[.?/]/g, '\\$&')} approval=given$`, 'm'),
    'the approval is logged with the version, the sha, the reference and a UTC time (never a name)');
  assert.match(r.stderr, /BREAK-GLASS: a DIRECT PROD publish of 8\.2\.0/, 'a direct prod publish is loud');
});

test('the channel vocabulary is release.sh\'s: the same values, with a staging default here', () => {
  // Two scripts parse KOSMOS_CUT_CHANNEL (release.sh for the Mac cut, this one for Windows). They
  // are two copies by necessity (release.sh parses inline and pins its literal), so pin their
  // accepted values equal: a third value added to one and not the other would silently diverge.
  function channelArms(relativeFile) {
    const source = fs.readFileSync(path.resolve(__dirname, relativeFile), 'utf8');
    const block = source.match(/case "\$CUT_CHANNEL" in\r?\n([\s\S]*?)\r?\n\s*esac/);
    assert.ok(block, `${relativeFile} must parse its channel with a case "$CUT_CHANNEL" block`);
    return [...block[1].matchAll(/^\s*([a-z]+)\)/gm)].map((m) => m[1]).sort();
  }
  assert.deepEqual(channelArms('tools/release.sh'), ['prod', 'staging']);
  assert.deepEqual(channelArms('tools/publish-kosmos-windows.sh'), channelArms('tools/release.sh'),
    'publish-kosmos-windows.sh must accept exactly the channels release.sh accepts');
  assert.match(fs.readFileSync(SCRIPT, 'utf8'), /CUT_CHANNEL="\$\{KOSMOS_WIN_CUT_CHANNEL:-staging\}"/,
    'a Windows publish reads its OWN variable, KOSMOS_WIN_CUT_CHANNEL, and defaults to staging');
});
