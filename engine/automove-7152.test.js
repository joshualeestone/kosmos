'use strict';
/* kosmos#7152 slice 3: the auto-balance sweep (engine/automove.js) and the rule changes it brought to
   engine/autobalance.js. Every effect is a dep; the only file is the record, in a temp folder. Real board cards from
   test-support/fleet (fixture-discipline.test.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ab = require('./autobalance');
const automove = require('./automove');
const fleet = require('../test-support/fleet');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-automove-7152-'));
test.after(() => { fleet.restore(); fs.rmSync(TMP, { recursive: true, force: true }); });

const H = 3600000;
const NOW = Date.now();
const S = (ms) => Math.floor(ms / 1000);   // the usage record keeps resets in seconds
let n = 0;
const fileFor = () => path.join(TMP, `record-${++n}.jsonl`);

const realCards = (...specs) => {
  const b = fleet.install(specs.map(([name, state = 'idle']) => fleet.agent(name, { state })));
  return specs.map(([name]) => b.card(name));
};

/* Two accounts: Work at 93% (resets in 35 h) with ada on it, Spare at 10%. Both read by a usage call that worked. */
const LIST = [
  { dir: '/u/.claude-work', label: 'work', email: 'w@example.test', memoryShared: true, apiKey: false },
  { dir: '/u/.claude-spare', label: 'spare', email: 's@example.test', memoryShared: true, apiKey: false },
];
const reading = (pct, resetsInH, o = {}) => ({ at: NOW, measuredAt: NOW, state: 'ok',
  weekly: { usedPct: pct, resetsAt: S(NOW + resetsInH * H) }, fiveHour: null, ...o });
const USAGE = { '/u/.claude-work': reading(93, 35), '/u/.claude-spare': reading(10, 100) };

function deps(o = {}) {
  const calls = { starts: [], tells: [] };
  const cards = o.cards || realCards(['ada']);
  const d = {
    list: () => LIST,
    readUsage: (dir) => (o.usage || USAGE)[dir] || null,
    agentsOn: o.where ? (dir) => ({ names: Object.keys(o.where).filter((a) => o.where[a] === dir).sort(), complete: true, moving: [] })
      : (dir) => ({ names: dir === '/u/.claude-work' ? (o.names || ['ada']) : [], complete: true, moving: [] }),
    roster: o.roster || (() => cards),
    records: () => [],
    readCommitment: () => ({ state: 'clear' }),
    isGuide: () => false,
    guideName: () => null,
    settingOn: () => (o.settingOn === undefined ? true : o.settingOn),
    movesOn: () => o.movesOn === true,
    accountBusy: () => o.busy === true,
    boardRestarting: () => false,
    startMove: (body) => {
      calls.starts.push(body);
      const r = o.start ? o.start(body) : { status: 202, body: { id: 'm1', agents: [{ name: body.names[0], outcome: 'pending' }] }, done: Promise.resolve() };
      if (o.where && r && r.status === 202 && (o.moveOutcome || 'changed') === 'changed') o.where[body.names[0]] = body.dir;   // the agent is where it was moved
      return r;
    },
    readMove: () => ({ agents: [{ name: 'ada', outcome: o.moveOutcome || 'changed' }] }),
    lastSeen: o.lastSeen || (() => null),
    tell: (agent, text) => calls.tells.push([agent, text]),
    labelOf: (dir) => (LIST.find((a) => a.dir === dir) || {}).label || null,
  };
  return { d, calls };
}
/* Review 2: an agent moves only when it was movable on the previous tick too, so a move takes two ticks. */
async function twoTicks(run, d, at = NOW) { await run.tick(d, at); return run.tick(d, at + 1000); }

test('#7152 slice 3: with moves off, a decision is recorded once per change and nothing is moved', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const { d, calls } = deps();
  assert.equal((await run.tick(d, NOW)).did, 'recorded');
  assert.equal((await run.tick(d, NOW + 1000)).did, 'nothing', 'the same decision was recorded twice');
  const lines = automove.readLines(file);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, 'decision');
  assert.equal(lines[0].live, false);
  assert.deepEqual(lines[0].moves.map((m) => [m.agent, m.toLabel]), [['ada', 'spare']]);
  assert.deepEqual(calls.starts, [], 'a move started with moves off');
  /* CONTROL: a changed decision is recorded again. */
  const { d: d2 } = deps({ usage: { ...USAGE, '/u/.claude-work': reading(50, 35) } });
  await run.tick(d2, NOW + 2000);
  await run.tick(d, NOW + 3000);
  assert.equal(automove.readLines(file).length, 2, 'a decision that came back after a change was not recorded');
});

test('#7152 slice 3: with the setting off, the sweep does nothing at all', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const { d, calls } = deps({ settingOn: false, movesOn: true });
  assert.equal((await twoTicks(run, d)).did, 'off');
  assert.deepEqual(automove.readLines(file), []);
  assert.deepEqual(calls.starts, []);
});

test('#7152 slice 3 review 2: one tick never moves an agent; the second, with the agent still movable, does', async () => {
  const run = automove.create({ file: fileFor() });
  const { d, calls } = deps({ movesOn: true });
  assert.notEqual((await run.tick(d, NOW)).did, 'moved', 'an agent was moved on the first tick it read as movable');
  assert.deepEqual(calls.starts, []);
  assert.equal((await run.tick(d, NOW + 1000)).did, 'moved', 'CONTROL: movable on two ticks, it moves');
  /* A tick on which it was not movable resets it. */
  const run2 = automove.create({ file: fileFor() });
  const busy = realCards(['ada', 'working']);
  const idle = realCards(['ada']);
  let which = busy;
  const { d: d2, calls: c2 } = deps({ movesOn: true, roster: () => which });
  await run2.tick(d2, NOW);
  which = idle;
  await run2.tick(d2, NOW + 1000);
  assert.deepEqual(c2.starts, [], 'an agent that was working on the last tick was moved');
});

test('#7152 slice 3: with moves on, a move goes through the account move, is recorded, and the agent is told', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const { d, calls } = deps({ movesOn: true });
  const r = await twoTicks(run, d);
  assert.deepEqual([r.did, r.outcome], ['moved', 'changed']);
  assert.deepEqual(calls.starts, [{ dir: '/u/.claude-spare', names: ['ada'] }]);
  const move = automove.readLines(file).find((l) => l.kind === 'move');
  assert.deepEqual([move.agent, move.fromLabel, move.toLabel, move.outcome], ['ada', 'work', 'spare', 'changed']);
  assert.equal(calls.tells.length, 1);
  assert.match(calls.tells[0][1], /^Kosmos moved this agent from work to spare, because it is at 93% of its weekly limit/);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8') + calls.tells[0][1], /@/, 'an email reached the record or the message');
});

test('#7152 slice 3: an agent that took a turn since the decision is not moved (idleness read again from a new roster)', async () => {
  const file = fileFor();
  const [idle] = realCards(['ada']);
  const [busy] = realCards(['ada', 'working']);
  let reads = 0;
  const { d, calls } = deps({ movesOn: true, roster: () => (++reads <= 2 ? [idle] : [busy]) });
  const r = await twoTicks(automove.create({ file }), d);
  assert.equal(r.did, 'skipped');
  assert.equal(reads, 3, 'the roster was not read again before the move');
  assert.deepEqual(calls.starts, [], 'an agent that was no longer idle was moved');
  assert.equal(automove.readLines(file).pop().because, 'it was no longer idle');
});

test('#7152 slice 3: no move while another account move runs; refused, partial and stopped moves are recorded as such', async () => {
  const { d, calls } = deps({ movesOn: true, busy: true });
  assert.equal((await twoTicks(automove.create({ file: fileFor() }), d)).because, 'busy');
  assert.deepEqual(calls.starts, []);
  const file = fileFor();
  const { d: d2 } = deps({ movesOn: true, start: () => ({ status: 409, body: { outcome: 'refused', because: 'x' } }) });
  assert.equal((await twoTicks(automove.create({ file }), d2)).did, 'refused');
  assert.equal(automove.readLines(file).pop().outcome, 'refused');
  for (const outcome of ['partial', 'stopped']) {
    const f = fileFor();
    const { d: dx, calls: cx } = deps({ movesOn: true, moveOutcome: outcome });
    await twoTicks(automove.create({ file: f }), dx);
    assert.equal(automove.readLines(f).pop().outcome, outcome, `a ${outcome} move was recorded as something else`);
    assert.deepEqual(cx.tells, [], `an agent whose move was ${outcome} was told it moved`);
  }
});

test('#7152 slice 3: the works-again check: seen working, seen refused (the target is held, the agent moved back), or not seen in a day', async () => {
  let seen = null;
  const file = fileFor();
  const run = automove.create({ file });
  const where = { ada: '/u/.claude-work' };
  const { d, calls } = deps({ movesOn: true, lastSeen: () => seen, where });
  await twoTicks(run, d);
  assert.equal(where.ada, '/u/.claude-spare', 'CONTROL: ada moved to spare');
  await run.tick(d, NOW + 2000);
  assert.equal(automove.readLines(file).filter((l) => l.kind === 'works').length, 0, 'CONTROL: nothing seen, nothing said');
  seen = { outcome: 'ok', at: NOW - 60000 };   // before the move: an old sighting is not this move's
  await run.tick(d, NOW + 3000);
  assert.equal(automove.readLines(file).filter((l) => l.kind === 'works').length, 0, 'a call from before the move counted');
  seen = { outcome: '401', at: Date.now() + 5000 };
  const back = await run.tick(d, NOW + 4000);
  assert.equal(automove.readLines(file).filter((l) => l.kind === 'works').pop().works, 'no');
  assert.deepEqual([back.did, back.back], ['moved', true], 'an agent refused on its new account was not moved back');
  assert.deepEqual(calls.starts.pop(), { dir: '/u/.claude-work', names: ['ada'] }, 'the move back went somewhere else');
  assert.equal(automove.readLines(file).pop().back, true);
  assert.match(calls.tells.pop()[1], /^Kosmos moved this agent back to work, because its first request on spare was refused\.$/);
  assert.equal(where.ada, '/u/.claude-work');
  seen = null;
  const before = calls.starts.length;
  await twoTicks(run, d, NOW + 5000);
  assert.equal(calls.starts.length, before, 'an agent was moved onto a target where the last move did not work');
  await twoTicks(run, d, NOW + automove.FAILED_HOLD_MS + 6000);
  assert.equal(calls.starts.length, before + 1, 'CONTROL: the hold ends');

  const f2 = fileFor();
  const r2 = automove.create({ file: f2 });
  const { d: dy } = deps({ movesOn: true, lastSeen: () => ({ outcome: 'ok', at: Date.now() + 5000 }) });
  await twoTicks(r2, dy);
  await r2.tick(dy, NOW + 2000);
  assert.equal(automove.readLines(f2).filter((l) => l.kind === 'works').pop().works, 'yes');

  const f3 = fileFor();
  const r3 = automove.create({ file: f3 });
  const { d: dn } = deps({ movesOn: true });
  await twoTicks(r3, dn);
  await r3.tick(dn, Date.now() + automove.WATCH_MS + 60000);
  assert.equal(automove.readLines(f3).filter((l) => l.kind === 'works').pop().works, 'not-seen');
});

test('#7152 slice 3 review 2: an agent that left an account whose login had stopped is not moved back onto it', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  let seen = { outcome: '401', at: NOW - 60000 };   // its own last request was refused
  const where = { ada: '/u/.claude-work' };
  const { d, calls } = deps({ movesOn: true, lastSeen: () => seen, where,
    usage: { ...USAGE, '/u/.claude-work': { at: NOW, state: 'http-401' } } });
  await twoTicks(run, d);
  assert.equal(calls.starts.length, 1, 'CONTROL: the agent left the account whose login stopped');
  seen = { outcome: '401', at: Date.now() + 5000 };
  await run.tick(d, NOW + 2000);
  assert.equal(calls.starts.length, 1, 'an agent was moved back onto an account whose login had stopped');
});

test('#7152 slice 3 review 2: a first call made while the move was still finishing counts', async () => {
  let release;
  const done = new Promise((res) => { release = res; });
  let seen = null;
  const file = fileFor();
  const run = automove.create({ file });
  const { d } = deps({ movesOn: true, lastSeen: () => seen,
    start: (body) => { setTimeout(() => { seen = { outcome: 'ok', at: Date.now() }; release(); }, 20); return { status: 202, body: { id: 'm', agents: [{ name: body.names[0], outcome: 'pending' }] }, done }; } });
  await twoTicks(run, d);
  await run.tick(d, NOW + 2000);
  assert.equal(automove.readLines(file).filter((l) => l.kind === 'works').pop()?.works, 'yes', 'a call made during the restart was ignored');
});

test('#7152 slice 3 review 2: the holds are rebuilt from the record when the board starts', async () => {
  const file = fileFor();
  automove.append(file, { kind: 'works', at: NOW - H, agent: 'zed', to: '/u/.claude-spare', works: 'no' });
  automove.append(file, { kind: 'move', at: NOW - 60000, agent: 'bo', to: '/u/.claude-spare', outcome: 'refused' });
  const run = automove.create({ file, nowMs: NOW });
  assert.ok(run.state.failed.has('/u/.claude-spare'), 'a target where a move did not work was forgotten by a restart');
  assert.ok(run.state.refused.has('bo'), 'a refused agent was forgotten by a restart');
  const { d, calls } = deps({ movesOn: true });
  await twoTicks(run, d);
  assert.deepEqual(calls.starts, [], 'a restarted board moved an agent onto a held target');
  const old = automove.create({ file, nowMs: NOW + automove.FAILED_HOLD_MS });
  assert.equal(old.state.failed.size + old.state.refused.size, 0, 'CONTROL: holds past their time are not rebuilt');
});

test('#7152 slice 3 review 1: an agent whose move is refused is passed over for an hour, so the next idle agent moves', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const cards = realCards(['ada'], ['bo']);
  const { d, calls } = deps({ movesOn: true, cards, names: ['ada', 'bo'],
    start: (body) => (body.names[0] === 'ada' ? { status: 202, body: { id: 'm', agents: [{ name: 'ada', outcome: 'refused' }] }, done: Promise.resolve() }
      : { status: 202, body: { id: 'm2', agents: [{ name: body.names[0], outcome: 'pending' }] }, done: Promise.resolve() }) });
  assert.equal((await twoTicks(run, d)).did, 'refused');
  const second = await run.tick(d, NOW + 2000);
  assert.deepEqual([second.did, second.agent], ['moved', 'bo'], 'a refused agent kept every other agent from moving');
  assert.equal(automove.readLines(file).filter((l) => l.kind === 'move' && l.outcome === 'refused').length, 1, 'the refusal was recorded again inside its hour');
  d.agentsOn = (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true, moving: [] });   // bo has gone
  await run.tick(d, NOW + 3000);
  assert.deepEqual(calls.starts.map((b) => b.names[0]), ['ada', 'bo'], 'the refused agent was tried again inside its hour');
  await run.tick(d, NOW + automove.REFUSED_HOLD_MS + 4000);
  assert.deepEqual(calls.starts.map((b) => b.names[0]), ['ada', 'bo', 'ada'], 'CONTROL: after the hour it is tried again');
});

test('#7152 slice 3 review 1: a roster that cannot be read just before the move is not "no longer idle"', async () => {
  const file = fileFor();
  const [ada] = realCards(['ada']);
  let reads = 0;
  const { d, calls } = deps({ movesOn: true, roster: () => (++reads <= 2 ? [ada] : null) });
  assert.equal((await twoTicks(automove.create({ file }), d)).did, 'unreadable');
  assert.deepEqual(calls.starts, []);
  assert.equal(automove.readLines(file).some((l) => l.kind === 'skipped'), false, 'an unreadable roster was recorded as the agent taking a turn');
});

test('#7152 slice 3 review 1: the re-check just before a move reads the projects again', async () => {
  const [ada] = realCards(['ada']);
  let fresh = 0;
  const { d, calls } = deps({ movesOn: true, cards: [ada] });
  d.freshRecords = () => { fresh += 1; return [{ id: 'p1', tasks: [{ id: 't1', parts: [{ who: 'ada', title: 'x' }] }] }]; };
  const r = await twoTicks(automove.create({ file: fileFor() }), d);
  assert.equal(fresh, 1, 'the re-check did not read the projects again');
  assert.equal(r.did, 'skipped', 'an agent given a task part since the decision was moved');
  assert.deepEqual(calls.starts, []);
});

test('#7152 slice 3 review 2: a decision whose line could not be written is tried again on the next tick', async () => {
  const blocker = path.join(TMP, `blocker-${++n}`);
  fs.writeFileSync(blocker, 'a file, so nothing can be written under it');
  const run = automove.create({ file: path.join(blocker, 'record.jsonl') });
  const { d } = deps();
  assert.equal((await run.tick(d, NOW)).did, 'nothing', 'CONTROL: the write failed');
  assert.equal(run.state.lastKey, null, 'a decision that was never written was marked as recorded');
});

test('#7152 slice 3: the record keeps only its newest lines, a bad line is skipped, and a live decision is not counted as recent', () => {
  const file = fileFor();
  fs.writeFileSync(file, 'not json\n');
  for (let i = 0; i < automove.KEEP_LINES + 3; i += 1) automove.append(file, { kind: 'skipped', at: i });
  const lines = automove.readLines(file);
  assert.equal(lines.length, automove.KEEP_LINES);
  assert.equal(lines[0].at, 3);
  assert.deepEqual(automove.recent(file, 2).map((l) => l.at), [automove.KEEP_LINES + 2, automove.KEEP_LINES + 1], 'recent is not newest first');
  automove.append(file, { kind: 'decision', at: 9e9, live: true, moves: [] });
  assert.notEqual(automove.recent(file, 1)[0].at, 9e9, 'a live decision, which the page draws as nothing, took a recent place');
});

test('#7152 slice 3: moves are switched on only by AGENT_WORKFORCE_AUTOMOVE=1, and the brake stops the sweep', () => {
  assert.equal(automove.movesOn({}), false, 'moves were on by default');
  assert.equal(automove.movesOn({ AGENT_WORKFORCE_AUTOMOVE: '1' }), true);
  assert.equal(automove.movesOn({ AGENT_WORKFORCE_AUTOMOVE: '1', AGENT_WORKFORCE_AUTOMOVE_OFF: '1' }), false);
  assert.equal(automove.sweepOn({ AGENT_WORKFORCE_AUTOMOVE_OFF: '1' }), false);
  assert.equal(automove.sweepOn({}), true);
});

test('#7152 slice 3: rows from the cheap readings: a working usage call is signed in, only a 401 or 403 is a stopped login', () => {
  const more = ['x', 'r', 'p', 'rate', 'unread', 'other'].map((k) => ({ dir: `/u/.claude-${k}`, label: k }));
  const recs = { '/u/.claude-x': { at: NOW, state: 'no-credential' }, '/u/.claude-r': { at: NOW, state: 'http-401', weekly: { usedPct: 5, resetsAt: S(NOW + H) } },
    '/u/.claude-p': { at: NOW, state: 'profile-http-403' }, '/u/.claude-rate': { at: NOW, state: 'http-429' },
    '/u/.claude-unread': { at: NOW, state: 'unreadable-response' }, '/u/.claude-other': { at: NOW, state: 'other-account' } };
  const rows = ab.rowsFromReadings({
    list: [...LIST, { dir: '/u/.claude-key', apiKey: true }, ...more],
    readUsage: (dir) => recs[dir] || USAGE[dir] || null,
    agentsOn: () => ({ names: [], complete: true }),
    nowMs: NOW,
  });
  const by = Object.fromEntries(rows.map((r) => [r.dir, r]));
  assert.equal(by['/u/.claude-key'], undefined, 'an API key became a row');
  assert.equal(by['/u/.claude-work'].connection.badge, 'working');
  assert.equal(by['/u/.claude-work'].weekly.resetsAt, S(NOW + 35 * H) * 1000, 'the reset was not turned into ms');
  assert.equal(by['/u/.claude-x'].connection.badge, null, 'a record that is neither a reading nor a refusal claimed a login state');
  assert.equal(by['/u/.claude-r'].connection.badge, 'rejected');
  assert.equal(by['/u/.claude-p'].connection.badge, 'rejected', 'a refused profile call is the same token refused');
  assert.equal(by['/u/.claude-r'].weekly, null, 'a refused read showed a usage figure');
  for (const k of ['rate', 'unread', 'other']) assert.equal(by[`/u/.claude-${k}`].connection.badge, null, `a ${recs[`/u/.claude-${k}`].state} read as a stopped login`);
  /* The blocker of review 2, end to end: a 429 on a working account names nothing at risk. */
  const d = ab.decide({ rows: ab.rowsFromReadings({ list: LIST, nowMs: NOW, agentsOn: (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true }),
    readUsage: (dir) => (dir === '/u/.claude-work' ? { at: NOW, state: 'http-429' } : USAGE[dir]) }), movable: () => true, nowMs: NOW });
  assert.deepEqual([d.atRisk, d.moves], [[], []], 'the usage endpoint\'s own rate limit moved agents off a working account');
});

test('#7152 slice 3: a target well into its five-hour window is not a target', () => {
  const rows = ab.rowsFromReadings({ list: LIST, nowMs: NOW,
    readUsage: (dir) => (dir === '/u/.claude-spare' ? reading(10, 100, { fiveHour: { usedPct: 90, resetsAt: S(NOW + 2 * H) } }) : USAGE[dir]),
    agentsOn: (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true }) });
  assert.deepEqual(ab.decide({ rows, movable: () => true, nowMs: NOW }).moves, [], 'agents were sent to an account at 90% of its five hours');
  rows[1].fiveHour.usedPct = 89;
  assert.equal(ab.decide({ rows, movable: () => true, nowMs: NOW }).moves.length, 1, 'CONTROL: at 89% it is a target');
  rows[1].fiveHour.usedPct = 95; rows[1].fiveHour.resetsAt = NOW - 1000;
  assert.equal(ab.decide({ rows, movable: () => true, nowMs: NOW }).moves.length, 1, 'CONTROL: a five-hour window that has reset does not count');
});

test('#7152 slice 3: the guide fails closed, and words left unsent in an agent\'s box keep it where it is', () => {
  const [ada] = realCards(['ada']);
  const base = { cards: [ada], records: [], readCommitment: () => ({ state: 'clear' }) };
  assert.equal(ab.movableFor({ ...base, isGuide: () => false, guideName: () => null })('ada'), true, 'CONTROL: an ordinary idle agent is movable');
  assert.equal(ab.movableFor({ ...base, isGuide: () => true, guideName: () => null })('ada'), false, 'the guide was movable');
  assert.equal(ab.movableFor({ ...base, isGuide: () => { throw new Error('unreadable'); }, guideName: () => null })('ada'), false, 'a guide check that could not tell let the agent move');
  assert.equal(ab.movableFor({ ...base, isGuide: () => false, guideName: () => 'Ada ' })('ada'), false, 'the seeded guide name was movable');
  assert.equal(ab.movableFor({ ...base, isGuide: () => false, guideName: () => { throw new Error('x'); } })('ada'), false, 'a guide name that could not be read let the agent move');
  /* The real card, with the one field the producer sets once words have sat unsent (status.js unsentInputOf). */
  assert.equal('unsentInput' in ada, true, 'CONTROL: a real card carries unsentInput');
  const waiting = { ...ada, unsentInput: { since: new Date(NOW).toISOString() } };
  assert.equal(ab.movableFor({ ...base, cards: [waiting], isGuide: () => false, guideName: () => null })('ada'), false, 'an agent with unsent words in its box was movable');
});

test('#7152 slice 3 review 3: a stopped login moves an agent only when its own request was refused, within the hour', async () => {
  const usage = { ...USAGE, '/u/.claude-work': { at: NOW, state: 'http-403' } };
  for (const [seen, moves, why] of [[null, 0, 'with no request of its own seen'], [{ outcome: 'ok', at: NOW - 60000 }, 0, 'whose own requests work'],
    [{ outcome: '401', at: NOW - 2 * automove.LOGIN_SEEN_MS }, 0, 'refused long ago'], [{ outcome: '401', at: NOW - 60000 }, 1, null]]) {
    const { d, calls } = deps({ movesOn: true, usage, lastSeen: () => seen });
    await twoTicks(automove.create({ file: fileFor() }), d);
    assert.equal(calls.starts.length, moves, why ? 'an agent was moved off a login the usage endpoint refused, ' + why : 'CONTROL: its own refused request moves it');
  }
});

test('#7152 slice 3 review 3: a move back owed waits for its agent without blocking the rest; a 409 keeps it owed', async () => {
  const list3 = [...LIST, { dir: '/u/.claude-third', label: 'third', email: 't@example.test', memoryShared: true, apiKey: false }];
  const usage = { ...USAGE, '/u/.claude-third': reading(5, 100) };   // the best target, since spare is held
  const where = { ada: '/u/.claude-spare', bo: '/u/.claude-work' };   // ada was moved to spare and refused there
  const [adaBusy] = realCards(['ada', 'working']);
  const [bo] = realCards(['bo']);
  let refuse409 = false;
  const { d, calls } = deps({ movesOn: true, usage, where, roster: () => [adaBusy, bo],
    start: (body) => (refuse409 ? { status: 409, body: { outcome: 'refused', because: 'busy' } } : { status: 202, body: { id: 'm', agents: [{ name: body.names[0], outcome: 'pending' }] }, done: Promise.resolve() }) });
  d.list = () => list3;
  d.readMove = (id) => ({ agents: [{ outcome: 'changed' }] });
  const run = automove.create({ file: fileFor() });
  run.state.back.push({ agent: 'ada', from: '/u/.claude-spare', to: '/u/.claude-work', fromLabel: 'spare', toLabel: 'work', owedAt: NOW });
  run.state.failed.set('/u/.claude-spare', NOW);
  const r = await twoTicks(run, d);
  assert.deepEqual([r.did, r.agent], ['moved', 'bo'], 'a move back whose agent was busy blocked every other move');
  assert.equal(run.state.back.length, 1, 'CONTROL: the move back is still owed');
  /* Now ada is idle, and the board answers 409: it stays owed, and ada is not held as refused. */
  const [adaIdle] = realCards(['ada']);
  d.roster = () => [adaIdle, bo];
  refuse409 = true;
  const busy = await run.tick(d, NOW + 5000);
  assert.equal(busy.because, 'busy');
  assert.equal(run.state.back.length, 1, 'a 409 lost the move back');
  assert.equal(run.state.refused.has('ada'), false, 'a 409 held a healthy agent as refused');
  refuse409 = false;
  const back = await run.tick(d, NOW + 6000);
  assert.deepEqual([back.did, back.back, calls.starts.pop()], ['moved', true, { dir: '/u/.claude-work', names: ['ada'] }]);
  assert.equal(run.state.back.length, 0);
});

test('#7152 slice 3 review 3: a move back is dropped when a person has moved the agent since, and given up after a day', async () => {
  const where = { ada: '/u/.claude-third' };   // moved by hand somewhere else
  const { d, calls } = deps({ movesOn: true, where, usage: { ...USAGE, '/u/.claude-work': reading(50, 35) } });
  const run = automove.create({ file: fileFor() });
  run.state.back.push({ agent: 'ada', from: '/u/.claude-spare', to: '/u/.claude-work', owedAt: NOW });
  await run.tick(d, NOW);
  assert.deepEqual([calls.starts, run.state.back], [[], []], 'a move back undid where a person had put the agent');
  const file = fileFor();
  const r2 = automove.create({ file });
  const where2 = { ada: '/u/.claude-spare' };
  const [busy] = realCards(['ada', 'working']);
  const { d: d2 } = deps({ movesOn: true, where: where2, roster: () => [busy], usage: { ...USAGE, '/u/.claude-work': reading(50, 35) } });
  r2.state.back.push({ agent: 'ada', from: '/u/.claude-spare', to: '/u/.claude-work', owedAt: NOW });
  await r2.tick(d2, NOW + 1000);
  assert.equal(r2.state.back.length, 1, 'CONTROL: a busy agent keeps its move back owed');
  await r2.tick(d2, NOW + automove.BACK_MAX_MS + 1000);
  assert.equal(r2.state.back.length, 0, 'a move back was owed for ever');
  assert.equal(automove.readLines(file).pop().kind, 'back-given-up');
});

test('#7152 slice 3 review 3: the watch and a move back owed are rebuilt from the record when the board starts', async () => {
  const file = fileFor();
  automove.append(file, { kind: 'move', at: NOW - 60000, startedAt: NOW - 70000, agent: 'ada', from: '/u/.claude-work', to: '/u/.claude-spare', outcome: 'changed', fromKind: 'usage' });
  automove.append(file, { kind: 'move', at: NOW - 50000, startedAt: NOW - 55000, agent: 'bo', from: '/u/.claude-work', to: '/u/.claude-spare', outcome: 'changed', fromKind: 'usage' });
  automove.append(file, { kind: 'works', at: NOW - 40000, agent: 'bo', from: '/u/.claude-work', to: '/u/.claude-spare', fromKind: 'usage', works: 'no' });
  const run = automove.create({ file, nowMs: NOW });
  assert.deepEqual(run.state.watching.map((w) => [w.agent, w.movedAt]), [['ada', NOW - 70000]], 'the watch on a moved agent was lost by a restart');
  assert.deepEqual(run.state.back.map((b) => [b.agent, b.to]), [['bo', '/u/.claude-work']], 'a move back owed was lost by a restart');
  automove.append(file, { kind: 'move', at: NOW - 30000, agent: 'bo', from: '/u/.claude-spare', to: '/u/.claude-work', outcome: 'changed', back: true });
  assert.equal(automove.create({ file, nowMs: NOW }).state.back.length, 0, 'CONTROL: a move back made is not owed again');
  automove.append(file, { kind: 'works', at: NOW - 20000, agent: 'ada', to: '/u/.claude-spare', works: 'yes' });
  assert.equal(automove.create({ file, nowMs: NOW }).state.watching.length, 0, 'CONTROL: a watch that ended is not rebuilt');
});

test('#7152 slice 3 review 3: with fewer than two subscription accounts the sweep stops before the agents walk', async () => {
  let walks = 0;
  const { d } = deps({ movesOn: true });
  d.list = () => [LIST[0], { dir: '/u/.claude-key', apiKey: true }];
  d.agentsOn = () => { walks += 1; return { names: [], complete: true }; };
  assert.equal((await automove.create({ file: fileFor() }).tick(d, NOW)).did, 'nothing');
  assert.equal(walks, 0, 'the agents were walked with one account');
});
