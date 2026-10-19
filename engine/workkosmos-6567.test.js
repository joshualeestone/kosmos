'use strict';

/**
 * kosmos#6567 (follow-up from #6565): sentences that pass through neither the page's plusOrgIn nor the engine's inKind
 * still said "work Kosmos" to a family. Here: the engine's review refusals, and the stopped note's kind, which the
 * board now keeps beside the stopped org's name so the screen can say it in the family's words after the record that
 * knew the kind is gone. Driven through the real engine against a fake coordinator, as orgenroll-5531.test.js does.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const org = require('./orgenroll');

const CONSENT = { version: 1, reads: ['agents'], says: 'The family reads which agents run.' };

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workkosmos-6567-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
/* A coordinator for one org: enroll confirms this world; status answers per `state`. */
function remoteFor(ORG, state) {
  return {
    macRequest: async (method, route, body) => {
      if (route === org.ROUTES.redeem) return { ok: true, data: { org: ORG, role: 'member', consent: CONSENT } };
      if (route === org.ROUTES.enroll) {
        state.world = body.world;
        return { ok: true, data: { ok: true, org: ORG, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
      }
      if (route === org.ROUTES.status) {
        return { ok: true, data: { member: true, org: ORG, role: 'member', enrolled: state.named ? { computer: 'c1', world: state.world, thisComputer: true } : null } };
      }
      return { ok: false, because: 'unknown route ' + route };
    },
  };
}

for (const [kind, name, says] of [['family', 'The Riveras', 'is no longer your family\'s Kosmos'], ['company', 'Acme', 'is no longer your work Kosmos']]) {
  test(`#6567: a ${kind} that stops naming this world leaves its kind beside its name for the screen's note`, async (t) => {
    const root = sandbox(t);
    const ORG = { id: 'org_1', name, slug: name.toLowerCase().replace(/\W/g, ''), kind };
    const state = { named: true };
    const r = await org.enroll('JOIN-CODE-1234', true, { root, remote: remoteFor(ORG, state), orgKind: kind });
    assert.equal(org.isEnrolledHere({ root }), true, 'CONTROL: the join recorded this world: ' + JSON.stringify(r));
    state.named = false;
    await org.refresh({ root, remote: remoteFor(ORG, state) });
    assert.equal(org.isEnrolledHere({ root }), false, 'CONTROL: the org stopped naming this world');
    assert.equal(org.stoppedFor({ root }), name);
    assert.equal(org.stoppedKind({ root }), kind, 'the stopped note lost the org\'s kind');
    // The review Accept after the record went is refused in the org's words (enrollNow's org_not_here).
    const refused = await org.enroll(null, true, { root, review: true, orgKind: kind, remote: remoteFor(ORG, state) });
    assert.equal(refused.code, 'org_not_here', JSON.stringify(refused));
    assert.ok(refused.because.includes(says), refused.because);
    if (kind === 'family') assert.equal(/work Kosmos/.test(refused.because), false, 'a family was told "work Kosmos"');
  });
}

test('#6567: a stopped note written before kinds were kept reads as a company\'s', (t) => {
  const root = sandbox(t);
  fs.writeFileSync(path.join(root, org.STOPPED_FILE || 'org-stopped.json'), JSON.stringify({ at: new Date().toISOString(), name: 'Acme' }) + '\n');
  assert.equal(org.stoppedFor({ root }), 'Acme', 'CONTROL: the old note is read');
  assert.equal(org.stoppedKind({ root }), 'company');
});

test('#6567: the review refusal on a Kosmos that is not the family\'s says the family\'s words', () => {
  const SENTENCE = 'This Kosmos is not your work Kosmos, so there is nothing to review here.';
  const src = fs.readFileSync(path.join(__dirname, 'orgenroll.js'), 'utf8');
  assert.ok(src.includes("because: inKind(KIND, '" + SENTENCE + "')"), 'reviewHere\'s refusal does not go through inKind');
  assert.equal(org.inKind('family', SENTENCE), 'This Kosmos is not your family\'s Kosmos, so there is nothing to review here.');
  assert.equal(org.inKind('company', SENTENCE), SENTENCE, 'CONTROL: a company keeps its words');
});
