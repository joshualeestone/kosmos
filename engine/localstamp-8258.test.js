'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');

const MODULE = path.join(__dirname, 'localstamp.js');
const inZone = (tz, iso) => cp.execFileSync(process.execPath, ['-e',
  'process.stdout.write(require(process.argv[1]).localStamp(Date.parse(process.argv[2])))', MODULE, iso],
{ env: { PATH: process.env.PATH, TZ: tz }, encoding: 'utf8' });

test('kosmos#8258: an evening six hours behind UTC keeps its own date', () => {
  assert.equal(inZone('America/Chicago', '2026-11-07T02:25:31.000Z'), '2026-11-06 20:25:31');
});

test('kosmos#8258: CONTROL, the same moment in UTC is the next day, so the zone is what moved it', () => {
  assert.equal(inZone('UTC', '2026-11-07T02:25:31.000Z'), '2026-11-07 02:25:31');
});

test('kosmos#8258: a zone ahead of UTC is on the following date', () => {
  assert.equal(inZone('Asia/Tokyo', '2026-11-06T20:25:31.000Z'), '2026-11-07 05:25:31');
});
