'use strict';
/**
 * kosmos#7404 (personalswitch-7404): engine/personalbackup.js turns a personal backup on and off under its OWN data
 * root, so the company enrollment's readers never see it. Each test is one condition of the plan's design review 1:
 *   - a company policy at store.ROOT survives a personal enroll, follow-up and leave (with a control: the same leave
 *     WITHOUT the inert policy wipes it, so the test can see a wipe);
 *   - the enroll always carries the served hash and wordsShown, from the ticket, and a ticket is used once;
 *   - nothing is written where the company readers look (store.ROOT keeps no enrollment, mayReport stays false);
 *   - words that report anything are not a personal backup's, and are refused at the preview.
 *
 *   node --test engine/personalbackup-7404.test.js
 */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-personalswitch-7404-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
delete process.env.AGENT_WORKFORCE_TUNNEL_STATE;
const store = require('./store');
const cp = require('./computerprint');
const oe = require('./orgenroll');
const orgpolicy = require('./orgpolicy');
const pb = require('./personalbackup');

const UUID = '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9';
const DUMP = '+-o Mac  <class IOPlatformExpertDevice, id 0x1, registered>\n    {\n      "IOPlatformUUID" = "' + UUID + '"\n    }\n';
const ORG = { id: 'porg_1', name: 'Personal backup', slug: 'pb-x', kind: 'personal' };
const WORDS = { reports: [], backsUp: [], readers: ['you, on your own computers'], never: ['keys and passwords'] };
const HASH = 'ab'.repeat(32);
const SALT = 'cd'.repeat(16);
const TOKEN = 'h.' + Buffer.from(JSON.stringify({ org: ORG.id, version: 9 })).toString('base64url') + '.s';

/* A coordinator with the personal rules: personal-backup answers the words; the codeless enroll REFUSES without the
   served hash and wordsShown (org.rs: personal_backup_words_unseen); status names this world until a leave. */
function coordinator(over = {}) {
  const sent = [];
  // `member`: the preview MAKES the membership, bound to no computer (org.rs mac_personal_backup; code review 2).
  let world = null, left = false, member = over.preexisting === true;
  return {
    sent,
    get member() { return member && !left; },
    macRequest: async (m, route, body) => {
      sent.push({ route, body: body == null ? null : JSON.parse(JSON.stringify(body)) });
      if (route === pb.ROUTE) { if (!over.preview) { member = true; left = false; } return over.preview || { ok: true, data: { org: ORG, role: 'member', consent: WORDS, consentHash: HASH, computerSalt: SALT } }; }
      if (route === oe.ROUTES.enroll) {
        if (over.enrollRefuse) return { ok: false, because: '409 {"code":"' + over.enrollRefuse + '"}', refusal: { status: 409, code: over.enrollRefuse } };
        // kosmos#7661: the coordinator's onlyIfFree refusal, only when the board sent the flag (the test can see it unsent).
        if (over.boundElsewhere && body.onlyIfFree === true) return { ok: false, because: '409 {"code":"' + over.boundElsewhere + '"}', refusal: { status: 409, code: over.boundElsewhere } };
        if (body.consentHash !== HASH || body.wordsShown !== true) return { ok: false, because: '409 {"code":"personal_backup_words_unseen"}', refusal: { status: 409, code: 'personal_backup_words_unseen' } };
        world = body.world; left = false;
        return { ok: true, data: { ok: true, org: over.enrollOrg || ORG, role: 'member', printPinned: true, enrolled: { computer: 'c1', world, thisComputer: over.notThisComputer ? false : true } } };
      }
      if (route === oe.ROUTES.status) {
        if (over.statusAnswer && member && !left) return over.statusAnswer;
        if (!left && !world && member) return { ok: true, data: { member: true, org: ORG, role: 'member', computerSalt: SALT, enrolled: null } };
        if (left || !world) return { ok: true, data: { member: false } };
        // A policy token naming this org, so orgenroll's applyPolicy reaches the policy module's BUNDLE (code review 1).
        return { ok: true, data: { member: true, org: ORG, role: 'member', computerSalt: SALT, policy: TOKEN, enrolled: { computer: 'c1', world, thisComputer: true } } };
      }
      if (route === oe.ROUTES.leave) { if (over.leaveDown) return { ok: false, because: 'unreachable' }; left = true; world = null; return { ok: true, data: { ok: true, left: true } }; }
      return { ok: false, because: 'unexpected route ' + route };
    },
  };
}
const HOUR_MS = 60 * 60 * 1000;
const KEY_OK = { setUpPersonalKey: async () => ({ ok: true, code: 'TEST-CODE', epoch: 1 }) };

test('pbjob-7404: words accepted through the real enroll open the job only when they name something backed up', async (t) => {
  for (const [backsUp, want] of [[['your project folders'], true], [[], false]]) {
    const root = fresh(t);
    const consent = { ...WORDS, backsUp };
    const c = coordinator({ preexisting: true, preview: { ok: true, data: { org: ORG, role: 'member', consent, consentHash: HASH, computerSalt: SALT } } });
    const p = await pb.preview({ root, remote: c });
    assert.equal(p.ok, true, JSON.stringify(p));
    const on = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
    assert.equal(on.ok, true, JSON.stringify(on));
    assert.equal(pb.mayBackUp({ root, remote: c, offer: () => ({ shown: true }), personalbackupkey: { hasPendingCode: () => false } }), want, JSON.stringify(backsUp));
  }
});

function fresh(t) {
  pb._TICKETS.clear();   // each test starts as a board just started: no ticket from an earlier test is live
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-personalswitch-7404-root-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); cp._testRunner(); });
  cp._testRunner(() => DUMP, { platform: 'darwin' });
  return root;
}
/* A company policy in force at store.ROOT, readable as orgpolicy reads it: an applied record naming ANOTHER org (so a
   policy call that reached it would see a foreign policy and clear it) and a bundle on disk. Code review 1: plain text
   here made appliedOrg() null, so the enroll and follow-up arms could not fail. */
function seedCompanyPolicy() {
  fs.mkdirSync(path.dirname(orgpolicy.APPLIED()), { recursive: true });
  fs.writeFileSync(orgpolicy.APPLIED(), JSON.stringify({ version: 3, org: 'acme_co', policy: { rules: [] } }));
  fs.mkdirSync(path.dirname(orgpolicy.BUNDLE()), { recursive: true });
  fs.writeFileSync(orgpolicy.BUNDLE(), 'h.' + Buffer.from(JSON.stringify({ org: 'acme_co', version: 3 })).toString('base64url') + '.s');
  assert.equal(orgpolicy.appliedOrg(), 'acme_co', 'seed: the company policy is readable as in force');
}
const companyPolicy = () => [orgpolicy.BUNDLE(), orgpolicy.APPLIED()].map((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null));

test('#7404: on, followed up and off under its own root; a company policy at store.ROOT survives all three', async (t) => {
  const root = fresh(t);
  seedCompanyPolicy();
  const before = companyPolicy();
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.deepEqual(p.words, WORDS);
  const on = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.equal(on.ok, true, JSON.stringify(on));
  assert.equal(on.code, 'TEST-CODE');
  assert.equal(pb.isOn({ root }), true);
  assert.deepEqual(companyPolicy(), before, 'a personal enroll changed the company policy');
  pb._resetFollowUpForTests();
  const n0 = c.sent.length;
  await pb.followUp({ root, remote: c });
  assert.ok(c.sent.length > n0, 'control: the follow-up sent a status read');
  assert.deepEqual(companyPolicy(), before, 'a personal follow-up changed the company policy');
  const off = await pb.switchOff({ root, remote: c });
  assert.equal(off.ok, true, JSON.stringify(off));
  assert.equal(pb.isOn({ root }), false);
  assert.deepEqual(companyPolicy(), before, 'a personal leave changed the company policy');
});

test('#7404 CONTROL: the same leave WITHOUT the inert policy wipes the company policy (the test can see a wipe)', async (t) => {
  const root = fresh(t);
  seedCompanyPolicy();
  const before = companyPolicy();
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  await oe.leave({ root, remote: c });   // orgenroll's default policy: the real orgpolicy at store.ROOT
  assert.notDeepEqual(companyPolicy(), before, 'control: a leave without the inert policy left the company policy, so the main test proves nothing');
});

test('#7404: the enroll carries the served hash, wordsShown and org; a ticket is used once', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  const on = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.equal(on.ok, true, JSON.stringify(on));
  const enroll = c.sent.find((x) => x.route === oe.ROUTES.enroll);
  assert.equal(enroll.body.consentHash, HASH);
  assert.equal(enroll.body.wordsShown, true);
  assert.equal(enroll.body.code, undefined, 'a personal enroll is codeless');
  const again = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.equal(again.ok, false);
  assert.equal(again.code, 'ticket');
  assert.equal(c.sent.filter((x) => x.route === oe.ROUTES.enroll).length, 1, 'a used ticket sent a second enroll');
});

test('#7404: nothing lands where the company readers look', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.equal(fs.existsSync(path.join(root, oe.ENROLLMENT_FILE)), true, 'control: the personal record is under its own root');
  assert.equal(fs.existsSync(path.join(store.ROOT, oe.ENROLLMENT_FILE)), false, 'a personal enroll wrote the company record');
  assert.equal(oe.readEnrollment(), null);
  assert.equal(oe.mayReport(), false, 'a personal backup made the company side report');
  // Code review 7, warning 2: the pin by its real name, from the module (a typed 'org-key-pin.json' could never exist).
  for (const f of [oe.WORLD_ID_FILE, 'org-consent.json', oe.JOIN_UNKNOWN_FILE, path.join('backupkeys', require('./orgkeypin').PIN_FILE)]) {
    assert.equal(fs.existsSync(path.join(store.ROOT, f)), false, f + ' was written where the company readers look');
  }
  assert.equal(fs.existsSync(path.join(root, oe.WORLD_ID_FILE)), true, 'control: the personal world id is under its own root');
  assert.equal(fs.existsSync(path.join(root, 'backupkeys', require('./orgkeypin').PIN_FILE)), true, 'control: the pin landed under its own root');
  assert.notEqual(pb.root(), store.ROOT);
});

test('#7404: words that report anything, a non-personal org, or no hash are refused at the preview', async (t) => {
  fresh(t);
  const base = { org: ORG, role: 'member', consent: WORDS, consentHash: HASH, computerSalt: SALT };
  for (const [what, data] of [
    ['reports something', Object.assign({}, base, { consent: Object.assign({}, WORDS, { reports: ['agent names'] }) })],
    ['a company org', Object.assign({}, base, { org: Object.assign({}, ORG, { kind: 'company' }) })],
    ['no hash', Object.assign({}, base, { consentHash: undefined })],
    ['a bad salt', Object.assign({}, base, { computerSalt: 'not-hex' })],
  ]) {
    const p = await pb.preview({ remote: coordinator({ preview: { ok: true, data } }) });
    assert.equal(p.ok, false, what);
    assert.equal(p.ticket, undefined, what + ': a ticket was issued');
  }
  const off = await pb.preview({ remote: coordinator({ preview: { ok: false, refusal: { status: 404, code: 'personal_backup_off' } } }) });
  assert.equal(off.code, 'personal_backup_off');
  assert.match(off.because, /not available/);
});

test('#7404: a ticket expires after ten minutes, and survives a try that sent nothing', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c, now: () => 1000 });
  const late = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK, now: () => 1000 + 10 * 60 * 1000 + 1 });
  assert.equal(late.code, 'ticket');
  const p2 = await pb.preview({ root, remote: c });
  const unsent = await pb.switchOn(p2.ticket, true, { root, remote: { macRequest: undefined }, personalbackupkey: KEY_OK });
  assert.equal(unsent.ok, false);
  assert.notEqual(unsent.code, 'ticket');
  const again = await pb.switchOn(p2.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.equal(again.ok, true, 'a try that sent nothing spent the ticket: ' + JSON.stringify(again));
});

test('#7404: off then on here needs no new code; another computer is told to restore; a failed key step is needs-key', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const keys = (k) => ({ setUpPersonalKey: async () => k });
  let p = await pb.preview({ root, remote: c });
  const here = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: keys({ ok: false, code: 'already_here', because: 'x' }) });
  assert.deepEqual([here.ok, here.code, here.already], [true, null, true]);
  assert.equal(pb.state({ root }), 'on');
  await pb.switchOff({ root, remote: c });
  assert.equal(pb.state({ root }), 'off');
  p = await pb.preview({ root, remote: c });
  const other = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: keys({ ok: false, code: 'already_set_up', because: 'x' }) });
  assert.deepEqual([other.ok, other.code], [false, 'restore']);
  assert.match(other.because, /Restore it here/);
  assert.equal(pb.state({ root }), 'needs-key', 'a stale key marker said on after a re-enable');
  const later = await pb.setUpKey({ root, remote: c, personalbackupkey: KEY_OK });
  assert.equal(later.ok, true);
  assert.equal(pb.state({ root }), 'on');
});

test('#7404: an answer naming another org is not taken as on', async (t) => {
  const root = fresh(t);
  const c = coordinator({ enrollOrg: Object.assign({}, ORG, { id: 'porg_other' }) });
  const p = await pb.preview({ root, remote: c });
  const on = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.equal(on.ok, false);
  assert.equal(pb.state({ root }), 'off');
});

test('#7404: the follow-up sends nothing with no personal backup here, and refreshes at most hourly once settled', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  pb._resetFollowUpForTests();
  await pb.followUp({ root, remote: c, now: () => 5 * 3600e3 });
  assert.equal(c.sent.length, 0, 'a follow-up with no personal backup sent a request');
  const p = await pb.preview({ root, remote: c });
  await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  pb._resetFollowUpForTests();
  const at = Date.now();
  const n0 = c.sent.length;
  await pb.followUp({ root, remote: c, now: () => at });
  const n1 = c.sent.length;
  assert.ok(n1 > n0, 'control: the first follow-up of a settled record refreshed');
  await pb.followUp({ root, remote: c, now: () => at + 2 * 60e3 });
  assert.equal(c.sent.length, n1, 'a settled record was refreshed again two minutes later');
  await pb.followUp({ root, remote: c, now: () => at + 3600e3 + 1 });
  assert.ok(c.sent.length > n1, 'an hour later the follow-up did not refresh');
});

test('#7404: a coded personal refusal on enroll is told as refused, and leaves no lost-join marker or follow-up', async (t) => {
  /* Code review 2, blocker 2: orgenroll knew only its own codes, so personal_backup_words_unseen read as a lost answer
     (a status read, org-join-unknown.json, two-minute follow-ups, "not known yet"). */
  for (const code of ['personal_backup_words_unseen', 'personal_backup_in_org', 'org_other_org']) {
    const root = fresh(t);
    const c = coordinator({ enrollRefuse: code });
    const p = await pb.preview({ root, remote: c });
    const on = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
    assert.equal(on.ok, false, code);
    assert.equal(on.unknown, undefined, code + ' was told as not known yet');
    assert.equal(on.code, code, code);
    assert.equal(fs.existsSync(path.join(root, oe.JOIN_UNKNOWN_FILE)), false, code + ' left a lost-join marker');
  }
});

const STATUS_N = (c) => c.sent.filter((x) => x.route === oe.ROUTES.status).length;
const LEAVE_N = (c) => c.sent.filter((x) => x.route === oe.ROUTES.leave).length;

/* Code review 2, warning 3: a pending leave's age is when this module first saw it, not the file's mtime (leaveNow
   rewrites that file on every try), so a leave nobody answers falls back to hourly after its first day. */
test('#7404 warning 3: a pending leave rewritten on every try still falls back to hourly after a day', async (t) => {
  const root = fresh(t);
  let n = 0;
  const stub = { JOIN_UNKNOWN_FILE: oe.JOIN_UNKNOWN_FILE, LEAVE_PENDING_FILE: oe.LEAVE_PENDING_FILE, readEnrollment: () => null,
    refresh: async () => { n++; fs.writeFileSync(path.join(root, oe.LEAVE_PENDING_FILE), '{}\n'); return { ok: false, pending: true }; } };
  fs.writeFileSync(path.join(root, oe.LEAVE_PENDING_FILE), '{}\n');
  pb._resetFollowUpForTests();
  let now = 5_000_000_000;
  const at = () => now;
  await pb.followUp({ root, orgenroll: stub, now: at });
  now += 2 * 60 * 1000;
  await pb.followUp({ root, orgenroll: stub, now: at });
  assert.equal(n, 2, 'inside the first day: every pass');
  now += 25 * HOUR_MS;
  await pb.followUp({ root, orgenroll: stub, now: at });
  const settled = n;
  now += 2 * 60 * 1000;
  await pb.followUp({ root, orgenroll: stub, now: at });
  assert.equal(n, settled, 'past a day: not every two minutes, though the file was just rewritten');
  now += HOUR_MS;
  await pb.followUp({ root, orgenroll: stub, now: at });
  assert.equal(n, settled + 1, 'hourly');
  fs.rmSync(path.join(root, oe.LEAVE_PENDING_FILE));
  await pb.followUp({ root, orgenroll: stub, now: at });
  assert.equal(fs.existsSync(path.join(root, 'personal-leave-seen')), false, 'no leave pending: the first-seen time goes');
});

test('#7404 warning 3: a lost join is aged by its own at, and an unreadable at reads as a day old', async (t) => {
  const root = fresh(t);
  let n = 0;
  const stub = { JOIN_UNKNOWN_FILE: oe.JOIN_UNKNOWN_FILE, LEAVE_PENDING_FILE: oe.LEAVE_PENDING_FILE, readEnrollment: () => null, refresh: async () => { n++; return { ok: false }; } };
  let now = 5_000_000_000;
  const at = () => now;
  fs.writeFileSync(path.join(root, oe.JOIN_UNKNOWN_FILE), JSON.stringify({ at: new Date(now - 25 * HOUR_MS).toISOString() }));
  pb._resetFollowUpForTests();
  await pb.followUp({ root, orgenroll: stub, now: at });
  now += 2 * 60 * 1000;
  await pb.followUp({ root, orgenroll: stub, now: at });
  assert.equal(n, 1, 'a join lost over a day ago (fresh mtime): hourly');
  fs.writeFileSync(path.join(root, oe.JOIN_UNKNOWN_FILE), JSON.stringify({ at: new Date(now - 60 * 1000).toISOString() }));
  now += 2 * 60 * 1000;
  await pb.followUp({ root, orgenroll: stub, now: at });
  assert.equal(n, 2, 'CONTROL: a join lost a minute ago is followed up at once');
  fs.writeFileSync(path.join(root, oe.JOIN_UNKNOWN_FILE), 'not json');
  now += 2 * 60 * 1000;
  await pb.followUp({ root, orgenroll: stub, now: at });
  assert.equal(n, 2, 'unreadable: hourly');
});

/* Code review 2, warning 4: the key-ready marker names its org and world, so one left by an ending this module did not
   see (a refresh that found the membership gone) never reads as 'on' for a later membership. */
test('#7404 warning 4: a key marker for another world or org reads needs-key; a re-accept of the same binding keeps it', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  assert.equal((await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK })).ok, true);
  assert.equal(pb.state({ root }), 'on', 'CONTROL: the marker for this record reads on');
  const f = path.join(root, oe.ENROLLMENT_FILE);
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.writeFileSync(f, JSON.stringify(Object.assign({}, rec, { world: 'f'.repeat(32) })));
  assert.equal(pb.state({ root }), 'needs-key', 'another world: the old marker does not count');
  fs.writeFileSync(f, JSON.stringify(Object.assign({}, rec, { org: Object.assign({}, rec.org, { id: 'porg_2' }) })));
  assert.equal(pb.state({ root }), 'needs-key', 'another org: the old marker does not count');
  fs.writeFileSync(f, JSON.stringify(rec));
  assert.equal(pb.state({ root }), 'on');
  // Review 6, NIT 4: a re-accept of the SAME binding keeps its marker, so a key step failing on a passing error does not
  // make a working backup read needs-key (the org-and-world comparison above is what stops a stale one reading on).
  const p2 = await pb.preview({ root, remote: c });
  const r = await pb.switchOn(p2.ticket, true, { root, remote: c, personalbackupkey: { setUpPersonalKey: async () => ({ ok: false, code: 'x', because: 'down' }) } });
  assert.equal(r.ok, false);
  assert.equal(pb.state({ root }), 'on');
});

/* Code review 2, warning 5: switchOn says what actually happened for orgenroll's own refusals, driven through orgenroll
   itself (so a reworded sentence there turns these red), never the generic "try again in a minute". */
const GENERIC = /try again in a minute/;
test('#7404 warning 5: not confirmed: its own sentence, and the ticket is spent', async (t) => {
  const root = fresh(t);
  const c = coordinator({ notThisComputer: true });
  const p = await pb.preview({ root, remote: c });
  const r = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.match(r.because, /did not confirm this computer, so nothing was turned on/);
  assert.equal(LEAVE_N(c), 0, 'a personal enroll is a move to orgenroll: nothing is undone');
  assert.doesNotMatch(r.because, GENERIC);
  assert.equal(pb._TICKETS.has(p.ticket), false, 'Kosmos+ answered: the ticket is spent');
});

test('#7404 warning 5: bound but not recorded: says the data folder, and the ticket is spent', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  fs.mkdirSync(path.join(root, oe.ENROLLMENT_FILE), { recursive: true });   // the record cannot be written over a folder
  const r = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.match(r.because, /could not record it, so nothing is backed up/);
  assert.doesNotMatch(r.because, GENERIC);
  assert.equal(pb._TICKETS.has(p.ticket), false, 'Kosmos+ answered: the ticket is spent');
});

test('#7404 warning 5: an unwritable data folder before anything is sent: says so, keeps the ticket', async (t) => {
  // A folder this user cannot write needs POSIX permissions and a user that is not root (no getuid: not POSIX).
  if (typeof process.getuid !== 'function' || process.getuid() === 0) return t.skip('needs a folder this user cannot write');
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  fs.chmodSync(root, 0o500);
  t.after(() => { try { fs.chmodSync(root, 0o700); } catch { /* already removed */ } });
  const r = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  fs.chmodSync(root, 0o700);
  assert.match(r.because, /data folder cannot be written, so nothing was turned on/);
  assert.equal(c.sent.filter((x) => x.route === oe.ROUTES.enroll).length, 0, 'precondition: nothing was sent');
  assert.equal(pb._TICKETS.has(p.ticket), true, 'nothing sent: the ticket is kept');
});

/* Code review 2, warning 6: a refused enroll leaves a world id with no record, and orgenroll's refresh WOULD then read
   status (probe P2). The idle guard is what keeps the follow-up silent, so it is tested with a world id present. */
test('#7404 warning 6: a world id with no record and nothing pending sends nothing; a pending join does', async (t) => {
  const root = fresh(t);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, oe.WORLD_ID_FILE), 'a'.repeat(32) + '\n');
  const c = coordinator();
  pb._resetFollowUpForTests();
  const r = await pb.followUp({ root, remote: c });
  assert.equal(r.idle, true);
  assert.equal(c.sent.length, 0, 'idle: no status read');
  fs.writeFileSync(path.join(root, oe.JOIN_UNKNOWN_FILE), JSON.stringify({ at: new Date().toISOString(), orgId: ORG.id }));
  await pb.followUp({ root, remote: c });
  assert.equal(STATUS_N(c) > 0, true, 'CONTROL: a pending join is followed up, so the test can see a read');
});

/* Code review 2 NIT: a double press on one ticket enrolls once; the second is told it is under way. */
test('#7404: two switchOn calls on one ticket send one enroll', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  const [a, b] = await Promise.all([
    pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK }),
    pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK }),
  ]);
  assert.equal(c.sent.filter((x) => x.route === oe.ROUTES.enroll).length, 1, 'one enroll');
  assert.deepEqual([a.ok, b.code], [true, 'busy']);
});

/* Code review 3, blocker 1: a personal backup another computer of the account runs is never moved here. */
const ON_B = { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: { computer: 'B', world: 'b'.repeat(32), thisComputer: false } } };
test('#7404 review 3 blocker 1: bound on another computer: the preview is refused and nothing is made', async (t) => {
  const root = fresh(t);
  const c = coordinator({ preexisting: true, statusAnswer: ON_B });
  const r = await pb.preview({ root, remote: c });
  assert.equal(r.code, 'personal_on_elsewhere');
  assert.equal(c.sent.filter((x) => x.route === pb.ROUTE).length, 0, 'no preview sent');
  // CONTROL: the same account bound on THIS computer (thisComputer true) is not "elsewhere".
  const c2 = coordinator({ preexisting: true, statusAnswer: { ok: true, data: Object.assign({}, ON_B.data, { enrolled: Object.assign({}, ON_B.data.enrolled, { thisComputer: true }) }) } });
  // Bound on this Mac AND to this Kosmos's own world (review 8: thisComputer alone is any Kosmos on this Mac).
  const own = fresh(t);
  fs.writeFileSync(path.join(own, oe.WORLD_ID_FILE), 'b'.repeat(32) + '\n');
  assert.equal((await pb.preview({ root: own, remote: c2 })).ok, true);
  // ...and the same binding seen from another Kosmos on this Mac (no world id of its own) is elsewhere.
  // kosmos#7661: said as the other Kosmos on THIS computer, as Kosmos+ says it at the move.
  assert.equal((await pb.preview({ root: fresh(t), remote: c2 })).code, 'org_bound_other_world');
});

test('#7404 review 3 blocker 1: bound on another computer after the preview: switchOn sends no enroll', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  const real = c.macRequest;
  c.macRequest = async (m, route, body) => (route === oe.ROUTES.status ? (c.sent.push({ route, body }), ON_B) : real(m, route, body));
  const r = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.equal(r.code, 'personal_on_elsewhere');
  assert.equal(c.sent.filter((x) => x.route === oe.ROUTES.enroll).length, 0);
  assert.equal(pb._TICKETS.has(p.ticket), false);
});

/* Warning 5: a failed enroll does not erase a good key marker. */
test('#7404 review 3 warning 5: an enroll that fails leaves the key marker as it was', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  assert.equal((await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK })).ok, true);
  assert.equal(pb.state({ root }), 'on');
  const p2 = await pb.preview({ root, remote: c });
  const real = c.macRequest;
  c.macRequest = async (m, route, body) => (route === oe.ROUTES.enroll ? { ok: false, because: '409 {"code":"org_consent_changed"}', refusal: { status: 409, code: 'org_consent_changed' } } : real(m, route, body));
  const r = await pb.switchOn(p2.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.equal(r.ok, false);
  assert.equal(pb.state({ root }), 'on', 'still on: the key is fine');
});

/* Warning 2: the membership ended under an open preview: told to open it again. */
test('#7404 review 3 warning 2: org_not_member on accept says open it again', async (t) => {
  const root = fresh(t);
  const c = coordinator({ enrollRefuse: 'org_not_member' });
  const p = await pb.preview({ root, remote: c });
  const r = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.match(r.because, /open it again/);
  assert.doesNotMatch(r.because, /try again in a minute/);
});

/* NIT 5 measured: orgenroll itself refuses an answer naming another org (opts.orgId, its review 39) and writes no
   record, so "nothing was turned on" is true there; personalbackup's own org check is a second line. */
test('#7404 review 4 nit 5: a bind answered for another org writes no record and says nothing was turned on', async (t) => {
  const root = fresh(t);
  const c = coordinator({ enrollOrg: { id: 'porg_other', name: 'x', slug: 'x', kind: 'personal' } });
  const p = await pb.preview({ root, remote: c });
  const r = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.equal(r.ok, false);
  assert.equal(pb.isOn({ root }), false, 'no record: the sentence below is true');
  assert.match(r.because, /nothing was turned on/);
});

/* Code review 5, as decided: the board never ends a membership its preview made. A decline, an expired ticket, an off
   with no record and the follow-up send NO leave; kosmos#7658 ends an unbound personal membership at a company or
   family join instead. Each arm checks a leave could be seen: the CONTROL arm turns it on and off, which does leave. */
test('#7404 review 5: decline, expiry, off with no record and the follow-up send no leave', async (t) => {
  const root = fresh(t);
  let now = 2_000_000_000_000;
  const at = () => now;
  const c = coordinator();
  const p = await pb.preview({ root, remote: c, now: at });
  await pb.switchOn(p.ticket, false, { root, remote: c, now: at });
  const p2 = await pb.preview({ root, remote: c, now: at });
  now += 11 * 60 * 1000;
  assert.equal((await pb.switchOn(p2.ticket, true, { root, remote: c, now: at })).code, 'ticket');
  pb._resetFollowUpForTests();
  await pb.followUp({ root, remote: c, now: at });
  await pb.switchOff({ root, remote: c, orgenroll: oe });
  assert.equal(LEAVE_N(c), 0, 'no leave from any of the four');
  assert.equal(c.member, true, 'the membership is left for the relay to end at a join');
  const root2 = fresh(t);
  const c2 = coordinator();
  const p3 = await pb.preview({ root: root2, remote: c2 });
  assert.equal((await pb.switchOn(p3.ticket, true, { root: root2, remote: c2, personalbackupkey: KEY_OK })).ok, true);
  await pb.switchOff({ root: root2, remote: c2, orgenroll: oe });
  assert.equal(LEAVE_N(c2), 1, 'CONTROL: on then off does send the leave');
});

/* Code review 5, warning 1: a preview whose status read is unanswered sends nothing (it could not check for a backup
   another computer runs, and would make a membership unseen); the same before an enroll, keeping the ticket. */
test('#7404 review 5: no status answer: no preview made, no enroll sent', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const real = c.macRequest;
  let down = true;
  c.macRequest = async (m, route, body) => (route === oe.ROUTES.status && down ? (c.sent.push({ route, body }), { ok: false, because: 'unreachable' }) : real(m, route, body));
  const r = await pb.preview({ root, remote: c });
  assert.equal(r.ok, false);
  assert.equal(c.sent.filter((x) => x.route === pb.ROUTE).length, 0, 'no membership made');
  down = false;
  const p = await pb.preview({ root, remote: c });
  down = true;
  const on = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.equal(on.ok, false);
  assert.equal(c.sent.filter((x) => x.route === oe.ROUTES.enroll).length, 0, 'no enroll sent');
  assert.equal(pb._TICKETS.has(p.ticket), true, 'nothing sent: the ticket is kept for a retry');
});

/* Code review 5, NIT: status is read even with a record here, so a stale record (another computer took the binding
   since the last refresh) cannot move it back. */
test('#7404 review 5: a stale record here does not skip the elsewhere check', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  assert.equal((await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK })).ok, true);
  assert.equal(pb.isOn({ root }), true, 'precondition: a record here');
  const real = c.macRequest;
  c.macRequest = async (m, route, body) => (route === oe.ROUTES.status ? (c.sent.push({ route, body }), ON_B) : real(m, route, body));
  assert.equal((await pb.preview({ root, remote: c })).code, 'personal_on_elsewhere');
});

/* Code review 5, warning 2: a recovery code still waiting to be shown and confirmed reads needs-key, so the screen runs
   the key step again (which answers the same code); confirmed, it reads on. */
test('#7404 review 5: a recovery code not yet confirmed reads needs-key', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  let pending = true;
  const keys = { setUpPersonalKey: async () => ({ ok: true, code: 'TEST-CODE', epoch: 1, org: ORG.id, member: 'acct_1' }), hasPendingCode: (o, m) => pending && o === ORG.id && m === 'acct_1' };
  const p = await pb.preview({ root, remote: c });
  const r = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: keys });
  assert.deepEqual([r.ok, r.org, r.member], [true, ORG.id, 'acct_1'], 'the screen gets what confirm needs');
  assert.equal(pb.state({ root, personalbackupkey: keys }), 'needs-key');
  pending = false;
  assert.equal(pb.state({ root, personalbackupkey: keys }), 'on', 'CONTROL: confirmed reads on');
});


/* Code review 6, warning 3: the account joined another org since the preview: refused here, no enroll sent. */
test('#7404 review 6: an account in another org since the preview sends no enroll', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  const real = c.macRequest;
  c.macRequest = async (m, route, body) => (route === oe.ROUTES.status ? (c.sent.push({ route, body }), { ok: true, data: { member: true, org: { id: 'acme', kind: 'company' }, enrolled: null } }) : real(m, route, body));
  const r = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.equal(r.code, 'org_other_org');
  assert.equal(c.sent.filter((x) => x.route === oe.ROUTES.enroll).length, 0);
});

/* Warning 4: the key step runs only while Kosmos+ still names this record's personal org, bound to this computer. */
test('#7404 review 6: the key step refuses when Kosmos+ no longer names this binding', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  assert.equal((await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK })).ok, true);
  let called = 0;
  const keys = { setUpPersonalKey: async () => { called++; return { ok: true, code: 'X', epoch: 1 }; } };
  const real = c.macRequest;
  c.macRequest = async (m, route, body) => (route === oe.ROUTES.status ? { ok: true, data: { member: true, org: { id: 'acme', kind: 'company' }, enrolled: { computer: 'c1', world: 'w', thisComputer: true } } } : real(m, route, body));
  const r = await pb.setUpKey({ root, remote: c, personalbackupkey: keys });
  assert.equal(r.code, 'not_on');
  assert.equal(called, 0, 'no key step against another org');
  c.macRequest = real;
  assert.equal((await pb.setUpKey({ root, remote: c, personalbackupkey: keys })).ok, true, 'CONTROL: this binding named, the key step runs');
});

/* Warning 2: a lost join reads pending, and an off waits for it to settle rather than strand a binding. */
test('#7404 review 6: a lost join reads pending and an off does not clear it', async (t) => {
  const root = fresh(t);
  fs.writeFileSync(path.join(root, oe.JOIN_UNKNOWN_FILE), JSON.stringify({ at: new Date().toISOString(), orgId: ORG.id }));
  assert.equal(pb.state({ root }), 'pending');
  const stub = { JOIN_UNKNOWN_FILE: oe.JOIN_UNKNOWN_FILE, LEAVE_PENDING_FILE: oe.LEAVE_PENDING_FILE, readEnrollment: () => null,
    // As orgenroll's leave with no record (leaveNow's local-only branch): it clears the join marker and answers ok,
    // which is the stranding this guards against (a throwing stub here read as pending either way: mutant M4 green).
    refresh: async () => ({ ok: false }), leave: async () => { fs.rmSync(path.join(root, oe.JOIN_UNKNOWN_FILE), { force: true }); return { ok: true, localOnly: true }; } };
  const r = await pb.switchOff({ root, orgenroll: stub });
  assert.equal(r.pending, true);
  assert.equal(fs.existsSync(path.join(root, oe.JOIN_UNKNOWN_FILE)), true, 'the join marker is kept');
});

/* NIT 1: a decline while an accept on the same ticket is in flight does not say nothing was turned on. */
test('#7404 review 6: a decline during an accept in flight is told it is under way', async (t) => {
  const root = fresh(t);
  let release;
  const gate = new Promise((res) => { release = res; });
  t.after(() => release());
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  const real = c.macRequest;
  c.macRequest = async (m, route, body) => { if (route === oe.ROUTES.enroll) await gate; return real(m, route, body); };
  const on = pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  await new Promise((res) => setTimeout(res, 20));
  const d = await pb.switchOn(p.ticket, false, { root, remote: c });
  assert.equal(d.code, 'busy');
  release();
  assert.equal((await on).ok, true);
});

/* Code review 7, warning 1: a restart between Kosmos+ binding this computer and the record being written. The in-flight
   marker makes it 'pending', not 'off'; the follow-up drops it when Kosmos+ did not bind this computer, and keeps it
   (with an off that says how out) when it did. */
test('#7404 review 7: an enroll interrupted by a restart reads pending until status settles it', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  // The enroll lands on Kosmos+, then the board dies before orgenroll writes its record. Modelled after the fact (an
  // enroll that throws is settled by orgenroll's own lost-answer read, so it cannot stand in): a normal bind, then the
  // record and join marker gone and the in-flight marker back, as a restart in that gap would find them.
  await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  for (const f of [oe.ENROLLMENT_FILE, oe.JOIN_UNKNOWN_FILE]) fs.rmSync(path.join(root, f), { force: true });
  fs.writeFileSync(path.join(root, 'personal-enrolling.json'), JSON.stringify({ org: ORG.id, at: Date.now() }));
  assert.equal(pb.isOn({ root }), false, 'precondition: no record here');
  assert.equal(pb.state({ root }), 'pending');
  const off = await pb.switchOff({ root, remote: c, orgenroll: oe });
  assert.equal(off.pending, true);
  assert.match(off.because, /on again here/);
  // CONTROL: not bound here (another computer, or nothing): the follow-up drops it and the state is off.
  const root2 = fresh(t);
  const c2 = coordinator();
  fs.writeFileSync(path.join(root2, 'personal-enrolling.json'), JSON.stringify({ org: ORG.id, at: Date.now() }));
  assert.equal(pb.state({ root: root2 }), 'pending');
  pb._resetFollowUpForTests();
  await pb.followUp({ root: root2, remote: c2 });
  assert.equal(pb.state({ root: root2 }), 'off');
});

/* NIT 5: a coded-less refusal is a refusal, not "could not be reached". */
test('#7404 review 7: an uncoded refusal at the preview is not called unreachable', async (t) => {
  const root = fresh(t);
  const r = await pb.preview({ root, remote: coordinator({ preview: { ok: false, because: '401 bad signature', refusal: { status: 401 } } }) });
  assert.match(r.because, /refused/);
  assert.doesNotMatch(r.because, /could not be reached/);
});

/* NIT 1: the key step needs this record's world bound, so another board on this computer is never set up from here. */
test('#7404 review 7: the key step refuses when Kosmos+ binds another world on this computer', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  assert.equal((await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK })).ok, true);
  const real = c.macRequest;
  c.macRequest = async (m, route, body) => (route === oe.ROUTES.status ? { ok: true, data: { member: true, org: ORG, enrolled: { computer: 'c1', world: 'e'.repeat(32), thisComputer: true } } } : real(m, route, body));
  assert.equal((await pb.setUpKey({ root, remote: c, personalbackupkey: KEY_OK })).code, 'not_on');
});

/* Code review 8, warning 3: the marker is written for the whole enroll (held on a gate) and gone after it. */
test('#7404 review 8: the in-flight marker is down while the enroll is held, and gone after', async (t) => {
  const root = fresh(t);
  let release;
  const gate = new Promise((res) => { release = res; });
  t.after(() => release());
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  const real = c.macRequest;
  c.macRequest = async (m, route, body) => { if (route === oe.ROUTES.enroll) await gate; return real(m, route, body); };
  const on = pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(fs.existsSync(path.join(root, 'personal-enrolling.json')), true, 'down while the enroll is out');
  assert.equal(pb.state({ root }), 'pending');
  release();
  assert.equal((await on).ok, true);
  assert.equal(fs.existsSync(path.join(root, 'personal-enrolling.json')), false, 'gone once answered');
});

/* Warning 1: with a marker and no answer from Kosmos+, Off says it is not known, never that Kosmos+ holds a binding. */
test('#7404 review 8: an off with a marker and no status answer says not known', async (t) => {
  const root = fresh(t);
  fs.writeFileSync(path.join(root, 'personal-enrolling.json'), JSON.stringify({ org: ORG.id, at: Date.now() }));
  const c = coordinator();
  c.macRequest = async () => ({ ok: false, because: 'unreachable' });
  const off = await pb.switchOff({ root, remote: c, orgenroll: oe });
  assert.equal(off.pending, true);
  assert.match(off.because, /not known yet/);
  assert.doesNotMatch(off.because, /lost its record/);
});

/* Warning 2: a marker here while ANOTHER Kosmos on this Mac holds the binding (other world) is dropped, not kept. */
test('#7404 review 8: a binding to another world on this Mac does not keep this Kosmos pending', async (t) => {
  const root = fresh(t);
  fs.writeFileSync(path.join(root, oe.WORLD_ID_FILE), 'a'.repeat(32) + '\n');
  fs.writeFileSync(path.join(root, 'personal-enrolling.json'), JSON.stringify({ org: ORG.id, at: Date.now() }));
  const c = coordinator({ preexisting: true, statusAnswer: { ok: true, data: { member: true, org: ORG, enrolled: { computer: 'c1', world: 'd'.repeat(32), thisComputer: true } } } });
  pb._resetFollowUpForTests();
  await pb.followUp({ root, remote: c });
  assert.equal(pb.state({ root }), 'off');
});

/* kosmos#7661 item 1: the enroll carries onlyIfFree, and Kosmos+'s refusal of it (another computer, or another Kosmos on
   this one, bound between the status read and the enroll) is said in this module's words, the ticket spent. */
test('#7404/#7661: the enroll sends onlyIfFree, and a bound-elsewhere refusal is told as such', async (t) => {
  for (const [code, words] of [['org_bound_elsewhere', /another of your computers/], ['org_bound_other_world', /another Kosmos on this computer/]]) {
    const root = fresh(t);
    const c = coordinator({ boundElsewhere: code });
    const p = await pb.preview({ root, remote: c });
    const r = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
    const sent = c.sent.filter((x) => x.route === oe.ROUTES.enroll);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.onlyIfFree, true, 'the flag was not sent');
    assert.equal(r.code, code, code + ': told as a refusal, not a lost answer');
    assert.match(r.because, words);
    assert.equal(pb.isOn({ root }), false);
    assert.equal(fs.existsSync(path.join(root, oe.JOIN_UNKNOWN_FILE)), false, 'a coded refusal left a lost-join marker');
    assert.equal(pb._TICKETS.has(p.ticket), false, 'Kosmos+ answered: the ticket is spent');
  }
});


/* backupscreens-7404 challenge round 5: restore acts only on this computer's own personal backup, and a restore that
   worked reads 'on' (it writes the key-ready marker, as the key step does). */
test('#7404 restore: refused before any key is touched unless personal backup is on here and Kosmos+ names it', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  let called = 0;
  const keys = { setUpPersonalKey: KEY_OK.setUpPersonalKey, hasPendingCode: () => false,
    restorePersonalKey: async () => { called++; return { ok: true, epochs: [1] }; } };
  const off = await pb.restore('CODE', { root, remote: c, personalbackupkey: keys });
  assert.equal(off.code, 'not_on'); assert.equal(called, 0, 'restored with personal backup off here');
  const p = await pb.preview({ root, remote: c });
  // Turned on here, but the key step found the backup set up elsewhere: needs-key, the one state a restore is for.
  const taken = Object.assign({}, keys, { setUpPersonalKey: async () => ({ ok: false, code: 'already_set_up', because: 'set up elsewhere' }) });
  assert.equal((await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: taken })).code, 'restore');
  const real = c.macRequest;
  c.macRequest = async (m, route, body) => (route === oe.ROUTES.status ? { ok: true, data: { member: true, org: { id: 'acme', kind: 'company' }, enrolled: { computer: 'c1', world: 'w', thisComputer: true } } } : real(m, route, body));
  const company = await pb.restore('CODE', { root, remote: c, personalbackupkey: keys });
  assert.equal(company.code, 'not_on'); assert.equal(called, 0, 'restored against a company membership');
  c.macRequest = real;
  const ok = await pb.restore('CODE', { root, remote: c, personalbackupkey: keys });
  assert.deepEqual(ok, { ok: true, epochs: [1] }, 'CONTROL: this binding named, the restore runs');
  assert.equal(called, 1);
});

test('#7404 restore: a restore that worked reads on; a refused one leaves the state as it was', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  // The key step refused: another computer already set this backup up (the move to a new computer).
  const taken = { setUpPersonalKey: async () => ({ ok: false, code: 'already_set_up', because: 'set up elsewhere' }), hasPendingCode: () => false,
    restorePersonalKey: async () => ({ ok: false, code: 'wrong_code', because: 'that recovery code is not the one for this backup' }) };
  const on = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: taken });
  assert.equal(on.code, 'restore', JSON.stringify(on));
  assert.equal(pb.state({ root, personalbackupkey: taken }), 'needs-key');
  const wrong = await pb.restore('CODE', { root, remote: c, personalbackupkey: taken });
  assert.equal(wrong.code, 'wrong_code');
  assert.equal(pb.state({ root, personalbackupkey: taken }), 'needs-key', 'a refused restore wrote the marker');
  const right = Object.assign({}, taken, { restorePersonalKey: async () => ({ ok: true, epochs: [1, 2] }) });
  assert.equal((await pb.restore('CODE', { root, remote: c, personalbackupkey: right })).ok, true);
  assert.equal(pb.state({ root, personalbackupkey: right }), 'on');
});

test('#7404 restore: refused once the key is set up here (it would drop a code still waiting to be shown)', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  let called = 0;
  const keys = { setUpPersonalKey: KEY_OK.setUpPersonalKey, hasPendingCode: () => false,
    restorePersonalKey: async () => { called++; return { ok: true, epochs: [1] }; } };
  const p = await pb.preview({ root, remote: c });
  assert.equal((await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: keys })).ok, true);
  assert.equal(pb.state({ root, personalbackupkey: keys }), 'on');
  const r = await pb.restore('CODE', { root, remote: c, personalbackupkey: keys });
  assert.equal(r.code, 'not_needed', JSON.stringify(r)); assert.equal(called, 0);
});

test('#7404 restore: refused while a recovery code made here waits to be saved (needs-key from a pending code)', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  let called = 0; let pending = true;
  const keys = { setUpPersonalKey: async () => ({ ok: true, code: 'MADE-HERE', epoch: 1, org: 'korg', member: 'kmem' }),
    hasPendingCode: (o, m) => pending && o === 'korg' && m === 'kmem',
    restorePersonalKey: async () => { called++; return { ok: true, epochs: [1] }; } };
  const p = await pb.preview({ root, remote: c });
  assert.equal((await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: keys })).ok, true);
  assert.equal(pb.state({ root, personalbackupkey: keys }), 'needs-key', 'the code made here is not confirmed yet');
  const r = await pb.restore('CODE', { root, remote: c, personalbackupkey: keys });
  assert.equal(r.code, 'code_waiting', JSON.stringify(r)); assert.equal(called, 0, 'a restore would have dropped the code');
  pending = false;   // CONTROL: confirmed, so state reads on and the restore is refused as not needed instead
  assert.equal((await pb.restore('CODE', { root, remote: c, personalbackupkey: keys })).code, 'not_needed');
});

/* #7681 item 3: restore() reads the record before its awaits. Turning personal backup off in either window must stop the
   restore there: after Kosmos+'s check (it answered "bound" before the turn-off), no keys are restored; after the restore
   itself, no key-ready marker is written for a binding that is gone. */
test('#7681 restore: a turn-off while Kosmos+ is asked stops the restore before any key is touched', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  let restored = 0;
  const taken = { setUpPersonalKey: async () => ({ ok: false, code: 'already_set_up', because: 'set up elsewhere' }), hasPendingCode: () => false,
    restorePersonalKey: async () => { restored++; return { ok: true, epochs: [1] }; } };
  assert.equal((await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: taken })).code, 'restore');
  // Kosmos+ answers "bound here" (true when asked), then the turn-off lands before restore() goes on.
  let flipped = false;
  const racing = { macRequest: async (m, route, b) => {
    const r = await c.macRequest(m, route, b);
    if (route === oe.ROUTES.status && !flipped) { flipped = true; await pb.switchOff({ root, remote: c }); }
    return r;
  } };
  const res = await pb.restore('CODE', { root, remote: racing, personalbackupkey: taken });
  assert.equal(flipped, true, 'premise: the turn-off ran inside the status read');
  assert.equal(res.ok, false, JSON.stringify(res));
  assert.match(res.because, /changed on this computer while restoring/);
  assert.equal(restored, 0, 'keys were restored for a binding turned off meanwhile');
  assert.equal(fs.existsSync(path.join(root, 'personal-key-ready')), false, 'a key-ready marker was written');
});

test('#7681 restore: a turn-off during the restore itself writes no key-ready marker', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c });
  const taken = { setUpPersonalKey: async () => ({ ok: false, code: 'already_set_up', because: 'set up elsewhere' }), hasPendingCode: () => false,
    restorePersonalKey: async () => ({ ok: true, epochs: [1] }) };
  assert.equal((await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: taken })).code, 'restore');
  const racing = Object.assign({}, taken, { restorePersonalKey: async () => { await pb.switchOff({ root, remote: c }); return { ok: true, epochs: [1] }; } });
  const res = await pb.restore('CODE', { root, remote: c, personalbackupkey: racing });
  assert.equal(res.ok, false, JSON.stringify(res));
  assert.match(res.because, /restored here, but personal backup changed/, 'the keys WERE restored by then: the message must say so');
  assert.equal(fs.existsSync(path.join(root, 'personal-key-ready')), false, 'a key-ready marker was written for a binding turned off');
  // CONTROL: the same restore with no turn-off writes the marker and reads on.
  const root2 = fresh(t);
  const p2 = await pb.preview({ root: root2, remote: c });
  assert.equal((await pb.switchOn(p2.ticket, true, { root: root2, remote: c, personalbackupkey: taken })).code, 'restore');
  assert.equal((await pb.restore('CODE', { root: root2, remote: c, personalbackupkey: taken })).ok, true);
  assert.equal(pb.state({ root: root2, personalbackupkey: taken }), 'on');
});

/* #7681 item 1: the price shown must be the price Kosmos+ bills. Kosmos+'s preview answer has to carry the same figure,
   or nothing goes past the preview; and a ticket whose confirmed price the screen no longer shows binds nothing. */
test('#7681 price: no price from Kosmos+, or a different one, stops at the preview; the same one proceeds', async (t) => {
  const answer = (price) => ({ ok: true, data: Object.assign({ org: ORG, role: 'member', consent: WORDS, consentHash: HASH, computerSalt: SALT }, price === undefined ? {} : { price }) });
  for (const [label, price] of [['no price', undefined], ['a different price', '$6/month'], ['a price in no Stripe shape', 'five dollars']]) {
    const root = fresh(t);
    const r = await pb.preview({ root, remote: coordinator({ preview: answer(price) }), shownPrice: '$5/month' });
    assert.deepEqual([r.ok, r.code], [false, 'price_unconfirmed'], label + ': ' + JSON.stringify(r));
    assert.equal(r.ticket, undefined, label + ': a ticket was issued');
  }
  // CONTROL: Kosmos+ confirms the same figure, so the words are served.
  const ok = await pb.preview({ root: fresh(t), remote: coordinator({ preview: answer('$5/month') }), shownPrice: '$5/month' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(typeof ok.ticket, 'string');
  // Review 2: the confirmed price goes back to the screen with the words (the words screen shows it).
  assert.equal(ok.price, '$5/month', 'the preview answer lost the confirmed price');
});

test('#7681 price: the screen\'s price changed after the preview, so switchOn binds nothing', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ root, remote: c, shownPrice: null });
  assert.equal(p.ok, true, 'premise: the preview served words (no price on either side)');
  const r = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK, shownPrice: '$5/month' });
  assert.deepEqual([r.ok, r.code], [false, 'price_unconfirmed'], JSON.stringify(r));
  assert.equal(c.sent.filter((x) => x.route === oe.ROUTES.enroll).length, 0, 'it enrolled this computer anyway');
  assert.equal(pb.isOn({ root }), false);
  // CONTROL: the same price as the preview binds.
  const root2 = fresh(t);
  const c2 = coordinator();
  const p2 = await pb.preview({ root: root2, remote: c2, shownPrice: null });
  assert.equal((await pb.switchOn(p2.ticket, true, { root: root2, remote: c2, personalbackupkey: KEY_OK, shownPrice: null })).ok, true);
});
