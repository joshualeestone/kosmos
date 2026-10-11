'use strict';
/**
 * kosmos#5535 E0.6 slice (b): the device key a backup manifest is signed with.
 *
 * It is the connector's own Ed25519 `mac_key`, the key Kosmos+ knows this computer by, so the content view (#5686) and
 * restore (#5536) can check a manifest against the member's enrolled devices. Design on #5535 (comment 6114619425).
 *
 * Why the same key is safe for both: a manifest signature covers bytes that start with the fixed tag
 * `kosmos-backup v1 manifest-signature\0` (engine/backupformat.js), while a mac-request signs `{ts}\n{METHOD}\n...`
 * (kosmos-relay crates/tunnel/src/coordinator.rs signed_string), which starts with a digit. Neither can stand for the
 * other.
 *
 * The file is the connector's: one line, the 32-byte seed in base64url without padding, read as the connector reads it:
 * trimmed of exactly Rust's whitespace (char::is_whitespace, the Unicode White_Space property). JS trim() differs both
 * ways (it strips a BOM, U+FEFF, which Rust keeps and then fails to decode; it keeps U+0085, which Rust strips), so a
 * file the connector cannot read is never read here as a key nobody enrolled. It is read on each call (a renewed key is picked up) and never written, cached or logged here.
 * Refused, never guessed: a link in its place (it is read without following one), anything but a plain file, a file
 * larger than a key line could be, or any other spelling of 32 bytes. `because` is a fixed sentence: never the path,
 * never a byte of the file.
 *
 * deviceKey({ stateDir? }) -> { ok: true, privateKey, publicKey } (Ed25519 KeyObjects) or { ok: false, because, missing? }.
 * missing: there is no key yet (this computer was never set up for remote access), as opposed to a key that is unusable.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// RFC 8410: the PKCS#8 wrapping of a raw Ed25519 seed is this fixed prefix and the 32 bytes.
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const MAX_FILE = 256;
const SEED_RE = /^[A-Za-z0-9_-]{43}$/;
const rustTrim = (t) => t.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');

function deviceKey(opts = {}) {
  // A stateDir given must be an absolute path: an empty or relative one is a caller mistake, never the live default.
  if (opts.stateDir !== undefined && (typeof opts.stateDir !== 'string' || !path.isAbsolute(opts.stateDir))) {
    return { ok: false, because: 'the device key folder given is not an absolute path' };
  }
  const dir = opts.stateDir !== undefined ? opts.stateDir : require('./remote').stateDir();
  const file = path.join(dir, 'mac_key');
  let fd;
  // Every buffer that held key bytes is zeroed in finally, on every path. (The trimmed text is a JS string and cannot
  // be zeroed, nor can the KeyObject: both stay in memory until collected.)
  const wipe = [];
  try {
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: false, missing: true, because: 'this computer has no device key yet (remote access was never set up)' };
      if (err && err.code === 'ELOOP') return { ok: false, because: 'the device key file is a link, so it was not read' };
      return { ok: false, because: `the device key file could not be opened${err && /^[A-Z0-9_]{1,32}$/.test(String(err.code)) ? ` (${err.code})` : ''}` };
    }
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { ok: false, because: 'the device key file is not a plain file' };
    // Where O_NOFOLLOW is 0 (Windows), the open followed a link: the name must still not be one, and must still name
    // the file that was opened (the same device and inode), so a swap between the open and this check is refused.
    const ls = fs.lstatSync(file, { bigint: true });
    if (ls.isSymbolicLink()) return { ok: false, because: 'the device key file is a link, so it was not read' };
    const fst = fs.fstatSync(fd, { bigint: true });
    if (ls.dev !== fst.dev || ls.ino !== fst.ino) return { ok: false, because: 'the device key file changed while it was read' };
    if (st.size > MAX_FILE) return { ok: false, because: 'the device key file is larger than a key' };
    const buf = Buffer.alloc(MAX_FILE + 1);
    wipe.push(buf);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    if (n > MAX_FILE) return { ok: false, because: 'the device key file is larger than a key' };
    const text = rustTrim(buf.subarray(0, n).toString('utf8'));
    if (!SEED_RE.test(text)) return { ok: false, because: 'the device key file does not hold a key in the form the connector writes' };
    const seed = Buffer.from(text, 'base64url');
    wipe.push(seed);
    // Canonical only: the bytes must spell back to the very text (a non-zero trailing bit decodes to the same seed).
    if (seed.length !== 32 || seed.toString('base64url') !== text) return { ok: false, because: 'the device key file does not hold a key in the form the connector writes' };
    const der = Buffer.concat([PKCS8_ED25519, seed]);
    wipe.push(der);
    const privateKey = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    return { ok: true, privateKey, publicKey: crypto.createPublicKey(privateKey) };
  } catch (err) {
    return { ok: false, because: `the device key could not be read${err && /^[A-Z0-9_]{1,32}$/.test(String(err.code)) ? ` (${err.code})` : ''}` };
  } finally {
    for (const b of wipe) b.fill(0);
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already closed */ } }
  }
}

module.exports = { deviceKey };
