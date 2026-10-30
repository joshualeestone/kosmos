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
  assert.match(calls.tells[0][1], /^Kosmos moved this agent from work to spare, because it is at 93% of its weekly limit/);
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
  assert.equal(lines(file).pop().because, 'it was no longer idle');
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
    assert.deepEqual(cx.tells, [], `an agent whose move was ${outcome} was told it moved`);
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
  const run = automove.create({ file, nowMs: NOW });
  assert.ok(run.state.failed.has('/u/.claude-spare'), 'a target where a move did not work was forgotten by a restart');
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
  await run.tick(d, NOW + automove.REFUSED_HOLD_MS + 4000);
  assert.deepEqual(calls.starts.map((b) => b.names[0]), ['ada', 'bo', 'ada'], 'CONTROL: after the hour it is tried again');
});

test('#7548 rule 10: the watch is rebuilt from the record, a move that only started included; a line from the future is not trusted', () => {
  const file = fileFor();
  sweep.append(file, { kind: 'move', at: NOW - 60000, startedAt: NOW - 70000, agent: 'ada', from: '/u/.claude-work', to: '/u/.claude-spare', outcome: 'changed' });
  sweep.append(file, { kind: 'move', at: NOW - 50000, startedAt: NOW - 50000, agent: 'cy', from: '/u/.claude-work', to: '/u/.claude-spare', outcome: 'started' });
  sweep.append(file, { kind: 'move', at: NOW - 40000, startedAt: NOW - 45000, agent: 'bo', from: '/u/.claude-work', to: '/u/.claude-spare', outcome: 'started' });
  sweep.append(file, { kind: 'move', at: NOW - 30000, startedAt: NOW - 45000, agent: 'bo', from: '/u/.claude-work', to: '/u/.claude-spare', outcome: 'partial' });
  sweep.append(file, { kind: 'works', at: NOW + 10 * sweep.CLOCK_SLACK_MS, agent: 'zed', to: '/u/.claude-third', works: 'no' });
  const run = automove.create({ file, nowMs: NOW });
  assert.deepEqual(run.state.watching.map((w) => [w.agent, w.movedAt]).sort(), [['ada', NOW - 70000], ['bo', NOW - 45000], ['cy', NOW - 50000]],
    'the watch was lost by a restart (a partial move is watched too)');
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
  await twoTicks(run, d, NOW + automove.REST_MS + 20000);
  assert.equal(calls.starts.length, 2, 'CONTROL: after a day it may move again');
});

test('#7548 rule 7 (new): a person\'s move through the routes, with no move of Kosmos\'s before it, holds the agent a day', async () => {
  const file = fileFor();
  const run = automove.create({ file });
  const { d, calls } = deps();
  await run.tick(d, NOW);   // the first idle tick
  /* Between ticks, a person moves ada through Settings (the route writes its person line), then back. */
  assert.equal(automove.personMoved(file, ['ada'], '/u/.claude-third', NOW + 500), true);
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
  assert.equal(automove.personMoved(many, ['a', 'b', '', 7, 'c'], '/x', NOW), true);
  assert.deepEqual(lines(many).map((l) => l.agent), ['a', 'b', 'c']);
  assert.equal(automove.personMoved(fileFor(), [], '/x', NOW), true);
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
  /* Rule 7: both routes write the person line. */
  assert.equal((src.match(/automove\.personMoved\(AUTOBALANCE_RECORD,/g) || []).length, 2, 'a route does not write the person line');
});
