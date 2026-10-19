'use strict';
/**
 * kosmos#5532 rollup review 1 (a BLOCKER): engine/usage.js reads every Claude config folder on this computer, with no
 * filter by world or agent, so its numbers include the person's other Kosmoses and their own sessions outside Kosmos.
 * The rollup must never send those. This plants a transcript the way any other session on the computer would leave
 * one, proves the computer-wide reader sees it (the control), and proves the rollup built from the board's real
 * sources carries none of it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'orgrollup-scope-5532-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'claude');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
for (const v of ['CODEX_HOME', 'AGENT_WORKFORCE_CODEX_HOME', 'GEMINI_CLI_HOME', 'AGENT_WORKFORCE_GEMINI_HOME', 'GROK_HOME', 'AGENT_WORKFORCE_GROK_HOME']) delete process.env[v];
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });

const usage = require('./usage');
const r = require('./orgrollup');
const fleet = require('../test-support/fleet');
/* A real card (fixture-discipline.test.js), with the model set on top: a fixture pane has no transcript to read it from. */
function card(o) {
  const b = fleet.install([fleet.agent(o.key, { displayName: o.name, state: o.state || 'idle' })], { strict: false });
  try { return Object.assign({}, b.agents[0], { model: o.model === undefined ? null : o.model }); } finally { b.restore(); }
}

const TODAY = new Date().toISOString().slice(0, 10);
// Model ids build() keeps (MODEL_ID), so a leak would show: a made-up id is dropped whether or not the scope works.
const OTHER = 'claude-sonnet-4-5';

test('#5532 rollup review 1: usage from another session on this computer never reaches the rollup', async () => {
  const file = path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects', 'someone-else', 'session.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', cwd: '/elsewhere/personal', timestamp: TODAY + 'T01:00:00.000Z' }),
    JSON.stringify({ timestamp: TODAY + 'T02:00:00.000Z', cwd: '/elsewhere/personal', message: { id: 'other-1', model: OTHER, usage: { input_tokens: 4242, output_tokens: 99 } } }),
  ].join('\n') + '\n');

  // CONTROL: the computer-wide reader does see that session, so an empty rollup below is not an empty fixture.
  const all = await usage.dailyUsageByModel(1);
  assert.ok(all.byDay[TODAY] && all.byDay[TODAY][OTHER], 'CONTROL: the planted session was not read at all: ' + JSON.stringify(all.byDay));

  // The board's real sources, with only the parts that need a running board stood in.
  const src = Object.assign(r.defaultSources(), {
    snapshot: () => ({ counts: {}, agents: [card({ key: 'leo', name: 'Leo', runner: 'claude', model: 'claude-opus-5-5', state: 'working' })] }),
    survey: () => ({ ok: true, agents: [] }),
    removed: () => [],
    projects: () => [],
    lastActiveOf: () => null,
  });
  const body = r.build(Object.assign({ world: 'a'.repeat(32) }, await r.gather(src, { usage: true })));
  const text = JSON.stringify(body);
  // kosmos#5532: defaultSources() now reads usage, scoped to this world's roster (worldUsageByModel). This world has no
  // agents here, so nothing is this world's: the planted session is not sent, and nothing is withheld either.
  assert.equal(text.includes(OTHER), false, 'another session\'s model reached the rollup: ' + text);
  assert.equal(text.includes('4242'), false, 'another session\'s tokens reached the rollup');
  assert.deepEqual(body.usage, []);
  assert.equal(body.usageWithheld, false, 'the scoped reader is wired, so usage is read, not withheld');
  assert.equal(body.truncated, false, 'truncated is only for a real trim or a partial read');
});

test('#5532: the rollup sends a session launched in one of this Kosmos\'s agent folders, and not one from elsewhere', async () => {
  const OWN = 'claude-opus-4-1';
  const store = require('./store');
  store.writeProfile('leo', { provider: 'anthropic' });   // on this Kosmos's roster (register.known)
  const leoDir = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'leo');
  fs.mkdirSync(leoDir, { recursive: true });
  const cwd = fs.realpathSync(leoDir);
  const file = path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects', 'leo-own', 'session.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'user', cwd, timestamp: TODAY + 'T03:00:00.000Z' }),
    JSON.stringify({ timestamp: TODAY + 'T04:00:00.000Z', cwd, message: { id: 'own-1', model: OWN, usage: { input_tokens: 1717, output_tokens: 13 } } }),
  ].join('\n') + '\n');
  // The session from elsewhere, planted here too, so this test's negative control does not lean on the one above.
  const elsewhere = path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects', 'elsewhere-own-test', 'session.jsonl');
  fs.mkdirSync(path.dirname(elsewhere), { recursive: true });
  fs.writeFileSync(elsewhere, [
    JSON.stringify({ type: 'user', cwd: '/elsewhere/personal', timestamp: TODAY + 'T05:00:00.000Z' }),
    JSON.stringify({ timestamp: TODAY + 'T06:00:00.000Z', cwd: '/elsewhere/personal', message: { id: 'other-2', model: OTHER, usage: { input_tokens: 4243, output_tokens: 9 } } }),
  ].join('\n') + '\n');
  const src = Object.assign(r.defaultSources(), {
    snapshot: () => ({ counts: {}, agents: [card({ key: 'leo', name: 'Leo', runner: 'claude', model: 'claude-opus-5-5', state: 'working' })] }),
    survey: () => ({ ok: true, agents: [] }),
    removed: () => [],
    projects: () => [],
    lastActiveOf: () => null,
  });
  const body = r.build(Object.assign({ world: 'a'.repeat(32) }, await r.gather(src, { usage: true })));
  const text = JSON.stringify(body);
  // The session from elsewhere (planted above, in this test and the first) must stay out.
  assert.equal(text.includes(OTHER), false, 'another session reached the rollup beside the agent\'s own: ' + text);
  const own = body.usage.filter((u) => u.model === OWN);
  assert.equal(own.length, 1, 'the agent\'s own session did not reach the rollup: ' + text);
  assert.equal(own[0].input, 1717, text);
  assert.equal(body.usageWithheld, false, text);
});

test('#5532 rollup review 7: the real runner lookup answers null (not claude) when nothing records one', () => {
  const src = r.defaultSources();
  assert.equal(src.recordedRunner('nobody-recorded-here'), null, 'a guessed runner would be reported as a provider');
  // CONTROL: a profile that records a provider is read, so the null above is "nothing recorded", not a broken lookup.
  require('./store').writeProfile('pat', { provider: 'openai' });
  assert.equal(src.recordedRunner('pat'), 'codex');
});

test('#5532: with words that do not name usage, it is not read at all, and an incomplete count is truncated, not partial', async () => {
  let reads = 0;
  const base = Object.assign(r.defaultSources(), {
    snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [],
    projects: () => [], lastActiveOf: () => null,
  });
  const spy = Object.assign({}, base, { usageByDay: async () => { reads += 1; return { byDay: {}, complete: true }; } });
  const off = await r.gather(spy);   // a caller that does not ask
  assert.equal(reads, 0, 'usage was read under words that do not name it');
  assert.equal(off.usageWithheld, true);
  const on = await r.gather(spy, { usage: true });
  assert.equal(reads, 1, 'CONTROL: the same sources do read usage when it is wanted');
  assert.equal(on.usageWithheld, undefined);
  const short = await r.gather(Object.assign({}, base, { usageByDay: async () => ({ byDay: { [TODAY]: { 'claude-opus-4-1': { input_tokens: 2 } } }, complete: false }) }), { usage: true });
  assert.equal(short.usageIncomplete, true, 'CONTROL: the count was read and marked short');
  assert.equal(short.partial, false, 'an incomplete usage count must not hold the daily or block change sends');
  assert.equal(r.build(Object.assign({ world: 'a'.repeat(32) }, short)).truncated, true, 'an incomplete count was sent as the whole');
});

test('#5532: a usage read slower than its wait is withheld, never sent as a count', async () => {
  const base = Object.assign(r.defaultSources(), {
    snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [],
    projects: () => [], lastActiveOf: () => null,
  });
  r._resetUsageScanForTests();   // no kept scan: this test checks its own reader, not one left by earlier tests
  const never = Object.assign({}, base, { usageByDay: () => new Promise(() => {}) });
  const g = await r.gather(never, { usage: true, usageReadMs: 20 });
  assert.equal(g.usageWithheld, true, 'a read that never answered was not withheld');
  assert.deepEqual(g.usageByDay, {});
  // CONTROL: the same wait with a reader that answers at once gives its count.
  const quick = Object.assign({}, base, { usageByDay: async () => ({ byDay: { x: {} }, complete: true }) });
  const q = await r.gather(quick, { usage: true, usageReadMs: 20 });
  assert.equal(q.usageWithheld, undefined);
  assert.deepEqual(q.usageByDay, { x: {} });
});

test('#5532: a reader answer of the wrong shape is withheld, never sent as zero', async () => {
  const base = Object.assign(r.defaultSources(), {
    snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [],
    projects: () => [], lastActiveOf: () => null,
  });
  for (const bad of [{ byDay: { x: {} }, complete: 'yes' }, { byDay: null, complete: true }, { byDay: [], complete: true }, null, 0, 'x', [], {}, { error: 'x' }, { complete: true }]) {
    const g = await r.gather(Object.assign({}, base, { usageByDay: async () => bad }), { usage: true });
    assert.equal(g.usageWithheld, true, JSON.stringify(bad));
    assert.deepEqual(g.usageByDay, {});
  }
});

test('#5532: when the scan outlasts the wait, a later send uses the last finished scan, marked incomplete', async () => {
  const base = Object.assign(r.defaultSources(), {
    snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [],
    projects: () => [], lastActiveOf: () => null,
  });
  const real = usage.worldUsageByModel;
  const day = { [TODAY]: { 'claude-opus-4-1': { input_tokens: 31 } } };
  usage.worldUsageByModel = () => new Promise((resolve) => setTimeout(() => resolve({ byDay: day, complete: true }), 60));
  r._resetUsageScanForTests();   // earlier tests here ran real scans; start from none
  try {
    const first = await r.gather(base, { usage: true, usageReadMs: 10 });
    assert.equal(first.usageWithheld, true, 'CONTROL: with no finished scan yet, a slow read is withheld');
    await new Promise((resolve) => setTimeout(resolve, 100));   // the abandoned scan finishes
    const second = await r.gather(base, { usage: true, usageReadMs: 10 });
    assert.equal(second.usageWithheld, undefined, 'the finished scan was not used by the next send');
    assert.deepEqual(second.usageByDay, day);
    assert.equal(second.usageIncomplete, true, 'an earlier scan was sent as a fresh, whole count');
  } finally { usage.worldUsageByModel = real; await new Promise((resolve) => setTimeout(resolve, 100)); }
});

test('#5532: a kept scan more than a day old is not used, and two overlapping reads share one scan', async () => {
  const base = Object.assign(r.defaultSources(), {
    snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [],
    projects: () => [], lastActiveOf: () => null,
  });
  const real = usage.worldUsageByModel;
  const realNow = Date.now;
  let scans = 0;
  const day = { [TODAY]: { 'claude-opus-4-1': { input_tokens: 7 } } };
  usage.worldUsageByModel = () => { scans += 1; return new Promise((resolve) => setTimeout(() => resolve({ byDay: day, complete: true }), 60)); };
  r._resetUsageScanForTests();
  try {
    // Two reads while one scan runs: one scan.
    const [a, b] = await Promise.all([r.gather(base, { usage: true, usageReadMs: 10 }), r.gather(base, { usage: true, usageReadMs: 10 })]);
    assert.equal(scans, 1, 'two overlapping reads started two scans');
    assert.equal(a.usageWithheld && b.usageWithheld, true, 'CONTROL: neither had a finished scan to use');
    await new Promise((resolve) => setTimeout(resolve, 100));   // that scan finishes and is kept
    // A day later the kept scan is too old: the slow read is withheld, not sent with a day-old count.
    Date.now = () => realNow() + 24 * 60 * 60 * 1000 + 60 * 1000;
    const old = await r.gather(base, { usage: true, usageReadMs: 10 });
    assert.equal(old.usageWithheld, true, 'a kept scan more than a day old was sent');
    Date.now = realNow;
    await new Promise((resolve) => setTimeout(resolve, 100));
    // CONTROL: a kept scan within the day (the one the read above started, finished on the real clock) is used.
    const fresh = await r.gather(base, { usage: true, usageReadMs: 10 });
    assert.equal(fresh.usageWithheld, undefined, 'CONTROL: a kept scan within the day was not used');
  } finally { Date.now = realNow; usage.worldUsageByModel = real; await new Promise((resolve) => setTimeout(resolve, 100)); }
});

test('#5532: gatherIn gives the child the usage argument only when told usage', async () => {
  const cp = require('node:child_process');
  const realExec = cp.execFile;
  const argvs = [];
  cp.execFile = (file, args, opts, cb) => { argvs.push(args.slice(1)); cb(null, JSON.stringify({ ok: true, enrolled: true }) + '\n'); };
  try {
    await r.gatherIn({}, true);
    await r.gatherIn({}, false);
    await r.gatherIn({});
  } finally { cp.execFile = realExec; }
  assert.deepEqual(argvs, [['gather', 'usage'], ['gather'], ['gather']], 'the child was told usage when it should not be, or not when it should');
});

test('#5532: a scan pending over an hour is given up on, and its late answer does not overwrite the newer one', async () => {
  const base = Object.assign(r.defaultSources(), {
    snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [],
    projects: () => [], lastActiveOf: () => null,
  });
  const real = usage.worldUsageByModel;
  const realNow = Date.now;
  const stale = { [TODAY]: { 'claude-opus-4-1': { input_tokens: 1 } } };
  const fresh = { [TODAY]: { 'claude-opus-4-1': { input_tokens: 2 } } };
  let releaseFirst;
  let scans = 0;
  usage.worldUsageByModel = () => {
    scans += 1;
    if (scans === 1) return new Promise((resolve) => { releaseFirst = () => resolve({ byDay: stale, complete: true }); });   // hangs
    if (scans === 2) return new Promise((resolve) => setTimeout(() => resolve({ byDay: fresh, complete: true }), 30));
    return new Promise(() => {});   // later reads never answer, so they fall back to the kept scan
  };
  r._resetUsageScanForTests();
  try {
    await r.gather(base, { usage: true, usageReadMs: 10 });
    assert.equal(scans, 1, 'CONTROL: the first read started one scan');
    await r.gather(base, { usage: true, usageReadMs: 10 });
    assert.equal(scans, 1, 'CONTROL: within the hour a later read shares the pending scan');
    Date.now = () => realNow() + 60 * 60 * 1000 + 60 * 1000;
    await r.gather(base, { usage: true, usageReadMs: 10 });
    assert.equal(scans, 2, 'a scan pending over an hour was not given up on');
    Date.now = realNow;
    await new Promise((resolve) => setTimeout(resolve, 60));   // the fresh scan finishes and is kept
    releaseFirst();                                            // the stale one answers late
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = await r.gather(base, { usage: true, usageReadMs: 10 });
    assert.deepEqual(after.usageByDay, fresh, 'the superseded scan\'s late answer replaced the newer one');
    assert.equal(after.usageIncomplete, true);
  } finally { Date.now = realNow; usage.worldUsageByModel = real; r._resetUsageScanForTests(); }
});

test('#5532: a superseded scan settling while the newer one runs leaves the newer one shared', async () => {
  const base = Object.assign(r.defaultSources(), {
    snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [],
    projects: () => [], lastActiveOf: () => null,
  });
  const real = usage.worldUsageByModel;
  const realNow = Date.now;
  let releaseFirst;
  let scans = 0;
  usage.worldUsageByModel = () => {
    scans += 1;
    if (scans === 1) return new Promise((resolve) => { releaseFirst = () => resolve({ byDay: {}, complete: true }); });
    return new Promise(() => {});   // the newer scan stays pending
  };
  r._resetUsageScanForTests();
  try {
    await r.gather(base, { usage: true, usageReadMs: 10 });
    Date.now = () => realNow() + 60 * 60 * 1000 + 60 * 1000;
    await r.gather(base, { usage: true, usageReadMs: 10 });
    assert.equal(scans, 2, 'CONTROL: past the hour a fresh scan started');
    releaseFirst();                                            // the superseded scan settles while the newer one runs
    await new Promise((resolve) => setTimeout(resolve, 20));
    await r.gather(base, { usage: true, usageReadMs: 10 });
    assert.equal(scans, 2, 'the superseded scan freed the slot, so a third scan started beside the pending one');
  } finally { Date.now = realNow; usage.worldUsageByModel = real; r._resetUsageScanForTests(); }
});

test('#5532: while one given-up scan still runs, no further scan starts after another hour', async () => {
  const base = Object.assign(r.defaultSources(), {
    snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [],
    projects: () => [], lastActiveOf: () => null,
  });
  const real = usage.worldUsageByModel;
  const realNow = Date.now;
  let scans = 0;
  usage.worldUsageByModel = () => { scans += 1; return new Promise(() => {}); };   // a stuck mount: nothing settles
  r._resetUsageScanForTests();
  const hour = 60 * 60 * 1000 + 60 * 1000;
  try {
    await r.gather(base, { usage: true, usageReadMs: 10 });
    Date.now = () => realNow() + hour;
    await r.gather(base, { usage: true, usageReadMs: 10 });
    assert.equal(scans, 2, 'CONTROL: past the first hour one fresh scan started');
    Date.now = () => realNow() + 2 * hour + 60 * 1000;
    const g = await r.gather(base, { usage: true, usageReadMs: 10 });
    assert.equal(scans, 2, 'a third scan started while a given-up one still runs');
    assert.equal(g.usageWithheld, true);
  } finally { Date.now = realNow; usage.worldUsageByModel = real; r._resetUsageScanForTests(); }
});

test('#5532: once the given-up scan settles, a later hour may give up again', async () => {
  const base = Object.assign(r.defaultSources(), {
    snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [],
    projects: () => [], lastActiveOf: () => null,
  });
  const real = usage.worldUsageByModel;
  const realNow = Date.now;
  const release = [];
  let scans = 0;
  usage.worldUsageByModel = () => { scans += 1; return new Promise((resolve) => { release.push(() => resolve({ byDay: {}, complete: true })); }); };
  r._resetUsageScanForTests();
  const hour = 60 * 60 * 1000 + 60 * 1000;
  try {
    await r.gather(base, { usage: true, usageReadMs: 10 });                 // scan 1
    Date.now = () => realNow() + hour;
    await r.gather(base, { usage: true, usageReadMs: 10 });                 // scan 1 given up, scan 2 starts
    assert.equal(scans, 2);
    release[0]();                                                         // the given-up scan settles: its slot frees
    await new Promise((resolve) => setTimeout(resolve, 20));
    Date.now = () => realNow() + 2 * hour + 60 * 1000;
    await r.gather(base, { usage: true, usageReadMs: 10 });                 // scan 2 is now over an hour old
    assert.equal(scans, 3, 'the slot was never freed after the given-up scan settled');
  } finally { Date.now = realNow; usage.worldUsageByModel = real; r._resetUsageScanForTests(); }
});

test('#5532: a kept scan dated in the future (the clock was set back) is not used', async () => {
  const base = Object.assign(r.defaultSources(), {
    snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [],
    projects: () => [], lastActiveOf: () => null,
  });
  const real = usage.worldUsageByModel;
  const realNow = Date.now;
  const day = { [TODAY]: { 'claude-opus-4-1': { input_tokens: 7 } } };
  usage.worldUsageByModel = () => new Promise((resolve) => setTimeout(() => resolve({ byDay: day, complete: true }), 60));
  r._resetUsageScanForTests();
  try {
    await r.gather(base, { usage: true, usageReadMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 100));   // that scan finishes and is kept, on the real clock
    Date.now = () => realNow() - 60 * 60 * 1000;                 // the clock is set back an hour
    const back = await r.gather(base, { usage: true, usageReadMs: 10 });
    assert.equal(back.usageWithheld, true, 'a kept scan dated in the future was sent');
    Date.now = realNow;
    // CONTROL: on the real clock the same kept scan is within the day and is used.
    const now = await r.gather(base, { usage: true, usageReadMs: 10 });
    assert.equal(now.usageWithheld, undefined, 'CONTROL: the kept scan was not used on the real clock');
  } finally { Date.now = realNow; usage.worldUsageByModel = real; await new Promise((resolve) => setTimeout(resolve, 100)); r._resetUsageScanForTests(); }
});

test('#5532: an empty count that is not complete is withheld; an empty complete count is a real zero', async () => {
  const base = Object.assign(r.defaultSources(), {
    snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [],
    projects: () => [], lastActiveOf: () => null,
  });
  // usage.js answers { byDay: {}, complete: false } when it could read nothing, and also for a quiet week with part
  // unread: the two cannot be told apart, so both are withheld rather than sent as a zero.
  const nothing = await r.gather(Object.assign({}, base, { usageByDay: async () => ({ byDay: {}, complete: false }) }), { usage: true });
  assert.equal(nothing.usageWithheld, true, 'a read that learned nothing was sent as a zero');
  assert.equal(nothing.usageIncomplete, undefined);
  // CONTROL: a complete empty count is a real zero, and is sent.
  const zero = await r.gather(Object.assign({}, base, { usageByDay: async () => ({ byDay: {}, complete: true }) }), { usage: true });
  assert.equal(zero.usageWithheld, undefined, 'CONTROL: a complete zero was withheld');
  assert.deepEqual(zero.usageByDay, {});
  // CONTROL: a non-empty incomplete count is still sent, marked incomplete.
  const short = await r.gather(Object.assign({}, base, { usageByDay: async () => ({ byDay: { [TODAY]: { 'claude-opus-4-1': { input_tokens: 3 } } }, complete: false }) }), { usage: true });
  assert.equal(short.usageWithheld, undefined);
  assert.equal(short.usageIncomplete, true);
});

test('#5532: a kept scan with no days is not reused by a slow read (withheld, not an empty count)', async () => {
  const base = Object.assign(r.defaultSources(), {
    snapshot: () => ({ counts: {}, agents: [] }), survey: () => ({ ok: true, agents: [] }), removed: () => [],
    projects: () => [], lastActiveOf: () => null,
  });
  const real = usage.worldUsageByModel;
  let next = { byDay: {}, complete: true };
  usage.worldUsageByModel = () => { const v = next; return new Promise((resolve) => setTimeout(() => resolve(v), 30)); };
  r._resetUsageScanForTests();
  try {
    await r.gather(base, { usage: true, usageReadMs: 5 });                 // gives up; the scan finishes and is kept, empty
    await new Promise((resolve) => setTimeout(resolve, 80));
    const g = await r.gather(base, { usage: true, usageReadMs: 5 });      // slow again: the kept scan has no days
    assert.equal(g.usageWithheld, true, 'a kept scan with no days was sent as an empty count');
    // CONTROL: a kept scan WITH days is reused by the same slow read.
    next = { byDay: { [TODAY]: { 'claude-opus-4-1': { input_tokens: 4 } } }, complete: true };
    await new Promise((resolve) => setTimeout(resolve, 80));               // the scan the read above started (empty) finishes
    await r.gather(base, { usage: true, usageReadMs: 5 });                  // starts a scan that finds days
    await new Promise((resolve) => setTimeout(resolve, 80));               // it finishes and is kept
    const h = await r.gather(base, { usage: true, usageReadMs: 5 });
    assert.equal(h.usageWithheld, undefined, 'CONTROL: a kept scan with days was not reused');
    assert.equal(h.usageIncomplete, true);
  } finally { usage.worldUsageByModel = real; await new Promise((resolve) => setTimeout(resolve, 80)); r._resetUsageScanForTests(); }
});
