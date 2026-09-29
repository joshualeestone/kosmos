'use strict';

/**
 * #4552: an agent's recorded `idle` report stands for "holding nothing" (commitments.assertIdle), so
 * the Assigner, which gives work only to a `clear` record, can act on a real board. Every arm that
 * must NOT write has a control that the same agent IS written once the reason is gone.
 *
 *   node --test engine/commitments-assertidle-4552.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-assertidle-'));
process.env.AGENT_WORKFORCE_DATA = TMP;

const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('./commitments');

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('never reported: an idle report writes the empty list, and the record reads clear', () => {
  assert.equal(c.read('never').state, c.STATE.UNKNOWN, 'fixture: starts unknown');
  assert.equal(c.read('never').neverReported, true);
  const r = c.assertIdle('never', false);
  assert.equal(r.wrote, true, r.because);
  assert.equal(c.read('never').state, c.STATE.CLEAR);
});

test('an agent holding an open task part is not written; control: without one it is', () => {
  const r = c.assertIdle('withwork', true);
  assert.equal(r.wrote, false);
  assert.equal(r.because, 'it holds an open part of a task');
  assert.equal(c.read('withwork').state, c.STATE.UNKNOWN);
  assert.equal(c.assertIdle('withwork', false).wrote, true);
});

test('"could not tell" whether it holds a task writes nothing', () => {
  for (const v of [null, undefined, 'yes', 1]) {
    const r = c.assertIdle('cannottell', v);
    assert.equal(r.wrote, false, String(v));
    assert.equal(r.because, 'we could not tell whether it holds a task', String(v));
  }
  assert.equal(c.read('cannottell').state, c.STATE.UNKNOWN);
});

test('a list the agent stated is never overwritten, fresh or stale; control: an empty last list is renewed', () => {
  c.report('holder', [{ id: 'a', what: 'check back after the deploy' }]);
  assert.equal(c.assertIdle('holder', false).wrote, false);
  assert.deepEqual(c.read('holder').commitments.map((x) => x.what), ['check back after the deploy']);
  // Stale: the same list aged past the window still stands (only the agent can drop it).
  const file = c.recordPath('holder');
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  rec.reportedAt = new Date(Date.now() - c.STALE_AFTER_MS - 60 * 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(rec));
  assert.equal(c.read('holder').state, c.STATE.UNKNOWN, 'fixture: the list is stale');
  assert.equal(c.assertIdle('holder', false).wrote, false);
  assert.equal(c.read('holder').commitments.length, 1, 'a stale stated list was erased');
  // Control: an agent whose last word was an EMPTY list, gone stale, is renewed to a fresh clear.
  c.report('emptied', []);
  const f2 = c.recordPath('emptied');
  const r2 = JSON.parse(fs.readFileSync(f2, 'utf8'));
  r2.reportedAt = new Date(Date.now() - c.STALE_AFTER_MS - 60 * 1000).toISOString();
  fs.writeFileSync(f2, JSON.stringify(r2));
  assert.equal(c.read('emptied').state, c.STATE.UNKNOWN, 'fixture: the empty list is stale');
  assert.equal(c.assertIdle('emptied', false).wrote, true);
  assert.equal(c.read('emptied').state, c.STATE.CLEAR);
});

test('a record that exists but cannot be read is not overwritten', () => {
  const file = c.recordPath('garbled');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  assert.equal(c.assertIdle('garbled', false).wrote, false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json', 'the unreadable record was replaced');
});
