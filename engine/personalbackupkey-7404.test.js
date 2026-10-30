'use strict';
/**
 * kosmos#7404 step 3 (end to end): engine/personalbackupkey.js sets up a personal backup's key and restores it with
 * the recovery code, against a fake coordinator that applies the personal member-key rules (kosmos-relay
 * docs/coordinator-api.md): it keeps the KBR1 wrap, the recovery public key and the binding tag, never opens anything,
 * and answers member-key/mine with { org, member, keys }. One fake plays a coordinator that FORGES a key.
 *
 *   node --test engine/personalbackupkey-7404.test.js
 */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-personalkey-7404-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const backupkeys = require('./backupkeys');
const mk = require('./backupmemberkey');
const pk = require('./personalbackupkey');

const ORG = 'porg1', MEMBER = 'pacct1';
const WHO = { org: ORG, member: MEMBER };
const b64 = (b) => Buffer.from(b).toString('base64url');
const refuse = (status, code, because) => ({ ok: false, because, refusal: { status, code, currentEpoch: null } });

function fakeCoordinator() {
  const rows = new Map();   // epoch -> { member_public, wrap, recovery_public, recovery_tag }
  const calls = [];
  const state = { hideRowsOnce: false };   // an in-flight race: the next mine read does not see a row it already kept
  const macRequest = async (method, route, body) => {
    calls.push({ route, body });
    if (route === pk.MINE_ROUTE && state.hideRowsOnce) { state.hideRowsOnce = false; return { ok: true, data: { org: ORG, member: MEMBER, keys: [] } }; }
    if (route === pk.MINE_ROUTE) {
      const keys = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([epoch, r]) => ({ epoch, ...r }));
      return { ok: true, data: { org: ORG, member: MEMBER, keys } };
    }
    if (route !== mk.MEMBER_KEY_ROUTE) return { ok: false, because: 'no such route' };
    // The coordinator's shape checks for a personal account: KBR1, a recovery key, a 64-hex tag.
    const wrap = Buffer.from(body.wrap, 'base64url');
    if (!wrap.subarray(0, 4).equals(Buffer.from('KBR1')) || wrap.length !== 84) return refuse(400, 'bad_member_key', 'not KBR1');
    if (!/^[0-9a-f]{64}$/.test(String(body.recovery_tag))) return refuse(400, 'bad_member_key', 'no tag');
    if (Buffer.from(body.recovery_public, 'base64url').length !== 32) return refuse(400, 'bad_member_key', 'no recovery key');
    const had = rows.get(body.epoch);
    if (had) {
      return had.member_public === body.member_public && had.recovery_public === body.recovery_public && had.recovery_tag === body.recovery_tag
        ? { ok: true, data: { epoch: body.epoch, member_public: had.member_public } } : refuse(409, 'member_key_exists', 'another key');
    }
    rows.set(body.epoch, { member_public: body.member_public, wrap: body.wrap, recovery_public: body.recovery_public, recovery_tag: body.recovery_tag });
    return { ok: true, data: { epoch: body.epoch, member_public: body.member_public } };
  };
  return { macRequest, rows, calls, state };
}

// The key folder is under store.ROOT (<data>/Kosmos), not the data root itself.
function forget() { fs.rmSync(path.join(require('./store').ROOT, 'backupkeys'), { recursive: true, force: true }); }
function allFileText(dir) {
  let out = '';
  for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const p = path.join(dir, e.name);
    out += e.isDirectory() ? allFileText(p) : fs.readFileSync(p, 'utf8');
  }
  return out;
}

test('#7404: setUp registers a KBR1 wrap with the recovery key and tag, keeps the key, and answers the code once', async () => {
  forget();
  const c = fakeCoordinator();
  const r = await pk.setUpPersonalKey({ macRequest: c.macRequest });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.code, /^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{2}$/);
  const row = c.rows.get(1);
  assert.ok(row, 'epoch 1 was registered');
  const rk = backupkeys.recoveryKeysFromCode(r.code);
  assert.equal(row.recovery_public, b64(rk.pk), 'the recovery key is the code\'s');
  const kept = mk.readKeys(ORG, MEMBER);
  assert.ok(kept.ok && kept.keys['1'] && kept.keys['1'].registered, 'the key is kept, registered');
  assert.equal(row.member_public, b64(kept.keys['1'].pk));
  // The code opens what was registered, with its tag.
  const opened = backupkeys.unwrapMemberKeyFromRecovery(rk, Buffer.from(row.wrap, 'base64url'), { org: ORG, member: MEMBER, epoch: '1' }, kept.keys['1'].pk, row.recovery_tag);
  assert.ok(opened && opened.equals(kept.keys['1'].sk));
  // Until the person confirms they saved it, this computer keeps the code (review 1: a lost answer or a crash before
  // the screen must not strand a code nobody saw). After the confirm, no form of it, or of its keys, is on disk.
  const forms = (code) => {
    const bytes = backupkeys.recoveryCodeBytes(code), k = backupkeys.recoveryKeysFromCode(code);
    return [code, code.replace(/-/g, ''), b64(bytes), bytes.toString('hex'), b64(k.sk), k.sk.toString('hex'), b64(k.authKey), k.authKey.toString('hex')];
  };
  const before = allFileText(SANDBOX);
  assert.ok(before.includes(b64(backupkeys.recoveryCodeBytes(r.code))), 'CONTROL: the pending code is kept until confirmed');
  assert.equal((await pk.confirmRecoveryCodeSaved(WHO)).ok, true);
  const after = allFileText(SANDBOX);
  assert.ok(after.length > 0, 'CONTROL: the data root still holds the key file');
  for (const form of forms(r.code)) assert.ok(!after.includes(form), 'a form of the recovery code is still on disk: ' + form.slice(0, 8));
});

test('#7404 (review 1, the BLOCKER): an answer lost AFTER Kosmos+ kept the key: the retry answers the SAME code and finishes', async () => {
  forget();
  const c = fakeCoordinator();
  let lose = true;
  // The coordinator KEEPS the row, then the answer never arrives.
  const lossy = async (m, route, body) => {
    const res = await c.macRequest(m, route, body);
    if (route === mk.MEMBER_KEY_ROUTE && lose) { lose = false; throw new Error('connection reset after the write'); }
    return res;
  };
  const first = await pk.setUpPersonalKey({ macRequest: lossy });
  assert.equal(first.ok, false);
  assert.equal(c.rows.size, 1, 'CONTROL: Kosmos+ did keep the row');
  const second = await pk.setUpPersonalKey({ macRequest: lossy });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.resumed, true);
  // The code it answers really opens what Kosmos+ kept (the person can restore with it).
  forget();
  const back = await pk.restorePersonalKey(second.code, { macRequest: c.macRequest });
  assert.equal(back.ok, true, 'the code answered on the retry restores the kept key');
});

test('#7404 (review 1): setUp never replaces or buries a registered key, and leaves the file readable', async () => {
  // (a) a registered epoch 1 here, Kosmos+ lists none (a reset): refused, the key kept.
  forget();
  const k1 = backupkeys.newMemberKey();
  mk.writeKeys(ORG, MEMBER, { 1: { sk: k1.sk, pk: k1.pk, registered: true } });
  const a = await pk.setUpPersonalKey({ macRequest: fakeCoordinator().macRequest });
  assert.equal(a.ok, false);
  const ka = mk.readKeys(ORG, MEMBER);
  assert.ok(ka.ok && ka.keys['1'].sk.equals(k1.sk) && ka.keys['1'].registered, 'the registered key was replaced');
  // (b) a registered epoch 2 here: refused, nothing written below it, the file still reads.
  forget();
  const k2 = backupkeys.newMemberKey();
  mk.writeKeys(ORG, MEMBER, { 2: { sk: k2.sk, pk: k2.pk, registered: true } });
  const b = await pk.setUpPersonalKey({ macRequest: fakeCoordinator().macRequest });
  assert.equal(b.ok, false);
  const kb = mk.readKeys(ORG, MEMBER);
  assert.ok(kb.ok, 'the key file no longer reads');
  assert.deepEqual(Object.keys(kb.keys), ['2']);
});

test('#7404: on a new computer, restore with the code gets back the SAME key; a wrong code gets nothing', async () => {
  forget();
  const c = fakeCoordinator();
  const set = await pk.setUpPersonalKey({ macRequest: c.macRequest });
  const original = mk.readKeys(ORG, MEMBER).keys['1'];
  forget();   // the new computer has no key file

  const wrong = await pk.restorePersonalKey(backupkeys.newRecoveryCode(), { macRequest: c.macRequest });
  assert.equal(wrong.ok, false); assert.equal(wrong.code, 'wrong_code');
  assert.deepEqual(mk.readKeys(ORG, MEMBER).keys, {}, 'a wrong code wrote nothing');

  const r = await pk.restorePersonalKey(set.code.toLowerCase().replace(/-/g, ' '), { macRequest: c.macRequest });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.epochs, [1]);
  const back = mk.readKeys(ORG, MEMBER).keys['1'];
  assert.ok(back && back.sk.equals(original.sk) && back.pk.equals(original.pk) && back.registered);
});

test('#7404: a coordinator that FORGES a key (its own, wrapped to the person\'s recovery key) is refused, and nothing is restored', async () => {
  forget();
  const c = fakeCoordinator();
  const set = await pk.setUpPersonalKey({ macRequest: c.macRequest });
  forget();
  // It holds the recovery PUBLIC key, so it can wrap a key of its own that the code really opens. It cannot make the
  // tag (that needs the code), so it keeps the person's real tag beside its forged key.
  const row = c.rows.get(1);
  const forged = backupkeys.newMemberKey();
  const recoveryPk = Buffer.from(row.recovery_public, 'base64url');
  c.rows.set(1, { ...row, member_public: b64(forged.pk),
    wrap: b64(backupkeys.wrapMemberKeyToRecovery(forged.sk, recoveryPk, { org: ORG, member: MEMBER, epoch: '1' })) });
  const r = await pk.restorePersonalKey(set.code, { macRequest: c.macRequest });
  assert.equal(r.ok, false); assert.equal(r.code, 'not_bound');
  assert.deepEqual(mk.readKeys(ORG, MEMBER).keys, {}, 'the forged key was kept');
});

test('#7404: one bad row refuses the WHOLE restore (never half a backup), and a withheld tag fails closed', async () => {
  forget();
  const c = fakeCoordinator();
  const set = await pk.setUpPersonalKey({ macRequest: c.macRequest });
  // A second epoch the code holder made (good), then epoch 1's tag withheld: the restore must keep neither.
  const rk = backupkeys.recoveryKeysFromCode(set.code);
  const k2 = backupkeys.newMemberKey(), ctx2 = { org: ORG, member: MEMBER, epoch: '2' };
  c.rows.set(2, { member_public: b64(k2.pk), wrap: b64(backupkeys.wrapMemberKeyToRecovery(k2.sk, rk.pk, ctx2)),
    recovery_public: b64(rk.pk), recovery_tag: backupkeys.recoveryBindingTag(rk.authKey, ctx2, k2.pk) });
  forget();
  const good = await pk.restorePersonalKey(set.code, { macRequest: c.macRequest });
  assert.equal(good.ok, true, 'CONTROL: both rows restore with their tags');
  assert.deepEqual(good.epochs, [1, 2]);
  forget();
  c.rows.set(1, { ...c.rows.get(1), recovery_tag: '0'.repeat(64) });   // corrupted
  const bad = await pk.restorePersonalKey(set.code, { macRequest: c.macRequest });
  assert.equal(bad.ok, false); assert.equal(bad.code, 'not_bound');
  assert.deepEqual(mk.readKeys(ORG, MEMBER).keys, {}, 'epoch 2 was kept although epoch 1 failed');
  c.rows.set(1, { ...c.rows.get(1), recovery_tag: null });   // withheld entirely
  const none = await pk.restorePersonalKey(set.code, { macRequest: c.macRequest });
  assert.equal(none.ok, false);
  assert.deepEqual(mk.readKeys(ORG, MEMBER).keys, {});
});

test('#7404: setUp refuses when the backup already has a key, and restore refuses a non-code or an empty backup', async () => {
  forget();
  const c = fakeCoordinator();
  assert.equal((await pk.setUpPersonalKey({ macRequest: c.macRequest })).ok, true);
  // Confirmed first: until then a second setUp resumes with the same code (review 2's test above).
  assert.equal((await pk.confirmRecoveryCodeSaved(WHO)).ok, true);
  const again = await pk.setUpPersonalKey({ macRequest: c.macRequest });
  assert.equal(again.ok, false);
  // Refused at the first fence it meets: this computer already holds the registered key (review 1's file guard).
  assert.match(again.because, /already (has a recovery code|holds backup keys)/);
  assert.equal(c.rows.size, 1, 'no second key was registered');
  assert.equal((await pk.restorePersonalKey('not a code', { macRequest: c.macRequest })).code, 'not_a_code');
  assert.equal((await pk.restorePersonalKey(backupkeys.newRecoveryCode(), { macRequest: fakeCoordinator().macRequest })).code, 'no_keys');
});

test('#7404: an answer lost BEFORE Kosmos+ saw it: the retry sends the SAME member key and the same code', async () => {
  forget();
  const c = fakeCoordinator();
  let fail = true;
  const flaky = async (m, route, body) => {
    if (route === mk.MEMBER_KEY_ROUTE && fail) { fail = false; throw new Error('connection reset'); }
    return c.macRequest(m, route, body);
  };
  const first = await pk.setUpPersonalKey({ macRequest: flaky });
  assert.equal(first.ok, false);
  const pending = mk.readKeys(ORG, MEMBER).keys['1'];
  assert.ok(pending && !pending.registered, 'the key was kept BEFORE it was sent');
  const second = await pk.setUpPersonalKey({ macRequest: flaky });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(c.rows.get(1).member_public, b64(pending.pk), 'the retry sent the key it had kept');
  assert.ok(mk.readKeys(ORG, MEMBER).keys['1'].registered);
});

test('#7404: the coordinator\'s refusal code is passed on (here: the switch is off)', async () => {
  forget();
  const off = async (m, route) => (route === pk.MINE_ROUTE
    ? refuse(409, 'personal_backup_key_pending', 'off') : { ok: false, because: 'unreached' });
  const r = await pk.setUpPersonalKey({ macRequest: off });
  assert.equal(r.ok, false); assert.equal(r.code, 'personal_backup_key_pending');
  const r2 = await pk.restorePersonalKey(backupkeys.newRecoveryCode(), { macRequest: off });
  assert.equal(r2.code, 'personal_backup_key_pending');
});

test('#7404 (review 2): a crash AFTER a successful setUp, before the screen showed the code: setUp answers the same code until confirmed', async () => {
  forget();
  const c = fakeCoordinator();
  const first = await pk.setUpPersonalKey({ macRequest: c.macRequest });
  assert.equal(first.ok, true);
  // The screen never showed it: setUp again answers the SAME code (not "already holds backup keys").
  const again = await pk.setUpPersonalKey({ macRequest: c.macRequest });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.resumed, true); assert.equal(again.code, first.code);
  // Once confirmed, the code is gone and setUp refuses.
  const conf = await pk.confirmRecoveryCodeSaved(WHO);
  assert.equal(conf.ok, true); assert.equal(conf.deleted, 1);
  const after = await pk.setUpPersonalKey({ macRequest: c.macRequest });
  assert.equal(after.ok, false);
});

test('#7404 (review 2): a kept row the pending code cannot restore (no tag) is never answered as set up', async () => {
  forget();
  const c = fakeCoordinator();
  let lose = true;
  const lossy = async (m, route, body) => {
    const res = await c.macRequest(m, route, body);
    if (route === mk.MEMBER_KEY_ROUTE && lose) { lose = false; throw new Error('lost after the write'); }
    return res;
  };
  assert.equal((await pk.setUpPersonalKey({ macRequest: lossy })).ok, false);
  c.rows.set(1, { ...c.rows.get(1), recovery_tag: null });   // Kosmos+ withholds the tag
  const r = await pk.setUpPersonalKey({ macRequest: lossy });
  assert.equal(r.ok, false, 'a row the code cannot restore was answered as set up');
  assert.match(r.because, /does not open/);
});

test('#7404 (review 2): an "ok" that does not name this key and epoch is not taken as registered', async () => {
  forget();
  const c = fakeCoordinator();
  const odd = async (m, route, body) => (route === mk.MEMBER_KEY_ROUTE ? { ok: true, data: { epoch: 1 } } : c.macRequest(m, route, body));
  const r = await pk.setUpPersonalKey({ macRequest: odd });
  assert.equal(r.ok, false);
  const k = mk.readKeys(ORG, MEMBER).keys['1'];
  assert.ok(k && !k.registered, 'an unconfirmed answer marked the key registered');
});

test('#7404 (review 2): restore never replaces a registered key here, and keeps one Kosmos+ does not list', async () => {
  forget();
  const c = fakeCoordinator();
  const set = await pk.setUpPersonalKey({ macRequest: c.macRequest });
  // A DIFFERENT registered key at epoch 1 here: refused, the file untouched.
  const other = backupkeys.newMemberKey();
  mk.writeKeys(ORG, MEMBER, { 1: { sk: other.sk, pk: other.pk, registered: true } });
  const r = await pk.restorePersonalKey(set.code, { macRequest: c.macRequest });
  assert.equal(r.ok, false); assert.equal(r.code, 'key_conflict');
  assert.ok(mk.readKeys(ORG, MEMBER).keys['1'].sk.equals(other.sk), 'the registered key was replaced');
  // A registered key at an epoch Kosmos+ does not list is kept beside the restored one.
  const k5 = backupkeys.newMemberKey();
  mk.writeKeys(ORG, MEMBER, { 5: { sk: k5.sk, pk: k5.pk, registered: true } });
  const ok = await pk.restorePersonalKey(set.code, { macRequest: c.macRequest });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const keys = mk.readKeys(ORG, MEMBER).keys;
  assert.ok(keys['5'] && keys['5'].sk.equals(k5.sk) && keys['1'] && keys['1'].registered);
});

test('#7404 (review 2): confirm keeps a code that is not registered yet, and needs no network', async () => {
  forget();
  const c = fakeCoordinator();
  let lose = true;
  const lossy = async (m, route, body) => {
    const res = await c.macRequest(m, route, body);
    if (route === mk.MEMBER_KEY_ROUTE && lose) { lose = false; throw new Error('lost after the write'); }
    return res;
  };
  assert.equal((await pk.setUpPersonalKey({ macRequest: lossy })).ok, false);
  const before = allFileText(SANDBOX);
  const conf = await pk.confirmRecoveryCodeSaved(WHO);   // no macRequest at all: local only
  assert.equal(conf.ok, false, 'a pending, unregistered code was confirmed away');
  assert.equal(allFileText(SANDBOX), before, 'confirm changed files while the code was pending');
  const resumed = await pk.setUpPersonalKey({ macRequest: lossy });
  assert.equal(resumed.ok, true, 'the kept code still finishes the setup');
  // Review 3: the resume registers the key here, so confirm can then delete the code.
  assert.ok(mk.readKeys(ORG, MEMBER).keys['1'].registered, 'the resume did not register the key');
  assert.deepEqual(await pk.confirmRecoveryCodeSaved(WHO), { ok: true, deleted: 1 });
});

test('#7404 (review 2): the in-flight race (Kosmos+ kept it, the next read does not show it yet): the retry sends the same recovery key and tag', async () => {
  forget();
  const c = fakeCoordinator();
  let lose = true;
  const lossy = async (m, route, body) => {
    const res = await c.macRequest(m, route, body);
    if (route === mk.MEMBER_KEY_ROUTE && lose) { lose = false; c.state.hideRowsOnce = true; throw new Error('lost after the write'); }
    return res;
  };
  assert.equal((await pk.setUpPersonalKey({ macRequest: lossy })).ok, false);
  const firstPost = c.calls.filter((x) => x.route === mk.MEMBER_KEY_ROUTE)[0].body;
  const second = await pk.setUpPersonalKey({ macRequest: lossy });
  assert.equal(second.ok, true, JSON.stringify(second));
  const secondPost = c.calls.filter((x) => x.route === mk.MEMBER_KEY_ROUTE)[1].body;
  assert.equal(secondPost.recovery_public, firstPost.recovery_public, 'the retry used another code');
  assert.equal(secondPost.recovery_tag, firstPost.recovery_tag);
  assert.equal(secondPost.member_public, firstPost.member_public);
});

const pendingFiles = () => { try { return fs.readdirSync(path.join(require('./store').ROOT, 'backupkeys')).filter((n) => n.startsWith('pending-code-')); } catch { return []; } };

test('#7404 (review 3): a pending code file that cannot be read is refused and left as it is, never overwritten', async () => {
  forget();
  const c = fakeCoordinator();
  let lose = true;
  const lossy = async (m, route, body) => {
    const res = await c.macRequest(m, route, body);
    if (route === mk.MEMBER_KEY_ROUTE && lose) { lose = false; c.state.hideRowsOnce = true; throw new Error('lost after the write'); }
    return res;
  };
  assert.equal((await pk.setUpPersonalKey({ macRequest: lossy })).ok, false);
  const f = path.join(require('./store').ROOT, 'backupkeys', pendingFiles()[0]);
  const before = fs.readFileSync(f, 'utf8');
  fs.chmodSync(f, 0o000);   // a passing read error
  try {
    const r = await pk.setUpPersonalKey({ macRequest: lossy });
    assert.equal(r.ok, false); assert.match(r.because, /could not be read/);
  } finally { fs.chmodSync(f, 0o600); }
  assert.equal(fs.readFileSync(f, 'utf8'), before, 'the pending code was overwritten');
});

test('#7404 (review 3): a restore deletes this computer\'s pending code, including a dead one from a failed setUp under another code', async () => {
  forget();
  const c = fakeCoordinator();
  // This computer's setUp is refused (a 503), leaving its pending key and code A.
  const down = async (m, route, body) => (route === mk.MEMBER_KEY_ROUTE ? refuse(503, 'escrow_unavailable', 'down') : c.macRequest(m, route, body));
  assert.equal((await pk.setUpPersonalKey({ macRequest: down })).ok, false);
  assert.equal(pendingFiles().length, 1, 'CONTROL: code A is pending');
  // Another computer sets up with code B (its own key folder: code A's file is set aside, then put back), and this
  // one restores with B while code A's dead file is on disk (review 4: the case must exist when restore runs).
  const dir = path.join(require('./store').ROOT, 'backupkeys');
  const aName = pendingFiles()[0], aBody = fs.readFileSync(path.join(dir, aName));
  forget();
  const other = await pk.setUpPersonalKey({ macRequest: c.macRequest });
  forget();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, aName), aBody, { mode: 0o600 });
  assert.deepEqual(pendingFiles(), [aName], 'CONTROL: code A\'s dead file is on disk when the restore runs');
  const r = await pk.restorePersonalKey(other.code, { macRequest: c.macRequest });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(pendingFiles(), [], 'a pending code survived a successful restore');
  assert.deepEqual(await pk.confirmRecoveryCodeSaved(WHO), { ok: true, deleted: 0 });
});

test('#7404 (review 3): the success path checks the row Kosmos+ STORED: a dropped tag is caught while the key and code are still here', async () => {
  forget();
  const c = fakeCoordinator();
  const dropsTag = async (m, route, body) => {
    const res = await c.macRequest(m, route, body);
    if (route === mk.MEMBER_KEY_ROUTE && res.ok) c.rows.set(1, { ...c.rows.get(1), recovery_tag: null });
    return res;
  };
  const r = await pk.setUpPersonalKey({ macRequest: dropsTag });
  assert.equal(r.ok, false, 'a stored row the code cannot restore was answered as set up');
  const k = mk.readKeys(ORG, MEMBER).keys['1'];
  assert.ok(k && !k.registered, 'the key was marked registered');
  assert.equal(pendingFiles().length, 1, 'the code was not kept');
});

test('#7404 (review 3): Kosmos+ lost the rows while this computer holds the key and its code: setUp re-sends the same registration', async () => {
  forget();
  const c = fakeCoordinator();
  const first = await pk.setUpPersonalKey({ macRequest: c.macRequest });
  assert.equal(first.ok, true);
  const sent = c.calls.filter((x) => x.route === mk.MEMBER_KEY_ROUTE)[0].body;
  c.rows.clear();   // lost on Kosmos+'s side, before the person confirmed
  const healed = await pk.setUpPersonalKey({ macRequest: c.macRequest });
  assert.equal(healed.ok, true, JSON.stringify(healed));
  assert.equal(healed.code, first.code);
  assert.equal(c.rows.get(1).member_public, sent.member_public);
  assert.equal(c.rows.get(1).recovery_tag, sent.recovery_tag);
});
