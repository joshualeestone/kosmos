'use strict';
/* kosmos#6239 (Kosmos+Kids slice 2): a family's words (kosmos-relay org.rs family_consent) name the same reports in a
   family's words, so the board's checks that key on a phrase must read them too: the policy line (NAMES_POLICY) and the
   agent-events line ("stopped by the family's rules"). A preview keeps the org's kind; anything but 'family' is a company. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const FLEET_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'familywords-6239-'));
process.env.AGENT_WORKFORCE_DATA = path.join(FLEET_SANDBOX, 'data');
process.env.AGENT_WORKFORCE_HOME = path.join(FLEET_SANDBOX, 'home');
process.env.AGENT_WORKFORCE_WORKERS = path.join(FLEET_SANDBOX, 'workers');
test.after(() => fs.rmSync(FLEET_SANDBOX, { recursive: true, force: true }));
const oe = require('./orgenroll');
const ae = require('./agentevents');

const HASH = 'cd'.repeat(32);
const FAMILY = {
  reports: [
    "which version of the family's policy this Kosmos has applied, and whether it refused one the family sent",
    "how much of the family's monthly AI cap this computer has used this month, when the family's policy sets one",
    "the agent, project and activity lines above from every Kosmos on this computer, not only this one",
    "when one of the agents on this computer is stopped by the family's rules: which agent, the kind of thing it tried, the conversation it was in, and when",
  ],
  backsUp: [], readers: ['the person who uses this computer'], never: ['keys and passwords'],
};
function coordinator(kind) {
  const org = { id: 'o', name: 'Rivera', slug: 'rivera', ...(kind === undefined ? {} : { kind }) };
  let w = null;
  return {
    macRequest: async (m, route, body) => {
      if (route === oe.ROUTES.redeem) return { ok: true, data: { org, role: 'member', consent: FAMILY, consentHash: HASH } };
      if (route === oe.ROUTES.enroll) { w = body.world; return { ok: true, data: { ok: true, org, role: 'member', enrolled: { computer: 'c', world: w, thisComputer: true } } }; }
      if (route === oe.ROUTES.status) return { ok: true, data: { member: true, org, role: 'member', enrolled: { computer: 'c', world: w, thisComputer: true } } };
      if (route === ae.ROUTE) return { ok: true, data: { ok: true, added: body.events.length } };
      return { ok: false, because: 'unexpected ' + route };
    },
  };
}
const root = (t) => { const r = fs.mkdtempSync(path.join(os.tmpdir(), 'familywords-6239-root-')); t.after(() => fs.rmSync(r, { recursive: true, force: true })); return r; };

test('#6239: a preview keeps the kind: family is family, anything else (or none) is a company', async (t) => {
  for (const [kind, want] of [['family', 'family'], ['company', 'company'], [undefined, 'company'], ['Family', 'company'], ['school', 'company']]) {
    const r = await oe.preview('RIVE-JOIN-1234', { root: root(t), remote: coordinator(kind) });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.org.kind, want, String(kind));
  }
});

test('#6239: a family\'s accepted words turn on the policy line and the agent-event reports, as a company\'s do', async (t) => {
  const r = root(t);
  const c = coordinator('family');
  const pv = await oe.preview('RIVE-JOIN-1234', { root: r, remote: c });
  const en = await oe.enroll('RIVE-JOIN-1234', true, { root: r, remote: c, consentHash: pv.served, consent: pv.consent, orgId: pv.org.id, wordsShown: true });
  assert.equal(en.ok, true, JSON.stringify(en));
  const words = oe.acceptedConsent({ root: r, remote: c });
  assert.equal(words.policyConsented, true, 'the family\'s policy line was not read as the policy line');
  assert.equal(words.everyKosmosConsented, true);
  assert.equal(words.capConsented, true, 'kosmos#6309: the family\'s cap line was not read as consent to send the month\'s count');
  assert.equal(words.usageConsented, false, 'kosmos#6309: the cap line was read as consent to per-day usage, which the coordinator refuses');
  assert.deepEqual(ae.recordRefusal({ agent: 'Scout', rule: 'quiet-hours' }, { root: r, remote: c, platform: 'darwin' }), { queued: true },
    'a family\'s events line did not let the board report its own refusals');
  // CONTROL: words that name neither phrase turn on neither.
  const r2 = root(t);
  const plain = { ...c, macRequest: async (m, route, body) => {
    if (route === oe.ROUTES.redeem) return { ok: true, data: { org: { id: 'o', name: 'X', slug: 'x', kind: 'family' }, role: 'member', consent: { reports: ['agent names'], backsUp: [], readers: ['you'], never: ['keys'] }, consentHash: HASH } };
    return c.macRequest(m, route, body);
  } };
  const pv2 = await oe.preview('RIVE-JOIN-1234', { root: r2, remote: plain });
  await oe.enroll('RIVE-JOIN-1234', true, { root: r2, remote: plain, consentHash: pv2.served, consent: pv2.consent, orgId: 'o', wordsShown: true });
  assert.equal(oe.acceptedConsent({ root: r2, remote: plain }).policyConsented, false, 'CONTROL');
  assert.equal(oe.acceptedConsent({ root: r2, remote: plain }).capConsented, false, 'CONTROL: no cap line');
  assert.equal(ae.recordRefusal({ agent: 'Scout', rule: 'quiet-hours' }, { root: r2, remote: plain, platform: 'darwin' }).queued, false, 'CONTROL');
});

test('#6239 round 1: an automatic accept, or an enroll with no hash of the words shown, never says the words were shown', async (t) => {
  const bodies = [];
  const r = root(t);
  const base = coordinator('family');
  const c = { macRequest: async (m, route, body) => { if (route === oe.ROUTES.enroll) bodies.push(body); return base.macRequest(m, route, body); } };
  // A shown join, with the hash: wordsShown goes (CONTROL: the probe can see it).
  const pv = await oe.preview('RIVE-JOIN-1234', { root: r, remote: c });
  await oe.enroll('RIVE-JOIN-1234', true, { root: r, remote: c, consentHash: pv.served, consent: pv.consent, orgId: 'o', wordsShown: true });
  assert.equal(bodies.at(-1).wordsShown, true, 'CONTROL');
  // wordsShown with no hash, or a malformed one: not sent.
  for (const consentHash of [undefined, 'not-a-hash']) {
    const r2 = root(t);
    const own = coordinator('family');   // its own, so this enroll's world does not replace r's
    const c2 = { macRequest: async (m, route, body) => { if (route === oe.ROUTES.enroll) bodies.push(body); return own.macRequest(m, route, body); } };
    await oe.enroll('RIVE-JOIN-1234', true, { root: r2, remote: c2, consentHash, consent: pv.consent, orgId: 'o', wordsShown: true });
    assert.equal('wordsShown' in bodies.at(-1), false, 'wordsShown sent without the hash of the words: ' + String(consentHash));
  }
  // The board's own re-accept of changed words (reacceptWords): never claims a parent saw them. The family's words
  // changed since (status serves another hash with them), so the board does send an enroll.
  const changed = { macRequest: async (m, route, body) => {
    if (route === oe.ROUTES.status) {
      const st = await c.macRequest(m, route, body);
      st.data.consent = FAMILY; st.data.consentHash = 'ef'.repeat(32);
      return st;
    }
    return c.macRequest(m, route, body);
  } };
  // As the rollup does when the coordinator refuses a report for changed words: the old words are withdrawn first.
  assert.equal(await oe.consentWithdrawn({ root: r }, pv.served), true, 'CONTROL: the accepted words were withdrawn');
  const before = bodies.length;
  await oe.reacceptWords({ root: r, remote: changed, wordsShown: true });
  const re = bodies.slice(before);
  assert.ok(re.length >= 1, 'CONTROL: the re-accept sent an enroll: ' + JSON.stringify(re));
  for (const b of re) assert.equal('wordsShown' in b, false, 'an automatic accept said the words were shown: ' + JSON.stringify(b));
});
