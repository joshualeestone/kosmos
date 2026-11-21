'use strict';
/* kosmos#8862: a model's own weekly limit can be full while the account's overall one is not. The usage reader keeps
   those limits and the decision judges each agent by its own model, both for being at risk and for a target. The
   answer below is the one Splinter's probe read for account c on 2026-11-21 (overall 55%, Fable 100%). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ab = require('./autobalance');
const usagepoll = require('./usagepoll');

const NOW = Date.parse('2026-11-21T04:45:43Z');
const H = 3600000;
const RESETS = '2026-11-22T21:59:59.823722+00:00';
const REAL_LIMITS = [
  { kind: 'weekly_all', group: 'weekly', percent: 55, severity: 'normal', resets_at: '2026-11-22T21:59:59.823627+00:00', scope: null, is_active: false },
  { kind: 'weekly_scoped', group: 'weekly', percent: 100, severity: 'critical', resets_at: RESETS,
    scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: true },
];

test('kosmos#8862: the reader keeps each model weekly limit from the real answer, and nothing else', () => {
  const s = usagepoll.scopedOf({ limits: REAL_LIMITS }, NOW);
  assert.deepEqual(s, [{ model: 'Fable', usedPct: 100, resetsAt: Math.floor(Date.parse(RESETS) / 1000) }], 'the Fable limit was not read as the endpoint gave it');   // windowOf floors to the second
  assert.deepEqual(usagepoll.scopedOf({ seven_day: { utilization: 5 } }, NOW), [], 'an answer with no limits list (today\'s older shape) gave limits');
  assert.deepEqual(usagepoll.scopedOf({ limits: [REAL_LIMITS[0]] }, NOW), [], 'the overall weekly_all entry was taken for a model limit');
  const noName = { ...REAL_LIMITS[1], scope: { model: { id: 'x', display_name: '' }, surface: null } };
  assert.deepEqual(usagepoll.scopedOf({ limits: [noName] }, NOW), [], 'a model with no name was kept');
  const surface = { ...REAL_LIMITS[1], scope: { model: null, surface: 'web' } };
  assert.deepEqual(usagepoll.scopedOf({ limits: [surface] }, NOW), [], 'a surface scope was taken for a model');
  assert.deepEqual(usagepoll.scopedOf({ limits: 'nonsense' }, NOW), []);
  assert.deepEqual(usagepoll.scopedOf(null, NOW), []);
});

test('kosmos#8862: a record carries its model limits to readUsage, which ages them out with the rest', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-8862-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const resetsAt = Math.round(Date.parse(RESETS) / 1000);
  usagepoll.write(d, { at: NOW, measuredAt: NOW, state: 'ok', email: 'c@example.test', weekly: { usedPct: 55, resetsAt, changedAt: NOW }, fiveHour: null,
    scoped: [{ model: 'Fable', usedPct: 100, resetsAt }] });
  assert.deepEqual(usagepoll.readUsage(d, NOW + 1000).scoped, [{ model: 'Fable', usedPct: 100, resetsAt }], 'readUsage dropped the model limit');
  assert.deepEqual(usagepoll.readUsage(d, NOW + usagepoll.FRESH_MS + 1000), null, 'CONTROL: a stale record is no reading at all');
  assert.deepEqual(usagepoll.readUsage(d, (resetsAt + 60) * 1000 - usagepoll.FRESH_MS + 1000), null);
  usagepoll.write(d, { at: NOW, measuredAt: NOW, state: 'ok', email: 'c@example.test', weekly: { usedPct: 55, resetsAt, changedAt: NOW }, fiveHour: null,
    scoped: [{ model: 'Fable', usedPct: 100, resetsAt: Math.round((NOW - H) / 1000) }] });
  assert.deepEqual(usagepoll.readUsage(d, NOW + 1000).scoped, [], 'a model limit whose reset has passed was still read');
});

test('kosmos#8862: a reading kept through a failed read keeps its model limits', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-8862-keep-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const resetsAt = Math.round(Date.parse(RESETS) / 1000);
  usagepoll.write(d, { at: NOW - 60000, measuredAt: NOW - 60000, state: 'ok', email: 'c@example.test', weekly: { usedPct: 55, resetsAt, changedAt: NOW - 60000 }, fiveHour: null,
    scoped: [{ model: 'Fable', usedPct: 100, resetsAt }] });
  const { EventEmitter } = require('node:events');
  const request = (opts, cb) => {   // https.request's shape: a 503, which is no reading and keeps the last good one
    const req = new EventEmitter(); req.destroy = () => {};
    req.end = () => setImmediate(() => { const res = new EventEmitter(); res.statusCode = 503; res.setEncoding = () => {}; cb(res); res.emit('data', ''); res.emit('end'); });
    return req;
  };
  await usagepoll.pollAll([{ dir: d, email: 'c@example.test' }], { now: NOW, platform: 'darwin', realHome: '/', identityOf: () => null,
    readCred: async () => JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: NOW + 10 * H } }), request });
  const rec = JSON.parse(fs.readFileSync(path.join(d, usagepoll.FILE), 'utf8'));
  assert.equal(rec.state, 'http-503', 'CONTROL: the read failed');
  assert.deepEqual(rec.scoped, [{ model: 'Fable', usedPct: 100, resetsAt }], 'a failed read dropped the model limit the kept figures were read with');
});

const row = (dir, o = {}) => ({ provider: 'anthropic', dir, email: `${dir}@example.test`, memoryShared: true, apiKey: false,
  connection: { badge: 'working' }, weekly: { usedPct: 20, resetsAt: NOW + 72 * H, at: NOW - H }, fiveHour: null,
  agentsHere: { names: [], complete: true }, scoped: [], ...o });
const fable = (pct) => [{ model: 'Fable', usedPct: pct, resetsAt: NOW + 41 * H }];
const all = () => true;

test('kosmos#8862: an agent on a model whose own limit is full there is at risk, and moves where its model has room', () => {
  const MODELS = { lyra: 'Fable 5.2', otto: 'Opus 5.5' };
  const rows = [
    row('/u/.claude-c', { weekly: { usedPct: 55, resetsAt: NOW + 41 * H }, scoped: fable(100), agentsHere: { names: ['lyra', 'otto'], complete: true } }),
    row('/u/.claude-d', { weekly: { usedPct: 10, resetsAt: NOW + 90 * H }, scoped: fable(90) }),   // the emptiest overall, but Fable is near full
    row('/u/.claude-e', { weekly: { usedPct: 30, resetsAt: NOW + 90 * H }, scoped: fable(5) }),
  ];
  const d = ab.decide({ rows, movable: all, nowMs: NOW, modelOf: (n) => MODELS[n] || null });
  assert.deepEqual(d.moves.map((m) => [m.agent, m.to]), [['lyra', '/u/.claude-e']],
    'the Fable agent was not moved off a full Fable limit, or was moved onto one (d), or the Opus agent was moved off an account with room for it');
  assert.match(d.moves[0].why, /its Fable limit is at 100% of the week, which resets in 41 h/);
  assert.deepEqual(d.atRisk.map((x) => [x.from, x.kind]), [['/u/.claude-c', 'usage']], 'the account was not named at risk for its full model limit');
  const without = ab.decide({ rows, movable: all, nowMs: NOW });
  assert.deepEqual(without.moves, [], 'CONTROL: with no models known, nothing is at risk at 55% overall (the old rule)');
});

test('kosmos#8862: an agent leaving an account at risk overall goes only where its own model has room; an unknown model avoids any full model limit', () => {
  const MODELS = { lyra: 'Fable 5.2', otto: 'Opus 5.5' };
  const rows = [
    row('/u/.claude-a', { weekly: { usedPct: 95, resetsAt: NOW + 50 * H }, agentsHere: { names: ['lyra', 'otto', 'nemo'], complete: true } }),
    row('/u/.claude-c', { weekly: { usedPct: 15, resetsAt: NOW + 41 * H }, scoped: fable(100) }),   // the emptiest, with Fable full
    row('/u/.claude-e', { weekly: { usedPct: 40, resetsAt: NOW + 90 * H }, scoped: [] }),
  ];
  const d = ab.decide({ rows, movable: all, nowMs: NOW, modelOf: (n) => MODELS[n] || null });
  assert.deepEqual(d.moves.map((m) => [m.agent, m.to]), [['lyra', '/u/.claude-e'], ['nemo', '/u/.claude-e'], ['otto', '/u/.claude-c']],
    'a Fable agent was sent to a full Fable limit, an unknown-model agent was risked on one, or the Opus agent was not given the emptiest account');
  const onlyFull = ab.decide({ rows: rows.filter((r) => r.dir !== '/u/.claude-e'), movable: all, nowMs: NOW, modelOf: (n) => MODELS[n] || null });
  assert.deepEqual(onlyFull.moves.map((m) => m.agent), ['otto'], 'with the only target full for Fable, the Fable agent was moved anyway');
  assert.deepEqual(onlyFull.held.map((h) => h.from), ['/u/.claude-a'], 'the agents with nowhere to go were not said as held');
});

test('kosmos#8862: models are matched by family, and a full limit that resets soon is waited out', () => {
  assert.equal(ab.modelKey('Fable 5.2'), 'fable');
  assert.equal(ab.modelKey('fable'), 'fable');
  assert.equal(ab.modelKey('claude-fable-5-2'), 'fable', 'a card holding the model id did not match its family');
  assert.equal(ab.modelKey('claude-opus-4-8-20251001'), 'opus');
  assert.equal(ab.modelKey('Opus 5.5'), 'opus');
  assert.notEqual(ab.modelKey('claude-opus-5-5'), ab.modelKey('Fable'), 'CONTROL: two families stay apart');
  assert.equal(ab.modelKey('  '), null);
  assert.equal(ab.modelKey(null), null);
  const c = row('/u/.claude-c', { scoped: fable(100) });
  assert.match(ab.modelRiskOf(c, 'Fable 5.2', NOW), /Fable limit is at 100%/);
  assert.equal(ab.modelRiskOf(c, 'Opus 5.5', NOW), null, 'another model was put at risk by the Fable limit');
  assert.equal(ab.modelRiskOf(c, null, NOW), null, 'an unknown model was put at risk');
  const soon = row('/u/.claude-c', { scoped: [{ model: 'Fable', usedPct: 100, resetsAt: NOW + 2 * H }] });
  assert.equal(ab.modelRiskOf(soon, 'Fable 5.2', NOW), null, 'a model limit resetting within six hours was not waited out, as the overall one is');
  assert.equal(ab.modelRoomOn(c, 'Opus 5.5', NOW), true);
  assert.equal(ab.modelRoomOn(c, 'Fable 5.2', NOW), false);
  assert.equal(ab.modelRoomOn(c, null, NOW), false, 'an unknown model was sent to an account with a full model limit');
  assert.equal(ab.modelRoomOn(row('/u/x'), null, NOW), true, 'CONTROL: an unknown model can go where no model limit is full');
});

test('kosmos#8862: the model lookup reads the card as the board shows it, and the roster only once', () => {
  let reads = 0;
  const of = ab.modelOfFrom(() => { reads += 1; return [{ sessionName: 'lyra', modelName: 'Fable 5.2', model: 'claude-fable-5-2' }, { sessionName: 'otto', modelName: null, model: 'Opus 5.5' }, { sessionName: 'nemo' }]; });
  assert.equal(of('lyra'), 'Fable 5.2');
  assert.equal(of('otto'), 'Opus 5.5', 'a card with no modelName did not fall back to model');
  assert.equal(of('nemo'), null);
  assert.equal(of('ghost'), null);
  assert.equal(reads, 1, 'the roster was read more than once');
  assert.equal(ab.modelOfFrom(() => { throw new Error('unreadable'); })('lyra'), null, 'an unreadable roster threw');
});

test('kosmos#8862: rows built from the readings carry the model limits in ms', () => {
  const resetsAt = Math.round(Date.parse(RESETS) / 1000);
  const rows = ab.rowsFromReadings({
    list: [{ dir: '/u/.claude-c', email: 'c@example.test' }],
    readUsage: () => ({ at: NOW, measuredAt: NOW, state: 'ok', email: 'c@example.test', weekly: { usedPct: 55, resetsAt, changedAt: NOW }, fiveHour: null, scoped: [{ model: 'Fable', usedPct: 100, resetsAt }] }),
    agentsOn: () => ({ names: [], complete: true, moving: [] }), nowMs: NOW,
  });
  assert.deepEqual(rows[0].scoped, [{ model: 'Fable', usedPct: 100, resetsAt: resetsAt * 1000 }]);
});

test('kosmos#8862: a successful read of the real answer writes its model limits into the record', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-8862-read-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const { EventEmitter } = require('node:events');
  const USAGE = JSON.stringify({ seven_day: { utilization: 55, resets_at: '2026-11-22T21:59:59.823627+00:00' }, five_hour: null, limits: REAL_LIMITS });
  const request = (opts, cb) => {   // https.request's shape: the usage answer, then the profile naming this login
    const req = new EventEmitter(); req.destroy = () => {};
    req.end = () => setImmediate(() => {
      const res = new EventEmitter(); res.statusCode = 200; res.setEncoding = () => {}; cb(res);
      res.emit('data', opts.path === usagepoll.USAGE_PATH ? USAGE : JSON.stringify({ account: { email: 'c@example.test' } }));
      res.emit('end');
    });
    return req;
  };
  await usagepoll.pollAll([{ dir: d, email: 'c@example.test' }], { now: NOW, platform: 'darwin', realHome: '/', identityOf: () => null,
    readCred: async () => JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: NOW + 10 * H } }), request });
  const rec = JSON.parse(fs.readFileSync(path.join(d, usagepoll.FILE), 'utf8'));
  assert.equal(rec.state, 'ok', 'CONTROL: the read worked');
  assert.equal(rec.weekly.usedPct, 55, 'CONTROL: the overall figure was read');
  assert.deepEqual(rec.scoped, [{ model: 'Fable', usedPct: 100, resetsAt: Math.floor(Date.parse(RESETS) / 1000) }], 'a successful read did not keep the Fable limit');
});
