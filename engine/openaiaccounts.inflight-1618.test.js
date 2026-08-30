'use strict';
/**
 * #1618: two callers arriving together cost ONE live sweep, and the three-state
 * rule survives the sharing.
 *
 * 🛑 WHY THIS IS A SEPARATE FILE FROM engine/inflight.test.js. That one tests the
 * helper in isolation and would stay green if the helper were never wired to
 * anything. This one tests the WIRING, which is the half that can silently not
 * exist. A helper with a perfect unit test and no call site is a common shape.
 *
 * ⚠️ AND IT ASSERTS THE COST, NOT THE ANSWER. Sharing is invisible in the returned
 * rows - both callers get correct rows either way - so an assertion on the rows
 * cannot tell a collapsed sweep from two sweeps. The observable is how many times
 * the reader was entered.
 *
 *   node --test engine/openaiaccounts.inflight-1618.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-openai-inflight-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
const openai = require('./openaiaccounts');
const sub = require('./subscription');

const writeAuth = (rel, obj) => {
  const p = nodePath.join(SANDBOX, rel, 'auth.json');
  fs.mkdirSync(nodePath.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
};

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

writeAuth('.codex', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-inflightoneONE1' });
writeAuth('.codex-two', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-inflighttwoTWO2' });

/* Counts entries into the reader and holds them open, so the second caller
   arrives while the first sweep is genuinely still in flight. Returning the
   promise from `listLive()` before releasing is what makes it concurrent. */
function countingReader() {
  const real = openai.checkLive;
  let entries = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  openai.checkLive = async (dir) => { entries += 1; await gate; return real(dir); };
  return {
    entries: () => entries,
    release,
    restore: () => { openai.checkLive = real; },
  };
}

test('#1618: two callers arriving together run the sweep ONCE, not twice', async () => {
  openai.setFetcher(async () => ({ status: 200, body: {} }));
  const reader = countingReader();
  try {
    const a = openai.listLive();
    const b = openai.listLive();
    /* Two accounts exist, so ONE sweep enters the reader twice. Two sweeps would
       enter it four times. Asserted before release, while both are in flight. */
    assert.equal(reader.entries(), 2,
      'the second caller started its own sweep instead of sharing the one in flight');

    reader.release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(reader.entries(), 2, 'a further sweep ran after the sharers attached');
    assert.deepEqual(ra.map((r) => r.label), rb.map((r) => r.label),
      'the two callers were handed different lists');
  } finally { reader.restore(); openai.setFetcher(null); }
});

/* 🛑 THE CONTROL, AND IT IS THE ARM THAT MAKES THE NUMBER ABOVE MEAN ANYTHING.
   `entries === 2` is also what a single caller produces, so on its own it cannot
   distinguish "shared" from "the second call never happened". Calling the
   UNCOLLAPSED function under the identical shape must enter the reader four
   times. */
test('control: the uncollapsed sweep under the same shape enters the reader FOUR times', async () => {
  openai.setFetcher(async () => ({ status: 200, body: {} }));
  const reader = countingReader();
  try {
    const rows = openai.list();
    /* The same work `listLiveNow` does, without the collapse: two independent
       sweeps over the same rows. */
    const sweep = () => Promise.all(rows.map((row) => openai.checkLive(row.dir).catch(() => null)));
    const a = sweep();
    const b = sweep();
    assert.equal(reader.entries(), 4,
      'the uncollapsed control did not run twice, so the sharing assertion above proves nothing');
    reader.release();
    await Promise.all([a, b]);
  } finally { reader.restore(); openai.setFetcher(null); }
});

test('#1618: a caller arriving AFTER the sweep settles gets a fresh one - sharing is not caching', async () => {
  openai.setFetcher(async () => ({ status: 200, body: {} }));
  const real = openai.checkLive;
  let entries = 0;
  openai.checkLive = async (dir) => { entries += 1; return real(dir); };
  try {
    await openai.listLive();
    const afterFirst = entries;
    assert.ok(afterFirst >= 1, 'the first sweep never entered the reader, so this test cannot see a second');

    await openai.listLive();
    assert.equal(entries, afterFirst * 2,
      'the second call was served the first call\'s answer, so this is a cache and it will convert cannot-tell into a confident none');
  } finally { openai.checkLive = real; openai.setFetcher(null); }
});

/* The assertion #1618 records killing the TTL cache, restated against the SHARED
   path specifically. A reader that throws must still produce `unknown`, never a
   confident `none` - and now with a second caller sharing the same sweep, so the
   sharing cannot be what reintroduces it. */
test('#1618: a throwing reader answers unknown for BOTH sharers, never a confident none', async () => {
  writeAuth('.codex-throws', { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-inflightthrowTHRW' });
  openai.setFetcher(async () => ({ status: 200, body: {} }));
  const real = openai.checkLive;
  openai.checkLive = (dir) => (String(dir).includes('throws')
    ? Promise.reject(new Error('boom'))
    : real(dir));
  try {
    const [ra, rb] = await Promise.all([openai.listLive(), openai.listLive()]);
    for (const [who, rows] of [['first', ra], ['second', rb]]) {
      const thrown = rows.find((r) => r.label === 'throws');
      assert.ok(thrown, `the ${who} caller got no row for the throwing account`);
      assert.equal(thrown.connection.state, sub.STATE.UNKNOWN,
        `the ${who} caller was told a confident state for an account we could not read`);
      assert.notEqual(thrown.connection.state, sub.STATE.NONE);
    }
  } finally { openai.checkLive = real; openai.setFetcher(null); }
});
