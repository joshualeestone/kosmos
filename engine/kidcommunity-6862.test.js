'use strict';
/**
 * kosmos#6862: on a computer joined to a family, agents never take part in the Kosmos+ community, whatever the policy
 * says: a parent's `outside_contact: { enabled: true }` opens projects shared with other computers, not the community.
 * The family's reason is said in the family's own words; a company is as before.
 *
 *   node --test engine/kidcommunity-6862.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-kidcommunity-6862-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = path.join(SANDBOX, 'tunnel');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_TUNNEL_STATE, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const orgenroll = require('./orgenroll');
const orgpolicy = require('./orgpolicy');
const communitysend = require('./communitysend');
const fedseats = require('./fedseats');
const cb = require('./communityblock');

test.after(() => { fedseats.stopAll(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const coordinator = crypto.generateKeyPairSync('ed25519');
const PINNED = coordinator.publicKey.export({ format: 'jwk' }).x;
let version = 0;
/* Push `policy` as the coordinator signs it, and apply it as the board does. */
function apply(policy) {
  const now = Math.floor(Date.now() / 1000);
  version += 1;
  const body = 'KST1.' + Buffer.from(JSON.stringify({ typ: 'org_policy', v: 1, org: 'org-1', version, iat: now - 10, exp: now + 86400, policy })).toString('base64url');
  fs.writeFileSync(orgpolicy.BUNDLE(), body + '.' + crypto.sign(null, Buffer.from(body, 'ascii'), coordinator.privateKey).toString('base64url'));
  const r = orgpolicy.refresh({ now, pinned: PINNED });
  assert.equal(r.refused, null, 'the test policy did not apply: ' + r.refused);
}
const JOIN_UNKNOWN = 'org-join-unknown.json';   // orgenroll's marker for a join whose outcome is not known yet
/* This board joined to an org of `kind` ('family' or 'company'), or to nothing (null). No policy is in force. */
function joined(kind) {
  orgpolicy.clear();
  fs.rmSync(orgpolicy.APPLIED(), { force: true });
  const file = path.join(store.ROOT, orgenroll.ENROLLMENT_FILE);
  fs.rmSync(path.join(store.ROOT, JOIN_UNKNOWN), { force: true });
  fs.rmSync(path.join(store.ROOT, orgenroll.LEAVE_PENDING_FILE), { force: true });
  if (kind === null) { fs.rmSync(file, { force: true }); return; }
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ org: { id: 'org-1', name: 'The Smiths', slug: 'smiths', kind }, world: 'a'.repeat(32) }) + '\n');
  assert.equal(orgenroll.kindHere(), kind, 'CONTROL: the board reads the kind this test wrote');
}
const FAMILY_WORDS = /on a family's Kosmos, agents do not take part in the Kosmos\+ community/;

test('#6862: a family that allowed outside contact still keeps agents out of the community, and only the community', () => {
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  try {
    joined('family');
    apply({ outside_contact: { enabled: true } });
    assert.equal(orgpolicy.contactAllows().ok, true, 'CONTROL: the parent allowed outside contact');
    assert.equal(fedseats.contactStopped(), false, 'shared projects did not follow the parent\'s allow');
    const c = orgpolicy.communityAllows();
    assert.equal(c.ok, false, 'a family\'s agents were let into the community');
    assert.match(c.because, FAMILY_WORDS);
    assert.equal(communitysend.switchState(), 'policy');
    assert.match(communitysend.notOnWords('policy'), FAMILY_WORDS, 'the agent was not told the family\'s reason');
    assert.equal(cb.policyStopped(), true);
    assert.equal(cb.stoppedBody(), cb.FAMILY_STOPPED_LINES.join('\n'), "the agent's block was not the family's lines");
    joined('company');
    apply({ outside_contact: { enabled: true } });
    assert.equal(orgpolicy.communityAllows().ok, true, 'CONTROL: a company that allows outside contact takes part');
    assert.equal(communitysend.switchState(), 'on', 'CONTROL');
  } finally { communitysend.setSwitch(null); joined(null); }
});

test('#6862: which sentence: a family with no policy hears the family\'s, a policy saying off keeps its own', () => {
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  try {
    joined('family');
    assert.match(orgpolicy.communityAllows().because, FAMILY_WORDS, 'a family with no policy was told a policy keeps it out');
    assert.equal(cb.stoppedBody(), cb.FAMILY_STOPPED_LINES.join('\n'));
    apply({ outside_contact: { enabled: false } });
    const off = orgpolicy.communityAllows();
    assert.equal(off.ok, false);
    assert.doesNotMatch(off.because, FAMILY_WORDS, 'a policy that says off lost its own sentence');
    assert.equal(cb.stoppedBody(), cb.STOPPED_LINES.join('\n'));
  } finally { communitysend.setSwitch(null); joined(null); }
});

test('#6862: either form of the stopped lines is read as the stopped section', () => {
  const wrap = (lines) => cb.START + '\n' + lines.join('\n') + '\n' + cb.END + '\n';
  assert.equal(cb.isStoppedSection(wrap(cb.STOPPED_LINES)), true);
  assert.equal(cb.isStoppedSection(wrap(cb.FAMILY_STOPPED_LINES)), true);
  assert.equal(cb.isStoppedSection(wrap(['## The Kosmos+ community', '', 'Post once a day.'])), false, 'CONTROL: the rules are not the stopped lines');
});

test('#6862: explicit arguments are read as given (orgpolicy.communityAllows)', () => {
  assert.equal(orgpolicy.communityAllows({ outside_contact: { enabled: true } }, 'family').ok, false);
  assert.equal(orgpolicy.communityAllows(null, 'family').ok, false);
  for (const kind of ['company', null]) {
    assert.equal(orgpolicy.communityAllows({ outside_contact: { enabled: true } }, kind).ok, true, String(kind));
    assert.equal(orgpolicy.communityAllows(null, kind).ok, true, String(kind));
    assert.equal(orgpolicy.communityAllows({ outside_contact: { enabled: false } }, kind).ok, false, String(kind));
  }
});

test("#6862: Settings' community switch says the family's sentence on a family's Kosmos (server.js communityStopped)", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const m = src.match(/const FAMILY_COMMUNITY_STOPPED = "([^"]+)";/);
  assert.ok(m, 'CONTROL: server.js defines the family sentence');
  assert.match(m[1], /^On a family's Kosmos, agents do not take part in the Kosmos\+ community/);
  assert.match(src, /const c = op\.communityAllows\(\); return c\.ok === true \? null : c\.family === true \? FAMILY_COMMUNITY_STOPPED : COMMUNITY_STOPPED;/,
    "Settings' switch does not choose the family sentence from communityAllows");
});

/* Review 2: the refusal a post or comment gets on a family that allowed outside contact is said with the family's reason:
   the policy's own sentence ("keeps agents out ... and out of projects shared with other computers") is false twice there. */
test('#6862: a refused post and a refused comment on a family that allowed outside contact say the family\'s reason', () => {
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  try {
    joined('family');
    apply({ outside_contact: { enabled: true } });
    assert.equal(communitysend.switchState(), 'policy', 'CONTROL');
    for (const kind of ['post', 'comment']) {
      const w = communitysend.notSendingWords(kind, 'policy');
      assert.match(w, FAMILY_WORDS, kind + ': not the family\'s reason');
      assert.doesNotMatch(w, /out of projects shared with other computers/, kind + ': the policy\'s false sentence on a family');
    }
    joined('company');
    apply({ outside_contact: { enabled: false } });
    for (const kind of ['post', 'comment']) {
      assert.match(communitysend.notSendingWords(kind, 'policy'), /out of projects shared with other computers/, 'CONTROL: ' + kind + ' under a policy saying off keeps its own');
    }
  } finally { communitysend.setSwitch(null); joined(null); }
});

/* Review 2: whether to write the stopped lines and which form they take come from one read (stoppedReason), so a read
   that fails between them cannot give a family the policy's lines. */
test('#6862: stoppedReason says family, policy or null from one read', () => {
  try {
    joined('family');
    assert.equal(cb.stoppedReason(), 'family');
    apply({ outside_contact: { enabled: false } });
    assert.equal(cb.stoppedReason(), 'policy');
    joined('company');
    assert.equal(cb.stoppedReason(), null, 'CONTROL: a company with no policy is not stopped');
    const real = orgpolicy.communityAllows;
    let calls = 0;
    orgpolicy.communityAllows = (...a) => { calls += 1; return real(...a); };
    try { joined('family'); calls = 0; cb.stoppedReason(); assert.equal(calls, 1, 'more than one read'); }
    finally { orgpolicy.communityAllows = real; }
  } finally { joined(null); }
});

/* Review 3: the community-ready report says the family's reason too, to the agent (linesFor) and to the person
   (ownerView's board facts), on a family that allowed outside contact. */
test('#6862: the community-ready report says the family\'s reason to the agent and to the person', () => {
  const ready = require('./communityready');
  const row = { switch: 'policy', addressOk: true, reminders: 'on', block: 'stopped', account: 'none', reminder: null, lastPost: null, held: 0 };
  const said = () => ({ agent: ready.linesFor(row).join('\n'), person: JSON.stringify(ready.ownerView(row)) });
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  try {
    joined('family');
    apply({ outside_contact: { enabled: true } });
    let s = said();
    for (const [who, text] of Object.entries(s)) {
      assert.match(text, /n a family's Kosmos, agents do not take part in the Kosmos\+ community/, who + ': not the family\'s reason');
      assert.doesNotMatch(text, /out of projects shared with other computers/, who + ': the policy\'s false sentence on a family');
    }
    joined('company');
    apply({ outside_contact: { enabled: false } });
    s = said();
    for (const [who, text] of Object.entries(s)) assert.match(text, /out of projects shared with other computers/, 'CONTROL: ' + who + ' under a policy saying off keeps its own');
  } finally { communitysend.setSwitch(null); joined(null); }
});

/* Review 4: the report's "Your newest post" line read the frozen POST_WORDS table directly, so a stored post refused
   under 'policy' was described with the policy's sentence on a family. Every reader now goes through wordsFor. */
test('#6862: the newest post refused on a family is described with the family\'s reason', () => {
  const ready = require('./communityready');
  const row = { switch: 'policy', addressOk: true, reminders: 'on', block: 'stopped', account: 'none', reminder: null, lastPost: { title: 'A post', state: 'policy' }, held: 0 };
  const newest = () => ready.linesFor(row).find((l) => l.startsWith('- Your newest post: '));
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  try {
    joined('family');
    apply({ outside_contact: { enabled: true } });
    assert.match(newest(), /n a family's Kosmos, agents do not take part in the Kosmos\+ community/);
    assert.doesNotMatch(newest(), /out of projects shared with other computers/);
    joined('company');
    apply({ outside_contact: { enabled: false } });
    assert.match(newest(), /out of projects shared with other computers/, 'CONTROL: a policy saying off keeps its own');
  } finally { communitysend.setSwitch(null); joined(null); }
});

/* Review 4: the tables keep the policy's form, so a reader that indexes them directly says the policy's sentence on a
   family. Only communitystatus.wordsFor may. Scans the board's own sources (engine, server.js, web). */
test('#6862: nothing but communitystatus.wordsFor indexes POST_WORDS or COMMENT_WORDS', () => {
  const root = path.join(__dirname, '..');
  const files = [path.join(root, 'server.js')];
  for (const dir of ['engine', 'web']) {
    for (const f of fs.readdirSync(path.join(root, dir))) {
      if (/\.(js|html)$/.test(f) && !/\.test\.js$/.test(f)) files.push(path.join(root, dir, f));
    }
  }
  assert.ok(files.length > 50, 'the scan found the sources (' + files.length + ')');
  const bad = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/\b(POST_WORDS|COMMENT_WORDS)\s*\)?\s*\[/.test(line) && !(f.endsWith('communitystatus.js') && /function wordsFor|kind === 'post' \? POST_WORDS : COMMENT_WORDS\)\[state\]/.test(line))) bad.push(path.relative(root, f) + ':' + (i + 1));
    });
  }
  assert.deepEqual(bad, []);
  const self = fs.readFileSync(path.join(root, 'engine', 'communitystatus.js'), 'utf8');
  assert.match(self, /\(kind === 'post' \? POST_WORDS : COMMENT_WORDS\)\[state\]/, 'CONTROL: the scan sees the one allowed use');
});

/* Review 4: withPolicyStops and the board facts find the policy's sentence by its exact text, so communitysend's copy
   must stay the one orgpolicy says. */
test('#6862: communitysend.POLICY_STOPS is the sentence orgpolicy gives for a policy saying off', () => {
  assert.equal(orgpolicy.communityAllows({ outside_contact: { enabled: false } }, null).because, communitysend.POLICY_STOPS);
  assert.equal(orgpolicy.contactAllows({ outside_contact: { enabled: false } }, null).because, communitysend.POLICY_STOPS);
});

/* Review 5: the refusal event names the outside-contact rule, so it is sent only when the policy itself stops outside
   contact; on a family whose parent allowed it, the event would say the parent's own setting did not hold. */
test('#6862: a family refusal is reported as outside-contact only when the policy stops outside contact', () => {
  const agentevents = require('./agentevents');
  const real = agentevents.recordRefusal;
  const sent = [];
  agentevents.recordRefusal = (e) => { sent.push(e.rule); return { queued: true }; };
  try {
    joined('family');
    apply({ outside_contact: { enabled: true } });
    communitysend.reportPolicyRefusal('Scout');
    assert.deepEqual(sent, [], 'a family whose policy allows outside contact: nothing blamed on that rule');
    apply({ outside_contact: { enabled: false } });
    communitysend.reportPolicyRefusal('Scout');
    assert.deepEqual(sent, ['outside-contact'], 'CONTROL: the policy saying off is reported');
    apply({});
    communitysend.reportPolicyRefusal('Scout');
    assert.deepEqual(sent, ['outside-contact', 'outside-contact'], 'a family with outside contact unset is closed by the #6859 default, so reported');
  } finally { agentevents.recordRefusal = real; joined(null); }
});
