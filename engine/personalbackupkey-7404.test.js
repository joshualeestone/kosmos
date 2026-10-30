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
const b64 = (b) => Buffer.from(b).toString('base64url');
const refuse = (status, code, because) => ({ ok: false, because, refusal: { status, code, currentEpoch: null } });

function fakeCoordinator() {
  const rows = new Map();   // epoch -> { member_public, wrap, recovery_public, recovery_tag }
  const calls = [];
  const macRequest = async (method, route, body) => {
    calls.push({ route, body });
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
        ? { ok: true, data: { epoch: body.epoch } } : refuse(409, 'member_key_exists', 'another key');
    }
    rows.set(body.epoch, { member_public: body.member_public, wrap: body.wrap, recovery_public: body.recovery_public, recovery_tag: body.recovery_tag });
    return { ok: true, data: { epoch: body.epoch } };
  };
  return { macRequest, rows, calls };
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
  const r = await pk.setUp({ macRequest: c.macRequest });
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
  // The code itself is written nowhere this module touches (every file under the data root).
  const text = allFileText(SANDBOX);
  assert.ok(text.length > 0, 'CONTROL: the data root holds the key file');
  for (const form of [r.code, r.code.replace(/-/g, '')]) assert.ok(!text.includes(form), 'the recovery code was written to disk');
});

test('#7404: on a new computer, restore with the code gets back the SAME key; a wrong code gets nothing', async () => {
  forget();
  const c = fakeCoordinator();
  const set = await pk.setUp({ macRequest: c.macRequest });
  const original = mk.readKeys(ORG, MEMBER).keys['1'];
  forget();   // the new computer has no key file

  const wrong = await pk.restore(backupkeys.newRecoveryCode(), { macRequest: c.macRequest });
  assert.equal(wrong.ok, false); assert.equal(wrong.code, 'wrong_code');
  assert.deepEqual(mk.readKeys(ORG, MEMBER).keys, {}, 'a wrong code wrote nothing');

  const r = await pk.restore(set.code.toLowerCase().replace(/-/g, ' '), { macRequest: c.macRequest });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.epochs, [1]);
  const back = mk.readKeys(ORG, MEMBER).keys['1'];
  assert.ok(back && back.sk.equals(original.sk) && back.pk.equals(original.pk) && back.registered);
});

test('#7404: a coordinator that FORGES a key (its own, wrapped to the person\'s recovery key) is refused, and nothing is restored', async () => {
  forget();
  const c = fakeCoordinator();
  const set = await pk.setUp({ macRequest: c.macRequest });
  forget();
  // It holds the recovery PUBLIC key, so it can wrap a key of its own that the code really opens. It cannot make the
  // tag (that needs the code), so it keeps the person's real tag beside its forged key.
  const row = c.rows.get(1);
  const forged = backupkeys.newMemberKey();
  const recoveryPk = Buffer.from(row.recovery_public, 'base64url');
  c.rows.set(1, { ...row, member_public: b64(forged.pk),
    wrap: b64(backupkeys.wrapMemberKeyToRecovery(forged.sk, recoveryPk, { org: ORG, member: MEMBER, epoch: '1' })) });
  const r = await pk.restore(set.code, { macRequest: c.macRequest });
  assert.equal(r.ok, false); assert.equal(r.code, 'not_bound');
  assert.deepEqual(mk.readKeys(ORG, MEMBER).keys, {}, 'the forged key was kept');
});

test('#7404: one bad row refuses the WHOLE restore (never half a backup), and a withheld tag fails closed', async () => {
  forget();
  const c = fakeCoordinator();
  const set = await pk.setUp({ macRequest: c.macRequest });
  // A second epoch the code holder made (good), then epoch 1's tag withheld: the restore must keep neither.
  const rk = backupkeys.recoveryKeysFromCode(set.code);
  const k2 = backupkeys.newMemberKey(), ctx2 = { org: ORG, member: MEMBER, epoch: '2' };
  c.rows.set(2, { member_public: b64(k2.pk), wrap: b64(backupkeys.wrapMemberKeyToRecovery(k2.sk, rk.pk, ctx2)),
    recovery_public: b64(rk.pk), recovery_tag: backupkeys.recoveryBindingTag(rk.authKey, ctx2, k2.pk) });
  forget();
  const good = await pk.restore(set.code, { macRequest: c.macRequest });
  assert.equal(good.ok, true, 'CONTROL: both rows restore with their tags');
  assert.deepEqual(good.epochs, [1, 2]);
  forget();
  c.rows.set(1, { ...c.rows.get(1), recovery_tag: '0'.repeat(64) });   // corrupted
  const bad = await pk.restore(set.code, { macRequest: c.macRequest });
  assert.equal(bad.ok, false); assert.equal(bad.code, 'not_bound');
  assert.deepEqual(mk.readKeys(ORG, MEMBER).keys, {}, 'epoch 2 was kept although epoch 1 failed');
  c.rows.set(1, { ...c.rows.get(1), recovery_tag: null });   // withheld entirely
  const none = await pk.restore(set.code, { macRequest: c.macRequest });
  assert.equal(none.ok, false);
  assert.deepEqual(mk.readKeys(ORG, MEMBER).keys, {});
});

test('#7404: setUp refuses when the backup already has a key, and restore refuses a non-code or an empty backup', async () => {
  forget();
  const c = fakeCoordinator();
  assert.equal((await pk.setUp({ macRequest: c.macRequest })).ok, true);
  const again = await pk.setUp({ macRequest: c.macRequest });
  assert.equal(again.ok, false);
  assert.match(again.because, /already has a recovery code/);
  assert.equal(c.rows.size, 1, 'no second key was registered');
  assert.equal((await pk.restore('not a code', { macRequest: c.macRequest })).code, 'not_a_code');
  assert.equal((await pk.restore(backupkeys.newRecoveryCode(), { macRequest: fakeCoordinator().macRequest })).code, 'no_keys');
});

test('#7404: an answer lost after the key was kept: the retry sends the SAME member key, with a new code', async () => {
  forget();
  const c = fakeCoordinator();
  let fail = true;
  const flaky = async (m, route, body) => {
    if (route === mk.MEMBER_KEY_ROUTE && fail) { fail = false; throw new Error('connection reset'); }
    return c.macRequest(m, route, body);
  };
  const first = await pk.setUp({ macRequest: flaky });
  assert.equal(first.ok, false);
  const pending = mk.readKeys(ORG, MEMBER).keys['1'];
  assert.ok(pending && !pending.registered, 'the key was kept BEFORE it was sent');
  const second = await pk.setUp({ macRequest: flaky });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(c.rows.get(1).member_public, b64(pending.pk), 'the retry sent the key it had kept');
  assert.ok(mk.readKeys(ORG, MEMBER).keys['1'].registered);
});

test('#7404: the coordinator\'s refusal code is passed on (here: the switch is off)', async () => {
  forget();
  const off = async (m, route) => (route === pk.MINE_ROUTE
    ? refuse(409, 'personal_backup_key_pending', 'off') : { ok: false, because: 'unreached' });
  const r = await pk.setUp({ macRequest: off });
  assert.equal(r.ok, false); assert.equal(r.code, 'personal_backup_key_pending');
  const r2 = await pk.restore(backupkeys.newRecoveryCode(), { macRequest: off });
  assert.equal(r2.code, 'personal_backup_key_pending');
});
