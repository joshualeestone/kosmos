'use strict';
/**
 * kosmos#5532 (contract v1.5): engine/orgenroll.js is the first caller of engine/computerprint.js. The print's own
 * test file (computerprint-5532.test.js) lets a file load it only together with these two guards:
 *   1. the caller never logs a print, a printFor result or a request body carrying one;
 *   2. the company in the print comes from this board's OWN enrollment record (at enroll: the company whose consent
 *      the person accepted, which becomes the record's), never from a coordinator's later answer.
 * The reader is faked through the print module's tests-only hook, so no real hardware id is read here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('./computerprint');
const oe = require('./orgenroll');
const rollup = require('./orgrollup');

const UUID = '0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9';
const DUMP = '+-o Mac  <class IOPlatformExpertDevice, id 0x1, registered>\n    {\n      "IOPlatformUUID" = "' + UUID + '"\n    }\n';
const SALT = 'ab'.repeat(16);
const HASH = 'cd'.repeat(32);
const ACME = { id: 'org_1', name: 'Acme', slug: 'acme' };
const OTHER = { id: 'org_2', name: 'Other', slug: 'other' };
const CONSENT = { reports: ['agent names'], backsUp: [], readers: ['you'], never: [] };

function sandbox(t, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orgenroll-print-5532-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); cp._testRunner(); });
  cp._testRunner(run || (() => DUMP), { platform: 'darwin' });
  return root;
}
/* A company that binds this world and records every request body; `statusOrg` is what its status answer names. */
function company(root, statusOrg) {
  const sent = [];
  return {
    sent,
    macRequest: async (m, route, body) => {
      sent.push({ route, body: body == null ? null : JSON.parse(JSON.stringify(body)) });
      if (route === oe.ROUTES.enroll) return { ok: true, data: { ok: true, org: ACME, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
      if (route === oe.ROUTES.status) return { ok: true, data: { member: true, org: statusOrg || ACME, role: 'member', computerSalt: 'ef'.repeat(16), enrolled: { computer: 'c1', world: oe.worldId({ root }), thisComputer: true } } };
      return { ok: true, data: { ok: true } };
    },
  };
}
const printOf = (org) => cp._testFingerprint(SALT, org);
const join = (root, co, extra) => oe.enroll('ACME-JOIN-1234', true, Object.assign({ root, remote: co, consentHash: HASH, consent: CONSENT, orgId: ACME.id, computerSalt: SALT }, extra || {}));

test('#5532 print guard 2: the company in every print is the one on this board\'s record, never a later answer\'s', async (t) => {
  const root = sandbox(t);
  // The company's status names ANOTHER company: a coordinator asking for this computer's print under a company it
  // is not enrolled in. Nothing below may follow it.
  const co = company(root, OTHER);
  const r = await join(root, co);
  assert.equal(r.ok, true, JSON.stringify(r));
  const en = co.sent.find((x) => x.route === oe.ROUTES.enroll).body;
  assert.equal(en.computerPrint, printOf(ACME.id), 'the join\'s print was not made for the company being joined');
  assert.equal(en.computerSalt, SALT, 'the join did not echo the salt its print was made with');
  assert.equal(oe.readEnrollment({ root }).computerSalt, SALT, 'the salt was not recorded, so leave and rollup could not make the print');
  assert.notEqual(printOf(ACME.id), printOf(OTHER.id), 'CONTROL: the two companies give different prints');
  // The rollup: the record's company, whatever status says.
  fs.writeFileSync(path.join(root, oe.CONSENT_FILE), JSON.stringify({ order: [HASH], byHash: { [HASH]: { reports: ['agent names'], usageConsented: false } } }));
  const sources = { snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [], projects: () => [], linkedProject: () => false };
  const tk = await rollup.tick({ root, remote: co, sources, now: Date.UTC(2026, 9, 8, 12) });
  assert.equal(tk.sent, true, JSON.stringify(tk));
  assert.equal(co.sent.find((x) => x.route === rollup.ROUTE).body.computerPrint, printOf(ACME.id), 'the rollup\'s print followed another company');
  // The leave (its print is asserted in the next test).
  const lv = await oe.leave({ root, remote: company(root, ACME) });
  assert.equal(lv.ok, true, JSON.stringify(lv));
});

test('#5532 print guard 2: a leave sends the print for the record\'s company, and a pending undo keeps the join\'s', async (t) => {
  const root = sandbox(t);
  const co = company(root);
  await join(root, co);
  const leaving = company(root);
  await oe.leave({ root, remote: leaving });
  assert.equal(leaving.sent.find((x) => x.route === oe.ROUTES.leave).body.computerPrint, printOf(ACME.id), 'the leave did not carry the pinned print, so the company would refuse it as a copy');
  // An undo of a first join this Kosmos could not record: there is no record, so the join's own salt and company.
  const a = sandbox(t);
  const undoing = { sent: [], macRequest: async (m, route, body) => {
    undoing.sent.push({ route, body });
    if (route === oe.ROUTES.enroll) return { ok: true, data: { ok: true, org: ACME, role: 'member', enrolled: { computer: 'c9', world: 'f'.repeat(32), thisComputer: false } } };
    if (route === oe.ROUTES.leave) return { ok: false, because: 'offline' };
    return { ok: false, because: 'offline' }; } };
  const u = await join(a, undoing);
  assert.equal(u.code, 'org_undo_pending', JSON.stringify(u));
  assert.equal(undoing.sent.find((x) => x.route === oe.ROUTES.leave).body.computerPrint, printOf(ACME.id), 'the undo went without the print the join pinned');
  // The retry, from the pending file alone (no record): still the join's print.
  const retry = company(a);
  retry.macRequest = (() => { const base = retry.macRequest; return async (m, route, body) => (route === oe.ROUTES.status
    ? { ok: true, data: { member: true, org: ACME, role: 'member', enrolled: { computer: 'c9', world: oe.worldId({ root: a }), thisComputer: false } } } : base(m, route, body)); })();
  await oe.refresh({ root: a, remote: retry });
  const again = retry.sent.find((x) => x.route === oe.ROUTES.leave);
  assert.ok(again, 'CONTROL: the pending undo was retried');
  assert.equal(again.body.computerPrint, printOf(ACME.id), 'the retried undo lost the join\'s print');
});

test('#5532 print guard: a read still retrying sends nothing, on a join, a leave and the rollup', async (t) => {
  let fail = true;
  const root = sandbox(t, () => { if (fail) throw new Error('ioreg timed out'); return DUMP; });
  const co = company(root);
  const r = await join(root, co);
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.match(r.because, /Nothing was sent/);
  assert.equal(co.sent.length, 0, 'a join went out with no print while the read waits to retry');
  fail = false;
  cp._testRunner(() => DUMP, { platform: 'darwin' });
  assert.equal((await join(root, co)).ok, true, 'CONTROL: the join goes once the computer can be read');
});

test('#5532 print guard 1: nothing this caller logs carries a print, the hardware id or a body with one', async (t) => {
  const lines = [];
  const orig = { error: console.error, log: console.log, warn: console.warn, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => { lines.push(a.map(String).join(' ')); };
  t.after(() => { for (const k of Object.keys(orig)) console[k] = orig[k]; });
  const root = sandbox(t);
  const co = company(root);
  await join(root, co);
  fs.writeFileSync(path.join(root, oe.CONSENT_FILE), JSON.stringify({ order: [HASH], byHash: { [HASH]: { reports: ['agent names'], usageConsented: false } } }));
  await rollup.tick({ root, remote: co, sources: { snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [], projects: () => [], linkedProject: () => false }, now: Date.UTC(2026, 9, 8, 12) });
  // The one line this caller does log: a malformed salt (printFor's `because`).
  const bad = sandbox(t);
  await join(bad, company(bad), { computerSalt: 'not-hex' });
  await oe.leave({ root, remote: company(root) });
  assert.ok(lines.some((l) => /no computer print/.test(l)), 'CONTROL: the capture saw the line this caller logs');
  for (const l of lines) {
    assert.equal(l.includes(printOf(ACME.id)), false, 'a print was logged: ' + l);
    assert.equal(l.toUpperCase().includes(UUID), false, 'the hardware id was logged: ' + l);
    assert.equal(/computerPrint/.test(l), false, 'a body carrying a print was logged: ' + l);
  }
  // And by source: no console call in either file names the print or a request body.
  for (const f of ['orgenroll.js', 'orgrollup.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    for (const call of src.match(/console\.(log|error|warn|info)\([^\n]*/g) || []) {
      assert.equal(/computerPrint|\bprint\b|fields|\bbody\b/.test(call.replace(/'[^']*'/g, "''")), false, f + ' logs a print or a body: ' + call);
    }
  }
});

test('#5532 rollup review 12: a record rebuilt after an undo refused as the last admin keeps the print\'s salt, so its rollups carry the print', async (t) => {
  const root = sandbox(t);
  // A first join the company bound to another world: undone, but the undo gets no answer: pending.
  const co = { macRequest: async (m, route, body) => {
    if (route === oe.ROUTES.enroll) return { ok: true, data: { ok: true, org: ACME, role: 'admin', enrolled: { computer: 'c2', world: body.world, thisComputer: false } } };
    return { ok: false, because: 'offline' }; } };
  const r0 = await join(root, co);
  assert.equal(r0.code, 'org_undo_pending', JSON.stringify(r0));
  // The company now names this world HERE and refuses the undo as the last admin: the record is rebuilt from status.
  const rebuild = { macRequest: async (m, route) => (route === oe.ROUTES.status
    ? { ok: true, data: { member: true, org: ACME, role: 'admin', enrolled: { computer: 'c1', world: oe.worldId({ root }), thisComputer: true } } }
    : { ok: false, because: '409 {"because":"org_last_admin"}' }) };
  await oe.refresh({ root, remote: rebuild });
  assert.equal(oe.isEnrolledHere({ root }), true, 'CONTROL: the record was rebuilt');
  assert.equal(oe.readEnrollment({ root }).computerSalt, SALT, 'the rebuilt record lost the salt its print was pinned with');
  const sent = company(root);
  const tk = await rollup.tick({ root, remote: sent, sources: { snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [], projects: () => [], linkedProject: () => false }, now: Date.UTC(2026, 9, 8, 12) });
  assert.equal(tk.sent, true, JSON.stringify(tk));
  assert.equal(sent.sent.find((x) => x.route === rollup.ROUTE).body.computerPrint, printOf(ACME.id), 'the rebuilt record\'s rollup went without the pinned print');
});

test('#5532 rollup review 14: once a print is pinned, a reader that gave up makes the rollup and the leave WAIT, never go without', async (t) => {
  let gaveUp = false;
  const root = sandbox(t);
  const co = company(root);
  await join(root, co);
  assert.equal(oe.readEnrollment({ root }).printPinned, true, 'the join sent a print but the record does not say it is pinned');
  fs.writeFileSync(path.join(root, oe.CONSENT_FILE), JSON.stringify({ order: [HASH], byHash: { [HASH]: { reports: ['agent names'], usageConsented: false } } }));
  // The reader now answers "none" (here: a platform with no reader, the same answer a reader that gave up gives).
  cp._testRunner(() => DUMP, { platform: 'linux' });
  gaveUp = true;
  const sent = company(root);
  const src = { snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [], projects: () => [], linkedProject: () => false };
  const tk = await rollup.tick({ root, remote: sent, sources: src, now: Date.UTC(2026, 9, 8, 12) });
  assert.equal(tk.sent, false, 'a rollup went without the pinned print: ' + JSON.stringify(tk));
  assert.equal(sent.sent.some((x) => x.route === rollup.ROUTE), false);
  const lv = await oe.leave({ root, remote: sent });
  assert.equal(lv.pending, true, 'a leave went without the pinned print: ' + JSON.stringify(lv));
  assert.equal(sent.sent.some((x) => x.route === oe.ROUTES.leave), false);
  // CONTROL: a join that pinned no print sends without one.
  assert.ok(gaveUp);
  const b = sandbox(t, () => DUMP);
  cp._testRunner(() => DUMP, { platform: 'linux' });
  const co2 = company(b);
  await join(b, co2);
  assert.equal(oe.readEnrollment({ root: b }).printPinned, false, 'CONTROL: no print sent, none pinned');
  fs.writeFileSync(path.join(b, oe.CONSENT_FILE), JSON.stringify({ order: [HASH], byHash: { [HASH]: { reports: ['agent names'], usageConsented: false } } }));
  assert.equal((await rollup.tick({ root: b, remote: co2, sources: src, now: Date.UTC(2026, 9, 8, 12) })).sent, true, 'CONTROL: with nothing pinned, the rollup goes');
});

test('#5532 rollup review 15: the company\'s own printPinned answer decides, so a print it did not pin never stops reporting', async (t) => {
  const root = sandbox(t);
  const co = company(root);
  const base = co.macRequest;
  co.macRequest = async (m, route, body) => { const r = await base(m, route, body); if (route === oe.ROUTES.enroll) r.data.printPinned = false; return r; };
  await join(root, co);
  assert.equal(oe.readEnrollment({ root }).printPinned, false, 'a print the company said it did not pin was recorded as pinned');
  const yes = sandbox(t);
  const co2 = company(yes);
  const b2 = co2.macRequest;
  co2.macRequest = async (m, route, body) => { const r = await b2(m, route, body); if (route === oe.ROUTES.enroll) r.data.printPinned = true; return r; };
  await join(yes, co2);
  assert.equal(oe.readEnrollment({ root: yes }).printPinned, true, 'CONTROL: pinned when the company says so');
});

test('#5532 rollup review 16: a print sent and not pinned records no accepted words, so nothing is reported on a print that cannot match', async (t) => {
  const root = sandbox(t);
  const co = company(root);
  const base = co.macRequest;
  co.macRequest = async (m, route, body) => { const r = await base(m, route, body); if (route === oe.ROUTES.enroll) r.data.printPinned = false; return r; };
  const r = await join(root, co);
  assert.equal(r.ok, true, 'the join itself stands: ' + JSON.stringify(r));
  assert.equal(oe.isEnrolledHere({ root }), true);
  assert.equal(oe.mayReport({ root }), false, 'a join whose print was not pinned reports anyway');
});

test('#5532 rollup review 17: an undo waits for a print only when the join sent one, on both undo paths', async (t) => {
  // A computer with no reader (here: linux, the same answer as a reader that gave up): the join sends no print.
  const root = sandbox(t);
  cp._testRunner(() => DUMP, { platform: 'linux' });
  const sent = [];
  const co = { macRequest: async (m, route, body) => { sent.push({ route, body });
    if (route === oe.ROUTES.enroll) return { ok: true, data: { ok: true, org: ACME, role: 'member', enrolled: { computer: 'c9', world: 'f'.repeat(32), thisComputer: false } } };
    if (route === oe.ROUTES.leave) return { ok: true, data: { ok: true } };
    return { ok: false, because: 'offline' }; } };
  const r = await join(root, co);
  assert.equal(r.code, 'org_code_used', 'the undo of a join that sent no print did not go: ' + JSON.stringify(r));
  const lv = sent.find((x) => x.route === oe.ROUTES.leave);
  assert.ok(lv, 'no undo was sent');
  assert.equal(lv.body.computerPrint, undefined, 'CONTROL: no print to send');
  // The lost-answer path: the marker carries the join's salt, company and print, so its undo carries the print.
  const b = sandbox(t);
  const lost = { macRequest: async (m, route) => (route === oe.ROUTES.enroll ? { ok: false, because: 'the tunnel program did not answer in time' } : { ok: false, because: 'offline' }) };
  const u = await join(b, lost);
  assert.equal(u.code, 'org_join_unknown', JSON.stringify(u));
  // Old enough to settle (an undo is never sent on a marker younger than SETTLE_AFTER_MS).
  const mk = path.join(b, 'org-join-unknown.json');
  fs.writeFileSync(mk, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(mk, 'utf8')), { at: new Date(Date.now() - oe.SETTLE_AFTER_MS - 1000).toISOString() })));
  const settle = { sent: [], macRequest: async (m, route) => { settle.sent.push(route);
    if (route === oe.ROUTES.status) return { ok: true, data: { member: true, org: ACME, role: 'member', enrolled: { computer: 'c9', world: oe.worldId({ root: b }), thisComputer: false } } };
    return { ok: true, data: { ok: true } }; } };
  const bodies = [];
  const watch = { macRequest: async (m, route, body) => { if (route === oe.ROUTES.leave) bodies.push(body); return settle.macRequest(m, route, body); } };
  await oe.refresh({ root: b, remote: watch });
  assert.ok(bodies.length, 'CONTROL: the settled undo was sent');
  assert.equal(bodies[0].computerPrint, printOf(ACME.id), 'the settled undo went without the print its join pinned');
});

test('#5532 rollup review 18: while the rollup waits for a pinned print, it says so where the joined view reads it', async (t) => {
  const root = sandbox(t);
  const co = company(root);
  await join(root, co);
  fs.writeFileSync(path.join(root, oe.CONSENT_FILE), JSON.stringify({ order: [HASH], byHash: { [HASH]: { reports: ['agent names'], usageConsented: false } } }));
  const src = { snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [], projects: () => [], linkedProject: () => false };
  cp._testRunner(() => DUMP, { platform: 'linux' });   // no print now; one was pinned
  await rollup.tick({ root, remote: co, sources: src, now: Date.UTC(2026, 9, 8, 12) });
  assert.equal(rollup.waitingForPrint(root), true, 'the rollup waited for a print but the view would say it reports');
  cp._testRunner(() => DUMP, { platform: 'darwin' });
  await rollup.tick({ root, remote: co, sources: src, now: Date.UTC(2026, 9, 8, 12, 5) });
  assert.equal(rollup.waitingForPrint(root), false, 'CONTROL: once the print can be read, it no longer says it waits');
});
