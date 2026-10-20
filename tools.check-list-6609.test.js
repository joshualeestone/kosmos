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
const pair = () => { const k = crypto.generateKeyPairSync('ed25519'); return { priv: k.privateKey, pub: k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }; };
const CUT = pair();       // this cut's signing key
const OTHER = pair();
const RECOVERY = pair();

let tmp;
test.before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-checklist-6609-')); });
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function tree({ on = true } = {}) {
  const root = fs.mkdtempSync(path.join(tmp, 'tree-'));
  fs.mkdirSync(path.join(root, 'tools', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'engine'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'lib', 'manifest-sign.js'), SIGNER);
  let v = VERIFIER;
  if (on) {
    v = v.replace('const RECOVERY_KEYS = Object.freeze([]);', `const RECOVERY_KEYS = Object.freeze([${JSON.stringify(RECOVERY.pub)}]);`);
    assert.notEqual(v, VERIFIER, 'the RECOVERY_KEYS line moved; this fixture cannot turn the check on');
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
  const block = RELEASE_SH.slice(at, RELEASE_SH.indexOf('\n  fi\n', at));
  assert.match(block, /exit 1/, 'a refusal stops the cut');
});
