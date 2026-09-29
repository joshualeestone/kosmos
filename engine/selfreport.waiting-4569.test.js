'use strict';
/**
 * #4569 fix 4: a busy Muse agent's queue ({ n, yours }) is kept on a working self-report, read back, and carried by
 * status onto the card while that report is fresh. Kosmos's count, checked here, never the agent's words.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-selfreport-waiting-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const selfreport = require('./selfreport');
const { reconcileReport, STATE } = require('./status');
test.after(() => fs.rmSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true, force: true }));

test('#4569 fix 4: a working report keeps a sane count and reads it back; anything else is not kept', () => {
  assert.equal(selfreport.record('mark', { state: 'working', auto: true, waiting: { n: 15, yours: 1 } }).recorded, true);
  assert.deepEqual(selfreport.read('mark').waiting, { n: 15, yours: 1 });
  for (const [label, entry] of [
    ['an idle report', { state: 'idle', auto: true, waiting: { n: 3, yours: 0 } }],
    ['a text count', { state: 'working', auto: true, waiting: { n: '3', yours: 0 } }],
    ['yours above n', { state: 'working', auto: true, waiting: { n: 2, yours: 3 } }],
    ['zero', { state: 'working', auto: true, waiting: { n: 0, yours: 0 } }],
    ['a fraction', { state: 'working', auto: true, waiting: { n: 2.5, yours: 0 } }],
  ]) {
    selfreport.record('mark', entry);
    assert.equal(selfreport.read('mark').waiting, null, label + ' was kept');
  }
  // A later working report with no count clears the earlier one (the queue emptied).
  selfreport.record('mark', { state: 'working', auto: true, waiting: { n: 4, yours: 0 } });
  selfreport.record('mark', { state: 'working', auto: true });
  assert.equal(selfreport.read('mark').waiting, null, 'an emptied queue kept its old count');
});

test('#4569 fix 4: status carries the count on a fresh working report only', () => {
  const now = Date.now();
  const scraped = { state: STATE.UNKNOWN, confidence: 'none', because: 'Kosmos reads what Muse is doing from its own reports' };
  const fresh = { found: true, state: 'working', because: null, at: new Date(now - 5000).toISOString(), by: 'auto', waiting: { n: 3, yours: 1 } };
  const r = reconcileReport(fresh, scraped, now);
  assert.equal(r.state, STATE.WORKING);
  assert.deepEqual(r.waiting, { n: 3, yours: 1 });
  // CONTROL: the same report with no count carries none.
  assert.equal(reconcileReport({ ...fresh, waiting: null }, scraped, now).waiting, null);
  // A stale working report (past the decay) is not "working" any more, so its count must not show.
  const stale = { ...fresh, at: new Date(now - 60 * 60 * 1000).toISOString() };
  assert.ok(!reconcileReport(stale, scraped, now).waiting, 'a stale report kept its count');
});

test('#4612: an idle report keeps a turn\'s answer (cleaned, capped) and reads it back; anything else is not kept', () => {
  const at = new Date().toISOString();
  selfreport.record('mark2', { state: 'idle', auto: true, final: { text: 'Done.\u0007 Next step: deploy.', startedAt: at } });
  assert.deepEqual(selfreport.read('mark2').final, { text: 'Done. Next step: deploy.', startedAt: at });
  selfreport.record('mark2', { state: 'idle', auto: true, final: { text: 'x'.repeat(5000), startedAt: at } });
  assert.equal(selfreport.read('mark2').final.text.length, 4000);
  for (const [label, entry] of [
    ['a working report', { state: 'working', auto: true, final: { text: 'x', startedAt: at } }],
    ['blank text', { state: 'idle', auto: true, final: { text: '   ', startedAt: at } }],
    ['a bad time', { state: 'idle', auto: true, final: { text: 'x', startedAt: 'soon' } }],
    ['no answer', { state: 'idle', auto: true }],
  ]) {
    selfreport.record('mark2', entry);
    assert.equal(selfreport.read('mark2').final, null, label + ' was kept');
  }
});
