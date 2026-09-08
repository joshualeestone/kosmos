'use strict';

/**
 * #2439: the AgentWorkforce -> Kosmos store-leaf rename carries a one-time data
 * migration, so an existing install's agents/profiles/avatars follow the rename
 * instead of being orphaned at the old leaf. This pins the whole matrix and the
 * two guarantees that make a rename-on-user-data safe: it NEVER clobbers an
 * existing new store, and it NEVER throws (a failed move leaves the legacy data
 * in place rather than destroying it).
 *
 * The migration fires lazily on the first store access (`store.ROOT` resolves
 * `root()`), so each arm seeds a fresh sandbox, then reads `store.ROOT` to
 * trigger it. A fresh sandbox per arm gives each a distinct resolved root, so
 * the once-per-root guard never carries state between arms.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('./store');

// AGENT_WORKFORCE_DATA makes dataRootFor return `<DATA>/<leaf>` directly on every
// platform, so the roots are `<sandbox>/Kosmos` (new) and `<sandbox>/AgentWorkforce`
// (legacy) regardless of the host OS -- the migration logic is platform-agnostic.
function sandbox() { return fs.mkdtempSync(path.join(os.tmpdir(), 'store-migrate-2439-')); }
function withData(dir, fn) {
  const prev = process.env.AGENT_WORKFORCE_DATA;
  // This suite EXERCISES the migration, so clear the #2439 fleet-safety opt-out that the
  // test harness / a shared box sets to keep un-sandboxed runs from migrating the real
  // store (KOSMOS_NO_LEGACY_MIGRATION). Restore it after, so the ambient env is unchanged.
  const prevNoMig = process.env.KOSMOS_NO_LEGACY_MIGRATION;
  process.env.AGENT_WORKFORCE_DATA = dir;
  delete process.env.KOSMOS_NO_LEGACY_MIGRATION;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_DATA;
    else process.env.AGENT_WORKFORCE_DATA = prev;
    if (prevNoMig === undefined) delete process.env.KOSMOS_NO_LEGACY_MIGRATION;
    else process.env.KOSMOS_NO_LEGACY_MIGRATION = prevNoMig;
  }
}
const legacyLeaf = (dir) => path.join(dir, store.LEGACY_APP);
const newLeaf = (dir) => path.join(dir, store.APP);

test('#2439: a legacy store with no new store is MOVED to the new leaf, intact', () => {
  const dir = sandbox();
  withData(dir, () => {
    const legacy = legacyLeaf(dir);
    fs.mkdirSync(path.join(legacy, 'profiles'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'profiles', 'ben.json'), '{"name":"ben"}');
    // First store access triggers the migration.
    const resolved = store.ROOT;
    assert.equal(resolved, newLeaf(dir), 'root() resolves to the new (Kosmos) leaf');
    assert.equal(fs.existsSync(newLeaf(dir)), true, 'the new store exists after migration');
    assert.equal(fs.readFileSync(path.join(newLeaf(dir), 'profiles', 'ben.json'), 'utf8'), '{"name":"ben"}',
      'the data moved intact under the new leaf');
    assert.equal(fs.existsSync(legacy), false, 'the legacy store was MOVED, not left orphaned');
  });
});

test('#2439: KOSMOS_NO_LEGACY_MIGRATION=1 skips the migration (fleet-safety opt-out; legacy intact, no new leaf)', () => {
  // Sets the opt-out directly (NOT via withData, which clears it), then proves a legacy
  // store is LEFT in place: this is the guard that stops un-sandboxed test runs (and the
  // shared box) from renaming the real fleet store.
  const dir = sandbox();
  const prevData = process.env.AGENT_WORKFORCE_DATA;
  const prevNoMig = process.env.KOSMOS_NO_LEGACY_MIGRATION;
  process.env.AGENT_WORKFORCE_DATA = dir;
  process.env.KOSMOS_NO_LEGACY_MIGRATION = '1';
  try {
    const legacy = legacyLeaf(dir);
    fs.mkdirSync(path.join(legacy, 'profiles'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'profiles', 'ben.json'), '{"name":"ben"}');
    void store.ROOT;  // would MOVE legacy -> new if the opt-out were not honored (see the arm above)
    assert.equal(fs.existsSync(legacy), true, 'the opt-out was ignored: the legacy store was migrated');
    assert.equal(fs.existsSync(newLeaf(dir)), false, 'the opt-out was ignored: a new leaf was created');
    assert.equal(fs.readFileSync(path.join(legacy, 'profiles', 'ben.json'), 'utf8'), '{"name":"ben"}',
      'the legacy data was disturbed while the opt-out was set');
  } finally {
    if (prevData === undefined) delete process.env.AGENT_WORKFORCE_DATA; else process.env.AGENT_WORKFORCE_DATA = prevData;
    if (prevNoMig === undefined) delete process.env.KOSMOS_NO_LEGACY_MIGRATION; else process.env.KOSMOS_NO_LEGACY_MIGRATION = prevNoMig;
  }
});

test('#2439: an existing new store with no legacy is left untouched', () => {
  const dir = sandbox();
  withData(dir, () => {
    fs.mkdirSync(newLeaf(dir), { recursive: true });
    fs.writeFileSync(path.join(newLeaf(dir), 'm.txt'), 'already');
    void store.ROOT;
    assert.equal(fs.readFileSync(path.join(newLeaf(dir), 'm.txt'), 'utf8'), 'already', 'the new store is untouched');
    assert.equal(fs.existsSync(legacyLeaf(dir)), false, 'no legacy leaf was created');
  });
});

test('#2439: when BOTH stores exist, the NEW one wins and the legacy is NOT clobbered or deleted', () => {
  const dir = sandbox();
  withData(dir, () => {
    fs.mkdirSync(legacyLeaf(dir), { recursive: true }); fs.writeFileSync(path.join(legacyLeaf(dir), 'm.txt'), 'OLD');
    fs.mkdirSync(newLeaf(dir), { recursive: true }); fs.writeFileSync(path.join(newLeaf(dir), 'm.txt'), 'NEW');
    void store.ROOT;
    assert.equal(fs.readFileSync(path.join(newLeaf(dir), 'm.txt'), 'utf8'), 'NEW',
      'the new store was kept, never overwritten by the legacy');
    assert.equal(fs.existsSync(legacyLeaf(dir)), true, 'the legacy store was left in place, never deleted');
    assert.equal(fs.readFileSync(path.join(legacyLeaf(dir), 'm.txt'), 'utf8'), 'OLD', 'the legacy store was not touched');
  });
});

test('#2439: a fresh install (neither store present) resolves to the new leaf and creates no legacy', () => {
  const dir = sandbox();
  withData(dir, () => {
    assert.equal(store.ROOT, newLeaf(dir), 'resolves to the new (Kosmos) leaf');
    // root() resolves but does not create the dir (ensure() does); the migration
    // must not have manufactured a legacy leaf out of nothing.
    assert.equal(fs.existsSync(legacyLeaf(dir)), false, 'no legacy leaf created on a fresh install');
  });
});

test('#2439: a failed move (e.g. EXDEV) NEVER throws and leaves the legacy data intact', () => {
  const dir = sandbox();
  withData(dir, () => {
    const legacy = legacyLeaf(dir);
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'm.txt'), 'safe');
    const realRename = fs.renameSync;
    fs.renameSync = () => { const e = new Error('EXDEV: cross-device link'); e.code = 'EXDEV'; throw e; };
    try {
      assert.doesNotThrow(() => { void store.ROOT; }, 'a failed migration must never crash the app');
      assert.equal(fs.existsSync(legacy), true, 'the legacy store is left intact when the move fails (non-destructive)');
      assert.equal(fs.readFileSync(path.join(legacy, 'm.txt'), 'utf8'), 'safe', 'no data is lost on a failed migration');
    } finally { fs.renameSync = realRename; }
  });
});
