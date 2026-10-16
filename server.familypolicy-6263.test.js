'use strict';
/* kosmos#6263 (board review 1): a family's policy block is worded by the enrolled org's kind, so the board re-tells its
   agents when the kind changes with the same text (a record that gains its kind on a refresh after #6239). */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familypolicy-6263-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familypolicy-6263-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familypolicy-6263-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familypolicy-6263-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familypolicy-6263-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
test.after(() => {
  for (const d of [SANDBOX, process.env.HOME, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_LAUNCH]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ }
  }
});

const store = require('./engine/store');
const oe = require('./engine/orgenroll');
const policy = require('./engine/policy');
const { companyPolicySync, _orgRefreshResetForTests } = require('./server');

test('#6263: the same policy text re-tells the agents when the org\'s kind changes, and only then', (t) => {
  const file = path.join(store.ROOT, oe.ENROLLMENT_FILE);
  const enrolledAs = (kind) => {
    fs.mkdirSync(store.ROOT, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ org: { id: 'o', name: 'Rivera', slug: 'rivera', ...(kind ? { kind } : {}) }, role: 'member', world: 'a'.repeat(32) }));
  };
  const realEntry = policy.companyEntry;
  const realSync = policy.syncEveryone;
  let syncs = 0;
  policy.companyEntry = () => ({ name: 'Rivera', text: 'Be kind.' });
  policy.syncEveryone = () => { syncs += 1; return []; };
  t.after(() => { policy.companyEntry = realEntry; policy.syncEveryone = realSync; _orgRefreshResetForTests(); fs.rmSync(file, { force: true }); });
  _orgRefreshResetForTests();
  enrolledAs(null);            // a record from before kinds
  companyPolicySync();         // the first call records what the agents hold
  assert.equal(syncs, 0, 'the first call told the agents');
  enrolledAs('company');       // gains its kind: a company's block is unchanged, so nothing is re-told
  companyPolicySync();
  assert.equal(syncs, 0, 'CONTROL: a company that gained its kind re-told its agents');
  enrolledAs('family');        // the same text, now a family's: the block's words change
  companyPolicySync();
  assert.equal(syncs, 1, 'a family\'s kind did not reach the agents');
  companyPolicySync();
  assert.equal(syncs, 1, 'the same family policy was re-told again');
});

test('#6263 board review 2: with no family policy at all, joining or leaving a family still re-tells the agents (their own policies\' heading changes)', (t) => {
  const file = path.join(store.ROOT, oe.ENROLLMENT_FILE);
  const enrolledAs = (kind) => {
    fs.mkdirSync(store.ROOT, { recursive: true });
    if (!kind) { fs.rmSync(file, { force: true }); return; }
    fs.writeFileSync(file, JSON.stringify({ org: { id: 'o', name: 'Rivera', slug: 'rivera', kind }, role: 'member', world: 'a'.repeat(32) }));
  };
  const realEntry = policy.companyEntry;
  const realSync = policy.syncEveryone;
  let syncs = 0;
  policy.companyEntry = () => null;   // only the person's own policies
  policy.syncEveryone = () => { syncs += 1; return []; };
  t.after(() => { policy.companyEntry = realEntry; policy.syncEveryone = realSync; _orgRefreshResetForTests(); fs.rmSync(file, { force: true }); });
  _orgRefreshResetForTests();
  enrolledAs(null);
  companyPolicySync();
  enrolledAs('company');
  companyPolicySync();
  assert.equal(syncs, 0, 'CONTROL: joining a company with no policy re-told the agents');
  enrolledAs('family');
  companyPolicySync();
  assert.equal(syncs, 1, 'joining a family did not re-tell the agents');
  enrolledAs(null);
  companyPolicySync();
  assert.equal(syncs, 2, 'leaving a family did not re-tell the agents');
});

test('#6263 with #6240: a family board whose block holds only the person\'s policies owes no clear (no hourly retry)', (t) => {
  const { companyPolicyClearOwed } = require('./server');
  const file = path.join(store.ROOT, oe.ENROLLMENT_FILE);
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ org: { id: 'o', name: 'Rivera', slug: 'rivera', kind: 'family' }, role: 'member', world: 'a'.repeat(32) }));
  const realEntry = policy.companyEntry;
  const realSync = policy.syncEveryone;
  let entry = null;
  policy.companyEntry = () => entry;
  policy.syncEveryone = () => [];
  t.after(() => { policy.companyEntry = realEntry; policy.syncEveryone = realSync; _orgRefreshResetForTests(); fs.rmSync(file, { force: true }); });
  _orgRefreshResetForTests();
  companyPolicySync();
  assert.equal(companyPolicyClearOwed(), false, 'a family board with no family policy owes a clear');
  // CONTROL: the same board with the family's policy, then cleared, owes one until it is told.
  entry = { name: 'Rivera', text: 'Be kind.' };
  _orgRefreshResetForTests();
  companyPolicySync();
  entry = null;
  assert.equal(companyPolicyClearOwed(), true, 'a cleared family policy owes nothing');
});
