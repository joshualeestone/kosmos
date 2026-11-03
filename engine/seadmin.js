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
 *     malformed or trailing bytes) and returns what a screen must show: the decoded fields and, for an admin add or a
 *     reviewer enrolment, the fingerprint computed here from the decoded bytes;
 *   - sign(action, bytes, opts) decodes again, then hands the RAW message to kosmos-se, which hashes it in the Enclave
 *     (Apple's message mode, which is what verify_se checks). No digest ever crosses into the signer.
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
 */

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

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

const DECODERS = { change: decodeChange, cancel: decodeCancel, reviewerEnrol: decodeReviewerEnrol,
  reviewerRevoke: decodeReviewerRevoke };

/** Decode `bytes` as `action` (refusing anything else) and say what a screen must show before the person signs. */
function prepare(action, bytes) {
  if (!SIGNED.includes(action)) throw new Error('not an action an admin key signs');
  const decoded = DECODERS[action](bytes);
  let fingerprint = null;
  if (action === 'change' && decoded.change.kind === 'add') {
    fingerprint = fingerprintDisplay(adminFingerprint(decoded.org, decoded.change.admin));
  } else if (action === 'reviewerEnrol') {
    fingerprint = fingerprintDisplay(reviewerFingerprint(decoded.org, decoded));
  }
  return { action, decoded, fingerprint, challenge: sha256(bytes).toString('hex') };
}

function runHelper(helper, args, input) {
  if (typeof helper !== 'string' || !helper) throw new Error('no kosmos-se helper was named');
  return execFileSync(helper, args, { input: input || Buffer.alloc(0), stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30000 }).toString('utf8').trim();
}
function hexOf(out, what) {
  if (!/^([0-9a-f]{2})+$/.test(out)) throw new Error(`kosmos-se did not print a ${what}`);
  return Buffer.from(out, 'hex');
}

/** Make this Mac's Secure Enclave admin key; returns its 65-byte public key. Refuses if keyFile exists. */
function createKey({ helper, keyFile }) {
  return key(hexOf(runHelper(helper, ['create', keyFile]), 'public key'));
}
function publicKey({ helper, keyFile }) {
  return key(hexOf(runHelper(helper, ['pub', keyFile]), 'public key'));
}

/** Sign `bytes` as `action` with the Enclave key. Decodes first; returns the DER signature escrowd's verify_se takes. */
function sign(action, bytes, { helper, keyFile }) {
  prepare(action, bytes);
  return hexOf(runHelper(helper, ['sign', keyFile], Buffer.from(bytes)), 'signature');
}

module.exports = {
  TAGS, SIGNED,
  encodeChange, encodeCancel, encodeReviewerEnrol, encodeReviewerRevoke,
  decodeChange, decodeCancel, decodeReviewerEnrol, decodeReviewerRevoke,
  adminFingerprint, reviewerFingerprint, fingerprintDisplay,
  prepare, createKey, publicKey, sign,
};
