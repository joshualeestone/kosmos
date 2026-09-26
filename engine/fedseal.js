'use strict';
/**
 * kosmos#3728: federated room messages sealed end to end, so the relay and the
 * coordinator (us) carry only public keys and ciphertext.
 *
 * The design is on the card (Ice Cream Kitty, 2026-09-25 10:31). In short:
 *   - The coordinator mints and therefore SEES the invite code, so nothing derived
 *     from that code alone can be secret from us. The owner's board adds a second
 *     half `s` (32 random bytes) that travels only person to person.
 *   - Each board has its own X25519 sealing key (this module's key file), separate
 *     from the connector's Ed25519 mac_key: one key, one algorithm.
 *   - key-hello (member -> owner): the member's public key, MAC'd with a key derived
 *     from `s`. key-share (owner -> member): the room key sealed to the member's key
 *     (X25519 -> HKDF -> ChaCha20-Poly1305), MAC'd with `s` over both public keys, so
 *     each side pins the other's key and nobody without `s` can swap one in.
 *   - key-rotate (owner -> each remaining member, on revoke): the next epoch's key,
 *     sealed to the member's PINNED key; only the pinned owner key can produce it.
 *   - A message is { v, epoch, nonce, ct } under the room key for its epoch, with the
 *     room id and epoch bound in as associated data.
 *
 * Pure functions except the key file. Every open/check returns null on ANY failure
 * (wrong key, wrong room, wrong epoch, tampered byte, malformed input) and never
 * throws: a frame from outside must not be able to take the board down.
 *
 * NOT CLAIMED (v1, stated on the card): no forward secrecy (the share uses the two
 * boards' long-term keys); members share one room key, so a member could forge
 * another member's `from`, as today.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const KEY_FILE = 'fed-seal-key.json';
const V = 1;
const AEAD = 'chacha20-poly1305';
const TAG = 16;
const NONCE = 12;

const b64 = (buf) => Buffer.from(buf).toString('base64url');
function unb64(s, len) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const buf = Buffer.from(s, 'base64url');
  if (len !== undefined && buf.length !== len) return null;
  return buf;
}

/* ---- keys ---- */

function keyFile() { return path.join(store.ROOT, KEY_FILE); }

/** This board's X25519 sealing key, made on first use and kept at mode 600.
    Returns { pub (base64url, 32 bytes), privateKey (KeyObject) }. A key file that
    exists but cannot be read or parsed THROWS rather than being replaced: a silent
    new key would orphan every room this board has joined. */
function sealingKey() {
  const f = keyFile();
  let raw = null;
  try { raw = fs.readFileSync(f, 'utf8'); } catch (err) {
    if (!err || err.code !== 'ENOENT') throw new Error('we cannot read this computer\'s sealing key right now');
  }
  if (raw === null) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
    const jwk = privateKey.export({ format: 'jwk' });
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ v: V, x: jwk.x, d: jwk.d }), { mode: 0o600 });
    fs.renameSync(tmp, f);
    return { pub: publicKey.export({ format: 'jwk' }).x, privateKey };
  }
  let j;
  try { j = JSON.parse(raw); } catch { j = null; }
  if (!j || !unb64(j.x, 32) || !unb64(j.d, 32)) throw new Error('this computer\'s sealing key is there but we cannot make sense of it');
  const privateKey = crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'X25519', x: j.x, d: j.d }, format: 'jwk' });
  return { pub: j.x, privateKey };
}

/** A key pair for tests and for a board that holds more than one identity. */
function newKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return { pub: publicKey.export({ format: 'jwk' }).x, privateKey };
}

function publicKeyObject(pub) {
  if (!unb64(pub, 32)) return null;
  try { return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: pub }, format: 'jwk' }); } catch { return null; }
}

/** 32 random bytes, base64url: the invite's second half (`s`) or a room key. */
function randomSecret() { return b64(crypto.randomBytes(32)); }

/* ---- derivation ---- */

function hkdf(ikm, info, len = 32) {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), Buffer.from('kosmos-fed-seal/' + info), len));
}
function mac(key, parts) {
  const h = crypto.createHmac('sha256', key);
  for (const p of parts) { const b = Buffer.from(String(p)); const n = Buffer.alloc(4); n.writeUInt32BE(b.length); h.update(n); h.update(b); }
  return h.digest();
}
function macOk(key, parts, given) {
  const want = mac(key, parts);
  const got = unb64(given, want.length);
  return !!got && crypto.timingSafeEqual(want, got);
}
function secretBytes(s) { return unb64(s, 32); }

/* ---- AEAD ---- */

function aeadSeal(key, aad, plaintext) {
  const nonce = crypto.randomBytes(NONCE);
  const c = crypto.createCipheriv(AEAD, key, nonce, { authTagLength: TAG });
  c.setAAD(aad, { plaintextLength: plaintext.length });
  const ct = Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
  return { nonce: b64(nonce), ct: b64(ct) };
}
function aeadOpen(key, aad, nonceB64, ctB64) {
  const nonce = unb64(nonceB64, NONCE);
  const all = unb64(ctB64);
  if (!nonce || !all || all.length < TAG) return null;
  try {
    const d = crypto.createDecipheriv(AEAD, key, nonce, { authTagLength: TAG });
    d.setAAD(aad, { plaintextLength: all.length - TAG });
    d.setAuthTag(all.subarray(all.length - TAG));
    return Buffer.concat([d.update(all.subarray(0, all.length - TAG)), d.final()]);
  } catch { return null; }
}
function aad(...parts) { return Buffer.from(JSON.stringify(parts)); }

/** The key two boards share: X25519 of one's private key and the other's public key,
    through HKDF bound to the room and to BOTH public keys in a fixed order. */
function pairKey(me, theirPub, roomId, ownerPub, memberPub) {
  const theirs = publicKeyObject(theirPub);
  if (!theirs) return null;
  let shared;
  try { shared = crypto.diffieHellman({ privateKey: me.privateKey, publicKey: theirs }); } catch { return null; }
  return hkdf(Buffer.concat([shared, Buffer.from(String(roomId)), Buffer.from(ownerPub), Buffer.from(memberPub)]), 'pair');
}

/* ---- key-hello (member -> owner) ---- */

function helloFrame(s, me, roomId) {
  const sb = secretBytes(s);
  if (!sb) throw new Error('the invite\'s second half is not the right shape');
  return { t: 'key-hello', v: V, pub: me.pub, mac: b64(mac(hkdf(sb, 'hello'), ['hello', roomId, me.pub])) };
}
/** The member's public key when the hello is genuine for this `s` and room, else null. */
function checkHello(s, frame, roomId) {
  const sb = secretBytes(s);
  if (!sb || !frame || frame.t !== 'key-hello' || frame.v !== V || !publicKeyObject(frame.pub)) return null;
  return macOk(hkdf(sb, 'hello'), ['hello', roomId, frame.pub], frame.mac) ? frame.pub : null;
}

/* ---- key-share (owner -> member, once, authenticated by s) ---- */

function shareFrame(s, owner, memberPub, roomKey, epoch, roomId) {
  const sb = secretBytes(s);
  const rk = unb64(roomKey, 32);
  const k = pairKey(owner, memberPub, roomId, owner.pub, memberPub);
  if (!sb || !rk || !k || !Number.isInteger(epoch) || epoch < 0) throw new Error('we could not seal the room key for that member');
  const box = aeadSeal(k, aad('share', roomId, epoch), rk);
  const tag = mac(hkdf(sb, 'share'), ['share', roomId, owner.pub, memberPub, epoch, box.nonce, box.ct]);
  return { t: 'key-share', v: V, owner: owner.pub, epoch, nonce: box.nonce, ct: box.ct, mac: b64(tag) };
}
/** { ownerPub, epoch, roomKey } when the share is genuine for this `s`, this member
    key and this room, else null. The caller pins ownerPub. */
function openShare(s, me, frame, roomId) {
  const sb = secretBytes(s);
  if (!sb || !frame || frame.t !== 'key-share' || frame.v !== V || !Number.isInteger(frame.epoch) || frame.epoch < 0) return null;
  if (!publicKeyObject(frame.owner)) return null;
  if (!macOk(hkdf(sb, 'share'), ['share', roomId, frame.owner, me.pub, frame.epoch, frame.nonce, frame.ct], frame.mac)) return null;
  const k = pairKey(me, frame.owner, roomId, frame.owner, me.pub);
  if (!k) return null;
  const rk = aeadOpen(k, aad('share', roomId, frame.epoch), frame.nonce, frame.ct);
  return rk && rk.length === 32 ? { ownerPub: frame.owner, epoch: frame.epoch, roomKey: b64(rk) } : null;
}

/* ---- key-rotate (owner -> a remaining member, on revoke; authenticated by the pinned keys) ---- */

function rotateFrame(owner, memberPub, roomKey, epoch, roomId) {
  const rk = unb64(roomKey, 32);
  const k = pairKey(owner, memberPub, roomId, owner.pub, memberPub);
  if (!rk || !k || !Number.isInteger(epoch) || epoch < 1) throw new Error('we could not seal the next room key for that member');
  const box = aeadSeal(k, aad('rotate', roomId, epoch), rk);
  return { t: 'key-rotate', v: V, epoch, nonce: box.nonce, ct: box.ct };
}
/** { epoch, roomKey } when the rotate was made by the PINNED owner key for this
    member and room, else null. The AEAD itself is the authentication: only the
    holder of the pinned owner key can derive the pair key. */
function openRotate(me, pinnedOwnerPub, frame, roomId) {
  if (!frame || frame.t !== 'key-rotate' || frame.v !== V || !Number.isInteger(frame.epoch) || frame.epoch < 1) return null;
  const k = pairKey(me, pinnedOwnerPub, roomId, pinnedOwnerPub, me.pub);
  if (!k) return null;
  const rk = aeadOpen(k, aad('rotate', roomId, frame.epoch), frame.nonce, frame.ct);
  return rk && rk.length === 32 ? { epoch: frame.epoch, roomKey: b64(rk) } : null;
}

/* ---- messages ---- */

/** A room message sealed under the room key for `epoch`. */
function seal(roomKey, epoch, roomId, message) {
  const rk = unb64(roomKey, 32);
  if (!rk || !Number.isInteger(epoch) || epoch < 0) throw new Error('we could not seal that message');
  const box = aeadSeal(rk, aad('msg', roomId, epoch), Buffer.from(JSON.stringify(message)));
  return { v: V, epoch, nonce: box.nonce, ct: box.ct };
}
/** The message when `env` opens under the key this board holds for its epoch in
    this room, else null. `keys` maps epoch -> room key. */
function open(keys, roomId, env) {
  if (!isSealed(env)) return null;
  const rkB64 = keys && (keys instanceof Map ? keys.get(env.epoch) : keys[env.epoch]);
  const rk = unb64(rkB64, 32);
  if (!rk) return null;
  const pt = aeadOpen(rk, aad('msg', roomId, env.epoch), env.nonce, env.ct);
  if (!pt) return null;
  try { const m = JSON.parse(pt.toString('utf8')); return m && typeof m === 'object' && !Array.isArray(m) ? m : null; } catch { return null; }
}
/** Whether a payload has the sealed-message SHAPE (says nothing about whether it opens). */
function isSealed(env) {
  return !!env && typeof env === 'object' && env.v === V && Number.isInteger(env.epoch) && env.epoch >= 0
    && typeof env.nonce === 'string' && typeof env.ct === 'string';
}

/* ---- the rooms file: what this board holds per shared room ----
   fed-seal-rooms.json, mode 600, beside the key. ROOM KEYS AND `s` LIVE HERE, on this
   Mac only (never on our servers: the "hold no customer key" rule).
     pending[project_ref] = [{ s, at }]  an owner's invite halves, until a member uses one
     rooms[projectId] = { role, s, peer | peers, epoch, keys: { epoch: roomKey } }
   A file that exists but cannot be read or parsed THROWS and is never overwritten:
   losing it would lose every room key this board holds. */
const ROOMS_FILE = 'fed-seal-rooms.json';
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // an invite code lives 7 days
const PENDING_MAX = 32;                           // halves kept per project

function roomsFile() { return path.join(store.ROOT, ROOMS_FILE); }
function readRooms() {
  let raw;
  try { raw = fs.readFileSync(roomsFile(), 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return { v: V, pending: {}, rooms: {} };
    throw new Error('we cannot read this computer\'s sealed-rooms record right now');
  }
  let j;
  try { j = JSON.parse(raw); } catch { j = null; }
  if (!j || typeof j !== 'object' || !j.pending || !j.rooms) throw new Error('this computer\'s sealed-rooms record is there but we cannot make sense of it');
  return j;
}
function writeRooms(j) {
  const f = roomsFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(j), { mode: 0o600 });
  fs.renameSync(tmp, f);
}
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Owner: keep an invite's second half for the project it was minted for. */
function stashInviteSecret(projectRef, s, now = Date.now()) {
  if (!secretBytes(s)) throw new Error('the invite\'s second half is not the right shape');
  const j = readRooms();
  const list = (own(j.pending, projectRef) ? j.pending[projectRef] : []).filter((p) => now - p.at < PENDING_TTL_MS);
  list.push({ s, at: now });
  j.pending[projectRef] = list.slice(-PENDING_MAX);
  writeRooms(j);
}
/** Owner: the halves still live for a project, newest first. */
function inviteSecretsFor(projectRef, now = Date.now()) {
  const j = readRooms();
  if (!own(j.pending, projectRef)) return [];
  return j.pending[projectRef].filter((p) => now - p.at < PENDING_TTL_MS).map((p) => p.s).reverse();
}
/** Owner: a half is spent once a member's hello has been checked against it. */
function spendInviteSecret(projectRef, s) {
  const j = readRooms();
  if (!own(j.pending, projectRef)) return;
  j.pending[projectRef] = j.pending[projectRef].filter((p) => p.s !== s);
  if (!j.pending[projectRef].length) delete j.pending[projectRef];
  writeRooms(j);
}
function roomState(projectId) {
  const j = readRooms();
  return own(j.rooms, projectId) ? j.rooms[projectId] : null;
}
function setRoomState(projectId, state) {
  const j = readRooms();
  j.rooms[projectId] = state;
  writeRooms(j);
  return state;
}
function forgetRoom(projectId) {
  const j = readRooms();
  if (!own(j.rooms, projectId)) return false;
  delete j.rooms[projectId];
  writeRooms(j);
  return true;
}

/** An invite code as a person pastes it: `<coordinator code>.<s>`. The coordinator's
    code is base64url, which never contains '.', so the LAST '.' splits it. A code with
    no well-formed second half is a code from a board that does not seal (s: null). */
function splitInviteCode(pasted) {
  const code = String(pasted == null ? '' : pasted).trim();
  const at = code.lastIndexOf('.');
  if (at > 0 && secretBytes(code.slice(at + 1))) return { code: code.slice(0, at), s: code.slice(at + 1) };
  return { code, s: null };
}

module.exports = {
  ROOMS_FILE, stashInviteSecret, inviteSecretsFor, spendInviteSecret, roomState, setRoomState, forgetRoom, splitInviteCode,
  KEY_FILE, sealingKey, newKeyPair, randomSecret,
  helloFrame, checkHello, shareFrame, openShare, rotateFrame, openRotate,
  seal, open, isSealed,
};
