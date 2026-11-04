'use strict';

/**
 * kosmos#7116 slice 4, the Mac half: what this Mac's se-p256 admin key may sign for escrowd's roster, and the signing.
 *
 * escrowd's roster of company admins and its reviewer registry (kosmos-relay coordinator/src/roster.rs, plan
 * .claude/plans/reviewpage-5686.md) accept two admin key types. The console page signs with a passkey
 * (`webauthn-p256`); this file is the `se-p256` side, a key in this Mac's Secure Enclave held by native-se/main.swift
 * (`kosmos-se`). The plan's rule for every client ("What a client signs"): build the tagged bytes yourself, or fully
 * DECODE bytes you were given and check the tag is the action the person chose; show the decoded target; compute the
 * challenge yourself; never sign a hash, a challenge or an opaque blob from the coordinator. So:
 *   - prepare(action, bytes) decodes under THAT action's tag only (another action's bytes refuse, as do short,
 *     malformed or trailing bytes) and returns what a screen must show: `shown` (the decoded text, escaped, with
 *     `unusual`; never the raw `decoded` strings) and, for an admin add or a reviewer enrolment, the fingerprint
 *     computed here from the decoded bytes;
 *   - sign(prepared, opts) takes ONLY an object prepare() returned, and signs the copy of the bytes it holds, so what
 *     is signed is what the screen was shown. It hands that RAW message to kosmos-se (Apple's message mode, which
 *     is what verify_se checks). No digest ever crosses into the signer, and the signature is checked against the
 *     key before it is returned.
 * kosmos-se keeps its own tag list as a second fence; engine/seadmin-7116.test.js pins it to SIGNED below.
 *
 * The byte layouts are the page's (kosmos-relay console-bundle/roster-bytes.js), matched by the relay's pinned
 * vectors (test-support/escrowd-roster-vectors.json, copied from kosmos-relay e094b8bed console-bundle/vectors.json;
 * a Rust test and the page's test check the same file). Raw tag, then every field a u32 big-endian length and bytes.
 *
 * Not here yet, each named so nobody reads this file as the whole client:
 *   - devkeyhist-enrol and devkeyhist-revoke. Their layouts are agreed on #7116 (comment 6515728359 and Renet's reply),
 *     but escrowd has no encoder for them yet, so there is no pinned vector to build against. They join SIGNED, and
 *     kosmos-se's list, with that vector.
 *   - the local signed-item log and the 4 h no-fresh-head alarm, and checking a signed roster head against this
 *     Mac's own challenge (the plan's head-read rules).
 *   - shipping kosmos-se in the app bundle and any caller. Nothing outside the test calls this file yet.
 *   - choosing the helper. runHelper runs the path it is given; the bundle slice must resolve kosmos-se itself
 *     (the signed app's own copy), never take the path from anything a page or the coordinator supplies.
 * A key's access control is fixed when the key is made, so createKey makes a `presence` key (Touch ID or password on
 * every signature) unless told otherwise; see native-se/main.swift for what is and is not measured about that.
 */

const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const TAGS = {
  change: 'kosmos-escrowd-roster-change v1',
  cancel: 'kosmos-escrowd-roster-cancel v1',
  reviewerEnrol: 'kosmos-escrowd-reviewer-enrol v1',
  reviewerRevoke: 'kosmos-escrowd-reviewer-revoke v1',
  adminFingerprint: 'kosmos-escrowd-admin-fingerprint v1',
  reviewerFingerprint: 'kosmos-escrowd-reviewer-fingerprint v1',
};
// The tags an admin key signs. Fingerprint tags are hash inputs, never signed.
const SIGNED = ['change', 'cancel', 'reviewerEnrol', 'reviewerRevoke'];
const KEY_TYPES = ['se-p256', 'webauthn-p256'];
const CANCEL_KINDS = ['roster-change', 'reviewer-enrol'];
const HELPER_TIMEOUT_MS = 120000;

function utf8(s) {
  if (typeof s !== 'string') throw new Error('a text field is a string');
  return Buffer.from(s, 'utf8');
}
const fatalUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function field(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('a field is bytes');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(bytes.length);
  return Buffer.concat([len, bytes]);
}
function generationBytes(generation) {
  if (!/^\d+$/.test(String(generation))) throw new Error('the generation is not a whole number');
  const g = BigInt(generation);
  if (g >= 1n << 64n) throw new Error('the generation is out of range');
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(g);
  return out;
}
function flagByte(b) {
  if (typeof b !== 'boolean') throw new Error('a flag is true or false');
  return Buffer.of(b ? 1 : 0);
}
function key(k) {
  if (!(k instanceof Uint8Array) || k.length !== 65 || k[0] !== 4) throw new Error('a key is 65 bytes of uncompressed SEC1');
  return k;
}

function encodeChange(org, generation, change, nonce) {
  const parts = [utf8(TAGS.change), field(utf8(org)), field(generationBytes(generation))];
  if (change.kind === 'add') {
    const a = change.admin;
    parts.push(field(utf8('add')), field(utf8(a.adminId)), field(utf8(a.personId)), field(utf8(a.keyType)),
      field(key(a.key)), field(a.credentialId));
  } else if (change.kind === 'remove') {
    if (change.keyHash.length !== 32) throw new Error('a key hash is 32 bytes');
    parts.push(field(utf8('remove')), field(utf8(change.adminId)), field(change.keyHash));
  } else {
    throw new Error('a change is an add or a remove');
  }
  parts.push(field(nonce));
  return Buffer.concat(parts);
}
function encodeCancel(org, kind, id) {
  if (!CANCEL_KINDS.includes(kind)) throw new Error('not a thing that can be cancelled');
  return Buffer.concat([utf8(TAGS.cancel), field(utf8(org)), field(utf8(kind)), field(id)]);
}
function encodeReviewerEnrol(org, generation, r, nonce) {
  return Buffer.concat([utf8(TAGS.reviewerEnrol), field(utf8(org)), field(generationBytes(generation)),
    field(utf8(r.reviewer)), field(r.credentialId), field(key(r.key)), field(flagByte(r.be)), field(flagByte(r.bs)),
    field(nonce)]);
}
function encodeReviewerRevoke(org, credentialId) {
  return Buffer.concat([utf8(TAGS.reviewerRevoke), field(utf8(org)), field(credentialId)]);
}

// Reads the fields after a tag. Another action's tag, anything short, malformed or left over refuses.
class Reader {
  constructor(bytes, tag) {
    if (!(bytes instanceof Uint8Array)) throw new Error('the bytes to sign are bytes');
    const t = utf8(tag);
    if (bytes.length < t.length || !t.equals(Buffer.from(bytes.subarray(0, t.length)))) {
      throw new Error('these bytes are for a different action');
    }
    this.bytes = Buffer.from(bytes); this.at = t.length;
  }
  take() {
    if (this.at + 4 > this.bytes.length) throw new Error('the bytes end early');
    const len = this.bytes.readUInt32BE(this.at);
    this.at += 4;
    if (this.at + len > this.bytes.length) throw new Error('the bytes end early');
    const out = Buffer.from(this.bytes.subarray(this.at, this.at + len));
    this.at += len;
    return out;
  }
  text() { return fatalUtf8.decode(this.take()); }
  generation() {
    const b = this.take();
    if (b.length !== 8) throw new Error('the generation is the wrong length');
    return b.readBigUInt64BE(0);
  }
  flag() {
    const b = this.take();
    if (b.length !== 1 || b[0] > 1) throw new Error('a flag is one byte, 0 or 1');
    return b[0] === 1;
  }
  // Shape only, as the console page: whether the point is on the curve, and whether escrowd will take the flags, is
  // escrowd's check (roster.rs), so a fingerprint shown here can describe a key escrowd then refuses.
  key() { return key(this.take()); }
  end() { if (this.at !== this.bytes.length) throw new Error('there are bytes left over'); }
}

function decodeChange(bytes) {
  const r = new Reader(bytes, TAGS.change);
  const org = r.text(), generation = r.generation(), kind = r.text();
  let change;
  if (kind === 'add') {
    const admin = { adminId: r.text(), personId: r.text(), keyType: r.text(), key: r.key(), credentialId: r.take() };
    if (!KEY_TYPES.includes(admin.keyType)) throw new Error('not a key type');
    if ((admin.keyType === 'webauthn-p256') !== (admin.credentialId.length > 0)) {
      throw new Error('a passkey has a credential id, and only a passkey does');
    }
    change = { kind, admin };
  } else if (kind === 'remove') {
    change = { kind, adminId: r.text(), keyHash: r.take() };
    if (change.keyHash.length !== 32) throw new Error('a key hash is 32 bytes');
  } else {
    throw new Error('a change is an add or a remove');
  }
  const nonce = r.take();
  r.end();
  return { org, generation, change, nonce };
}
function decodeCancel(bytes) {
  const r = new Reader(bytes, TAGS.cancel);
  const org = r.text(), kind = r.text(), id = r.take();
  r.end();
  if (!CANCEL_KINDS.includes(kind)) throw new Error('not a thing that can be cancelled');
  return { org, kind, id };
}
function decodeReviewerEnrol(bytes) {
  const r = new Reader(bytes, TAGS.reviewerEnrol);
  const out = { org: r.text(), generation: r.generation(), reviewer: r.text(), credentialId: r.take(), key: r.key(),
    be: r.flag(), bs: r.flag(), nonce: r.take() };
  r.end();
  return out;
}
function decodeReviewerRevoke(bytes) {
  const r = new Reader(bytes, TAGS.reviewerRevoke);
  const out = { org: r.text(), credentialId: r.take() };
  r.end();
  return out;
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

function adminFingerprint(org, a) {
  return sha256(Buffer.concat([utf8(TAGS.adminFingerprint), field(utf8(org)), field(utf8(a.adminId)),
    field(utf8(a.personId)), field(utf8(a.keyType)), field(key(a.key)), field(a.credentialId)])).subarray(0, 16);
}
function reviewerFingerprint(org, r) {
  return sha256(Buffer.concat([utf8(TAGS.reviewerFingerprint), field(utf8(org)), field(utf8(r.reviewer)),
    field(r.credentialId), field(key(r.key)), field(flagByte(r.be)), field(flagByte(r.bs))])).subarray(0, 16);
}
function fingerprintDisplay(fp) {
  const h = Buffer.from(fp).toString('hex');
  return [h.slice(0, 8), h.slice(8, 16), h.slice(16, 24), h.slice(24, 32)].join(' ');
}

/* kosmos#7892 (round-8 WARNING 1 of #7116): decoded text goes on the screen that asks a person to sign, and the only
   check on it is valid UTF-8, so a hostile coordinator could make two orgs or admins look alike. shownText() is what
   the screen shows instead of the raw string:
   - every control, format (bidi overrides and isolates, zero-width characters, the BOM, the soft hyphen), line or
     paragraph separator, private-use or unassigned code point, every default-ignorable code point (variation
     selectors, the combining grapheme joiner, the Hangul fillers: invisible marks and letters), the characters that
     draw as a blank or a box (U+2800 braille blank, U+FFFC object replacement, U+FFFD replacement), and every space
     other than U+0020, is written as \u{XXXX}, and the text is marked unusual;
   - text that changes under NFC or NFKC is marked unusual: "Cafe" with a combining accent looks like "Café" with a
     precomposed one, and fullwidth "ＡBC" like "ABC";
   - more than two combining marks in a row mark it unusual (a stack can hide or imitate a letter);
   - a space at the start or end, or a second space in a row, is written as \u{0020} and marks it unusual;
   - a backslash is written as \\, so a name that spells "\u{202E}" in plain letters cannot pass for an escaped one;
   - letters from more than one script (Latin with Cyrillic or Greek, say) are left as they are but mark the text
     unusual, since look-alike letters are the other way to fake a name. Latin with Han ("Kosmos 株式会社") is marked
     too: cautious, and pinned by a test.
   `unusual` means "look closer", not "suspicious": it is cautious, so some ordinary names carry it (pointed Hebrew,
   decomposed Hangul, Latin with Han). `unusual: false` does NOT mean a name cannot imitate another. A name written wholly in one script that looks like
   another (all-Cyrillic "АВС" for Latin "ABC") is not marked. For an admin add or a reviewer enrolment the
   fingerprint is the defence; for an org name on a cancel or a revoke nothing here is. */
const ESCAPED = /[\p{Cs}\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Default_Ignorable_Code_Point}\u2800\uFFFC\uFFFD]|(?! )\p{Zs}/u;
const SCRIPTS = ['Latin', 'Cyrillic', 'Greek', 'Armenian', 'Cherokee', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Arabic',
  'Hebrew', 'Devanagari', 'Thai'].map((name) => [name, new RegExp('\\p{Script=' + name + '}', 'u')]);
function scriptOf(ch) {
  // A Common or Inherited letter (the Japanese long-vowel mark, the Arabic tatweel) belongs to no one script.
  if (!/\p{L}/u.test(ch) || /[\p{Script=Common}\p{Script=Inherited}]/u.test(ch)) return null;
  const hit = SCRIPTS.find(([, re]) => re.test(ch));
  return hit ? hit[0] : 'other';
}
function shownText(s) {
  let text = '', unusual = s !== s.normalize('NFC') || s !== s.normalize('NFKC') || /\p{M}{3}/u.test(s);
  const scripts = new Set();
  const chars = [...s];
  chars.forEach((ch, i) => {
    if (ch === ' ' && (i === 0 || i === chars.length - 1 || chars[i - 1] === ' ')) { text += '\\u{0020}'; unusual = true; return; }
    if (ch === '\\') { text += '\\\\'; return; }
    if (ESCAPED.test(ch)) { text += '\\u{' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + '}'; unusual = true; return; }
    const sc = scriptOf(ch);
    if (sc) scripts.add(sc);
    text += ch;
  });
  // Japanese writes Han, Hiragana and Katakana together; that alone is not a look-alike.
  const mixed = [...scripts].filter((x) => !['Han', 'Hiragana', 'Katakana'].includes(x)).length + (['Han', 'Hiragana', 'Katakana'].some((x) => scripts.has(x)) ? 1 : 0);
  if (mixed > 1) unusual = true;
  return { text, unusual };
}
// Every string in a decoded action, as shownText() writes it; bytes and other values are left out (the screen shows
// those as hex or fingerprints). `unusual` is true when any one string is.
function shownFields(decoded) {
  let unusual = false;
  const walk = (v) => {
    if (typeof v === 'string') { const s = shownText(v); unusual = unusual || s.unusual; return s.text; }
    if (Array.isArray(v)) return Object.freeze(v.map(walk).filter((w) => w !== undefined));
    if (v && typeof v === 'object' && !(v instanceof Uint8Array)) {
      const out = {};
      for (const [k, x] of Object.entries(v)) { const w = walk(x); if (w !== undefined) out[k] = w; }
      return Object.freeze(out);
    }
    return undefined;
  };
  const fields = walk(decoded);
  return { fields, unusual };
}

const DECODERS = { change: decodeChange, cancel: decodeCancel, reviewerEnrol: decodeReviewerEnrol,
  reviewerRevoke: decodeReviewerRevoke };

// The objects prepare() made, each with its own copy of the bytes. sign() takes nothing else.
const PREPARED = new WeakMap();

/** Decode `bytes` as `action` (refusing anything else) and say what a screen must show before the person signs. */
function prepare(action, bytes) {
  if (!SIGNED.includes(action)) throw new Error('not an action an admin key signs');
  if (!(bytes instanceof Uint8Array)) throw new Error('the bytes to sign are bytes');
  const message = Buffer.from(bytes);
  const decoded = DECODERS[action](message);
  let fingerprint = null;
  if (action === 'change' && decoded.change.kind === 'add') {
    fingerprint = fingerprintDisplay(adminFingerprint(decoded.org, decoded.change.admin));
  } else if (action === 'reviewerEnrol') {
    fingerprint = fingerprintDisplay(reviewerFingerprint(decoded.org, decoded));
  }
  const shown = shownFields(decoded);   // #7892: what the screen shows in place of the raw strings
  const prepared = Object.freeze(Object.defineProperties({ action, fingerprint, challenge: sha256(message).toString('hex'),
    shown: shown.fields, unusual: shown.unusual }, {
    // Read fresh from the held copy every time, so nothing a caller does to one read changes the next.
    decoded: { get: () => DECODERS[action](Buffer.from(message)), enumerable: true },
  }));
  PREPARED.set(prepared, message);
  return prepared;
}

/* kosmos#7892: what a screen may say when kosmos-se fails. A child-process error's message carries the helper's path,
   its argv and its stderr, so it is never passed on. kosmos-se writes one line, "kosmos-se: <why>", and every <why>
   it can write is listed here (seadmin-7116.test.js holds this list to native-se/main.swift); a line not on it, or
   no line, becomes the generic sentence. The one <why> with a variable tail (the Enclave's own description after
   "refused to make a key") is matched by its fixed start, and only the fixed start is shown. */
const HELPER_SAYS = [
  'cannot read the key file', 'the key file is not a plain file', 'the key file belongs to someone else',
  'the key file is readable by others (it must be 0600)', "this Mac's Secure Enclave cannot open that key file",
  'the message is too long to be an escrowd action', 'this Mac has no Secure Enclave',
  'cannot make the access control for a presence key', 'the key file already exists', 'cannot create the key file',
  'cannot write the key file', 'refusing to sign bytes that are not an escrowd admin action',
  'the Secure Enclave refused to sign',
];
const HELPER_SAYS_PREFIX = ['the Secure Enclave refused to make a key'];
const HELPER_GENERIC = 'the admin key helper failed';
function helperSentence(stderr) {
  const line = String(stderr || '').split('\n').find((l) => l.startsWith('kosmos-se: '));
  const why = line ? line.slice('kosmos-se: '.length).trim() : '';
  if (HELPER_SAYS.includes(why)) return why;
  return HELPER_SAYS_PREFIX.find((p) => why.startsWith(p + ' (') || why === p) || HELPER_GENERIC;
}

// Async (#7892): a presence key's signature waits on the person, so the board's event loop must not.
function runHelper(helper, args, input) {
  if (typeof helper !== 'string' || !helper) return Promise.reject(new Error('no kosmos-se helper was named'));
  return new Promise((resolve, reject) => {
    let child;
    // An invalid argument (a NUL in a path, say) makes execFile THROW, and its message carries the argument: generic.
    try { child = execFile(helper, args, { timeout: HELPER_TIMEOUT_MS, encoding: 'buffer', maxBuffer: 1 << 16 },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout.toString('utf8').trim());
        // Over maxBuffer: on Node 26.8.1 on this Mac `killed` was unset here (measured 11-03; other versions may
        // differ), so this reaches the generic sentence either way; the check keeps it from reading as a timeout on a
        // runtime that does set `killed`.
        if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return reject(new Error(HELPER_GENERIC));
        if (err.killed) return reject(new Error('kosmos-se did not finish in time (a presence key waits for the person)'));
        if (err.code === 'ENOENT') return reject(new Error('the admin key helper is not installed'));
        if (err.code === 'EACCES') return reject(new Error('the admin key helper cannot be run'));
        reject(new Error(helperSentence(stderr)));
      }); } catch { return reject(new Error(HELPER_GENERIC)); }
    // No stdin when the spawn itself failed (EMFILE, say): the callback reports it.
    if (!child.stdin) return;
    child.stdin.on('error', () => {});   // a helper that exits before reading its input is reported by its exit
    child.stdin.end(input || Buffer.alloc(0));
  });
}
function hexOf(out, what) {
  if (!/^([0-9a-f]{2})+$/.test(out)) throw new Error(`kosmos-se did not print a ${what}`);
  return Buffer.from(out, 'hex');
}

/**
 * Make this Mac's Secure Enclave admin key; returns its 65-byte public key. Refuses if keyFile exists. `presence:
 * false` makes a key any program running as this user can sign with; it exists for tests, where nobody can answer.
 */
async function createKey({ helper, keyFile, presence = true }) {
  return key(hexOf(await runHelper(helper, ['create', keyFile, presence === false ? 'none' : 'presence']), 'public key'));
}
async function publicKey({ helper, keyFile }) {
  return key(hexOf(await runHelper(helper, ['pub', keyFile]), 'public key'));
}

/**
 * Sign what prepare() decoded and showed, with the Enclave key; returns the DER signature escrowd's verify_se takes.
 * `expectedKey` is the 65-byte public key this Mac enrolled as its admin key; a key file holding any other refuses.
 */
async function sign(prepared, { helper, keyFile, expectedKey }) {
  const message = PREPARED.get(prepared);
  if (!message) throw new Error('sign takes only what prepare returned');
  const expected = key(expectedKey);
  const pub = await publicKey({ helper, keyFile });
  if (!pub.equals(Buffer.from(expected))) throw new Error('the key file holds a different key from the enrolled one');
  const der = hexOf(await runHelper(helper, ['sign', keyFile], message), 'signature');
  const jwk = { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'),
    y: pub.subarray(33, 65).toString('base64url') };
  if (!crypto.verify('sha256', message, { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'der' }, der)) {
    throw new Error('kosmos-se returned a signature that does not verify under its own key');
  }
  return der;
}

module.exports = {
  TAGS, SIGNED,
  encodeChange, encodeCancel, encodeReviewerEnrol, encodeReviewerRevoke,
  decodeChange, decodeCancel, decodeReviewerEnrol, decodeReviewerRevoke,
  adminFingerprint, reviewerFingerprint, fingerprintDisplay,
  prepare, createKey, publicKey, sign, HELPER_SAYS, HELPER_SAYS_PREFIX,
};
