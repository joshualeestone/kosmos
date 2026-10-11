'use strict';
/**
 * kosmos#5535 E0.6 slice (b): the device key a backup manifest is signed with.
 *
 * It is the connector's own Ed25519 `mac_key`, the key Kosmos+ knows this computer by, so the content view (#5686) and
 * restore (#5536) can check a manifest against the member's enrolled devices. Design on #5535 (comment 6114619425).
 *
 * Why the same key is safe for both: a manifest signature covers bytes that start with the fixed tag
 * `kosmos-backup v1 manifest-signature\0` (engine/backupformat.js), while a mac-request signs `{ts}\n{METHOD}\n...`
 * (kosmos-relay crates/tunnel/src/coordinator.rs signed_string, and assistant.rs), which starts with a digit. Neither
 * can stand for the other.
 *
 * The key belongs to a device IDENTITY, `mac_id`, and both are replaced together on every registration (setting remote
 * access up again, or signing in afresh: kosmos-relay setup.rs write_identity; certificate renewal never touches them).
 * write_identity is NOT atomic: it rewrites mac_key, then mac_id, each in place (std::fs::write truncates and writes),
 * under a file lock Node cannot take. So:
 *   - The identity is read before and after the key, and a change between the two refuses: the key read may be the
 *     retired one.
 *   - A key file written in the last IN_PROGRESS_MS and NEWER than the identity file (by modification time) is a
 *     registration caught between its two writes: the new key beside the old id, which the two reads alone cannot see.
 *     Refused with `retry`. Only a RECENT key: an older pair in that order is not a live registration (a copy that
 *     reordered the times, or one cut off long ago, whose key the connector itself then signs with under the wrong id,
 *     so Kosmos+ refuses its grants and no backup uploads), and refusing it would stop backups for good. Measured on
 *     two folders the connector wrote on this Mac: the key 76 and 100 microseconds older than the id. The connector
 *     writing its identity atomically is the real fix (card filed).
 *   - An empty file is one being rewritten (the truncation before the write): refused with `retry`.
 *   - No `mac_id` is `missing`, as the connector (MacState::open) and remote.holdsKey treat it: write_identity writes
 *     mac_key first, so a registration cut off between the two leaves a key that was never finished.
 *   - The result names `macId`, so a snapshot can record which identity signed. It is a HINT for finding the key, not a
 *     proof: a consumer verifies against the identity the coordinator recorded for the upload and, failing that, the
 *     member's other device keys, never against the manifest's own word alone. A manifest signed under an identity
 *     that is later replaced verifies only against that identity's public key, so restore and the content view must keep
 *     retired device keys for checking old manifests (stated on #5535).
 *
 * The key file is the connector's: one line, the 32-byte seed in base64url without padding, read as the connector reads
 * it: trimmed of exactly Rust's whitespace (char::is_whitespace, the Unicode White_Space property). JS trim() differs
 * both ways (it strips a BOM, U+FEFF, which Rust keeps and then fails to decode; it keeps U+0085, which Rust strips), so
 * a file the connector cannot read is never read here as a key. Read on each call, never cached or written here.
 * Refused, never guessed: a link in place of either file (opened without following one, and the name must still name
 * the opened file), anything but a plain file, a file larger than its line could be, or any other spelling of 32 bytes.
 * `because` is a fixed sentence: never the path, never a byte of a file.
 *
 * deviceKey({ stateDir? }) -> { ok: true, privateKey, publicKey, macId } or { ok: false, because, missing?, retry? }.
 *   retry: a registration was caught mid-write; the next run is expected to read it.
 *   stateDir: an absolute path (default remote.stateDir()). missing: no identity yet (never set up, or cut off).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// RFC 8410: the PKCS#8 wrapping of a raw Ed25519 seed is this fixed prefix and the 32 bytes.
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const MAX_FILE = 256;
// How long after a key write the pair counts as a registration still in progress (write_identity is two small writes).
const IN_PROGRESS_MS = 10 * 60 * 1000;
const SEED_RE = /^[A-Za-z0-9_-]{43}$/;
// The coordinator's mac ids are plain tokens; anything else is not this connector's file.
const MAC_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const rustTrim = (t) => t.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
const codeOf = (err) => (err && /^[A-Z0-9_]{1,32}$/.test(String(err.code)) ? ` (${err.code})` : '');

/* Read one small state file without following a link: { text } or { refused: because, missing? }. Every buffer is
   pushed to `wipe` for the caller to clear. `what` names the file in the sentence. */
function readSmall(file, what, wipe) {
  let fd;
  try {
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    } catch (err) {
      if (err && err.code === 'ENOENT') return { refused: 'this computer has no device identity yet (remote access was never set up, or setting it up did not finish)', missing: true };
      if (err && err.code === 'ELOOP') return { refused: `the ${what} file is a link, so it was not read` };
      return { refused: `the ${what} file could not be opened${codeOf(err)}` };
    }
    const st = fs.fstatSync(fd, { bigint: true });
    if (!st.isFile()) return { refused: `the ${what} file is not a plain file` };
    // Where O_NOFOLLOW is 0 (Windows), the open followed a link: the name must still not be one, and must still name
    // the file that was opened (the same device and inode), so a swap between the open and this check is refused.
    const ls = fs.lstatSync(file, { bigint: true });
    if (ls.isSymbolicLink()) return { refused: `the ${what} file is a link, so it was not read` };
    if (ls.dev !== st.dev || ls.ino !== st.ino) return { refused: `the ${what} file changed while it was read` };
    if (st.size > BigInt(MAX_FILE)) return { refused: `the ${what} file is larger than it can be` };
    const buf = Buffer.alloc(MAX_FILE + 1);
    wipe.push(buf);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    if (n > MAX_FILE) return { refused: `the ${what} file is larger than it can be` };
    if (n === 0) return { refused: `the ${what} file is being rewritten`, retry: true };
    return { text: rustTrim(buf.subarray(0, n).toString('utf8')), mtimeNs: st.mtimeNs };
  } catch (err) {
    return { refused: `the ${what} file could not be read${codeOf(err)}` };
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already closed */ } }
  }
}

function readMacId(dir, wipe) {
  const r = readSmall(path.join(dir, 'mac_id'), 'device identity', wipe);
  if (r.refused) return r;
  if (!MAC_ID_RE.test(r.text)) return { refused: 'the device identity file does not hold an identity in the form the connector writes' };
  return { macId: r.text, mtimeNs: r.mtimeNs };
}

function deviceKey(opts = {}) {
  // A stateDir given must be an absolute path: an empty or relative one is a caller mistake, never the live default.
  if (opts.stateDir !== undefined && (typeof opts.stateDir !== 'string' || !path.isAbsolute(opts.stateDir))) {
    return { ok: false, because: 'the device key folder given is not an absolute path' };
  }
  const dir = opts.stateDir !== undefined ? opts.stateDir : require('./remote').stateDir();
  // Every buffer that held key bytes is wiped in finally, on every path. (The trimmed text is a JS string and cannot be
  // wiped, nor can the KeyObject: both stay in memory until collected.)
  const wipe = [];
  const no = (r) => Object.assign({ ok: false, because: r.refused }, r.missing ? { missing: true } : {}, r.retry ? { retry: true } : {});
  try {
    const before = readMacId(dir, wipe);
    if (before.refused) return no(before);
    const k = readSmall(path.join(dir, 'mac_key'), 'device key', wipe);
    if (k.refused) return no(k);
    const after = readMacId(dir, wipe);
    if (after.refused) return no(after);
    if (after.macId !== before.macId || after.mtimeNs !== before.mtimeNs) return { ok: false, retry: true, because: 'this computer was registered again while its device key was read; the next run reads the new one' };
    const keyAgeMs = Number((BigInt(Date.now()) * 1000000n - k.mtimeNs) / 1000000n);
    if (k.mtimeNs > after.mtimeNs && keyAgeMs < IN_PROGRESS_MS) return { ok: false, retry: true, because: 'this computer is being registered again (its new device key is written, its identity not yet); the next run reads it' };
    if (!SEED_RE.test(k.text)) return { ok: false, because: 'the device key file does not hold a key in the form the connector writes' };
    const seed = Buffer.from(k.text, 'base64url');
    wipe.push(seed);
    // Canonical only: the bytes must spell back to the very text (a non-zero trailing bit decodes to the same seed).
    if (seed.length !== 32 || seed.toString('base64url') !== k.text) return { ok: false, because: 'the device key file does not hold a key in the form the connector writes' };
    const der = Buffer.concat([PKCS8_ED25519, seed]);
    wipe.push(der);
    const privateKey = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    return { ok: true, privateKey, publicKey: crypto.createPublicKey(privateKey), macId: before.macId };
  } catch (err) {
    return { ok: false, because: `the device key could not be read${codeOf(err)}` };
  } finally {
    for (const b of wipe) b.fill(0);
  }
}

module.exports = { deviceKey };
