'use strict';
require('../test-support/tmpscope');   // first: every temp folder this file makes is removed when it exits (#4273)
/**
 * #6176 slice 4: engine/agyusage.js reads the Gemini group of `agy -p "/usage" --output-format json`. The fixture is the
 * shape measured on a real signed-in agy 1.4.0 (2026-10-17), ids made up. agy itself is never run: the runner is faked.
 *
 *   node --test engine/agyusage-6176.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const runners = require('./runners');
const agyusage = require('./agyusage');

const H = 3600e3;
const NOW = Date.parse('2026-10-17T07:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
function payload(over = {}) {
  return {
    conversation_id: 'conv-x', status: 'SUCCESS', response: 'Gemini Models\tWeekly Limit Remaining\t99%\t...', duration_seconds: 0,
    num_turns: 0, usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 },
    command: { name: 'usage', data: { description: 'Within each group, models share a weekly limit and a 5-hour limit.', groups: [
      { name: 'Gemini Models', description: 'Models within this group: Gemini Flash, Gemini Pro', buckets: [
        { id: 'b-1', name: 'Weekly Limit Remaining', description: 'You have used some of your weekly limit.', window: 'weekly',
          remaining_fraction: 0.9947686195373535, reset_time: '2026-10-23T23:06:25Z' },
        { id: 'b-2', name: 'Five Hour Limit Remaining', window: '5h', remaining_fraction: 0.25, reset_time: '2026-10-17T12:01:58Z' } ] },
      { name: 'Claude and GPT models', description: 'x', buckets: [
        { id: 'b-3', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: 0.1, reset_time: '2026-10-24T07:01:58Z' } ] },
      { name: 'Gemini 4 Argon', description: 'x', buckets: [
        { id: 'b-4', name: 'Gemini 4 Argon Weekly Limit', window: 'weekly', remaining_fraction: 0.2, reset_time: '2026-10-24T07:01:58Z' } ] } ] } },
    ...over,
  };
}

test('#6176 slice 4: the Gemini group is read, five-hour first, as used percent; other groups are not', () => {
  const r = agyusage.parse(JSON.stringify(payload()), NOW);
  assert.deepEqual(r, { windows: [
    { usedPct: 75, windowMinutes: 300, resetsAt: Date.parse('2026-10-17T12:01:58Z') },
    { usedPct: 0, windowMinutes: 10080, resetsAt: Date.parse('2026-10-23T23:06:25Z') },
  ], plan: null, at: NOW });
});

test('#6176 slice 4: no Gemini group by that name, a run that took a turn, or another command gives nothing', () => {
  const renamed = payload(); renamed.command.data.groups[0].name = 'Gemini models (new)';
  assert.equal(agyusage.parse(renamed, NOW), null, 'another group answered for a renamed one');
  assert.equal(agyusage.parse(payload({ num_turns: 1 }), NOW), null, 'a run that started a turn was read');
  assert.equal(agyusage.parse(payload({ command: { name: 'quota', data: payload().command.data } }), NOW), null);
  assert.equal(agyusage.parse('not json', NOW), null);
  assert.notEqual(agyusage.parse(payload(), NOW), null, 'CONTROL: the measured payload is read');
});

test('#6176 slice 4: a bucket of an unknown window or a bad fraction is skipped, the rest are read', () => {
  const p = payload();
  p.command.data.groups[0].buckets.push({ name: 'x', window: 'monthly', remaining_fraction: 0.5, reset_time: '2026-11-01T00:00:00Z' });
  p.command.data.groups[0].buckets[1].remaining_fraction = 1.4;
  const r = agyusage.parse(p, NOW);
  assert.equal(r.windows.length, 1);
  assert.equal(r.windows[0].windowMinutes, 10080);
});

test('#6176 slice 4: refresh runs agy once, keeps the reading, never twice at once, and not again within the interval', async () => {
  const realResolve = runners.resolveBin;
  runners.resolveBin = (p) => (p === 'antigravity' ? { present: true, bin: '/fake/agy' } : realResolve(p));
  require('./agystatus').setPlatformForTests('darwin');   // a reading is asked for only on a Mac; CI runs on Linux too
  agyusage.resetForTests();
  let runs = 0, finish;
  agyusage.setRunnerForTests((bin, done) => { runs++; finish = () => done(null, JSON.stringify(payload())); });
  try {
    const p1 = agyusage.refresh(NOW);
    assert.ok(p1, 'nothing was started');
    assert.equal(agyusage.refresh(NOW), null, 'a second run started while one was in flight');
    assert.equal(agyusage.isRunning(), true);
    finish();
    const r = await p1;
    assert.equal(r.windows[0].usedPct, 75);
    assert.equal(agyusage.lastReading().windows[0].usedPct, 75);
    assert.equal(agyusage.refresh(NOW + 60e3), null, 'asked again within the interval');
    assert.equal(runs, 1);
    // A failed run after the interval keeps the last good reading, and the next try waits only RETRY_MS.
    agyusage.setRunnerForTests((bin, done) => { runs++; done(new Error('offline'), ''); });
    await agyusage.refresh(NOW + agyusage.REFRESH_MS + 1);
    assert.equal(runs, 2, 'CONTROL: a run was made after the interval');
    assert.equal(agyusage.lastReading().windows[0].usedPct, 75, 'a failed run lost the last reading');
    const p3 = agyusage.refresh(Date.now() + agyusage.RETRY_MS + 1);
    assert.ok(p3, 'after a failed run the next try waited the full interval');
    await p3;
    assert.equal(runs, 3);
    // A new sign-in answer drops the reading and the throttle: the next read asks afresh.
    agyusage.clear();
    assert.equal(agyusage.lastReading(), null, 'a reading outlived a sign-in change');
    assert.ok(agyusage.refresh(Date.now()), 'after a sign-in change the next read did not ask');
  } finally { runners.resolveBin = realResolve; require('./agystatus').setPlatformForTests(null); agyusage.setRunnerForTests(null); agyusage.resetForTests(); }
});

test('#6176 slice 4: in a test process with no runner supplied, agy is never run, even where it is installed', () => {
  // agy "installed" as a stub that is never reached: a missing guard shows as a run started, not as a real agy spawned.
  const realResolve = runners.resolveBin;
  runners.resolveBin = (p) => (p === 'antigravity' ? { present: true, bin: '/usr/bin/false' } : realResolve(p));
  require('./agystatus').setPlatformForTests('darwin');   // past the platform gate, so only the test guard can refuse
  agyusage.resetForTests();
  agyusage.setRunnerForTests(null);
  try {
    assert.equal(agyusage.refresh(NOW), null, 'agy was run in a test process');
    assert.equal(agyusage.isRunning(), false);
  } finally { runners.resolveBin = realResolve; require('./agystatus').setPlatformForTests(null); agyusage.resetForTests(); }
});

test('#6176 slice 4: a whole-percent used, rounded down once, so 99.6% never reads as at the limit', () => {
  const p = payload();
  p.command.data.groups[0].buckets[1].remaining_fraction = 0.004;   // 99.6% used
  p.command.data.groups[0].buckets[0].remaining_fraction = 0;       // all used
  const r = agyusage.parse(p, NOW);
  assert.equal(r.windows[0].usedPct, 99);
  assert.equal(r.windows[1].usedPct, 100);
});

test('#6176 slice 4: where agystatus says this is not a Mac, nothing is asked', () => {
  const agystatus = require('./agystatus');
  agystatus.setPlatformForTests('win32');
  agyusage.resetForTests();
  agyusage.setRunnerForTests((bin, done) => done(null, JSON.stringify(payload())));
  try {
    assert.equal(agyusage.supported(), false);
    assert.equal(agyusage.refresh(NOW), null, 'a reading was asked for on Windows');
  } finally { agystatus.setPlatformForTests(null); agyusage.setRunnerForTests(null); agyusage.resetForTests(); }
});

test('#6176 slice 4 review 2: a run that finishes after the sign-in changed is dropped, not shown on the new row', async () => {
  const realResolve = runners.resolveBin;
  runners.resolveBin = (p) => (p === 'antigravity' ? { present: true, bin: '/fake/agy' } : realResolve(p));
  require('./agystatus').setPlatformForTests('darwin');
  agyusage.resetForTests();
  let finish;
  agyusage.setRunnerForTests((bin, done) => { finish = () => done(null, JSON.stringify(payload())); });
  try {
    const p1 = agyusage.refresh(NOW);
    agyusage.clear();   // signed in again as someone else while it ran
    finish();
    assert.equal(await p1, null);
    assert.equal(agyusage.lastReading(), null, 'the earlier sign-in reading reached the row');
    assert.ok(agyusage.refresh(Date.now()), 'after the change the next read did not ask');
  } finally { runners.resolveBin = realResolve; require('./agystatus').setPlatformForTests(null); agyusage.resetForTests(); }
});

test('#6176 slice 4 review 2: agystatus remember and forget clear the reading', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const agystatus = require('./agystatus');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agyusage-wire-'));
  agystatus.setLastFileForTests(() => path.join(dir, 'last.json'));
  const realResolve = runners.resolveBin;
  runners.resolveBin = (p) => (p === 'antigravity' ? { present: true, bin: '/fake/agy' } : realResolve(p));
  agystatus.setPlatformForTests('darwin');
  const seed = async () => {
    agyusage.resetForTests();
    agyusage.setRunnerForTests((bin, done) => done(null, JSON.stringify(payload())));
    await agyusage.refresh(NOW);
    assert.ok(agyusage.lastReading(), 'CONTROL: a reading is there before the sign-in changes');
  };
  try {
    await seed();
    agystatus.remember({ installed: true, signedIn: true });
    assert.equal(agyusage.lastReading(), null, 'a new sign-in answer left the old reading');
    await seed();
    agystatus.forget();
    assert.equal(agyusage.lastReading(), null, 'Remove left the reading');
  } finally {
    runners.resolveBin = realResolve; agystatus.setPlatformForTests(null); agystatus.setLastFileForTests(null);
    agyusage.resetForTests(); fs.rmSync(dir, { recursive: true, force: true });
  }
});
