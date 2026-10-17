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
    { usedPct: 0.5, windowMinutes: 10080, resetsAt: Date.parse('2026-10-23T23:06:25Z') },
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
    assert.equal(r.windows[1].usedPct, 0.5);
    assert.equal(agyusage.lastReading().windows[1].usedPct, 0.5);
    assert.equal(agyusage.refresh(NOW + 60e3), null, 'asked again within the interval');
    assert.equal(runs, 1);
    // A failed run after the interval keeps the last good reading.
    agyusage.setRunnerForTests((bin, done) => { runs++; done(new Error('offline'), ''); });
    await agyusage.refresh(NOW + agyusage.REFRESH_MS + 1);
    assert.equal(runs, 2, 'CONTROL: a run was made after the interval');
    assert.equal(agyusage.lastReading().windows[1].usedPct, 0.5, 'a failed run lost the last reading');
  } finally { runners.resolveBin = realResolve; agyusage.setRunnerForTests(null); agyusage.resetForTests(); }
});

test('#6176 slice 4: in a test process with no runner supplied, agy is never run', () => {
  agyusage.resetForTests();
  agyusage.setRunnerForTests(null);
  assert.equal(agyusage.refresh(NOW), null);
  assert.equal(agyusage.isRunning(), false);
});
