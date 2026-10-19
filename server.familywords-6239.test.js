'use strict';
/**
 * kosmos#6239 (Kosmos+Kids slice 2): a FAMILY account joins only after its words are read and accepted on the screen.
 * The preview tells the page the kind; an enroll for a family's ticket without wordsShown is refused before anything is
 * sent; with it, the coordinator is told the words were shown (wordsShown with the consentHash). A company still joins
 * with no screen (#5791), and nothing claims it was shown words.
 *
 *   node --test server.familywords-6239.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familywords-6239-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familywords-6239-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familywords-6239-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familywords-6239-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-familywords-6239-launch-'));
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

async function call(p, body) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body),
  });
  return res.json();
}
const enrollmentFile = () => path.join(store.ROOT, oe.ENROLLMENT_FILE);
const WORDS = { reports: ["which version of the family's policy this Kosmos has applied"], backsUp: [], readers: ['the family\'s admins'], never: ['keys and passwords'] };

function stub(t, kind) {
  const orig = remote.macRequest;
  const sent = [];
  const org = { id: 'org_f', name: 'The Rivera family', slug: 'rivera', ...(kind ? { kind } : {}) };
  remote.macRequest = async (method, route, body) => {
    sent.push({ route, body });
    if (route === oe.ROUTES.redeem) return { ok: true, data: { org, role: 'member', consent: WORDS, consentHash: 'ab'.repeat(32) } };
    if (route === oe.ROUTES.enroll) return { ok: true, data: { ok: true, org, role: 'member', enrolled: { computer: 'c1', world: body.world, thisComputer: true } } };
    if (route === oe.ROUTES.leave) return { ok: true, data: { ok: true } };
    if (route === oe.ROUTES.status) return { ok: true, data: { member: true, org, role: 'member', enrolled: { computer: 'c1', world: oe.worldId(), thisComputer: true } } };
    return { ok: false, because: 'unexpected ' + route };
  };
  t.after(async () => { await call('/api/org/leave', {}); remote.macRequest = orig; fs.rmSync(enrollmentFile(), { force: true }); });
  return sent;
}
const enrolls = (sent) => sent.filter((s) => s.route === oe.ROUTES.enroll);

test('#6239: a family preview says so, and an enroll without the words shown is refused with nothing sent', async (t) => {
  const sent = stub(t, 'family');
  const pv = await call('/api/org/preview', { code: 'RIVE-JOIN-1234' });
  assert.equal(pv.ok, true, JSON.stringify(pv));
  assert.equal(pv.org.kind, 'family', JSON.stringify(pv.org));
  assert.deepEqual(pv.consent.reports, WORDS.reports, 'the page did not get the words to show');
  const no = await call('/api/org/enroll', { code: 'RIVE-JOIN-1234', accepted: true, ticket: pv.ticket });
  assert.equal(no.ok, false);
  assert.equal(no.code, 'org_family_words_unseen', JSON.stringify(no));
  assert.equal(enrolls(sent).length, 0, 'an enroll was sent for a family nobody read the words of');
  // The ticket was not spent: the person can read and accept.
  const yes = await call('/api/org/enroll', { code: 'RIVE-JOIN-1234', accepted: true, ticket: pv.ticket, wordsShown: true });
  assert.equal(yes.ok, true, JSON.stringify(yes));
  const e = enrolls(sent);
  assert.equal(e.length, 1);
  assert.equal(e[0].body.wordsShown, true, 'the coordinator was not told the words were shown: ' + JSON.stringify(e[0].body));
  assert.equal(e[0].body.consentHash, 'ab'.repeat(32), 'the hash of the words shown did not go with it');
});

test('#6239: a company still joins with no screen, and nothing claims words were shown', async (t) => {
  const sent = stub(t, undefined);   // an older coordinator: no kind at all reads as a company
  const pv = await call('/api/org/preview', { code: 'ACME-JOIN-1234' });
  assert.equal(pv.org.kind, 'company', 'CONTROL: no kind is a company: ' + JSON.stringify(pv.org));
  const r = await call('/api/org/enroll', { code: 'ACME-JOIN-1234', accepted: true, ticket: pv.ticket, wordsShown: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  const e = enrolls(sent);
  assert.equal(e.length, 1);
  assert.equal('wordsShown' in e[0].body, false, 'a company join (no screen) claimed the words were shown: ' + JSON.stringify(e[0].body));
});
