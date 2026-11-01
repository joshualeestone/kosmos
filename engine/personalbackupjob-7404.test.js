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
// The board ticks below read real folders: every one is this sandbox's, never the machine's.
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_AGY_HOME = path.join(SANDBOX, 'home', '.gemini-agy');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'claude');
process.env.AGENT_WORKFORCE_GEMINI_HOME = path.join(SANDBOX, 'gemini');
process.env.AGENT_WORKFORCE_CODEX_HOME = path.join(SANDBOX, 'codex');
delete process.env.AGENT_WORKFORCE_GROK_HOME;
for (const k of ['WORKERS', 'HOME', 'PROJECTS', 'CONFIG_ROOT', 'GEMINI_HOME', 'CODEX_HOME']) fs.mkdirSync(process.env['AGENT_WORKFORCE_' + k], { recursive: true });
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
  assert.ok(r.proofKey.equals(require('./backupformat').memberProofKey(key.sk)), 'slice D: a restore can trust what this seals');
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
  assert.match((await ask(pair.org, [other])).because, /holds a different key/);
  assert.match((await ask(pair.org, [{ ...row, epoch: 2 }, row].reverse())).because, /holds a different key/, 'the newest epoch decides');
  const none = newPair();
  const empty = await ask(none.org, [row], {}, none);
  assert.match(empty.because, /turn it on again and enter your recovery code/, 'no keys here: setUp answers already_set_up, so the code is asked for');
  assert.equal(empty.personActs, true);
  assert.equal((await ask(pair.org, [row], { lostEpoch: 1 })).ok, true, 'a lostEpoch for no named pair is not this one\'s');
  assert.equal((await ask(pair.org, [row], { lostEpoch: 3, lostFor: { org: 'acme', member: 'm' } })).ok, true, 'nor another pair\'s');
  assert.match((await ask(pair.org, [row], { lostEpoch: 1, lostFor: pair })).because, /newer key/);
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
    mayReport: () => over.mayReport !== false,
    acceptedConsent: () => ('words' in over ? over.words : { backsUp: ['your agents\' folders'] }),
    holdsEnrollment: () => over.company === true,
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
  assert.ok(taken[0].proofKey.equals(require('./backupformat').memberProofKey(key.sk)), 'slice D: the proof key reaches the real run');
  assert.deepEqual([taken[0].ctx.org, taken[0].ctx.member, taken[0].ctx.epoch], [pair.org, pair.member, '1']);
  assert.deepEqual(withdrawn, []);
  assert.ok(!k.calls.some((c) => c.route === mk.MEMBER_KEY_ROUTE), 'the job never registers');
  assert.ok(!k.calls.some((c) => /backup-key/.test(c.route)), 'never the company key read');
});

test('words Kosmos+ refused take the hash off the record, and the person is told; any other refusal leaves it', async () => {
  const pair = newPair();
  const refused = { ok: false, pair, because: 'grant refused (HTTP 409 on /v1/org/backup/grant, code org_consent_changed)' };
  const a = jobOpts(pair, { runBackup: async () => refused });
  const r = await pb.runJob({ roots: [] }, a.opts);
  assert.equal(r.ok, false);
  assert.equal(r.personActs, true);
  assert.match(r.because, /read the new words/);
  assert.deepEqual(a.withdrawn, ['cd'.repeat(32)]);
  const b = jobOpts(pair, { runBackup: async () => ({ ok: false, because: 'grant refused (HTTP 500)' }) });
  await pb.runJob({ roots: [] }, b.opts);
  assert.deepEqual(b.withdrawn, [], 'control');
});

test('a company\'s left-over pointer, lost epoch and bad state file never touch a personal run', async () => {
  const store = require('./store');
  const backupstate = require('./backupstate');
  const company = newPair();
  const dir = path.join(store.ROOT, 'backupstate');
  const before = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  backupstate.writeState(company.org, company.member, { job: { lostEpoch: 3 }, periods: [] });
  const companyFiles = fs.readdirSync(dir).filter((n) => !before.has(n));
  assert.equal(companyFiles.length, 1, 'the company pair\'s state file');
  const companyPointer = JSON.stringify({ v: 1, org: company.org, member: company.member });
  fs.writeFileSync(path.join(dir, 'current.json'), companyPointer);
  const pair = newPair();
  const { key, row } = keyed(pair);
  const k = kosmosPlus({ ...pair, keys: [row] });
  const taken = [];
  const dk = backupkeys.newMemberKey();
  const runBackup = (input, deps) => backuprun.runBackup(input, Object.assign({}, deps, {
    deviceKey: () => ({ ok: true, privateKey: dk.sk }), now: () => Date.UTC(2026, 9, 31),
    takeSnapshot: async (s) => { taken.push(s); return { ok: true, added: new Map(), files: 1 }; },
  }));
  const { opts } = jobOpts(pair, { macRequest: k.macRequest, runBackup });
  const r = await pb.runJob({ roots: [{ name: 'workers', path: SANDBOX }] }, opts);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(taken[0].memberPk.equals(key.pk));
  assert.equal(fs.readFileSync(path.join(dir, 'current.json'), 'utf8'), companyPointer, 'the company\'s pointer is untouched');
  // A bad state file under the company's pair: control, the company's run is refused, the personal one runs.
  for (const x of companyFiles) fs.writeFileSync(path.join(dir, x), 'not json');
  const again = await pb.runJob({ roots: [{ name: 'workers', path: SANDBOX }] }, opts);
  assert.equal(again.ok, true, JSON.stringify(again));
  const control = await runBackup({ roots: [] }, { ensureMemberKey: async () => ({ ok: false, because: 'x' }) });
  assert.equal(control.ok, false);
  assert.equal(control.refusedState, true, 'control: the company\'s run reads that file');
});

test('a real snapshot refused by Kosmos+ for the words comes back as that refusal, end to end', async () => {
  const crypto = require('node:crypto');
  const pair = newPair();
  const { row } = keyed(pair);
  fs.rmSync(path.join(require('./store').ROOT, 'backupstate', 'current-personal.json'), { force: true });
  const folder = fs.mkdtempSync(path.join(SANDBOX, 'real-'));
  fs.writeFileSync(path.join(folder, 'a.txt'), 'hello');
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const routes = [];
  const macRequest = async (m, route) => {
    routes.push(route);
    if (route === pk.MINE_ROUTE) return { ok: true, data: { ...pair, keys: [row] } };
    return { ok: false, because: `coordinator refused (HTTP 409 on ${route}, code org_consent_changed)`, refusal: { status: 409, code: 'org_consent_changed' } };
  };
  const runBackup = (input, deps) => backuprun.runBackup(input, Object.assign({}, deps, { deviceKey: () => ({ ok: true, privateKey }), macRequest }));
  const a = jobOpts(pair, { macRequest, runBackup });
  const r = await pb.runJob({ roots: [{ name: 'workers', path: fs.realpathSync(folder) }] }, a.opts);
  assert.ok(routes.some((x) => /backup\/grant/.test(x)), 'the real snapshot reached the grant: ' + routes.join(' '));
  assert.equal(r.ok, false);
  assert.equal(r.personActs, true, JSON.stringify(r));
  assert.deepEqual(a.withdrawn, ['cd'.repeat(32)]);
});

/* The board's side of off then on, real key module and real personalbackup: only Kosmos+ and the enrollment record are fakes. */
function chain(pair, rows) {
  const root = fs.mkdtempSync(path.join(SANDBOX, 'chain-'));
  const rec = { org: { id: pair.org }, world: 'w', consentHash: 'cd'.repeat(32) };
  const macRequest = async (m, route) => {
    if (route === pk.MINE_ROUTE) return { ok: true, data: { ...pair, keys: rows } };
    return { ok: true, data: { member: true, org: { id: pair.org, kind: 'personal' }, enrolled: { thisComputer: true, world: 'w' } } };
  };
  const orgenroll = {
    JOIN_UNKNOWN_FILE: 'join', LEAVE_PENDING_FILE: 'leave', readEnrollment: () => rec, mayReport: () => true,
    acceptedConsent: () => ({ backsUp: ['your project folders'] }), holdsEnrollment: () => false,
  };
  return { root, orgenroll, macRequest, remote: { macRequest }, offer: () => ({ shown: true }) };
}
test('key gone: off then on asks for the code, the code restores it, and the job can run', async () => {
  const pair = newPair();
  const key = backupkeys.newMemberKey();
  const code = backupkeys.newRecoveryCode();
  const rk = backupkeys.recoveryKeysFromCode(code);
  const ctx = { org: pair.org, member: pair.member, epoch: '1' };
  const row = { epoch: 1, member_public: b64(key.pk), wrap: b64(backupkeys.wrapMemberKeyToRecovery(key.sk, rk.pk, ctx)), recovery_public: b64(rk.pk), recovery_tag: backupkeys.recoveryBindingTag(rk.authKey, ctx, key.pk) };
  const o = chain(pair, [row]);
  assert.match((await pk.personalKeyForJob(pair.org, o)).because, /turn it on again and enter your recovery code/);
  const set = await pb.setUpKey(o);
  assert.equal(set.code, 'restore', JSON.stringify(set));
  assert.equal(pb.mayBackUp(o), false, 'no key yet');
  const back = await pb.restore(code, o);
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.equal(pb.state(o), 'on');
  assert.equal(pb.mayBackUp(o), true);
  assert.equal((await pk.personalKeyForJob(pair.org, o)).ok, true);
});

test('words changed, key still here: on again asks for no code, and the job can run', async () => {
  const pair = newPair();
  const { row } = keyed(pair);
  const o = chain(pair, [row]);
  assert.equal(pb.state(o), 'needs-key', 'off removed the marker');
  const set = await pb.setUpKey(o);
  assert.deepEqual([set.ok, set.code, set.already], [true, null, true], JSON.stringify(set));
  assert.equal(pb.state(o), 'on');
  assert.equal(pb.mayBackUp(o), true);
  assert.equal((await pk.personalKeyForJob(pair.org, o)).ok, true);
});

function onNow(o, pair) { fs.writeFileSync(path.join(o.root, 'personal-key-ready'), JSON.stringify({ org: pair.org, world: 'w' })); return o; }
const at = (h) => Date.UTC(2026, 9, 31, h);
test('the panel report: first run, a good run, a passing failure, a stop, and a good run again', async () => {
  const pair = newPair();
  const o = onNow(chain(pair, []), pair);
  const run = (r, h) => pb.runJob({ roots: [] }, { ...o, now: () => at(h), runBackup: async () => r });
  assert.deepEqual(pb.report(o), { lastOk: null, stopped: null, note: 'A backup runs soon.' });
  await run({ ok: false, because: 'Kosmos+ could not be reached' }, 11);
  assert.deepEqual(pb.report(o), { lastOk: null, stopped: null, note: 'A backup has not finished yet.' }, 'tried is not untried');
  await run({ ok: true }, 12);
  assert.deepEqual(pb.report(o), { lastOk: '2026-10-31T12:00:00.000Z', stopped: null, note: null });
  await run({ ok: false, because: 'Kosmos+ could not be reached' }, 13);
  assert.deepEqual(pb.report(o), { lastOk: '2026-10-31T12:00:00.000Z', stopped: null, note: null }, 'a passing failure is no stop');
  await run({ ok: false, personActs: true, because: 'this backup has no key on Kosmos+ yet, so nothing was backed up' }, 14);
  const stop = 'This backup has no key on Kosmos+ yet, so nothing was backed up.';
  assert.deepEqual(pb.report(o), { lastOk: '2026-10-31T12:00:00.000Z', stopped: stop, note: null });
  await run({ ok: false, because: 'Kosmos+ could not be reached' }, 15);
  assert.equal(pb.report(o).stopped, stop, 'a passing failure does not clear a stop either');
  await run({ ok: true }, 16);
  assert.deepEqual(pb.report(o), { lastOk: '2026-10-31T16:00:00.000Z', stopped: null, note: null }, 'a good run clears the stop');
});
test('no server or file text reaches the panel, whichever flag a refusal carries', async () => {
  const pair = newPair();
  const o = onNow(chain(pair, []), pair);
  const run = (r) => pb.runJob({ roots: [] }, { ...o, runBackup: async () => r });
  const raw = 'RAW /Users/someone/secret (HTTP 429 on /v1/org/backup/grant, code backup_quota)';
  await run({ ok: false, overAllowance: true, because: raw });
  let r = pb.report(o);
  assert.equal(r.stopped, null, 'a used-up week carries on by itself');
  assert.match(r.note, /carry on next week/);
  for (const flag of ['tooLarge', 'missing', 'refusedState']) {
    await run({ ok: false, [flag]: true, because: raw });
    r = pb.report(o);
    assert.ok(r.stopped, flag);
    assert.doesNotMatch(JSON.stringify(r) + fs.readFileSync(path.join(o.root, 'personal-job.json'), 'utf8'), /RAW|Users/, flag);
  }
  await run({ ok: false, tooLarge: true, overAllowance: true, because: raw });
  assert.match(pb.report(o).stopped, /too large.*next try is next week/, 'too large for any week is a stop, and the tick waits a week');
  await run({ ok: true });
  await run({ ok: false, refusedState: true, stateNotKept: true, because: 'chunks could not be uploaded: ' + raw });
  assert.equal(pb.report(o).stopped, null, 'stateNotKept: the flag and the sentence are different failures');
});
test('the panel report claims nothing it did not establish', () => {
  const pair = newPair();
  const o = onNow(chain(pair, []), pair);
  assert.equal(pb.mayBackUp(o), true, 'control');
  o.orgenroll.acceptedConsent = () => ({ backsUp: [] });
  assert.match(pb.report(o).stopped, /turn it on again to read the current words/);
  o.orgenroll.acceptedConsent = () => ({ backsUp: ['x'] });
  o.orgenroll.holdsEnrollment = () => true;
  const paused = 'Backups are paused while this computer belongs to a company or family account.';
  assert.deepEqual(pb.report(o), { lastOk: null, stopped: null, note: paused }, 'a company here: no promise, and no step that could not be undone');
  o.orgenroll.holdsEnrollment = () => false;
  const mr = o.orgenroll.mayReport;
  o.orgenroll.mayReport = () => false;
  assert.deepEqual(pb.report(o), { lastOk: null, stopped: null, note: 'Backups are not running on this computer just now.' }, 'not the words: the words are not blamed');
  o.orgenroll.mayReport = mr;
  const rec = o.orgenroll.readEnrollment();
  o.orgenroll.readEnrollment = () => { const { consentHash, ...rest } = rec; return rest; };
  o.orgenroll.mayReport = () => false;
  assert.match(pb.report(o).stopped, /turn it on again to read the current words/, 'no accepted hash on the record: the words need an OK');
});
test('a report that throws costs the panel nothing', () => {
  const o = { root: SANDBOX, orgenroll: { readEnrollment() { throw new Error('bad file'); } } };
  assert.deepEqual(pb.report(o), { lastOk: null, stopped: null, note: null });
  const pair = newPair();
  const bad = onNow(chain(pair, []), pair);
  bad.offer = () => { throw new Error('no'); };
  bad.orgenroll.holdsEnrollment = () => { throw new Error('no'); };
  assert.deepEqual(Object.keys(pb.report(bad)).sort(), ['lastOk', 'note', 'stopped']);
});
test('a company here silences a stop that would send the person through off and on', async () => {
  const pair = newPair();
  const o = onNow(chain(pair, []), pair);
  await pb.runJob({ roots: [] }, { ...o, runBackup: async () => ({ ok: false, personActs: true, because: 'turn it off' }) });
  assert.ok(pb.report(o).stopped, 'control');
  o.orgenroll.holdsEnrollment = () => true;
  assert.equal(pb.report(o).stopped, null);
});
test('a note from another enrollment is not shown, and a run that outlived its enrollment leaves none', async () => {
  const pair = newPair();
  const o = onNow(chain(pair, []), pair);
  await pb.runJob({ roots: [] }, { ...o, runBackup: async () => ({ ok: true }) });
  assert.ok(pb.report(o).lastOk);
  const rec = o.orgenroll.readEnrollment();
  const other = { ...o, orgenroll: { ...o.orgenroll, readEnrollment: () => ({ ...rec, org: { id: 'another' } }) } };
  fs.writeFileSync(path.join(o.root, 'personal-key-ready'), JSON.stringify({ org: 'another', world: 'w' }));
  assert.equal(pb.report(other).lastOk, null);
  fs.rmSync(path.join(o.root, 'personal-job.json'));
  const gone = { ...o, orgenroll: { ...o.orgenroll } };
  let calls = 0;
  gone.orgenroll.readEnrollment = () => (calls++ === 0 ? rec : null);
  await pb.runJob({ roots: [] }, { ...gone, runBackup: async () => ({ ok: true }) });
  assert.equal(fs.existsSync(path.join(o.root, 'personal-job.json')), false);
});

test('a different reason is said, even with the last one unresolved', async () => {
  const said = [];
  const why = ['first reason', 'first reason', 'second reason'];
  const stop = tick.startTick({
    enrolled: () => true, roots: () => [{ name: 'workers', path: SANDBOX }], label: 'personal backup',
    runBackup: async () => ({ ok: false, personActs: true, because: why.shift() }), say: (t) => said.push(t), setInterval: () => 1, clearInterval: () => {}, now: () => 1000,
  });
  for (let i = 0; i < 3; i++) await stop.tick();
  assert.deepEqual(said, ['personal backup: first reason', 'personal backup: second reason']);
});

test('words accepted during a run stay: the hash withdrawn is the one the run started under', async () => {
  const pair = newPair();
  const a = jobOpts(pair);
  const rec = a.opts.orgenroll.readEnrollment();
  a.opts.runBackup = async () => { rec.consentHash = 'ee'.repeat(32); return { ok: false, because: 'x, code org_consent_changed' }; };
  await pb.runJob({ roots: [] }, a.opts);
  assert.deepEqual(a.withdrawn, ['cd'.repeat(32)]);
});

test('a key step refusal a person must act on reaches the tick\'s one said line, through the real run', async () => {
  const pair = newPair();
  keyed(pair);
  fs.rmSync(path.join(require('./store').ROOT, 'backupstate', 'current-personal.json'), { force: true });   // an earlier test's pair
  const k = kosmosPlus({ ...pair, keys: [] });
  const dk = backupkeys.newMemberKey();
  const runBackup = (input, deps) => backuprun.runBackup(input, Object.assign({}, deps, { deviceKey: () => ({ ok: true, privateKey: dk.sk }) }));
  const { opts } = jobOpts(pair, { macRequest: k.macRequest, runBackup });
  const said = [];
  const stop = tick.startTick({
    label: 'personal backup', enrolled: () => true, roots: () => [{ name: 'workers', path: SANDBOX }],
    runBackup: (input) => pb.runJob(input, opts), say: (t) => said.push(t), setInterval: () => 1, clearInterval: () => {}, now: () => 1000,
  });
  await stop.tick();
  assert.equal(stop.state.pausedUntil, 0, 'not backed off: a fix is seen on the next hour');
  await stop.tick();
  assert.deepEqual(said, ['personal backup: this backup has no key on Kosmos+ yet, so nothing was backed up'], 'said once');
  assert.equal(k.calls.filter((c) => c.route === pk.MINE_ROUTE).length, 2, 'the second tick did run');
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

/* The proceed path of both board ticks through startWorld: real roots, real staging, each its own stage folder, cleared. */
test('startPersonal reaches runJob with the roots, under its own stage folder, cleared after', async () => {
  const store = require('./store');
  const create = require('./create');
  assert.ok(create.WORKERS_DIR.startsWith(SANDBOX), 'never the real workers folder');
  const stage = path.join(store.ROOT, 'backupstage', 'agy-personal');
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(stage, 'left-by-a-dead-run'), 'x');
  const seen = [];
  const real = { may: pb.mayBackUp, run: pb.runJob };
  pb.mayBackUp = () => true;
  pb.runJob = async (input) => { seen.push({ input, staged: fs.existsSync(path.join(stage, 'left-by-a-dead-run')) }); return { ok: true }; };
  const stop = tick.startPersonal();
  try { await stop.tick(); } finally { pb.mayBackUp = real.may; pb.runJob = real.run; stop(); }
  assert.equal(seen.length, 1);
  assert.ok(seen[0].input.roots.some((r) => r.name === 'workers'));
  assert.equal(seen[0].staged, false, 'a dead run\'s copies are gone before this run');
  assert.equal(fs.existsSync(path.join(stage, 'left-by-a-dead-run')), false);
});
test('startHere still runs the company path, with no personal key step', async () => {
  const create = require('./create');
  const oe = require('./orgenroll');
  assert.ok(create.WORKERS_DIR.startsWith(SANDBOX), 'never the real workers folder');
  const seen = [];
  const real = { may: oe.mayReport, run: backuprun.runBackup };
  oe.mayReport = () => true;
  backuprun.runBackup = async (...a) => { seen.push(a); return { ok: true }; };
  const stop = tick.startHere();
  try { await stop.tick(); } finally { oe.mayReport = real.may; backuprun.runBackup = real.run; stop(); }
  assert.equal(seen.length, 1);
  assert.ok(seen[0][0].roots.some((r) => r.name === 'workers'));
  assert.equal(seen[0][1], undefined, 'the default key step');
});
