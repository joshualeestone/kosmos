'use strict';
/* #6609: sign a release KEY LIST with the recovery key (engine/manifest-verify.js RECOVERY_KEYS).
 *
 *   pbpaste | node tools/lib/release-keys-sign.js <seq> <out-dir> <release-key> [<release-key> ...]
 *   pbcopy < /dev/null      (then clear the clipboard: the private key was on it; a clipboard-history app or
 *                             Universal Clipboard can keep a copy, so turn those off first or read the key from a file)
 *
 * The recovery private key (PKCS#8 PEM) arrives on stdin only, from the password manager it lives in, and is never
 * written anywhere. Each <release-key> is a release public key as SubjectPublicKeyInfo base64 (the form KEYS uses).
 * Writes <out-dir>/release-keys.json and <out-dir>/release-keys.json.sig, checks them with the same verifyKeyList the
 * installed copies run, and prints the recovery key's public half so the person can see which key signed.
 * While RECOVERY_KEYS is still empty (before activation) any Ed25519 key would sign: compare the printed public half
 * with the one being built in before publishing the first list.
 * Exit 0 written and checked; 1 refused or not written (a bad seq, a key that is not one, a duplicate, no key, a
 * folder that already holds a list as new, a write that failed, a list that did not check out); 2 the private key on
 * stdin is not usable here (not an Ed25519 key, passphrase-protected, a release key, or not the built-in recovery key). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ed25519Key, verifyKeyList, RECOVERY_KEYS, KEY_LIST_TYPE, KEYS, MIN_KEY_LIST_SEQ } = require('../../engine/manifest-verify');

function main(argv, stdin) {
  const [seqArg, outDir, ...keys] = argv;
  const seq = Number(seqArg);
  if (!/^[1-9]\d*$/.test(String(seqArg || '')) || !Number.isInteger(seq) || seq < 1 || seq > 2147483647) { console.error('the sequence number must be a whole number from 1 to 2147483647'); return 1; }
  let isDir = false;
  try { isDir = fs.statSync(outDir).isDirectory(); } catch { isDir = false; }
  if (!outDir || !isDir) { console.error('the folder to write to does not exist'); return 1; }
  if (!keys.length) { console.error('name at least one release key'); return 1; }
  if (seq < MIN_KEY_LIST_SEQ) { console.error(`this build refuses lists below ${MIN_KEY_LIST_SEQ}; a new list needs a higher number`); return 1; }
  // A list already in the folder with this seq or a higher one is not replaced: publishing it would roll copies back.
  // One that is there but unreadable is not replaced either: its number cannot be compared.
  let prevRaw = null;
  try { prevRaw = fs.readFileSync(path.join(outDir, 'release-keys.json'), 'utf8'); } catch { /* no list there yet */ }
  if (prevRaw !== null) {
    let prev;
    try { prev = JSON.parse(prevRaw); } catch { console.error('the folder holds a release-keys.json that cannot be read; move it aside first'); return 1; }
    if (!prev || typeof prev !== 'object' || !Number.isInteger(prev.seq) || prev.seq >= seq) { console.error(`the folder already holds list ${prev && typeof prev === 'object' && Number.isInteger(prev.seq) ? prev.seq : '(unreadable number)'}; a new list needs a higher number`); return 1; }
  }
  if (new Set(keys).size !== keys.length) { console.error('a release key is named twice'); return 1; }
  const bad = keys.find((k) => !ed25519Key(k));
  if (bad) { console.error('not an Ed25519 public key: ' + bad.slice(0, 16) + '...'); return 1; }
  let priv;
  try { priv = crypto.createPrivateKey(stdin); } catch {
    console.error(/ENCRYPTED/.test(stdin) ? 'the private key is passphrase-protected; export it without a passphrase into the pipe' : 'stdin does not hold a private key (copy the whole note, BEGIN and END lines included)');
    return 2;
  }
  if (priv.asymmetricKeyType !== 'ed25519') { console.error('the private key is not an Ed25519 key'); return 2; }
  const recoveryPub = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).toString('base64');
  // The recovery key is never also a release key, in this list or among the keys this build ships.
  if (keys.includes(recoveryPub) || KEYS.includes(recoveryPub)) { console.error('that private key is a release key; the recovery key must be a different key'); return 2; }
  // Once a recovery key is built in, a list signed by any other key would be refused by every copy: say so now.
  if (RECOVERY_KEYS.length && !RECOVERY_KEYS.includes(recoveryPub)) { console.error('that private key is not the Kosmos recovery key (its public half is ' + recoveryPub + ')'); return 2; }
  const bytes = Buffer.from(JSON.stringify({ type: KEY_LIST_TYPE, release_keys: keys, seq, issued: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
  const sig = crypto.sign(null, bytes, priv).toString('base64');
  const check = verifyKeyList({ bytes, sig, recoveryKeys: [recoveryPub] });
  if (!check.ok) { console.error('the signed list did not check out: ' + check.why); return 1; }
  // Both files to temporary names first, then into place one after the other: a failed temporary write leaves the
  // folder's previous pair as it was. A failure of the second rename would leave the new signature beside the old list
  // (a pair that does not verify, so nothing would take it); the error says so and the folder needs a look.
  const j = path.join(outDir, 'release-keys.json'), g = j + '.sig';
  try {
    fs.writeFileSync(j + '.tmp', bytes);
    fs.writeFileSync(g + '.tmp', sig + '\n');
    fs.renameSync(g + '.tmp', g);
    fs.renameSync(j + '.tmp', j);
  } catch (e) {
    for (const t of [j + '.tmp', g + '.tmp']) { try { fs.rmSync(t, { force: true }); } catch { /* best effort */ } }
    console.error('the list could not be written (' + (e && e.code || 'error') + ')');
    return 1;
  }
  console.log(`release key list ${seq} written to ${outDir}, ${keys.length} key(s), signed by recovery key ${recoveryPub}`);
  return 0;
}

module.exports = { main };
if (require.main === module) {
  const chunks = [];
  process.stdin.on('data', (d) => chunks.push(d)).on('end', () => process.exit(main(process.argv.slice(2), Buffer.concat(chunks).toString('utf8'))));
}
