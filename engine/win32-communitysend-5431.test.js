'use strict';
/**
 * kosmos#5431 on a real disk, selected for the Windows run by its name (tools/windows-tests.js runs every test file
 * with "win32" in it). The card's tear was on NTFS, and engine/communitysend.test.js only simulates the error codes:
 * this file runs the real save (the fsync and the unchanged-bytes skip) and the torn-record reset with no agent key,
 * on whatever disk the run is on, so the Windows job measures them on NTFS. The other arms (a key exists, a retired
 * account, a torn keys.json, the lengths that are not reset) are engine/communitysend.test.js's, run on the Mac.
 *
 *   node --test engine/win32-communitysend-5431.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-5431-disk-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const cs = require('./communitysend');
// os.tmpdir() reads TEMP on Windows, which tmpscope does not move, so this sandbox is removed here, with retries for a
// handle Windows releases late (as engine/win32apply.test.js does).
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

test('#5431 on this disk: a save writes the record, and the same bytes again write nothing', () => {
  const file = cs._paths.sentFile();
  cs._saveJsonForTest(file, { a: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 }, 'the save did not land');
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith('.tmp')), [], 'a temp file was left');
  const realRename = fs.renameSync;
  let renamed = 0;
  fs.renameSync = (...a) => { renamed += 1; return realRename(...a); };
  try {
    cs._saveJsonForTest(file, { a: 1 });
    // Off Windows the skip also needs the owner-only mode, which saveJson itself set; on Windows there is no mode.
    assert.equal(renamed, 0, 'an unchanged save rewrote the file');
    cs._saveJsonForTest(file, { a: 2 });
    assert.equal(renamed, 1, 'control: a changed save renames once');
  } finally { fs.renameSync = realRename; }
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 2 });
});

test('#5431 on this disk: a sent.json torn to 3 NUL bytes is reset when no agent has a key', async () => {
  const file = cs._paths.sentFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(cs._paths.keysFile(), { force: true });
  fs.writeFileSync(file, Buffer.alloc(3));
  assert.deepEqual([...fs.readFileSync(file)], [0, 0, 0], 'control: the torn shape is on the disk');
  await cs.sweep();                     // every exclusive section starts with the repair, even one that sends nothing
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {}, 'the torn sent.json was not reset');
});
