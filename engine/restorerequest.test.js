/**
 * kosmos#5536 (E0.7) design v2 / v2.1: engine/restorerequest.js. A release needs a request signed by two different
 * rostered admins (and the security contact for break-glass), on this service's org and id, past its wait on this
 * service's own clock, inside its 7-day window, with an unused nonce. Each refusal has a working control.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const rr = require('./restorerequest');

const H = 3600;
/* A deterministic Ed25519 key from a 32-byte seed (PKCS#8 prefix for Ed25519). */
const keyFromSeed = (byte) => {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, byte)]);
  const privateKey = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  return { privateKey, publicKey: crypto.createPublicKey(privateKey) };
};
const alice = keyFromSeed(1), bob = keyFromSeed(2), carol = keyFromSeed(3), mallory = keyFromSeed(9);
const roster = { admins: new Map([['alice', alice.publicKey], ['bob', bob.publicKey]]), contact: { id: 'carol', pub: carol.publicKey } };
const service = { org: 'acme', unwrap: 'unwrap-1' };
const policy = { waitSeconds: 72 * H, breakGlassWaitSeconds: 4 * H };
const T0 = 1_800_000_000;

const base = (over = {}) => ({
  v: 1, org: 'acme', unwrap: 'unwrap-1', member: 'm-42', destination: 'ab'.repeat(32), epochs: ['e1', 'e2'], snapshots: 'all',
  waitEndsAt: T0 + 72 * H, requester: 'alice', approver: 'bob', breakGlass: false, nonce: '0f'.repeat(16), ...over,
});
const signed = (req, signers = { requester: alice, approver: bob }) =>
  Object.fromEntries(Object.entries(signers).map(([role, k]) => [role, rr.signRequest(req, k.privateKey)]));
/* A first-sight store with an atomic setIfAbsent, as recordSeen requires. */
const storeOf = (m = new Map()) => ({ m, get: (id) => m.get(id), setIfAbsent: (id, v) => (m.has(id) ? false : (m.set(id, v), true)) });
/* check(req, { seenAt }) puts that first sight in a store under the request's id (unless the test brings its own). */
const check = (req, { seenAt = T0, ...o } = {}) => {
  let seen = o.seen;
  if (!seen) { seen = storeOf(); try { seen.m.set(rr.requestId(req), seenAt); } catch { /* malformed: no id */ } }
  return rr.checkRelease({ req, service, roster, policy, now: T0 + 73 * H, nonceUsed: () => false, isCancelled: () => false, destinationAllowed: () => true, noticeSentAt: () => seenAt, ...o,
    seen, signatures: 'signatures' in o ? o.signatures : signed(req) });
};

test('#5536 request: two different rostered admins, past the wait, release it (the control for every refusal below)', () => {
  const req = base({ snapshots: ['s9'] });
  assert.deepEqual(check(req), { ok: true, id: rr.requestId(req), member: 'm-42', destination: 'ab'.repeat(32), epochs: ['e1', 'e2'], snapshots: ['s9'], nonce: '0f'.repeat(16),
    breakGlass: false, requester: 'alice', approver: 'bob', contact: null });
});

test('#5536 request: one person cannot request and approve; both must be on the service\'s own roster; both must sign', () => {
  const same = base({ approver: 'alice' });
  assert.equal(check(same, { signatures: signed(same, { requester: alice, approver: alice }) }).why, 'one admin cannot both request and approve');
  const outsider = base({ approver: 'mallory' });
  assert.equal(check(outsider, { signatures: signed(outsider, { requester: alice, approver: mallory }) }).why, 'the approver is not an admin on this service\'s roster');
  const req = base();
  assert.equal(check(req, { signatures: { requester: signed(req).requester } }).why, 'the approver\'s signature does not verify', 'one signature is not two');
  assert.equal(check(req, { signatures: signed(req, { requester: alice, approver: mallory }) }).why, 'the approver\'s signature does not verify', 'a key not on the roster');
  assert.equal(check(req, { signatures: signed(req, { requester: bob, approver: alice }) }).why, 'the requester\'s signature does not verify', 'swapped roles');
});

test('#5536 request: any change after signing voids it; the service\'s own org and id are required', () => {
  const req = base();
  const sigs = signed(req);
  for (const change of [{ destination: 'cd'.repeat(32) }, { epochs: ['e1', 'e2', 'e3'] }, { waitEndsAt: T0 + H }, { member: 'm-43' }, { snapshots: ['s1'] }]) {
    const why = check({ ...req, ...change }, { signatures: sigs, now: T0 + 73 * H }).why;
    assert.equal(why, 'the requester\'s signature does not verify', JSON.stringify(change));
  }
  const other = base({ org: 'globex' });
  assert.equal(check(other).why, 'the request is for another org or unwrap service');
  assert.equal(check(req, { service: { org: 'acme', unwrap: 'unwrap-2' } }).why, 'the request is for another org or unwrap service');
  assert.match(check({ ...req, extra: 1 }, { signatures: sigs }).why, /unknown field extra/, 'nothing unsigned rides along');
});

test('#5536 request: the wait runs on the service\'s clock from when it first saw the request, and expires after 7 days', () => {
  const req = base();
  assert.equal(check(req, { now: T0 + 72 * H - 1 }).why, 'the wait has not ended');
  assert.ok(check(req, { now: T0 + 72 * H }).ok, 'CONTROL: exactly at the end');
  const early = base({ waitEndsAt: T0 + H });
  assert.equal(check(early, { now: T0 + 2 * H }).why, 'the wait has not ended', 'a short waitEndsAt does not shorten the policy wait');
  assert.equal(check(req, { now: T0 + 50 * H, seenAt: T0 - 90 * H }).why, 'the wait has not ended', 'seen long ago, but waitEndsAt still holds');
  assert.equal(check(req, { seenAt: T0 - 100 * H }).why, 'the request\'s wait is longer than any policy allows', 'a request cannot lie dormant past the longest wait');
  assert.equal(check(req, { isCancelled: (id) => id === rr.requestId(req) }).why, 'the request was cancelled');
  assert.equal(check(req, { seenAt: T0 + 10 * H }).why, 'the wait has not ended', 'seen late: the wait starts when the service saw it');
  assert.ok(check(req, { now: T0 + 72 * H + 7 * 24 * H }).ok, 'CONTROL: the last second of the window');
  assert.equal(check(req, { now: T0 + 72 * H + 7 * 24 * H + 1 }).why, 'the request expired (7 days after its wait)');
  assert.equal(check(req, { nonceUsed: (n) => n === '0f'.repeat(16) }).why, 'the request was already used');
});

test('#5536 request: two ids on one key are one person, for the admins and for the security contact', () => {
  const twin = { ...roster, admins: new Map([['alice', alice.publicKey], ['alice2', alice.publicKey]]) };
  const req = base({ approver: 'alice2' });
  assert.equal(check(req, { roster: twin, signatures: signed(req, { requester: alice, approver: alice }) }).why, 'the requester and approver ids share one key');
  const bg = base({ breakGlass: true, contact: 'carol', waitEndsAt: T0 + 4 * H });
  const contactIsBob = { ...roster, contact: { id: 'carol', pub: bob.publicKey } };
  assert.equal(check(bg, { roster: contactIsBob, signatures: signed(bg, { requester: alice, approver: bob, contact: bob }), now: T0 + 5 * H }).why, 'the security contact must be a third person');
  // The contact may not be a rostered admin at all, by id or by key (a third person, not a third admin).
  const dave = keyFromSeed(4);
  const daveAdmin = { admins: new Map([...roster.admins, ['dave', dave.publicKey]]), contact: { id: 'dave', pub: dave.publicKey } };
  const bgDave = base({ breakGlass: true, contact: 'dave', waitEndsAt: T0 + 4 * H });
  assert.equal(check(bgDave, { roster: daveAdmin, signatures: signed(bgDave, { requester: alice, approver: bob, contact: dave }), now: T0 + 5 * H }).why, 'the security contact may not also be an admin');
  const daveIdOnly = { admins: new Map([...roster.admins, ['dave', dave.publicKey]]), contact: { id: 'dave', pub: carol.publicKey } };
  assert.equal(check(bgDave, { roster: daveIdOnly, signatures: signed(bgDave, { requester: alice, approver: bob, contact: carol }), now: T0 + 5 * H }).why,
    'the security contact may not also be an admin', 'by id alone, with a key no admin holds');
  const daveKeyAdmin = { admins: new Map([...roster.admins, ['dave-admin', carol.publicKey]]), contact: roster.contact };
  assert.equal(check(bg, { roster: daveKeyAdmin, signatures: signed(bg, { requester: alice, approver: bob, contact: carol }), now: T0 + 5 * H }).why, 'the security contact may not also be an admin', 'by key, under another admin id');
  assert.equal(check(bg, { roster: { admins: roster.admins }, signatures: signed(bg, { requester: alice, approver: bob, contact: carol }), now: T0 + 5 * H }).why,
    'break-glass needs the org security contact named on this service\'s roster', 'no contact on the roster');
  const contactIsAlice = { ...roster, contact: { id: 'carol', pub: alice.publicKey } };
  assert.equal(check(bg, { roster: contactIsAlice, signatures: signed(bg, { requester: alice, approver: bob, contact: alice }), now: T0 + 5 * H }).why, 'the security contact must be a third person', 'the requester\'s key, too');
});

test('#5536 request: seenAt is keyed by requestId, so a second request under a seen nonce has its own id and its own wait', () => {
  const r1 = base(), r2 = base({ member: 'm-99', destination: 'cd'.repeat(32) });
  assert.equal(r1.nonce, r2.nonce);
  assert.notEqual(rr.requestId(r1), rr.requestId(r2), 'same nonce, different record, different id');
  assert.match(rr.requestId(r1), /^[0-9a-f]{64}$/);
  const seen = storeOf(new Map([[rr.requestId(r1), T0], [rr.requestId(r2), T0 + 60 * H]]));
  assert.ok(check(r1, { seen, noticeSentAt: () => T0 }).ok, 'CONTROL');
  assert.equal(check(r2, { seen, noticeSentAt: () => T0 + 60 * H }).why, 'the wait has not ended', 'r2 waits from when it was seen, read from the store by its own id');
  const out = check(r1);
  out.epochs.push('e9');
  assert.deepEqual(r1.epochs, ['e1', 'e2'], 'the result holds copies, not the request\'s arrays');
});

test('#5536 request: break-glass needs the security contact as a third signer, and waits at least 4 hours', () => {
  const bg = base({ breakGlass: true, contact: 'carol', waitEndsAt: T0 + 4 * H });
  const all = signed(bg, { requester: alice, approver: bob, contact: carol });
  const bgOk = check(bg, { signatures: all, now: T0 + 4 * H });
  assert.ok(bgOk.ok, 'CONTROL: three signers, four hours');
  assert.deepEqual([bgOk.breakGlass, bgOk.requester, bgOk.approver, bgOk.contact], [true, 'alice', 'bob', 'carol'], 'the caller counts and audits from the verified copy');
  assert.equal(check(bg, { signatures: all, now: T0 + 4 * H - 1 }).why, 'the wait has not ended');
  assert.equal(check(bg, { signatures: signed(bg), now: T0 + 4 * H }).why, 'the security contact\'s signature does not verify', 'two admins alone cannot break glass');
  const wrong = base({ breakGlass: true, contact: 'dave', waitEndsAt: T0 + 4 * H });
  assert.match(check(wrong, { signatures: signed(wrong, { requester: alice, approver: bob }), now: T0 + 5 * H }).why, /security contact named/);
  const selfContact = { ...roster, contact: { id: 'alice', pub: alice.publicKey } };
  const sc = base({ breakGlass: true, contact: 'alice', waitEndsAt: T0 + 4 * H });
  assert.equal(check(sc, { roster: selfContact, signatures: signed(sc, { requester: alice, approver: bob, contact: alice }), now: T0 + 5 * H }).why, 'the security contact must be a third person');
  assert.match(check(base({ contact: 'carol' }), { signatures: {} }).why, /bad contact/, 'a contact on an ordinary request is refused');
  assert.match(check(base({ breakGlass: true }), { signatures: {} }).why, /bad contact/, 'break-glass without a named contact is refused');
});

test('#5536 request: caller mistakes throw (wait policy out of range, no roster, clock not whole seconds)', () => {
  const req = base();
  assert.throws(() => check(req, { policy: { waitSeconds: 23 * H, breakGlassWaitSeconds: 4 * H } }), /24 to 168/);
  assert.throws(() => check(req, { policy: { waitSeconds: 72 * H, breakGlassWaitSeconds: 0 } }), /at least 4 hours/);
  assert.throws(() => check(req, { roster: { admins: {} } }), /required/);
  assert.throws(() => check(req, { now: T0 + 0.5 }), /whole seconds/);
  assert.equal(check(req, { seenAt: 0 }).why, 'could not read when this request was first seen', 'a missing first-seen time must not fall back to the signers\' waitEndsAt');
  assert.equal(check(req, { seen: storeOf() }).why, 'this service never recorded the request (recordSeen first)', 'no release without a recorded first sight');
  assert.match(check(req, { seenAt: T0 + 74 * H }).why, /clocks disagree/, 'first seen after now (skew between instances) refuses, not throws');
  assert.throws(() => check(req, { seen: { get: 1 } }), /seen, nonceUsed/);
  assert.throws(() => check(req, { isCancelled: undefined }), /destinationAllowed and noticeSentAt are required/);
  const sparse = base({ epochs: ['e1', 'e2'] }); delete sparse.epochs[1]; sparse.epochs.length = 2;
  assert.match(check(sparse, { signatures: {} }).why, /malformed request/, 'attacker-shaped input is refused, not thrown');
  assert.throws(() => rr.signRequest(req, alice.publicKey), /private key/);
  assert.throws(() => rr.requestBytes({ ...req, nonce: 'short' }), /bad nonce/);
  for (const [over, re] of [[{ v: 2 }, /unknown version/], [{ waitEndsAt: -1 }, /bad waitEndsAt/], [{ waitEndsAt: T0 + 0.5 }, /bad waitEndsAt/],
    [{ destination: 'AB'.repeat(32) }, /bad destination/], [{ destination: 'ab'.repeat(31) }, /bad destination/], [{ nonce: '0f'.repeat(17) }, /bad nonce/]]) {
    assert.throws(() => rr.requestBytes({ ...req, ...over }), re, JSON.stringify(over));
  }
  let reads = 0;
  const flip = { ...req };
  Object.defineProperty(flip, 'member', { enumerable: true, get: () => (reads++ ? 'm-evil' : 'm-42') });
  assert.equal(rr.requestBytes(flip).toString().includes('m-evil'), false);
  assert.equal(reads, 1, 'a signer reads each field once, so what is checked is what is signed');
  assert.throws(() => rr.requestBytes({ ...req, epochs: ['e1', 'e1'] }), /bad epochs/, 'a repeated epoch is refused, so one record has one spelling');
});

/* Computed once from this module and checked independently on 2026-10-08: shasum -a 256 of the bytes, and
   openssl pkeyutl -verify accepting the signature (and refusing it with one byte of the message flipped). */
const VECTOR = {
  bytesSha256: 'ac455f6f5225705fbb16b3e702a157166604a532ca1d8c6d33dad8fb49dfd203',
  aliceSig: '3b5c20f66484fcedd1023725e0e90a04fb7d3a787d977bb77cf16d2e66caedc4f9f119ef596234038ddf1e374d7703b85a710687550f0af0a8ac0a96f1ca2d0b',
  breakGlassId: '8b4fac4972999689b21e3329d847fa64ec099e8a231a78bc75f8b9220c94a7e4',  // shasum -a 256 of its bytes, 10-08
};

test('#5536 request: fixed vectors pin the signed bytes and the signatures for any other implementation', () => {
  const req = base({ snapshots: ['s9'] });
  const bytes = rr.requestBytes(req);
  assert.equal(bytes.subarray(0, 26).toString(), 'kosmos-restore-request v1\n');
  assert.equal(bytes.subarray(26).toString(), '{"approver":"bob","breakGlass":false,"destination":"' + 'ab'.repeat(32) + '","epochs":["e1","e2"],"member":"m-42","nonce":"' + '0f'.repeat(16) + '","org":"acme","requester":"alice","snapshots":["s9"],"unwrap":"unwrap-1","v":1,"waitEndsAt":1800259200}');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), VECTOR.bytesSha256);
  assert.equal(rr.signRequest(req, alice.privateKey).toString('hex'), VECTOR.aliceSig);
  const bg = base({ breakGlass: true, contact: 'carol', waitEndsAt: T0 + 4 * H });
  assert.equal(rr.requestId(bg), VECTOR.breakGlassId, 'a break-glass record, with contact in the signed bytes, is pinned too');
});

test('#5536 request: the destination must be one the service trusts for that member, and snapshots are never implied', () => {
  const req = base();
  const trusted = (fp, member) => fp === 'ab'.repeat(32) && member === 'm-42';
  assert.ok(check(req, { destinationAllowed: trusted }).ok, 'CONTROL');
  const own = base({ destination: 'ee'.repeat(32) });
  assert.equal(check(own, { destinationAllowed: trusted }).why, 'the destination is not one this service trusts for this member', 'two admins cannot name a key of their own');
  assert.deepEqual(check(req).snapshots, 'all');
  const noSnap = base(); delete noSnap.snapshots;
  assert.match(check(noSnap, { signatures: {} }).why, /bad snapshots/, 'leaving snapshots out is refused, so the signed bytes say what is released');
  assert.throws(() => check(req, { destinationAllowed: undefined }), /destinationAllowed and noticeSentAt are required/);
});

test('#5536 request: recordSeen keeps the first sight per requestId; the window runs 7 days from when the request opens', () => {
  const store = storeOf(), seen = store.m;
  const r1 = base(), r2 = base({ member: 'm-99' });
  const sight = (req, now, signatures = signed(req)) => rr.recordSeen(store, { req, signatures, service, roster, now, isCancelled: () => false, destinationAllowed: () => true });
  assert.deepEqual(sight(r1, T0), { ok: true, seenAt: T0, first: true });
  assert.deepEqual(sight(r1, T0 + 50 * H), { ok: true, seenAt: T0, first: false }, 'a second sight keeps the first, and is not a new notice');
  assert.deepEqual(sight(r2, T0 + 60 * H), { ok: true, seenAt: T0 + 60 * H, first: true }, 'same nonce, another record: its own first sight');
  for (const bad of [Promise.resolve(T0), String(T0), 0]) {
    const badStore = { get: () => bad, setIfAbsent: () => assert.fail('a first sight must not be overwritten') };
    assert.equal(rr.recordSeen(badStore, { req: r1, signatures: signed(r1), service, roster, isCancelled: () => false, destinationAllowed: () => true, now: T0 + 10 * H }).why, 'could not read when this request was first seen', typeof bad);
  }
  assert.deepEqual([...seen.keys()].sort(), [rr.requestId(r1), rr.requestId(r2)].sort());
  assert.throws(() => rr.recordSeen({ get: () => undefined, set: () => {} }, { req: r1, signatures: signed(r1), service, roster, isCancelled: () => false, destinationAllowed: () => true, now: T0 }), /get and setIfAbsent/);
  // A race: another instance stores first between this one's get and setIfAbsent. Its time stands, and only it notifies.
  const r4 = base({ member: 'm-8' });
  const raced = { get: (id) => (raced.won ? T0 + H : undefined), setIfAbsent: () => { raced.won = true; return false; } };
  assert.deepEqual(rr.recordSeen(raced, { req: r4, signatures: signed(r4), service, roster, isCancelled: () => false, destinationAllowed: () => true, now: T0 + 2 * H }), { ok: true, seenAt: T0 + H, first: false });
  assert.equal(rr.recordSeen({ get: () => undefined, setIfAbsent: () => 'yes' }, { req: r4, signatures: signed(r4), service, roster, isCancelled: () => false, destinationAllowed: () => true, now: T0 }).why, 'could not record when this request was first seen');
  const r3 = base({ member: 'm-7' });
  assert.equal(sight(r3, T0, { requester: signed(r3).requester }).why, 'the approver\'s signature does not verify', 'no sight, so no wait, before the approval exists');
  assert.equal(seen.has(rr.requestId(r3)), false);
  // Seen late, the request opens at seenAt + wait; its 7 days run from then, not from the earlier waitEndsAt.
  const late = T0 + 60 * H, opens = late + 72 * H;
  assert.ok(check(r1, { seenAt: late, now: opens + 7 * 24 * H }).ok, 'CONTROL: the last second of a window anchored where it opened');
  assert.equal(check(r1, { seenAt: late, now: opens + 7 * 24 * H + 1 }).why, 'the request expired (7 days after its wait)');
});

test('#5536 request: a signed request relayed long after its waitEndsAt is stale; break-glass may not wait longer than ordinary', () => {
  const req = base();  // waitEndsAt = T0 + 72 h
  // A slow approval: first fully signed sight 7 days after waitEndsAt still releases, a second later it is stale.
  const edge = T0 + 72 * H + 7 * 24 * H;
  assert.ok(check(req, { seenAt: edge, now: edge + 72 * H }).ok, 'CONTROL: the approver had until 7 days after waitEndsAt');
  assert.equal(check(req, { seenAt: edge + 1, now: edge + 73 * H }).why, 'the request was signed long before this service saw it');
  assert.equal(check(req, { seenAt: T0 + 365 * 24 * H, now: T0 + 365 * 24 * H + 72 * H }).why, 'the request was signed long before this service saw it', 'a year-old pair of signatures');
  assert.throws(() => check(req, { policy: { waitSeconds: 72 * H, breakGlassWaitSeconds: 73 * H } }), /no longer than waitSeconds/);
  const u8 = Object.fromEntries(Object.entries(signed(req)).map(([k, v]) => [k, new Uint8Array(v)]));
  assert.ok(check(req, { signatures: u8 }).ok, 'a Uint8Array signature is read as bytes, not reported as a forgery');
});

test('#5536 request: the service\'s answers must be exact booleans; a bad roster contact refuses; first sight applies the time bounds', () => {
  const req = base();
  for (const v of [Promise.resolve(false), 'yes', 1, {}]) {
    assert.equal(check(req, { destinationAllowed: () => v }).why, 'the destination is not one this service trusts for this member', `destinationAllowed -> ${typeof v}`);
  }
  for (const v of [undefined, null, Promise.resolve(false), 0]) {
    assert.equal(check(req, { isCancelled: () => v }).why, 'could not confirm the request is not cancelled', `isCancelled -> ${String(v)}`);
    assert.equal(check(req, { nonceUsed: () => v }).why, 'could not confirm the request is unused', `nonceUsed -> ${String(v)}`);
  }
  assert.ok(check(req, { isCancelled: () => false, nonceUsed: () => false, destinationAllowed: () => true }).ok, 'CONTROL');
  const bg = base({ breakGlass: true, contact: 'carol', waitEndsAt: T0 + 4 * H });
  const all = signed(bg, { requester: alice, approver: bob, contact: carol });
  assert.equal(check(bg, { roster: { ...roster, contact: { id: 'carol', pub: 'x' } }, signatures: all, now: T0 + 5 * H }).why, 'the roster\'s security contact has no public key');
  const idOnly = base({ breakGlass: true, contact: 'bob', waitEndsAt: T0 + 4 * H });
  const contactNamedBob = { ...roster, contact: { id: 'bob', pub: carol.publicKey } };
  assert.equal(check(idOnly, { roster: contactNamedBob, signatures: signed(idOnly, { requester: alice, approver: bob, contact: carol }), now: T0 + 5 * H }).why,
    'the security contact must be a third person', 'the contact\'s id matches an admin even though the keys differ');
  // The dormancy bound at its edge: waitEndsAt may be 169 h past first sight, not a second more.
  assert.ok(check(base({ waitEndsAt: T0 + 169 * H }), { now: T0 + 169 * H }).ok, 'CONTROL: exactly 169 h');
  assert.equal(check(base({ waitEndsAt: T0 + 169 * H + 1 }), { now: T0 + 170 * H }).why, 'the request\'s wait is longer than any policy allows');
  const st = storeOf(), seen = st.m;
  const stale = rr.recordSeen(st, { req, signatures: signed(req), service, roster, isCancelled: () => false, destinationAllowed: () => true, now: T0 + 72 * H + 7 * 24 * H + 1 });
  assert.deepEqual(stale, { ok: false, why: 'the request was signed long before this service saw it' });
  assert.equal(seen.size, 0, 'a request too stale to release is never recorded, so nobody is told of it');
  const long = base({ waitEndsAt: T0 + 169 * H + 1 });
  assert.equal(rr.recordSeen(st, { req: long, signatures: signed(long), service, roster, isCancelled: () => false, destinationAllowed: () => true, now: T0 }).why, 'the request\'s wait is longer than any policy allows');
  assert.equal(seen.size, 0, 'nor one whose wait is longer than any policy');
});

test('#5536 request: signatures are read once and any byte view counts; snapshots ids are unique; first sight checks the org too', () => {
  const req = base();
  const sigs = signed(req);
  const throwing = { get requester() { throw new Error('boom'); }, approver: sigs.approver };
  assert.equal(check(req, { signatures: throwing }).why, 'the signatures could not be read', 'refused, not thrown');
  const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
  assert.equal(check(req, { signatures: { requester: view(sigs.requester), approver: sigs.approver } }).why, 'the requester\'s signature does not verify', 'a DataView is not a byte array');
  const vm = require('vm');
  const foreign = (b) => vm.runInNewContext('new Uint8Array(b)', { b: [...b] });
  assert.ok(check(req, { signatures: { requester: foreign(sigs.requester), approver: foreign(sigs.approver) } }).ok, 'a Uint8Array from another realm is bytes');
  assert.throws(() => rr.requestBytes(base({ snapshots: ['s1', 's1'] })), /bad snapshots/);
  assert.throws(() => rr.requestBytes(base({ epochs: ['e2', 'e1'] })), /bad epochs/, 'lists are in ascending order, so one release has one requestId');
  assert.throws(() => rr.requestBytes(base({ snapshots: ['all'] })), /bad snapshots/, '"all" is reserved for the wildcard');
  const dead = base({ member: 'm-dead' }), st = storeOf();
  assert.equal(rr.recordSeen(st, { req: dead, signatures: signed(dead), service, roster, now: T0, isCancelled: () => true, destinationAllowed: () => true }).why, 'the request was cancelled');
  assert.equal(st.m.size, 0, 'a request cancelled before first sight is never recorded, so no member alarm');
  assert.equal(rr.recordSeen(st, { req: dead, signatures: signed(dead), service, roster, now: T0, isCancelled: () => false, destinationAllowed: () => false }).why,
    'the destination is not one this service trusts for this member');
  assert.equal(st.m.size, 0, 'nor one naming a destination the service does not trust');
  assert.throws(() => rr.recordSeen(st, { req: dead, signatures: signed(dead), service, roster, now: T0, isCancelled: () => false }), /isCancelled and destinationAllowed are required/);
  assert.equal(rr.recordSeen(st, { req: dead, signatures: signed(dead), service, roster, now: T0, isCancelled: () => undefined, destinationAllowed: () => true }).why, 'could not confirm the request is not cancelled');
  assert.throws(() => rr.recordSeen(st, { req: dead, signatures: signed(dead), service, roster, now: T0, destinationAllowed: () => true }), /isCancelled and destinationAllowed are required/);
  const lookalike = { ...roster, admins: new Map([['alice', { type: 'public', asymmetricKeyType: 'ed25519' }], ['bob', bob.publicKey]]) };
  assert.equal(check(req, { roster: lookalike }).why, 'the requester\'s signature does not verify', 'a roster value that only looks like a key is not one');
  // A polluted Object.prototype must not turn every ordinary request into a refusal.
  Object.prototype.contact = 'carol';
  try {
    assert.ok(check(req).ok, 'an inherited contact is not the request\'s own field');
    assert.match(check(base({ breakGlass: true, waitEndsAt: T0 + 4 * H }), { signatures: {} }).why, /bad contact/, 'nor does it stand in for a break-glass contact the signed bytes would not name');
  } finally { delete Object.prototype.contact; }
  const other = base({ org: 'globex' });
  assert.equal(rr.recordSeen(storeOf(), { req: other, signatures: signed(other), service, roster, isCancelled: () => false, destinationAllowed: () => true, now: T0 }).why, 'the request is for another org or unwrap service');
});

test('#5536 request: no release until the member was shown the request, and a late notice restarts the wait; the contact\'s id alone makes it a signer', () => {
  const req = base();
  for (const v of [null, undefined, false, 0, -5, Promise.resolve(T0), T0 + 74 * H]) {
    assert.equal(check(req, { noticeSentAt: () => v }).why, 'the member has not been shown the request', String(v));
  }
  const st = storeOf();
  assert.equal(rr.recordSeen(st, { req, signatures: signed(req), service, roster, now: T0, isCancelled: () => false, destinationAllowed: () => true }).first, true);
  // The notice was lost (a crash after first: true). A second sight is not first, so the caller must retry the notice:
  assert.equal(rr.recordSeen(st, { req, signatures: signed(req), service, roster, now: T0 + 1, isCancelled: () => false, destinationAllowed: () => true }).first, false);
  assert.equal(check(req, { seen: st, noticeSentAt: () => null }).why, 'the member has not been shown the request', 'a lost notice delays the release');
  // Sent 60 h late, the member still gets the full 72 h from the notice.
  assert.equal(check(req, { seen: st, noticeSentAt: () => T0 + 60 * H, now: T0 + 131 * H }).why, 'the wait has not ended', 'the wait runs from the notice');
  assert.ok(check(req, { seen: st, noticeSentAt: () => T0 + 60 * H, now: T0 + 132 * H }).ok, 'CONTROL: 72 h after the notice');
  assert.ok(check(req, { seen: st, noticeSentAt: () => T0 + 7 * 24 * H, now: T0 + 7 * 24 * H + 72 * H }).ok, 'CONTROL: a notice exactly 7 days after first sight');
  assert.equal(check(req, { seen: st, noticeSentAt: () => T0 + 7 * 24 * H + 1, now: T0 + 7 * 24 * H + 80 * H }).why, 'the member was shown the request too late; make a new request');
  assert.equal(check(req, { seen: { get: () => Promise.resolve(T0) } }).why, 'could not read when this request was first seen', 'an async store read at release refuses');
  const junkRoster = { admins: new Map([...roster.admins, ['z', { equals() { return false; } }]]), contact: roster.contact };
  const bgJ = base({ breakGlass: true, contact: 'carol', waitEndsAt: T0 + 4 * H });
  assert.ok(check(bgJ, { roster: junkRoster, signatures: signed(bgJ, { requester: alice, approver: bob, contact: carol }), now: T0 + 5 * H }).ok, 'a roster entry that is not a key is skipped, not thrown on');
  assert.throws(() => check(req, { noticeSentAt: undefined }), /noticeSentAt are required/);
  // The id arm on its own: the contact is named 'alice' (the requester) but holds carol's key.
  const bg = base({ breakGlass: true, contact: 'alice', waitEndsAt: T0 + 4 * H });
  const contactAliceId = { ...roster, contact: { id: 'alice', pub: carol.publicKey } };
  assert.equal(check(bg, { roster: contactAliceId, signatures: signed(bg, { requester: alice, approver: bob, contact: carol }), now: T0 + 5 * H }).why,
    'the security contact must be a third person');
  const s8 = signed(req);
  assert.equal(check(req, { signatures: { requester: new Int8Array(s8.requester), approver: s8.approver } }).why, 'the requester\'s signature does not verify', 'signatures are Uint8Array bytes');
});
