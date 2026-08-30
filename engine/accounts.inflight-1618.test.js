'use strict';
/**
 * #1618: the Claude-account sweep is collapsed too, not only the OpenAI one.
 *
 * 🛑 THIS FILE EXISTS BECAUSE I NEARLY SKIPPED IT ON AN ASSUMPTION OF SYMMETRY.
 * The route asks both engines together, so collapsing only one halves nothing:
 * two concurrent requests would still run two full `claude auth status` sweeps.
 * Breaking one site proves a test can fail; it never proves which sites are
 * covered.
 *
 * ⚠️ AND IT CARRIES A POPULATION FLOOR, because my first attempt at this check
 * was a throwaway probe in an empty sandbox: it found ZERO accounts, compared
 * `0 === 0`, and printed COLLAPSED? YES. A sharing assertion counted against an
 * empty population is true for the wrong reason, and it reads exactly like a
 * pass. The floor below is what stops that.
 *
 *   node --test engine/accounts.inflight-1618.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-accounts-inflight-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
const accounts = require('./accounts');
const subscription = require('./subscription');

const write = (rel, obj) => {
  const p = nodePath.join(SANDBOX, rel);
  fs.mkdirSync(nodePath.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
};

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

fs.mkdirSync(nodePath.join(SANDBOX, '.claude', 'projects'), { recursive: true });
write('.claude.json', { oauthAccount: { emailAddress: 'one@example.com' } });
fs.mkdirSync(nodePath.join(SANDBOX, '.claude-two', 'projects'), { recursive: true });
write('.claude-two/.claude.json', { oauthAccount: { emailAddress: 'two@example.com' } });

/* 🛑 THE FLOOR, AT MODULE SCOPE, BEFORE ANY TEST RUNS. Every assertion below
   counts reader entries against this number, so a sandbox that produced no
   accounts would make all of them vacuously true. */
const ROWS = accounts.list().length;
assert.equal(ROWS, 2, `the sandbox produced ${ROWS} accounts, not 2, so every count below would be measured against the wrong population`);

function countingReader() {
  const real = subscription.checkLive;
  let entries = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  subscription.checkLive = async () => { entries += 1; await gate; return { state: subscription.STATE.UNKNOWN, plan: null, checkedLive: true }; };
  return { entries: () => entries, release, restore: () => { subscription.checkLive = real; } };
}

test('#1618: two callers arriving together run the Claude sweep ONCE', async () => {
  const reader = countingReader();
  try {
    const a = accounts.listLive();
    const b = accounts.listLive();
    assert.equal(reader.entries(), ROWS,
      `the second caller started its own sweep: ${reader.entries()} reader entries for ${ROWS} accounts, expected ${ROWS}`);

    reader.release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(reader.entries(), ROWS, 'a further sweep ran after the sharers attached');
    assert.equal(ra.length, ROWS);
    assert.deepEqual(ra.map((r) => r.email), rb.map((r) => r.email), 'the two callers were handed different lists');
  } finally { reader.restore(); }
});

/* The control: the same concurrent shape without the collapse must enter the
   reader twice as often. Without this, `entries === ROWS` is equally consistent
   with the second call never having happened. */
test('control: the uncollapsed shape enters the reader twice as often', async () => {
  const reader = countingReader();
  try {
    const rows = accounts.list();
    const sweep = () => Promise.all(rows.map((row) => subscription.checkLive({ configDir: row.dir })));
    const a = sweep();
    const b = sweep();
    assert.equal(reader.entries(), ROWS * 2,
      'the uncollapsed control did not run twice, so the sharing assertion above proves nothing');
    reader.release();
    await Promise.all([a, b]);
  } finally { reader.restore(); }
});

test('#1618: a caller after the sweep settles gets a fresh one - sharing is not caching', async () => {
  const real = subscription.checkLive;
  let entries = 0;
  subscription.checkLive = async () => { entries += 1; return { state: subscription.STATE.UNKNOWN, plan: null, checkedLive: true }; };
  try {
    await accounts.listLive();
    assert.equal(entries, ROWS, 'the first sweep did not enter the reader once per account');
    await accounts.listLive();
    assert.equal(entries, ROWS * 2,
      'the second call reused the first answer, so this is a cache and it will convert cannot-tell into a confident none');
  } finally { subscription.checkLive = real; }
});

/* The three-state rule, asserted against the SHARED path: a reader that throws
   must give both sharers `unknown`, never a confident `none`. */
test('#1618: a throwing reader answers unknown for BOTH sharers, never none', async () => {
  const real = subscription.checkLive;
  subscription.checkLive = () => Promise.reject(new Error('boom'));
  try {
    const [ra, rb] = await Promise.all([accounts.listLive(), accounts.listLive()]);
    for (const [who, rows] of [['first', ra], ['second', rb]]) {
      assert.equal(rows.length, ROWS, `the ${who} caller got ${rows.length} rows, not ${ROWS}`);
      for (const row of rows) {
        assert.equal(row.connection.state, subscription.STATE.UNKNOWN,
          `the ${who} caller was told a confident state for an account we could not read`);
        assert.notEqual(row.connection.state, subscription.STATE.NONE);
      }
    }
  } finally { subscription.checkLive = real; }
});
