'use strict';
/**
 * kosmos#1945: A HEADLESS BOARD NEVER UPDATED. `update.poke()` is the only thing
 * that fetches latest.json and can fire an auto-install, and its only other
 * caller is the /api/status route -- which runs only while someone has the
 * dashboard open. A board nobody looks at never poked, never learned a release
 * existed, and ran old code forever; the more stable the install, the more stale
 * it got (mechanism confirmed by Splinter2 with a registered prediction: sending
 * status requests to a stale headless board took it 0.6.22 -> 0.6.24 with no
 * restart, twelve seconds after the cache TTL expired).
 *
 * The fix is a timer that drives poke() without a viewer. Two halves, each pinned
 * here (the same shape as tools.all-node-tests-considered's guard + shape-pin):
 *   1. engine/update.startPolling(intervalMs) drives poke() on a timer. The unit
 *      test injects a fetcher and asserts a viewer-less look actually fetches,
 *      and that poke() stays TTL-gated so the cadence does not hammer the host.
 *   2. server.js start() calls updates.startPolling, so the board arms it on
 *      boot. Pinned by the call's SHAPE in the source, so the wiring cannot be
 *      silently dropped back to the viewer-only /api/status poke.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const updates = require('./engine/update');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('#1945: startPolling makes a viewer-less board fetch latest.json on a timer', async () => {
  updates.resetCache();
  let fetches = 0;
  updates.setFetcher(async () => {
    fetches += 1;
    return { ok: true, json: async () => ({ version: '0.0.1' }) };
  });
  const handle = updates.startPolling(20);
  try {
    await sleep(160);
    assert.ok(fetches >= 1,
      `a viewer-less board never fetched: startPolling did not drive poke() (fetches=${fetches})`);
  } finally {
    clearInterval(handle);
    updates.setFetcher(null);
    updates.resetCache();
  }
});

test('#1945: poke() stays TTL-gated, so a fast cadence does not hammer the release host', async () => {
  updates.resetCache();
  let fetches = 0;
  updates.setFetcher(async () => {
    fetches += 1;
    return { ok: true, json: async () => ({ version: '0.0.1' }) };
  });
  // ~8 timer ticks in the window; poke() must fetch only ONCE (the TTL is 15 min,
  // far outside this window), or a headless board would curl the host every tick.
  const handle = updates.startPolling(20);
  try {
    await sleep(160);
    assert.equal(fetches, 1,
      `poke() is not TTL-gated: ${fetches} fetches from ~8 ticks would hammer the release host`);
  } finally {
    clearInterval(handle);
    updates.setFetcher(null);
    updates.resetCache();
  }
});

test('#1945: server.js arms the update poll in start(), so the fix is wired and not viewer-only', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(src, /updates\.startPolling\(/,
    'server.js no longer calls updates.startPolling: a headless board is back to viewer-only /api/status poking (#1945)');
});

test('#1945: startPolling returns an unref-able handle that never holds the process open', () => {
  updates.resetCache();
  updates.setFetcher(async () => ({ ok: true, json: async () => ({ version: '0.0.1' }) }));
  const handle = updates.startPolling(60 * 1000);
  try {
    assert.equal(typeof handle.unref, 'function',
      'the poll handle is not a timer that can be unref-ed / cleared');
  } finally {
    clearInterval(handle);
    updates.setFetcher(null);
    updates.resetCache();
  }
});
