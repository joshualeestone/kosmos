'use strict';
/* kosmos#7152 slice 3: the auto-balance sweep's record (engine/autobalance-sweep.js) and the rule changes slice 3 brought
   to engine/autobalance.js. Every effect is a dep; the only file is the record, in a temp folder. Real board cards from
   test-support/fleet (fixture-discipline.test.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ab = require('./autobalance');
const sweep = require('./autobalance-sweep');
const fleet = require('../test-support/fleet');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-absweep-7152-'));
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
  const cards = o.cards || realCards(['ada']);
  return {
    list: () => o.list || LIST,
    readUsage: (dir) => (o.usage || USAGE)[dir] || null,
    agentsOn: o.agentsOn || ((dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true, moving: [] })),
    roster: () => cards,
    records: () => [],
    readCommitment: () => ({ state: 'clear' }),
    isGuide: () => false,
    guideName: () => null,
    settingOn: () => (o.settingOn === undefined ? true : o.settingOn),
    labelOf: (dir) => (LIST.find((a) => a.dir === dir) || {}).label || null,
  };
}

test('#7152 slice 3: a decision is recorded once per change, with labels, reason and kind, and no email', async () => {
  const file = fileFor();
  const run = sweep.create({ file });
  const d = deps();
  assert.equal((await run.tick(d, NOW)).did, 'recorded');
  assert.equal((await run.tick(d, NOW + 1000)).did, 'nothing', 'the same decision was recorded twice');
  const lines = sweep.readLines(file);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].moves.map((m) => [m.agent, m.fromLabel, m.toLabel, m.kind]), [['ada', 'work', 'spare', 'usage']]);
  assert.match(lines[0].moves[0].why, /^it is at 93% of its weekly limit/);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /@/, 'an email reached the record');
  /* CONTROL: a changed decision is recorded again, and a return to the first one too. */
  await run.tick(deps({ usage: { ...USAGE, '/u/.claude-work': reading(50, 35) } }), NOW + 2000);
  await run.tick(d, NOW + 3000);
  /* risk, the risk ending (review 10: written, as an empty decision), the risk again */
  assert.deepEqual(sweep.readLines(file).map((l) => l.moves.length), [1, 0, 1], 'a decision that came back after a change was not recorded');
});

test('#7152 slice 3: the sweep moves nothing: its module has no way to', () => {
  const src = fs.readFileSync(path.join(__dirname, 'autobalance-sweep.js'), 'utf8');
  for (const word of ['startMove', 'accountmove', 'setAccount', 'restart']) {
    assert.equal(new RegExp(`\\b${word}\\s*\\(`).test(src), false, `the record-only sweep calls ${word}()`);
  }
  assert.ok(/\bab\.decide\s*\(/.test(src), 'CONTROL: the pattern finds a call that is there');
});

test('#7152 slice 3: with the setting off nothing is recorded; with one account the agents are not even walked', async () => {
  const file = fileFor();
  assert.equal((await sweep.create({ file }).tick(deps({ settingOn: false }), NOW)).did, 'off');
  assert.deepEqual(sweep.readLines(file), []);
  let walks = 0;
  const one = deps({ list: [LIST[0], { dir: '/u/.claude-key', apiKey: true }], agentsOn: () => { walks += 1; return { names: [], complete: true }; } });
  assert.equal((await sweep.create({ file: fileFor() }).tick(one, NOW)).did, 'nothing');
  assert.equal(walks, 0, 'the agents were walked with one account');
});

test('#7152 slice 3: a decision whose line could not be written is written on a later tick, and the sweep says it failed', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'chmod does not stop root writing' : false }, async () => {
  const dir = path.join(TMP, `readonly-${++n}`);
  fs.mkdirSync(dir);
  const file = path.join(dir, 'record.jsonl');
  const run = sweep.create({ file });   // review 10: reading finds nothing yet (ENOENT), which is an empty record
  fs.chmodSync(dir, 0o555);   // now only the write fails
  try {
    const r = await run.tick(deps(), NOW);
    assert.deepEqual([r.did, r.because, run.state.writeFailed], ['nothing', 'write-failed', true], 'a failed write was not said');
  } finally { fs.chmodSync(dir, 0o755); }
  const again = await run.tick(deps(), NOW + 1000);
  assert.deepEqual([again.did, run.state.writeFailed], ['recorded', false], 'a decision whose write failed was never written');
  assert.equal(sweep.readLines(file).length, 1);
});

test('#7152 slice 3 review 10: the end of a risk is written, so a risk that comes back after a restart is recorded again', async () => {
  const file = fileFor();
  const risky = deps();
  const calm = deps({ usage: { ...USAGE, '/u/.claude-work': reading(40, 35) } });
  assert.equal((await sweep.create({ file }).tick(calm, NOW)).did, 'nothing', 'CONTROL: a first tick with nothing at risk writes nothing');
  assert.equal(sweep.readLines(file).length, 0);
  const run = sweep.create({ file });
  await run.tick(risky, NOW);
  assert.equal((await run.tick(calm, NOW + 1000)).did, 'cleared', 'the end of the risk was not written');
  await sweep.create({ file, nowMs: NOW + 2000 }).tick(risky, NOW + 2000);   // a restart, then the risk is back
  assert.equal(sweep.recent(file).length, 2, 'a risk that came back after a restart was not recorded');
});

test('#7152 slice 3 review 10: the sweep uses the board\'s own login rule when it is given one', () => {
  const asked = [];
  const rows = ab.rowsFromReadings({ list: LIST, nowMs: NOW, readUsage: (dir) => ({ ...USAGE[dir], email: 'w@example.test', org: 'org-b' }),
    agentsOn: () => ({ names: [], complete: true }), sameLogin: (rec, a) => { asked.push(a.dir); return rec.org === 'org-a'; } });
  assert.deepEqual(asked, LIST.map((a) => a.dir), 'the login rule was not asked');
  assert.equal(rows[0].weekly, null, 'a record the login rule refused was used');
  const rows2 = ab.rowsFromReadings({ list: LIST, nowMs: NOW, readUsage: (dir) => ({ ...USAGE[dir], email: 'x@example.test' }),
    agentsOn: () => ({ names: [], complete: true }), sameLogin: () => { throw new Error('unreadable'); } });
  assert.equal(rows2[0].weekly, null, 'a login rule that could not answer let the record through');
});
test('#7152 slice 3: a restart does not record the same decision again; a line from the future and odd lines are not trusted', async () => {
  const file = fileFor();
  const d = deps();
  await sweep.create({ file }).tick(d, NOW);
  await sweep.create({ file, nowMs: NOW + 1000 }).tick(d, NOW + 1000);
  assert.equal(sweep.readLines(file).length, 1, 'every board restart wrote the decision again');
  /* Review 9: the line naming today's decision, alone in its file and stamped in the future, must not stand in for it. */
  const same = { kind: 'decision', moves: [{ agent: 'ada', from: '/u/.claude-work', to: '/u/.claude-spare' }], held: [], atRisk: [{ from: '/u/.claude-work', kind: 'usage' }] };
  const f2 = fileFor();
  sweep.append(f2, { ...same, at: NOW + 10 * sweep.CLOCK_SLACK_MS });
  assert.equal((await sweep.create({ file: f2, nowMs: NOW }).tick(d, NOW)).did, 'recorded', 'a line stamped in the future stood in for the last decision');
  const f3 = fileFor();
  sweep.append(f3, { ...same, at: NOW - 1000 });
  assert.equal((await sweep.create({ file: f3, nowMs: NOW }).tick(d, NOW)).did, 'nothing', 'CONTROL: the same line, stamped in the past, is the last decision');
  const f4 = fileFor();
  sweep.append(f4, { kind: 'decision', at: NOW - 1000, moves: [null, 7], held: [null], atRisk: [null] });
  assert.doesNotThrow(() => sweep.create({ file: f4, nowMs: NOW }), 'an odd line stopped the board starting');
});

test('#7152 slice 3 review 9: a record that cannot be read is not taken for an empty one, and is never written over', () => {
  const dir = path.join(TMP, `unreadable-${++n}`);
  fs.mkdirSync(dir);   // a folder where the record should be: reading it fails with something other than "not there"
  assert.throws(() => sweep.create({ file: dir }), 'a record that could not be read was taken for an empty one');
  assert.equal(sweep.append(dir, { kind: 'decision', at: NOW, moves: [] }), false, 'a write went ahead over a record it could not read');
  assert.ok(fs.statSync(dir).isDirectory(), 'CONTROL: what was there is untouched');
  assert.doesNotThrow(() => sweep.create({ file: path.join(TMP, 'never-written.jsonl') }), 'CONTROL: a record not written yet is an empty one');
});

test('#7152 slice 3: recent is newest first, keeps only decisions with a move, and the record keeps its newest lines', () => {
  const file = fileFor();
  fs.writeFileSync(file, 'not json\n');
  for (let i = 0; i < sweep.KEEP_LINES + 3; i += 1) sweep.append(file, { kind: 'decision', at: i, moves: i % 2 ? [{ agent: 'ada' }] : [], held: [], atRisk: [] });
  const lines = sweep.readLines(file);
  assert.equal(lines.length, sweep.KEEP_LINES);
  assert.equal(lines[0].at, 3);
  assert.deepEqual(sweep.recent(file, 2).map((l) => l.at), [sweep.KEEP_LINES + 1, sweep.KEEP_LINES - 1], 'recent is not newest first, or counted a decision with no move');
});

test('#7152 slice 3: rows from the cheap readings: a working usage call is signed in, only a 401 or 403 is a stopped login', () => {
  const more = ['x', 'r', 'p', 'rate', 'unread', 'other'].map((k) => ({ dir: `/u/.claude-${k}`, label: k }));
  const recs = { '/u/.claude-x': { at: NOW, state: 'no-credential' }, '/u/.claude-r': { at: NOW, state: 'http-401', weekly: { usedPct: 5, resetsAt: S(NOW + H) } },
    '/u/.claude-p': { at: NOW, state: 'profile-http-403' }, '/u/.claude-rate': { at: NOW, state: 'http-429' },
    '/u/.claude-unread': { at: NOW, state: 'unreadable-response' }, '/u/.claude-other': { at: NOW, state: 'other-account' } };
  const rows = ab.rowsFromReadings({ list: [...LIST, { dir: '/u/.claude-key', apiKey: true }, ...more],
    readUsage: (dir) => recs[dir] || USAGE[dir] || null, agentsOn: () => ({ names: [], complete: true }), nowMs: NOW });
  const by = Object.fromEntries(rows.map((r) => [r.dir, r]));
  assert.equal(by['/u/.claude-key'], undefined, 'an API key became a row');
  assert.equal(by['/u/.claude-work'].connection.badge, 'working');
  assert.equal(by['/u/.claude-work'].weekly.resetsAt, S(NOW + 35 * H) * 1000, 'the reset was not turned into ms');
  assert.equal(by['/u/.claude-x'].connection.badge, null, 'a record that is neither a reading nor a refusal claimed a login state');
  assert.equal(by['/u/.claude-r'].connection.badge, 'rejected');
  assert.equal(by['/u/.claude-p'].connection.badge, 'rejected', 'a refused profile call is the same token refused');
  assert.equal(by['/u/.claude-r'].weekly.usedPct, 5, 'a fresh figure kept through a refused read was dropped (review 9)');
  for (const k of ['rate', 'unread', 'other']) assert.equal(by[`/u/.claude-${k}`].connection.badge, null, `a ${recs[`/u/.claude-${k}`].state} read as a stopped login`);
  const d = ab.decide({ rows: ab.rowsFromReadings({ list: LIST, nowMs: NOW, agentsOn: (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true }),
    readUsage: (dir) => (dir === '/u/.claude-work' ? { at: NOW, state: 'http-429' } : USAGE[dir]) }), movable: () => true, nowMs: NOW });
  assert.deepEqual([d.atRisk, d.moves], [[], []], 'the usage endpoint\'s own rate limit named a working account at risk');
});

test('#7152 slice 3: a target well into its five-hour window is not a target', () => {
  const rows = ab.rowsFromReadings({ list: LIST, nowMs: NOW,
    readUsage: (dir) => (dir === '/u/.claude-spare' ? reading(10, 100, { fiveHour: { usedPct: 90, resetsAt: S(NOW + 2 * H) } }) : USAGE[dir]),
    agentsOn: (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true }) });
  assert.deepEqual(ab.decide({ rows, movable: () => true, nowMs: NOW }).moves, [], 'agents were named for an account at 90% of its five hours');
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
  /* Review 10: read once, so a guide record that cannot be read makes the decision unreadable, not every agent "not idle". */
  assert.throws(() => ab.movableFor({ ...base, isGuide: () => false, guideName: () => { throw new Error('x'); } }), /x/, 'a guide name that could not be read was swallowed');
  assert.equal('unsentInput' in ada, true, 'CONTROL: a real card carries unsentInput');
  const waiting = { ...ada, unsentInput: { since: new Date(NOW).toISOString() } };
  assert.equal(ab.movableFor({ ...base, cards: [waiting], isGuide: () => false, guideName: () => null })('ada'), false, 'an agent with unsent words in its box was movable');
});

test('#7152 slice 3 review 9: figures are kept through a failed read; a record for another login is ignored', () => {
  const blip = { at: NOW, measuredAt: NOW - 60000, state: 'unreachable', email: 'w@example.test', weekly: { usedPct: 95, resetsAt: S(NOW + 40 * H) }, fiveHour: null };
  const rows = ab.rowsFromReadings({ list: LIST, nowMs: NOW, readUsage: (dir) => (dir === '/u/.claude-work' ? blip : USAGE[dir]),
    agentsOn: (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true }) });
  const d = ab.decide({ rows, movable: () => true, nowMs: NOW });
  assert.deepEqual(d.atRisk.map((x) => x.from), ['/u/.claude-work'], 'one network blip took a 95% account off the at-risk list');
  assert.equal(rows[0].connection.badge, 'working', 'a fresh measurement through a blip was not signed in (review 12)');
  const other = ab.rowsFromReadings({ list: LIST, nowMs: NOW, readUsage: (dir) => (dir === '/u/.claude-work' ? { ...reading(95, 40), email: 'someone-else@example.test' } : USAGE[dir]),
    agentsOn: () => ({ names: [], complete: true }) });
  assert.equal(other[0].weekly, null, 'another login\'s figure was put on this account');
  assert.equal(other[0].connection.badge, null);
});

test('#7152 slice 3 review 9: a five-hour reading with no reset time still keeps a full target out', () => {
  const rows = ab.rowsFromReadings({ list: LIST, nowMs: NOW,
    readUsage: (dir) => (dir === '/u/.claude-spare' ? { ...reading(10, 100), fiveHour: { usedPct: 99, resetsAt: null } } : USAGE[dir]),
    agentsOn: (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true }) });
  assert.equal(rows[1].fiveHour.resetsAt, null, 'CONTROL: the reading has no reset time');
  assert.deepEqual(ab.decide({ rows, movable: () => true, nowMs: NOW }).moves, [], 'a 99% five-hour window with no reset time was a target');
});

test('#7152 slice 3 review 10: Settings is not handed a record line stamped in the future', () => {
  const file = fileFor();
  sweep.append(file, { kind: 'decision', at: NOW - 1000, moves: [{ agent: 'ada' }], held: [], atRisk: [] });
  sweep.append(file, { kind: 'decision', at: Date.now() + 10 * sweep.CLOCK_SLACK_MS, moves: [{ agent: 'bo' }], held: [], atRisk: [] });
  assert.deepEqual(sweep.recent(file).map((l) => l.moves[0].agent), ['ada'], 'a line from the future reached Settings as the newest');
});

test('#7152 slice 3 review 12: one blip on the target does not flip the decision, and a refused login still stops it', () => {
  const at = (spareRec) => ab.decide({ rows: ab.rowsFromReadings({ list: LIST, nowMs: NOW,
    readUsage: (dir) => (dir === '/u/.claude-spare' ? spareRec : USAGE[dir]),
    agentsOn: (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true }) }), movable: () => true, nowMs: NOW });
  for (const state of ['unreachable', 'http-429', 'token-expired']) {
    assert.equal(at({ ...reading(10, 100), state }).moves.length, 1, `a fresh target read as gone on one ${state}`);
  }
  assert.equal(at({ ...reading(10, 100), state: 'http-401' }).moves.length, 0, 'a target whose login was refused stayed a target');
  assert.equal(at({ at: NOW, state: 'unreachable' }).moves.length, 0, 'CONTROL: a target with no fresh measurement is not one');
});

test('#7152 slice 3 review 12: a would-move off a stopped login is kept in the record but not drawn as one', () => {
  const file = fileFor();
  sweep.append(file, { kind: 'decision', at: NOW - 2000, moves: [{ agent: 'ada', kind: 'usage' }], held: [], atRisk: [] });
  sweep.append(file, { kind: 'decision', at: NOW - 1000, moves: [{ agent: 'bo', kind: 'login' }], held: [], atRisk: [] });
  assert.deepEqual(sweep.recent(file).map((l) => l.moves[0].agent), ['ada'], 'a move slice 3b will never make reached Settings');
  assert.equal(sweep.readLines(file).length, 2, 'CONTROL: it is kept in the file');
});

test('#7152 slice 3 review 14: only a blip keeps a target signed in; a signed-out account with old figures is not a target', () => {
  const at = (spareRec) => ab.decide({ rows: ab.rowsFromReadings({ list: LIST, nowMs: NOW,
    readUsage: (dir) => (dir === '/u/.claude-spare' ? spareRec : USAGE[dir]),
    agentsOn: (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true }) }), movable: () => true, nowMs: NOW });
  for (const state of ['no-credential', 'no-token', 'other-account', 'identity-unknown', 'profile-unreadable', 'unreadable-response']) {
    assert.equal(at({ ...reading(10, 100), state }).moves.length, 0, `a target whose latest read was ${state} was still a target`);
  }
  for (const state of ['http-503', 'profile-http-502', 'profile-unreachable']) {
    assert.equal(at({ ...reading(10, 100), state }).moves.length, 1, `CONTROL: ${state} is a blip`);
  }
});

test('#7152 slice 3 review 14, 16: an at-risk account that goes unmeasured is a gap, not the end of the risk', async () => {
  const file = fileFor();
  const run = sweep.create({ file });
  await run.tick(deps(), NOW);
  /* The shape slice 1 really writes on a failed read: a fresh record whose figures have aged out (review 16). */
  const aged = { at: NOW, measuredAt: NOW - 31 * 60e3, state: 'token-expired', weekly: null, fiveHour: null };
  const gap = deps({ usage: { ...USAGE, '/u/.claude-work': aged } });
  assert.equal((await run.tick(gap, NOW + 1000)).did, 'nothing', 'a gap in the readings was taken for a change');
  assert.equal(sweep.readLines(file).length, 1, 'a gap in the readings was written as the risk ending');
  assert.equal((await run.tick(deps({ usage: { ...USAGE, '/u/.claude-work': null } }), NOW + 1500)).did, 'nothing', 'no record at all was taken for the end of the risk');
  assert.equal((await run.tick(deps(), NOW + 2000)).did, 'nothing', 'the same risk, measured again, was written again');
  assert.equal((await sweep.create({ file, nowMs: NOW + 3000 }).tick(gap, NOW + 3000)).did, 'nothing', 'a restart forgot which account was at risk');
  /* CONTROL: an account measured again below the line does end the risk. */
  assert.equal((await run.tick(deps({ usage: { ...USAGE, '/u/.claude-work': reading(40, 35) } }), NOW + 4000)).did, 'cleared');
});

test('#7152 slice 3 review 16: during one account\'s gap, a change on another account is still written, and says which was carried', async () => {
  const list3 = [...LIST, { dir: '/u/.claude-third', label: 'third', email: 't@example.test', memoryShared: true, apiKey: false }];
  const usage = { ...USAGE, '/u/.claude-third': reading(20, 100) };
  const agentsOn = (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : dir === '/u/.claude-third' ? ['bo'] : [], complete: true, moving: [] });
  const cards = realCards(['ada'], ['bo']);
  const file = fileFor();
  const run = sweep.create({ file });
  await run.tick(deps({ list: list3, usage, agentsOn, cards }), NOW);
  const aged = { at: NOW, measuredAt: NOW - 31 * 60e3, state: 'token-expired', weekly: null, fiveHour: null };
  const later = deps({ list: list3, agentsOn, cards, usage: { ...usage, '/u/.claude-work': aged, '/u/.claude-third': reading(95, 40) } });
  assert.equal((await run.tick(later, NOW + 1000)).did, 'recorded', 'a change on another account went unrecorded during a gap');
  const line = sweep.readLines(file).pop();
  assert.deepEqual(line.unmeasured, ['/u/.claude-work'], 'the line did not say which account was carried');
  assert.deepEqual(line.atRisk.map((x) => x.from).sort(), ['/u/.claude-third', '/u/.claude-work'], 'the unmeasured account\'s risk ended in the record');
});

test('#7152 slice 3 review 16: a folder with no credential at all is signed out, so its stopped login stays at risk', () => {
  const rows = ab.rowsFromReadings({ list: LIST, nowMs: NOW, readUsage: (dir) => (dir === '/u/.claude-work' ? { at: NOW, state: 'no-credential' } : USAGE[dir]),
    agentsOn: (dir) => ({ names: dir === '/u/.claude-work' ? ['ada'] : [], complete: true }) });
  assert.equal(rows[0].connection.badge, 'signed_out');
  assert.equal(rows[0].measured, true, 'CONTROL: a signed-out folder is a reading of its login');
  assert.deepEqual(ab.decide({ rows, movable: () => true, nowMs: NOW }).atRisk.map((x) => x.kind), ['login'], 'a signed-out folder was not at risk by login');
});
