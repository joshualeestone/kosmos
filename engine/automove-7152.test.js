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
    isRefusal: (st) => /^http-4/.test(st),
    agentsOn: (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true, moving: [] }),
    roster: o.roster || (() => cards),
    records: () => [],
    readCommitment: () => ({ state: 'clear' }),
    isGuide: () => false,
    guideName: () => null,
    settingOn: () => (o.settingOn === undefined ? true : o.settingOn),
    movesOn: () => o.movesOn === true,
    accountBusy: () => o.busy === true,
    boardRestarting: () => false,
    startMove: (body) => { calls.starts.push(body); return o.start ? o.start(body) : { status: 202, body: { id: 'm1', agents: [{ name: body.names[0], outcome: 'pending' }] }, done: Promise.resolve() }; },
    readMove: () => ({ agents: [{ name: 'ada', outcome: o.moveOutcome || 'changed' }] }),
    lastSeen: o.lastSeen || (() => null),
    tell: (agent, text) => calls.tells.push([agent, text]),
    labelOf: (dir) => (LIST.find((a) => a.dir === dir) || {}).label || null,
  };
  return { d, calls };
}

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
  const { d, calls } = deps({ settingOn: false, movesOn: true });
  assert.equal((await automove.create({ file }).tick(d, NOW)).did, 'off');
  assert.deepEqual(automove.readLines(file), []);
  assert.deepEqual(calls.starts, []);
});

test('#7152 slice 3: with moves on, the first move goes through the account move, is recorded, and the agent is told', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const { d, calls } = deps({ movesOn: true });
  const r = await run.tick(d, NOW);
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
  const { d, calls } = deps({ movesOn: true, roster: () => (++reads === 1 ? [idle] : [busy]) });
  const r = await automove.create({ file }).tick(d, NOW);
  assert.equal(r.did, 'skipped');
  assert.equal(reads, 2, 'the roster was not read again before the move');
  assert.deepEqual(calls.starts, [], 'an agent that was no longer idle was moved');
  assert.equal(automove.readLines(file).pop().because, 'it was no longer idle');
});

test('#7152 slice 3: no move while another account move runs, and a refused move is recorded as refused', async () => {
  const { d, calls } = deps({ movesOn: true, busy: true });
  assert.equal((await automove.create({ file: fileFor() }).tick(d, NOW)).because, 'busy');
  assert.deepEqual(calls.starts, []);
  const file = fileFor();
  const { d: d2 } = deps({ movesOn: true, start: () => ({ status: 409, body: { outcome: 'refused', because: 'x' } }) });
  assert.equal((await automove.create({ file }).tick(d2, NOW)).did, 'refused');
  assert.equal(automove.readLines(file).pop().outcome, 'refused');
  /* A move that saved the account but could not restart is recorded partial, and the agent is not told it moved. */
  const f3 = fileFor();
  const { d: d3, calls: c3 } = deps({ movesOn: true, moveOutcome: 'partial' });
  await automove.create({ file: f3 }).tick(d3, NOW);
  assert.equal(automove.readLines(f3).pop().outcome, 'partial');
  assert.deepEqual(c3.tells, [], 'an agent whose restart failed was told it moved');
});

test('#7152 slice 3: the works-again check: seen working, seen refused (the target is held), or not seen in a day', async () => {
  let seen = null;
  const file = fileFor();
  const run = automove.create({ file });
  const { d, calls } = deps({ movesOn: true, lastSeen: () => seen });
  await run.tick(d, NOW);
  await run.tick(d, NOW + 1000);
  assert.equal(automove.readLines(file).filter((l) => l.kind === 'works').length, 0, 'CONTROL: nothing seen, nothing said');
  seen = { outcome: 'ok', at: NOW - 60000 };   // before the move: an old sighting is not this move's
  await run.tick(d, NOW + 2000);
  assert.equal(automove.readLines(file).filter((l) => l.kind === 'works').length, 0, 'a call from before the move counted');
  seen = { outcome: '401', at: Date.now() + 5000 };
  await run.tick(d, NOW + 3000);
  assert.equal(automove.readLines(file).filter((l) => l.kind === 'works').pop().works, 'no');
  const before = calls.starts.length;
  await run.tick(d, NOW + 4000);
  assert.equal(calls.starts.length, before, 'an agent was moved onto a target where the last move did not work');
  await run.tick(d, NOW + automove.FAILED_HOLD_MS + 5000);
  assert.equal(calls.starts.length, before + 1, 'CONTROL: the hold ends');

  const f2 = fileFor();
  const r2 = automove.create({ file: f2 });
  const { d: dy } = deps({ movesOn: true, lastSeen: () => ({ outcome: 'ok', at: Date.now() + 5000 }) });
  await r2.tick(dy, NOW);
  await r2.tick(dy, NOW + 1000);
  assert.equal(automove.readLines(f2).filter((l) => l.kind === 'works').pop().works, 'yes');

  const f3 = fileFor();
  const r3 = automove.create({ file: f3 });
  const { d: dn } = deps({ movesOn: true });
  await r3.tick(dn, NOW);
  await r3.tick(dn, Date.now() + automove.WATCH_MS + 60000);
  assert.equal(automove.readLines(f3).filter((l) => l.kind === 'works').pop().works, 'not-seen');
});

test('#7152 slice 3: the record keeps only its newest lines, and a bad line is skipped', () => {
  const file = fileFor();
  fs.writeFileSync(file, 'not json\n');
  for (let i = 0; i < automove.KEEP_LINES + 3; i += 1) automove.append(file, { kind: 'skipped', at: i });
  const lines = automove.readLines(file);
  assert.equal(lines.length, automove.KEEP_LINES);
  assert.equal(lines[0].at, 3);
  assert.deepEqual(automove.recent(file, 2).map((l) => l.at), [automove.KEEP_LINES + 2, automove.KEEP_LINES + 1], 'recent is not newest first');
});

test('#7152 slice 3: moves are switched on only by AGENT_WORKFORCE_AUTOMOVE=1, and the brake stops the sweep', () => {
  assert.equal(automove.movesOn({}), false, 'moves were on by default');
  assert.equal(automove.movesOn({ AGENT_WORKFORCE_AUTOMOVE: '1' }), true);
  assert.equal(automove.movesOn({ AGENT_WORKFORCE_AUTOMOVE: '1', AGENT_WORKFORCE_AUTOMOVE_OFF: '1' }), false);
  assert.equal(automove.sweepOn({ AGENT_WORKFORCE_AUTOMOVE_OFF: '1' }), false);
  assert.equal(automove.sweepOn({}), true);
});

test('#7152 slice 3: rows from the cheap readings: a working usage call is signed in, a refusal is a stopped login, else nothing', () => {
  const rows = ab.rowsFromReadings({
    list: [...LIST, { dir: '/u/.claude-key', apiKey: true }, { dir: '/u/.claude-x', label: 'x' }, { dir: '/u/.claude-r', label: 'r' }],
    readUsage: (dir) => ({ '/u/.claude-x': { at: NOW, state: 'no-credential' }, '/u/.claude-r': { at: NOW, state: 'http-401', weekly: { usedPct: 5, resetsAt: S(NOW + H) } } })[dir] || USAGE[dir] || null,
    isRefusal: (st) => /^http-4/.test(st),
    agentsOn: () => ({ names: [], complete: true }),
    nowMs: NOW,
  });
  const by = Object.fromEntries(rows.map((r) => [r.dir, r]));
  assert.equal(by['/u/.claude-key'], undefined, 'an API key became a row');
  assert.equal(by['/u/.claude-work'].connection.badge, 'working');
  assert.equal(by['/u/.claude-work'].weekly.resetsAt, S(NOW + 35 * H) * 1000, 'the reset was not turned into ms');
  assert.equal(by['/u/.claude-x'].connection.badge, null, 'a record that is neither a reading nor a refusal claimed a login state');
  assert.equal(by['/u/.claude-r'].connection.badge, 'rejected');
  assert.equal(by['/u/.claude-r'].weekly, null, 'a refused read showed a usage figure');
});

test('#7152 slice 3: a target well into its five-hour window is not a target', () => {
  const rows = ab.rowsFromReadings({ list: LIST, isRefusal: () => false, nowMs: NOW,
    readUsage: (dir) => (dir === '/u/.claude-spare' ? reading(10, 100, { fiveHour: { usedPct: 90, resetsAt: S(NOW + 2 * H) } }) : USAGE[dir]),
    agentsOn: (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true }) });
  assert.deepEqual(ab.decide({ rows, movable: () => true, nowMs: NOW }).moves, [], 'agents were sent to an account at 90% of its five hours');
  rows[1].fiveHour.usedPct = 89;
  assert.equal(ab.decide({ rows, movable: () => true, nowMs: NOW }).moves.length, 1, 'CONTROL: at 89% it is a target');
  rows[1].fiveHour.usedPct = 95; rows[1].fiveHour.resetsAt = NOW - 1000;
  assert.equal(ab.decide({ rows, movable: () => true, nowMs: NOW }).moves.length, 1, 'CONTROL: a five-hour window that has reset does not count');
});

test('#7152 slice 3: the guide fails closed: a guide check that throws, or the seeded guide name, is not movable', () => {
  const cards = realCards(['ada']);
  const base = { cards, records: [], readCommitment: () => ({ state: 'clear' }) };
  assert.equal(ab.movableFor({ ...base, isGuide: () => false, guideName: () => null })('ada'), true, 'CONTROL: an ordinary idle agent is movable');
  assert.equal(ab.movableFor({ ...base, isGuide: () => true, guideName: () => null })('ada'), false, 'the guide was movable');
  assert.equal(ab.movableFor({ ...base, isGuide: () => { throw new Error('unreadable'); }, guideName: () => null })('ada'), false, 'a guide check that could not tell let the agent move');
  assert.equal(ab.movableFor({ ...base, isGuide: () => false, guideName: () => 'Ada ' })('ada'), false, 'the seeded guide name was movable');
  assert.equal(ab.movableFor({ ...base, isGuide: () => false, guideName: () => { throw new Error('x'); } })('ada'), false, 'a guide name that could not be read let the agent move');
});

test('#7152 slice 3 review 1: an agent whose move is refused is passed over for an hour, so the next idle agent moves', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const cards = realCards(['ada'], ['bo']);
  const { d, calls } = deps({ movesOn: true, cards,
    start: (body) => (body.names[0] === 'ada' ? { status: 202, body: { id: 'm', agents: [{ name: 'ada', outcome: 'refused' }] }, done: Promise.resolve() }
      : { status: 202, body: { id: 'm2', agents: [{ name: body.names[0], outcome: 'pending' }] }, done: Promise.resolve() }) });
  d.agentsOn = (dir) => ({ names: dir === '/u/.claude-work' ? ['ada', 'bo'] : [], complete: true, moving: [] });
  assert.equal((await run.tick(d, NOW)).did, 'refused');
  const second = await run.tick(d, NOW + 1000);
  assert.deepEqual([second.did, second.agent], ['moved', 'bo'], 'a refused agent kept every other agent from moving');
  assert.equal(automove.readLines(file).filter((l) => l.kind === 'move' && l.outcome === 'refused').length, 1, 'the refusal was recorded again inside its hour');
  d.agentsOn = (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true, moving: [] });   // bo has gone
  await run.tick(d, NOW + 2000);
  assert.deepEqual(calls.starts.map((b) => b.names[0]), ['ada', 'bo'], 'the refused agent was tried again inside its hour');
  await run.tick(d, NOW + automove.REFUSED_HOLD_MS + 3000);
  assert.deepEqual(calls.starts.map((b) => b.names[0]), ['ada', 'bo', 'ada'], 'CONTROL: after the hour it is tried again');
});

test('#7152 slice 3 review 1: a roster that cannot be read just before the move is not "no longer idle"', async () => {
  const file = fileFor();
  const [ada] = realCards(['ada']);
  let reads = 0;
  const { d, calls } = deps({ movesOn: true, roster: () => (++reads === 1 ? [ada] : null) });
  assert.equal((await automove.create({ file }).tick(d, NOW)).did, 'unreadable');
  assert.deepEqual(calls.starts, []);
  assert.equal(automove.readLines(file).some((l) => l.kind === 'skipped'), false, 'an unreadable roster was recorded as the agent taking a turn');
});

test('#7152 slice 3 review 1: the re-check just before a move reads the projects again', async () => {
  const [ada] = realCards(['ada']);
  let fresh = 0;
  const { d, calls } = deps({ movesOn: true, cards: [ada] });
  d.freshRecords = () => { fresh += 1; return [{ id: 'p1', tasks: [{ id: 't1', parts: [{ who: 'ada', title: 'x' }] }] }]; };
  const r = await automove.create({ file: fileFor() }).tick(d, NOW);
  assert.equal(fresh, 1, 'the re-check did not read the projects again');
  assert.equal(r.did, 'skipped', 'an agent given a task part since the decision was moved');
  assert.deepEqual(calls.starts, []);
});
