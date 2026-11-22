'use strict';

/*
 * kosmos#8865 review round 1: the two states report() adds, tested on the real scan rather than on hand-built answers.
 * - `looked` and `unread` never overlap: a locked file is looked at (and named damaged), an unlistable folder is
 *   unread, and looked + unread is exactly what was planted.
 * - `dismissed`: dismiss() sets it, report() carries it with the list emptied, and the next scan clears it.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-storecheck-looked-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const storecheck = require('./storecheck');

const POSIX = process.platform !== 'win32' && process.getuid && process.getuid() !== 0
  ? false : 'file modes are not enforced here (Windows, or running as root)';

test.after(() => {
  try { fs.chmodSync(path.join(store.ROOT, 'profiles'), 0o755); } catch { /* not made */ }
  try { fs.chmodSync(path.join(store.ROOT, 'settings.json'), 0o644); } catch { /* not made */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

function plant() {
  const root = store.ROOT;
  fs.mkdirSync(path.join(root, 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(root, 'projects.json'), JSON.stringify({ projects: [] }));   // good
  fs.writeFileSync(path.join(root, 'removed.json'), '');                                   // damaged (empty)
  fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ a: 1 }));            // locked below
  fs.writeFileSync(path.join(root, 'profiles', 'helper.json'), JSON.stringify({}));        // inside a folder made unlistable below
  return root;
}

test('kosmos#8865: a locked file is looked at and named, an unlistable folder is unread, and the counts never overlap', { skip: POSIX }, () => {
  const root = plant();
  // CONTROL: before anything is locked, all three root files are looked at and the profile too, nothing unread.
  storecheck.scan({});
  const open = storecheck.report();
  assert.equal(open.unread, 0, JSON.stringify(open));
  assert.equal(open.looked, 4, 'the open scan did not count every file: ' + JSON.stringify(open));
  assert.equal(open.damaged, 1);

  fs.chmodSync(path.join(root, 'settings.json'), 0o000);
  fs.chmodSync(path.join(root, 'profiles'), 0o000);
  try {
    storecheck.scan({});
    const r = storecheck.report();
    assert.equal(r.ran, true);
    assert.equal(r.unread, 1, 'the unlistable folder is not counted unread: ' + JSON.stringify(r));
    assert.equal(r.looked, 3, 'the locked file is not counted as looked at, or a file is counted twice: ' + JSON.stringify(r));
    assert.equal(r.damaged, 2, 'the locked file is not named: ' + JSON.stringify(r));
    assert.deepEqual(r.files.map((f) => f.file).sort(), ['removed.json', 'settings.json']);
    assert.equal(r.files.find((f) => f.file === 'settings.json').problem, 'unopenable');
  } finally {
    fs.chmodSync(path.join(root, 'profiles'), 0o755);
    fs.chmodSync(path.join(root, 'settings.json'), 0o644);
  }
});

test('kosmos#8865: dismissed is set by dismiss(), carried by report() with the list emptied, and cleared by the next scan', () => {
  plant();
  storecheck.scan({});
  const before = storecheck.report();
  assert.equal(before.dismissed, false);
  assert.ok(before.files.length > 0, 'CONTROL: there is a list to dismiss: ' + JSON.stringify(before));
  assert.equal(storecheck.dismiss(), true);
  const after = storecheck.report();
  assert.equal(after.dismissed, true);
  assert.deepEqual(after.files, []);
  assert.equal(after.damaged, before.damaged, 'the count of what the start found moved when the list was dismissed');
  storecheck.scan({});
  assert.equal(storecheck.report().dismissed, false, 'a new scan kept the old dismissal');
});

test('kosmos#8865 review 2: a good copy put back is counted, and stays said after the person dismisses the rest', () => {
  const root = plant();
  fs.writeFileSync(path.join(root, 'projects.json'), Buffer.alloc(32));   // all NUL
  fs.writeFileSync(path.join(root, 'projects.json.kosmos-4242-1793000000000-1.tmp'), JSON.stringify({ projects: [] }));   // its good copy
  storecheck.scan({});
  assert.equal(storecheck.report().restored, 0);
  assert.deepEqual(storecheck.restore('projects.json', () => {}), { ok: true });
  assert.equal(storecheck.report().restored, 1);
  storecheck.dismiss();
  const r = storecheck.report();
  assert.equal(r.restored, 1, 'the dismissal lost the count of what was put back');
  assert.equal(r.dismissed, true);
  storecheck.scan({});
  assert.equal(storecheck.report().restored, 0, 'a new scan kept the old count');
});

test('kosmos#8865: before any scan, report() says it did not run and carries no count', () => {
  /* A fresh module instance, so no scan has run in it. */
  delete require.cache[require.resolve('./storecheck')];
  const fresh = require('./storecheck');
  const r = fresh.report();
  assert.equal(r.ran, false);
  assert.equal(r.checked, false);
  assert.equal('looked' in r, false, 'a count was given for a scan that never ran');
  assert.deepEqual(r.files, []);
});
