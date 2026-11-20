'use strict';
/* kosmos#8846: usage auto-balance is ON by default with 2+ Claude subscription accounts linked (Josh, 2026-10-25, on
   #7152), off with one; the env brakes stay; and #7548's weakest premise (a background shell job reads idle) is closed
   for idle moves by reading Claude Code's footer. */
const test = require('node:test');
const assert = require('node:assert/strict');

const usagepoll = require('./usagepoll');
const automove = require('./automove');
const ab = require('./autobalance');
const status = require('./status');
const fleet = require('../test-support/fleet');

const NOW = Date.parse('2026-11-20T23:00:00Z');

for (const [name, on] of [['usage reading', (env, n) => usagepoll.enabled(env, n)], ['mover', (env, n) => automove.movesOn(env, n)]]) {
  const [FORCE, OFF] = name === 'mover' ? ['AGENT_WORKFORCE_AUTOMOVE', 'AGENT_WORKFORCE_AUTOMOVE_OFF'] : ['AGENT_WORKFORCE_USAGE_POLL', 'AGENT_WORKFORCE_USAGE_POLL_OFF'];
  test(`kosmos#8846: the ${name} is on by default with two or more Claude accounts and no variable, off with one`, () => {
    assert.equal(on({}, 2), true, 'two accounts and no variable: off (the defect this card fixes)');
    assert.equal(on({}, 5), true, 'five accounts and no variable: off');
    assert.equal(on({}, 1), false, 'one account: on (the ruling says nothing at all with one)');
    assert.equal(on({}, 0), false, 'no account: on');
    assert.equal(on({}, () => 3), true, 'a count given as a function was not read');
    assert.equal(on({}, () => { throw new Error('x'); }), false, 'a count that could not be read switched it on');
    assert.equal(on({}, NaN), false, 'a count that is not a number switched it on');
  });
  test(`kosmos#8846: the ${name}'s brake wins, and its old variable still forces it on`, () => {
    assert.equal(on({ [OFF]: '1' }, 4), false, 'the brake did not stop it with four accounts');
    assert.equal(on({ [OFF]: '1', [FORCE]: '1' }, 4), false, 'forcing it on beat the brake');
    assert.equal(on({ [FORCE]: '1' }, 1), true, 'forcing it on with one account (an operator, a test board) did nothing');
    assert.equal(on({ [OFF]: '0' }, 2), true, 'CONTROL: a brake not set to 1 is not the brake');
  });
}

test('kosmos#8846: the linked count is the subscription accounts accounts.list() gives, cached for a minute', () => {
  usagepoll.resetLinkedCacheForTests();
  const rows = [{ dir: 'a', apiKey: false }, { dir: 'b', apiKey: true }, { dir: 'c', apiKey: false }, null];
  assert.equal(usagepoll.claudeAccountsLinked(NOW, () => rows), 2, 'an API-key account counted, or a subscription one did not');
  assert.equal(usagepoll.claudeAccountsLinked(NOW + 1000, () => []), 2, 'the minute cache was not used');
  assert.equal(usagepoll.claudeAccountsLinked(NOW + usagepoll.LINKED_CACHE_MS + 1, () => [{ apiKey: false }]), 1, 'CONTROL: after a minute it reads again');
  usagepoll.resetLinkedCacheForTests();
  assert.equal(usagepoll.claudeAccountsLinked(NOW, () => { throw new Error('unreadable'); }), 0, 'an unreadable list counted accounts');
  usagepoll.resetLinkedCacheForTests();
});

/* The footer as captured from a real Claude Code pane, 2026-11-20 17:2x CST, with one background command running. */
const box = (footer, above = '✻ Cooked for 3s') => [above, '', '─'.repeat(80), '❯ ', '─'.repeat(80), '  angel · Opus 5.5 · ctx 17%', footer].join('\n');
test('kosmos#8846: background shell jobs are read from the footer under the box, never from the transcript', () => {
  assert.equal(status.backgroundShellsIn(box('  ⏵⏵ bypass permissions on · 1 shell · esc to interrupt · ↓ to manage')), 1, 'the real footer with one shell read 0');
  assert.equal(status.backgroundShellsIn(box('  ⏵⏵ accept edits on · 2 shells · ↓ to manage')), 2, 'two shells were not read');
  assert.equal(status.backgroundShellsIn(box('  1 background task · ? for shortcuts')), 1, 'the older wording was not read');
  assert.equal(status.backgroundShellsIn(box('  ⏵⏵ bypass permissions on')), 0, 'CONTROL: no shell reads 0');
  assert.equal(status.backgroundShellsIn(box('  ⏵⏵ bypass permissions on', 'he said · 1 shell · was running')), 0, 'a transcript line quoting the footer counted');
  assert.equal(status.backgroundShellsIn(box('  ⏵⏵ bypass permissions on · 12 shellfish')), 0, 'a word that only starts with shell counted');
  assert.equal(status.backgroundShellsIn('no box here · 1 shell'), 0, 'a pane with no box counted');
  assert.equal(status.backgroundShellsIn(null), 0);
});

test('kosmos#8846: an idle agent with a background shell job is not movable; at its limit it still is', () => {
  const b = fleet.install([fleet.agent('ada', { state: 'idle' })]);
  const base = { ...b.card('ada') };
  const m = (card) => ab.movableFor({ cards: [card], records: [], readCommitment: () => ({ state: 'clear' }), isGuide: () => false, guideName: () => null, nowMs: NOW })('ada');
  assert.equal(m(base), true, 'CONTROL: the idle agent with no shell is movable');
  assert.equal(m({ ...base, backgroundShells: 0 }), true, 'CONTROL: a count of 0 is movable');
  assert.equal(m({ ...base, backgroundShells: 1 }), false, 'an idle agent running a background job was movable: the move would end the job (#7548)');
  const weekly = "You've hit your weekly limit · resets Nov 27 at 4am (America/Chicago)";
  const limited = { ...base, state: 'rate_limited', stateEvidence: weekly, backgroundShells: 1 };
  assert.equal(m(limited), true, 'an agent at its weekly limit with a job running was held: its model can serve nothing where it is (#8048)');
  assert.throws(() => ab.movableFor({ cards: [{ ...base, backgroundShells: 2 }], records: [], readCommitment: () => ({ state: 'clear' }), isGuide: () => false, guideName: () => null, strict: true })('nobody'), /not on the roster/, 'CONTROL: strict still throws for an agent not on the roster');
  assert.equal(ab.movableFor({ cards: [{ ...base, backgroundShells: 2 }], records: [], readCommitment: () => ({ state: 'clear' }), isGuide: () => false, guideName: () => null, strict: true })('ada'), false, 'the mover\'s re-check moved an agent running a job');
});

test('kosmos#8846: the board card carries backgroundShells', () => {
  const b = fleet.install([fleet.agent('ada', { state: 'idle' })]);
  assert.equal(typeof b.card('ada').backgroundShells, 'number', 'the card does not carry the count, so movableFor can never see it');
});

/* Splinter's call on review 19's risk (11-20): the usage poll is gentle now that it is on by default. */
test('kosmos#8846: the poll waits about 30 minutes, give or take 15%, and a reading is used for three polls', () => {
  assert.equal(usagepoll.POLL_MS, 30 * 60 * 1000, 'the poll is not every 30 minutes');
  assert.equal(usagepoll.FRESH_MS, 3 * usagepoll.POLL_MS, 'a reading went stale before the third poll');
  assert.equal(usagepoll.pollDelay(() => 0), Math.round(usagepoll.POLL_MS * 0.85));
  assert.equal(usagepoll.pollDelay(() => 1), Math.round(usagepoll.POLL_MS * 1.15));
  assert.equal(usagepoll.pollDelay(() => 0.5), usagepoll.POLL_MS, 'CONTROL: the middle of the jitter is the period');
  assert.equal(usagepoll.pollDelay(() => NaN), usagepoll.POLL_MS, 'a broken random number gave a wait outside the range');
  assert.equal(usagepoll.pollDelay(() => 9), Math.round(usagepoll.POLL_MS * 1.15), 'a random number above 1 was not held to the range');
});

test('kosmos#8846: accounts with agents are asked every sweep; empty ones only while an account is at risk', () => {
  const list = [{ dir: '/u/busy' }, { dir: '/u/empty' }, { dir: '/u/unknown' }, { dir: '/u/key', apiKey: true }, null];
  const hasAgents = (a) => { if (a.dir === '/u/unknown') throw new Error('walk incomplete'); return a.dir === '/u/busy'; };
  const dirs = (o) => usagepoll.accountsToPoll(list, o).map((a) => a.dir);
  assert.deepEqual(dirs({ hasAgents }), ['/u/busy', '/u/unknown'], 'an empty account was asked with nothing at risk, or a busy or untellable one was not');
  assert.deepEqual(dirs({ hasAgents, needTargets: true }), ['/u/busy', '/u/empty', '/u/unknown'], 'with an account at risk the empty one (the target) was not asked');
  assert.deepEqual(dirs({}), ['/u/busy', '/u/empty', '/u/unknown'], 'CONTROL: with no way to tell, every subscription account is asked');
  assert.deepEqual(usagepoll.accountsToPoll(null, { hasAgents }), []);
});

test('kosmos#8846: the at-risk line is 80%, leaving headroom for the slower poll, and under it the targets stay below 70%', () => {
  assert.equal(ab.AT_RISK_PCT, 80);
  assert.ok(ab.AT_RISK_PCT - ab.TARGET_MAX_PCT >= 10, 'at risk and target overlap: an account could be both');
});

test('kosmos#8846: a 401, 403 or 429 holds the account for six hours, is said once, and is never retried in the sweep', async (t) => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-8846-poll-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(usagepoll.BACKOFF_MS, 6 * 60 * 60 * 1000);
  for (const code of [401, 403, 429]) {
    const a = { dir: path.join(dir, 'acct-' + code), email: 'x@example.test', label: 'acct' };
    fs.mkdirSync(a.dir);
    let sent = 0; const said = [];
    const deps = {
      now: NOW, platform: 'darwin', realHome: '/',
      readCred: async () => JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: NOW + 86400000 } }),
      request: (opts, cb) => {   // https.request's shape, as usagepoll-7152.test.js fakes it
        const { EventEmitter } = require('node:events');
        const req = new EventEmitter(); req.destroy = () => {};
        req.end = () => { sent += 1; setImmediate(() => { const res = new EventEmitter(); res.statusCode = code; res.setEncoding = () => {}; cb(res); res.emit('data', '{}'); res.emit('end'); }); };
        return req;
      },
      identityOf: () => null,
      onRefused: (acct, state) => said.push(state),
    };
    await usagepoll.pollAll([a], deps);
    const firstSent = sent;
    assert.ok(firstSent >= 1 && firstSent <= 2, `a ${code} was retried within the sweep (${firstSent} requests)`);
    assert.equal(said.length, 1, `a ${code} was not said once`);
    await usagepoll.pollAll([a], { ...deps, now: NOW + 5.9 * 3600000 });
    assert.equal(sent, firstSent, `a ${code} was asked again inside six hours`);
    assert.equal(said.length, 1, `a held ${code} was said again`);
    await usagepoll.pollAll([a], { ...deps, now: NOW + 6.1 * 3600000 });
    assert.ok(sent > firstSent, `CONTROL: after six hours a ${code} account is asked again`);
  }
});
