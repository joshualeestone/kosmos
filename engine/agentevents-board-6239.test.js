'use strict';
/* kosmos#6239: the board's own refusals under the family policy keys (outside_contact, quiet_hours) are queued by
   agentevents.recordRefusal and sent by the same tick as the guard's refusals, under the same consent words. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const FLEET_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'agentevents-6239-'));
process.env.AGENT_WORKFORCE_DATA = path.join(FLEET_SANDBOX, 'data');
process.env.AGENT_WORKFORCE_HOME = path.join(FLEET_SANDBOX, 'home');
process.env.AGENT_WORKFORCE_WORKERS = path.join(FLEET_SANDBOX, 'workers');
test.after(() => fs.rmSync(FLEET_SANDBOX, { recursive: true, force: true }));
const ae = require('./agentevents');
const oe = require('./orgenroll');

const HASH = 'ab'.repeat(32);
const EVENTS_LINE = "when one of your agents is stopped by your company's rules: which agent, the kind of thing it tried, the conversation it was in, and when";
function accept(root, lines = [EVENTS_LINE]) {
  const f = path.join(root, oe.ENROLLMENT_FILE);
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
  rec.consentHash = HASH;
  fs.writeFileSync(f, JSON.stringify(rec));
  fs.writeFileSync(path.join(root, oe.CONSENT_FILE), JSON.stringify({ order: [HASH], byHash: { [HASH]: {
    reports: ['agent names, the AI provider and model each uses, and whether each is working, waiting or stopped', ...lines],
    usageConsented: false } } }));
}
function coordinator() {
  const sent = [];
  let w = null;
  return {
    sent,
    macRequest: async (m, route, body) => {
      sent.push({ route, body });
      if (route === oe.ROUTES.enroll) { w = body.world; return { ok: true, data: { ok: true, org: { id: 'o', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c', world: w, thisComputer: true } } }; }
      if (route === oe.ROUTES.status) return { ok: true, data: { member: true, org: { id: 'o', name: 'Acme', slug: 'acme' }, role: 'member', enrolled: { computer: 'c', world: w, thisComputer: true } } };
      if (route === ae.ROUTE) return { ok: true, data: { ok: true, added: body.events.length } };
      return { ok: false, because: 'unexpected ' + route };
    },
  };
}
function setup(t, during) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentevents-6239-root-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = () => ({
    agents: () => ['Scout'], everyAgent: () => ['Scout'], guarded: () => true,
    transcriptDirsOf: (d) => ['/p' + d], dirOf: (n) => '/Users/ann/work/workers/' + n.toLowerCase(),
    transcripts: async () => { if (during) during(); return []; },
  });
  return { root, sources };
}
async function enrolled(t, during, lines) {
  const s = setup(t, during);
  const c = coordinator();
  await oe.enroll('ACME-JOIN-1234', true, { root: s.root, remote: c });
  accept(s.root, lines);
  return { s, c };
}
const tick = (s, c, now = Date.now()) => ae.tick({ platform: 'darwin', root: s.root, remote: c, sources: s.sources(), now });
const sentEvents = (c) => c.sent.filter((x) => x.route === ae.ROUTE).flatMap((x) => x.body.events);
const opts = (s, c, over) => Object.assign({ root: s.root, remote: c, platform: 'darwin' }, over);

test('#6239: not enrolled, nothing is queued or sent', async (t) => {
  const s = setup(t);
  const c = coordinator();
  assert.equal(ae.recordRefusal({ agent: 'Scout', rule: 'quiet-hours' }, opts(s, c)).queued, false);
  assert.equal(fs.existsSync(path.join(s.root, ae.BOARD_FILE)), false);
});

test('#6239: both refusals are sent in the contract\'s fields, with the board as their source', async (t) => {
  const { s, c } = await enrolled(t);
  await tick(s, c);
  assert.deepEqual(ae.recordRefusal({ agent: 'Scout', rule: 'quiet-hours' }, opts(s, c)), { queued: true });
  assert.deepEqual(ae.recordRefusal({ agent: 'Scout', rule: 'outside-contact' }, opts(s, c)), { queued: true });
  const r = await tick(s, c);
  assert.equal(r.sent, 2, JSON.stringify(r));
  const ev = sentEvents(c);
  assert.deepEqual(ev.map((e) => [e.agent, e.rule, e.action, e.targetClass, e.sessionRef]), [
    ['Scout', 'quiet-hours', 'run', 'other', 'kosmos-board'],
    ['Scout', 'outside-contact', 'network', 'network-host', 'kosmos-board'],
  ]);
  for (const e of ev) {
    assert.deepEqual(Object.keys(e).sort(), ['action', 'agent', 'at', 'rule', 'sessionRef', 'targetClass', 'toolUseRef', 'world']);
    assert.match(e.toolUseRef, /^board-[0-9a-f]{24}$/);
  }
  assert.notEqual(ev[0].toolUseRef, ev[1].toolUseRef);
  assert.equal((await tick(s, c)).sent, 0, 'sent twice');
});

test('#6239: one per agent and rule in ten minutes; another agent or rule, or later, is its own', async (t) => {
  const { s, c } = await enrolled(t);
  const now = Date.now();
  assert.equal(ae.recordRefusal({ agent: 'Scout', rule: 'quiet-hours' }, opts(s, c, { now })).queued, true);
  assert.deepEqual(ae.recordRefusal({ agent: 'Scout', rule: 'quiet-hours' }, opts(s, c, { now: now + 60e3 })), { queued: false, because: 'reported a moment ago' });
  assert.equal(ae.recordRefusal({ agent: 'Rex', rule: 'quiet-hours' }, opts(s, c, { now: now + 60e3 })).queued, true, 'another agent');
  assert.equal(ae.recordRefusal({ agent: 'Scout', rule: 'outside-contact' }, opts(s, c, { now: now + 60e3 })).queued, true, 'another rule');
  assert.equal(ae.recordRefusal({ agent: 'Scout', rule: 'quiet-hours' }, opts(s, c, { now: now + 10 * 60e3 })).queued, true, 'ten minutes on');
});

test('#6239: an unknown rule, a name the company cannot be shown, Windows, or words without the line queue nothing', async (t) => {
  const { s, c } = await enrolled(t);
  assert.equal(ae.recordRefusal({ agent: 'Scout', rule: 'sandbox' }, opts(s, c)).queued, false, 'not a board rule');
  assert.equal(ae.recordRefusal({ agent: 'Sco‮ut', rule: 'quiet-hours' }, opts(s, c)).queued, false);
  assert.equal(ae.recordRefusal({ agent: 'Scout', rule: 'quiet-hours' }, opts(s, c, { platform: 'win32' })).queued, false);
  assert.equal(fs.existsSync(path.join(s.root, ae.BOARD_FILE)), false, 'something was queued');
  assert.equal(ae.recordRefusal({ agent: 'Scout', rule: 'quiet-hours' }, opts(s, c)).queued, true, 'CONTROL: the good one');
  const w = await enrolled(t, null, []);
  assert.equal(ae.recordRefusal({ agent: 'Scout', rule: 'quiet-hours' }, opts(w.s, w.c)).queued, false, 'words without the events line');
});

test('#6239: a refusal queued while a tick is reading is sent, not overwritten by the tick\'s state', async (t) => {
  let ctx = null, fired = 0;
  const { s, c } = await enrolled(t, () => { if (ctx && !fired) { fired += 1; ae.recordRefusal({ agent: 'Scout', rule: 'quiet-hours' }, ctx); } });
  ctx = opts(s, c);
  await tick(s, c);
  assert.equal(fired, 1, 'CONTROL: the refusal was queued during the tick');
  // Taken in after the reading, so the same tick sends it.
  assert.ok(sentEvents(c).some((e) => e.rule === 'quiet-hours'), 'the refusal queued mid-tick was lost');
});

test('#6239: a queued refusal of another enrollment is never sent, and is cleared', async (t) => {
  const { s, c } = await enrolled(t);
  await tick(s, c);
  assert.equal(ae.recordRefusal({ agent: 'Scout', rule: 'quiet-hours' }, opts(s, c)).queued, true);
  const f = path.join(s.root, ae.BOARD_FILE);
  const b = JSON.parse(fs.readFileSync(f, 'utf8'));
  b.events[0].enrolledAs = 'another|enrollment';
  fs.writeFileSync(f, JSON.stringify(b));
  assert.equal((await tick(s, c)).sent, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')).events, []);
});
