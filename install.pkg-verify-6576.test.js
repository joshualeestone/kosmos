'use strict';
/**
 * kosmos#6576: a first install from the .pkg is held to the SIGNED release. Four parts, each run for real:
 *   1. the helper's built-in release keys are engine/manifest-verify.js's KEYS (one list, two copies);
 *   2. the helper (install/pkg-verify/main.swift), compiled with a throwaway key in place of the release key, against
 *      manifests that key signed: a good one prints the three sha256 values; a tampered manifest, another version, a
 *      release older than the floor, a missing field, and a manifest signed by another key are refused (97);
 *   3. the postinstall's root step, lifted verbatim, run against a local site (file:// with the real /usr/bin/curl)
 *      and that compiled helper: a good release yields the pins and a readable copy of the installer; a tampered
 *      installer, a tampered manifest and a missing signature end the install before anything runs;
 *   4. setup.sh's pinned_sha_ok, lifted verbatim: no pin passes, a matching pin passes, a different or malformed
 *      pin refuses.
 * Parts 2 and 3 need macOS and swiftc, and are skipped (said so) without them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REPO = __dirname;
const SWIFT = fs.readFileSync(path.join(REPO, 'install', 'pkg-verify', 'main.swift'), 'utf8');
const VERIFY_JS = fs.readFileSync(path.join(REPO, 'engine', 'manifest-verify.js'), 'utf8');
const POSTINSTALL = fs.readFileSync(path.join(REPO, 'install', 'pkg-scripts', 'postinstall'), 'utf8');
const SETUP = fs.readFileSync(path.join(REPO, 'install', 'setup.sh'), 'utf8');

const keysOf = (src, open) => {
  const at = src.indexOf(open);
  assert.notEqual(at, -1, open + ' is gone');
  const list = src.slice(at, src.indexOf(']', at));
  return [...list.matchAll(/"([A-Za-z0-9+/=]{40,})"|'([A-Za-z0-9+/=]{40,})'/g)].map((m) => m[1] || m[2]);
};

test('#6576: the helper trusts exactly the release keys engine/manifest-verify.js trusts', () => {
  const swift = keysOf(SWIFT, 'let releaseKeys = [');
  const js = keysOf(VERIFY_JS, 'const KEYS = [');
  assert.ok(js.length >= 1, 'manifest-verify.js pins no key');
  assert.deepEqual(swift, js, 'a key added or retired in one copy must be in the other, or the .pkg and the update disagree');
});

const swiftc = spawnSync('/usr/bin/xcrun', ['--find', 'swiftc'], { encoding: 'utf8' });
const CAN_BUILD = process.platform === 'darwin' && swiftc.status === 0;
const SKIP = CAN_BUILD ? false : 'needs macOS and swiftc';

let built = null;
function buildHelper() {
  if (built) return built;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkgverify-6576-'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const other = crypto.generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const releaseLine = SWIFT.match(/let releaseKeys = \[\n(\s+"[^"]+",\n)+\]/);
  assert.ok(releaseLine, 'the releaseKeys list moved; re-anchor this test');
  const src = SWIFT.replace(releaseLine[0], 'let releaseKeys = [\n    "' + spki + '",\n]');
  assert.notEqual(src, SWIFT);
  fs.writeFileSync(path.join(dir, 'main.swift'), src);
  const floor = fs.readFileSync(path.join(REPO, 'tools', 'macos-floor'), 'utf8').trim();
  const r = spawnSync('/usr/bin/xcrun', ['swiftc', '-target', 'arm64-apple-macos' + floor, '-O', path.join(dir, 'main.swift'), '-o', path.join(dir, 'kosmos-pkg-verify')], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'the helper does not compile: ' + r.stderr);
  built = { dir, bin: path.join(dir, 'kosmos-pkg-verify'), privateKey, otherKey: other.privateKey };
  return built;
}
const hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
function release(h, version, fields, key) {
  const manifest = Buffer.from(JSON.stringify(Object.assign({ manifest: 1, version, arch: 'arm64', files: {} }, fields)));
  const sig = crypto.sign(null, manifest, key || h.privateKey).toString('base64');
  return { manifest, sig };
}
function runHelper(h, rel, version, floor) {
  const d = fs.mkdtempSync(path.join(h.dir, 'run-'));
  fs.writeFileSync(path.join(d, 'm.json'), rel.manifest);
  fs.writeFileSync(path.join(d, 'm.sig'), rel.sig);
  return spawnSync(h.bin, [path.join(d, 'm.json'), path.join(d, 'm.sig'), version, floor], { encoding: 'utf8' });
}
const SHAS = { setup_sha256: 'a'.repeat(64), sha256: 'b'.repeat(64), tmux_sha256: 'c'.repeat(64) };

test('#6576: the helper accepts its signed release and prints the three sha256 values', { skip: SKIP }, () => {
  const h = buildHelper();
  const r = runHelper(h, release(h, '0.7.60', SHAS), '0.7.60', '0.7.57');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `setup_sha256=${'a'.repeat(64)}\nsha256=${'b'.repeat(64)}\ntmux_sha256=${'c'.repeat(64)}\n`);
});

test('#6576: the helper refuses (97) a tampered manifest, another key, another version, an older release, a missing field', { skip: SKIP }, () => {
  const h = buildHelper();
  const good = release(h, '0.7.60', SHAS);
  const tampered = { manifest: Buffer.concat([good.manifest, Buffer.from(' ')]), sig: good.sig };
  const cases = [
    ['a manifest one byte longer than what was signed', tampered, '0.7.60', '0.7.57', /not signed by the Kosmos release key/],
    ['a manifest signed by another key', release(h, '0.7.60', SHAS, h.otherKey), '0.7.60', '0.7.57', /not signed by the Kosmos release key/],
    ['a signature that is not one', { manifest: good.manifest, sig: 'AAAA' }, '0.7.60', '0.7.57', /not signed by the Kosmos release key/],
    ['another version than the site offered', good, '0.7.61', '0.7.57', /not the 0\.7\.61 offered/],
    ['a release older than the floor (an old signed release served again)', release(h, '0.7.56', SHAS), '0.7.56', '0.7.57', /older than the oldest release this installer accepts/],
    ['no tmux_sha256', release(h, '0.7.60', { setup_sha256: SHAS.setup_sha256, sha256: SHAS.sha256 }), '0.7.60', '0.7.57', /has no tmux_sha256/],
    ['a manifest for another architecture', release(h, '0.7.60', Object.assign({}, SHAS, { arch: 'x64' })), '0.7.60', '0.7.57', /not for this Mac/],
    ['the offered version spelled differently (0.7.060 for 0.7.60)', release(h, '0.7.060', SHAS), '0.7.60', '0.7.57', /not the 0\.7\.60 offered/],
    ['an uppercase sha256 (not the manifest form)', release(h, '0.7.60', Object.assign({}, SHAS, { sha256: 'B'.repeat(64) })), '0.7.60', '0.7.57', /has no sha256/],
  ];
  for (const [label, rel, v, floor, why] of cases) {
    const r = runHelper(h, rel, v, floor);
    assert.equal(r.status, 97, label + ': ' + r.stderr);
    assert.match(r.stderr, why, label);
    assert.equal(r.stdout, '', label + ': a refusal prints no pins');
  }
});

// ---- 3. the postinstall's root step, verbatim ----
function liftRootStep() {
  const start = POSTINSTALL.indexOf('# ---- kosmos#6576:');
  const end = POSTINSTALL.indexOf('# Run the current installer as that user', start);
  assert.ok(start > 0 && end > start, 'the root step moved; re-anchor this test');
  return POSTINSTALL.slice(start, end);
}
function siteWith(h, { setup, manifestTamper, noSig }) {
  const root = fs.mkdtempSync(path.join(h.dir, 'site-'));
  fs.mkdirSync(path.join(root, 'dist'));
  const setupBytes = Buffer.from(setup || '#!/bin/sh\n# kosmos-pkg-pins: honored\necho installing\n');
  const rel = release(h, '0.7.60', { setup_sha256: hex(setupBytes), sha256: 'b'.repeat(64), tmux_sha256: 'c'.repeat(64) });
  fs.writeFileSync(path.join(root, 'setup'), setupBytes);
  fs.writeFileSync(path.join(root, 'dist', 'latest.json'), JSON.stringify({ version: '0.7.60' }));
  fs.writeFileSync(path.join(root, 'dist', 'kosmos-0.7.60-arm64.manifest.json'), manifestTamper ? Buffer.concat([rel.manifest, Buffer.from(' ')]) : rel.manifest);
  if (!noSig) fs.writeFileSync(path.join(root, 'dist', 'kosmos-0.7.60-arm64.manifest.json.sig'), rel.sig);
  return { root, setupSha: hex(setupBytes) };
}
function runRootStep(h, site, { home, setupOverride, floor, prelude, sleep, helperScript } = {}) {
  const scripts = fs.mkdtempSync(path.join(h.dir, 'scripts-'));
  if (helperScript) fs.writeFileSync(path.join(scripts, 'kosmos-pkg-verify'), helperScript);
  else fs.copyFileSync(h.bin, path.join(scripts, 'kosmos-pkg-verify'));
  fs.chmodSync(path.join(scripts, 'kosmos-pkg-verify'), 0o755);
  fs.writeFileSync(path.join(scripts, 'kosmos-pkg-floor'), (floor || '0.7.57') + '\n');
  if (setupOverride) fs.writeFileSync(path.join(site.root, 'setup'), setupOverride);
  const userHome = home || fs.mkdtempSync(path.join(h.dir, 'home-'));
  const body = 'set -u\nUSER_HOME="$1"\nSETUP_URL="$2"\n' + (prelude || '') + liftRootStep()
    + '\nprintf "PIN_VERSION=%s\\n" "$PIN_VERSION"\nprintf "PIN_SETUP_SHA=%s\\nPIN_TARBALL=%s\\nPIN_TMUX=%s\\n" "$([ -n "$PIN_SETUP" ] && /usr/bin/shasum -a 256 "$PIN_SETUP" | /usr/bin/awk \'{print $1}\')" "$PIN_TARBALL" "$PIN_TMUX"\n'
    + 'printf "MODE=%s\\n" "$([ -n "$PIN_SETUP" ] && /usr/bin/stat -f %Lp "$PIN_SETUP")"\n';
  const script = path.join(scripts, 'postinstall');
  fs.writeFileSync(script, body);
  return spawnSync('/bin/sh', [script, userHome, 'file://' + path.join(site.root, 'setup')], { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { KOSMOS_PKG_RETRY_SLEEP: sleep || '0' }) });
}

test('#6576: a first install pins the signed release: the installer it hands over, and the Kosmos and tmux sha256', { skip: SKIP }, () => {
  const h = buildHelper();
  const site = siteWith(h, {});
  const r = runRootStep(h, site);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /the installer matches signed release 0\.7\.60/);
  assert.match(r.stdout, new RegExp('PIN_SETUP_SHA=' + site.setupSha + '\n'));
  assert.match(r.stdout, new RegExp('PIN_TARBALL=' + 'b'.repeat(64) + '\n'));
  assert.match(r.stdout, new RegExp('PIN_TMUX=' + 'c'.repeat(64) + '\n'));
  assert.match(r.stdout, /MODE=644\n/, 'the person can read the checked installer');
  assert.match(r.stdout, /PIN_VERSION=0\.7\.60\n/, 'the checked version is handed over, so setup.sh installs exactly it');
});

test('#6576: a genuinely signed installer that does not honour the pins (an older release) is refused, whatever the floor', { skip: SKIP }, () => {
  const h = buildHelper();
  // Its sha256 is the signed setup_sha256, so everything else checks out; only the capability line is missing.
  const r = runRootStep(h, siteWith(h, { setup: '#!/bin/sh\necho an older installer\n' }));
  assert.equal(r.status, 97, r.stderr);
  assert.match(r.stderr, /signed, but its installer cannot hold the downloads to it/);
  assert.doesNotMatch(r.stdout, /PIN_SETUP_SHA=[0-9a-f]/);
  // And the shipped setup.sh carries the line, exactly once, as a whole line.
  assert.equal(SETUP.split('\n').filter((l) => l === '# kosmos-pkg-pins: honored').length, 1);
});

test('#6576: an installer that does not match is rechecked (a deploy caught half way), then refused if it persists', { skip: SKIP }, () => {
  const h = buildHelper();
  const a = runRootStep(h, siteWith(h, {}), { setupOverride: '#!/bin/sh\necho other\n' });
  assert.equal(a.status, 97, a.stderr);
  assert.equal((a.stderr.match(/does not match its signed release/g) || []).length, 1, 'one sentence, after the rechecks');
  // The recheck is real: the right installer published a moment later is taken, not refused.
  const site = siteWith(h, {});
  const good = path.join(site.root, 'setup.good');
  fs.copyFileSync(path.join(site.root, 'setup'), good);
  fs.writeFileSync(path.join(site.root, 'setup'), '#!/bin/sh\necho half-published\n');
  const b = runRootStep(h, site, { sleep: '1', prelude: '( /bin/sleep 1.5; /bin/cp "' + good + '" "' + path.join(site.root, 'setup') + '" ) &\n' });
  assert.equal(b.status, 0, 'a mismatch that clears within the budget installs: ' + b.stderr);
  assert.match(b.stdout, new RegExp('PIN_SETUP_SHA=' + site.setupSha + '\n'));
});

test('#6576: a tampered installer, a tampered manifest, or no signature ends the install before anything runs', { skip: SKIP }, () => {
  const h = buildHelper();
  const ran = path.join(h.dir, 'RAN-' + process.pid);
  const evil = '#!/bin/sh\ntouch "' + ran + '"\n';
  const a = runRootStep(h, siteWith(h, {}), { setupOverride: evil });
  assert.equal(a.status, 97, 'a tampered installer: ' + a.stderr);
  assert.match(a.stderr, /does not match its signed release, so it was NOT run/);
  const b = runRootStep(h, siteWith(h, { manifestTamper: true }));
  assert.equal(b.status, 97, 'a tampered manifest: ' + b.stderr);
  assert.match(b.stderr, /not signed by the Kosmos release key/);
  const c = runRootStep(h, siteWith(h, { noSig: true }));
  assert.equal(c.status, 96, 'no signature is a failed download (retried, then refused): ' + c.stderr);
  for (const r of [a, b, c]) assert.doesNotMatch(r.stdout, /PIN_SETUP_SHA=/, 'nothing is handed over after a refusal');
  assert.equal(fs.existsSync(ran), false, 'the tampered installer must never run');
});

test('#6576: on a Mac that already has Kosmos, the checked installer runs and the older hand-off is never reached', () => {
  const m = POSTINSTALL.match(/\/bin\/sh -c \\\n\s*'(?<inner>[\s\S]*?)' "\$SETUP_URL"/);
  assert.ok(m, 'could not lift the inner script; postinstall moved, re-anchor this test');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pkgpin-installed-6576-'));
  // An installed copy the #6474 hand-off would use: a verifier that knows run-setup, a node that runs, a version.
  const h = path.join(d, '.local/share/kosmos');
  fs.mkdirSync(path.join(h, 'app/engine'), { recursive: true });
  fs.mkdirSync(path.join(h, 'runtime/bin'), { recursive: true });
  fs.writeFileSync(path.join(h, 'app/engine/manifest-verify.js'), '// run-setup\nrequire("fs").writeFileSync(process.argv[1] + ".HANDOFF", "1");\n');
  fs.writeFileSync(path.join(h, 'app/package.json'), JSON.stringify({ version: '0.7.59' }));
  fs.symlinkSync(process.execPath, path.join(h, 'runtime/bin/node'));
  const checked = path.join(d, 'checked-setup');
  fs.writeFileSync(checked, '#!/bin/sh\necho RAN-CHECKED\n');
  const r = spawnSync('/bin/sh', ['-c', m.groups.inner, 'file://' + path.join(d, 'no-such-setup'), '0', checked, 'b'.repeat(64), 'c'.repeat(64), '0.7.60'],
    { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { HOME: d }) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'RAN-CHECKED\n');
  assert.equal(fs.existsSync(path.join(h, 'app/engine/manifest-verify.js.HANDOFF')), false, 'the hand-off ran on the pinned path');
  // CONTROL: without a checked installer the same Mac does reach the hand-off (the test can see it run).
  fs.writeFileSync(checked + '.sha256', crypto.createHash('sha256').update(fs.readFileSync(checked)).digest('hex') + '\n');
  fs.mkdirSync(path.join(d, 'dist'));
  fs.writeFileSync(path.join(d, 'dist', 'latest.json'), JSON.stringify({ version: '0.7.59' }));
  const ctl = spawnSync('/bin/sh', ['-c', m.groups.inner, 'file://' + checked, '0', '', '', '', ''],
    { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { HOME: d, KOSMOS_PKG_RETRY_MAX: '1', KOSMOS_PKG_RETRY_SLEEP: '0' }) });
  assert.equal(fs.existsSync(path.join(h, 'app/engine/manifest-verify.js.HANDOFF')), true, 'control: the hand-off did not run without a checked installer: ' + ctl.stderr);
  fs.rmSync(d, { recursive: true, force: true });
});

test('#6576: a release check that cannot run (a crash, a bad argument) ends the install and says so, not that the release is bad', { skip: SKIP }, () => {
  const h = buildHelper();
  for (const code of [2, 134]) {
    const r = runRootStep(h, siteWith(h, {}), { helperScript: '#!/bin/sh\nexit ' + code + '\n' });
    assert.equal(r.status, 1, code + ': ' + r.stderr);
    assert.match(r.stderr, new RegExp('could not run its release check \\(status ' + code + '\\)'));
    assert.doesNotMatch(r.stderr, /did not check out against the signed/);
    assert.doesNotMatch(r.stdout, /PIN_SETUP_SHA=[0-9a-f]/);
  }
});

test('#6576: switched off (floor "off"), the root step says so, pins nothing and downloads nothing', { skip: SKIP }, () => {
  const h = buildHelper();
  const site = siteWith(h, {});
  fs.rmSync(path.join(site.root, 'dist'), { recursive: true, force: true });   // nothing to fetch: an off step must not try
  const r = runRootStep(h, site, { floor: 'off' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /the signed-release check is not switched on in this installer yet/);
  assert.match(r.stdout, /PIN_SETUP_SHA=\nPIN_TARBALL=\nPIN_TMUX=\n/);
});

test('#6576: the shipped floor is "off" or a signed release (0.7.57, the first with a manifest signature, or later)', () => {
  const floor = fs.readFileSync(path.join(REPO, 'install', 'pkg-verify', 'floor'), 'utf8').trim();
  if (floor === 'off') return;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(floor);
  assert.ok(m, 'the floor is neither off nor a version: ' + floor);
  const n = m.slice(1).map(Number);
  assert.ok(n[0] > 0 || n[1] > 7 || (n[1] === 7 && n[2] >= 57), 'a floor below 0.7.57 accepts releases that carry no signature: ' + floor);
});

// ---- 3b. the person's shell, lifted verbatim (the same anchor as tools/test-pkg-checksum-1670.sh) ----
test('#6576: handed a checked installer, the person\'s shell runs THAT file with the pins exported and downloads nothing', () => {
  const m = POSTINSTALL.match(/\/bin\/sh -c \\\n\s*'(?<inner>[\s\S]*?)' "\$SETUP_URL"/);
  assert.ok(m, 'could not lift the inner script; postinstall moved, re-anchor this test');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pkgpin-inner-6576-'));
  const checked = path.join(d, 'checked-setup');
  fs.writeFileSync(checked, '#!/bin/sh\nprintf "RAN tarball=%s tmux=%s version=%s via=%s\\n" "$KOSMOS_PINNED_TARBALL_SHA256" "$KOSMOS_PINNED_TMUX_SHA256" "$KOSMOS_PINNED_VERSION" "$KOSMOS_INSTALL_VIA"\nexit 7\n');
  // An unreachable address: the checked branch must not fetch the installer again.
  const url = 'file://' + path.join(d, 'no-such-setup');
  const r = spawnSync('/bin/sh', ['-c', m.groups.inner, url, '0', checked, 'b'.repeat(64), 'c'.repeat(64), '0.7.60'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 7, 'the checked installer ran and its status is the shell\'s: ' + r.stderr);
  assert.equal(r.stdout, `RAN tarball=${'b'.repeat(64)} tmux=${'c'.repeat(64)} version=0.7.60 via=pkg\n`);
  // CONTROL: with no checked installer the shell keeps its own download path (and fails on the unreachable address).
  const ctl = spawnSync('/bin/sh', ['-c', m.groups.inner, url, '0', '', '', ''], { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { KOSMOS_PKG_RETRY_MAX: '1', KOSMOS_PKG_RETRY_SLEEP: '0' }) });
  assert.notEqual(ctl.status, 7);
  assert.match(ctl.stderr, /could not download the installer/);
  fs.rmSync(d, { recursive: true, force: true });
});

// ---- 4. setup.sh pinned_sha_ok, verbatim ----
test('#6576: setup.sh holds a pinned download to its pin: none passes, equal passes, different or malformed refuses', () => {
  const start = SETUP.indexOf('pinned_sha_ok() {');
  const end = SETUP.indexOf('\n}\n', start) + 3;
  assert.ok(start > 0, 'pinned_sha_ok is gone from setup.sh');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pinned-6576-'));
  const file = path.join(d, 'kosmos.tar.gz');
  fs.writeFileSync(file, 'the bytes');
  const sha = hex('the bytes');
  const run = (pin) => spawnSync('/bin/sh', ['-c', 'info() { echo "$*"; }\n' + SETUP.slice(start, end) + '\npinned_sha_ok "$1" "$2" Kosmos', 'x', file, pin], { encoding: 'utf8' });
  assert.equal(run('').status, 0, 'no pin: the install line and updates are unchanged');
  assert.equal(run(sha).status, 0);
  const bad = run('0'.repeat(64));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /does not match its signed release, so it was not installed/);
  assert.equal(run(sha.toUpperCase()).status, 1, 'a malformed pin refuses rather than reading as no pin');
  assert.equal(run(sha.slice(0, 63)).status, 1);
  fs.rmSync(d, { recursive: true, force: true });
});

test('#6576: setup.sh checks each pinned download right after its checksum, before anything unpacks it', () => {
  for (const [file, pin, what] of [['tmux.tar.gz', '_PIN_TMUX_SHA256', 'terminal manager'], ['kosmos.tar.gz', '_PIN_TARBALL_SHA256', 'Kosmos']]) {
    const dl = SETUP.indexOf(`verify_download "$stage/${file}" "$url" "$shaurl" || { rm -rf "$stage"; return 1; }\n`);
    assert.ok(dl > 0, `the ${file} download moved; re-anchor this test`);
    const next = SETUP.slice(SETUP.indexOf('\n', dl) + 1, SETUP.indexOf('\n', SETUP.indexOf('\n', dl) + 1));
    assert.equal(next.trim(), `pinned_sha_ok "$stage/${file}" "\${${pin}:-}" "${what}" || { rm -rf "$stage"; return 1; }   # #6576`,
      `the ${file} pin check must be the line right after its checksum`);
    const fnStart = SETUP.lastIndexOf('\n}\n', dl);
    const fnEnd = SETUP.indexOf('\n}\n', dl);
    const unpack = SETUP.slice(fnStart, fnEnd).search(/\btar\s+-?x/);
    const pinAt = SETUP.slice(fnStart, fnEnd).indexOf('pinned_sha_ok');
    assert.ok(unpack === -1 || pinAt < unpack, `the ${file} pin check must come before it is unpacked`);
  }
});

test('#6576: setup.sh takes the pins once and removes them from the environment (the board it starts must not inherit them)', () => {
  const start = SETUP.indexOf('case "${KOSMOS_PINNED_VERSION:-}" in');
  const end = SETUP.indexOf('unset KOSMOS_PINNED_TARBALL_SHA256 KOSMOS_PINNED_TMUX_SHA256 KOSMOS_PINNED_VERSION\n', start);
  assert.ok(start > 0 && end > start, 'the pin capture moved; re-anchor this test');
  const block = SETUP.slice(start, SETUP.indexOf('\n', end) + 1);
  const r = spawnSync('/bin/sh', ['-c', 'die() { echo "DIE $*"; exit 1; }\nTARGET_VERSION=x\n' + block + 'printf "%s %s %s\\n" "$TARGET_VERSION" "$_PIN_TARBALL_SHA256" "$_PIN_TMUX_SHA256"\nenv | grep -c "^KOSMOS_PINNED_" || true'],
    { encoding: 'utf8', env: Object.assign({}, process.env, { KOSMOS_PINNED_VERSION: '0.7.60', KOSMOS_PINNED_TARBALL_SHA256: 'b'.repeat(64), KOSMOS_PINNED_TMUX_SHA256: 'c'.repeat(64) }) });
  assert.equal(r.stdout, `0.7.60 ${'b'.repeat(64)} ${'c'.repeat(64)}\n0\n`, 'pins kept for this run, and none left in the environment: ' + r.stderr);
});

test('#6576: setup.sh installs the checked version, and refuses one that is not a.b.c', () => {
  const start = SETUP.indexOf('case "${KOSMOS_PINNED_VERSION:-}" in');
  const end = SETUP.indexOf('esac\n', start) + 5;
  assert.ok(start > 0, 'the pinned-version case is gone from setup.sh');
  const run = (v) => spawnSync('/bin/sh', ['-c', 'die() { echo "DIE $*"; exit 1; }\nTARGET_VERSION=from-pointer\n' + SETUP.slice(start, end) + '\necho "$TARGET_VERSION"'],
    { encoding: 'utf8', env: Object.assign({}, process.env, { KOSMOS_PINNED_VERSION: v }) });
  assert.equal(run('').stdout, 'from-pointer\n', 'no pin: the pointer decides, as before');
  assert.equal(run('0.7.60').stdout, '0.7.60\n');
  for (const bad of ['1.2', '0.7.', '.7.6', 'a.b.c', '0..7', '0.7.6;x', '0.7.60.1', '0.7.6 x']) {
    const r = run(bad);
    assert.equal(r.status, 1, bad);
    assert.match(r.stdout, /^DIE the version the installer checked is not a version/, bad);
  }
});

test.after(() => { if (built) fs.rmSync(built.dir, { recursive: true, force: true }); });
