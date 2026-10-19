'use strict';
/* #6468 ask 2: the release's half of the signed manifest. engine/manifest-verify.js is the installed copy's half.
 *
 *   node tools/lib/manifest-sign.js check <private-key.pem>
 *       exit 0 when the key loads and its public half is one engine/manifest-verify.js pins (release.sh step 1c,
 *       before anything is built: a key the shipped app does not pin would sign a release every install refuses).
 *   node tools/lib/manifest-sign.js sign <private-key.pem> <manifest.json> <out.sig>
 *       signs the manifest's exact bytes, writes the base64 signature, then checks it back against the pinned keys.
 *
 *   node tools/lib/manifest-sign.js verify <manifest.json> <sig>
 *       exit 0 when the signature verifies under a pinned key (no private key needed: promote and the served check).
 *   node tools/lib/manifest-sign.js check-served <private-key.pem> <served-manifest.json>...
 *       exit 0 when every served release that checks signatures pins this key (its signed manifest's pinned_keys).
 *       The checkout's KEYS say what the NEXT release accepts; what installs out there accept is what they shipped.
 *       LIMIT: only the CURRENTLY served releases are read. An install still on an older release checks with ITS keys,
 *       so a key may be retired only once no release that pins only it is still in use.
 *   node tools/lib/manifest-sign.js verify-under <manifest.json> <sig> <served-manifest.json>
 *       verify, under the keys the served release pins when it checks signatures, else the checkout's.
 *   node tools/lib/manifest-sign.js needs-sig <manifest.json>
 *       exit 0 when that release ships engine/manifest-verify.js, i.e. its installs refuse an update with no signature.
 *
 * The key is resolved by release.sh through secrets-map.sh (kosmos-manifest-signing) and never printed.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { KEYS } = require(path.join(__dirname, '..', '..', 'engine', 'manifest-verify.js'));

function load(keyPath) {
  const key = crypto.createPrivateKey(fs.readFileSync(keyPath));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('the manifest key is not ed25519');
  return key;
}
function pinned(key) {
  return KEYS.includes(crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64'));
}

const shipsVerifier = (m) => Array.isArray(m.files) && m.files.some((f) => f && f.path === 'app/engine/manifest-verify.js');
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function verifyOnly(manifest, sigPath, keys = KEYS) {
  const bytes = fs.readFileSync(manifest);
  let sig;
  try { sig = Buffer.from(fs.readFileSync(sigPath, 'utf8').trim(), 'base64'); } catch { return false; }
  return sig.length === 64 && keys.some((k) => {
    try { return crypto.verify(null, bytes, crypto.createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' }), sig); } catch { return false; }
  });
}

function main(argv) {
  const [verb, keyPath, manifest, out] = argv;
  if (verb === 'verify') {
    if (verifyOnly(keyPath, manifest)) { console.log('the manifest signature verifies under a pinned key'); return 0; }
    console.error('the manifest signature is missing or does not verify under a pinned key'); return 1;
  }
  if (verb === 'verify-under') {
    const [mf, sg, sv] = [keyPath, manifest, out];
    const s = readJson(sv);
    if (!s) { console.error('could not read the served manifest ' + sv); return 2; }
    const keys = shipsVerifier(s) ? (Array.isArray(s.pinned_keys) ? s.pinned_keys : null) : KEYS;
    if (!keys) { console.error('the served release checks signatures but its manifest names no pinned keys'); return 2; }
    if (verifyOnly(mf, sg, keys)) { console.log('the manifest signature verifies under the keys the served release accepts'); return 0; }
    console.error('the manifest signature does not verify under the keys the served release accepts'); return 1;
  }
  if (verb === 'check-served') {
    const key = load(keyPath);
    const pub = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64');
    for (const sv of argv.slice(2)) {
      const s = readJson(sv);
      if (!s) { console.error('could not read the served manifest ' + sv); return 2; }
      if (!shipsVerifier(s)) continue;
      if (!Array.isArray(s.pinned_keys)) { console.error(sv + ' checks signatures but names no pinned keys'); return 2; }
      if (!s.pinned_keys.includes(pub)) { console.error('the signing key is not one the served release ' + (s.version || '?') + ' accepts, so its installs would refuse this update'); return 1; }
    }
    console.log('every served release that checks signatures accepts this key'); return 0;
  }
  if (verb === 'needs-sig') {
    // 0 yes, 1 no, 2 cannot tell (unreadable): promote refuses on 2 rather than read it as "no".
    let m;
    try { m = JSON.parse(fs.readFileSync(keyPath, 'utf8')); } catch { console.error('could not read ' + keyPath); return 2; }
    if (!Array.isArray(m.files)) { console.error(keyPath + ' lists no files'); return 2; }
    return m.files.some((f) => f && f.path === 'app/engine/manifest-verify.js') ? 0 : 1;
  }
  if (!['check', 'sign'].includes(verb)) { console.error('usage: manifest-sign.js check|sign|verify|needs-sig ...'); return 2; }
  const key = load(keyPath);
  if (!pinned(key)) {
    console.error('the manifest-signing key is not one engine/manifest-verify.js pins, so installs would refuse this release');
    return 1;
  }
  if (verb === 'check') { console.log('manifest-signing key loads and is pinned'); return 0; }
  if (verb !== 'sign' || !manifest || !out) { console.error('usage: manifest-sign.js check|sign <key> [<manifest> <out.sig>]'); return 2; }
  const bytes = fs.readFileSync(manifest);
  const sig = crypto.sign(null, bytes, key);
  const pub = crypto.createPublicKey(key);
  if (!crypto.verify(null, bytes, pub, sig)) { console.error('the manifest signature does not verify'); return 1; }
  fs.writeFileSync(out, sig.toString('base64') + '\n');
  console.log(`signed ${path.basename(manifest)} -> ${path.basename(out)}`);
  return 0;
}

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error('manifest signing failed: ' + e.message); process.exit(1); }
}
module.exports = { main };
