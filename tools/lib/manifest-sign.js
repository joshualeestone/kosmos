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

function verifyOnly(manifest, sigPath) {
  const bytes = fs.readFileSync(manifest);
  let sig;
  try { sig = Buffer.from(fs.readFileSync(sigPath, 'utf8').trim(), 'base64'); } catch { return false; }
  return sig.length === 64 && KEYS.some((k) => {
    try { return crypto.verify(null, bytes, crypto.createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' }), sig); } catch { return false; }
  });
}

function main(argv) {
  const [verb, keyPath, manifest, out] = argv;
  if (verb === 'verify') {
    if (verifyOnly(keyPath, manifest)) { console.log('the manifest signature verifies under a pinned key'); return 0; }
    console.error('the manifest signature is missing or does not verify under a pinned key'); return 1;
  }
  if (verb === 'needs-sig') {
    const m = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    return Array.isArray(m.files) && m.files.some((f) => f.path === 'app/engine/manifest-verify.js') ? 0 : 1;
  }
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
