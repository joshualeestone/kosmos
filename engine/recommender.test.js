'use strict';
/* #3595 phase 1: the Recommender's pure step. Every rule is tested with the arm that must
 * fire AND the arm that must not, so a test that passes cannot be passing vacuously.
 *
 * step() consumes board cards (safeRoster()), so these tests feed it cards the REAL
 * snapshot() pipeline produced from real panes plus real self-reports (test-support/fleet +
 * selfreport.record), never hand-built literals: fixture-discipline forbids a hand-built
 * card, because one is free to carry fields the producer never emits. Same pattern as
 * class1-autohandle-sweep-2808.test.js. */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// Sandbox every root BEFORE requiring status/fleet/selfreport (they resolve roots at require time).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'recommender-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

const test = require('node:test');
const assert = require('node:assert/strict');

const fleet = require('../test-support/fleet');
const status = require('./status');
const selfreport = require('./selfreport');
const r = require('./recommender');
const projects = require('./projects');
const { DELIVERY } = require('./chat'); // the real verdict states the runner compares against

test.after(() => { try { fleet.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const T0 = 1_000_000_000_000;
const ON = { on: true, guards: { money: true, public: true, delete: true } };
const STUCK = (because, project = 'proj-a') => ({ state: 'needs_you', because, project });

/* Install agents, write their self-reports, return the reconciled cards. Each spec is
   { name, displayName?, paneState?, report? }. `key[name]` is the sessionName the real card
   carries (the self-report key); `again(name, report)` records a new report and re-snapshots,
   so a test can move an agent between states the way the real board would see it. */
function stuckBoard(specs) {
  const board = fleet.install(specs.map((s) => fleet.agent(s.name, { state: s.paneState || 'idle', displayName: s.displayName })));
  const key = {};
  for (const s of specs) {
    // Exact match first: a prefix match alone lets 'run' resolve to 'rungone'.
    const card = board.agents.find((c) => c.sessionName === s.name)
      || board.agents.find((c) => (c.sessionName || '').startsWith(s.name));
    key[s.name] = card ? card.sessionName : s.name;
    if (s.report) {
      const rec = selfreport.record(key[s.name], s.report);
      assert.equal(rec.recorded, true, 'fixture: the self-report was refused: ' + JSON.stringify(rec));
    }
  }
  const cards = () => status.snapshot().agents;
  const again = (name, report) => {
    const rec = selfreport.record(key[name], report);
    assert.equal(rec.recorded, true, 'fixture: the self-report was refused: ' + JSON.stringify(rec));
    return cards();
  };
  // Clear every report on the way out, so the next test's agents start with no standing block.
  const restore = () => {
    for (const s of specs) { try { selfreport.record(key[s.name], { state: 'working', because: 'test over' }); } catch { /* best effort */ } }
    board.restore();
  };
  return { cards: cards(), key, again, restore };
}

/* Every agent on the board is a member of proj-a (the Recommender acts only in a live project the
   stuck agent belongs to). */
const inProj = (b) => new Map([['proj-a', Object.values(b.key)]]);

/* Run step twice: once to be seen, once after the grace period. */
function afterGrace(roster, members, setting = ON) {
  const first = r.step({ prev: undefined, roster, setting, members, now: T0 });
  return r.step({ prev: first.next, roster, setting, members, now: T0 + r.GRACE_MS });
}

test('fixture control: a real self-reported block reaches the card with the fields step() reads', () => {
  const b = stuckBoard([{ name: 'ctl', report: STUCK('which of two layouts to ship') }]);
  try {
    const card = b.cards.find((c) => c.sessionName === b.key.ctl);
    assert.ok(card, 'the agent is on the board');
    assert.equal(card.state, 'needs_you');
    assert.equal(card.stateReportedBy, 'agent');
    assert.equal(card.stateProject, 'proj-a');
    assert.equal(card.because, 'which of two layouts to ship');
    assert.ok(r.stuckRow(card), 'a real stuck card was not recognised');
  } finally { b.restore(); }
});

test('a reported block past the grace period is convened; inside the grace it is not', () => {
  const b = stuckBoard([{ name: 'grc', report: STUCK('which of two layouts to ship') }, { name: 'grcpeer' }]);
  try {
    const members = new Map([['proj-a', [b.key.grc, b.key.grcpeer]]]);
    const early = r.step({ prev: undefined, roster: b.cards, setting: ON, members, now: T0 });
    assert.equal(early.toConvene.length, 0, 'convened before the grace period');
    const late = afterGrace(b.cards, members);
    assert.equal(late.toConvene.length, 1, 'not convened after the grace period');
    assert.equal(late.toConvene[0].session, b.key.grc);
    assert.equal(late.toConvene[0].project, 'proj-a');
  } finally { b.restore(); }
});

test('a real `blocked` report is never convened: its card carries no project and no provenance', () => {
  // The engine comment's claim, guarded: if status.js ever starts carrying project/by on a
  // blocked card, this fails and the decision to skip `blocked` should be revisited.
  const b = stuckBoard([{ name: 'blk', report: { state: 'blocked', because: 'waiting for the API key', on: 'the API key', owner: 'Josh', project: 'proj-a' } }]);
  try {
    const card = b.cards.find((c) => c.sessionName === b.key.blk);
    assert.equal(card.state, 'blocked', 'fixture: the blocked report did not reach the card');
    assert.equal(card.stateProject, null);
    assert.equal(card.stateReportedBy, null);
    assert.equal(r.stuckRow(card), null);
    assert.equal(afterGrace(b.cards, inProj(b)).toConvene.length, 0);
  } finally { b.restore(); }
});

test('needs_you reported by the agent triggers; working/idle do not', () => {
  const b = stuckBoard([
    { name: 'nyq', report: { state: 'needs_you', because: 'which venue', project: 'proj-a' } },
    { name: 'nywork', report: { state: 'working', because: 'building', project: 'proj-a' } },
    { name: 'nyidle', report: { state: 'idle', because: 'done', project: 'proj-a' } },
  ]);
  try {
    const out = afterGrace(b.cards, inProj(b));
    assert.deepEqual(out.toConvene.map((c) => c.session), [b.key.nyq]);
  } finally { b.restore(); }
});

test('only an AGENT report counts: an auto (hook) needs_you is never convened', () => {
  const b = stuckBoard([
    { name: 'byagent', report: { state: 'needs_you', because: 'which venue', project: 'proj-a' } },
    { name: 'byauto', report: { state: 'needs_you', because: 'asking permission to use Bash', project: 'proj-a', auto: true } },
  ]);
  try {
    const auto = b.cards.find((c) => c.sessionName === b.key.byauto);
    assert.equal(auto.stateReportedBy, 'auto', 'fixture: the hook report did not reach the card as auto');
    const out = afterGrace(b.cards, inProj(b));
    assert.deepEqual(out.toConvene.map((c) => c.session), [b.key.byagent], 'control fired, or a hook report was convened');
  } finally { b.restore(); }
});

test('a report naming no project is not convened (there is no room to ask in)', () => {
  const b = stuckBoard([{ name: 'noproj', report: { state: 'needs_you', because: 'no project named' } }]);
  try {
    assert.equal(b.cards.find((c) => c.sessionName === b.key.noproj).stateProject, null);
    assert.equal(afterGrace(b.cards, inProj(b)).toConvene.length, 0);
  } finally { b.restore(); }
});

test('a project carried forward from an earlier report (inferred) is not convened; a named one is', () => {
  const b = stuckBoard([{ name: 'inferq', report: { state: 'working', because: 'building', project: 'proj-a' } }, { name: 'namedq' }]);
  try {
    const cards = b.again('inferq', { state: 'needs_you', because: 'which venue' });
    selfreport.record(b.key.namedq, { state: 'needs_you', because: 'which venue', project: 'proj-a' });
    const all = status.snapshot().agents;
    const inferred = all.find((c) => c.sessionName === b.key.inferq);
    assert.equal(inferred.stateProject, 'proj-a', 'fixture: the earlier project was not carried forward');
    assert.equal(inferred.stateProjectInferred, true, 'fixture: the carried project is not marked inferred');
    assert.ok(cards.length > 0);
    assert.deepEqual(afterGrace(all, inProj(b)).toConvene.map((c) => c.session), [b.key.namedq], 'control fired, or an inferred project was convened');
  } finally { b.restore(); }
});

test('acts only in a live project the stuck agent belongs to: unknown, foreign or archived is skipped', () => {
  const b = stuckBoard([{ name: 'mbr', report: STUCK('which of two layouts to ship') }, { name: 'mbrpeer' }]);
  try {
    const k = b.key;
    assert.equal(afterGrace(b.cards, new Map([['proj-a', [k.mbr, k.mbrpeer]]])).toConvene.length, 1, 'control: a member of a live project is convened');
    assert.equal(afterGrace(b.cards, new Map()).toConvene.length, 0, 'an unknown project was convened');
    assert.equal(afterGrace(b.cards, new Map([['proj-a', [k.mbrpeer]]])).toConvene.length, 0, 'an agent was convened in a project it is not in');
    assert.equal(afterGrace(b.cards, undefined).toConvene.length, 0, 'no member map convened anyway');
  } finally { b.restore(); }
});

test('membersFrom: real project records, archived left out, members are session names', () => {
  const b = stuckBoard([{ name: 'rec1' }, { name: 'rec2' }]);
  try {
    const live = projects.create({ name: 'Recommender Live' });
    const gone = projects.create({ name: 'Recommender Archived' });
    projects.addAgent(live.id, b.key.rec1, b.cards);
    projects.addAgent(live.id, b.key.rec2, b.cards);
    projects.addAgent(gone.id, b.key.rec1, b.cards);
    projects.setArchived(gone.id, true);
    const m = r.membersFrom(projects.readAll());
    assert.deepEqual(m.get(live.id), [b.key.rec1, b.key.rec2], 'the members are not the session names the cards carry');
    assert.equal(m.has(gone.id), false, 'an archived project is still acted in');
    assert.equal(r.membersFrom(null).size, 0);
  } finally { b.restore(); }
});

test('an item is convened once: PLACED or UNCONFIRMED ends it; COULD_NOT retries the playbook only, capped', () => {
  const b = stuckBoard([{ name: 'once', report: STUCK('which of two layouts to ship') }]);
  try {
    const roster = b.cards;
    const members = inProj(b);
    const a = afterGrace(roster, members);
    assert.equal(a.toConvene.length, 1);
    assert.equal(a.toConvene[0].retry, false, 'the first convening must post the room note');
    r.markAttempt(a.next, a.toConvene[0].key, DELIVERY.COULD_NOT, DELIVERY, [], T0 + r.GRACE_MS); // asks out, playbook reached nothing
    let prev = a.next; let now = T0 + r.GRACE_MS;
    for (let i = 1; i < r.MAX_DELIVERY_ATTEMPTS; i++) {
      now += 60000;
      const again = r.step({ prev, roster, setting: ON, members, now });
      assert.equal(again.toConvene.length, 1, 'an unplaced delivery was not retried (attempt ' + i + ')');
      assert.equal(again.toConvene[0].retry, true, 'a retry would post a second room note');
      r.markAttempt(again.next, again.toConvene[0].key, DELIVERY.COULD_NOT, DELIVERY, undefined, now);
      prev = again.next;
    }
    const exhausted = r.step({ prev, roster, setting: ON, members, now: now + 60000 });
    assert.equal(exhausted.toConvene.length, 0, 'retries were not capped');
    // Retries charged no budget: the same agent's NEXT item still fits the per-agent cap
    // (one charge so far, cap is 2).
    const next = b.again('once', STUCK('a second, different item'));
    const s1 = r.step({ prev: exhausted.next, roster: next, setting: ON, members, now: now + 120000 });
    const s2 = r.step({ prev: s1.next, roster: next, setting: ON, members, now: now + 120000 + r.GRACE_MS });
    assert.equal(s2.toConvene.filter((c) => !c.retry).length, 1, 'retries spent the per-agent budget');
    // And a PLACED delivery ends the item for good.
    const fresh = afterGrace(roster, members);
    r.markAttempt(fresh.next, fresh.toConvene[0].key, DELIVERY.PLACED, DELIVERY, [], T0 + r.GRACE_MS);
    const done = r.step({ prev: fresh.next, roster, setting: ON, members, now: T0 + r.GRACE_MS + 60000 });
    assert.equal(done.toConvene.length, 0, 'a convened item fired twice');
    // UNCONFIRMED ends it too: text may already be in the pane, and a re-send could duplicate it.
    const unsure = afterGrace(roster, members);
    r.markAttempt(unsure.next, unsure.toConvene[0].key, DELIVERY.UNCONFIRMED, DELIVERY, [], T0 + r.GRACE_MS);
    const after = r.step({ prev: unsure.next, roster, setting: ON, members, now: T0 + r.GRACE_MS + 60000 });
    assert.equal(after.toConvene.length, 0, 'an UNCONFIRMED playbook was re-sent');
  } finally { b.restore(); }
});

test('an acted-on item is kept for an hour: a flap or a repeat of the same words is not re-convened; after the hour it is a new item', () => {
  const b = stuckBoard([{ name: 'forget', report: STUCK('which of two layouts to ship') }]);
  try {
    const members = inProj(b);
    const t1 = T0 + r.GRACE_MS;
    const a = afterGrace(b.cards, members);
    assert.equal(a.toConvene.length, 1);
    r.markAttempt(a.next, a.toConvene[0].key, DELIVERY.PLACED, DELIVERY, [], t1);
    // One tick away from stuck (the agent did other work), then the same question again.
    const working = b.again('forget', { state: 'working', because: 'building it', project: 'proj-a' });
    const flap = r.step({ prev: a.next, roster: working, setting: ON, members, now: t1 + 60000 });
    assert.equal(flap.next.items.size, 1, 'the acted-on item was dropped on the first tick it was not stuck');
    const stuckAgain = b.again('forget', STUCK('which of two layouts to ship'));
    let prev = flap.next;
    for (const dt of [120000, 120000 + r.GRACE_MS, 120000 + 2 * r.GRACE_MS]) {
      const out = r.step({ prev, roster: stuckAgain, setting: ON, members, now: t1 + dt });
      assert.equal(out.toConvene.length, 0, 'a flap re-convened the same item within the hour');
      prev = out.next;
    }
    // Control: a never-acted-on item is dropped at once (no tombstone for mere sightings).
    const seenOnly = r.step({ prev: undefined, roster: stuckAgain, setting: ON, members, now: T0 });
    const gone = r.step({ prev: seenOnly.next, roster: working, setting: ON, members, now: T0 + 1 });
    assert.equal(gone.next.items.size, 0, 'an item that was only seen was kept');
    // After the hour, the same words away from stuck are forgotten, and come back as a new item
    // that waits out its own grace period.
    const later = t1 + 61 * 60 * 1000;
    const aged = r.step({ prev, roster: working, setting: ON, members, now: later });
    assert.equal(aged.next.items.size, 0, 'the item outlived its hour');
    const back1 = r.step({ prev: aged.next, roster: stuckAgain, setting: ON, members, now: later + 1 });
    assert.equal(back1.toConvene.length, 0, 'a fresh item skipped its grace period');
    const back2 = r.step({ prev: back1.next, roster: stuckAgain, setting: ON, members, now: later + 1 + r.GRACE_MS });
    assert.equal(back2.toConvene.length, 1, 'the same words after the hour were never convened again');
  } finally { b.restore(); }
});

test('caps: at most MAX_PER_AGENT_PER_HOUR per agent and MAX_PER_HOUR overall', () => {
  // One agent, successive items (a real agent carries one report at a time): capped per agent.
  const one = stuckBoard([{ name: 'capone', report: STUCK('item 1') }]);
  try {
    const members = inProj(one);
    let prev; let now = T0; let convened = 0;
    for (let i = 1; i <= r.MAX_PER_AGENT_PER_HOUR + 2; i++) {
      const roster = i === 1 ? one.cards : one.again('capone', STUCK('item ' + i));
      const seen = r.step({ prev, roster, setting: ON, members, now });
      now += r.GRACE_MS;
      const out = r.step({ prev: seen.next, roster, setting: ON, members, now });
      for (const c of out.toConvene) { convened++; r.markAttempt(out.next, c.key, DELIVERY.PLACED, DELIVERY, [], now); }
      prev = out.next; now += 1000;
    }
    assert.ok(now - T0 < 60 * 60 * 1000, 'test setup: the items did not all fall inside one hour');
    assert.equal(convened, r.MAX_PER_AGENT_PER_HOUR, 'the per-agent cap did not hold');
  } finally { one.restore(); }
  // Many agents, one item each: capped overall.
  const names = ['cap1', 'cap2', 'cap3', 'cap4', 'cap5', 'cap6', 'cap7', 'cap8'];
  const many = stuckBoard(names.map((n) => ({ name: n, report: STUCK('item of ' + n) })));
  try {
    const members = new Map([['proj-a', names.map((n) => many.key[n])]]);
    const overall = afterGrace(many.cards, members);
    assert.equal(overall.toConvene.length, r.MAX_PER_HOUR);
    // An hour later the budget is back.
    const later = r.step({ prev: overall.next, roster: many.cards, setting: ON, members, now: T0 + r.GRACE_MS + 61 * 60 * 1000 });
    assert.ok(later.toConvene.length > 0, 'the hourly budget never recovered');
  } finally { many.restore(); }
});

test('peers: up to two OTHER members on the board and idle or working, idle first; never absent or at any needs_you', () => {
  const b = stuckBoard([
    { name: 'pstuck', report: STUCK('which of two layouts to ship') },
    { name: 'pmona', displayName: 'Mona', report: STUCK('her own thing') },
    { name: 'pperm', displayName: 'Perm', report: { state: 'needs_you', because: 'asking permission to use Bash', project: 'proj-a', auto: true } },
    { name: 'pangel', displayName: 'Angel', paneState: 'working' },
    { name: 'ppete', displayName: 'Pete' },
    { name: 'psolo', report: STUCK('solo item', 'proj-solo') },
  ]);
  try {
    const k = b.key;
    // 'pgone' is a member with no card on the board (removed or never started).
    const members = new Map([['proj-a', ['pgone', k.pstuck, k.pmona, k.pperm, k.pangel, k.ppete]], ['proj-solo', [k.psolo]]]);
    const perm = b.cards.find((c) => c.sessionName === k.pperm);
    assert.equal(perm.state, 'needs_you', 'fixture: the permission prompt did not reach the card');
    const out = afterGrace(b.cards, members);
    const stuck = out.toConvene.find((c) => c.session === k.pstuck);
    assert.deepEqual(stuck.peers.map((p) => p.session), [k.ppete, k.pangel],
      'an absent member, a stuck member or one at a permission prompt was chosen, or idle was not preferred');
    assert.deepEqual(stuck.peers.map((p) => p.name), ['Pete', 'Angel'], 'peers are not named by their display names');
    const solo = out.toConvene.find((c) => c.session === k.psolo);
    assert.deepEqual(solo.peers, []);
  } finally { b.restore(); }
});

test('a failed roster read (null) keeps the memory and does nothing; the setting OFF forgets it', () => {
  const b = stuckBoard([{ name: 'nullr', report: STUCK('which of two layouts to ship') }]);
  try {
    const members = inProj(b);
    const seen = r.step({ prev: undefined, roster: b.cards, setting: ON, members, now: T0 });
    const failed = r.step({ prev: seen.next, roster: null, setting: ON, members, now: T0 + r.GRACE_MS });
    assert.equal(failed.toConvene.length, 0);
    assert.equal(failed.next, seen.next, 'a read failure dropped the memory');
    const off = r.step({ prev: seen.next, roster: b.cards, setting: { on: false }, members, now: T0 + r.GRACE_MS });
    assert.equal(off.toConvene.length, 0, 'convened while OFF');
    assert.equal(off.next.items.size, 0);
  } finally { b.restore(); }
});

test('texts: the playbook names only ACTIVE guards and only peers actually asked; the asks name the room', () => {
  const peers = [{ session: 'pete', name: 'Pete' }, { session: 'angel', name: 'Angel' }];
  const item = { name: 'April', because: 'x', project: 'proj-a', peers, asked: peers };
  const all = r.playbookText(item, ON);
  for (const g of Object.values(r.GUARD_TEXT)) assert.ok(all.includes(g), 'missing guard: ' + g);
  const noMoney = r.playbookText(item, { on: true, guards: { money: false, public: true, delete: true } });
  assert.ok(!noMoney.includes(r.GUARD_TEXT.money), 'a switched-off guard was still named');
  assert.ok(noMoney.includes(r.GUARD_TEXT.public));
  const missing = r.playbookText(item, { on: true });
  for (const g of Object.values(r.GUARD_TEXT)) assert.ok(missing.includes(g), 'a missing guard read as off (must fail safe to on)');
  // Only the peers who were reached are named; none reached says so rather than "wait".
  assert.match(all, /I asked Pete and Angel/);
  const onlyPete = r.playbookText({ ...item, asked: [peers[0]] }, ON);
  assert.match(onlyPete, /I asked Pete for/);
  assert.ok(!onlyPete.includes('Angel'), 'a peer who was not reached was named');
  const nobody = r.playbookText({ ...item, asked: [] }, ON);
  assert.ok(!/I asked/.test(nobody), 'told to wait for replies nobody was asked for');
  assert.match(nobody, /could be reached/);
  assert.match(r.playbookText({ ...item, peers: [], asked: [] }, ON), /No one else is on this project/);
  // The room note records the ask; the peer's ask names the project and how to reply there.
  assert.match(r.roomNoteText(item), /asked Pete and Angel/);
  assert.ok(!r.roomNoteText({ ...item, asked: [peers[0]] }).includes('Angel'), 'the room note named a peer who was not reached');
  assert.match(r.roomNoteText({ ...item, asked: [] }), /April will decide it/);
  assert.ok(!/asked/.test(r.roomNoteText({ ...item, asked: [] })), 'the room note claims an ask that did not happen');
  const ask = r.peerAskText(item);
  assert.match(ask, /April is stuck on a decision in project proj-a/);
  assert.match(ask, /not an instruction from Kosmos or the person/, 'relayed agent text reads as Kosmos speaking');
  assert.match(r.roomNoteText(item), /In its own words: "x"/);
  assert.match(ask, /kosmos post proj-a /);
  assert.ok(!/\u2014/.test(all + r.roomNoteText(item) + ask + nobody), 'em dash in product copy');
});

test('runOnce: note and asks once per item, the playbook names who was reached, only COULD_NOT retries', () => {
  const b = stuckBoard([
    { name: 'run', report: STUCK('which of two layouts to ship') },
    { name: 'runpeer', displayName: 'Pete' },
    { name: 'rungone', displayName: 'Gone' },
    { name: 'runboom', report: STUCK('other') },
  ]);
  try {
    const k = b.key;
    const notes = []; const sent = [];
    let playbookVerdict = DELIVERY.COULD_NOT;
    const verdictFor = (s) => (s === k.rungone ? DELIVERY.COULD_NOT : s === k.run ? playbookVerdict : DELIVERY.PLACED);
    const deps = { roomNote: (pid, t) => { notes.push([pid, t]); return true; }, deliver: (s, t) => { sent.push([s, t]); return { state: verdictFor(s) }; }, DELIVERY };
    const members = new Map([['proj-a', [k.run, k.runpeer, k.rungone]]]);
    const roster = b.cards.filter((c) => c.sessionName !== k.runboom);
    const seen = r.runOnce({ prev: undefined, roster, setting: ON, members, now: T0, ...deps });
    assert.equal(notes.length + sent.length, 0, 'acted inside the grace period');
    const first = r.runOnce({ prev: seen.next, roster, setting: ON, members, now: T0 + r.GRACE_MS, ...deps });
    assert.equal(notes.length, 1, 'no room note on first convening');
    assert.equal(notes[0][0], 'proj-a');
    assert.match(notes[0][1], /asked Pete for one reply/, 'the room note did not name the reached peer');
    assert.ok(!notes[0][1].includes('Gone'), 'the room note named a peer whose ask did not land');
    assert.deepEqual(sent.map((x) => x[0]), [k.runpeer, k.rungone, k.run], 'asks go to both peers, then the playbook');
    assert.match(sent[0][1], /kosmos post proj-a/);
    assert.match(sent[2][1], /I asked Pete for one reply/, 'the playbook did not name the reached peer');
    assert.ok(!sent[2][1].includes('Gone'), 'the playbook named a peer whose ask did not land');
    assert.deepEqual(first.acted[0].asked, [k.runpeer]);
    assert.equal(first.acted[0].noteLanded, true);
    // COULD_NOT on the playbook: retried, playbook only, still naming who was reached.
    const retry = r.runOnce({ prev: first.next, roster, setting: ON, members, now: T0 + r.GRACE_MS + 60000, ...deps });
    assert.equal(notes.length, 1, 'a retry posted a SECOND room note');
    assert.equal(sent.length, 4, 'a retry re-asked the peers, or did not retry the playbook');
    assert.equal(sent[3][0], k.run);
    assert.match(sent[3][1], /I asked Pete for one reply/, 'the retry forgot who was asked');
    assert.equal(retry.acted[0].retry, true);
    playbookVerdict = DELIVERY.UNCONFIRMED;
    const unsure = r.runOnce({ prev: retry.next, roster, setting: ON, members, now: T0 + r.GRACE_MS + 120000, ...deps });
    assert.equal(sent.length, 5);
    r.runOnce({ prev: unsure.next, roster, setting: ON, members, now: T0 + r.GRACE_MS + 180000, ...deps });
    assert.equal(sent.length, 5, 'delivered again after an UNCONFIRMED playbook (could duplicate)');
    // A throwing deliver and a throwing roomNote never crash the pass; a throw counts as COULD_NOT.
    const boom = { ...deps, roomNote: () => { throw new Error('x'); }, deliver: () => { throw new Error('x'); } };
    const boomRoster = b.cards.filter((c) => c.sessionName === k.runboom);
    const b1 = r.runOnce({ prev: undefined, roster: boomRoster, setting: ON, members: inProj(b), now: T0, ...boom });
    const b2 = r.runOnce({ prev: b1.next, roster: boomRoster, setting: ON, members: inProj(b), now: T0 + r.GRACE_MS, ...boom });
    assert.equal(b2.acted[0].verdict, null);
    assert.equal(b2.acted[0].noteLanded, false);
    const b3 = r.runOnce({ prev: b2.next, roster: boomRoster, setting: ON, members: inProj(b), now: T0 + r.GRACE_MS + 60000, ...boom });
    assert.equal(b3.acted.length, 1, 'a thrown delivery was not retried');
  } finally { b.restore(); }
});
