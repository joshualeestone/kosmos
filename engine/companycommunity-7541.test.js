'use strict';
/**
 * kosmos#7541 (slice 3 of #7538): which community an agent's posts and reads go to, from the org's policy
 * (orgpolicy.communitySpace; Renet Tilley's contract on #7538): the company's own space only on a computer joined to a
 * company whose policy turns it on, and `public_community: "off"` refusing the public one only while it is on.
 *
 *   node --test engine/companycommunity-7541.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-companycommunity-7541-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = path.join(SANDBOX, 'tunnel');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_TUNNEL_STATE, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const orgpolicy = require('./orgpolicy');

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const ON = { company_community: { enabled: true } };

test('#7541: a company that turns its community on gets the company space, the public one still allowed', () => {
  assert.deepEqual(orgpolicy.communitySpace(ON, 'company'), { space: 'company', publicAllowed: true });
});

test('#7541: public_community "off" refuses the public one while the company community is on, with the policy\'s sentence', () => {
  const r = orgpolicy.communitySpace({ ...ON, public_community: 'off' }, 'company');
  assert.equal(r.space, 'company');
  assert.equal(r.publicAllowed, false);
  assert.equal(r.because, orgpolicy.PUBLIC_COMMUNITY_STOPS);
  assert.deepEqual(orgpolicy.communitySpace({ ...ON, public_community: 'allowed' }, 'company'), { space: 'company', publicAllowed: true },
    'CONTROL: "allowed" keeps the public one');
});

test('#7541: everything else is the public community as before', () => {
  const pub = { space: 'public', publicAllowed: true };
  assert.deepEqual(orgpolicy.communitySpace(null, null), pub, 'no policy, joined to nobody');
  assert.deepEqual(orgpolicy.communitySpace({}, 'company'), pub, 'a company with the key unset (off by default)');
  assert.deepEqual(orgpolicy.communitySpace({ company_community: { enabled: false } }, 'company'), pub, 'a company that turned it off');
  assert.deepEqual(orgpolicy.communitySpace({ company_community: { enabled: 'yes' } }, 'company'), pub, 'only exactly true turns it on');
  assert.deepEqual(orgpolicy.communitySpace({ company_community: true }, 'company'), pub, 'the key must be the object shape');
  assert.deepEqual(orgpolicy.communitySpace(ON, 'family'), pub, 'never on a family (communityAllows keeps a family out anyway)');
  assert.deepEqual(orgpolicy.communitySpace(ON, null), pub, 'a policy left over on a computer joined to nobody');
  assert.deepEqual(orgpolicy.communitySpace({ public_community: 'off' }, 'company'), pub,
    'public_community "off" alone does not stop the public one: with no company community, outside_contact is the switch');
});
