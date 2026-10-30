'use strict';
/* kosmos#7548 (#7152 slice 3b): the live mover (engine/automove.js), the skipTarget it brought to decide(), and
   accountmove's word on whether a write began (rule 11). Every effect is a dep; the only file is the record, in a temp
   folder. Real board cards from test-support/fleet (fixture-discipline.test.js). Ported from automove-live-7152's
   automove-7152.test.js (rules 1 to 10), with the recording tests left to autobalance-sweep-7152.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ab = require('./autobalance');
const automove = require('./automove');
const sweep = require('./autobalance-sweep');
const accountmove = require('./accountmove');
const fleet = require('../test-support/fleet');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-automove-7548-'));
test.after(() => { fleet.restore(); fs.rmSync(TMP, { recursive: true, force: true }); });

const H = 3600000;
const NOW = Date.now();
const S = (ms) => Math.floor(ms / 1000);   // the usage record keeps resets in seconds
let n = 0;
const fileFor = () => path.join(TMP, `record-${++n}.jsonl`);
const lines = (file) => sweep.readLines(file);

const realCards = (...specs) => {
  const b = fleet.install(specs.map(([name, state = 'idle']) => fleet.agent(name, { state })));
  return specs.map(([name]) => b.card(name));
};

/* Two accounts: Work at 93% (resets in 35 h) with ada on it, Spare at 10%. Both read by a usage call that worked. */
const LIST = [
  { dir: '/u/.claude-work', label: 'work', email: 'w@example.test', memoryShared: true, apiKey: false },
  { dir: '/u/.claude-spare', label: 'spare', email: 's@example.test', memoryShared: true, apiKey: false },
];
const THIRD = { dir: '/u/.claude-third', label: 'third', email: 't@example.test', memoryShared: true, apiKey: false };
const reading = (pct, resetsInH, o = {}) => ({ at: NOW, measuredAt: NOW, state: 'ok',
  weekly: { usedPct: pct, resetsAt: S(NOW + resetsInH * H) }, fiveHour: null, ...o });
const USAGE = { '/u/.claude-work': reading(93, 35), '/u/.claude-spare': reading(10, 100) };

function deps(o = {}) {
  const calls = { starts: [], tells: [] };
  const cards = o.cards || realCards(['ada']);
  /* Where each agent is, as the agents walk would say: on Work unless a test says otherwise, and moved by a move. */
  const where = o.where || Object.fromEntries((o.names || ['ada']).map((a) => [a, '/u/.claude-work']));
  const roster = o.roster || (() => cards);
  const d = {
    list: () => LIST,
    readUsage: (dir) => (o.usage || USAGE)[dir] || null,
    agentsOn: (dir) => ({ names: Object.keys(where).filter((a) => where[a] === dir).sort(), complete: true, moving: [] }),
    roster,
    freshRoster: o.freshRoster || roster,
    records: () => [],
    freshRecords: () => [],
    readCommitment: () => ({ state: 'clear' }),
    isGuide: () => false,
    guideName: () => null,
    settingOn: () => (o.settingOn === undefined ? true : o.settingOn),
    movesOn: () => (o.movesOn === undefined ? true : o.movesOn),
    accountBusy: () => o.busy === true,
    boardRestarting: () => false,
    startMove: (body) => {
      calls.starts.push(body);
      const r = o.start ? o.start(body) : { status: 202, body: { id: 'm1', agents: [{ name: body.names[0], outcome: 'pending' }] }, done: Promise.resolve() };
      /* The walk lists an agent by its launch file, so a partial move (saved, not yet restarted) is listed on its new account too. */
      if (r && r.status === 202 && ((r.body.agents || [])[0] || {}).outcome !== 'refused' && ['changed', 'partial'].includes(o.moveOutcome || 'changed')) where[body.names[0]] = body.dir;
      return r;
    },
    readMove: () => ({ agents: [{ name: 'ada', outcome: o.moveOutcome || 'changed' }] }),
    lastSeen: o.lastSeen || (() => null),
    ...(o.sessionStart ? { sessionStart: o.sessionStart } : {}),
    tell: (agent, text) => calls.tells.push([agent, text]),
    labelOf: (dir) => ([...LIST, THIRD].find((a) => a.dir === dir) || {}).label || null,
  };
  return { d, calls, where };
}
const ON = { AGENT_WORKFORCE_AUTOMOVE: '1' };
/* Rule 2: an agent moves only when it was movable on the previous tick too, so a move takes two ticks. */
async function twoTicks(run, d, at = NOW) { await run.tick(d, at); return run.tick(d, at + 1000); }

test('#7548: moves are switched on only by AGENT_WORKFORCE_AUTOMOVE=1, and the brake wins', () => {
  assert.equal(automove.movesOn({}), false, 'moves were on with nothing set');
  assert.equal(automove.movesOn({ AGENT_WORKFORCE_AUTOMOVE: '1' }), true, 'CONTROL: the switch turns them on');
  assert.equal(automove.movesOn({ AGENT_WORKFORCE_AUTOMOVE: 'true' }), false, 'a value other than 1 turned them on');
  assert.equal(automove.movesOn({ AGENT_WORKFORCE_AUTOMOVE: '1', AGENT_WORKFORCE_AUTOMOVE_OFF: '1' }), false, 'the brake did not win');
});

test('#7548: with moves off, or the setting off, the mover does nothing and writes nothing', async () => {
  for (const o of [{ movesOn: false }, { settingOn: false }]) {
    const file = fileFor();
    const run = automove.create({ file });
    const { d, calls } = deps(o);
    assert.equal((await twoTicks(run, d)).did, 'off');
    assert.deepEqual(lines(file), []);
    assert.deepEqual(calls.starts, []);
  }
});

test('#7548 rule 2: one tick never moves an agent; the second, with the agent still movable, does', async () => {
  const run = automove.create({ file: fileFor() });
  const { d, calls } = deps();
  assert.notEqual((await run.tick(d, NOW)).did, 'moved', 'an agent was moved on the first tick it read as movable');
  assert.deepEqual(calls.starts, []);
  assert.equal((await run.tick(d, NOW + 1000)).did, 'moved', 'CONTROL: movable on two ticks, it moves');
  /* A tick on which it was not movable resets it. */
  const run2 = automove.create({ file: fileFor() });
  const busy = realCards(['ada', 'working']);
  const idle = realCards(['ada']);
  let which = busy;
  const { d: d2, calls: c2 } = deps({ roster: () => which });
  await run2.tick(d2, NOW);
  which = idle;
  await run2.tick(d2, NOW + 1000);
  assert.deepEqual(c2.starts, [], 'an agent that was working on the last tick was moved');
});

test('#7548 rule 1: a move goes through the account move, is recorded in the sweep\'s record, and the agent is told', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const { d, calls } = deps();
  const r = await twoTicks(run, d);
  assert.deepEqual([r.did, r.outcome], ['moved', 'changed']);
  assert.deepEqual(calls.starts, [{ dir: '/u/.claude-spare', names: ['ada'] }]);
  const move = lines(file).find((l) => l.kind === 'move' && l.outcome !== 'started');
  assert.deepEqual([move.agent, move.fromLabel, move.toLabel, move.outcome], ['ada', 'work', 'spare', 'changed']);
  assert.equal(calls.tells.length, 1);
  assert.match(calls.tells[0][1], /^Kosmos moved this agent from work to spare, because work was running out \(it is at 93% of its weekly limit/);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8') + calls.tells[0][1], /@/, 'an email reached the record or the message');
  assert.equal(lines(file).some((l) => l.kind === 'decision'), false, 'the mover wrote a decision line (that is the sweep\'s)');
  assert.ok(sweep.recent(file).some((l) => l.kind === 'move' && l.outcome === 'changed'), 'Settings was not given the move');
});

test('#7548 rule 2: an agent that took a turn since the decision is not moved (idleness read again from a new roster)', async () => {
  const file = fileFor();
  const [idle] = realCards(['ada']);
  const [busy] = realCards(['ada', 'working']);
  let fresh = 0;
  const { d, calls } = deps({ roster: () => [idle], freshRoster: () => { fresh += 1; return [busy]; } });
  const r = await twoTicks(automove.create({ file }), d);
  assert.equal(r.did, 'skipped');
  assert.equal(fresh, 1, 'the roster was not read again before the move');
  assert.deepEqual(calls.starts, [], 'an agent that was no longer idle was moved');
  assert.deepEqual([lines(file).pop().kind, lines(file).pop().because], ['skipped', 'it was no longer idle']);
});

test('#7548 rule 2: the re-check just before a move reads the projects again', async () => {
  const [ada] = realCards(['ada']);
  let fresh = 0;
  const { d, calls } = deps({ cards: [ada] });
  d.freshRecords = () => { fresh += 1; return [{ id: 'p1', tasks: [{ id: 't1', parts: [{ who: 'ada', title: 'x' }] }] }]; };
  const r = await twoTicks(automove.create({ file: fileFor() }), d);
  assert.equal(fresh, 1, 'the re-check did not read the projects again');
  assert.equal(r.did, 'skipped', 'an agent given a task part since the decision was moved');
  assert.deepEqual(calls.starts, []);
});

test('#7548 rule 12: a re-check that cannot be made is not "no longer idle": nothing written, nothing moved', async () => {
  for (const [what, o] of [
    ['a roster that cannot be read', { freshRoster: () => null }],
    ['a roster read that throws', { freshRoster: () => { throw new Error('tmux went away'); } }],
    ['a project read that throws', {}],
  ]) {
    const file = fileFor();
    const { d, calls } = deps(o);
    if (what === 'a project read that throws') d.freshRecords = () => { throw new Error('a project file is half-written'); };
    const r = await twoTicks(automove.create({ file }), d);
    assert.equal(r.did, 'unreadable', `${what}: read as ${r.did}`);
    assert.deepEqual(calls.starts, [], `${what}: the agent was moved`);
    assert.deepEqual(lines(file), [], `${what}: something was written`);
  }
  /* A per-agent check that throws (its commitment cannot be read) is not "no longer idle" either. */
  const file = fileFor();
  let reads = 0;
  const { d, calls } = deps();
  d.readCommitment = () => { reads += 1; if (reads > 2) throw new Error('its commitment file cannot be read'); return { state: 'clear' }; };
  const r = await twoTicks(automove.create({ file }), d);
  assert.equal(r.did, 'unreadable', 'a commitment that could not be read at the re-check was taken as busy');
  assert.deepEqual([calls.starts, lines(file)], [[], []]);
  /* Review round 2: the other "could not check" answers at the re-check are not "no longer idle" either. */
  const unsure = (card) => Object.defineProperty({ ...card }, 'unsentInput', { get() { throw new Error('the box could not be read'); }, enumerable: true });
  for (const [what, set] of [
    ['an agent gone from the new roster', (dd) => { dd.freshRoster = () => realCards(['bo']); }],
    ['a box that cannot be read', (dd) => { const [c] = realCards(['ada']); dd.freshRoster = () => [unsure(c)]; }],
    ['a guide check that throws', (dd) => { let g = 0; dd.isGuide = () => { g += 1; if (g > 2) throw new Error('the guide record is half-written'); return false; }; }],
  ]) {
    const f = fileFor();
    const { d: dd, calls: cc } = deps();
    set(dd);
    const rr = await twoTicks(automove.create({ file: f }), dd);
    assert.equal(rr.did, 'unreadable', `${what}: read as ${rr.did}`);
    assert.deepEqual([cc.starts, lines(f)], [[], []], `${what}: moved, or wrote "no longer idle"`);
  }
});

test('#7548: no move while another account move runs; refused, partial and stopped moves are recorded as such', async () => {
  const { d, calls } = deps({ busy: true });
  assert.equal((await twoTicks(automove.create({ file: fileFor() }), d)).because, 'busy');
  assert.deepEqual(calls.starts, []);
  const file = fileFor();
  const run2 = automove.create({ file });
  const { d: d2 } = deps({ start: () => ({ status: 202, body: { id: 'm', agents: [{ name: 'ada', outcome: 'refused', because: 'x' }] }, done: Promise.resolve() }) });
  assert.equal((await twoTicks(run2, d2)).did, 'refused');
  assert.equal(lines(file).pop().outcome, 'refused');
  assert.equal(run2.state.refused.has('ada'), true, 'CONTROL: an agent the move refused is held');
  /* A 409 is the board saying no move may start now, not the agent refused: no line and no hold. */
  const f409 = fileFor();
  const r409 = automove.create({ file: f409 });
  const { d: d409 } = deps({ start: () => ({ status: 409, body: { outcome: 'refused', because: 'busy' } }) });
  assert.equal((await twoTicks(r409, d409)).because, 'busy');
  assert.equal(lines(f409).some((l) => l.kind === 'move'), false, 'a 409 was recorded as a move');
  assert.equal(r409.state.refused.has('ada'), false, 'a 409 held a healthy agent as refused');
  for (const outcome of ['partial', 'stopped']) {
    const f = fileFor();
    const { d: dx, calls: cx } = deps({ moveOutcome: outcome });
    await twoTicks(automove.create({ file: f }), dx);
    assert.equal(lines(f).pop().outcome, outcome, `a ${outcome} move was recorded as something else`);
    /* kosmos#7621 item 4 and review 2: a stopped move tells nothing; a partial one is told once, never as moved. */
    if (outcome === 'stopped') assert.deepEqual(cx.tells, [], `an agent whose move was ${outcome} was told something`);
    else {
      assert.equal(cx.tells.length, 1, `an agent whose move was ${outcome} was not told exactly once`);
      assert.doesNotMatch(cx.tells[0][1], /^Kosmos moved this agent/, `an agent whose move was ${outcome} was told it moved`);
    }
  }
});

test('#7548 rules 4 and 5: seen working, seen refused (the target held a day, the person told, never moved back), or not seen in a day', async () => {
  let seen = null;
  const file = fileFor();
  const run = automove.create({ file });
  const where = { ada: '/u/.claude-work' };
  const { d, calls } = deps({ lastSeen: () => seen, where });
  await twoTicks(run, d);
  assert.equal(where.ada, '/u/.claude-spare', 'CONTROL: ada moved to spare');
  await run.tick(d, NOW + 2000);
  assert.equal(lines(file).filter((l) => l.kind === 'works').length, 0, 'CONTROL: nothing seen, nothing said');
  seen = { outcome: 'ok', at: NOW - 60000 };   // before the move: an old sighting is not this move's
  await run.tick(d, NOW + 3000);
  assert.equal(lines(file).filter((l) => l.kind === 'works').length, 0, 'a call from before the move counted');
  seen = { outcome: '401', at: Date.now() + 5000 };
  const starts = calls.starts.length;
  await run.tick(d, NOW + 4000);
  assert.equal(lines(file).filter((l) => l.kind === 'works').pop().works, 'no');
  assert.equal(calls.starts.length, starts, 'Kosmos moved an agent back on its own (rule 4: it tells the person instead)');
  assert.match(calls.tells.pop()[1], /^Kosmos moved this agent to spare, and its first request there was refused\. Move it back in Settings, AI Models, if it needs to work now\. Kosmos will not move agents to spare for a day\.$/);
  /* Another agent on work is not sent to spare for a day. */
  where.bo = '/u/.claude-work';
  const { d: d2, calls: c2 } = deps({ where, cards: realCards(['ada'], ['bo']) });
  await twoTicks(run, d2, NOW + 5000);
  assert.deepEqual(c2.starts, [], 'an agent was moved onto a target where the last move did not work');
  await twoTicks(run, d2, NOW + automove.FAILED_HOLD_MS + 6000);
  assert.equal(c2.starts.length, 1, 'CONTROL: the hold ends after a day');

  const f2 = fileFor();
  const r2 = automove.create({ file: f2 });
  const { d: dy } = deps({ lastSeen: () => ({ outcome: 'ok', at: Date.now() + 5000 }) });
  await twoTicks(r2, dy);
  await r2.tick(dy, NOW + 2000);
  assert.equal(lines(f2).filter((l) => l.kind === 'works').pop().works, 'yes');

  const f3 = fileFor();
  const r3 = automove.create({ file: f3 });
  const { d: dn } = deps();
  await twoTicks(r3, dn);
  await r3.tick(dn, Date.now() + automove.WATCH_MS + 60000);
  assert.equal(lines(f3).filter((l) => l.kind === 'works').pop().works, 'not-seen');
  assert.equal(r3.state.failed.has('/u/.claude-spare'), true, 'a target nobody was seen to work on was offered to the next agent at once');
});

test('#7548 rule 3: an account whose login has stopped is never acted on', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const usage = { ...USAGE, '/u/.claude-work': { at: NOW, state: 'http-401' } };
  const { d, calls } = deps({ usage });
  await twoTicks(run, d);
  await run.tick(d, NOW + 2000);
  assert.deepEqual(calls.starts, [], 'an agent was moved off a stopped login on its own');
  /* CONTROL: the decision the mover read does name that move, so it was refused for the login and not for want of one. */
  const rows = ab.rowsFromReadings({ list: LIST, readUsage: (dir) => usage[dir] || null, agentsOn: d.agentsOn, nowMs: NOW });
  const dec = ab.decide({ rows, movable: () => true, nowMs: NOW });
  assert.deepEqual([dec.atRisk[0].kind, dec.moves.map((m) => m.agent)], ['login', ['ada']]);
});

test('#7548: a first call made while the move was still finishing counts', async () => {
  let release;
  const done = new Promise((res) => { release = res; });
  let seen = null;
  const file = fileFor();
  const run = automove.create({ file });
  const { d } = deps({ lastSeen: () => seen,
    start: (body) => { setTimeout(() => { seen = { outcome: 'ok', at: Date.now() }; release(); }, 20); return { status: 202, body: { id: 'm', agents: [{ name: body.names[0], outcome: 'pending' }] }, done }; } });
  await twoTicks(run, d);
  await run.tick(d, NOW + 2000);
  assert.equal(lines(file).filter((l) => l.kind === 'works').pop()?.works, 'yes', 'a call made during the restart was ignored');
});

test('#7548 rule 10: the holds are rebuilt from the record when the board starts', async () => {
  const file = fileFor();
  sweep.append(file, { kind: 'works', at: NOW - H, agent: 'zed', to: '/u/.claude-spare', works: 'no' });
  sweep.append(file, { kind: 'move', at: NOW - 60000, agent: 'bo', to: '/u/.claude-spare', outcome: 'refused' });
  sweep.append(file, { kind: 'released', at: NOW - 50000, agent: 'cy', to: '/u/.claude-third' });
  const run = automove.create({ file, nowMs: NOW });
  assert.ok(run.state.failed.has('/u/.claude-spare'), 'a target where a move did not work was forgotten by a restart');
  assert.ok(run.state.resting.has('zed'), 'an agent whose move did not work was not rested after a restart');
  assert.ok(run.state.resting.has('cy'), 'an agent a person took back was not rested after a restart');
  assert.ok(run.state.refused.has('bo'), 'a refused agent was forgotten by a restart');
  const { d, calls } = deps();
  await twoTicks(run, d);
  assert.deepEqual(calls.starts, [], 'a restarted board moved an agent onto a held target');
  const old = automove.create({ file, nowMs: NOW + automove.FAILED_HOLD_MS });
  assert.equal(old.state.failed.size + old.state.refused.size, 0, 'CONTROL: holds past their time are not rebuilt');
});

test('#7548: an agent whose move is refused is passed over for an hour, so the next idle agent moves', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const cards = realCards(['ada'], ['bo']);
  const { d, calls } = deps({ cards, names: ['ada', 'bo'],
    start: (body) => (body.names[0] === 'ada' ? { status: 202, body: { id: 'm', agents: [{ name: 'ada', outcome: 'refused' }] }, done: Promise.resolve() }
      : { status: 202, body: { id: 'm2', agents: [{ name: body.names[0], outcome: 'pending' }] }, done: Promise.resolve() }) });
  assert.equal((await twoTicks(run, d)).did, 'refused');
  const second = await run.tick(d, NOW + 2000);
  assert.deepEqual([second.did, second.agent], ['moved', 'bo'], 'a refused agent kept every other agent from moving');
  d.agentsOn = (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true, moving: [] });   // bo has gone
  await run.tick(d, NOW + 3000);
  assert.deepEqual(calls.starts.map((b) => b.names[0]), ['ada', 'bo'], 'the refused agent was tried again inside its hour');
  await twoTicks(run, d, NOW + automove.REFUSED_HOLD_MS + 4000);   // two ticks: an hour-old reading is not the previous tick's
  assert.deepEqual(calls.starts.map((b) => b.names[0]), ['ada', 'bo', 'ada'], 'CONTROL: after the hour it is tried again');
});

test('#7548 rule 10: the watch is rebuilt from the record, a move that only started included; a line from the future is not trusted', () => {
  const file = fileFor();
  sweep.append(file, { kind: 'move', at: NOW - 60000, startedAt: NOW - 70000, agent: 'ada', from: '/u/.claude-work', to: '/u/.claude-spare', outcome: 'changed' });
  sweep.append(file, { kind: 'move', at: NOW - 50000, startedAt: NOW - 50000, agent: 'cy', from: '/u/.claude-work', to: '/u/.claude-spare', outcome: 'started' });
  sweep.append(file, { kind: 'move', at: NOW - 40000, startedAt: NOW - 45000, agent: 'bo', from: '/u/.claude-work', to: '/u/.claude-spare', outcome: 'started' });
  sweep.append(file, { kind: 'move', at: NOW - 30000, startedAt: NOW - 45000, agent: 'bo', from: '/u/.claude-work', to: '/u/.claude-spare', outcome: 'partial' });
  sweep.append(file, { kind: 'works', at: NOW + 10 * sweep.CLOCK_SLACK_MS, agent: 'zed', to: '/u/.claude-third', works: 'no' });
  sweep.append(file, { kind: 'move', at: NOW - automove.WATCH_MS - 1000, startedAt: NOW - automove.WATCH_MS - 2000, agent: 'dee', from: '/u/.claude-work', to: '/u/.claude-third', outcome: 'changed' });
  const run = automove.create({ file, nowMs: NOW });
  assert.deepEqual(run.state.watching.map((w) => [w.agent, w.movedAt]).sort(), [['ada', NOW - 70000], ['bo', NOW - 45000], ['cy', NOW - 50000]],
    'the watch was lost by a restart (a partial move is watched too), or a move older than the watch was watched again');
  const ended = lines(file).find((l) => l.agent === 'cy' && l.outcome === 'unknown');
  assert.ok(ended, 'a move the board stopped in the middle of was left with no ending, so Settings never shows it');
  assert.equal(ended.at, NOW - 50000, 'an unfinished move was stamped with the restart time, so it shows as new');
  assert.equal(run.state.resting.has('cy'), true, 'rule 8: an unfinished (unknown) move did not rest the agent');
  assert.equal(run.state.failed.has('/u/.claude-third'), false, 'a line stamped in the future held a target');
  sweep.append(file, { kind: 'works', at: NOW - 20000, agent: 'ada', to: '/u/.claude-spare', works: 'yes' });
  assert.deepEqual(automove.create({ file, nowMs: NOW }).state.watching.map((w) => w.agent).sort(), ['bo', 'cy'], 'CONTROL: a watch that ended is not rebuilt');
});

test('#7548: a move says it started before its restarts run, so a board that stops mid-move still knows', async () => {
  const file = fileFor();
  let seenLines = null;
  const { d } = deps({
    start: (body) => ({ status: 202, body: { id: 'm', agents: [{ name: body.names[0], outcome: 'pending' }] },
      done: new Promise((res) => { setTimeout(() => { seenLines = lines(file).map((l) => l.kind + ':' + (l.outcome || '')); res(); }, 0); }) }) });
  await twoTicks(automove.create({ file }), d);
  assert.ok(seenLines && seenLines.includes('move:started'), 'nothing was recorded before the restarts ran: ' + JSON.stringify(seenLines));
  assert.equal(sweep.recent(file).some((l) => l.outcome === 'started'), false, 'Settings was handed a started line it draws as nothing');
});

test('#7548 rule 7: a person who moves an agent off the account Kosmos chose wins: released, and left alone a day', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  let seen = null;
  const where = { ada: '/u/.claude-work' };
  const { d, calls } = deps({ where, lastSeen: () => seen });
  await twoTicks(run, d);
  assert.equal(calls.starts.length, 1, 'CONTROL: the first move');
  where.ada = '/u/.claude-work';   // the person moves it back to Work by hand
  seen = { outcome: '401', at: Date.now() + 5000 };   // and a later call there is refused: never blamed on spare
  await twoTicks(run, d, NOW + 10000);
  await run.tick(d, NOW + 12000);
  assert.equal(calls.starts.length, 1, 'Kosmos undid a person\'s move on the next tick');
  const rel = lines(file).find((l) => l.kind === 'released');
  assert.ok(rel && rel.agent === 'ada', 'the person\'s move was not recorded');
  assert.equal(lines(file).some((l) => l.kind === 'works'), false, 'a call on another account was blamed on spare');
  assert.equal(run.state.failed.has('/u/.claude-spare'), false, 'spare was held for a call made somewhere else');
  assert.ok(automove.create({ file, nowMs: NOW + 13000 }).state.resting.has('ada'), 'a restart forgot the person\'s move');
  seen = null;
  /* Review round 3: the day runs from the release, not from Kosmos's move before it. */
  await twoTicks(run, d, NOW + automove.REST_MS + 5000);
  assert.equal(calls.starts.length, 1, 'the person\'s move rested the agent only as long as Kosmos\'s own move did');
  await twoTicks(run, d, NOW + automove.REST_MS + 20000);
  assert.equal(calls.starts.length, 2, 'CONTROL: after a day it may move again');
});

test('#7548 rule 7 (new): a person\'s move through the routes, with no move of Kosmos\'s before it, holds the agent a day', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const { d, calls } = deps();
  await run.tick(d, NOW);   // the first idle tick
  /* Between ticks, a person moves ada through Settings (the route writes its person line), then back. */
  assert.equal(automove.personMoved(file, ['ada'], '/u/.claude-third', NOW + 500, ON), true);
  await run.tick(d, NOW + 1000);
  await run.tick(d, NOW + 2000);
  assert.deepEqual(calls.starts, [], 'a person\'s move through the routes was undone by the next tick');
  assert.equal(automove.create({ file, nowMs: NOW + 3000 }).state.resting.has('ada'), true, 'a restart forgot the person\'s move');
  await twoTicks(run, d, NOW + automove.REST_MS + 1000);
  assert.equal(calls.starts.length, 1, 'CONTROL: a day later it may move');
  /* The line names the agent and the account folder, never an email, and Settings does not draw it. */
  const p = lines(file).find((l) => l.kind === 'person');
  assert.deepEqual([p.agent, p.to], ['ada', '/u/.claude-third']);
  assert.equal(sweep.recent(file).some((l) => l.kind === 'person'), false, 'Settings drew a person\'s move as the mover\'s news');
  /* Many agents in one write; none is no write; a record that cannot be read refuses the mover's tick. */
  const many = fileFor();
  assert.equal(automove.personMoved(many, ['a', 'b', '', 7, 'c'], '/x', NOW, ON), true);
  assert.deepEqual(lines(many).map((l) => l.agent), ['a', 'b', 'c']);
  const none = fileFor();
  assert.equal(automove.personMoved(none, [], '/x', NOW, ON), true);
  assert.equal(fs.existsSync(none), false, 'no agent still wrote a record');
  /* Review round 1: with moves off the routes write nothing, so the mover is inert, routes included. */
  for (const env of [{}, { AGENT_WORKFORCE_AUTOMOVE: '1', AGENT_WORKFORCE_AUTOMOVE_OFF: '1' }]) {
    const off = fileFor();
    assert.equal(automove.personMoved(off, ['ada'], '/x', NOW, env), true);
    assert.equal(fs.existsSync(off), false, 'a person\'s move wrote the record with moves off');
  }
  /* A record that cannot be read: at start the mover is not made; while it runs, a tick moves nothing. */
  const dirFile = fileFor();
  fs.mkdirSync(dirFile);   // a "record" that is a folder cannot be read
  assert.throws(() => automove.create({ file: dirFile, nowMs: NOW }), 'a mover was made on a record it could not read');
  const later = fileFor();
  const blind = automove.create({ file: later });
  const { d: db, calls: cb } = deps();
  await blind.tick(db, NOW);
  fs.mkdirSync(later);   // the record becomes unreadable between ticks
  const r = await blind.tick(db, NOW + 1000);
  assert.equal(r.did, 'unreadable', 'a mover that could not read a person\'s move moved anyway');
  assert.deepEqual(cb.starts, []);
});

test('#7548 rule 8: an agent Kosmos has moved rests a day, partial and unknown included', async () => {
  const file = fileFor();
  const list3 = [...LIST, THIRD];
  const usage = { ...USAGE, '/u/.claude-third': reading(20, 100) };
  const where = { ada: '/u/.claude-work' };
  const run = automove.create({ file });
  const { d, calls } = deps({ where, usage, lastSeen: () => ({ outcome: 'ok', at: Date.now() + 5000 }) });
  d.list = () => list3;
  await twoTicks(run, d);
  assert.deepEqual(calls.starts.pop(), { dir: '/u/.claude-spare', names: ['ada'] }, 'CONTROL: the first move');
  usage['/u/.claude-spare'] = reading(95, 40);   // now spare runs out too
  await twoTicks(run, d, NOW + 10000);
  assert.equal(calls.starts.length, 0, 'an agent Kosmos had just moved was moved again within the day');
  assert.ok(automove.create({ file, nowMs: NOW + 20000 }).state.resting.has('ada'), 'a restart forgot that ada was just moved');
  await twoTicks(run, d, NOW + automove.REST_MS + 30000);
  assert.deepEqual(calls.starts.pop(), { dir: '/u/.claude-third', names: ['ada'] }, 'CONTROL: after the day it may move on');
  for (const outcome of ['partial', 'stopped']) {
    const r = automove.create({ file: fileFor() });
    const { d: dx } = deps({ moveOutcome: outcome });
    await twoTicks(r, dx);
    assert.equal(r.state.resting.has('ada'), true, `a ${outcome} move did not rest the agent`);
  }
});

test('#7548: with fewer than two subscription accounts the mover stops before the agents walk', async () => {
  let walks = 0;
  const { d } = deps();
  d.list = () => [LIST[0], { dir: '/u/.claude-key', apiKey: true }];
  d.agentsOn = () => { walks += 1; return { names: [], complete: true }; };
  assert.equal((await automove.create({ file: fileFor() }).tick(d, NOW)).did, 'nothing');
  assert.equal(walks, 0, 'the agents were walked with one account');
});

test('#7548 rule 6: no second agent onto a target until the first one moved there has shown it works', async () => {
  let seen = null;
  const run = automove.create({ file: fileFor() });
  const { d, calls } = deps({ names: ['ada', 'bo'], cards: realCards(['ada'], ['bo']), lastSeen: (a) => (a === 'ada' ? seen : null) });
  await twoTicks(run, d);
  await run.tick(d, NOW + 2000);
  await run.tick(d, NOW + 3000);
  assert.deepEqual(calls.starts.map((b) => b.names[0]), ['ada'], 'a second agent followed the first onto a target nobody had seen work');
  seen = { outcome: 'ok', at: Date.now() + 5000 };
  await run.tick(d, NOW + 4000);   // the watch closes with "yes"
  await run.tick(d, NOW + 5000);
  assert.deepEqual(calls.starts.map((b) => b.names[0]), ['ada', 'bo'], 'CONTROL: once the first works there, the next one goes');
});

test('#7548 rule 6: a held or unproven target does not stop balancing: the next-best account is chosen', async () => {
  const run = automove.create({ file: fileFor() });
  run.state.failed.set('/u/.claude-spare', NOW);
  const { d, calls } = deps({ usage: { ...USAGE, '/u/.claude-third': reading(20, 100) } });
  d.list = () => [...LIST, THIRD];
  await twoTicks(run, d);
  assert.deepEqual(calls.starts, [{ dir: '/u/.claude-third', names: ['ada'] }], 'a held best target stopped the move instead of the next-best one taking it');
});

test('#7548: decide() skips the targets skipTarget names, and without it picks as before', () => {
  const rows = ab.rowsFromReadings({ list: [...LIST, THIRD], readUsage: (dir) => ({ ...USAGE, '/u/.claude-third': reading(20, 100) })[dir] || null,
    agentsOn: (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true, moving: [] }), nowMs: NOW });
  const plain = ab.decide({ rows, movable: () => true, nowMs: NOW });
  assert.deepEqual(plain.moves.map((m) => m.to), ['/u/.claude-spare'], 'CONTROL: without skipTarget, the best account');
  const skip = ab.decide({ rows, movable: () => true, nowMs: NOW, skipTarget: (dir) => dir === '/u/.claude-spare' });
  assert.deepEqual(skip.moves.map((m) => m.to), ['/u/.claude-third']);
  const none = ab.decide({ rows, movable: () => true, nowMs: NOW, skipTarget: () => true });
  assert.deepEqual([none.moves.length, none.held.map((h) => h.from)], [0, ['/u/.claude-work']], 'every target skipped is "held", not silent');
});

test('#7548 rule 9: after a partial move, a sighting is no proof until the agent\'s session has restarted since the move', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  let started = null;
  const { d } = deps({ moveOutcome: 'partial', lastSeen: () => ({ outcome: 'ok', at: Date.now() + 5000 }), sessionStart: async () => started });
  await twoTicks(run, d);
  started = NOW - 10 * 60000;   // the session from before the move: it may still be on its old account
  await run.tick(d, NOW + 2000);
  assert.equal(lines(file).some((l) => l.kind === 'works'), false, 'a call from an agent that may not have moved was taken as proof');
  assert.deepEqual(run.state.watching.map((w) => [w.agent, w.uncertain]), [['ada', true]], 'CONTROL: still watched, as uncertain');
  started = Date.now() + 1000;   // restarted since the move: now it runs on the target
  await run.tick(d, NOW + 3000);
  assert.equal(lines(file).filter((l) => l.kind === 'works').pop()?.works, 'yes', 'a sighting after the restart onto the target was not taken');
  /* With no way to read a session start, an uncertain watch never takes a sighting (it closes as not-seen). */
  const f2 = fileFor();
  const r2 = automove.create({ file: f2 });
  const { d: d2 } = deps({ moveOutcome: 'partial', lastSeen: () => ({ outcome: 'ok', at: Date.now() + 5000 }) });
  await twoTicks(r2, d2);
  await r2.tick(d2, NOW + 2000);
  assert.equal(lines(f2).some((l) => l.kind === 'works'), false);
  sweep.append(f2, { kind: 'move', at: NOW + 3000, agent: 'bo', from: '/u/.claude-work', to: '/u/.claude-spare', outcome: 'unknown' });
  assert.equal(automove.create({ file: f2, nowMs: NOW + 4000 }).state.watching.every((w) => w.uncertain), true, 'a rebuilt partial or unknown watch takes sightings as proof');
});

test('#7548 rule 11: a move that throws before an account write is a refusal; after it (or unsaid), unknown, rested and watched', async () => {
  const cases = [
    ['before the write', Object.assign(new Error('the board is going'), { wroteAccount: false }), 'refused'],
    ['after the write', Object.assign(new Error('the board fell over mid-move'), { wroteAccount: true }), 'unknown'],
    ['unsaid', new Error('something else'), 'unknown'],
  ];
  for (const [what, err, want] of cases) {
    const file = fileFor();
    const run = automove.create({ file });
    const { d } = deps({ start: () => { throw err; } });
    const r = await twoTicks(run, d);
    assert.equal(r.did, want, `${what}: read as ${r.did}`);
    const l = lines(file).pop();
    assert.deepEqual([l.kind, l.outcome], ['move', want], `${what}: recorded as something else`);
    assert.equal(run.state.watching.some((w) => w.agent === 'ada'), want === 'unknown', `${what}: watched wrongly`);
    assert.equal(run.state.resting.has('ada'), want === 'unknown', `${what}: rested wrongly`);
    if (want === 'unknown') {
      const again = automove.create({ file, nowMs: NOW + 5000 });
      assert.deepEqual([again.state.watching.map((w) => w.agent), again.state.resting.has('ada')], [['ada'], true], `${what}: a restart forgot the unknown move`);
    }
  }
});

test('#7548 rule 11: accountmove.start says whether an account write had begun when it throws', () => {
  accountmove.resetForTests();
  const base = { moveRefusal: () => null, REFUSED: 'refused', forget: () => {}, hold: () => {}, release: () => {}, restartAsync: async () => ({ outcome: 'restarted' }), RESTARTED: 'restarted' };
  /* Before: the board-restarting check throws. */
  let caught = null;
  try { accountmove.start({ dir: '/u/.claude-spare', names: ['ada'] }, { ...base, boardRestarting: () => { throw new Error('cannot read the update state'); } }); }
  catch (err) { caught = err; }
  assert.equal(caught && caught.wroteAccount, false, 'a throw before any write was not said as such');
  /* After: the write ran, then something after it threw (the read of the saved account cannot throw, so the write's
     own reported fields are made to). */
  caught = null;
  const wrote = { outcome: 'changed', account: 'spare' };
  Object.defineProperty(wrote, 'configDir', { get() { throw new Error('a getter that blew up'); }, enumerable: true });
  try { accountmove.start({ dir: '/u/.claude-spare', names: ['ada'] }, { ...base, setAccount: () => wrote }); }
  catch (err) { caught = err; }
  accountmove.resetForTests();
  assert.ok(caught, 'CONTROL: the throw after the write did not happen, so this case tested nothing');
  assert.equal(caught.wroteAccount, true, 'a throw after the write was said as before it');
  /* CONTROL: an ordinary start does not throw at all. */
  const ok = accountmove.start({ dir: '/u/.claude-spare', names: ['ada'] }, { ...base, setAccount: () => ({ outcome: 'changed', configDir: '/u/.claude-spare' }) });
  assert.equal(ok.status, 202);
  accountmove.resetForTests();
});

test('#7548: an agent refused three times in a day is passed over for the day', async () => {
  const file = fileFor();
  for (const at of [NOW - 5 * H, NOW - 3 * H, NOW - 2 * H]) sweep.append(file, { kind: 'move', at, agent: 'ada', from: '/u/.claude-work', to: '/u/.claude-spare', outcome: 'refused' });
  const run = automove.create({ file, nowMs: NOW });
  const { d, calls } = deps();
  await twoTicks(run, d);
  assert.deepEqual(calls.starts, [], 'an agent refused three times today was tried again after an hour');
  const once = fileFor();
  sweep.append(once, { kind: 'move', at: NOW - 2 * H, agent: 'ada', from: '/u/.claude-work', to: '/u/.claude-spare', outcome: 'refused' });
  const r2 = automove.create({ file: once, nowMs: NOW });
  const { d: d2, calls: c2 } = deps();
  await twoTicks(r2, d2);
  assert.equal(c2.starts.length, 1, 'CONTROL: one refusal two hours ago does not hold it');
});

test('#7548: an odd record does not stop the board starting, and the sweep\'s own decisions are untouched', () => {
  const file = fileFor();
  sweep.append(file, { kind: 'decision', at: NOW - 1000, moves: [null, 7], held: [null], atRisk: [null] });
  sweep.append(file, { kind: 'move', at: NOW - 1000, startedAt: NOW - 2000, from: '/a', to: '/b', outcome: 'started' });
  sweep.append(file, { kind: 'move', at: NOW - 1000, startedAt: NOW + 9e9, agent: 'ada', from: '/a', to: '/b', outcome: 'started' });
  let run;
  assert.doesNotThrow(() => { run = automove.create({ file, nowMs: NOW }); }, 'an odd line threw at startup');
  assert.deepEqual(run.state.watching.map((w) => [w.agent, w.movedAt]), [['ada', NOW - 1000]], 'a nameless line made a watch, or a future start was kept');
  /* The sweep reads the same record: the mover's lines do not change its last decision. */
  const s = sweep.create({ file, nowMs: NOW });
  assert.equal(s.state.lastKey, sweep.keyOf({ moves: [null, 7], held: [null], atRisk: [null] }));
});

test('#7548: Settings\' recent() draws the mover\'s lines, newest first, and never a started move or a person line', () => {
  const file = fileFor();
  const base = { agent: 'ada', from: '/u/.claude-work', to: '/u/.claude-spare' };
  sweep.append(file, { kind: 'decision', at: NOW - 9000, moves: [{ agent: 'ada', from: '/u/.claude-work', to: '/u/.claude-spare', kind: 'usage' }], held: [], atRisk: [] });
  sweep.append(file, { ...base, kind: 'move', at: NOW - 8000, outcome: 'started' });
  sweep.append(file, { ...base, kind: 'move', at: NOW - 7000, outcome: 'changed' });
  sweep.append(file, { ...base, kind: 'works', at: NOW - 6000, works: 'yes' });
  sweep.append(file, { ...base, kind: 'skipped', at: NOW - 5000 });
  sweep.append(file, { ...base, kind: 'released', at: NOW - 4000 });
  sweep.append(file, { kind: 'person', at: NOW - 3000, agent: 'bo' });
  sweep.append(file, { kind: 'works', at: NOW - 2000, works: 'yes' });   // names no agent
  assert.deepEqual(sweep.recent(file).map((l) => l.kind + (l.outcome ? ':' + l.outcome : '')), ['released', 'skipped', 'works', 'move:changed', 'decision']);
});

test('#7548: the board wires the mover through the bulk move\'s own deps, and only a reported move says it moves', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  /* Rule 1: one function serves the route and the mover. */
  assert.match(src, /accountmove\.start\(body, accountMoveDeps\(\)\)/, 'the bulk route does not use the shared deps');
  assert.match(src, /startMove: \(body\) => accountmove\.start\(body, accountMoveDeps\(\)\)/, 'the mover does not use the shared deps');
  assert.equal((src.match(/setAccount: \(n, dir\) => \{ fromDirs\.set/g) || []).length, 1, 'a second copy of the move\'s deps came back');
  /* Rule 7: both routes write the person line, and only for an account they wrote. */
  assert.equal((src.match(/automove\.personMoved\(AUTOBALANCE_RECORD,/g) || []).length, 2, 'a route does not write the person line');
  assert.match(src, /sendJson\(res, 400, \{ outcome: 'refused', because: wrote\.because \}\);\s*return;\s*\}[\s\S]{0,200}automove\.personMoved\(AUTOBALANCE_RECORD, \[name\]/,
    'the one-agent route writes its person line before its refusal returns');
  assert.match(src, /automove\.personMoved\(AUTOBALANCE_RECORD, started\.body\.agents\.filter\(\(x\) => x && x\.outcome !== 'refused'\)/,
    'the bulk route names refused agents as moved by a person');
  /* Inert unless switched on: the mover is made, ticked and shown as moving only when moves are on. */
  assert.match(src, /if \(abSweep && automove\.movesOn\(\)\) \{\s*(?:\/\*[^*]*\*\/\s*)?try \{ automoveRun = automove\.create\(/, 'the mover is made with moves off');
  assert.match(src, /\.then\(\(\) => \(automoveRun && automove\.movesOn\(\) && autobalanceSweepRuns\(\{ forTick: true \}\) \? automoveRun\.tick\(automoveDeps\(sweepDeps\)\)/, 'the mover ticks with moves off');
  assert.match(src, /autobalance\.moving = autobalance\.recording === true && !!automoveRun && automove\.movesOn\(\);/, 'Settings says moving with moves off');
});

test('#7548 review round 2: no move the record cannot keep', async () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'ro-'));
  const file = path.join(dir, 'record.jsonl');
  const run = automove.create({ file });
  const { d, calls } = deps();
  await run.tick(d, NOW);
  fs.chmodSync(dir, 0o555);   // readable, not writable: a write fails, a read works
  try {
    const r = await run.tick(d, NOW + 1000);
    assert.deepEqual([r.did, r.because], ['unreadable', 'the record could not be written'], 'a move ran with a record that could not keep it');
    assert.deepEqual(calls.starts, []);
  } finally { fs.chmodSync(dir, 0o755); }
  await run.tick(d, NOW + 2000);
  assert.equal(calls.starts.length, 1, 'CONTROL: a writable record lets it move');
});

test('#7548 review round 2: a person\'s move made while the tick runs is read again just before the move', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const { d, calls } = deps();
  const roster = d.freshRoster;
  d.freshRoster = () => { automove.personMoved(file, ['ada'], '/u/.claude-third', NOW + 900, ON); return roster(); };
  const r = await twoTicks(run, d);
  assert.equal(r.did, 'nothing');
  assert.deepEqual(calls.starts, [], 'a person\'s move made during the tick was undone');
});

test('#7548 review round 6: a person\'s move the record could not keep waits, moves nobody, and is written once it can be', async () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'pm-'));
  const file = path.join(dir, 'r.jsonl');
  const run = automove.create({ file });
  const { d, calls } = deps();
  fs.chmodSync(dir, 0o555);
  try {
    assert.equal(automove.personMoved(file, ['zed'], '/x', NOW, ON), false);
    assert.equal(automove.personMoved(file, ['yan'], '/x', NOW + 10, ON), false);
    const r = await twoTicks(run, d);
    assert.equal(r.did, 'unreadable', 'a person\'s move that was not recorded let the mover move');
    assert.equal(run.paused(), 'record', 'Settings is not told the mover waits');
    assert.deepEqual(calls.starts, []);
  } finally { fs.chmodSync(dir, 0o755); }
  try {
    await twoTicks(run, d, NOW + 2000);
    assert.deepEqual(lines(file).filter((l) => l.kind === 'person').map((l) => l.agent), ['zed', 'yan'], 'the waiting lines were not written, in order');
    assert.equal(run.paused(), null);
    assert.equal(calls.starts.length, 1, 'CONTROL: once the lines are written it moves, without waiting a day');
  } finally { automove.resetUnwrittenPeopleForTests(); }
});

test('#7548 review round 2: a restart in the move\'s own second (tmux reads whole seconds) counts as after it', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  let started = null;
  const { d } = deps({ lastSeen: () => ({ outcome: 'ok', at: Date.now() + 5000 }), sessionStart: async () => started });
  await twoTicks(run, d);
  const movedAt = run.state.watching[0].movedAt;
  started = Math.floor(movedAt / 1000) * 1000;
  await run.tick(d, NOW + 2000);
  assert.equal(lines(file).filter((l) => l.kind === 'works').pop()?.works, 'yes', 'a restart in the same second was never taken as one');
});


test('#7548 review round 1: after a changed move, a call from the session that ran before the restart is no proof', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  let started = null;
  let seen = null;
  const { d } = deps({ lastSeen: () => seen, sessionStart: async () => started });
  await twoTicks(run, d);
  assert.deepEqual(run.state.watching.map((w) => w.agent), ['ada'], 'CONTROL: the changed move is watched');
  started = NOW - 10 * 60000;   // the old session is still the one tmux reads
  seen = { outcome: 'refused', at: Date.now() + 5000 };   // its last call, made after the account write
  await run.tick(d, NOW + 2000);
  assert.equal(lines(file).some((l) => l.kind === 'works'), false, 'the old session\'s call was taken as the new account\'s first');
  assert.equal(run.state.failed.has('/u/.claude-spare'), false, 'the target was held for a call made on the old account');
  started = Date.now() + 1000;   // restarted onto the target
  seen = { outcome: 'ok', at: Date.now() + 6000 };
  await run.tick(d, NOW + 3000);
  assert.equal(lines(file).filter((l) => l.kind === 'works').pop()?.works, 'yes', 'CONTROL: a call after the restart is taken');
  /* With no session start to read, a changed move takes sightings as before. */
  const f2 = fileFor();
  const r2 = automove.create({ file: f2 });
  const { d: d2 } = deps({ lastSeen: () => ({ outcome: 'ok', at: Date.now() + 5000 }) });
  await twoTicks(r2, d2);
  await r2.tick(d2, NOW + 2000);
  assert.equal(lines(f2).filter((l) => l.kind === 'works').pop()?.works, 'yes', 'a changed move with no session start never took a sighting');
});

test('#7548 review round 3: a walk that could not list every agent never closes a watch, and the default account is walked as one', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const { d } = deps();
  await twoTicks(run, d);
  assert.deepEqual(run.state.watching.map((w) => w.agent), ['ada'], 'CONTROL: the move is watched');
  const walk = d.agentsOn;
  d.agentsOn = (dir, isDefault) => (dir === '/u/.claude-spare' ? { names: [], complete: false, moving: [] } : walk(dir, isDefault));
  await run.tick(d, NOW + 2000);
  assert.equal(lines(file).some((l) => l.kind === 'released'), false, 'a walk that could not finish read as the person moving the agent');
  assert.deepEqual(run.state.watching.map((w) => w.agent), ['ada']);
  /* The default account lists its agents only when asked as the default (accounts' walk). */
  d.isDefaultDir = (dir) => dir === '/u/.claude-spare';
  d.agentsOn = (dir, isDefault) => (dir === '/u/.claude-spare' && isDefault !== true ? { names: [], complete: true, moving: [] } : walk(dir, isDefault));
  await run.tick(d, NOW + 3000);
  assert.equal(lines(file).some((l) => l.kind === 'released'), false, 'the default account was walked as an ordinary one, so its agents read as gone');
  d.agentsOn = (dir, isDefault) => (dir === '/u/.claude-spare' ? { names: [], complete: true, moving: [] } : walk(dir, isDefault));
  await run.tick(d, NOW + 4000);
  assert.equal(lines(file).filter((l) => l.kind === 'released').length, 1, 'CONTROL: a full walk without the agent releases it');
});

test('#7548 review round 3: three refusals hold an agent a day only when all three fall inside the day', async () => {
  /* The last refusal two hours ago, past its hour; the day's hold depends on how many fell inside the day. */
  for (const [what, times, moves] of [
    ['two of three over a day old', [NOW - automove.DAY_MS - 5000, NOW - automove.DAY_MS - 4000, NOW - 2 * H], 1],
    ['CONTROL: all three inside the day', [NOW - 4 * H, NOW - 3 * H, NOW - 2 * H], 0],
  ]) {
    const run = automove.create({ file: fileFor() });
    run.state.refused.set('ada', NOW - 2 * H);
    run.state.refusedTimes.set('ada', times);
    const { d, calls } = deps();
    await twoTicks(run, d);
    assert.equal(calls.starts.length, moves, what);
  }
});

test('#7548 review round 4: a tick that saw the agent working, or a previous tick too long ago, is not one of the two idle ticks', async () => {
  /* Idle, then working at the re-check (skipped), then idle: the third tick alone does not move it. */
  const [idle] = realCards(['ada']);
  const [busy] = realCards(['ada', 'working']);
  let fresh = [idle];
  const file = fileFor();
  const run = automove.create({ file });
  const { d, calls } = deps({ roster: () => [idle], freshRoster: () => fresh });
  await run.tick(d, NOW);
  fresh = [busy];
  assert.equal((await run.tick(d, NOW + 1000)).did, 'skipped');
  fresh = [idle];
  await run.tick(d, NOW + 2000);
  assert.deepEqual(calls.starts, [], 'an agent seen working one tick ago was moved on one idle tick');
  await run.tick(d, NOW + 3000);
  assert.equal(calls.starts.length, 1, 'CONTROL: two idle ticks after it, it moves');
  assert.equal(lines(file).filter((l) => l.kind === 'skipped').length, 1);
  /* Two ticks further apart than the sweep's period allow are not consecutive ones. */
  const r2 = automove.create({ file: fileFor() });
  const { d: d2, calls: c2 } = deps();
  await r2.tick(d2, NOW);
  await r2.tick(d2, NOW + automove.previousTickMs() + 1000);
  assert.deepEqual(c2.starts, [], 'a reading from long ago counted as the previous tick');
  await r2.tick(d2, NOW + automove.previousTickMs() + 2000);
  assert.equal(c2.starts.length, 1, 'CONTROL: the next tick in time moves it');
});

test('#7548 review round 4: "no longer idle" is written at most once an hour per agent', async () => {
  const [idle] = realCards(['ada']);
  const [busy] = realCards(['ada', 'working']);
  const file = fileFor();
  const run = automove.create({ file });
  const { d } = deps({ roster: () => [idle], freshRoster: () => [busy] });
  const dids = [];
  for (let i = 0; i < 6; i += 1) dids.push((await run.tick(d, NOW + i * 1000)).did);
  assert.equal(lines(file).filter((l) => l.kind === 'skipped').length, 1, 'a skip was written on every tick');
  assert.equal(dids.filter((x) => x === 'skipped').length, 1, 'a skip already said this hour was reported again (the board logs every one)');
  for (let i = 0; i < 2; i += 1) await run.tick(d, NOW + automove.SKIP_SAID_MS + 10000 + i * 1000);
  assert.equal(lines(file).filter((l) => l.kind === 'skipped').length, 2, 'CONTROL: an hour later it is said again');
});

test('#7548 review round 4: one tick at a time, so a watch a move adds is never dropped by a tick beside it', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  let release;
  const gate = new Promise((r) => { release = r; });
  const { d, calls } = deps({ start: (body) => ({ status: 202, body: { id: 'm1', agents: [{ name: body.names[0], outcome: 'pending' }] }, done: gate }) });
  await run.tick(d, NOW);
  const first = run.tick(d, NOW + 1000);   // moves, and waits on the move's restarts
  await new Promise((r) => setImmediate(r));
  const second = await run.tick(d, NOW + 2000);
  assert.deepEqual([second.did, second.because], ['nothing', 'busy'], 'a second tick ran beside a move');
  release();
  assert.equal((await first).did, 'moved');
  assert.equal(calls.starts.length, 1);
  assert.deepEqual(run.state.watching.map((w) => w.agent), ['ada'], 'the move\'s watch was lost');
});

test('#7548 review rounds 4 and 6: a move\'s lines the record did not take wait, in order, and moves stop until they are written; route names are trimmed', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const { d, calls } = deps({ start: (body) => { fs.rmSync(file, { force: true }); fs.mkdirSync(file); /* Only the started line fails: the record is writable again before the move ends. */
    return { status: 202, body: { id: 'm1', agents: [{ name: body.names[0], outcome: 'pending' }] }, done: Promise.resolve().then(() => fs.rmSync(file, { recursive: true, force: true })) }; } });
  await twoTicks(run, d);
  assert.equal(calls.starts.length, 1, 'CONTROL: the move ran');
  /* The ending waits behind the started line, so the record never holds an ending before its start. */
  assert.deepEqual(run.state.unwritten.map((l) => l.outcome), ['started', 'changed'], 'a move whose started line the record did not keep was not noticed');
  assert.deepEqual(lines(file), [], 'the ending was written ahead of its start');
  assert.equal(run.paused(), 'record');
  const r = await run.tick(d, NOW + 3000);
  assert.deepEqual(lines(file).filter((l) => l.kind === 'move').map((l) => l.outcome), ['started', 'changed'], 'the waiting lines were not written, in order');
  assert.equal(run.paused(), null);
  assert.notEqual(r.did, 'unreadable', 'CONTROL: once written, moves are not stopped');
  /* The mirror: the started line is kept and the record breaks during the move, so only the ending waits. */
  const f2 = fileFor();
  const r2 = automove.create({ file: f2 });
  const { d: d2 } = deps({ start: (body) => ({ status: 202, body: { id: 'm2', agents: [{ name: body.names[0], outcome: 'pending' }] },
    done: Promise.resolve().then(() => { fs.rmSync(f2, { force: true }); fs.mkdirSync(f2); }) }) });
  try {
    await twoTicks(r2, d2);
    assert.deepEqual(r2.state.unwritten.map((l) => l.outcome), ['changed'], 'a move whose ending the record did not keep was not noticed');
    const stopped = await r2.tick(d2, NOW + 3000);
    assert.equal(stopped.did, 'unreadable', 'the mover went on with a move\'s ending unwritten');
  } finally { fs.rmSync(f2, { recursive: true, force: true }); }
  const named = fileFor();
  automove.personMoved(named, ['  ada '], '/x', NOW, ON);
  assert.deepEqual(lines(named).map((l) => l.agent), ['ada'], 'a name with spaces round it was written as sent');
});

test('#7548 review round 5: the previous tick is measured in the board\'s sweep period, which an operator can set', async () => {
  const POLL = require('./usagepoll').POLL_MS;
  assert.equal(automove.PERIOD_MS, POLL);
  assert.ok(automove.previousTickMs() >= 2 * POLL && automove.previousTickMs() <= 4 * POLL, 'the default window is not about two sweep periods');
  /* A board sweeping every 40 minutes: two ticks one period apart are consecutive. */
  const run = automove.create({ file: fileFor(), periodMs: 40 * 60000 });
  const { d, calls } = deps();
  await run.tick(d, NOW);
  await run.tick(d, NOW + 40 * 60000);
  assert.equal(calls.starts.length, 1, 'a board with a longer sweep period could never move');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /automove\.create\(\{ file: AUTOBALANCE_RECORD, periodMs: abSweepMs \}\)/, 'the board does not pass its sweep period');
});

test('#7548 review round 5: a tick that throws does not leave the mover busy', async () => {
  const run = automove.create({ file: fileFor() });
  const { d, calls } = deps();
  await run.tick(d, NOW);
  let once = true;
  d.accountBusy = () => { if (once) { once = false; throw new Error('could not read the move state'); } return false; };
  await assert.rejects(run.tick(d, NOW + 1000));
  await run.tick(d, NOW + 2000);
  await run.tick(d, NOW + 3000);
  assert.equal(calls.starts.length, 1, 'a tick that threw left every later tick answering busy');
});

test('#7548 review round 5: while moves wait for the record, a moved agent\'s refused first request is still told', async () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'told-'));
  const file = path.join(dir, 'r.jsonl');
  const run = automove.create({ file });
  const { d, calls } = deps({ lastSeen: () => ({ outcome: '401', at: Date.now() + 5000 }) });
  await twoTicks(run, d);
  assert.equal(calls.starts.length, 1);
  fs.chmodSync(dir, 0o555);   // the sweep writes by rename, so the folder, not the file
  try {
    const r = await run.tick(d, NOW + 5000);
    assert.equal(r.did, 'unreadable', 'CONTROL: moves were not waiting');
    assert.equal(calls.tells.filter(([, t]) => /refused/.test(t)).length, 1, 'the person was not told while moves waited');
  } finally { fs.chmodSync(dir, 0o755); }
});

test('#7548 review round 6: the record\'s history is in time order and holds only lines Settings draws', () => {
  const file = fileFor();
  const t = Date.now() - 60 * 60000;
  sweep.appendAll(file, [
    { kind: 'move', at: t + 2000, agent: 'bo', from: '/a', to: '/b', outcome: 'changed' },
    { kind: 'move', at: t + 1000, agent: 'ada', from: '/a', to: '/b', outcome: 'unknown' },   // written late, at the next start
    { kind: 'move', at: t + 3000, agent: 'cy', from: '/a', to: '/b', outcome: 'started' },
    { kind: 'move', at: t + 4000, agent: 'cy', from: '/a', to: '/b', outcome: 'something-new' },
    { kind: 'works', at: t + 5000, agent: 'cy', from: '/a', to: '/b', works: 'maybe' },
    { kind: 'works', at: t + 6000, agent: 'bo', from: '/a', to: '/b', works: 'yes' },
  ]);
  assert.deepEqual(sweep.recent(file).map((l) => l.agent + ' ' + (l.outcome || l.works)), ['bo yes', 'bo changed', 'ada unknown'],
    'the history is out of time order, or holds a line the page cannot draw');
});

test('#7548 review round 6: while the mover runs, Settings skips its held targets and says when it waits', async () => {
  const run = automove.create({ file: fileFor() });
  const { d } = deps({ lastSeen: () => ({ outcome: '401', at: Date.now() + 5000 }) });
  await twoTicks(run, d);
  await run.tick(d, NOW + 5000);   // the first request is refused: the target is held a day
  const held = [...run.state.failed.keys()];
  assert.equal(held.length, 1, 'CONTROL: no target was held');
  assert.equal(run.skipTarget(NOW + 6000)(held[0]), true, 'the mover does not report its held target');
  assert.equal(run.skipTarget(NOW + automove.FAILED_HOLD_MS + 6000)(held[0]), false, 'CONTROL: a day later it is not held');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /automoveRun && automove\.movesOn\(\) \? automoveRun\.skipTarget\(sentAt\) : null/, 'Settings does not use the mover\'s held targets');
  assert.match(src, /decision = ab\.decide\(\{ rows: claude, movable, nowMs: sentAt, \.\.\.\(skipTarget \? \{ skipTarget \} : \{\}\) \}\)/);
  assert.match(src, /autobalance\.movePaused = autobalance\.moving === true \? automoveRun\.paused\(\) : null/, 'Settings is not told the mover waits');
  assert.match(src, /const said = why !== null && why === automoveSaid;/, 'the board logs the same reason every tick');
});

test('#7548 review round 7: a move whose ending cannot be read is unknown, watched, and not called partial', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const { d } = deps();
  d.readMove = () => { throw new Error('the move record could not be read'); };
  const r = await twoTicks(run, d);
  assert.equal(r.did, 'unknown', 'an unreadable ending was not unknown');
  assert.deepEqual(lines(file).filter((l) => l.kind === 'move').map((l) => l.outcome), ['started', 'unknown']);
  assert.deepEqual(run.state.watching.map((w) => [w.agent, w.uncertain]), [['ada', true]], 'an unknown move was not watched as uncertain');
  /* CONTROL: the move's own record saying partial is still partial. */
  const f2 = fileFor();
  const r2 = automove.create({ file: f2 });
  const { d: d2 } = deps();
  d2.readMove = () => ({ agents: [{ name: 'ada', outcome: 'partial' }] });
  await twoTicks(r2, d2);
  assert.deepEqual(lines(f2).filter((l) => l.kind === 'move').map((l) => l.outcome), ['started', 'partial']);
});

test('#7548 review round 7: the rebuild keeps a target\'s newest hold, whatever order the record holds it in', () => {
  const file = fileFor();
  const t = Date.now();
  sweep.appendAll(file, [
    { kind: 'works', at: t - 1000, agent: 'ada', from: '/a', to: '/b', works: 'no' },
    { kind: 'works', at: t - 20 * 60 * 60000, agent: 'bo', from: '/a', to: '/b', works: 'not-seen' },   // older, written late
  ]);
  assert.equal(automove.create({ file }).state.failed.get('/b'), t - 1000, 'an older hold written late shortened the newer one');
});

test('#7548 review round 7: Settings marks an agent the mover leaves alone', async () => {
  const run = automove.create({ file: fileFor() });
  const { d } = deps();
  await twoTicks(run, d);
  assert.equal(run.passedOver(NOW + 2000)('ada'), true, 'a moved agent is not reported as left alone');
  assert.equal(run.passedOver(NOW + 2000)('nobody'), false, 'CONTROL');
  assert.equal(run.passedOver(Date.now() + automove.REST_MS + 60000)('ada'), false, 'CONTROL: a day later it is not left alone');   // the rest is stamped with the real clock
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /const left = automoveRun\.leftAlone\(sentAt\); decision\.moves = decision\.moves\.map\(\(m\) => \(left\(m\.agent\) \? \{ \.\.\.m, leaving: true \} : m\)\);/,
    'the Settings read does not mark agents the mover leaves alone');
});

test('kosmos#7621 item 8: an agent whose re-check cannot be made is set aside, so the next candidate gets its turn', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const cards = realCards(['ada'], ['bo']);
  const { d, calls } = deps({ cards, names: ['ada', 'bo'], freshRoster: () => cards.filter((c) => c.sessionName !== 'ada' && c.name !== 'ada') });
  await run.tick(d, NOW);
  const r2 = await run.tick(d, NOW + 1000);
  assert.equal(r2.did, 'unreadable', 'CONTROL: the first candidate\'s re-check could not be made');
  assert.deepEqual(calls.starts, []);
  await run.tick(d, NOW + 2000);
  assert.deepEqual(calls.starts.map((s) => s.names[0]), ['bo'], 'one agent whose re-check failed blocked every move');
  assert.ok(lines(file).some((l) => l.kind === 'move' && l.agent === 'bo'), 'CONTROL: this is the record the mover writes');
  assert.deepEqual(lines(file).filter((l) => l.kind === 'skipped'), [], 'a re-check that could not be made wrote a skipped line');
});

test('kosmos#7621 item 4: a partial or unknown move tells the agent\'s thread where it may be', async () => {
  const p = automove.create({ file: fileFor() });
  const { d: dp, calls: cp } = deps({ moveOutcome: 'partial' });
  await twoTicks(p, dp);
  assert.deepEqual(cp.tells.map(([a, t]) => [a, /^Kosmos saved spare for this agent but did not see it restart there/.test(t)]), [['ada', true]], 'a partial move told nothing');
  const u = automove.create({ file: fileFor() });
  const { d: du, calls: cu } = deps();
  du.readMove = () => { throw new Error('unreadable'); };
  await twoTicks(u, du);
  assert.equal(cu.tells.filter(([, t]) => /could not tell whether it went through/.test(t)).length, 1, 'an unknown move told nothing');
  const t = automove.create({ file: fileFor() });
  const { d: dt, calls: ct } = deps({ start: () => { const e = new Error('boom'); e.wroteAccount = true; throw e; } });
  await twoTicks(t, dt);
  assert.equal(ct.tells.filter(([, x]) => /could not tell whether it went through/.test(x)).length, 1, 'a move that threw after its write told nothing');
  const c = automove.create({ file: fileFor() });
  const { d: dc, calls: cc } = deps();
  await twoTicks(c, dc);
  assert.equal(cc.tells.filter(([, x]) => /could not tell|could not start/.test(x)).length, 0, 'CONTROL: a clean move said it did not finish');
});

test('kosmos#7621 item 2: Settings sees a person\'s move made since the last tick, written or still waiting', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const { d } = deps();
  await run.tick(d, NOW);
  assert.equal(run.passedOver(NOW + 1000)('ada'), false, 'CONTROL: nothing holds ada yet');
  automove.personMoved(file, ['ada'], '/u/.claude-spare', NOW + 500, ON);
  assert.equal(run.passedOver(NOW + 1000)('ada'), false, 'CONTROL: the last tick has not read the person line');
  assert.equal(run.leftAlone(NOW + 1000)('ada'), true, 'Settings would say Kosmos will move an agent a person just moved');
  /* A person line the record could not take yet. */
  const dir = fs.mkdtempSync(path.join(TMP, 'la-'));
  const f2 = path.join(dir, 'r.jsonl');
  const r2 = automove.create({ file: f2 });
  fs.chmodSync(dir, 0o555);
  try {
    assert.equal(automove.personMoved(f2, ['bo'], '/u/.claude-spare', NOW, ON), false, 'CONTROL: the line waits');
    assert.equal(r2.leftAlone(NOW + 1000)('bo'), true, 'a person line still waiting was not seen');
  } finally { fs.chmodSync(dir, 0o755); automove.resetUnwrittenPeopleForTests(); }
});

test('kosmos#7621 item 7: the sweep and the mover share one tick\'s deps, so the agents are walked once a tick', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /const sweepDeps = autobalanceSweepDeps\(\);[^\n]*\n\s+try \{ ticking = abSweep\.tick\(sweepDeps\); \}/, 'the sweep does not use the tick\'s deps');
  assert.match(src, /automoveRun\.tick\(automoveDeps\(sweepDeps\)\)/, 'the mover builds a second walk each tick');
  assert.match(src, /function automoveDeps\(sweepDeps = null\) \{\n\s+const d = sweepDeps \|\| autobalanceSweepDeps\(\);/);
});

test('kosmos#7621 review 1: the set-aside shows in Settings, holds only the agent the re-check failed for, and ends when one works', async () => {
  const cards = realCards(['ada'], ['bo']);
  /* A roster that cannot be read at all is every agent's: nobody is set aside. */
  const r1 = automove.create({ file: fileFor() });
  const { d: d1 } = deps({ cards, names: ['ada', 'bo'], freshRoster: () => { throw new Error('tmux did not answer'); } });
  await twoTicks(r1, d1);
  assert.equal(r1.state.recheckFailed.size, 0, 'an unreadable roster set an innocent agent aside');
  /* The agent missing from the fresh roster is set aside, and Settings says Kosmos leaves it alone. */
  let missing = true;
  const r2 = automove.create({ file: fileFor() });
  const { d: d2, calls } = deps({ cards, names: ['ada', 'bo'], freshRoster: () => (missing ? cards.filter((c) => c.name !== 'ada' && c.sessionName !== 'ada') : cards) });
  await twoTicks(r2, d2);
  assert.equal(r2.state.recheckFailed.has('ada'), true, 'CONTROL: ada was set aside');
  assert.equal(r2.leftAlone(NOW + 2000)('ada'), true, 'Settings would say Kosmos will move an agent it set aside');
  /* The roster has her again: once a re-check of her works, the hold ends. */
  missing = false;
  r2.state.recheckFailed.set('ada', NOW - 2 * 60 * 60 * 1000);   // the hour is up
  await run2(r2, d2);
  assert.equal(r2.state.recheckFailed.has('ada'), false, 'a re-check that worked did not end the hold');
  assert.ok(calls.starts.length >= 1, 'CONTROL: a move went ahead');
  async function run2(r, d) { await r.tick(d, NOW + 3000); await r.tick(d, NOW + 4000); }
});

test('kosmos#7621 review 2: any re-check that fails for one agent alone (its box unreadable) sets it aside, not only a missing one', async () => {
  const cards = realCards(['ada'], ['bo']);
  const isAda = (c) => c.name === 'ada' || c.sessionName === 'ada';
  const fresh = () => cards.map((c) => (isAda(c) ? Object.defineProperty({ ...c }, 'unsentInput', { get() { throw new Error('the box could not be read'); } }) : c));
  const run = automove.create({ file: fileFor() });
  const { d, calls } = deps({ cards, names: ['ada', 'bo'], freshRoster: fresh });
  await run.tick(d, NOW);
  const r2 = await run.tick(d, NOW + 1000);
  assert.equal(r2.did, 'unreadable', 'CONTROL: ada\'s re-check could not be made');
  assert.equal(run.state.recheckFailed.has('ada'), true, 'an agent whose box could not be read was not set aside');
  await run.tick(d, NOW + 2000);
  assert.deepEqual(calls.starts.map((s) => s.names[0]), ['bo'], 'one agent with an unreadable box blocked every move');
});
