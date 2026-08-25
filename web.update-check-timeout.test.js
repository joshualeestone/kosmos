'use strict';
/* #788: the manual Check for Update's ten-second timer must cover the whole
   round trip. It once covered fetch() alone and was cleared the moment headers
   arrived, so a body that never completed (the board killed by the update the
   check found) left the line on "Checking." with its button disabled forever.
   Static: the order of the calls in the handler's source. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const start = raw.indexOf('async function updCheckNowClick()');
assert.ok(start > -1, 'updCheckNowClick moved; re-point this test');
const fn = raw.slice(start, raw.indexOf('\n}\n', start) + 3);

test('#788: the abort timer is cleared only AFTER the body is read, so a hung body resolves the line', () => {
  const fetchAt = fn.indexOf("fetch('/api/update/check'");
  const jsonAt = fn.indexOf('await res.json()');
  const clearAt = fn.indexOf('clearTimeout(timer)');
  assert.ok(fetchAt > -1 && jsonAt > -1 && clearAt > -1, 'the handler no longer has the fetch, the body read and the timer clear');
  assert.ok(clearAt > jsonAt, 'clearTimeout runs before res.json(): a body that never completes hangs the line on Checking.');
  assert.equal(fn.split('clearTimeout(timer)').length - 1, 1, 'more than one clearTimeout: one of them may still fire before the body');
  assert.ok(fn.includes("signal: ctl.signal"), 'the fetch no longer carries the abort signal');
});

test('#788: on timeout the line says it could not check, and offers Try again', () => {
  assert.match(fn, /Could not check just now\./);
  assert.match(fn, /'Try again'/);
});
