'use strict';
/**
 * kosmos#9031: an account whose Claude login has run out. Three things that missed it: the patterns that read Claude
 * Code's own sentence (the screen, the Windows stream, Check now), the line `kosmos accounts` prints, and the mover's
 * idea of a usable account. Pure: no board, no Keychain, no real claude.
 *
 *   node --test engine/loginended-9031.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { isStreamSignInError } = require('./claudesignintext');
const { classify, STATE } = require('./status');
const { accountLine } = require('./accountline');
const ab = require('./autobalance');
const usagepoll = require('./usagepoll');
const create = require('./create');
const subscription = require('./subscription');

test.after(() => create.setClaudeProbe(null));

const NOW = Date.parse('2026-11-24T22:00:00Z');
const H = 3600000;
/* Byte-exact from Claude Code 2.1.332; the first two also from real transcripts (11-22 and 11-24). */
const LIMIT = 'Login reached its time limit · Please run /login';
const NONE = 'Not logged in · Please run /login';
const HEADLESS_LIMIT = 'Failed to authenticate: this login reached its time limit and cannot be renewed. Run `claude auth login` to sign in again, or use `claude setup-token` and set CLAUDE_CODE_OAUTH_TOKEN for unattended jobs';
const HEADLESS_REFRESH = 'Failed to authenticate: OAuth session expired and could not be refreshed. Run `claude auth login` to sign in again';

const pane = () => ({ session: 'made-here', name: 'made-here', claim: 'made-here', command: '2.1.332', title: 'Ready' });

test('#9031: an agent stopped at a login past its limit, or at no login, reads auth_failed, with the line as evidence', () => {
  for (const line of [LIMIT, NONE, NONE.replace('·', '_')]) {
    const r = classify(pane(), '> hello\n● ' + line + '\n');
    assert.equal(r.state, STATE.AUTH_FAILED, 'missed: ' + line);
    assert.ok(r.evidence.startsWith(line), 'the evidence is not the line: ' + r.evidence);
  }
});

test('#9031 CONTROL: the words without Claude Code\'s own remedy, and another tool\'s "not logged in", are not a sign-in failure', () => {
  for (const line of ['The pane said Login reached its time limit, which is #9031.', 'Not logged in',
    'gh: Not logged in to any hosts, then Please run /login was typed', 'Not logged in - Please run /login', 'Not logged in. Run az login. Later: Please run /login']) {
    assert.notEqual(classify(pane(), line + '\n').state, STATE.AUTH_FAILED, 'read as a sign-in failure: ' + line);
  }
});

test('#9031: the Windows stream reads the same two, and the headless sentences', () => {
  for (const text of [LIMIT, NONE, HEADLESS_LIMIT, HEADLESS_REFRESH]) assert.equal(isStreamSignInError(text), true, 'missed: ' + text);
  for (const text of ['the build reached its time limit', 'session expired and could not be refreshed', 'ok']) {
    assert.equal(isStreamSignInError(text), false, 'CONTROL: read as a sign-in failure: ' + text);
  }
});

test('#9031: Check now calls each of them a dead sign-in, whatever the exit code', async () => {
  const check = async (out, exitCode) => { create.setClaudeProbe(async () => ({ exitCode, out })); return (await create.claudeAccountCheck('/u/x')).state; };
  for (const out of [LIMIT, NONE, HEADLESS_LIMIT, HEADLESS_REFRESH]) {
    assert.equal(await check(out, 1), subscription.STATE.NONE, 'not dead: ' + out);
    assert.equal(await check(out, 0), subscription.STATE.NONE, 'a clean exit hid: ' + out);
  }
  assert.equal(await check('ok', 0), subscription.STATE.CONNECTED, 'CONTROL: a real answer');
  assert.equal(await check('Please run /login', 1), subscription.STATE.UNKNOWN, 'CONTROL: the remedy alone (#1916)');
});

const row = (connection) => ({ provider: 'anthropic', providerName: 'Anthropic / Claude', email: 'a@example.com', connection });

test('#9031: kosmos accounts says an ended login has expired, whatever its badge, and what to do', () => {
  const ended = /: its sign-in has expired\. The person signs in again to bring its agents back, or moves them to another account, in Settings > AI Models$/;
  for (const badge of ['working', 'signed_in_unverified']) {
    assert.match(accountLine(row({ state: 'connected', badge, loginEnded: true }), NOW), ended, badge);
  }
  assert.equal(accountLine(row({ state: 'connected', badge: 'working' }), NOW), 'Anthropic / Claude: a@example.com: signed in', 'CONTROL: a working login');
  assert.match(accountLine(row({ state: 'connected', badge: 'working', loginEnded: true, loginStopsAt: NOW + H }), NOW),
    /its agents keep working until/, 'CONTROL: while its agents still work, that is what it says');
});

const mrow = (dir, o = {}) => ({ provider: 'anthropic', dir, email: `${dir}@example.test`, memoryShared: true, apiKey: false,
  connection: { badge: 'working' }, weekly: { usedPct: 20, resetsAt: NOW + 72 * H }, fiveHour: null, agentsHere: { names: [], complete: true }, ...o });

test('#9031: the mover never sends agents to an ended login, and an account with one is at risk by login', () => {
  const full = () => mrow('/u/a', { weekly: { usedPct: 95, resetsAt: NOW + 40 * H }, agentsHere: { names: ['raph'], complete: true } });
  const decide = (rows) => ab.decide({ rows, movable: () => true, nowMs: NOW });
  for (const badge of ['working', 'signed_in_unverified']) {
    const spare = mrow('/u/b', { connection: { badge, loginEnded: true } });
    assert.deepEqual(decide([full(), spare]).moves, [], `an ended login (${badge}) was a target`);
    assert.equal(ab.bulkTargetable(spare, NOW), false, `the page's bulk move offers an ended login (${badge})`);
    assert.equal(decide([full(), mrow('/u/b', { connection: { badge } })]).moves.length, 1, `CONTROL: ${badge} with its login good is a target`);
  }
  const d = decide([mrow('/u/a', { connection: { badge: 'signed_in_unverified', loginEnded: true }, agentsHere: { names: ['raph'], complete: true } }), mrow('/u/b')]);
  assert.deepEqual(d.atRisk.map((x) => [x.from, x.kind]), [['/u/a', 'login']]);
  assert.match(d.atRisk[0].why, /login has stopped working/);
});

const cred = (o) => JSON.stringify({ claudeAiOauth: { accessToken: 'not-a-real-token', ...o } });
const state = async (o) => (await usagepoll.tokenStateFor({ dir: '/u/x' }, { now: NOW, platform: 'darwin', realHome: '/', readCred: async () => cred(o) })).state;

test('#9031: the usage reader tells an ended login from an access token waiting for its next renewal', async () => {
  assert.equal(await state({ expiresAt: NOW - 1, refreshTokenExpiresAt: NOW - 1 }), 'login-ended');
  assert.equal(await state({ expiresAt: NOW, refreshTokenExpiresAt: NOW }), 'login-ended', 'at the moment itself');
  assert.equal(await state({ expiresAt: NOW - 1, refreshTokenExpiresAt: NOW + 1 }), 'token-expired', 'CONTROL: it can still be renewed');
  assert.equal(await state({ expiresAt: NOW - 1 }), 'token-expired', 'CONTROL: no date to read says nothing about the login');
  for (const odd of [0, -5, null, '1']) assert.equal(await state({ expiresAt: NOW - 1, refreshTokenExpiresAt: odd }), 'token-expired', 'not a date: ' + odd);
  assert.equal(await state({ expiresAt: NOW + 30000, refreshTokenExpiresAt: NOW - 1 }), 'token-expired', 'an access token with seconds left still works');
  assert.equal(await state({ expiresAt: NOW + H, refreshTokenExpiresAt: NOW - 1 }), 'ok', 'CONTROL: its agents still work on the access they hold');
});

test('#9031: the sweep reads an ended login as a stopped one, never as a blip, and a renewal as a blip', () => {
  const list = [{ dir: '/u/work', memoryShared: true, email: 'w@example.test' }, { dir: '/u/spare', memoryShared: true, email: 's@example.test' }];
  const rec = (usedPct, st, email) => ({ at: NOW, measuredAt: NOW, state: st, email, weekly: { usedPct, resetsAt: (NOW + 72 * H) / 1000 }, fiveHour: null });
  const at = (spareState) => ab.rowsFromReadings({ list, nowMs: NOW,
    readUsage: (dir) => (dir === '/u/spare' ? rec(10, spareState, 's@example.test') : rec(95, 'ok', 'w@example.test')),
    agentsOn: (dir) => ({ names: dir === '/u/work' ? ['ada'] : [], complete: true }) });
  assert.equal(at('login-ended')[1].connection.badge, 'rejected');
  assert.deepEqual(ab.decide({ rows: at('login-ended'), movable: () => true, nowMs: NOW }).moves, [], 'agents would move onto an ended login');
  assert.equal(ab.decide({ rows: at('token-expired'), movable: () => true, nowMs: NOW }).moves.length, 1, 'CONTROL: a renewal is a blip');
});

const ap = require('./authprobe');
const live = require('./claudeloginlive');

test('#9031: a login is over only when both its dates were read and both have passed', async () => {
  const over = async (dates) => { live._clearForTest(); live.setReaderForTests(() => dates); return live.ended({ dir: '/u/x' }, NOW); };
  try {
    assert.equal(await over({ until: NOW - 1, works: NOW - 1 }), true);
    assert.equal(await over({ until: NOW, works: NOW }), true, 'at the moment itself');
    assert.equal(await over({ until: NOW - 1, works: NOW + H }), false, 'its agents still work on the access they hold');
    assert.equal(await over({ until: NOW + H, works: NOW - 1 }), false, 'it can still be renewed');
    assert.equal(await over({ until: NOW - 1, works: null }), false, 'an access date not read');
    assert.equal(await over({ until: null, works: NOW - 1 }), false, 'a login date not read');
    /* The person signs in again while the dates are being read: those dates are the old login's. */
    live._clearForTest(); live.setReaderForTests(() => { require('./loginexpiry').loginChanged(); return { until: NOW - 1, works: NOW - 1 }; });
    assert.equal(await live.ended({ dir: '/u/x' }, NOW), false, 'the dates of the login before a new sign-in were used');
    live._clearForTest(); live.setReaderForTests(() => ({ until: NOW - 1, works: NOW - 1 }));
    assert.equal(await live.ended({ apiKey: true, dir: '/k' }, NOW), false, 'a key has no login to end');
  } finally { live.setReaderForTests(null); live._clearForTest(); }
});

test('#9031: the account check calls an over login not connected, and asks the dates only when status says connected', async () => {
  const S = subscription.STATE;
  const asked = [];
  const of = async (state, ended) => (await ap.liveOf('/u/x', { check: async () => ({ state }), ended: async (d) => { asked.push(d); return ended(); } })).state;
  assert.equal(await of(S.CONNECTED, () => true), S.NONE);
  assert.equal(await of(S.CONNECTED, () => false), S.CONNECTED, 'CONTROL');
  assert.equal(await of(S.CONNECTED, () => { throw new Error('no'); }), S.CONNECTED, 'dates that cannot be read change nothing');
  assert.deepEqual(asked, ['/u/x', '/u/x', '/u/x']);
  assert.equal(await of(S.UNKNOWN, () => true), S.UNKNOWN);
  assert.equal(await of(S.NONE, () => true), S.NONE);
  assert.equal(asked.length, 3, 'asked the dates of an account that is not connected');
  /* The real wiring: the default account's dates are the bare entry's, another account's its own folder's. */
  const ccds = [];
  live._clearForTest(); live.setReaderForTests((ccd) => { ccds.push(ccd); return { until: 1, works: 1 }; });
  try {
    const check = async () => ({ state: S.CONNECTED });
    assert.equal((await ap.liveOf(null, { check })).state, S.NONE);
    assert.equal((await ap.liveOf('/u/y', { check })).state, S.NONE);
    assert.deepEqual(ccds, [undefined, '/u/y']);
  } finally { live.setReaderForTests(null); live._clearForTest(); }
});
