const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const update = require('./update');

// #2055: updateAbort() reads the durable stopped-at-the-pause marker setup.sh writes (#4675: four reasons)
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

// #4675: `same` says how many of the latest stops shared the reason. It is null only when the line is missing
// altogether (a marker from before it existed), which the page takes as "every stop was this one" for
// board-would-not-pause, the one reason such a marker could hold. A same line that is there but unreadable is 0.
test('updateAbort: same is a number, null when the line is missing, and 0 when it is there but unreadable', () => {
  withRoot((root) => {
    writeMarker(root, 'count=5\nreason=port-still-held\nsame=2\nport=16180\nts=x\n');
    assert.deepEqual(update.updateAbort(), { count: 5, reason: 'port-still-held', same: 2, port: '16180', ts: 'x' });
    writeMarker(root, 'count=5\nreason=board-would-not-pause\nport=16180\n');
    assert.equal(update.updateAbort().same, null);
    for (const bad of ['lots', '', '08', '0', '99999999999999999999', '1e3', '-1', ' 3', '3\r', '6']) {
      writeMarker(root, 'count=5\nreason=port-still-held\nsame=' + bad + '\n');
      assert.equal(update.updateAbort().same, 0, 'same=' + JSON.stringify(bad) + ' was not read as unknown');
    }
    writeMarker(root, 'count=5\nreason=port-still-held\nsame=2\nsame=3\n');
    assert.equal(update.updateAbort().same, 0, 'a same line written twice was taken as a number');
    writeMarker(root, 'count=5\nreason=port-still-held\nsame=5\n');
    assert.equal(update.updateAbort().same, 5, 'same equal to count is valid');
  });
});

// #4675: the count is read by the same rule setup.sh uses (1 to 9 digits, no leading zero), so the board never shows
// a number the installer would throw away at the next stop. NUMBER_CASES is also what tools/test-update-abort-2055.sh
// runs against the installer's own function: the two lists are kept the same by the test below.
const NUMBER_CASES = { good: ['1', '7', '999999999'], bad: ['', '0', '08', '0099', '1e3', '0x10', '-1', '+2', ' 3', '3 ', '3\r', '1000000000', '99999999999999999999', 'lots'] };
test('updateAbort: a count the installer would treat as damaged is not shown', () => {
  withRoot((root) => {
    for (const good of NUMBER_CASES.good) {
      writeMarker(root, 'count=' + good + '\nreason=port-still-held\nsame=1\n');
      assert.equal(update.updateAbort().count, Number(good));
    }
    for (const bad of NUMBER_CASES.bad) {
      writeMarker(root, 'count=' + bad + '\nreason=port-still-held\nsame=1\n');
      assert.equal(update.updateAbort(), null, 'count=' + JSON.stringify(bad) + ' was shown');
    }
    writeMarker(root, 'count=3\ncount=4\nreason=port-still-held\nsame=1\n');
    assert.equal(update.updateAbort(), null, 'a count written twice was shown');
    writeMarker(root, 'count=3\nreason=port-still-held\nreason=board-would-not-pause\nsame=1\n');
    assert.equal(update.updateAbort().reason, 'unknown', 'a reason written twice was taken as a reason');
    writeMarker(root, 'count=3\nconstructor=x\ntostring=y\nreason=port-still-held\n');
    assert.equal(update.updateAbort().count, 3, 'an unrelated key broke the read');
  });
});

test('the installer test runs the same number cases against setup.sh (one rule, two readers)', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'tools', 'test-update-abort-2055.sh'), 'utf8');
  const list = (name) => { const m = new RegExp('^' + name + "='([^']*)'$", 'm').exec(sh); assert.ok(m, name + ' not found in the shell test'); return m[1].split('|'); };
  const printable = (s) => s.replace(/\r/g, '\\r');
  assert.deepEqual(list('NUMBER_GOOD'), NUMBER_CASES.good);
  assert.deepEqual(list('NUMBER_BAD'), NUMBER_CASES.bad.map(printable));
});
