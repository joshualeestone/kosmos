'use strict';
/**
 * #6609 phase 2c: `tools/lib/manifest-sign.js check-list`, which release.sh step 1c runs before anything is built. With a
 * recovery key pinned in the checkout, the cut's signing key must be on the release key list the site serves, or every
 * install with the check on would refuse the release. Off as shipped: it passes without a list.
 *
 * The tool runs from a scratch tree holding a copy of manifest-sign.js and of engine/manifest-verify.js with
 * RECOVERY_KEYS rewritten to a throwaway key (the tool resolves the verifier relative to itself).
 *
 *   node --test tools.check-list-6609.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { KEY_LIST_TYPE } = require('./engine/manifest-verify.js');
const SIGNER = fs.readFileSync(path.join(__dirname, 'tools', 'lib', 'manifest-sign.js'), 'utf8');
const VERIFIER = fs.readFileSync(path.join(__dirname, 'engine', 'manifest-verify.js'), 'utf8');
const RELEASE_SH = fs.readFileSync(path.join(__dirname, 'tools', 'release.sh'), 'utf8');
const PROMOTE_SH = fs.readFileSync(path.join(__dirname, 'tools', 'promote-channel.sh'), 'utf8');
const pair = () => { const k = crypto.generateKeyPairSync('ed25519'); return { priv: k.privateKey, pub: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }; };
const CUT = pair();       // this cut's signing key
const OTHER = pair();
const RECOVERY = pair();

let tmp;
test.before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-checklist-6609-')); });
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function tree({ on = true, minSeq = 0 } = {}) {
  const root = fs.mkdtempSync(path.join(tmp, 'tree-'));
  fs.mkdirSync(path.join(root, 'tools', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'engine'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'lib', 'manifest-sign.js'), SIGNER);
  let v = VERIFIER;
  if (on) {
    v = v.replace('const RECOVERY_KEYS = Object.freeze([]);', `const RECOVERY_KEYS = Object.freeze([${JSON.stringify(RECOVERY.pub)}]);`);
    assert.notEqual(v, VERIFIER, 'the RECOVERY_KEYS line moved; this fixture cannot turn the check on');
  }
  if (minSeq) {
    const was = v;
    v = v.replace(/const MIN_KEY_LIST_SEQ = 1;/, `const MIN_KEY_LIST_SEQ = ${minSeq};`);
    assert.notEqual(v, was, 'the MIN_KEY_LIST_SEQ line moved; this fixture cannot raise the floor');
  }
  fs.writeFileSync(path.join(root, 'engine', 'manifest-verify.js'), v);
  const keyFile = path.join(root, 'cut.pem');
  fs.writeFileSync(keyFile, CUT.priv.export({ type: 'pkcs8', format: 'pem' }));
  return { root, keyFile };
}
function served(dir, { keys = [CUT.pub], by = RECOVERY, seq = 1 } = {}) {
  const lp = path.join(dir, 'release-keys.json');
  fs.writeFileSync(lp, JSON.stringify({ type: KEY_LIST_TYPE, seq, release_keys: keys }) + '\n');
  fs.writeFileSync(lp + '.sig', crypto.sign(null, fs.readFileSync(lp), by.priv).toString('base64') + '\n');
  return { list: lp, sig: lp + '.sig' };
}
function checkList(t, list, sig) {
  const r = spawnSync(process.execPath, [path.join(t.root, 'tools', 'lib', 'manifest-sign.js'), 'check-list', t.keyFile, list, sig], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('off (as shipped): passes with no list at all', () => {
  const t = tree({ on: false });
  const r = checkList(t, path.join(t.root, 'none.json'), path.join(t.root, 'none.json.sig'));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no recovery key is pinned/);
  assert.match(VERIFIER, /const RECOVERY_KEYS = Object\.freeze\(\[\]\);/, 'CONTROL: the shipped checkout is off');
});

test('on: a served list naming this signing key passes', () => {
  const t = tree();
  const s = served(t.root);
  const r = checkList(t, s.list, s.sig);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /list 1 names this signing key/);
});

test('on: a list that does not name the key, no list served, and a list from another signer stop the cut', () => {
  const t = tree();
  const without = served(fs.mkdtempSync(path.join(tmp, 'site-')), { keys: [OTHER.pub] });
  assert.match(checkList(t, without.list, without.sig).out, /does not name this signing key/);
  assert.equal(checkList(t, without.list, without.sig).code, 1);
  const none = checkList(t, path.join(t.root, 'absent.json'), path.join(t.root, 'absent.json.sig'));
  assert.equal(none.code, 1, none.out);
  assert.match(none.out, /the site serves no release key list/);
  const forged = served(fs.mkdtempSync(path.join(tmp, 'site-')), { by: OTHER });
  const f = checkList(t, forged.list, forged.sig);
  assert.equal(f.code, 1, f.out);
  assert.match(f.out, /not signed by the Kosmos recovery key/);
});

test('release.sh runs it in step 1c, on the site\'s origin/main, after the served-release check and before the build', () => {
  const at = RELEASE_SH.indexOf('manifest-sign.js" check-list "$KOSMOS_MANIFEST_KEY" "$_srv_dir/release-keys.json" "$_srv_dir/release-keys.json.sig"');
  assert.ok(at > 0, 'release.sh no longer runs check-list');
  assert.ok(at > RELEASE_SH.indexOf('manifest-sign.js" check-served'), 'after the served-release check');
  assert.ok(at < RELEASE_SH.indexOf('step "== 1d.'), 'before step 1d, so before anything is built');
  assert.match(RELEASE_SH, /git -C "\$SITE" show "origin\/main:dist\/release-keys\.json" > "\$_srv_dir\/release-keys\.json"/);
  assert.match(RELEASE_SH, /git -C "\$SITE" show "origin\/main:dist\/release-keys\.json\.sig" > "\$_srv_dir\/release-keys\.json\.sig"/);
  assert.ok(RELEASE_SH.includes('if ! node "$REPO/tools/lib/manifest-sign.js" check-list'), 'a refusal (not a pass) takes the exit branch');
  const fiAt = RELEASE_SH.indexOf('\n  fi\n', at);
  assert.ok(fiAt > at, 'the check-list block was reshaped; re-anchor this test');
  const block = RELEASE_SH.slice(at, fiAt);
  assert.match(block, /exit 1/, 'a refusal stops the cut');
});

test('on: a served list older than the floor this checkout requires (raised after a revocation) stops the cut', () => {
  const t = tree({ minSeq: 2 });
  const old = served(fs.mkdtempSync(path.join(tmp, 'site-')), { seq: 1 });
  const r = checkList(t, old.list, old.sig);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /older than the 2 this release requires/);
  const now = served(fs.mkdtempSync(path.join(tmp, 'site-')), { seq: 2 });
  assert.equal(checkList(t, now.list, now.sig).code, 0, 'CONTROL: a list at the floor passes');
});

function signedManifest(dir, by) {
  const mp = path.join(dir, 'kosmos-1.2.3-arm64.manifest.json');
  fs.writeFileSync(mp, JSON.stringify({ manifest: 1, version: '1.2.3' }) + '\n');
  fs.writeFileSync(mp + '.sig', crypto.sign(null, fs.readFileSync(mp), by.priv).toString('base64') + '\n');
  return mp;
}
function verifyUnderList(t, mp, s) {
  const r = spawnSync(process.execPath, [path.join(t.root, 'tools', 'lib', 'manifest-sign.js'), 'verify-under-list', mp, mp + '.sig', s.list, s.sig], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('promote (verify-under-list): a manifest signed by a key the served list names passes; one the list dropped, or no list, refuses; off passes', () => {
  const t = tree();
  const site = fs.mkdtempSync(path.join(tmp, 'site-'));
  const s = served(site, { keys: [CUT.pub] });
  assert.equal(verifyUnderList(t, signedManifest(site, CUT), s).code, 0);
  const dropped = verifyUnderList(t, signedManifest(fs.mkdtempSync(path.join(tmp, 'm-')), OTHER), s);
  assert.equal(dropped.code, 1, dropped.out);
  assert.match(dropped.out, /not signed by a key the served release key list 1 names/);
  const none = verifyUnderList(t, signedManifest(site, CUT), { list: path.join(site, 'absent.json'), sig: path.join(site, 'absent.json.sig') });
  assert.equal(none.code, 1, none.out);
  const off = verifyUnderList(tree({ on: false }), signedManifest(site, OTHER), { list: path.join(site, 'absent.json'), sig: path.join(site, 'absent.json.sig') });
  assert.equal(off.code, 0, 'off: nothing to check against: ' + off.out);
});

test('promote-channel.sh runs it on a signed manifest, after the prod-keys check, and refuses on failure', () => {
  const at = PROMOTE_SH.indexOf('"$_sign_js" verify-under-list "$SITE/dist/$MANIFEST" "$SITE/dist/$MANIFEST.sig" "$SITE/dist/release-keys.json" "$SITE/dist/release-keys.json.sig"');
  assert.ok(at > 0, 'promote-channel.sh no longer runs verify-under-list');
  assert.ok(at > PROMOTE_SH.indexOf('verify-under "$SITE/dist/$MANIFEST"'), 'after the prod-keys check');
  const sigBranch = PROMOTE_SH.indexOf('if [ -f "$SITE/dist/$MANIFEST.sig" ]; then');
  const elseAt = PROMOTE_SH.indexOf('\n  else\n', sigBranch);
  assert.ok(sigBranch > 0 && elseAt > sigBranch && at > sigBranch && at < elseAt, 'inside the signed-manifest branch');
  assert.match(PROMOTE_SH.slice(at, PROMOTE_SH.indexOf('\n', PROMOTE_SH.indexOf('\n', at) + 1)), /\|\| \{ echo [^\n]*exit 1; \}/);
});
