'use strict';
/* kosmos#7152 slice 2: which agents WOULD move off a Claude account that is running out, and where (engine/autobalance.js),
   and its setting (engine/autobalance-setting.js). Pure: rows in the /api/accounts shape, no files but the setting's. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ab = require('./autobalance');

const NOW = Date.parse('2026-10-25T22:00:00Z');
const H = 3600000;
const row = (dir, o = {}) => ({ provider: 'anthropic', dir, email: `${dir}@example.test`, memoryShared: true, apiKey: false,
  connection: { badge: 'working' }, weekly: { usedPct: 20, resetsAt: NOW + 72 * H, at: NOW - H }, fiveHour: null,
  agentsHere: { names: [] }, ...o });
const all = () => true;

test('#7152: agents on an account at 90% that does not reset soon would move to the emptiest measured account', () => {
  const rows = [
    row('/u/.claude-a', { weekly: { usedPct: 93, resetsAt: NOW + 35 * H }, agentsHere: { names: ['raph', 'leo'] } }),
    row('/u/.claude-b', { weekly: { usedPct: 40, resetsAt: NOW + 50 * H } }),
    row('/u/.claude-c', { weekly: { usedPct: 10, resetsAt: NOW + 100 * H } }),
  ];
  const d = ab.decide({ rows, movable: all, nowMs: NOW });
  assert.deepEqual(d.moves.map((m) => [m.agent, m.from, m.to]), [['leo', '/u/.claude-a', '/u/.claude-c'], ['raph', '/u/.claude-a', '/u/.claude-c']]);
  assert.match(d.moves[0].why, /93% of its weekly limit, which resets in 35 h/);
  rows[0].weekly.usedPct = 89;
  assert.deepEqual(ab.decide({ rows, movable: all, nowMs: NOW }).moves, [], 'CONTROL: at 89% nothing is at risk');
});

test('#7152: an account that resets within six hours is waited out, not left', () => {
  const rows = [
    row('/u/.claude-a', { weekly: { usedPct: 99, resetsAt: NOW + 5 * H }, agentsHere: { names: ['raph'] } }),
    row('/u/.claude-b', { weekly: { usedPct: 10, resetsAt: NOW + 50 * H } }),
  ];
  assert.deepEqual(ab.decide({ rows, movable: all, nowMs: NOW }).moves, [], 'an account resetting in 5 h was left');
  rows[0].weekly.resetsAt = NOW + 7 * H;
  assert.equal(ab.decide({ rows, movable: all, nowMs: NOW }).moves.length, 1, 'CONTROL: resetting in 7 h, it is left');
});

test('#7152: a login that has stopped working is at risk whatever its usage', () => {
  for (const badge of ['rejected', 'signed_out']) {
    const rows = [
      row('/u/.claude-a', { connection: { badge }, weekly: null, agentsHere: { names: ['raph'] } }),
      row('/u/.claude-b'),
    ];
    const d = ab.decide({ rows, movable: all, nowMs: NOW });
    assert.equal(d.moves.length, 1, `a ${badge} login kept its agents`);
    assert.match(d.moves[0].why, /login has stopped working/);
  }
});

test('#7152: an account that is not measured is never a target, however empty it looks', () => {
  const rows = [
    row('/u/.claude-a', { weekly: { usedPct: 95, resetsAt: NOW + 40 * H }, agentsHere: { names: ['raph'] } }),
    row('/u/.claude-b', { weekly: null }),
    row('/u/.claude-c', { weekly: { usedPct: 5, resetsAt: NOW - H } }),   // a week that has already reset
  ];
  const d = ab.decide({ rows, movable: all, nowMs: NOW });
  assert.deepEqual(d.moves, [], 'an unmeasured account was taken as headroom');
  assert.deepEqual(d.held, [{ from: '/u/.claude-a', why: d.held[0].why }], 'the page was not told nothing could take them');
  rows[1].weekly = { usedPct: 60, resetsAt: NOW + 10 * H };
  assert.equal(ab.decide({ rows, movable: all, nowMs: NOW }).moves[0].to, '/u/.claude-b', 'CONTROL: once measured, it is a target');
});

test('#7152: a target must be under 70%, with shared memory, signed in, and not an API key', () => {
  const from = () => row('/u/.claude-a', { weekly: { usedPct: 95, resetsAt: NOW + 40 * H }, agentsHere: { names: ['raph'] } });
  const cases = [
    ['at 70%', { weekly: { usedPct: 70, resetsAt: NOW + 40 * H } }],
    ['without shared memory', { memoryShared: false }],
    ['signed out', { connection: { badge: 'signed_out' } }],
    ['rejected', { connection: { badge: 'rejected' } }],
    ['an API key', { apiKey: true }],
    ['not offerable', { offerable: false }],
    ['at its five-hour limit', { fiveHour: { usedPct: 100, resetsAt: NOW + H } }],
  ];
  for (const [label, o] of cases) {
    const d = ab.decide({ rows: [from(), row('/u/.claude-b', o), row('/u/.claude-x', { apiKey: true })], movable: all, nowMs: NOW });
    assert.deepEqual(d.moves, [], `a target ${label} was chosen`);
  }
  assert.equal(ab.decide({ rows: [from(), row('/u/.claude-b', { weekly: { usedPct: 69, resetsAt: NOW + 40 * H } })], movable: all, nowMs: NOW }).moves.length, 1,
    'CONTROL: at 69% it is a target');
});

test('#7152: the same login in another folder is the same account, so it is never a target', () => {
  const rows = [
    row('/u/.claude', { email: 'Josh@example.test', organization: 'Org A', weekly: { usedPct: 95, resetsAt: NOW + 40 * H }, agentsHere: { names: ['raph'] } }),
    row('/u/.claude-d', { email: 'josh@example.test', organization: 'Org A', weekly: { usedPct: 10, resetsAt: NOW + 40 * H } }),
  ];
  assert.deepEqual(ab.decide({ rows, movable: all, nowMs: NOW }).moves, [], 'agents were moved to the account they are on');
  rows[1].organization = 'Org B';
  assert.equal(ab.decide({ rows, movable: all, nowMs: NOW }).moves.length, 1, 'CONTROL: another organization is another account');
});

test('#7152: ties go to the earlier reset, then the folder, so the answer is stable', () => {
  const rows = [
    row('/u/.claude-a', { weekly: { usedPct: 95, resetsAt: NOW + 40 * H }, agentsHere: { names: ['raph'] } }),
    row('/u/.claude-c', { weekly: { usedPct: 30, resetsAt: NOW + 80 * H } }),
    row('/u/.claude-b', { weekly: { usedPct: 30, resetsAt: NOW + 20 * H } }),
  ];
  assert.equal(ab.decide({ rows, movable: all, nowMs: NOW }).moves[0].to, '/u/.claude-b', 'the later reset won a tie');
  rows[2].weekly.resetsAt = NOW + 80 * H;
  assert.equal(ab.decide({ rows, movable: all, nowMs: NOW }).moves[0].to, '/u/.claude-b', 'a full tie was not settled by the folder');
});

test('#7152: only movable agents would move, and nothing with fewer than two accounts', () => {
  const rows = [
    row('/u/.claude-a', { weekly: { usedPct: 95, resetsAt: NOW + 40 * H }, agentsHere: { names: ['raph', 'leo'] } }),
    row('/u/.claude-b'),
  ];
  const d = ab.decide({ rows, movable: (n) => n === 'leo', nowMs: NOW });
  assert.deepEqual(d.moves.map((m) => m.agent), ['leo'], 'a busy agent was named to move');
  assert.deepEqual(ab.decide({ rows: [rows[0]], movable: all, nowMs: NOW }), { moves: [], held: [] }, 'one account did something');
  assert.deepEqual(ab.decide({ rows: [rows[0], row('/u/.claude-k', { apiKey: true })], movable: all, nowMs: NOW }), { moves: [], held: [] },
    'an API key counted as a second account (the decision ran, and said nothing could take them)');
});

test('#7152: the setting reads on when never set, off when unreadable, and saves a change', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autobalance-7152-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const saved = process.env.AGENT_WORKFORCE_DATA;
  process.env.AGENT_WORKFORCE_DATA = dir;
  t.after(() => { if (saved === undefined) delete process.env.AGENT_WORKFORCE_DATA; else process.env.AGENT_WORKFORCE_DATA = saved; });
  for (const k of Object.keys(require.cache)) if (/engine[\\/](store|autobalance-setting)\.js$/.test(k)) delete require.cache[k];
  const setting = require('./autobalance-setting');
  assert.ok(setting.FILE.startsWith(dir), 'CONTROL: the setting lives in the test folder');
  assert.deepEqual(setting.read(), { on: true, ok: true }, 'a person who never set it did not get it on');
  assert.equal(setting.write({ on: false }).ok, true);
  assert.deepEqual(setting.read(), { on: false, ok: true }, 'turning it off did not stick');
  fs.writeFileSync(setting.FILE, 'not json');
  assert.deepEqual(setting.read(), { on: false, ok: false }, 'an unreadable setting read on');
});

test('#7152 slice 2: the bulk-move target rule moved from the page unchanged (five-hour limit, a reading past its reset)', () => {
  const tgt = (o) => row('/u/.claude-t', { connection: { state: 'connected' }, weekly: null, ...o });
  assert.equal(ab.bulkTargetable(tgt({ fiveHour: { usedPct: 100, resetsAt: NOW + H } }), NOW), false, 'a target at its five-hour limit was offered');
  assert.equal(ab.bulkTargetable(tgt({ fiveHour: { usedPct: 99, resetsAt: NOW + H } }), NOW), true, 'CONTROL: at 99% it is offered');
  assert.equal(ab.bulkTargetable(tgt({ fiveHour: { usedPct: 100, resetsAt: NOW - 60000 } }), NOW), true, 'CONTROL: a five-hour reading past its reset is over');
  assert.equal(ab.bulkTargetable(tgt({ weekly: { usedPct: 100 } }), NOW), false, 'a full week with no reset time was offered (the page counted it)');
  assert.equal(ab.bulkTargetable(tgt({ weekly: { usedPct: 100, resetsAt: NOW - 60000 } }), NOW), true, 'CONTROL: a week that has reset is not full');
  assert.equal(ab.bulkTargetable(tgt({ connection: { state: 'none' } }), NOW), false, 'a badge-less row with no connection was offered');
  assert.equal(ab.bulkTargetable(tgt({ connection: undefined }), NOW), true, 'CONTROL: a row with no connection info is offered, as the page did');
});

test('#7152 slice 2: movable is the Assigner\'s own free test: idle, commitments free, no open part anywhere', () => {
  const card = (sessionName, o = {}) => ({ sessionName, isNamedOurs: true, state: 'idle', ...o });
  const task = (who, o = {}) => ({ id: 't1', parts: [{ who, title: 'x' }], ...o });
  const records = [{ id: 'p1', archived: true, tasks: [task('busy')] }];
  const rec = { clear: { state: 'clear' }, list: { state: 'unknown', commitments: ['a release'] } };
  const m = ab.movableFor({
    cards: [card('free'), card('busy'), card('working', { state: 'working' }), card('promised'), card('unread')],
    records,
    readCommitment: (s) => { if (s === 'unread') throw new Error('no'); return s === 'promised' ? rec.list : rec.clear; },
  });
  assert.equal(m('free'), true, 'CONTROL: an idle agent with nothing held is movable');
  assert.equal(m('busy'), false, 'an agent holding an open part (in an archived project) was movable');
  assert.equal(m('working'), false, 'a working agent was movable');
  assert.equal(m('promised'), false, 'an agent whose commitments name work was movable');
  assert.equal(m('unread'), false, 'an agent whose commitments could not be read was movable');
  assert.equal(m('absent'), false, 'an agent not on the board was movable');
});
