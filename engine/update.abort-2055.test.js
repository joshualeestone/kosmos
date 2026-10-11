const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const update = require('./update');

// #2055: updateAbort() reads the durable board-would-not-pause marker setup.sh writes
// at <installedRoot>/logs/update-abort. A STUCK machine (marker with count>0) reads its
// count; a healthy one (no marker / cleared / count 0) reads null. The null-on-healthy
// case IS the card's required control: the surface must not claim a healthy machine is
// failing.

function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-2055-'));
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  update.setInstalledRoot(() => root);
  try { return fn(root); } finally { update.setInstalledRoot(null); }
}
function writeMarker(root, body) {
  fs.writeFileSync(path.join(root, 'logs', 'update-abort'), body);
}

test('updateAbort: a stuck machine reports its consecutive count and reason', () => {
  withRoot((root) => {
    writeMarker(root, 'count=3\nreason=board-would-not-pause\nport=16180\nts=2026-09-03T17:00:00Z\n');
    const a = update.updateAbort();
    assert.ok(a, 'expected a non-null abort record');
    assert.equal(a.count, 3);
    assert.equal(a.reason, 'board-would-not-pause');
    assert.equal(a.port, '16180');
    assert.equal(a.ts, '2026-09-03T17:00:00Z');
  });
});

test('updateAbort: count=1 (the first abort) is reported', () => {
  withRoot((root) => {
    writeMarker(root, 'count=1\nreason=board-would-not-pause\nport=16180\n');
    assert.equal(update.updateAbort().count, 1);
  });
});

test('updateAbort: NO marker means not stuck (the healthy-machine control)', () => {
  withRoot(() => {
    assert.equal(update.updateAbort(), null);
  });
});

test('updateAbort: a cleared marker (count=0) reads not stuck', () => {
  withRoot((root) => {
    writeMarker(root, 'count=0\nreason=board-would-not-pause\n');
    assert.equal(update.updateAbort(), null);
  });
});

test('updateAbort: a garbage or blank count reads not stuck, never throws', () => {
  withRoot((root) => {
    writeMarker(root, 'count=not-a-number\nreason=x\n');
    assert.equal(update.updateAbort(), null);
    writeMarker(root, 'reason=x\n');           // no count line at all
    assert.equal(update.updateAbort(), null);
    writeMarker(root, '');                      // empty file
    assert.equal(update.updateAbort(), null);
  });
});

test('updateAbort: null when there is no installed root (source checkout)', () => {
  update.setInstalledRoot(() => null);
  try {
    assert.equal(update.updateAbort(), null);
  } finally {
    update.setInstalledRoot(null);
  }
});

test('updateAbort: missing optional fields default cleanly, count still drives it', () => {
  withRoot((root) => {
    writeMarker(root, 'count=7\n');   // reason/port/ts absent
    const a = update.updateAbort();
    assert.equal(a.count, 7);
    assert.equal(a.reason, 'unknown');
    assert.equal(a.port, null);
    assert.equal(a.ts, null);
  });
});

// #4675: `same` says how many of the latest stops shared the reason. Absent (a marker from before it existed) or
// damaged reads null, which the page takes as "all of them" only for board-would-not-pause, the one reason such a
// marker could hold.
test('updateAbort: same is passed through as a number, and is null when absent or not a number', () => {
  withRoot((root) => {
    writeMarker(root, 'count=5\nreason=port-still-held\nsame=2\nport=16180\nts=x\n');
    assert.deepEqual(update.updateAbort(), { count: 5, reason: 'port-still-held', same: 2, port: '16180', ts: 'x' });
    writeMarker(root, 'count=5\nreason=board-would-not-pause\nport=16180\n');
    assert.equal(update.updateAbort().same, null);
    writeMarker(root, 'count=5\nreason=port-still-held\nsame=lots\n');
    assert.equal(update.updateAbort().same, null);
    writeMarker(root, 'count=5\nreason=port-still-held\nsame=\n');
    assert.equal(update.updateAbort().same, null);
  });
});
