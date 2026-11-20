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
