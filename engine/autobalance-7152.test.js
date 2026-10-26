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
const row = (dir, o = {}) => {
  const r = { provider: 'anthropic', dir, email: `${dir}@example.test`, memoryShared: true, apiKey: false,
    connection: { badge: 'working' }, weekly: { usedPct: 20, resetsAt: NOW + 72 * H, at: NOW - H }, fiveHour: null,
    agentsHere: { names: [], complete: true }, ...o };
  if (r.agentsHere && r.agentsHere.complete === undefined) r.agentsHere = { ...r.agentsHere, complete: true };   // a list is whole unless a test says not
  return r;
};
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
  /* Review 1: the earlier reset is on the folder that sorts LATER, so the reset rule and the folder rule disagree. */
  const rows = [
    row('/u/.claude-a', { weekly: { usedPct: 95, resetsAt: NOW + 40 * H }, agentsHere: { names: ['raph'] } }),
    row('/u/.claude-b', { weekly: { usedPct: 30, resetsAt: NOW + 80 * H } }),
    row('/u/.claude-c', { weekly: { usedPct: 30, resetsAt: NOW + 20 * H } }),
  ];
  assert.equal(ab.decide({ rows, movable: all, nowMs: NOW }).moves[0].to, '/u/.claude-c', 'the later reset won a tie');
  rows[2].weekly.resetsAt = NOW + 80 * H;
  /* The folder that should win is listed LAST, so an order-keeping sort without the folder rule gets it wrong. */
  assert.equal(ab.decide({ rows: [rows[0], rows[2], rows[1]], movable: all, nowMs: NOW }).moves[0].to, '/u/.claude-b', 'a full tie was not settled by the folder');
});

test('#7152 review 1: an automatic target must be positively signed in; the page\'s bulk move still offers an unchecked one', () => {
  const from = row('/u/.claude-a', { weekly: { usedPct: 95, resetsAt: NOW + 40 * H }, agentsHere: { names: ['raph'] } });
  const unchecked = row('/u/.claude-b', { connection: { badge: 'unchecked' } });
  assert.deepEqual(ab.decide({ rows: [from, unchecked], movable: all, nowMs: NOW }).moves, [], 'agents would move onto a login nobody has checked');
  assert.equal(ab.bulkTargetable(unchecked, NOW), true, 'CONTROL: the page still offers it, labelled, as before');
  const unverified = row('/u/.claude-b', { connection: { badge: 'signed_in_unverified' } });
  assert.equal(ab.decide({ rows: [from, unverified], movable: all, nowMs: NOW }).moves.length, 1, 'CONTROL: a signed-in login is a target');
});

test('#7152 review 1: an at-risk account whose agent list may be short is named, so "nothing to move" is not the whole truth', () => {
  const rows = [
    row('/u/.claude-a', { weekly: { usedPct: 95, resetsAt: NOW + 40 * H }, agentsHere: { names: [], complete: false } }),
    row('/u/.claude-b'),
  ];
  assert.deepEqual(ab.decide({ rows, movable: all, nowMs: NOW }).short, ['/u/.claude-a'], 'a short list read as the whole list');
  rows[0].agentsHere.complete = true;
  assert.deepEqual(ab.decide({ rows, movable: all, nowMs: NOW }).short, [], 'CONTROL: a whole list is not named');
  rows[0].weekly.usedPct = 50;
  rows[0].agentsHere.complete = false;
  assert.deepEqual(ab.decide({ rows, movable: all, nowMs: NOW }).short, [], 'CONTROL: an account not at risk is not named');
});

test('#7152 review 1: every row the route sends carries the engine\'s answer, and a row that throws is not a target', () => {
  const rows = [row('/u/.claude-a'), row('/u/.claude-b', { memoryShared: false })];
  const bad = { get provider() { throw new Error('boom'); } };
  ab.markTargets([...rows, bad], NOW);
  assert.equal(rows[0].bulkTargetable, true);
  assert.equal(rows[1].bulkTargetable, false, 'CONTROL: a row the rule refuses says so');
  assert.equal(bad.bulkTargetable, false, 'a row that could not be read was left without an answer');
});

test('#7152 review 1: the route marks every Claude row and reads the switch before the decision can fail', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('ab.markTargets(claude, sentAt);');   // review 2: the clock as the answer is sent (review 3: one clock)
  assert.ok(at > 0, 'the route does not mark its Claude rows');
  assert.match(src.slice(Math.max(0, at - 400), at), /const sentAt = Date\.now\(\);/, 'the marks are not stamped with the clock as the answer is sent');
  const block = src.slice(at, src.indexOf('sendJson(res, 200, { accounts: [...claude', at));
  assert.match(block, /ab\.decide\(\{ rows: claude, movable, nowMs: sentAt \}\)/, 'the decision does not use the same clock as the marks');
  assert.ok(block.length > 0, 'CONTROL: the block is found whole');
  const read = block.indexOf('setting = autobalanceSetting.read()');
  const guarded = block.indexOf('try {', block.indexOf('const eligibleCount'));
  assert.ok(read > 0 && guarded > read, 'the switch is read inside the guarded decision, so a failure hides the row');
});

test('#7152: only movable agents would move, and nothing with fewer than two accounts', () => {
  const rows = [
    row('/u/.claude-a', { weekly: { usedPct: 95, resetsAt: NOW + 40 * H }, agentsHere: { names: ['raph', 'leo'] } }),
    row('/u/.claude-b'),
  ];
  const d = ab.decide({ rows, movable: (n) => n === 'leo', nowMs: NOW });
  assert.deepEqual(d.moves.map((m) => m.agent), ['leo'], 'a busy agent was named to move');
  assert.deepEqual(ab.decide({ rows: [rows[0]], movable: all, nowMs: NOW }), { moves: [], held: [], short: [], atRisk: [] }, 'one account did something');
  assert.deepEqual(ab.decide({ rows: [rows[0], row('/u/.claude-k', { apiKey: true })], movable: all, nowMs: NOW }), { moves: [], held: [], short: [], atRisk: [] },
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

test('#7152 review 2: a guide is never movable, and an agent already being moved is not named again', () => {
  const m = ab.movableFor({ cards: [{ sessionName: 'guide', isNamedOurs: true, state: 'idle', isGuide: true }, { sessionName: 'ada', isNamedOurs: true, state: 'idle' }],
    records: [], readCommitment: () => ({ state: 'clear' }) });
  assert.equal(m('guide'), false, 'the setup guide was movable');
  assert.equal(m('ada'), true, 'CONTROL: an ordinary idle agent is');
  const rows = [
    row('/u/.claude-a', { weekly: { usedPct: 95, resetsAt: NOW + 40 * H }, agentsHere: { names: ['ada', 'bo'], complete: true, moving: ['bo'] } }),
    row('/u/.claude-b'),
  ];
  assert.deepEqual(ab.decide({ rows, movable: all, nowMs: NOW }).moves.map((x) => x.agent), ['ada'], 'an agent mid-move was named again');
});

test('#7152 review 3: every at-risk account is named, even with no idle agent, and the projects are read only when needed', () => {
  const rows = [
    row('/u/.claude-a', { weekly: { usedPct: 95, resetsAt: NOW + 40 * H }, agentsHere: { names: ['ada'], complete: true } }),
    row('/u/.claude-b'),
  ];
  const d = ab.decide({ rows, movable: () => false, nowMs: NOW });
  assert.deepEqual(d.atRisk.map((x) => x.from), ['/u/.claude-a'], 'an at-risk account with no idle agent was silent');
  assert.deepEqual(d.moves, []);
  rows[0].weekly.usedPct = 50;
  assert.deepEqual(ab.decide({ rows, movable: () => false, nowMs: NOW }).atRisk, [], 'CONTROL: an account not at risk is not named');
  let reads = 0;
  const m = ab.movableFor({ cards: [{ sessionName: 'ada', isNamedOurs: true, state: 'idle' }], records: () => { reads += 1; return []; }, readCommitment: () => ({ state: 'clear' }) });
  assert.equal(reads, 0, 'the projects were read before anyone was asked about');
  assert.equal(m('ada'), true);
  assert.equal(reads, 1, 'CONTROL: asking about an agent reads them');
});

test('#7152 review 3: a roster that could not be read is refused, not taken as an empty one', () => {
  assert.throws(() => ab.movableFor({ cards: null, records: [], readCommitment: () => null }), /roster could not be read/, 'an unreadable roster read as nobody to move');
  assert.doesNotThrow(() => ab.movableFor({ cards: [], records: [], readCommitment: () => null }), 'CONTROL: an empty roster is fine');
});
