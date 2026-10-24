'use strict';

/**
 * #6468 ask 3: an update checks the installer script against the target version's SIGNED manifest before it runs it.
 *
 * engine/manifest-verify.js verifySetup is driven with a throwaway key passed as the pinned list; runSetup (what
 * engine/update.js and `kosmos update` run) end to end over a file:// release base with a copy of the verifier whose
 * pinned list is rewritten to that key; the build records setup_sha256; the board words exit 97.
 *
 *   node --test install.setup-sig-6468.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { verifySetup, NOT_RUN, NOT_FETCHED } = require('./engine/manifest-verify.js');
const VERIFIER = fs.readFileSync(path.join(__dirname, 'engine', 'manifest-verify.js'), 'utf8');
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

let tmp;
test.before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-setupsig-6468-')); });
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** A release host: dist/ with the manifest + .sig for `version`, and the installer at the base's sibling /setup. */
function host(version, { setupBody = 'echo ran-setup > "$MARK"\n', recorded, key = privateKey, noSig = false } = {}) {
  const root = fs.mkdtempSync(path.join(tmp, 'host-'));
  const dist = path.join(root, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(root, 'setup'), setupBody);
  const m = { manifest: 1, version, arch: 'arm64', files: [] };
  if (recorded !== null) m.setup_sha256 = recorded || sha(Buffer.from(setupBody));
  const mp = path.join(dist, `kosmos-${version}-arm64.manifest.json`);
  fs.writeFileSync(mp, JSON.stringify(m) + '\n');
  if (!noSig) fs.writeFileSync(mp + '.sig', crypto.sign(null, fs.readFileSync(mp), key).toString('base64') + '\n');
  return { root, dist, setup: path.join(root, 'setup'), manifest: mp, sig: mp + '.sig' };
}
/** An installed home whose verifier pins the throwaway key. */
function home(version) {
  const h = fs.mkdtempSync(path.join(tmp, 'home-'));
  fs.mkdirSync(path.join(h, 'app', 'engine'), { recursive: true });
  const pinned = VERIFIER.replace(/const KEYS = \[[\s\S]*?\];/, `const KEYS = [${JSON.stringify(PUB)}];`);
  assert.notEqual(pinned, VERIFIER, 'the KEYS list moved; this fixture cannot pin its key');
  fs.writeFileSync(path.join(h, 'app', 'engine', 'manifest-verify.js'), pinned);
  fs.writeFileSync(path.join(h, 'app', 'package.json'), JSON.stringify({ version }) + '\n');
  return h;
}
function runSetup(h, hst, version) {
  const mark = path.join(tmp, 'mark-' + crypto.randomBytes(4).toString('hex'));
  const r = spawnSync(process.execPath, [path.join(h, 'app', 'engine', 'manifest-verify.js'), 'run-setup',
    'file://' + hst.setup, 'file://' + hst.dist, version, h], { encoding: 'utf8', env: { ...process.env, MARK: mark } });
  return { code: r.status, err: r.stderr, ran: fs.existsSync(mark) };
}

test('verifySetup: CONTROL: the installer the signed manifest names passes', () => {
  const h = host('1.2.3');
  assert.equal(verifySetup({ manifest: h.manifest, sig: h.sig, setup: h.setup, version: '1.2.3', installedVersion: '1.2.0', keys: [PUB] }).code, 0);
});
test('verifySetup: another installer, another key, another version, an older one: refused', () => {
  const h = host('1.2.3');
  fs.appendFileSync(h.setup, 'echo extra\n');
  assert.match(verifySetup({ manifest: h.manifest, sig: h.sig, setup: h.setup, version: '1.2.3', installedVersion: '1.2.0', keys: [PUB] }).why, /does not match its signed release/);
  const o = crypto.generateKeyPairSync('ed25519');
  const h2 = host('1.2.3', { key: o.privateKey });
  assert.equal(verifySetup({ manifest: h2.manifest, sig: h2.sig, setup: h2.setup, version: '1.2.3', installedVersion: '1.2.0', keys: [PUB] }).code, 1);
  const h3 = host('1.2.3');
  assert.equal(verifySetup({ manifest: h3.manifest, sig: h3.sig, setup: h3.setup, version: '1.2.4', installedVersion: '1.2.0', keys: [PUB] }).code, 1);
  assert.match(verifySetup({ manifest: h3.manifest, sig: h3.sig, setup: h3.setup, version: '1.2.3', installedVersion: '1.3.0', keys: [PUB] }).why, /older than the installed/);
});
test('verifySetup: a manifest that records no installer is exit 3 (cut before this), not a pass', () => {
  const h = host('1.2.3', { recorded: null });
  assert.equal(verifySetup({ manifest: h.manifest, sig: h.sig, setup: h.setup, version: '1.2.3', installedVersion: '1.2.0', keys: [PUB] }).code, 3);
});

test('run-setup: CONTROL: a matching installer runs, and its exit code comes back', () => {
  const r = runSetup(home('1.2.0'), host('1.2.3'), '1.2.3');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.ran, true);
  const r2 = runSetup(home('1.2.0'), host('1.2.3', { setupBody: 'exit 7\n' }), '1.2.3');
  assert.equal(r2.code, 7, r2.err);
});
test('run-setup: a tampered installer, a missing .sig, or an unknown version runs NOTHING and exits 97', () => {
  const hst = host('1.2.3');
  fs.appendFileSync(hst.setup, 'echo planted\n');
  let r = runSetup(home('1.2.0'), hst, '1.2.3');
  assert.equal(r.code, NOT_RUN, r.err);
  assert.equal(r.ran, false);
  assert.match(r.err, /does not match its signed release, so the installer was not run/);
  r = runSetup(home('1.2.0'), host('1.2.3', { noSig: true }), '1.2.3');
  assert.equal(r.code, NOT_FETCHED, r.err + ' (a download that failed is 96, retryable, not 97)');
  assert.equal(r.ran, false);
  r = runSetup(home('1.2.0'), host('1.2.3'), '');
  assert.equal(r.code, NOT_RUN, r.err);
  assert.equal(r.ran, false);
});
test('run-setup: NODE_OPTIONS is not handed to the installer, and it gets no stdin', () => {
  const hst = host('1.2.3', { setupBody: 'printf "opts=[%s]\\n" "${NODE_OPTIONS:-}" > "$MARK.env"; if read -r x; then echo got > "$MARK.in"; fi; : > "$MARK"\n' });
  const mark = path.join(tmp, 'mark-env');
  const h = home('1.2.0');
  const r = spawnSync(process.execPath, [path.join(h, 'app', 'engine', 'manifest-verify.js'), 'run-setup',
    'file://' + hst.setup, 'file://' + hst.dist, '1.2.3', h], { encoding: 'utf8', input: 'typed\n', env: { ...process.env, MARK: mark, NODE_OPTIONS: '--no-warnings' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(mark + '.env', 'utf8'), 'opts=[]\n');
  assert.equal(fs.existsSync(mark + '.in'), false, 'the installer read stdin');
});

test('#6659: run-setup installs into the home it was handed, not the default one, whatever the environment says', () => {
  /* The board runs with no KOSMOS_HOME exported (install/kosmos sets it unexported), so without this the installer took
     its default, ~/.local/share/kosmos: a board installed anywhere else updated (and paused) the person's default copy
     instead of itself. The installer here only records what home it was given. */
  const hst = host('1.2.3', { setupBody: 'printf "home=[%s]\\n" "${KOSMOS_HOME:-unset}" > "$MARK.env"; : > "$MARK"\n' });
  for (const [what, extra] of [['no KOSMOS_HOME in the environment', {}], ['another KOSMOS_HOME in the environment', { KOSMOS_HOME: '/tmp/some-other-kosmos' }]]) {
    const mark = path.join(tmp, 'mark-home-' + crypto.randomBytes(4).toString('hex'));
    const h = home('1.2.0');
    const env = { ...process.env, MARK: mark, HOME: fs.mkdtempSync(path.join(tmp, 'person-')), ...extra };   // never the real default home
    if (!('KOSMOS_HOME' in extra)) delete env.KOSMOS_HOME;
    const r = spawnSync(process.execPath, [path.join(h, 'app', 'engine', 'manifest-verify.js'), 'run-setup',
      'file://' + hst.setup, 'file://' + hst.dist, '1.2.3', h], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(mark + '.env', 'utf8'), `home=[${h}]\n`, what);
  }
});

test('#6659 (review 1): a home that IS the default copy, reached through a link, reaches the installer as the default string', () => {
  /* setup.sh tells the default copy from a sandboxed one (data folders, launch label, ~/.local/bin) by the path STRING,
     and installedRoot() resolves links. HOME is a scratch folder here, so nothing real is named. */
  const fakeHome = fs.mkdtempSync(path.join(tmp, 'person-'));
  const dflt = path.join(fakeHome, '.local', 'share', 'kosmos');
  const real = home('1.2.0');
  fs.mkdirSync(path.dirname(dflt), { recursive: true });
  fs.symlinkSync(real, dflt);   // the default path is a link to where the copy really is
  const hst = host('1.2.3', { setupBody: 'printf "home=[%s]\\n" "${KOSMOS_HOME:-unset}" > "$MARK.env"; : > "$MARK"\n' });
  for (const [what, handed, want] of [['the resolved path of the default copy', real, dflt], ['another home, through a link of its own', null, null]]) {
    let h = handed, expect = want;
    if (!h) { h = path.join(tmp, 'link-' + crypto.randomBytes(3).toString('hex')); fs.symlinkSync(home('1.2.0'), h); expect = h; }
    const mark = path.join(tmp, 'mark-dflt-' + crypto.randomBytes(4).toString('hex'));
    const env = { ...process.env, MARK: mark, HOME: fakeHome };
    delete env.KOSMOS_HOME;
    const r = spawnSync(process.execPath, [path.join(real, 'app', 'engine', 'manifest-verify.js'), 'run-setup',
      'file://' + hst.setup, 'file://' + hst.dist, '1.2.3', h], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(mark + '.env', 'utf8'), `home=[${expect}]\n`, what);
  }
});

test('#6659 (review 1): the board is told the home it was installed under, and the update hands that to run-setup', () => {
  const kosmos = fs.readFileSync(path.join(__dirname, 'install', 'kosmos'), 'utf8');
  assert.equal((kosmos.match(/KOSMOS_INSTALLED_HOME="\$KOSMOS_HOME" (nohup )?"\$NODE" "\$APP"/g) || []).length, 2, 'both board launches');
  assert.doesNotMatch(kosmos, /export KOSMOS_HOME/, 'KOSMOS_HOME itself stays unexported (agents the board starts must not inherit it)');
  // Review 3: the board takes the installed path out of its environment at startup, so its agents never inherit it.
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(server, /setInstalledHomeAsInstalled\(process\.env\.KOSMOS_INSTALLED_HOME\);\ndelete process\.env\.KOSMOS_INSTALLED_HOME;/);
  const update = fs.readFileSync(path.join(__dirname, 'engine', 'update.js'), 'utf8');
  const fn = update.slice(update.indexOf('function installedHomeAsInstalled() {'), update.indexOf('\n}\n', update.indexOf('function installedHomeAsInstalled() {')));
  assert.match(fn, /fs\.realpathSync\(said\) === fs\.realpathSync\(root\)\) return said;/, 'only when it is this very copy');
  assert.match(fn, /return root;$/);
  const line = update.split('\n').find((l) => l.includes("run-setup \"$1\" \"$7\" \"$8\" \"$9\""));
  assert.ok(line && line.includes('installedHomeAsInstalled()') && !line.includes('installedRoot()'), 'the update passes the installed path');
});

test('#6659 (review 2): installedHomeAsInstalled uses the installed path only when it IS this copy, else the root', () => {
  const update = require('./engine/update.js');
  const real = home('1.2.0');
  fs.mkdirSync(path.join(real, 'runtime', 'bin'), { recursive: true });
  const link = path.join(tmp, 'as-installed-' + crypto.randomBytes(3).toString('hex'));
  fs.symlinkSync(real, link);
  const other = home('1.2.0');
  update.setInstalledRoot(() => fs.realpathSync(real));
  try {
    const at = (v) => { update.setInstalledHomeAsInstalled(v); return update.installedHomeAsInstalled(); };
    assert.equal(at(link), link, 'the path as installed, when it resolves to this copy');
    assert.equal(at(undefined), fs.realpathSync(real), 'none: the root');
    assert.equal(at(path.join(tmp, 'gone-' + crypto.randomBytes(3).toString('hex'))), fs.realpathSync(real), 'a path that is gone: the root');
    assert.equal(at(other), fs.realpathSync(real), 'another copy: the root');
    assert.equal(at(path.relative(process.cwd(), real)), fs.realpathSync(real), 'a relative path, even one that resolves here: the root');
  } finally {
    update.setInstalledRoot(null);
    update.setInstalledHomeAsInstalled(undefined);
  }
});

test('the build records setup_sha256 from install/setup.sh in the manifest it signs', () => {
  const src = fs.readFileSync(path.join(__dirname, 'tools', 'build-kosmos-bundle.sh'), 'utf8');
  assert.match(src, /KM_SETUP_SHA="\$\(shasum -a 256 "\$REPO\/install\/setup\.sh"/);
  assert.match(src, /setup_sha256: e\.KM_SETUP_SHA,/);
});
test('the board words exit 97 as "could not be checked", not as a crash', () => {
  const src = fs.readFileSync(path.join(__dirname, 'engine', 'update.js'), 'utf8');
  assert.match(src, /if \(s\.code === 97\) return \{[^}]*because: 'the update could not be checked against its signed release, so nothing was installed\. Try again in a few minutes'/);
});

test('run-setup: an installer that exits 97 or 96 itself is reported as 1, never as "not run"; no home is refused', () => {
  const r = runSetup(home('1.2.0'), host('1.2.3', { setupBody: 'exit 97\n' }), '1.2.3');
  assert.equal(r.code, 1, r.err);
  assert.equal(runSetup(home('1.2.0'), host('1.2.3', { setupBody: 'exit 96\n' }), '1.2.3').code, 1);
  const hst = host('1.2.3');
  const x = spawnSync(process.execPath, [path.join(home('1.2.0'), 'app', 'engine', 'manifest-verify.js'), 'run-setup',
    'file://' + hst.setup, 'file://' + hst.dist, '1.2.3', ''], { encoding: 'utf8' });
  assert.equal(x.status, NOT_RUN, x.stderr);
  assert.match(x.stderr, /installed copy could not be found/);
});

test('run-setup: a refusal is 97 and a failed download is 96, so a caller retries only what a retry can fix', () => {
  const refused = host('1.2.3');
  fs.appendFileSync(refused.setup, 'planted\n');
  assert.equal(runSetup(home('1.2.0'), refused, '1.2.3').code, NOT_RUN);
  assert.equal(runSetup(home('1.3.0'), host('1.2.3'), '1.2.3').code, NOT_RUN, 'older than installed is a refusal, not a download');
  const gone = host('1.2.3');
  fs.rmSync(gone.setup);
  assert.equal(runSetup(home('1.2.0'), gone, '1.2.3').code, NOT_FETCHED);
});
