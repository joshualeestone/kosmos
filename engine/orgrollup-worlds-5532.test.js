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
const EVERY = 'all of the above from every Kosmos on this computer, not only this one';
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
    gatherIn: async (env) => (gathered[env.K] === null ? null : { world: env.K === 'beta' ? BETA : GAMMA, gathered: JSON.parse(JSON.stringify(gathered[env.K])) }),
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
