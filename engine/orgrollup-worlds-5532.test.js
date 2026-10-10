'use strict';
/**
 * kosmos#5532 widening (Josh, #admin 2026-10-09 08:43: everything on a work computer is company property): with each
 * send of the enrolled Kosmos, every other Kosmos on the computer reports too, under its own opaque id, read in a child
 * process with its own folders. The child's real read is not run here: it reads the computer's live panes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'orgrollup-worlds-5532-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const r = require('./orgrollup');
const oe = require('./orgenroll');

const HASH = 'cd'.repeat(32);
/* The coordinator's line naming every Kosmos on this computer: without it only the enrolled Kosmos reports. */
const EVERY = 'the agent, project and activity lines above from every Kosmos on this computer, not only this one';
function accept(root, every = true) {
  const f = path.join(root, oe.ENROLLMENT_FILE);
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  rec.consentHash = HASH;
  fs.writeFileSync(f, JSON.stringify(rec));
  fs.writeFileSync(path.join(root, oe.CONSENT_FILE), JSON.stringify({ order: [HASH], byHash: { [HASH]: {
    reports: ['agent names, the AI provider and model each uses, and whether each is working, waiting or stopped'].concat(every ? [EVERY] : []) } } }));
}
function world(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orgrollup-worlds-5532-w-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function coordinator(answer) {
  const sent = [];
  let w = null;
  return {
    sent,
    macRequest: async (m, route, body) => {
      sent.push({ route, body });
      if (route === oe.ROUTES.enroll) { w = body.world; return { ok: true, data: { ok: true, org: { id: 'o', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c', world: w, thisComputer: true } } }; }
      if (route === oe.ROUTES.status) return { ok: true, data: { member: true, org: { id: 'o', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c', world: w, thisComputer: true } } };
      if (route === r.ROUTE) return answer ? answer(body) : { ok: true, data: { ok: true } };
      return { ok: false, because: 'unexpected ' + route };
    },
  };
}
/* The enrolled Kosmos's own board: one stopped agent, so its body is small and its signature fixed unless `extra`. */
function sources(extra) {
  return {
    snapshot: () => ({ counts: { unreadableLines: 0 }, agents: [] }),
    survey: () => ({ ok: true, agents: [{ name: 'mara', folder: '/f', job: null, profile: true }].concat(extra || []) }),
    removed: () => [],
    projects: () => [],
    lastActiveOf: () => null,
    providerOf: () => 'anthropic',
    recordedRunner: () => 'claude',
  };
}
/* Other Kosmoses: what their child would hand back (gather's own shape), by the env marker the test gives each. */
const BETA = 'b'.repeat(32);
const GAMMA = 'c'.repeat(32);
function others(gathered) {
  return {
    otherWorlds: () => [{ id: 'beta', root: '/nowhere/beta', env: { K: 'beta' } }, { id: 'gamma', root: '/nowhere/gamma', env: { K: 'gamma' } }],
    gatherIn: async (env) => (gathered[env.K] === null ? null : { world: env.K === 'beta' ? BETA : GAMMA, enrolled: false, gathered: JSON.parse(JSON.stringify(gathered[env.K])) }),
  };
}
const inv = (name) => ({ agents: [{ name, provider: 'openai', model: 'gpt-5.1', state: 'working' }], projects: [{ name: 'P-' + name, agents: [name] }],
  usageByDay: { '2026-10-07': { 'gpt-5.1': { input_tokens: 5 } } }, lastActive: null, partial: false, policyVersion: 9 });
const T0 = Date.UTC(2026, 9, 7, 12);
const rollups = (c) => c.sent.filter((x) => x.route === r.ROUTE).map((x) => x.body);

test('#5532 widening: with the enrolled Kosmos\'s daily, every other Kosmos on the computer reports under its own id', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const res = await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, others({ beta: inv('Ada'), gamma: inv('Bo') })));
  assert.equal(res.sent, true);
  const b = rollups(c);
  const mine = oe.readEnrollment({ root }).world;
  assert.deepEqual(b.map((x) => x.world), [mine, BETA, GAMMA], 'not one rollup per Kosmos, the enrolled one first');
  assert.deepEqual(b.map((x) => x.reason), ['daily', 'daily', 'daily']);
  assert.deepEqual(b[1].agents.map((a) => a.name), ['Ada'], 'another Kosmos sent the wrong inventory');
  assert.deepEqual(b[2].projects.map((p) => p.name), ['P-Bo']);
  // Under the same words: usage is withheld when the words do not name it, and the policy is the enrolled Kosmos's.
  for (const x of b.slice(1)) {
    assert.equal(x.usageWithheld, true, 'another Kosmos sent usage the words do not name');
    assert.deepEqual(x.usage, [], 'usage rows left another Kosmos');
    assert.equal('policyVersion' in x, false, 'another Kosmos reported a policy version');
  }
});

test('#5532 widening: under words that do not name every Kosmos on this computer, only the enrolled Kosmos reports', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root, false);
  let read = 0;
  const o = others({ beta: inv('Ada'), gamma: inv('Bo') });
  const gatherIn = o.gatherIn;
  o.gatherIn = async (env) => { read += 1; return gatherIn(env); };
  const res = await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, o));
  assert.equal(res.sent, true, 'the enrolled Kosmos stopped too');
  assert.deepEqual(rollups(c).map((x) => x.world), [oe.readEnrollment({ root }).world], 'another Kosmos reported under words that do not name it');
  assert.equal(read, 0, 'another Kosmos was read under words that do not name it');
  assert.equal(oe.acceptedConsent({ root }).everyKosmosConsented, false);
  // CONTROL: the same tick under words that name it sends all three.
  const c2 = coordinator();
  const root2 = world(t);
  await oe.enroll('ACME-JOIN-1234', true, { root: root2, remote: c2 });
  accept(root2);
  await r.tick(Object.assign({ root: root2, remote: c2, sources: sources(), now: T0 }, others({ beta: inv('Ada'), gamma: inv('Bo') })));
  assert.equal(rollups(c2).length, 3);
});

test('#5532 widening (board review 1): new words accepted while another Kosmos is read stop every later send', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const o = others({ beta: inv('Ada'), gamma: inv('Bo') });
  const gatherIn = o.gatherIn;
  let reads = 0;
  o.gatherIn = async (env) => {
    reads += 1;
    // During the first read the person accepts other words: the record now carries another hash.
    if (reads === 1) {
      const f = path.join(root, oe.ENROLLMENT_FILE);
      const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
      rec.consentHash = 'ef'.repeat(32);
      fs.writeFileSync(f, JSON.stringify(rec));
    }
    return gatherIn(env);
  };
  await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, o));
  assert.deepEqual(rollups(c).map((x) => x.world), [oe.readEnrollment({ root }).world], 'another Kosmos was sent under words that changed while it was read');
  // CONTROL: the same tick with the words unchanged sends all three.
  const root2 = world(t);
  const c2 = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root: root2, remote: c2 });
  accept(root2);
  await r.tick(Object.assign({ root: root2, remote: c2, sources: sources(), now: T0 }, others({ beta: inv('Ada'), gamma: inv('Bo') })));
  assert.equal(rollups(c2).length, 3);
});

test('#5532 widening (board review 1): another Kosmos read in part is not sent, and one id read twice goes once', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const part = Object.assign(inv('Ada'), { partial: true });
  // gamma resolves to beta's id: two registry entries, one Kosmos.
  const o = {
    otherWorlds: () => [{ id: 'beta', env: { K: 'beta' } }, { id: 'gamma', env: { K: 'gamma' } }, { id: 'again', env: { K: 'again' } }],
    gatherIn: async (env) => (env.K === 'beta' ? { world: BETA, enrolled: false, gathered: JSON.parse(JSON.stringify(part)) }
      : { world: GAMMA, enrolled: false, gathered: JSON.parse(JSON.stringify(inv('Bo'))) }),
  };
  await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, o));
  assert.deepEqual(rollups(c).map((x) => x.world), [oe.readEnrollment({ root }).world, GAMMA],
    'a partial read was sent as the day\'s, or one Kosmos went twice');
  // Board review 3: partial again at the NEXT daily, it goes, marked truncated, rather than never.
  const c2 = coordinator();
  await r.tick(Object.assign({ root, remote: c2, sources: sources(), now: T0 + 25 * 3600 * 1000 }, o));
  const second = rollups(c2);
  assert.deepEqual(second.map((x) => x.world), [oe.readEnrollment({ root }).world, BETA, GAMMA], 'a Kosmos partial every day never reached the company');
  assert.equal(second[1].truncated, true, 'a partial daily was sent as the whole picture');
  // Board review 5: still partial the day after, it goes again (not every other day).
  const c3 = coordinator();
  await r.tick(Object.assign({ root, remote: c3, sources: sources(), now: T0 + 49 * 3600 * 1000 }, o));
  assert.ok(rollups(c3).some((x) => x.world === BETA), 'an always-partial Kosmos was held again after it was sent');
});

test('#5532 widening (board review 4): a change send between two dailies keeps another Kosmos\'s partial hold', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const part = Object.assign(inv('Ada'), { partial: true });
  const o = {
    otherWorlds: () => [{ id: 'beta', env: { K: 'beta' } }],
    gatherIn: async () => ({ world: BETA, enrolled: false, gathered: JSON.parse(JSON.stringify(part)) }),
  };
  await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, o));   // daily: beta held
  const c1 = coordinator();
  // The enrolled Kosmos changes (a new agent): a change send, during which beta is still partial.
  const res = await r.tick(Object.assign({ root, remote: c1, sources: sources([{ name: 'newbie', folder: '/g', job: null, profile: true }]), now: T0 + 2 * 3600 * 1000 }, o));
  assert.equal(res.reason, 'change', 'CONTROL: the middle tick is a change send: ' + JSON.stringify(res));
  const c2 = coordinator();
  await r.tick(Object.assign({ root, remote: c2, sources: sources([{ name: 'newbie', folder: '/g', job: null, profile: true }]), now: T0 + 25 * 3600 * 1000 }, o));
  assert.ok(rollups(c2).some((x) => x.world === BETA && x.truncated === true), 'the change send wiped the hold, so the always-partial Kosmos was held again');
});

test('#5532 widening (board review 5): a daily that did not land rides the next send, as a daily', async (t) => {
  const root = world(t);
  let fail = true;
  const c = coordinator((body) => (body.world === BETA && fail ? { ok: false, because: '503 busy' } : { ok: true, data: { ok: true } }));
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const o = { otherWorlds: () => [{ id: 'beta', env: { K: 'beta' } }],
    gatherIn: async () => ({ world: BETA, enrolled: false, gathered: JSON.parse(JSON.stringify(inv('Ada'))) }) };
  await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, o));
  fail = false;
  const before = rollups(c).length;
  await r.tick(Object.assign({ root, remote: c, sources: sources([{ name: 'newbie', folder: '/g', job: null, profile: true }]), now: T0 + 2 * 3600 * 1000 }, o));
  const later = rollups(c).slice(before);
  assert.equal(later[0].reason, 'change', 'CONTROL: the second tick is the enrolled Kosmos\'s change send');
  const beta = later.find((x) => x.world === BETA);
  assert.ok(beta && beta.reason === 'daily', 'the missed daily did not ride the next send: ' + JSON.stringify(later.map((x) => [x.world, x.reason])));
});

test('#5532 widening (board review 5): a refusal for the member stops the loop before the next read', async (t) => {
  const reads = [];
  const c = {
    o: { otherWorlds: () => [{ id: 'beta', env: { K: 'beta' } }, { id: 'gamma', env: { K: 'gamma' } }],
      gatherIn: async (env) => { reads.push(env.K); return { world: env.K === 'beta' ? BETA : GAMMA, enrolled: false, gathered: JSON.parse(JSON.stringify(inv(env.K))) }; } },
    oe: { mayReport: () => true, readEnrollment: () => ({ world: 'a'.repeat(32), consentHash: 'h' }) },
    eo: {}, rec: { world: 'a'.repeat(32), consentHash: 'h' }, accepted: { everyKosmosConsented: true, usageConsented: false },
    pf: { fields: {} }, root: '/nowhere', now: T0, reason: 'daily', prev: {},
    remote: { macRequest: async () => ({ ok: false, because: '409 org_consent_changed' }) },
  };
  await r.sendOthers(c);
  assert.deepEqual(reads, ['beta'], 'a Kosmos was read after the company refused the member');
});

test('#5532 widening (board review 5): the enrolled Kosmos is found in the whole registry and its tick runs in a child with its folders', () => {
  const list = [{ id: 'a', root: '/r/a', env: { K: 'a' } }, { id: 'b', root: '/r/b', env: { K: 'b' } }];
  let opts = null;
  const found = r.enrolledElsewhere('/r/me', { otherWorlds: (root, o) => { opts = o; return list; }, oe: { isEnrolledHere: (x) => x.root === '/r/b' } });
  assert.equal(found.id, 'b');
  assert.deepEqual(opts, { all: true }, 'the search used the capped list');
  assert.equal(r.enrolledElsewhere('/r/me', { otherWorlds: () => list, oe: { isEnrolledHere: () => false } }), null, 'CONTROL: none enrolled');
  let call = null;
  let ended = 'no';
  const child = r.spawnEnrolledTick(found, (err) => { ended = err ? 'err' : 'ok'; }, { execFile: (bin, args, o, cb) => { call = { bin, args, o }; cb(Object.assign(new Error('x'), { signal: 'SIGTERM' })); return { pid: 1 }; } });
  assert.equal(call.bin, process.execPath);
  assert.match(call.args[0], /orgrollup-child\.js$/);
  assert.equal(call.args[1], 'tick');
  assert.deepEqual(call.o.env, { K: 'b' }, 'the child did not get the enrolled Kosmos\'s folders');
  assert.equal(call.o.timeout, r.TICK_CHILD_TIMEOUT_MS);
  assert.equal(ended, 'err', 'a killed child did not end the run (the board would stay busy)');
  assert.deepEqual(child, { pid: 1 }, 'the child is not handed back for the board to stop');
});

test('#5532 widening (board review 6): ids no longer on the computer leave the holds after a full pass, not after a failed read', async () => {
  const GONE = 'e'.repeat(32);
  const base = (gatherIn) => ({
    o: { otherWorlds: () => [{ id: 'beta', env: { K: 'beta' } }], gatherIn },
    oe: { mayReport: () => true, readEnrollment: () => ({ world: 'a'.repeat(32), consentHash: 'h' }) },
    eo: {}, rec: { world: 'a'.repeat(32), consentHash: 'h' }, accepted: { everyKosmosConsented: true, usageConsented: false },
    pf: { fields: {} }, root: '/nowhere', now: T0, reason: 'change', prev: {}, held: [GONE], missed: [GONE],
    remote: { macRequest: async () => ({ ok: true, data: { ok: true } }) },
  });
  const full = base(async () => ({ world: BETA, enrolled: false, gathered: JSON.parse(JSON.stringify(inv('Ada'))) }));
  await r.sendOthers(full);
  assert.deepEqual([[...full.heldNext], [...full.missedNext]], [[], []], 'a gone Kosmos stayed held or missed after a full pass');
  // CONTROL: a pass with a failed read keeps them.
  const failed = base(async () => null);
  await r.sendOthers(failed);
  assert.deepEqual([[...failed.heldNext], [...failed.missedNext]], [[GONE], [GONE]], 'a failed read cost a held or missed daily');
});

test('#5532 widening (board review 7): a Kosmos is reported as another Kosmos under an id it never enrolls under', (t) => {
  const root = world(t);
  const sib = oe.siblingId({ root });
  const own = oe.worldId({ root });
  assert.match(sib, /^[0-9a-f]{32}$/);
  assert.notEqual(sib, own, 'the sibling id is the enrollment id, so two companies could match the Kosmos');
  assert.equal(oe.siblingId({ root }), sib, 'the sibling id is not stable');
  assert.ok(fs.existsSync(path.join(root, oe.SIBLING_ID_FILE)));
  assert.match(fs.readFileSync(path.join(__dirname, 'orgrollup-child.js'), 'utf8'), /const world = oe\.siblingId\(\);/, 'the child reports another Kosmos under its enrollment id');
});

test('#5532 widening (board reviews 7 and 8): one run of a Kosmos\'s rollup at a time, a dead run\'s lock expires, and a run clears its own', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const file = path.join(root, r.RUN_LOCK_FILE);
  fs.writeFileSync(file, JSON.stringify({ at: T0 - 60 * 1000, token: 'theirs' }));   // another process took the lock a minute ago
  const busy = await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, others({ beta: inv('Ada') })));
  assert.equal(busy.sent, false, 'a second run went beside the first');
  assert.equal(rollups(c).length, 0);
  fs.writeFileSync(file, JSON.stringify({ at: T0 - r.TICK_CHILD_TIMEOUT_MS - 1000, token: 'dead' }));   // that run died long ago
  const ok = await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, others({ beta: inv('Ada') })));
  assert.equal(ok.sent, true, 'a dead run\'s lock never expired: ' + JSON.stringify(ok));
  assert.equal(fs.existsSync(file), false, 'a finished run left its lock');
});

test('#5532 widening (board review 8): two runs reaching the lock together send once', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const before = c.sent.length;
  const run = () => r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, others({ beta: inv('Ada') })));
  const [a, b] = await Promise.all([run(), run()]);
  const mine = oe.readEnrollment({ root }).world;
  assert.equal(c.sent.slice(before).filter((x) => x.route === r.ROUTE && x.body.world === mine).length, 1, 'both runs sent the enrolled Kosmos');
  assert.deepEqual([a.sent, b.sent].sort(), [false, true], JSON.stringify([a, b]));
});

test('#5532 widening (board review 8): a throw in another Kosmos\'s rollup releases the lock and keeps what was recorded', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const res = await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, { otherWorlds: () => { throw new Error('boom'); }, gatherIn: async () => null }));
  assert.equal(res.sent, true, 'the enrolled send was lost to another Kosmos\'s fault');
  const bad = await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 + 25 * 3600 * 1000 },
    { otherWorlds: () => [{ id: 'beta', env: { K: 'beta' } }], // A body that throws inside sendOthers (gatherIn's own parse refuses this shape; any throw stands in for it).
    gatherIn: async () => ({ world: BETA, enrolled: false, gathered: null }) }));
  assert.equal(bad.sent, true, JSON.stringify(bad));
  assert.equal(fs.existsSync(path.join(root, r.RUN_LOCK_FILE)), false, 'a fault in another Kosmos\'s rollup left the lock for 44 minutes');
});

test('#5532 widening (board review 7): a missed daily that is still partial waits for a real daily', async () => {
  const sent = [];
  const part = Object.assign(inv('Ada'), { partial: true });
  const c = {
    o: { otherWorlds: () => [{ id: 'beta', env: { K: 'beta' } }], gatherIn: async () => ({ world: BETA, enrolled: false, gathered: JSON.parse(JSON.stringify(part)) }) },
    oe: { mayReport: () => true, readEnrollment: () => ({ world: 'a'.repeat(32), consentHash: 'h' }) },
    eo: {}, rec: { world: 'a'.repeat(32), consentHash: 'h' }, accepted: { everyKosmosConsented: true, usageConsented: false },
    pf: { fields: {} }, root: '/nowhere', now: T0, reason: 'change', prev: {}, held: [BETA], missed: [BETA],
    remote: { macRequest: async (m, route, body) => { sent.push(body.reason); return { ok: true, data: { ok: true } }; } },
  };
  await r.sendOthers(c);
  assert.deepEqual(sent, [], 'a held partial went on a change send because its daily was missed');
  assert.deepEqual([[...c.heldNext], [...c.missedNext]], [[BETA], [BETA]], 'the hold or the missed daily was lost');
  // CONTROL: the same on a real daily is sent.
  c.reason = 'daily';
  await r.sendOthers(c);
  assert.deepEqual(sent, ['daily']);
});

test('#5532 widening (board review 9): a Kosmos may belong to a company on the evidence of its files, readable or not', (t) => {
  const files = [oe.ENROLLMENT_FILE, 'org-join-unknown.json', 'org-leave-pending'];
  for (const f of files) {
    const root = world(t);
    assert.equal(oe.holdsEnrollment({ root }), false, 'CONTROL: a fresh Kosmos holds no enrollment');
    fs.writeFileSync(path.join(root, f), 'not json {');
    assert.equal(oe.holdsEnrollment({ root }), true, f + ' (unparseable) read as free to send');
    assert.equal(oe.readEnrollment({ root }), null, 'CONTROL: readEnrollment alone calls it free');
  }
});

test('#5532 widening (board review 9): the child answers only "enrolled" for such a Kosmos, before any read or write', () => {
  const src = fs.readFileSync(path.join(__dirname, 'orgrollup-child.js'), 'utf8');
  const main = src.slice(src.indexOf('async function main'));
  const check = main.indexOf('oe.holdsEnrollment()');
  assert.ok(check > 0, 'the child does not check holdsEnrollment');
  assert.ok(check < main.indexOf('oe.siblingId()') && check < main.indexOf('rollup.gather()'), 'the child reads or mints before it knows the Kosmos is free');
});

test('#5532 widening (board review 9): a run whose read went stale while another sent stands down', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const o = { otherWorlds: () => [], gatherIn: async () => null };
  // Another run sends while this one reads: the state on disk moves after this run read it.
  const src = sources();
  const snapshot = src.snapshot;
  src.snapshot = () => {
    const f = path.join(root, r.STATE_FILE);
    const st = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    st.lastAt = T0 - 1000; st.tryAt = T0 - 2000;
    fs.writeFileSync(f, JSON.stringify(st));
    return snapshot();
  };
  const before = rollups(c).length;
  const res = await r.tick(Object.assign({ root, remote: c, sources: src, now: T0 }, o));
  assert.equal(res.sent, false, 'a run sent on a stale read: ' + JSON.stringify(res));
  assert.equal(rollups(c).length, before);
  assert.equal(fs.existsSync(path.join(root, r.RUN_LOCK_FILE)), false, 'standing down left the lock');
});

test('#5532 widening (board review 9): a run never removes a lock another run took over', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const file = path.join(root, r.RUN_LOCK_FILE);
  // During this run's send, its lock is taken over by another run (as if this one outlived the bound).
  const o = { otherWorlds: () => { fs.writeFileSync(file, JSON.stringify({ at: T0, token: 'the other run' })); return []; }, gatherIn: async () => null };
  const res = await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, o));
  assert.equal(res.sent, true, JSON.stringify(res));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'the other run', 'this run removed the lock another run held');
});

test('#5532 widening (board review 10): a half-written lock is a live one until its file is older than the bound', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const file = path.join(root, r.RUN_LOCK_FILE);
  fs.writeFileSync(file, '');   // taken, not yet written
  const busy = await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, others({ beta: inv('Ada') })));
  assert.equal(busy.sent, false, 'an empty lock read as free');
  // A lock stamped seconds AFTER this run's tick began (another run took it while this one read) is live too.
  fs.writeFileSync(file, JSON.stringify({ at: T0 + 5000, token: 'just now' }));
  const later = await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, others({ beta: inv('Ada') })));
  assert.equal(later.sent, false, 'a lock taken after this tick began read as stale');
  fs.writeFileSync(file, '');
  // CONTROL: the same empty file, old: a run that died while taking it. Taken over.
  const old = (Date.now() - r.TICK_CHILD_TIMEOUT_MS - 60 * 1000) / 1000;
  fs.utimesSync(file, old, old);
  const ok = await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, others({ beta: inv('Ada') })));
  assert.equal(ok.sent, true, JSON.stringify(ok));
});

test('#5532 widening (board review 11): the board-elsewhere runner searches at most once per CHANGE_MIN_MS, runs one child at a time, and stops it', () => {
  let t = 1000000;
  let finds = 0;
  let ends = [];
  const kills = [];
  const spawn = (w, done) => { ends.push(done); return { kill: () => kills.push(w.id) }; };
  const run = r.elsewhereRunner({ now: () => t, find: () => { finds += 1; return { id: 'b', env: {} }; }, spawn });
  assert.equal(run.tick('/r'), 'spawned');
  assert.equal(run.running, true);
  assert.equal(run.tick('/r'), 'running', 'a second child while the first runs');
  ends.shift()(null);   // the child ends
  assert.equal(run.running, false, 'a finished child left the board busy for good');
  assert.equal(run.tick('/r'), 'throttled', 'a second search inside CHANGE_MIN_MS');
  t += r.CHANGE_MIN_MS;
  assert.equal(run.tick('/r'), 'spawned', 'CONTROL: after CHANGE_MIN_MS it runs again');
  assert.equal(finds, 2);
  run.stop();
  assert.deepEqual(kills, ['b'], 'the live child was not stopped with the board');
  // A search that finds nothing counts toward the throttle too.
  const none = r.elsewhereRunner({ now: () => t, find: () => { finds += 1; return null; }, spawn });
  assert.equal(none.tick('/r'), 'none');
  assert.equal(none.tick('/r'), 'throttled', 'an empty search ran every tick');
  // A child that ends before its handle is kept is never killed later.
  const sync = r.elsewhereRunner({ now: () => t, find: () => ({ id: 'c', env: {} }), spawn: (w, done) => { done(null); return { kill: () => kills.push('dead ' + w.id) }; } });
  assert.equal(sync.tick('/r'), 'spawned');
  assert.equal(sync.running, false);
  sync.stop();
  assert.deepEqual(kills, ['b'], 'a finished child was killed');
});

test('#5532 widening (board review 3): another Kosmos enrolled itself is never sent under this enrollment', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  const o = {
    otherWorlds: () => [{ id: 'beta', env: { K: 'beta' } }, { id: 'gamma', env: { K: 'gamma' } }, { id: 'delta', env: { K: 'delta' } }],
    gatherIn: async (env) => ({ world: env.K === 'beta' ? BETA : env.K === 'gamma' ? GAMMA : 'd'.repeat(32),
      // beta holds its own enrollment (another company); delta's child could not say (no field): both are skipped.
      ...(env.K === 'gamma' ? { enrolled: false } : env.K === 'beta' ? { enrolled: true } : {}),
      gathered: JSON.parse(JSON.stringify(inv(env.K))) }),
  };
  await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, o));
  assert.deepEqual(rollups(c).map((x) => x.world), [oe.readEnrollment({ root }).world, GAMMA],
    'an enrolled Kosmos, or one that could not say, was sent under this enrollment');
});

test('#5532 widening (board review 2): past the company\'s cap, the Kosmoses not reached keep their signatures', async (t) => {
  const prev = { [BETA]: 'sig-beta', [GAMMA]: 'sig-gamma' };
  const sent = [];
  const c = {
    o: { otherWorlds: () => [{ id: 'beta', env: { K: 'beta' } }, { id: 'gamma', env: { K: 'gamma' } }],
      gatherIn: async (env) => ({ world: env.K === 'beta' ? BETA : GAMMA, enrolled: false, gathered: JSON.parse(JSON.stringify(inv(env.K))) }) },
    oe: { mayReport: () => true, readEnrollment: () => ({ world: 'a'.repeat(32), consentHash: 'h' }) },
    eo: {}, rec: { world: 'a'.repeat(32), consentHash: 'h' }, accepted: { everyKosmosConsented: true, usageConsented: false },
    pf: { fields: {} }, root: '/nowhere', now: T0, reason: 'daily', prev,
    remote: { macRequest: async (m, route, body) => { sent.push(body.world); return { ok: false, because: '409 org_rollup_too_many_worlds' }; } },
  };
  const next = await r.sendOthers(c);
  assert.deepEqual(sent, [BETA], 'it kept sending past the cap');
  assert.equal(next[GAMMA], 'sig-gamma', 'a Kosmos not reached lost its signature');
  // The refused one keeps the signature of its last send that landed, not of the one refused.
  assert.equal(next[BETA], 'sig-beta');
});

test('#5532 widening: a change send skips another Kosmos that did not change and sends one that did', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, others({ beta: inv('Ada'), gamma: inv('Bo') })));
  const before = rollups(c).length;
  // Eleven minutes on, the enrolled Kosmos changed (a new agent), Gamma changed, Beta did not.
  const res = await r.tick(Object.assign({ root, remote: c, sources: sources([{ name: 'nell', folder: '/f', job: null, profile: true }]), now: T0 + 11 * 60e3 },
    others({ beta: inv('Ada'), gamma: inv('Cy') })));
  assert.equal(res.sent, true);
  assert.equal(res.reason, 'change');
  const after = rollups(c).slice(before);
  assert.deepEqual(after.map((x) => x.world), [oe.readEnrollment({ root }).world, GAMMA], 'an unchanged Kosmos was sent again, or a changed one was not');
  assert.equal(after[1].reason, 'change');
});

test('#5532 widening: nothing of another Kosmos goes when the enrolled Kosmos\'s own send fails', async (t) => {
  const root = world(t);
  const c = coordinator(() => ({ ok: false, because: 'HTTP 503' }));
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  let asked = 0;
  const o = others({ beta: inv('Ada'), gamma: inv('Bo') });
  const gatherIn = o.gatherIn;
  o.gatherIn = async (env) => { asked++; return gatherIn(env); };
  const res = await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, o));
  assert.equal(res.sent, false);
  assert.equal(rollups(c).length, 1, 'another Kosmos reported after the enrolled one was refused');
  assert.equal(asked, 0, 'another Kosmos was read after the enrolled one was refused');
});

test('#5532 widening: a Kosmos whose read fails is skipped alone; past the company\'s cap the rest wait', async (t) => {
  const root = world(t);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root, remote: c });
  accept(root);
  await r.tick(Object.assign({ root, remote: c, sources: sources(), now: T0 }, others({ beta: null, gamma: inv('Bo') })));
  assert.deepEqual(rollups(c).slice(1).map((x) => x.world), [GAMMA], 'a failed read stopped the next Kosmos, or was sent');
  // The company says this computer reports as many Kosmoses as a member may: nothing more is tried this time.
  const root2 = world(t);
  const tried = [];
  const c2 = coordinator((body) => { tried.push(body.world); return body.world === BETA ? { ok: false, because: 'HTTP 409 org_rollup_too_many_worlds' } : { ok: true, data: { ok: true } }; });
  await oe.enroll('ACME-JOIN-1234', true, { root: root2, remote: c2 });
  accept(root2);
  await r.tick(Object.assign({ root: root2, remote: c2, sources: sources(), now: T0 }, others({ beta: inv('Ada'), gamma: inv('Bo') })));
  assert.deepEqual(tried.slice(1), [BETA], 'another Kosmos was sent after the company said the cap was reached');
});

test('#5532 widening: otherWorlds lists every other Kosmos (hidden ones too) with the environment its agents get', () => {
  const worlds = require('./worlds');
  const base = worlds.baseRoot(process.env);
  worlds.createWorld(base, 'Beta');
  worlds.createWorld(base, 'Quiet');
  worlds.hideWorld(base, 'quiet');
  const list = r.otherWorlds(base);   // the default Kosmos's own root is the base: it is not in its own list
  assert.deepEqual(list.map((w) => w.id).sort(), ['beta', 'quiet'], 'the list missed a Kosmos, or named this one');
  const beta = list.find((w) => w.id === 'beta');
  assert.equal(beta.env.KOSMOS_WORLD, 'beta');
  // Its own roots, exactly as its board derives them (the data root is the world's folder; the store adds its own name).
  for (const [k, v] of Object.entries(worlds.envOverridesFor(base, { id: 'beta' }))) assert.equal(path.resolve(beta.env[k]), path.resolve(v), k + ' is not that Kosmos\'s own');
  assert.equal(path.resolve(beta.root), path.resolve(worlds.worldStoreRoot(base, { id: 'beta' })));
  // From Beta's side, the default Kosmos is the other one, with no world roots set.
  const fromBeta = r.otherWorlds(worlds.worldStoreRoot(base, { id: 'beta' }));
  const dflt = fromBeta.find((w) => w.id === worlds.DEFAULT_ID);
  assert.ok(dflt, 'the default Kosmos was not listed from another one');
  assert.equal(dflt.env.KOSMOS_WORLD, undefined);
  assert.equal(r.OTHERS_MAX, 15);
  // A data folder that is none of this registry's Kosmoses cannot say which share its computer: it reports alone.
  assert.deepEqual(r.otherWorlds(path.join(SANDBOX, 'somewhere-else')), [], 'a folder outside the registry listed the registry as its others');
});

test('#5532 widening: the child runs on its own and answers one line of JSON (an unknown mode is a refusal, not a read)', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'orgrollup-child.js'), 'nope'], { env: process.env, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out.trim()), { ok: false, because: 'unknown mode' });
});
