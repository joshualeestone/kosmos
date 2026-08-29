'use strict';

/**
 * #1443: the data root was frozen at require time, so a late sandbox seam read
 * the operator's real machine.
 *
 *   node --test engine/store.lazyroot-1443.test.js
 *
 * 🛑 WHAT WAS MEASURED, BOTH ARMS. With `AGENT_WORKFORCE_DATA` set AFTER this
 * module was required, `store.ROOT` still answered
 * `~/Library/Application Support/AgentWorkforce`. Every fixture that sets the
 * variable at the top of its own file was fine. Every fixture that sets it
 * inside a `before`, inside a helper, or after ANY other module had already
 * pulled `store` in, was writing to the real machine while believing it was
 * sandboxed.
 *
 * ⭐ AND THE ORDER IS NOT A PROPERTY OF THE TEST FILE. `ping.js` requires
 * `store` at its own top for `ROOT`, so a fixture that requires anything which
 * transitively requires `ping` has already frozen the root before its own first
 * line runs. That is why "set it at the top" was never a rule anyone could
 * follow reliably.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

/* Required ONCE, at the top, deliberately: the whole defect is about what
   happens to a module that is already loaded. Re-requiring per assertion would
   hide it. */
const store = require('./store');

function withData(v, fn) {
  const saved = process.env.AGENT_WORKFORCE_DATA;
  if (v === undefined) delete process.env.AGENT_WORKFORCE_DATA;
  else process.env.AGENT_WORKFORCE_DATA = v;
  try { return fn(); }
  finally {
    if (saved === undefined) delete process.env.AGENT_WORKFORCE_DATA;
    else process.env.AGENT_WORKFORCE_DATA = saved;
  }
}

test('🛑 a sandbox set AFTER the require is honoured', () => {
  const got = withData('/tmp/late-sandbox-1443', () => store.ROOT);
  assert.match(got, /late-sandbox-1443/,
    'ROOT was frozen at require time, so a fixture that sandboxes late writes to the real machine');
  assert.doesNotMatch(got, /Application Support/, 'the real data directory is still being reached');
});

test('the DERIVED paths move too, which is the half that is easy to miss', () => {
  /* Making ROOT lazy and leaving AVATARS/PROFILES as `path.join(ROOT, ...)` at
     module level re-freezes it one line down, and the fix LOOKS done. */
  withData('/tmp/late-sandbox-1443', () => {
    assert.match(store.AVATARS, /late-sandbox-1443/, 'AVATARS is still frozen');
    assert.match(store.PROFILES, /late-sandbox-1443/, 'PROFILES is still frozen');
  });
});

test('CONTROL: with no sandbox it is the real per-platform location', () => {
  /* Without this, "always return a temp path" passes everything above. */
  const got = withData(undefined, () => store.ROOT);
  assert.equal(got, store.dataRootFor(process.platform, os.homedir(), {}),
    'the unsandboxed root no longer matches the platform rule');
  assert.doesNotMatch(got, /late-sandbox/, 'a previous test leaked into the unsandboxed answer');
});

test('CONTROL: it changes BACK, so it is resolved per call and not cached once', () => {
  /* A one-shot memoisation would pass every assertion above and still freeze on
     the first read, which is the same defect with a slower fuse. */
  const a = withData('/tmp/aaa-1443', () => store.ROOT);
  const b = withData('/tmp/bbb-1443', () => store.ROOT);
  assert.match(a, /aaa-1443/);
  assert.match(b, /bbb-1443/, 'the root was cached on first read, which is the same freeze one call later');
});

test('the exports still look like plain properties to 39 files', () => {
  /* 94 references across 39 files read `store.ROOT`. They must keep working
     unchanged, and anything that spreads or enumerates the module must see the
     same keys it saw before. */
  for (const k of ['ROOT', 'AVATARS', 'PROFILES']) {
    assert.ok(Object.keys(store).includes(k), k + ' is no longer enumerable, so {...store} lost it');
    assert.equal(typeof store[k], 'string', k + ' no longer reads as a path');
  }
  const spread = { ...store };
  assert.equal(typeof spread.ROOT, 'string', 'spreading the module no longer carries ROOT');
});

test('CONTROL: the getters are reached through the real module, not a local copy', () => {
  const again = require('./store');
  assert.equal(again, store, 'the module cache was bypassed, so these assertions are about a second instance');
  assert.match(withData('/tmp/zzz-1443', () => again.ROOT), /zzz-1443/);
});
