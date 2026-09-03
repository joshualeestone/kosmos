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

function run(zip, site, extraEnv = {}) {
  return execFileSync('sh', [SCRIPT, zip], {
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
  // And nothing was staged on the refusal.
  assert.deepEqual(fs.readdirSync(path.join(site, 'dist')).filter((f) => f.includes('3.2.1') || f === 'latest-win.json'), []);
});
