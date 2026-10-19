'use strict';
/**
 * kosmos#6239 (Kosmos+Kids slice 2): a FAMILY's words that changed after joining wait for a parent. GET /api/org says
 * so (wordsNeeded), the review preview serves the family's current words, and only an Accept that says they were shown
 * takes them on (the board's own automatic re-accept cannot, by design). A company never needs a parent.
 *
 *   node --test server.familyreaccept-6239.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familyreaccept-6239-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familyreaccept-6239-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familyreaccept-6239-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familyreaccept-6239-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familyreaccept-6239-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server } = require('./server');
const store = require('./engine/store');
const oe = require('./engine/orgenroll');
const remote = require('./engine/remote');

test.before(async () => { await start(0); });
test.after(() => {
  server.closeAllConnections(); server.close();
  for (const d of [SANDBOX, process.env.HOME, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_LAUNCH]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ }
  }
});

const base = () => `http://127.0.0.1:${server.address().port}`;
async function call(p, body) {
  const res = await fetch(base() + p, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });
  return res.json();
}
async function state() {
  const res = await fetch(base() + '/api/org', { headers: { 'sec-fetch-site': 'same-origin' } });
  return res.json();
}
const enrollmentFile = () => path.join(store.ROOT, oe.ENROLLMENT_FILE);
const OLD = 'ab'.repeat(32);
const NEW = 'cd'.repeat(32);
const WORDS = { reports: ["which version of the family's policy this Kosmos has applied"], backsUp: [], readers: ["the family's admins"], never: ['keys and passwords'] };

function stub(t, kind) {
  const orig = remote.macRequest;
  const sent = [];
  const org = { id: 'org_f', name: 'The Rivera family', slug: 'rivera', ...(kind ? { kind } : {}) };
  remote.macRequest = async (method, route, body) => {
    sent.push({ route, body });
    if (route === oe.ROUTES.redeem) return { ok: true, data: { org, role: 'member', consent: WORDS, consentHash: OLD } };
    if (route === oe.ROUTES.enroll) return { ok: true, data: { ok: true, org, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
    if (route === oe.ROUTES.leave) return { ok: true, data: { ok: true } };
    // The words the org serves NOW: changed since the join (a new hash).
    if (route === oe.ROUTES.status) return { ok: true, data: { member: true, org, role: 'member', consent: WORDS, consentHash: NEW, enrolled: { computer: 'c1', world: oe.worldId(), thisComputer: true } } };
    return { ok: false, because: 'unexpected ' + route };
  };
  t.after(async () => { await call('/api/org/leave', {}); remote.macRequest = orig; fs.rmSync(enrollmentFile(), { force: true }); });
  return sent;
}
const enrolls = (sent) => sent.filter((s) => s.route === oe.ROUTES.enroll);
async function join(kind, code) {
  const pv = await call('/api/org/preview', { code });
  const j = await call('/api/org/enroll', { code, accepted: true, ticket: pv.ticket, wordsShown: kind === 'family' });
  assert.equal(j.ok, true, 'the join itself failed: ' + JSON.stringify(j));
}

test('#6239: a family whose words changed waits for a parent, and only an Accept that showed them takes them on', async (t) => {
  const sent = stub(t, 'family');
  await join('family', 'RIVE-JOIN-1234');
  assert.equal((await state()).wordsNeeded, false, 'CONTROL: just joined, with its words accepted, it needs nothing');
  // The family changed its words: a report was refused, and the board withdrew the old ones.
  assert.equal(await oe.consentWithdrawn(undefined, OLD), true);
  const st = await state();
  assert.equal(st.enrolled, true);
  assert.equal(st.wordsNeeded, true, 'the joined view is not told a parent is needed: ' + JSON.stringify(st));
  // The page's path: the review preview, then Accept without the words shown is refused before anything is sent...
  const pv = await call('/api/org/preview', { review: true });
  assert.equal(pv.ok, true, JSON.stringify(pv));
  assert.equal(pv.review, true);
  assert.equal(pv.org.kind, 'family', JSON.stringify(pv.org));
  assert.deepEqual(pv.consent.reports, WORDS.reports);
  const mark = enrolls(sent).length;
  const no = await call('/api/org/enroll', { accepted: true, ticket: pv.ticket });
  assert.equal(no.code, 'org_family_words_unseen', JSON.stringify(no));
  assert.equal(enrolls(sent).length, mark, 'a review enroll was sent with no words shown');
  // ...and with them, the family's current words are taken on and the view no longer waits.
  const yes = await call('/api/org/enroll', { accepted: true, ticket: pv.ticket, wordsShown: true });
  assert.equal(yes.ok, true, JSON.stringify(yes));
  const e = enrolls(sent).slice(mark);
  assert.equal(e.length, 1);
  assert.equal(e[0].body.wordsShown, true, JSON.stringify(e[0].body));
  assert.equal(e[0].body.consentHash, NEW, 'the hash of the words shown now did not go with it');
  assert.equal((await state()).wordsNeeded, false, 'accepted, and still waiting for a parent');
});

test('#6239: a company never waits for a parent, even with its words withdrawn', async (t) => {
  stub(t, undefined);   // no kind: a company
  await join('company', 'ACME-JOIN-1234');
  assert.equal(await oe.consentWithdrawn(undefined, OLD), true);
  const st = await state();
  assert.equal(st.enrolled, true);
  assert.equal(st.wordsNeeded, false, 'a company was offered a parent screen: ' + JSON.stringify(st));
});

test('#6239: a caller that is not the screen learns nothing of it', async (t) => {
  stub(t, 'family');
  await join('family', 'RIVE-JOIN-1234');
  await oe.consentWithdrawn(undefined, OLD);
  const res = await fetch(base() + '/api/org');   // no Sec-Fetch-Site: not the screen
  const j = await res.json();
  assert.equal('wordsNeeded' in j, false, JSON.stringify(j));
});
