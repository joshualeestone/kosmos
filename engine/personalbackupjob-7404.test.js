'use strict';
/**
 * kosmos#7404 (pbjob-7404): the personal backup job. Each test is one thing the job promises:
 *   - the key step only reads, and answers a key only for this record's org, when this computer holds what Kosmos+ lists;
 *   - mayBackUp needs every condition, each shown false alone with a control that reads true;
 *   - a real backuprun seals to the personal key, under the pair Kosmos+ named;
 *   - Kosmos+ refusing the words stops later runs; any other refusal does not;
 *   - the tick names itself, and the board's own tick stays idle here.
 *
 *   node --test engine/personalbackupjob-7404.test.js
 */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pbjob-7404-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
delete process.env.KOSMOS_PERSONAL_BACKUP;
const backupkeys = require('./backupkeys');
const mk = require('./backupmemberkey');
const pk = require('./personalbackupkey');
const pb = require('./personalbackup');
const backuprun = require('./backuprun');
const tick = require('./backuptick');

const b64 = (b) => Buffer.from(b).toString('base64url');
let seq = 0;
const newPair = () => { seq += 1; return { org: 'porg' + seq, member: 'pacct' + seq }; };

/* A pair with a registered epoch-1 key here, and what member-key/mine answers for it. */
function keyed(pair) {
  const key = backupkeys.newMemberKey();
  mk.writeKeys(pair.org, pair.member, { 1: { sk: key.sk, pk: key.pk, registered: true } });
  const row = { epoch: 1, member_public: b64(key.pk), wrap: b64(Buffer.from('KBR1wrap')), recovery_public: b64(Buffer.alloc(32, 7)), recovery_tag: 'a'.repeat(64) };
  return { key, row };
}
function kosmosPlus(data) {
  const calls = [];
  return { calls, macRequest: async (m, route, body) => { calls.push({ route, body }); return route === pk.MINE_ROUTE ? { ok: true, data } : { ok: false, because: 'no such route' }; } };
}

test('the key step answers the key Kosmos+ lists, and sends nothing but the read', async () => {
  const pair = newPair();
  const { key, row } = keyed(pair);
  const k = kosmosPlus({ ...pair, keys: [row] });
  const r = await pk.personalKeyForJob(pair.org, { macRequest: k.macRequest });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.epoch, 1);
  assert.deepEqual([r.org, r.member], [pair.org, pair.member]);
  assert.ok(r.publicKey.equals(key.pk));
  assert.equal(r.sk, undefined, 'sealing needs the public key alone');
  assert.deepEqual(k.calls.map((c) => c.route), [pk.MINE_ROUTE]);
});

test('the key step refuses another org, no key, a key this computer does not hold, and a lost epoch', async () => {
  const pair = newPair();
  const { row } = keyed(pair);
  const ask = (orgId, keys, extra = {}, who = pair) => pk.personalKeyForJob(orgId, { macRequest: kosmosPlus({ ...who, keys }).macRequest, ...extra });
  assert.equal((await ask(pair.org, [row])).ok, true, 'control');
  assert.match((await ask('another-org', [row])).because, /no longer in the personal backup/);
  assert.match((await ask(pair.org, [])).because, /no key on Kosmos\+/);
  const other = { ...row, member_public: b64(Buffer.alloc(32, 9)) };
  assert.match((await ask(pair.org, [other])).because, /Restore it with your recovery code/);
  assert.match((await ask(pair.org, [{ ...row, epoch: 2 }, row].reverse())).because, /Restore it with your recovery code/, 'the newest epoch decides');
  assert.equal((await ask(pair.org, [row], { lostEpoch: 1 })).ok, false);
  const pending = newPair();
  const made = backupkeys.newMemberKey();
  mk.writeKeys(pending.org, pending.member, { 1: { sk: made.sk, pk: made.pk, registered: false } });
  const unregistered = await ask(pending.org, [{ ...row, member_public: b64(made.pk) }], {}, pending);
  assert.equal(unregistered.ok, false, 'a key not yet registered here is never sealed to');
});

test('the key step passes on the refusal code when Kosmos+ refuses the read', async () => {
  const r = await pk.personalKeyForJob('o', { macRequest: async () => ({ ok: false, because: 'x', refusal: { status: 409, code: 'personal_backup_key_pending' } }) });
  assert.equal(r.ok, false);
  assert.equal(r.refusal.code, 'personal_backup_key_pending');
});

/* The gate, over a stub orgenroll: each `over` turns exactly one condition off. */
function gate(over = {}) {
  const root = fs.mkdtempSync(path.join(SANDBOX, 'gate-'));
  const rec = { org: { id: 'porg' }, world: 'w', consentHash: 'ab'.repeat(32) };
  if (over.keyReady !== false) fs.writeFileSync(path.join(root, 'personal-key-ready'), JSON.stringify({ org: 'porg', world: 'w', keyOrg: 'porg', member: 'm' }));
  const orgenroll = {
    JOIN_UNKNOWN_FILE: 'join', LEAVE_PENDING_FILE: 'leave',
    readEnrollment: () => (over.noRecord ? null : rec),
    mayReport: (o) => (o ? over.mayReport !== false : over.company === true),
    acceptedConsent: () => ('words' in over ? over.words : { backsUp: ['your agents\' folders'] }),
  };
  return { root, orgenroll, personalbackupkey: { hasPendingCode: () => over.pendingCode === true }, offer: () => ({ shown: over.shown !== false }) };
}
test('mayBackUp needs every condition', () => {
  assert.equal(pb.mayBackUp(gate()), true, 'control: all of them');
  for (const [what, over] of [
    ['the board does not offer it', { shown: false }],
    ['no record', { noRecord: true }],
    ['no key here', { keyReady: false }],
    ['a recovery code not yet saved', { pendingCode: true }],
    ['no accepted words on the record', { mayReport: false }],
    ['words not kept here', { words: null }],
    ['words that name nothing backed up', { words: { backsUp: [] } }],
    ['words from a board before backsUp was kept', { words: { reports: [] } }],
    ['a company backup here', { company: true }],
  ]) assert.equal(pb.mayBackUp(gate(over)), false, what);
});
test('mayBackUp is false, and does not throw, when the board switch is off', () => {
  assert.equal(pb.mayBackUp(), false);
});

function jobOpts(pair, extra) {
  const rec = { org: { id: pair.org }, world: 'w', consentHash: 'cd'.repeat(32) };
  const withdrawn = [];
  const orgenroll = { readEnrollment: () => rec, consentWithdrawn: async (o, h) => { withdrawn.push(h); return true; } };
  return { withdrawn, opts: Object.assign({ root: path.join(SANDBOX, 'job-' + pair.org), orgenroll }, extra) };
}
test('a real run seals to the personal key under the pair Kosmos+ named, and names its state for it', async () => {
  const pair = newPair();
  const { key, row } = keyed(pair);
  const k = kosmosPlus({ ...pair, keys: [row] });
  const taken = [];
  const dk = backupkeys.newMemberKey();
  const runBackup = (input, deps) => backuprun.runBackup(input, Object.assign({}, deps, {
    deviceKey: () => ({ ok: true, privateKey: dk.sk }), now: () => Date.UTC(2026, 9, 31),
    takeSnapshot: async (s) => { taken.push(s); return { ok: true, added: new Map(), files: 1 }; },
  }));
  const { opts, withdrawn } = jobOpts(pair, { macRequest: k.macRequest, runBackup });
  const r = await pb.runJob({ roots: [{ name: 'workers', path: SANDBOX }] }, opts);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.pair, pair);
  assert.equal(taken.length, 1, 'one snapshot, after the pair was learned');
  assert.ok(taken[0].memberPk.equals(key.pk));
  assert.deepEqual([taken[0].ctx.org, taken[0].ctx.member, taken[0].ctx.epoch], [pair.org, pair.member, '1']);
  assert.deepEqual(withdrawn, []);
  assert.ok(!k.calls.some((c) => c.route === mk.MEMBER_KEY_ROUTE), 'the job never registers');
  assert.ok(!k.calls.some((c) => /backup-key/.test(c.route)), 'never the company key read');
});

test('words Kosmos+ refused take the hash off the record; any other refusal leaves it', async () => {
  const pair = newPair();
  const refused = { ok: false, because: 'grant refused (HTTP 409 on /v1/org/backup/grant, code org_consent_changed)' };
  const a = jobOpts(pair, { runBackup: async () => refused });
  assert.deepEqual(await pb.runJob({ roots: [] }, a.opts), refused);
  assert.deepEqual(a.withdrawn, ['cd'.repeat(32)]);
  const b = jobOpts(pair, { runBackup: async () => ({ ok: false, because: 'grant refused (HTTP 500)' }) });
  await pb.runJob({ roots: [] }, b.opts);
  assert.deepEqual(b.withdrawn, [], 'control');
});

test('the tick names itself, and the company wording stays the default', async () => {
  const said = [];
  const make = (label) => tick.startTick({
    label, enrolled: () => true, roots: () => [{ name: 'workers', path: SANDBOX }],
    runBackup: async () => ({ ok: false, missing: true, because: 'set up remote access' }), say: (t) => said.push(t), setInterval: () => 1, clearInterval: () => {},
  });
  await make('personal backup').tick();
  await make(undefined).tick();
  assert.deepEqual(said, ['personal backup: set up remote access', 'company backup: set up remote access']);
});

test('the board\'s personal tick runs nothing while personal backup is not on here', async () => {
  const seen = [];
  const stop = tick.startPersonal();
  const real = backuprun.runBackup;
  backuprun.runBackup = async (...a) => { seen.push(a); return { ok: true }; };
  try { await stop.tick(); } finally { backuprun.runBackup = real; stop(); }
  assert.deepEqual(seen, []);
  assert.equal(stop.state.running, false);
});
