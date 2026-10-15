'use strict';
/**
 * kosmos#6239 (first Kosmos+Kids slice): what `outside_contact: { enabled: false }` stops on the board, through the
 * policy as orgpolicy applies it (a signed bundle, as a company or a parent pushes it). The community: every sender
 * reads communitysend.switchState(), which says 'policy', and the person's switch is left as they set it. The agent's
 * instructions: the community block gives way to the lines saying it does not take part (Josh, 2026-10-15 10:45).
 * Shared rooms: no seat is started and a running one is let go, the link kept.
 *
 *   node --test engine/familycontact-6239.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familycontact-6239-'));
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
const communitysend = require('./communitysend');
const communityswitch = require('./communityswitch');
const cb = require('./communityblock');
const projects = require('./projects');
const federation = require('./federation');
const fedseats = require('./fedseats');

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
const STOP = { outside_contact: { enabled: false } };
const OPEN = { outside_contact: { enabled: true } };

function agentFile(name, text) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), text);
  return path.join(dir, 'CLAUDE.md');
}
const AVA = '# Ava\n\nAva helps with homework and keeps notes on what was asked.\n';
const inner = (text) => {
  const f = projects.findBlock(text, cb.START, cb.END);
  return f && !f.ambiguous ? text.slice(f.start + cb.START.length, f.end - cb.END.length).trim() : null;
};

test('#6239: under the policy the community reads as stopped by it, with its own words, and the switch stays the person\'s', () => {
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  try {
    apply(OPEN);
    assert.equal(communitysend.switchState(), 'on', 'CONTROL: contact allowed');
    apply(STOP);
    assert.equal(communitysend.switchState(), 'policy');
    assert.equal(communitysend.switchOn(), false);
    assert.match(communitysend.notOnWords('policy'), /^the policy set for this Kosmos keeps agents out of the Kosmos\+ community and out of projects shared with other computers, so the Kosmos\+ community is off on this board/);
    const w = communitysend.willSend('Scout', Date.now(), 'post');
    assert.deepEqual([w.sends, w.why], [false, 'policy']);
    assert.match(communitysend.notSendingWords('post', 'policy'), /policy set for this Kosmos/);
    assert.match(communitysend.notSendingWords('comment', 'policy'), /policy set for this Kosmos/);
    // A switch that cannot be read keeps its own words; the person's OFF stays off.
    communitysend.setSwitch(() => ({ on: false, ok: false }));
    assert.equal(communitysend.switchState(), 'unreadable');
    communitysend.setSwitch(() => ({ on: false, ok: true }));
    assert.equal(communitysend.switchState(), 'off');
  } finally { communitysend.setSwitch(null); apply(OPEN); }
});

test('#6239: a policy read that throws sends nothing, in its own words, and the agent CLI is refused with the policy\'s words', async () => {
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  communitysend.setContact(() => { throw new Error('boom'); });
  try {
    assert.equal(communitysend.switchState(), 'policy_unreadable');
    assert.match(communitysend.notOnWords('policy_unreadable'), /^Kosmos cannot read the policy set for this Kosmos just now, so the Kosmos\+ community is off/);
    assert.doesNotMatch(communitysend.notOnWords('policy_unreadable'), /switch|keeps agents out/, 'a policy fault read as the switch file, or as a policy');
    assert.deepEqual([communitysend.willSend('Scout', Date.now(), 'post').why], ['policy_unreadable']);
    assert.match(communitysend.notSendingWords('post', 'policy_unreadable'), /cannot read the policy/);
  } finally { communitysend.setContact(null); }
  const ae = require('./agentevents');
  const real = ae.recordRefusal; const seen = [];
  ae.recordRefusal = (ev) => { seen.push(ev); return { queued: true }; };
  try {
    apply(STOP);
    const r = await communitysend.agentCall('Scout', 'GET', '/agents/me/posts');
    assert.equal(r.ok, false);
    assert.match(r.because, /policy set for this Kosmos/);
    const cr = require('./communityread');
    assert.equal((await cr.read({ reader: 'Rex' })).ok, false);
    assert.deepEqual(seen, [{ agent: 'Scout', rule: 'outside-contact' }, { agent: 'Rex', rule: 'outside-contact' }], 'a refused act was not reported');
    apply(OPEN);
    const c = await communitysend.agentCall('Scout', 'GET', '/agents/me/posts');
    assert.doesNotMatch(String(c.because), /policy set for this Kosmos/, 'CONTROL: allowed, refused for another reason or none');
  } finally { ae.recordRefusal = real; communitysend.setSwitch(null); apply(OPEN); }
});

test('#6239: participating() is false under the policy, with the switch file ON', () => {
  communityswitch.setOn(true);
  apply(OPEN);
  assert.equal(communityswitch.participating(), true, 'CONTROL');
  apply(STOP);
  assert.equal(communityswitch.participating(), false);
  assert.equal(communityswitch.read().on, true, 'the person\'s switch was changed');
  apply(OPEN);
});

test('#6239: the community block gives way to the "you do not take part" lines, and comes back when allowed', () => {
  const f = agentFile('ava', AVA);
  apply(OPEN);
  assert.equal(cb.tellAgent('ava', true).state, projects.TOLD.TOLD);
  assert.match(inner(fs.readFileSync(f, 'utf8')), /Your person has you taking part/, 'CONTROL: the block is there');
  apply(STOP);
  // A restart reads participating() (false under the policy) and tells the agent.
  assert.equal(cb.tellAgent('ava', communityswitch.participating()).changed, true);
  const text = fs.readFileSync(f, 'utf8');
  assert.equal(inner(text), cb.stoppedBody().trim());
  assert.match(text, /You do not take part in the Kosmos\+ community/);
  assert.match(text, /Do not post, comment, reply, vote, follow or endorse there/);
  assert.doesNotMatch(text, /kosmos community post/, 'the posting command is still in its instructions');
  assert.ok(text.startsWith(AVA), 'the person\'s own text was touched');
  // The switch OFF without the policy removes the section, as before.
  apply(OPEN);
  const off = cb.tellAgent('ava', false);
  assert.equal(off.state, projects.TOLD.TOLD, JSON.stringify(off) + ' ' + JSON.stringify(orgpolicy.contactAllows()));
  assert.equal(inner(fs.readFileSync(f, 'utf8')), null, 'CONTROL: the person\'s OFF removes it');
  cb.tellAgent('ava', true);
  assert.match(inner(fs.readFileSync(f, 'utf8')), /Your person has you taking part/);
});

test('#6239: the board-start refresh tells every agent of ours under the policy, and nobody without it while off', () => {
  const f = agentFile('bea', '# Bea\n\nBea answers the family calendar questions.\n');
  const roster = [{ sessionName: 'bea', isNamedOurs: true }];
  apply(OPEN);
  assert.deepEqual(cb.refreshEveryone(roster, false), [], 'CONTROL: switch off, no policy: nothing written');
  apply(STOP);
  const told = cb.refreshEveryone(roster, communityswitch.participating());
  assert.equal(told.length, 1);
  assert.equal(told[0].changed, true);
  assert.equal(told[0].rulesChanged, true, 'the agent is not told to read its instructions again');
  assert.equal(inner(fs.readFileSync(f, 'utf8')), cb.stoppedBody().trim());
  apply(OPEN);
});

function fakeChild() {
  const c = new EventEmitter();
  c.stdin = new PassThrough();
  c.stdout = new PassThrough();
  return c;
}
test('#6239: no shared-room seat under the policy; a running one is let go and the link kept', async () => {
  const spawned = [];
  fedseats.stopAll();
  fedseats.configure({
    spawnSeat: (edge) => { const c = fakeChild(); spawned.push(c); return c; },
    macRequest: async () => ({ ok: false, because: 'no' }),
    recordExternal: () => {}, onStatus: () => {}, enrolled: () => true, projectExists: () => true,
    projectCreatedAt: () => undefined, note: () => {},
  });
  federation.recordLink('proj-m', { role: 'member', edge_id: 'edge-1' });
  apply(OPEN);
  await fedseats.ensure('proj-m');
  assert.equal(spawned.length, 1, 'CONTROL: a seat starts while contact is allowed');
  apply(STOP);
  await fedseats.ensureAll();
  assert.equal(fedseats.statusOf('proj-m'), null, 'the running seat was not let go');
  assert.equal(await fedseats.ensure('proj-m'), null);
  assert.equal(spawned.length, 1, 'a seat was started under the policy');
  assert.ok(federation.linkFor('proj-m'), 'the link was dropped');
  apply(OPEN);
  await fedseats.ensure('proj-m');
  assert.equal(spawned.length, 2, 'the room did not come back once allowed');
  fedseats.stopAll();
});

test('#6239: a policy record that cannot be read closes contact instead of reading as no policy (round 2)', () => {
  apply(STOP);
  const file = orgpolicy.APPLIED();
  const good = fs.readFileSync(file, 'utf8');
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  try {
    fs.writeFileSync(file, '{ not json');
    assert.throws(() => orgpolicy.contactAllows(), 'a corrupt record read as no policy');
    assert.equal(communitysend.switchState(), 'policy_unreadable');
    assert.equal(communityswitch.participating(), false);
    assert.equal(fedseats.contactStopped(), true);
    // A read that fails (here EISDIR), not only one that does not parse.
    fs.rmSync(file); fs.mkdirSync(file);
    assert.throws(() => orgpolicy.contactAllows(), 'an unreadable record read as no policy');
    assert.equal(communitysend.switchState(), 'policy_unreadable');
    // Half a record is a fault too.
    fs.rmSync(file, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ version: 3 }));
    assert.throws(() => orgpolicy.contactAllows(), 'half a record read as no policy');
    fs.rmSync(file, { recursive: true });
    assert.deepEqual(orgpolicy.contactAllows(), { ok: true }, 'CONTROL: no record at all is no policy');
    assert.equal(communitysend.switchState(), 'on', 'CONTROL');
  } finally { communitysend.setSwitch(null); fs.rmSync(file, { recursive: true, force: true }); fs.writeFileSync(file, good); apply(OPEN); }
});

test('#6239: a computer that left its company has no policy: the record clear() leaves opens everything again (round 3)', () => {
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  try {
    apply(STOP);
    assert.equal(communitysend.switchState(), 'policy', 'CONTROL: the policy is in force first');
    orgpolicy.clear();
    const rec = JSON.parse(fs.readFileSync(orgpolicy.APPLIED(), 'utf8'));
    assert.ok(rec && rec.marks && !('policy' in rec), 'CONTROL: clear() left the marks-only record this test is about: ' + JSON.stringify(rec));
    assert.deepEqual(orgpolicy.contactAllows(), { ok: true });
    assert.deepEqual(orgpolicy.quietAllows(), { ok: true });
    assert.equal(communitysend.switchState(), 'on');
    assert.equal(communityswitch.participating(), communityswitch.read().on === true);
    assert.equal(fedseats.contactStopped(), false);
  } finally { communitysend.setSwitch(null); apply(OPEN); }
});
