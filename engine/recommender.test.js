'use strict';
/* #3595 phase 1: the Recommender's pure step. Every rule is tested with the arm that must
 * fire AND the arm that must not, so a test that passes cannot be passing vacuously. */
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('./recommender');

const T0 = 1_000_000_000_000;
const ON = { on: true, guards: { money: true, public: true, delete: true } };
const members = new Map([['proj-a', ['april', 'mona', 'pete', 'angel']], ['proj-solo', ['solo']]]);

function agent(over) {
  return { sessionName: 'april', name: 'April', state: 'blocked', stateReportedBy: 'agent',
    stateProject: 'proj-a', because: 'which of two layouts to ship', ...over };
}
/* Run step twice: once to be seen, once after the grace period. */
function afterGrace(roster, setting = ON, extra = {}) {
  const first = r.step({ prev: undefined, roster, setting, members, now: T0, ...extra });
  return r.step({ prev: first.next, roster, setting, members, now: T0 + r.GRACE_MS, ...extra });
}

test('a reported block past the grace period is convened; inside the grace it is not', () => {
  const roster = [agent(), agent({ sessionName: 'mona', name: 'Mona', state: 'idle', stateReportedBy: null })];
  const early = r.step({ prev: undefined, roster, setting: ON, members, now: T0 });
  assert.equal(early.toConvene.length, 0, 'convened before the grace period');
  const late = afterGrace(roster);
  assert.equal(late.toConvene.length, 1, 'not convened after the grace period');
  assert.equal(late.toConvene[0].session, 'april');
  assert.equal(late.toConvene[0].project, 'proj-a');
});

test('needs_you reported by the agent triggers too; working/idle do not', () => {
  assert.equal(afterGrace([agent({ state: 'needs_you' })]).toConvene.length, 1);
  assert.equal(afterGrace([agent({ state: 'working' })]).toConvene.length, 0);
  assert.equal(afterGrace([agent({ state: 'idle' })]).toConvene.length, 0);
});

test('only an AGENT report counts: auto (hooks) and operator reports are never convened', () => {
  assert.equal(afterGrace([agent({ stateReportedBy: 'agent' })]).toConvene.length, 1, 'control: agent report fires');
  assert.equal(afterGrace([agent({ stateReportedBy: 'auto' })]).toConvene.length, 0, 'a hook report (permission prompt / provider outage) was convened');
  assert.equal(afterGrace([agent({ stateReportedBy: 'operator' })]).toConvene.length, 0, 'the person\'s own report was convened');
  assert.equal(afterGrace([agent({ stateReportedBy: null })]).toConvene.length, 0, 'a screen-scraped state was convened');
});

test('a report with no project is not convened (there is no room to ask in)', () => {
  assert.equal(afterGrace([agent({ stateProject: null })]).toConvene.length, 0);
  assert.equal(afterGrace([agent({ stateProject: 'proj-a' })]).toConvene.length, 1, 'control');
});

test('setting OFF convenes nothing and resets memory; a null roster keeps memory', () => {
  assert.equal(afterGrace([agent()], { on: false }).toConvene.length, 0);
  const seen = r.step({ prev: undefined, roster: [agent()], setting: ON, members, now: T0 });
  const off = r.step({ prev: seen.next, roster: [agent()], setting: { on: false }, members, now: T0 + 1 });
  assert.equal(off.next.items.size, 0, 'off did not reset memory');
  const blind = r.step({ prev: seen.next, roster: null, setting: ON, members, now: T0 + r.GRACE_MS });
  assert.equal(blind.toConvene.length, 0);
  assert.equal(blind.next, seen.next, 'a roster read failure dropped the memory');
});

test('an item is convened once: a PLACED delivery ends it; an unplaced one retries the PANE only, capped', () => {
  const roster = [agent()];
  const a = afterGrace(roster);
  assert.equal(a.toConvene.length, 1);
  assert.equal(a.toConvene[0].retry, false, 'the first convening must post the room note');
  r.markAttempt(a.next, a.toConvene[0].key, false); // room note out, pane not placed
  let prev = a.next; let now = T0 + r.GRACE_MS;
  for (let i = 1; i < r.MAX_DELIVERY_ATTEMPTS; i++) {
    now += 60000;
    const again = r.step({ prev, roster, setting: ON, members, now });
    assert.equal(again.toConvene.length, 1, 'an unplaced delivery was not retried (attempt ' + i + ')');
    assert.equal(again.toConvene[0].retry, true, 'a retry would post a second room note');
    r.markAttempt(again.next, again.toConvene[0].key, false);
    prev = again.next;
  }
  const exhausted = r.step({ prev, roster, setting: ON, members, now: now + 60000 });
  assert.equal(exhausted.toConvene.length, 0, 'retries were not capped');
  // Retries charged no budget: a second item for the same agent still fits the per-agent cap.
  const two = r.step({ prev: exhausted.next, roster: [agent(), agent({ because: 'another item' })], setting: ON, members, now: now + 60000 + r.GRACE_MS });
  const three = r.step({ prev: two.next, roster: [agent(), agent({ because: 'another item' })], setting: ON, members, now: now + 60000 + 2 * r.GRACE_MS });
  assert.equal(three.toConvene.filter((c) => !c.retry).length, 1, 'retries spent the per-agent budget');
  // And a PLACED delivery ends the item for good.
  const fresh = afterGrace(roster);
  r.markAttempt(fresh.next, fresh.toConvene[0].key, true);
  const done = r.step({ prev: fresh.next, roster, setting: ON, members, now: T0 + r.GRACE_MS + 60000 });
  assert.equal(done.toConvene.length, 0, 'a convened item fired twice');
});

test('a resolved item is forgotten, so the same words later are a new item', () => {
  const a = afterGrace([agent()]);
  r.markConvened(a.next, a.toConvene[0].key);
  const cleared = r.step({ prev: a.next, roster: [agent({ state: 'working', stateReportedBy: 'agent' })], setting: ON, members, now: T0 + r.GRACE_MS + 1 });
  assert.equal(cleared.next.items.size, 0);
  const back = r.step({ prev: cleared.next, roster: [agent()], setting: ON, members, now: T0 + r.GRACE_MS + 2 });
  assert.equal(back.toConvene.length, 0, 'a fresh item skipped its grace period');
});

test('caps: at most MAX_PER_AGENT_PER_HOUR per agent and MAX_PER_HOUR overall', () => {
  // One agent, many distinct items: capped per agent.
  const many = [1, 2, 3, 4].map((i) => agent({ because: 'item ' + i }));
  const perAgent = afterGrace(many);
  assert.equal(perAgent.toConvene.length, r.MAX_PER_AGENT_PER_HOUR);
  // Many agents, one item each: capped overall.
  const names = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];
  const bigMembers = new Map([['proj-a', names]]);
  const fleet = names.map((n) => agent({ sessionName: n, name: n }));
  const overall = afterGrace(fleet, ON, { members: bigMembers });
  assert.equal(overall.toConvene.length, r.MAX_PER_HOUR);
  // An hour later the budget is back.
  const later = r.step({ prev: overall.next, roster: fleet, setting: ON, members: bigMembers, now: T0 + r.GRACE_MS + 61 * 60 * 1000 });
  assert.ok(later.toConvene.length > 0, 'the hourly budget never recovered');
});

test('peers: up to two OTHER members, unstuck ones first; none on a solo project', () => {
  const roster = [agent(), agent({ sessionName: 'mona', name: 'Mona', because: 'her own thing' }),
    agent({ sessionName: 'pete', name: 'Pete', state: 'idle', stateReportedBy: null }),
    agent({ sessionName: 'angel', name: 'Angel', state: 'working', stateReportedBy: null })];
  const out = afterGrace(roster);
  const april = out.toConvene.find((c) => c.session === 'april');
  assert.deepEqual(april.peers.map((p) => p.session), ['pete', 'angel'], 'stuck Mona was preferred over free members, or self was included');
  const solo = afterGrace([agent({ sessionName: 'solo', name: 'Solo', stateProject: 'proj-solo' })]);
  assert.deepEqual(solo.toConvene[0].peers, []);
});

test('texts: the playbook names only ACTIVE guards; the room note @-mentions the peers', () => {
  const item = { name: 'April', because: 'x', peers: [{ session: 'pete', name: 'Pete' }] };
  const all = r.playbookText(item, ON);
  for (const g of Object.values(r.GUARD_TEXT)) assert.ok(all.includes(g), 'missing guard: ' + g);
  const noMoney = r.playbookText(item, { on: true, guards: { money: false, public: true, delete: true } });
  assert.ok(!noMoney.includes(r.GUARD_TEXT.money), 'a switched-off guard was still named');
  assert.ok(noMoney.includes(r.GUARD_TEXT.public));
  const missing = r.playbookText(item, { on: true });
  for (const g of Object.values(r.GUARD_TEXT)) assert.ok(missing.includes(g), 'a missing guard read as off (must fail safe to on)');
  assert.match(r.roomNoteText(item), /@Pete/);
  assert.match(r.roomNoteText({ ...item, peers: [] }), /no one else is on this project/);
  assert.ok(!/—/.test(all + r.roomNoteText(item)), 'em dash in product copy');
});
