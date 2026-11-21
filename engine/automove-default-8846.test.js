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

/* Review 1: through the board's own card, from a real idle screen with the footer Claude Code draws (April's pane,
   11-20 17:3x, at her prompt with one background job). */
const RULE = '─'.repeat(80);
const idleScreen = (footer) => `Worked for 1m 02s\n\n${RULE}\n\u276f\u00a0\n${RULE}\n  april · Opus 5.5 · ctx 20%\n${footer}\n`;
test('kosmos#8846: the board card reads the shell count off a real idle screen, and movableFor acts on it', () => {
  const b = fleet.install([
    fleet.agent('ada', { state: 'idle', screen: idleScreen('  ⏵⏵ bypass permissions on · 1 shell · ↓ to manage') }),
    fleet.agent('bea', { state: 'idle', screen: idleScreen('  ⏵⏵ bypass permissions on (shift+tab to cycle)') }),
  ]);
  const ada = b.card('ada'); const bea = b.card('bea');
  assert.equal(ada.state, 'idle', 'CONTROL: the screen reads idle');
  assert.equal(ada.backgroundShells, 1, 'the card did not carry the footer\'s shell');
  assert.equal(bea.backgroundShells, 0, 'CONTROL: no shell in the footer reads 0');
  const m = (name) => ab.movableFor({ cards: [{ ...ada }, { ...bea }], records: [], readCommitment: () => ({ state: 'clear' }), isGuide: () => false, guideName: () => null, nowMs: NOW })(name);
  assert.equal(m('ada'), false, 'an idle agent with a background job on its real screen was movable');
  assert.equal(m('bea'), true, 'CONTROL: the same idle agent with none is movable');
});

test('kosmos#8846 review 1: a cut footer still counts, and an older > prompt is read', () => {
  assert.equal(status.backgroundShellsIn(box('  ⏵⏵ bypass permissions on · 1 sh…')), 1, 'a footer cut by a narrow pane read no shells');
  assert.equal(status.backgroundShellsIn(box('  ⏵⏵ bypass permissions on · 2 shells · ↓ to ma…')), 2, 'CONTROL: a cut after the count still reads it');
  assert.equal(status.backgroundShellsIn(box('  ⏵⏵ bypass permissions on · auto…')), 0, 'a cut word with no count counted');
  assert.equal(status.backgroundShellsIn(`> \n${RULE}\n  ⏵⏵ accept edits on · 1 shell`), 1, 'the older > prompt was not read');
});

test('kosmos#8846 review 1: =0 stays off, a test or dry-run board never takes the default, and logins are counted not folders', () => {
  for (const [force, on] of [['AGENT_WORKFORCE_USAGE_POLL', (e, n) => usagepoll.enabled(e, n)], ['AGENT_WORKFORCE_AUTOMOVE', (e, n) => automove.movesOn(e, n)]]) {
    assert.equal(on({ [force]: '0' }, 4), false, `${force}=0 was turned on by four accounts`);
    assert.equal(on({ [force]: 'false' }, 4), false, `${force}=false was turned on`);
    assert.equal(on({ [force]: '' }, 4), true, 'CONTROL: an empty value is unset');
    assert.equal(on({ NODE_TEST_CONTEXT: 'child-v8' }, 4), false, `a test board took the default (${force})`);
    assert.equal(on({ AGENT_WORKFORCE_DRY_RUN: '1' }, 4), false, `a dry-run board took the default (${force})`);
    assert.equal(on({ NODE_TEST_CONTEXT: 'child-v8', [force]: '1' }, 1), true, 'CONTROL: forcing it on still works under a test');
  }
  usagepoll.resetLinkedCacheForTests();
  const sameLogin = [{ dir: '/h/.claude', email: 'A@x.test', organization: 'o1' }, { dir: '/h/.claude-b', email: 'a@x.test', organization: 'o1' }];
  assert.equal(usagepoll.claudeAccountsLinked(NOW, () => sameLogin), 1, 'two folders on one login counted as two accounts');
  usagepoll.resetLinkedCacheForTests();
  assert.equal(usagepoll.claudeAccountsLinked(NOW, () => [...sameLogin, { dir: '/h/.claude-c', email: 'a@x.test', organization: 'o2' }]), 2, 'CONTROL: the same email in another organization is another account');
  usagepoll.resetLinkedCacheForTests();
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
    assert.equal(firstSent, 1, `a ${code} was retried within the sweep (${firstSent} requests)`);   // review 2: exactly one
    assert.equal(said.length, 1, `a ${code} was not said once`);
    await usagepoll.pollAll([a], { ...deps, now: NOW + 5.9 * 3600000 });
    assert.equal(sent, firstSent, `a ${code} was asked again inside six hours`);
    assert.equal(said.length, 1, `a held ${code} was said again`);
    await usagepoll.pollAll([a], { ...deps, now: NOW + 6.1 * 3600000 });
    assert.ok(sent > firstSent, `CONTROL: after six hours a ${code} account is asked again`);
  }
});

/* Review 2: which accounts a sweep asks about. */
test('kosmos#8846 review 2: empty accounts are asked only while an account WITH AGENTS is at risk, in a decision the sweep made', () => {
  const list = [{ dir: '/u/busy' }, { dir: '/u/empty' }, { dir: '/u/spare' }];
  const hasAgents = (a) => a.dir === '/u/busy';
  const plan = (o) => usagepoll.planPoll({ list, hasAgents, settingOn: true, ...o });
  const dirs = (o) => plan(o).asked.map((a) => a.dir);
  assert.deepEqual(dirs({ last: null }), ['/u/busy'], 'with no decision an empty account was asked');
  assert.deepEqual(dirs({ last: { atRisk: [{ from: '/u/busy' }], moves: [], unmeasured: [] } }), ['/u/busy', '/u/empty', '/u/spare'], 'a busy account at risk did not get its targets read');
  assert.deepEqual(dirs({ last: { atRisk: [{ from: '/u/empty' }], moves: [], unmeasured: [] } }), ['/u/busy'], 'an EMPTY account at risk (one already moved off, or a stopped empty login) kept every empty account polled');
  assert.deepEqual(dirs({ last: { atRisk: [{ from: '/u/gone' }] } }), ['/u/busy'], 'an account gone from the list needed targets');
  assert.deepEqual(dirs({ lastDid: 'off', last: { atRisk: [{ from: '/u/busy' }] } }), ['/u/busy'], 'a decision from before the switch went off still read every empty account');
  assert.deepEqual(dirs({ last: { atRisk: [], moves: [{ to: '/u/spare' }], unmeasured: ['/u/empty'] } }), ['/u/busy', '/u/empty', '/u/spare'], 'a named target or an unmeasured account was never read again');
  assert.equal(plan({ last: { atRisk: [{ from: '/u/busy' }] } }).needTargets, true);
  const unsure = usagepoll.planPoll({ list, settingOn: true, hasAgents: (a) => { if (a.dir === '/u/busy') throw new Error('incomplete'); return false; }, last: { atRisk: [{ from: '/u/busy' }] } });
  assert.equal(unsure.needTargets, true, 'an at-risk account whose agents could not be told was taken as empty');
});

test('kosmos#8846 review 2: with auto-balance off in Settings nothing is asked', () => {
  const list = [{ dir: '/u/busy' }, { dir: '/u/empty' }];
  const off = usagepoll.planPoll({ list, hasAgents: () => true, settingOn: false, last: { atRisk: [{ from: '/u/busy' }] } });
  assert.deepEqual([off.asked, off.off, off.needTargets], [[], true, false], 'the switch off still sent tokens');
  assert.equal(usagepoll.planPoll({ list, hasAgents: () => true, settingOn: true }).asked.length, 2, 'CONTROL: on, the busy accounts are asked');
});

test('kosmos#8846 review 2: the sweep keeps its own 10-minute period, and the mover\'s default follows it', () => {
  const sweep = require('./autobalance-sweep');
  assert.equal(sweep.SWEEP_MS, 10 * 60 * 1000);
  assert.equal(automove.PERIOD_MS, sweep.SWEEP_MS, 'the mover measures its two ticks in the 30-minute poll period');
  assert.ok(usagepoll.FRESH_MS >= 2 * sweep.SWEEP_MS + usagepoll.POLL_MS, 'a reading goes stale between polls while the sweep needs it');
});
