'use strict';
/* kosmos#6263 (board half): a family's policy is said as the family's. The create refusals (orgpolicy.allows), the
   agent's instruction block (policy.blockBody/stackedBody and its provenance line) and the oversize refusal all read
   the kind of the org this Kosmos is enrolled to. A company's, and a Kosmos in no org, keep their bytes exactly, so no
   company agent's instruction file is rewritten. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const FLEET_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'familypolicy-6263-'));
process.env.AGENT_WORKFORCE_DATA = path.join(FLEET_SANDBOX, 'data');
process.env.AGENT_WORKFORCE_HOME = path.join(FLEET_SANDBOX, 'home');
process.env.AGENT_WORKFORCE_WORKERS = path.join(FLEET_SANDBOX, 'workers');
test.after(() => fs.rmSync(FLEET_SANDBOX, { recursive: true, force: true }));
const store = require('./store');
const oe = require('./orgenroll');
const orgpolicy = require('./orgpolicy');
const policy = require('./policy');

const REC = path.join(store.ROOT, oe.ENROLLMENT_FILE);
function enrolledAs(kind) {
  fs.mkdirSync(store.ROOT, { recursive: true });
  if (kind === null) { fs.rmSync(REC, { force: true }); return; }
  fs.writeFileSync(REC, JSON.stringify({ org: { id: 'o', name: 'Rivera', slug: 'rivera', kind }, role: 'member', world: 'a'.repeat(32) }));
}
const POLICY = { providers_allowed: ['anthropic'], models_allowed: { anthropic: ['opus'] } };
const ENTRY = { source: 'company', name: 'Rivera', text: 'Be kind.', savedAt: '2026-10-15T00:00:00Z' };

test('#6263: the sandbox record is read as the enrolled org (the control for every test below)', () => {
  enrolledAs('family');
  assert.equal(oe.kindHere(), 'family');
  enrolledAs(null);
  assert.equal(oe.kindHere(), null);
});

test('#6263: a create refused by a family\'s policy says the family\'s; a company\'s and no org\'s keep their words', () => {
  const asked = [{ provider: 'openai', model: 'gpt' }, { provider: 'anthropic' }, { provider: 'anthropic', model: 'haiku' }];
  for (const kind of ['family', 'company', null]) {
    enrolledAs(kind);
    for (const a of asked) {
      const r = orgpolicy.allows(a, POLICY);
      assert.equal(r.ok, false, JSON.stringify(r));
      if (kind === 'family') assert.match(r.because, /^your family's policy /, r.because);
      else assert.match(r.because, /^your company's policy /, r.because);
    }
  }
  enrolledAs(null);
});

test('#6263: a family agent\'s policy block names the family; a company agent\'s block is byte-identical to before', () => {
  enrolledAs('company');
  const coOne = policy.blockBody(ENTRY);
  const coTwo = policy.stackedBody([ENTRY, { source: 'pasted', name: 'Mine', text: 'Be brief.', savedAt: ENTRY.savedAt }]);
  assert.ok(coOne.startsWith("## Your company's AI policy\n\nSet by your company in its Kosmos policy. Follow it"), coOne);
  assert.ok(coTwo.startsWith("## Your company's AI policies\n"), coTwo);
  enrolledAs(null);
  assert.equal(policy.blockBody(ENTRY), coOne, 'a Kosmos in no org changed its block');
  enrolledAs('family');
  const famOne = policy.blockBody(ENTRY);
  assert.ok(famOne.startsWith("## Your family's AI policy\n\nSet by your family in its Kosmos policy. Follow it"), famOne);
  assert.ok(!/company/i.test(famOne), famOne);
  assert.ok(policy.stackedBody([ENTRY]).startsWith("## Your family's AI policies\n"));
  enrolledAs(null);
});

test('#6263 board review 1: on a family\'s Kosmos the person\'s own policies are "Your AI policy", never said to be the family\'s; elsewhere as before', () => {
  const MINE = { source: 'pasted', name: 'Mine', text: 'Be brief.', savedAt: '2026-10-15T00:00:00Z' };
  enrolledAs('company');
  const coMine = policy.blockBody(MINE);
  const coStack = policy.stackedBody([MINE, { ...MINE, name: 'Also mine' }]);
  enrolledAs(null);
  assert.equal(policy.blockBody(MINE), coMine, 'a Kosmos in no org changed a pasted block');
  assert.ok(coMine.startsWith("## Your company's AI policy\n\nAdded by the person you work for"), coMine);
  enrolledAs('family');
  const famMine = policy.blockBody(MINE);
  assert.ok(famMine.startsWith('## Your AI policy\n\nAdded by the person you work for'), famMine);
  assert.ok(policy.stackedBody([MINE, { ...MINE, name: 'Also mine' }]).startsWith('## Your AI policies\n'));
  assert.ok(!/family|company/i.test(policy.stackedBody([MINE, { ...MINE, name: 'Also mine' }]).split('\n')[0]));
  // With the family's own policy in the stack, the heading is the family's.
  assert.ok(policy.stackedBody([ENTRY, MINE]).startsWith("## Your family's AI policies\n"));
  assert.ok(coStack.startsWith("## Your company's AI policies\n"), coStack);
  enrolledAs(null);
});
