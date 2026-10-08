'use strict';
/**
 * #5534: verify a KST1 token (the Kosmos Signed Token, kosmos-relay docs/token-format.md) on the board. The format:
 *   KST1.<base64url(payload json)>.<base64url(ed25519 signature)>
 * The signature covers the ASCII bytes of `KST1.<payload part>`. ed25519 only; no header, nothing to downgrade.
 *
 * Verifying, in the contract's order: exactly three parts with `KST1` first; the signature against the coordinator
 * key this Mac PINNED at setup (never a key the token names); the payload is JSON; `typ` is the one expected (a
 * relay ticket is not a policy); `exp` is not past. Never throws: { ok: true, payload } | { ok: false, why }.
 */
const crypto = require('node:crypto');

const B64URL = /^[A-Za-z0-9_-]+$/;

function fromB64url(s) {
  if (typeof s !== 'string' || !s || !B64URL.test(s)) return null;
  try { return Buffer.from(s, 'base64url'); } catch { return null; }
}

/** The pinned coordinator key (base64url of the 32 raw ed25519 bytes, as /v1/meta's coordinator_pubkey) as a key
 *  object, or null when it is not one. */
function publicKeyFrom(pinned) {
  const raw = fromB64url(String(pinned || '').trim());
  if (!raw || raw.length !== 32) return null;
  try { return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' }); }
  catch { return null; }
}

/**
 * @param {string} token   the KST1 token
 * @param {string} pinned  the pinned coordinator public key (base64url, 32 bytes)
 * @param {string} typ     the one typ this caller accepts
 * @param {number} [now]   unix seconds (tests pass it)
 */
function verify(token, pinned, typ, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string') return { ok: false, why: 'not a token' };
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'KST1') return { ok: false, why: 'not a KST1 token' };
  const key = publicKeyFrom(pinned);
  if (!key) return { ok: false, why: 'no pinned coordinator key' };
  const sig = fromB64url(parts[2]);
  if (!sig || sig.length !== 64) return { ok: false, why: 'the signature is malformed' };
  let good = false;
  try { good = crypto.verify(null, Buffer.from(parts[0] + '.' + parts[1], 'ascii'), key, sig); } catch { good = false; }
  if (!good) return { ok: false, why: 'the signature does not verify' };
  const body = fromB64url(parts[1]);
  let payload = null;
  try { payload = body ? JSON.parse(body.toString('utf8')) : null; } catch { payload = null; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, why: 'the payload is not an object' };
  if (payload.typ !== typ) return { ok: false, why: 'the token is not a ' + typ };
  if (!Number.isInteger(payload.exp) || payload.exp < now) return { ok: false, why: 'the token has expired' };
  return { ok: true, payload };
}

module.exports = { verify, publicKeyFrom };
