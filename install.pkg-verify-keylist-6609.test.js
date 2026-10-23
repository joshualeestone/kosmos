'use strict';
require('./test-support/tmpscope');
/**
 * kosmos#6609 phase 2: the .pkg's release check (install/pkg-verify/main.swift, #6576) takes the release key list.
 *   1. its recovery keys, list floor, seq cap and list type are engine/manifest-verify.js's (one rule, two copies);
 *   2. compiled ON (a throwaway recovery key built in, minKeyListSeq 3): the release keys come from a list that key
 *      signed, never from the built-in ones; every list the JS verifyKeyList refuses, the helper refuses too, and a
 *      list below the floor, a missing list or one signed by anything else refuses (97);
 *   3. compiled OFF (as shipped): the list is not read, whatever is passed;
 *   4. the postinstall's root step, lifted verbatim, fetches the list from beside the manifest and hands it over: ON,
 *      a served list installs and a missing one refuses; OFF, a missing list changes nothing.
 * Parts 2 to 4 need macOS and swiftc, and are skipped (said so) without them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const mv = require('./engine/manifest-verify.js');

const REPO = __dirname;
const SWIFT = fs.readFileSync(path.join(REPO, 'install', 'pkg-verify', 'main.swift'), 'utf8');
const POSTINSTALL = fs.readFileSync(path.join(REPO, 'install', 'pkg-scripts', 'postinstall'), 'utf8');

const swiftConst = (name) => {
  const m = SWIFT.match(new RegExp('^let ' + name + '(?:: \\[String\\])? = (.+)$', 'm'));
  assert.ok(m, name + ' moved; re-anchor this test');
  return m[1];
};

test('#6609: the helper\'s recovery keys, list floor, seq cap and list type are engine/manifest-verify.js\'s', () => {
  const rec = swiftConst('recoveryKeys');
  assert.match(rec, /^\[.*\]$/, 'recoveryKeys is one line, so this comparison reads all of it');
  assert.deepEqual(JSON.parse(rec), [...mv.RECOVERY_KEYS], 'a recovery key in one copy and not the other: the .pkg and updates disagree');
  assert.equal(Number(swiftConst('minKeyListSeq')), mv.MIN_KEY_LIST_SEQ);
  assert.equal(Number(swiftConst('maxSeq')), mv.MAX_SEQ);
  assert.equal(JSON.parse(swiftConst('keyListType')), mv.KEY_LIST_TYPE);
});

const swiftc = spawnSync('/usr/bin/xcrun', ['--find', 'swiftc'], { encoding: 'utf8' });
const CAN_BUILD = process.platform === 'darwin' && swiftc.status === 0;
const SKIP = CAN_BUILD ? false : 'needs macOS and swiftc';

const spkiOf = (k) => k.export({ format: 'der', type: 'spki' }).toString('base64');
const pair = () => crypto.generateKeyPairSync('ed25519');
const builds = {};
/** The helper compiled with `builtIn` as its release key and, when `recovery` is given, that key as its recovery key. */
function build(name, { builtIn, recovery, minSeq }) {
  if (builds[name]) return builds[name];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkglist-6609-'));
  const releaseLine = SWIFT.match(/let releaseKeys = \[\n(\s+"[^"]+",\n)+\]/);
  assert.ok(releaseLine, 'the releaseKeys list moved; re-anchor this test');
  let src = SWIFT.replace(releaseLine[0], 'let releaseKeys = [\n    "' + spkiOf(builtIn.publicKey) + '",\n]');
  if (recovery) src = src.replace('let recoveryKeys: [String] = []', 'let recoveryKeys: [String] = ["' + spkiOf(recovery.publicKey) + '"]');
  if (minSeq) src = src.replace(/^let minKeyListSeq = \d+$/m, 'let minKeyListSeq = ' + minSeq);
  assert.equal(src.includes(spkiOf(builtIn.publicKey)), true);
  if (recovery) assert.equal(src.includes(spkiOf(recovery.publicKey)), true, 'the recovery key was not substituted');
  if (minSeq) assert.match(src, new RegExp('^let minKeyListSeq = ' + minSeq + '$', 'm'));
  fs.writeFileSync(path.join(dir, 'main.swift'), src);
  const floor = fs.readFileSync(path.join(REPO, 'tools', 'macos-floor'), 'utf8').trim();
  const r = spawnSync('/usr/bin/xcrun', ['swiftc', '-target', 'arm64-apple-macos' + floor, '-O', path.join(dir, 'main.swift'), '-o', path.join(dir, 'kosmos-pkg-verify')], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'the helper does not compile: ' + r.stderr);
  builds[name] = { dir, bin: path.join(dir, 'kosmos-pkg-verify') };
  return builds[name];
}
test.after(() => { for (const b of Object.values(builds)) fs.rmSync(b.dir, { recursive: true, force: true }); });

const BUILTIN = pair(); const RECOVERY = pair(); const LISTED = pair(); const STRANGER = pair();
const SHAS = { setup_sha256: 'a'.repeat(64), sha256: 'b'.repeat(64), tmux_sha256: 'c'.repeat(64) };
const manifestBy = (key, fields) => {
  const bytes = Buffer.from(JSON.stringify(Object.assign({ manifest: 1, version: '0.7.60', arch: 'arm64', files: {} }, SHAS, fields)));
  return { bytes, sig: crypto.sign(null, bytes, key.privateKey).toString('base64') };
};
const listText = (o) => JSON.stringify(Object.assign({ type: 'kosmos-release-keys', release_keys: [spkiOf(LISTED.publicKey)], seq: 3, issued: '2026-10-23' }, o));
const signList = (text, key) => { const bytes = Buffer.from(text); return { bytes, sig: crypto.sign(null, bytes, (key || RECOVERY).privateKey).toString('base64') }; };

function run(h, man, list) {
  const d = fs.mkdtempSync(path.join(h.dir, 'run-'));
  fs.writeFileSync(path.join(d, 'm.json'), man.bytes);
  fs.writeFileSync(path.join(d, 'm.sig'), man.sig);
  const args = [path.join(d, 'm.json'), path.join(d, 'm.sig'), '0.7.60', '0.7.57'];
  if (list !== undefined) {
    if (list) { fs.writeFileSync(path.join(d, 'l.json'), list.bytes); fs.writeFileSync(path.join(d, 'l.sig'), list.sig); }
    args.push(path.join(d, 'l.json'), path.join(d, 'l.sig'));
  }
  return spawnSync(h.bin, args, { encoding: 'utf8' });
}
const on = () => build('on', { builtIn: BUILTIN, recovery: RECOVERY, minSeq: 3 });
const off = () => build('off', { builtIn: BUILTIN });
// ON with the floor at 1, so a list is refused only by the list check itself, never by the floor.
const onAtOne = () => build('on1', { builtIn: BUILTIN, recovery: RECOVERY });

test('#6609: ON, a release signed by a key the signed list names installs; the built-in key no longer opens it', { skip: SKIP }, () => {
  const h = on();
  const good = run(h, manifestBy(LISTED), signList(listText()));
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /^setup_sha256=a{64}\nsha256=b{64}\ntmux_sha256=c{64}\n$/);
  // The control for the line above: the same manifest under the built-in key, which the list does not name.
  const builtIn = run(h, manifestBy(BUILTIN), signList(listText()));
  assert.equal(builtIn.status, 97, builtIn.stderr);
  assert.match(builtIn.stderr, /not signed by the Kosmos release key/);
  assert.equal(builtIn.stdout, '');
  // A list naming both keys opens either: the list decides, not the build.
  const both = signList(listText({ release_keys: [spkiOf(LISTED.publicKey), spkiOf(BUILTIN.publicKey)] }));
  assert.equal(run(h, manifestBy(BUILTIN), both).status, 0);
  // A whole-number seq written as 3.0 is the integer 3, as JSON.parse reads it.
  assert.equal(run(h, manifestBy(LISTED), signList(listText().replace('"seq":3', '"seq":3.0'))).status, 0);
});

test('#6609: ON, no list, an unreadable one, or one below the floor refuses (97) and prints no pins', { skip: SKIP }, () => {
  const h = on();
  const man = manifestBy(LISTED);
  for (const [label, list, why] of [
    ['no list arguments', undefined, /release key list could not be read/],
    ['list files missing', null, /release key list could not be read/],
    ['a list one below the floor', signList(listText({ seq: 2 })), /release key list offered \(2\) is older than this installer accepts/],
  ]) {
    const r = run(h, man, list);
    assert.equal(r.status, 97, label + ': ' + r.stderr);
    assert.match(r.stderr, why, label);
    assert.equal(r.stdout, '', label);
  }
  // Control for the floor: the list AT the floor is taken.
  assert.equal(run(h, man, signList(listText({ seq: 3 }))).status, 0);
});

test('#6609: ON, every list the JS verifyKeyList refuses, the helper refuses; every one it takes, the helper takes', { skip: SKIP }, () => {
  const h = onAtOne();
  const man = manifestBy(LISTED);
  const listed = spkiOf(LISTED.publicKey);
  const lenient = listed.slice(0, 58) + String.fromCharCode(listed.charCodeAt(58) ^ 1) + '=';   // same bytes or not a key
  const cases = [
    ['a good list', signList(listText())],
    ['signed by a release key, not the recovery key', signList(listText(), LISTED)],
    ['signed by a stranger', signList(listText(), STRANGER)],
    ['changed after signing', (() => { const l = signList(listText()); return { bytes: Buffer.from(listText({ seq: 4 })), sig: l.sig }; })()],
    ['a signature that is not 64 bytes', { bytes: Buffer.from(listText()), sig: 'AAAA' }],
    ['not JSON', signList('not json')],
    ['JSON but not an object', signList('[1,2,3]')],
    ['another type', signList(listText({ type: 'kosmos-release' }))],
    ['no type', signList(JSON.stringify({ release_keys: [listed], seq: 3 }))],
    ['no release keys', signList(listText({ release_keys: [] }))],
    ['release keys not a list', signList(listText({ release_keys: listed }))],
    ['a key twice', signList(listText({ release_keys: [listed, listed] }))],
    ['a key that is not one', signList(listText({ release_keys: [listed, 'MCowBQYDK2VwAyEA'] }))],
    ['a non-canonical spelling', signList(listText({ release_keys: [lenient] }))],
    ['a number for a key', signList(listText({ release_keys: [listed, 7] }))],
    ['the recovery key as a release key', signList(listText({ release_keys: [listed, spkiOf(RECOVERY.publicKey)] }))],
    ['seq true', signList(listText({ seq: true }))],
    ['seq as a string', signList(listText({ seq: '3' }))],
    ['seq 3.5', signList(listText({ seq: 3.5 }))],
    ['seq 0', signList(listText({ seq: 0 }))],
    ['seq -1', signList(listText({ seq: -1 }))],
    ['seq above the cap', signList(listText({ seq: mv.MAX_SEQ + 1 }))],
    ['no seq', signList(JSON.stringify({ type: 'kosmos-release-keys', release_keys: [listed] }))],
    ['seq 3.0', signList(listText().replace('"seq":3', '"seq":3.0'))],
    ['seq at the cap', signList(listText({ seq: mv.MAX_SEQ }))],
  ];
  let refused = 0;
  for (const [label, list] of cases) {
    const js = mv.verifyKeyList({ bytes: list.bytes, sig: list.sig, recoveryKeys: [spkiOf(RECOVERY.publicKey)] });
    const r = run(h, man, list);
    assert.equal(r.status, js.ok ? 0 : 97, label + ': JS says ' + (js.ok ? 'ok' : js.why) + ', helper: ' + r.status + ' ' + r.stderr);
    if (!js.ok) { refused += 1; assert.equal(r.stdout, '', label + ': a refusal prints no pins'); }
  }
  assert.equal(refused, cases.length - 3, 'the three good lists are the only ones taken');
});

test('#6609: OFF (as shipped), the list is not read: the built-in key decides, whatever is passed', { skip: SKIP }, () => {
  const h = off();
  const man = manifestBy(BUILTIN);
  assert.equal(run(h, man).status, 0, 'four arguments, as before');
  assert.equal(run(h, man, null).status, 0, 'list files missing');
  assert.equal(run(h, man, { bytes: Buffer.from('garbage'), sig: 'x' }).status, 0, 'a list that is garbage');
  // Control: off still refuses a manifest the built-in key did not sign, list or no list.
  const listedMan = manifestBy(LISTED);
  assert.equal(run(h, listedMan, signList(listText())).status, 97);
  // Five or six arguments is a wrong call, not a refusal.
  const d = fs.mkdtempSync(path.join(h.dir, 'args-'));
  fs.writeFileSync(path.join(d, 'm.json'), man.bytes); fs.writeFileSync(path.join(d, 'm.sig'), man.sig);
  const five = spawnSync(h.bin, [path.join(d, 'm.json'), path.join(d, 'm.sig'), '0.7.60', '0.7.57', path.join(d, 'l.json')], { encoding: 'utf8' });
  assert.equal(five.status, 2, five.stderr);
});

// ---- 4. the postinstall's root step, verbatim ----
function liftRootStep() {
  const start = POSTINSTALL.indexOf('# ---- kosmos#6576:');
  const end = POSTINSTALL.indexOf('# Run the current installer as that user', start);
  assert.ok(start > 0 && end > start, 'the root step moved; re-anchor this test');
  return POSTINSTALL.slice(start, end);
}
const hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
function site(h, signer, list) {
  const root = fs.mkdtempSync(path.join(h.dir, 'site-'));
  fs.mkdirSync(path.join(root, 'dist'));
  const setup = Buffer.from('#!/bin/sh\n# kosmos-pkg-pins: honored\necho installing\n');
  const man = manifestBy(signer, { setup_sha256: hex(setup) });
  fs.writeFileSync(path.join(root, 'setup'), setup);
  fs.writeFileSync(path.join(root, 'dist', 'latest.json'), JSON.stringify({ version: '0.7.60' }));
  fs.writeFileSync(path.join(root, 'dist', 'kosmos-0.7.60-arm64.manifest.json'), man.bytes);
  fs.writeFileSync(path.join(root, 'dist', 'kosmos-0.7.60-arm64.manifest.json.sig'), man.sig);
  if (list) {
    fs.writeFileSync(path.join(root, 'dist', 'release-keys.json'), list.bytes);
    if (list.sig !== null) fs.writeFileSync(path.join(root, 'dist', 'release-keys.json.sig'), list.sig);
  }
  return root;
}
function rootStep(h, root) {
  const scripts = fs.mkdtempSync(path.join(h.dir, 'scripts-'));
  fs.copyFileSync(h.bin, path.join(scripts, 'kosmos-pkg-verify'));
  fs.chmodSync(path.join(scripts, 'kosmos-pkg-verify'), 0o755);
  fs.writeFileSync(path.join(scripts, 'kosmos-pkg-floor'), '0.7.57\n');
  const home = fs.mkdtempSync(path.join(h.dir, 'home-'));
  const body = 'set -u\nUSER_HOME="$1"\nSETUP_URL="$2"\n' + liftRootStep() + '\nprintf "PIN_TARBALL=%s\\n" "$PIN_TARBALL"\n';
  const script = path.join(scripts, 'postinstall');
  fs.writeFileSync(script, body);
  return spawnSync('/bin/sh', [script, home, 'file://' + path.join(root, 'setup')], { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { KOSMOS_PKG_RETRY_SLEEP: '0' }) });
}

test('#6609: the root step fetches the list from beside the manifest; ON, a served list installs and a missing one refuses', { skip: SKIP }, () => {
  const h = on();
  const served = rootStep(h, site(h, LISTED, signList(listText())));
  assert.equal(served.status, 0, served.stderr);
  assert.match(served.stdout, new RegExp('PIN_TARBALL=' + 'b'.repeat(64) + '\n'));
  for (const [label, list] of [['no list on the site', undefined], ['the list without its signature', Object.assign(signList(listText()), { sig: null })]]) {
    const r = rootStep(h, site(h, LISTED, list));
    assert.equal(r.status, 97, label + ': ' + r.stderr);
    assert.match(r.stderr, /release key list could not be read/, label);
    assert.doesNotMatch(r.stdout, /PIN_TARBALL=[0-9a-f]/, label + ': nothing is pinned');
  }
});

test('#6609: the root step OFF (as shipped) installs exactly as before when the site serves no list', { skip: SKIP }, () => {
  const h = off();
  const r = rootStep(h, site(h, BUILTIN));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp('PIN_TARBALL=' + 'b'.repeat(64) + '\n'));
});
