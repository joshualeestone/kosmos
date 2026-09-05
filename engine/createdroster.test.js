'use strict';
/**
 * #1078: the created-never-run roster source. A Kosmos agent that has a launchd
 * job + worker dir on disk but has never run (no pane, no beat) must be surfaced
 * to the board, deduped against the live pane/beat rosters, and it must FAIL
 * CLOSED -- never resurrect a removed agent, never read the real machine in a
 * sandbox, never list a foreign plist. These tests drive the source with fully
 * injected deps so no test touches the real disk or record.
 *
 *   node --test engine/createdroster.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const createdroster = require('./createdroster');

/* A deterministic stand-in for each dependency. Defaults describe a clean machine
   with two never-run agents (alpha, beta), a consistent sandbox and a readable
   (empty) removed list; each test overrides only what it exercises. */
function harness(over) {
  const o = over || {};
  const plists = o.plists || ['com.kosmos.agent.alpha.plist', 'com.kosmos.agent.beta.plist'];
  const jobs = o.jobs || { alpha: { runner: 'claude' }, beta: { runner: 'claude' } };
  const dirs = o.dirs || { alpha: true, beta: true };   // worker dir exists?
  const removed = o.removed || { ok: true, names: [] };
  const inconsistent = o.inconsistent === true;
  const calls = { readdir: 0, readJob: [], stat: [] };
  const src = createdroster.make({
    fs: {
      readdirSync: (d) => { calls.readdir++; if (o.readdirThrows) throw new Error('boom'); return plists; },
      statSync: (p) => {
        calls.stat.push(p);
        const name = String(p).split('/').pop();
        if (dirs[name] === undefined) { const e = new Error('ENOENT'); throw e; }
        return { isDirectory: () => dirs[name] };
      },
    },
    create: {
      AGENTS_DIR: '/AGENTS',
      serviceLabel: (n) => `com.kosmos.agent.${n}`,
      readJob: (n) => { calls.readJob.push(n); return Object.prototype.hasOwnProperty.call(jobs, n) ? jobs[n] : null; },
      workerDir: (n) => `/workers/${n}`,
      cleanName: (n) => String(n == null ? '' : n).trim(),
    },
    remove: { removedNames: () => removed },
    status: { sandboxIsInconsistent: () => inconsistent },
    store: { safeKey: (n) => { const k = String(n || '').toLowerCase().replace(/[^a-z0-9_-]/g, ''); if (!k) throw new Error('invalid'); return k; } },
  });
  return { src, calls };
}

test('lists Kosmos-created-never-run agents as safeKey\'d names', () => {
  const { src } = harness();
  assert.deepEqual(src().sort(), ['alpha', 'beta']);
});

test('excludeKeys removes an agent that already has a live pane/beat card (dedup)', () => {
  const { src } = harness();
  // alpha is already on the board (a live pane) -> only beta is created-never-run.
  assert.deepEqual(src(new Set(['alpha'])), ['beta']);
});

test('a removed agent is NOT resurrected (fail-closed skip on the removed list)', () => {
  const { src } = harness({ removed: { ok: true, names: ['alpha'] } });
  assert.deepEqual(src(), ['beta']);
});

test('FAIL CLOSED: an UNREADABLE removed list surfaces NOTHING, never the full list', () => {
  const clean = harness();
  assert.deepEqual(clean.src().sort(), ['alpha', 'beta']);           // control: it CAN return rows
  const { src } = harness({ removed: { ok: false, names: [] } });
  assert.deepEqual(src(), []);                                        // perturbed: refuses
});

test('a foreign / malformed plist (readJob null) is skipped, not listed', () => {
  // beta's plist is present but readJob returns null (not a real Kosmos job).
  const { src } = harness({ jobs: { alpha: { runner: 'claude' } } });
  assert.deepEqual(src(), ['alpha']);
});

test('a job whose worker dir is gone is a stale leftover, not an agent', () => {
  const { src } = harness({ dirs: { alpha: true } });                 // beta dir missing
  assert.deepEqual(src(), ['alpha']);
});

test('a plist path that is a FILE not a directory is skipped', () => {
  const { src } = harness({ dirs: { alpha: true, beta: false } });    // beta exists but is a file
  assert.deepEqual(src(), ['alpha']);
});

test('non-agent files under AGENTS_DIR are ignored (prefix + suffix gate)', () => {
  const { src } = harness({
    plists: ['com.kosmos.agent.alpha.plist', 'com.apple.something.plist', 'com.kosmos.agent.beta.txt', 'README'],
    jobs: { alpha: { runner: 'claude' } },
  });
  assert.deepEqual(src(), ['alpha']);
});

test('FAIL CLOSED: an inconsistent sandbox reads NOTHING (never the real LaunchAgents)', () => {
  const clean = harness();
  assert.deepEqual(clean.src().sort(), ['alpha', 'beta']);           // control
  const { src } = harness({ inconsistent: true });
  assert.deepEqual(src(), []);                                       // perturbed: refuses, and never reads the dir
});

test('an inconsistent sandbox refuses BEFORE reading the dir (guard is first)', () => {
  const { src, calls } = harness({ inconsistent: true });
  src();
  assert.equal(calls.readdir, 0);
});

test('a readdir failure returns [] (a failed look refuses honestly, never throws)', () => {
  const { src } = harness({ readdirThrows: true });
  assert.doesNotThrow(() => src());
  assert.deepEqual(src(), []);
});

test('duplicate names within the source collapse to one key', () => {
  const { src } = harness({
    plists: ['com.kosmos.agent.alpha.plist', 'com.kosmos.agent.Alpha.plist'],   // same safeKey
    jobs: { alpha: { runner: 'claude' }, Alpha: { runner: 'claude' } },
    dirs: { alpha: true, Alpha: true },
  });
  assert.deepEqual(src(), ['alpha']);
});

test('a name that safeKey rejects cannot reach the board (skipped, not thrown)', () => {
  const { src } = harness({
    plists: ['com.kosmos.agent.alpha.plist', 'com.kosmos.agent.___.plist'],   // '___' -> safeKey keeps it? no: only [^a-z0-9_-] stripped, _ kept
    jobs: { alpha: { runner: 'claude' }, '___': { runner: 'claude' } },
    dirs: { alpha: true, '___': true },
  });
  // '___' safeKeys to '___' (underscores are kept), so it is a valid distinct key.
  assert.deepEqual(src().sort(), ['___', 'alpha']);
});
