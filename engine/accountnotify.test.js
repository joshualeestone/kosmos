'use strict';

/**
 * #3723 slice 2: engine/accountnotify.js tells the person's project manager once per incident.
 * Real board cards from test-support/fleet; the incident record is a file in a sandbox.
 *
 *   node --test engine/accountnotify.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'accountnotify-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const { sweepOnce, SEEN_SWEEPS, RESOLVED_MS } = require('./accountnotify');

test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const DELIVERY = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could-not' };
let fileN = 0;
const newFile = () => nodePath.join(SANDBOX, `book-${++fileN}.json`);

// A board: `ada` stopped by its account (or not), `pat` its manager (or not).
function board(adaState, patState, withPat) {
  const b = fleet.install([
    fleet.agent('ada', { state: adaState, displayName: 'Ada', role: 'Researcher' }),
    ...(withPat === false ? [] : [fleet.agent('pat', { state: patState || 'idle', displayName: 'Pat', role: 'Project manager' })]),
  ]);
  return b.agents;
}
const lookups = (over) => Object.assign({
  reportsTo: (s) => (s === 'ada' ? 'pat' : null),
  roleOf: () => null,
  projectsOf: () => [],
}, over || {});
function sweep(cards, file, now, state, over) {
  const sent = [];
  const did = sweepOnce({
    cards, lookups: lookups(over), file, now, DELIVERY,
    deliver: (session, text) => { sent.push({ session, text }); return { state: state || DELIVERY.PLACED }; },
  });
  return { did, sent };
}

test('told once, after it is seen on consecutive sweeps, and never again for the same incident', () => {
  const file = newFile();
  const cards = board('rate_limited');
  let t = 1000;
  for (let i = 1; i < SEEN_SWEEPS; i++) assert.equal(sweep(cards, file, t += 60000).sent.length, 0, 'told before it was seen twice');
  const first = sweep(cards, file, t += 60000);
  assert.equal(first.sent.length, 1);
  assert.equal(first.sent[0].session, 'pat', 'the manager is told');
  assert.match(first.sent[0].text, /^\[Kosmos\] Ada has run out of Claude usage or credits, so it has stopped\./);
  assert.match(first.sent[0].text, /Please tell the person now/);
  assert.equal(sweep(cards, file, t += 60000).sent.length, 0, 'told twice for one incident');
});

test('the record survives a board restart: a fresh sweep over the same file does not tell again', () => {
  const file = newFile();
  const cards = board('auth_failed');
  let t = 1000;
  for (let i = 0; i < SEEN_SWEEPS; i++) sweep(cards, file, t += 60000);
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).ada.told);
  delete require.cache[require.resolve('./accountnotify')];
  const again = require('./accountnotify').sweepOnce({ cards, lookups: lookups(), file, now: t += 60000, DELIVERY, deliver: () => { throw new Error('told again after a restart'); } });
  assert.deepEqual(again.filter((d) => d.act === 'told'), []);
});

test('a new incident is told again only after the agent has been fine for RESOLVED_MS', () => {
  const file = newFile();
  let t = 1000;
  const bad = board('rate_limited');
  for (let i = 0; i < SEEN_SWEEPS; i++) sweep(bad, file, t += 60000);
  const good = board('idle');
  sweep(good, file, t += 60000);
  const bad2 = board('rate_limited');
  for (let i = 0; i < SEEN_SWEEPS + 1; i++) assert.equal(sweep(bad2, file, t += 60000).sent.length, 0, 'a flicker inside the window was told as a new incident');
  sweep(good, file, t += 60000);
  const later = t + RESOLVED_MS + 1;
  assert.ok(sweep(board('idle'), file, later).did.some((d) => d.act === 'resolved'));
  let told = 0;
  for (let i = 0; i < SEEN_SWEEPS; i++) told += sweep(board('rate_limited'), file, later + (i + 1) * 60000).sent.length;
  assert.equal(told, 1, 'the next incident after a real recovery is told');
});

test('the manager is a project member whose role reads like a manager when nobody is set to report to', () => {
  const file = newFile();
  const cards = board('rate_limited');
  const over = { reportsTo: () => null, projectsOf: () => [['ada', 'pat']], roleOf: (s) => (s === 'pat' ? 'Project manager' : 'Researcher') };
  let sent = [];
  for (let i = 0; i < SEEN_SWEEPS; i++) sent = sent.concat(sweep(cards, file, (i + 1) * 60000, undefined, over).sent);
  assert.deepEqual(sent.map((m) => m.session), ['pat']);
});

test('no message when there is no manager, or the manager has the same problem', () => {
  const noMgr = newFile();
  const cards = board('rate_limited');
  let sent = [];
  for (let i = 0; i < SEEN_SWEEPS; i++) sent = sent.concat(sweep(cards, noMgr, (i + 1) * 60000, undefined, { reportsTo: () => null }).sent);
  assert.deepEqual(sent, [], 'told someone when nobody manages the agent');
  const both = newFile();
  const same = board('rate_limited', 'rate_limited');
  sent = [];
  for (let i = 0; i < SEEN_SWEEPS; i++) sent = sent.concat(sweep(same, both, (i + 1) * 60000).sent.filter((m) => m.session === 'pat'));
  assert.deepEqual(sent, [], 'told a manager that is stopped by the same problem');
});

test('an unconfirmed delivery counts as told (never sent twice); a failed one is tried again', () => {
  const file = newFile();
  const cards = board('rate_limited');
  let t = 1000;
  for (let i = 0; i < SEEN_SWEEPS; i++) sweep(cards, file, t += 60000, DELIVERY.UNCONFIRMED);
  assert.equal(sweep(cards, file, t += 60000).sent.length, 0);
  const f2 = newFile();
  for (let i = 0; i < SEEN_SWEEPS; i++) sweep(cards, f2, (i + 1) * 60000, DELIVERY.COULD_NOT);
  assert.equal(sweep(cards, f2, 10 * 60000).sent.length, 1, 'CONTROL: a failed delivery is tried again');
});

test('an idle board sends nothing and writes nothing', () => {
  const file = newFile();
  const cards = board('idle');
  for (let i = 0; i < 3; i++) assert.equal(sweep(cards, file, (i + 1) * 60000).sent.length, 0);
  assert.equal(fs.existsSync(file), false);
});

test('a manager on a question or a permission prompt is not typed into; it is told once it is idle', () => {
  const file = newFile();
  let t = 1000;
  let sent = [];
  for (let i = 0; i < SEEN_SWEEPS + 1; i++) sent = sent.concat(sweep(board('rate_limited', 'needs_you'), file, t += 60000).sent);
  assert.deepEqual(sent, [], 'typed into a manager waiting on a question (its Enter would answer it)');
  const later = sweep(board('rate_limited', 'idle'), file, t += 60000).sent;
  assert.deepEqual(later.map((m) => m.session), ['pat'], 'CONTROL: told once the manager is idle');
});

test('a project colleague whose role is not a manager is not interrupted', () => {
  const file = newFile();
  const cards = board('rate_limited');
  const over = { reportsTo: () => null, projectsOf: () => [['ada', 'pat']], roleOf: () => 'Researcher' };
  let sent = [];
  for (let i = 0; i < SEEN_SWEEPS; i++) sent = sent.concat(sweep(cards, file, (i + 1) * 60000, undefined, over).sent);
  assert.deepEqual(sent, []);
});

test('the notice to the manager never carries the agent\'s screen text', () => {
  const file = newFile();
  const cards = board('rate_limited');
  let sent = [];
  for (let i = 0; i < SEEN_SWEEPS; i++) sent = sent.concat(sweep(cards, file, (i + 1) * 60000).sent);
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0].text, /says:/, 'screen text reached another agent');
});

test('one partial board read (the agent missing) does not re-arm a told incident', () => {
  const file = newFile();
  let t = 1000;
  for (let i = 0; i < SEEN_SWEEPS; i++) sweep(board('rate_limited'), file, t += 60000);
  sweep(fleet.install([fleet.agent('pat', { state: 'idle', displayName: 'Pat', role: 'Project manager' })]).agents, file, t += 60000);
  let sent = [];
  for (let i = 0; i < SEEN_SWEEPS + 1; i++) sent = sent.concat(sweep(board('rate_limited'), file, t += 60000).sent);
  assert.deepEqual(sent, [], 'told again after the agent was missing from one read');
});

test('with no manager it is recorded once and logged once, not every minute', () => {
  const file = newFile();
  const logged = [];
  let t = 1000;
  for (let i = 0; i < SEEN_SWEEPS + 3; i++) {
    sweepOnce({ cards: board('rate_limited', 'idle', false), lookups: lookups({ reportsTo: () => null }), file, now: t += 60000, DELIVERY, deliver: () => ({ state: DELIVERY.PLACED }), log: (d) => logged.push(d) });
  }
  assert.equal(logged.filter((d) => d.act === 'no-manager').length, 1);
});

test('a named manager missing from one read is tried again, not recorded as nobody', () => {
  const file = newFile();
  let t = 1000;
  let sent = [];
  for (let i = 0; i < SEEN_SWEEPS; i++) sent = sent.concat(sweep(board('rate_limited', 'idle', false), file, t += 60000).sent);
  assert.deepEqual(sent, [], 'told someone while the manager was away');
  const back = sweep(board('rate_limited'), file, t += 60000).sent;
  assert.deepEqual(back.map((m) => m.session), ['pat'], 'the manager was never told after it came back');
});
