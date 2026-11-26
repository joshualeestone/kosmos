'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#8685: the Windows CLI's limits for `kosmos agent delete-leftovers` cover the engine waits they sit in front of.
 * The plan limit must outlast one process listing and the drive probe; the delete limit must outlast two listings, the
 * probe and ONE Recycle Bin move (the folder's). A CLI limit shorter than the work reads as a failed delete that in fact
 * went ahead. NOT COVERED: a delete also moves each stored record (settings, every picture file) with its own 120 s
 * limit, so a delete whose every move sits behind a hidden dialog can outlast the CLI; that gap is on kosmos#8685.
 * Read from the sources, since the listing's and the move's limits are literals there, not exports.
 *
 *   node --test cli.leftover-limits-8685.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
function number(text, re, what) {
  const m = text.match(re);
  assert.ok(m, `could not find ${what}; if it moved, point this test at its new spelling`);
  return Number(m[1]);
}

const cli = read('tools/windows/kosmos-cli.js');
const leftover = read('engine/delete-leftover.js');
const status = read('engine/status.js');

const PLAN_MS = number(cli, /const LEFTOVER_PLAN_TIMEOUT_MS = (\d+);/, 'the CLI plan limit');
const DELETE_MS = number(cli, /const LEFTOVER_DELETE_TIMEOUT_MS = (\d+);/, 'the CLI delete limit');
const LISTING_MS = number(status, /WIN32_FOLDER_SCRIPT\], (\d+)\]/, 'the Windows process listing limit');
const PROBE_MS = number(leftover, /const DRIVE_WARM_TIMEOUT_MS = (\d+);/, 'the drive probe limit');
const RECYCLE_MS = number(leftover, /const RECYCLE_TIMEOUT_MS = (\d+);/, 'the Recycle Bin move limit');

test('#8685 the plan limit outlasts one process listing and the drive probe', () => {
  assert.ok(PLAN_MS > LISTING_MS + PROBE_MS,
    `the CLI gives the plan ${PLAN_MS} ms, but a listing (${LISTING_MS}) and the probe (${PROBE_MS}) can take longer`);
});

test('#8685 the delete limit outlasts two listings, the drive probe and one Recycle Bin move', () => {
  const work = 2 * LISTING_MS + PROBE_MS + RECYCLE_MS;
  assert.ok(DELETE_MS > work, `the CLI gives the delete ${DELETE_MS} ms, but its waits add up to ${work} ms`);
});

test('#8685 CONTROL: the read numbers are the ones the comments name (so a regex that matched the wrong line shows)', () => {
  assert.deepEqual([LISTING_MS, PROBE_MS, RECYCLE_MS], [15000, 20000, 120000],
    'an engine limit changed (or the regex found another line): check the CLI limits still cover it, then update this');
});
