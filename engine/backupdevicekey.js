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
 * can stand for the other. (The connector's only other use of the seed is not a signature: pairing.rs hashes it, under
 * its own prefix, into a nonce.)
 *
 * The key alone, never paired with an identity here. The connector replaces `mac_key` and `mac_id` together on every
 * registration, but NOT atomically (setup.rs write_identity: two in-place writes, key first, under a file lock Node
 * cannot take; kosmos#5871 asks for an atomic write). No read order and no file-time test can tell a finished pair from
 * one caught between the two writes (reviews 3 and 4 of this slice each found an interleaving that defeated one), so
 * this returns no `macId` and makes no claim about which identity the key belongs to. That is harmless by contract:
 *   - Kosmos+ records an upload by org and account only (coordinator/src/backup.rs member_of; backup_manifests keeps no
 *     device), so a manifest is checked against EVERY device key that account has had, current and retired, never
 *     against an identity the manifest names (stated on #5535).
 *   - A key read mid-registration is the NEW identity's key, which Kosmos+ enrolls when the registration finishes; one
 *     whose registration never finishes signs nothing that uploads, since the connector itself then signs every grant
 *     request with a key Kosmos+ does not hold for its id.
 *   - So Kosmos+ must keep each account's RETIRED device public keys for restore and the content view: a manifest
 *     verifies only against the key that signed it (stated on #5535).
 * What is checked: `mac_id` must exist (as MacState::open and remote.holdsKey require), so a folder whose very first
 * registration was cut off after the key is `missing`; and an empty file (the truncation before an in-place write) is
 * refused with `retry`. KNOWN UNCLASSIFIED: a read between the truncation and a short write would see part of a key line
 * and refuse it as the wrong form, not retry. A 43-byte local write is one system call, and the next read clears it.
 *
 * The key file is the connector's: one line, the 32-byte seed in base64url without padding, read as the connector reads
 * it: trimmed of exactly Rust's whitespace (char::is_whitespace, the Unicode White_Space property). JS trim() differs
 * both ways (it strips a BOM, U+FEFF, which Rust keeps and then fails to decode; it keeps U+0085, which Rust strips), so
 * a file the connector cannot read is never read here as a key. Read on each call, never cached or written here.
 * Refused, never guessed: a link (opened without following one; where O_NOFOLLOW is 0, as on Windows, the name must
 * still not be a link and must still name the opened file), anything but a plain file, a file larger than a key line,
 * or any other spelling of 32 bytes. `because` is a fixed sentence: never the path, never a byte of a file.
 *
 * deviceKey({ stateDir? }) -> { ok: true, privateKey, publicKey } or { ok: false, because, missing?, retry? }.
 *   stateDir: an absolute path (default remote.stateDir(), which must also resolve to one).
 *   missing: no finished identity yet (ENOENT only; any other error reading mac_id is reported as itself).
 *   retry: a passing state: a file being rewritten (empty), EBUSY or EAGAIN, a file that vanished between the open and
 *   the lstat, and on Windows only EPERM or EACCES (a sharing violation or a scanner holding the file). On macOS and
 *   Linux EPERM and EACCES are a lasting misconfiguration and are NOT retry. A caller still caps its attempts.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// RFC 8410: the PKCS#8 wrapping of a raw Ed25519 seed is this fixed prefix and the 32 bytes.
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const MAX_FILE = 256;
const SEED_RE = /^[A-Za-z0-9_-]{43}$/;
const rustTrim = (t) => t.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
const codeOf = (err) => (err && /^[A-Z0-9_]{1,32}$/.test(String(err.code)) ? ` (${err.code})` : '');
// Passing states (see the header). EPERM and EACCES only on Windows, where they are sharing violations.
const TRANSIENT = new Set(['EBUSY', 'EAGAIN', 'ENOENT'].concat(process.platform === 'win32' ? ['EPERM', 'EACCES'] : []));
const NOT_FORM = 'the device key file does not hold a key in the form the connector writes';

function deviceKey(opts) {
  let dir = opts && typeof opts === 'object' ? opts.stateDir : undefined;
  if (dir === undefined) {
    try { dir = require('./remote').stateDir(); } catch { return { ok: false, because: 'the device key folder could not be found' }; }
  }
  // An empty, relative or non-string folder is a mistake (the caller's, or AGENT_WORKFORCE_TUNNEL_STATE's), never the
  // current directory.
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return { ok: false, because: 'the device key folder is not an absolute path' };
  // statSync, not existsSync: only ENOENT is "missing". A folder this process cannot read is NOT reported as never set
  // up, which would send the person to register again over a good identity.
  try { fs.statSync(path.join(dir, 'mac_id')); } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, missing: true, because: 'this computer has no device identity yet (remote access was never set up, or setting it up did not finish)' };
    return Object.assign({ ok: false, because: `the device identity file could not be read${codeOf(err)}` }, err && TRANSIENT.has(err.code) && err.code !== 'ENOENT' ? { retry: true } : {});
  }
  const file = path.join(dir, 'mac_key');
  let fd;
  // Every buffer that held key bytes is wiped in finally, on every path. (The trimmed text is a JS string and cannot be
  // wiped, nor can the KeyObject: both stay in memory until collected.)
  const wipe = [];
  try {
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: false, missing: true, because: 'this computer has no device key yet (remote access was never set up)' };
      if (err && err.code === 'ELOOP') return { ok: false, because: 'the device key file is a link, so it was not read' };
      return Object.assign({ ok: false, because: `the device key file could not be opened${codeOf(err)}` }, err && TRANSIENT.has(err.code) ? { retry: true } : {});
    }
    const st = fs.fstatSync(fd, { bigint: true });
    if (!st.isFile()) return { ok: false, because: 'the device key file is not a plain file' };
    // Where O_NOFOLLOW is 0 (Windows), the open followed a link: the name must still not be one, and must still name
    // the file that was opened (the same device and inode), so a swap between the open and this check is refused.
    const ls = fs.lstatSync(file, { bigint: true });
    if (ls.isSymbolicLink()) return { ok: false, because: 'the device key file is a link, so it was not read' };
    if (ls.dev !== st.dev || ls.ino !== st.ino) return { ok: false, retry: true, because: 'the device key file changed while it was read' };
    if (st.size > BigInt(MAX_FILE)) return { ok: false, because: 'the device key file is larger than a key' };
    const buf = Buffer.alloc(MAX_FILE + 1);
    wipe.push(buf);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    if (n === 0) return { ok: false, retry: true, because: 'the device key file is being rewritten' };
    if (n > MAX_FILE) return { ok: false, because: 'the device key file is larger than a key' };
    const text = rustTrim(buf.subarray(0, n).toString('utf8'));
    if (!SEED_RE.test(text)) return { ok: false, because: NOT_FORM };
    const seed = Buffer.from(text, 'base64url');
    wipe.push(seed);
    // Canonical only: the bytes must spell back to the very text (a non-zero trailing bit decodes to the same seed).
    if (seed.length !== 32 || seed.toString('base64url') !== text) return { ok: false, because: NOT_FORM };
    const der = Buffer.concat([PKCS8_ED25519, seed]);
    wipe.push(der);
    const privateKey = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    return { ok: true, privateKey, publicKey: crypto.createPublicKey(privateKey) };
  } catch (err) {
    return Object.assign({ ok: false, because: `the device key could not be read${codeOf(err)}` }, err && TRANSIENT.has(err.code) ? { retry: true } : {});
  } finally {
    for (const b of wipe) b.fill(0);
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already closed */ } }
  }
}

module.exports = { deviceKey };
