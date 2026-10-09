'use strict';

/**
 * #5534 slice 3: the company's AI policy text, from the company policy an enrolled Kosmos has applied
 * (engine/orgpolicy.js), reaches every agent through the same managed block as the person's own policies
 * (engine/policy.js). Sandbox-every-root, the same shape as engine/policy.test.js.
 *
 *   node --test engine/policy-company-5534.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ROOTS = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); ROOTS.push(d); return d; };
process.env.AGENT_WORKFORCE_DATA = tmp('aw-polco-data-');
const WORKERS = tmp('aw-polco-workers-');
process.env.AGENT_WORKFORCE_WORKERS = WORKERS;
process.env.AGENT_WORKFORCE_TUNNEL_STATE = tmp('aw-polco-tunnel-');
process.env.HOME = tmp('aw-polco-home-');
process.env.AGENT_WORKFORCE_PROJECTS = tmp('aw-polco-projects-');
test.after(() => { for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true }); });

const policy = require('./policy');
const orgpolicy = require('./orgpolicy');
const projects = require('./projects');
const fleet = require('../test-support/fleet');

const bootFile = (name) => path.join(WORKERS, name, 'CLAUDE.md');
function plantAgent(name, text) { fs.mkdirSync(path.join(WORKERS, name), { recursive: true }); fs.writeFileSync(bootFile(name), text, 'utf8'); }
const BOOT = 'You are **Casey**.\n\nDo the work well, and say what you did.\n';
/* The applied record as orgpolicy.refresh writes it after verifying a signed bundle. */
function applyCompany(ai, version = 3) {
  fs.mkdirSync(path.dirname(orgpolicy.APPLIED()), { recursive: true });
  fs.writeFileSync(orgpolicy.APPLIED(), JSON.stringify({ org: 'org_1', version, iat: 1, applied_at: Date.UTC(2026, 9, 9) / 1000,
    policy: { providers_allowed: null, models_allowed: null, backup: null, telemetry: null, ai_policy: ai }, marks: { org_1: version } }));
}

test('#5534 slice 3: the company\'s AI policy text is handed to an agent, with its provenance, and leaves with the policy', () => {
  policy.clear(); orgpolicy.clear();
  plantAgent('casey', BOOT);
  const roster = fleet.install([fleet.agent('casey', { state: 'idle' })]).agents;
  try {
    // CONTROL: nothing applied, nothing handed out.
    assert.equal(policy.companyEntry(), null);
    assert.equal(policy.tellAgent('casey', roster).state, projects.TOLD.TOLD);
    assert.ok(!fs.readFileSync(bootFile('casey'), 'utf8').includes(policy.START), 'a block was written with no policy at all');

    applyCompany({ name: 'Acme legal', text: 'Never paste client names into a prompt.' }, 3);
    const told = policy.tellAgent('casey', roster);
    assert.equal(told.state, projects.TOLD.TOLD);
    assert.equal(told.changed, true, 'a write was not reported as a change, so a running agent is never told');
    const one = fs.readFileSync(bootFile('casey'), 'utf8');
    assert.ok(one.includes('Never paste client names into a prompt.'), 'the company text did not reach the agent');
    assert.match(one, /Set by your company in its Kosmos policy \(version 3\)/);
    assert.ok(one.includes('Do the work well'), 'the agent\'s own words did not survive');

    // With the person's own policy: one stacked block, the company's first.
    policy.add({ name: 'Branding', text: 'Use the brand voice.', source: 'pasted' });
    policy.tellAgent('casey', roster);
    const two = fs.readFileSync(bootFile('casey'), 'utf8');
    assert.equal(two.split(policy.START).length, 2, 'more than one policy block');
    assert.ok(two.indexOf('### Acme legal') > 0 && two.indexOf('### Acme legal') < two.indexOf('### Branding'), 'the company entry is not first in the stack');
    // The person's list stays theirs: the company entry is not in policy.json and cannot be removed from it.
    assert.deepEqual(policy.read().policies.map((p) => p.name), ['Branding']);
    assert.throws(() => policy.removeOne(policy.COMPANY_ID), /cannot find/);

    // Leaving clears the applied policy: the company text goes from the agent; the person's stays.
    orgpolicy.clear();
    policy.tellAgent('casey', roster);
    const after = fs.readFileSync(bootFile('casey'), 'utf8');
    assert.ok(!after.includes('Never paste client names'), 'the company text outlived the company policy');
    assert.ok(after.includes('Use the brand voice.'));
  } finally {
    fleet.uninstall && fleet.uninstall();
  }
});

test('#5534 slice 3: company text an agent cannot be handed is not handed out', () => {
  policy.clear();
  for (const ai of [null, { name: 'X' }, { name: 'X', text: '   ' }, { name: 'X', text: 'y'.repeat(policy.TEXT_MAX + 1) }, 'text']) {
    applyCompany(ai);
    assert.equal(policy.companyEntry(), null, JSON.stringify(ai).slice(0, 40));
  }
  applyCompany({ text: 'Be careful.' });
  assert.equal(policy.companyEntry().name, policy.DEFAULT_NAME, 'a nameless company policy has no heading');
  applyCompany({ name: 'n'.repeat(policy.NAME_MAX + 5), text: 'Be careful.' });
  assert.equal(policy.companyEntry().name, policy.DEFAULT_NAME, 'an over-long name became a heading');
  orgpolicy.clear();
});

test('#5534 slice 3: the person\'s add is judged with the company text, since every agent is handed both', () => {
  policy.clear();
  applyCompany({ name: 'Acme', text: 'z'.repeat(policy.TEXT_MAX) });
  const big = 'w'.repeat(policy.TEXT_MAX);
  let added = 0;
  assert.throws(() => { for (let i = 0; i < 20; i += 1) { policy.add({ name: 'P' + i, text: big, source: 'pasted' }); added += 1; } }, /larger than an agent/);
  orgpolicy.clear(); policy.clear();
  let alone = 0;
  try { for (let i = 0; i < 20; i += 1) { policy.add({ name: 'P' + i, text: big, source: 'pasted' }); alone += 1; } } catch { /* the cap */ }
  assert.equal(alone, added + 1, 'the company text did not count toward the cap: ' + added + ' vs ' + alone);
  policy.clear();
});
