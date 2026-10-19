'use strict';

/**
 * kosmos#5686 (b1-mac): checks escrowd's signature over a company's backup PUBLIC key, so this computer can tell the
 * key escrowd made from one a breached Kosmos+ coordinator hands out (it could otherwise serve a key it holds the
 * private half of, and every member key wrapped to it would be open to it).
 *
 * The signed bytes are kosmos-relay coordinator/src/orgkeysig.rs `encode`: a domain tag, then the org id, the epoch
 * (i64 big-endian) and the 32-byte public key, each prefixed with its length (u32 big-endian). The signature is Ed25519
 * by escrowd's org-key signing key; its verification key is SHIPPED with this app, never fetched from the coordinator.
 * The two sides are pinned to one known vector (orgkeysig.test.js here, a_known_signature_is_pinned_for_the_macs_verifier
 * there).
 *
 * Never throws: verify() answers true only for a well-formed signature that verifies; anything else is false.
 */

const crypto = require('node:crypto');

const TAG = Buffer.from('kosmos-escrowd-orgkey v1');
// An Ed25519 public key as SubjectPublicKeyInfo DER: this fixed prefix, then the 32 raw bytes (RFC 8410).
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

function put(parts, field) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(field.length);
  parts.push(len, field);
}

/* The signed bytes for (org, epoch, public). null when an input is not what the signer could have signed. */
function encode(org, epoch, publicKey) {
  if (typeof org !== 'string' || !Number.isSafeInteger(epoch) || !Buffer.isBuffer(publicKey) || publicKey.length !== 32) return null;
  const e = Buffer.alloc(8);
  e.writeBigInt64BE(BigInt(epoch));
  const parts = [];
  put(parts, TAG);
  put(parts, Buffer.from(org, 'utf8'));
  put(parts, e);
  put(parts, publicKey);
  return Buffer.concat(parts);
}

/* True only when `signature` (64 bytes) is escrowd's signature, under `verifyingKey` (32 raw bytes), over exactly
   (org, epoch, publicKey). */
function verify(verifyingKey, org, epoch, publicKey, signature) {
  try {
    if (!Buffer.isBuffer(verifyingKey) || verifyingKey.length !== 32) return false;
    if (!Buffer.isBuffer(signature) || signature.length !== 64) return false;
    const msg = encode(org, epoch, publicKey);
    if (!msg) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, verifyingKey]), format: 'der', type: 'spki' });
    return crypto.verify(null, msg, key, signature) === true;
  } catch {
    return false;
  }
}

module.exports = { encode, verify, TAG };
