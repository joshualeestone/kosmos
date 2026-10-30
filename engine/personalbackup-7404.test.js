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

/* A coordinator with the personal rules: personal-backup answers the words; the codeless enroll REFUSES without the
   served hash and wordsShown (org.rs: personal_backup_words_unseen); status names this world until a leave. */
function coordinator(over = {}) {
  const sent = [];
  let world = null, left = false;
  return {
    sent,
    macRequest: async (m, route, body) => {
      sent.push({ route, body: body == null ? null : JSON.parse(JSON.stringify(body)) });
      if (route === pb.ROUTE) return over.preview || { ok: true, data: { org: ORG, role: 'admin', consent: WORDS, consentHash: HASH, computerSalt: SALT } };
      if (route === oe.ROUTES.enroll) {
        if (body.consentHash !== HASH || body.wordsShown !== true) return { ok: false, because: '409 {"code":"personal_backup_words_unseen"}', refusal: { status: 409, code: 'personal_backup_words_unseen' } };
        world = body.world; left = false;
        return { ok: true, data: { ok: true, org: ORG, role: 'admin', printPinned: true, enrolled: { computer: 'c1', world, thisComputer: true } } };
      }
      if (route === oe.ROUTES.status) {
        if (left || !world) return { ok: true, data: { member: false } };
        return { ok: true, data: { member: true, org: ORG, role: 'admin', computerSalt: SALT, policy: null, enrolled: { computer: 'c1', world, thisComputer: true } } };
      }
      if (route === oe.ROUTES.leave) { left = true; return { ok: true, data: { ok: true, left: true } }; }
      return { ok: false, because: 'unexpected route ' + route };
    },
  };
}
const KEY_OK = { setUpPersonalKey: async () => ({ ok: true, code: 'TEST-CODE', epoch: 1 }) };

function fresh(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-personalswitch-7404-root-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); cp._testRunner(); });
  cp._testRunner(() => DUMP, { platform: 'darwin' });
  return root;
}
/* A company policy in force at store.ROOT: the two files orgpolicy keeps (the bundle and the applied record). */
function seedCompanyPolicy() {
  for (const f of [orgpolicy.BUNDLE(), orgpolicy.APPLIED()]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'COMPANY ' + path.basename(f)); }
}
const companyPolicy = () => [orgpolicy.BUNDLE(), orgpolicy.APPLIED()].map((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null));

test('#7404: on, followed up and off under its own root; a company policy at store.ROOT survives all three', async (t) => {
  const root = fresh(t);
  seedCompanyPolicy();
  const before = companyPolicy();
  const c = coordinator();
  const p = await pb.preview({ remote: c });
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.deepEqual(p.words, WORDS);
  const on = await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.equal(on.ok, true, JSON.stringify(on));
  assert.equal(on.code, 'TEST-CODE');
  assert.equal(pb.isOn({ root }), true);
  assert.deepEqual(companyPolicy(), before, 'a personal enroll changed the company policy');
  await pb.followUp({ root, remote: c });
  assert.deepEqual(companyPolicy(), before, 'a personal follow-up changed the company policy');
  const off = await pb.switchOff({ root, remote: c });
  assert.equal(off.ok, true, JSON.stringify(off));
  assert.equal(pb.isOn({ root }), false);
  assert.deepEqual(companyPolicy(), before, 'a personal leave changed the company policy');
});

test('#7404 CONTROL: the same leave WITHOUT the inert policy wipes the company policy (the test can see a wipe)', async (t) => {
  const root = fresh(t);
  seedCompanyPolicy();
  const c = coordinator();
  const p = await pb.preview({ remote: c });
  await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  await oe.leave({ root, remote: c });   // orgenroll's default policy: the real orgpolicy at store.ROOT
  assert.notDeepEqual(companyPolicy(), ['COMPANY org_policy.kst', 'COMPANY org-policy-applied.json'], 'control: a leave without the inert policy left the company policy, so the main test proves nothing');
});

test('#7404: the enroll carries the served hash, wordsShown and org; a ticket is used once', async (t) => {
  const root = fresh(t);
  const c = coordinator();
  const p = await pb.preview({ remote: c });
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
  const p = await pb.preview({ remote: c });
  await pb.switchOn(p.ticket, true, { root, remote: c, personalbackupkey: KEY_OK });
  assert.equal(fs.existsSync(path.join(root, oe.ENROLLMENT_FILE)), true, 'control: the personal record is under its own root');
  assert.equal(fs.existsSync(path.join(store.ROOT, oe.ENROLLMENT_FILE)), false, 'a personal enroll wrote the company record');
  assert.equal(oe.readEnrollment(), null);
  assert.equal(oe.mayReport(), false, 'a personal backup made the company side report');
  assert.notEqual(pb.root(), store.ROOT);
});

test('#7404: words that report anything, a non-personal org, or no hash are refused at the preview', async (t) => {
  fresh(t);
  const base = { org: ORG, role: 'admin', consent: WORDS, consentHash: HASH, computerSalt: SALT };
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
