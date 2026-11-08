'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');

const { stampWords, localDay, localStamp } = require('./localstamp');

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

test('kosmos#8258: stampWords refuses what is not a real stored instant', () => {
  for (const bad of ['2026-13-45T10:00:00Z', '2026-02-30T10:00:00Z', '2026-10-25T25:00:00Z', '2026-10-25 10:00:00', '', null, undefined, 7]) {
    assert.equal(stampWords(bad), null, String(bad));
  }
  assert.match(stampWords('2026-02-28T10:00:00.000Z'), / local \(2026-02-28 10:00:00Z\)$/, 'CONTROL: a real one is worded');
  assert.equal(localStamp(NaN), null);
});

const dayInZone = (tz, value) => cp.execFileSync(process.execPath, ['-e',
  'process.stdout.write(require(process.argv[1]).localDay(process.argv[2]))', MODULE, value],
{ env: { PATH: process.env.PATH, TZ: tz }, encoding: 'utf8' });

test('kosmos#8258: localDay converts a time with a zone, and only that', () => {
  assert.equal(dayInZone('America/Chicago', '2026-11-07T02:25:31Z'), '2026-11-06');
  assert.equal(dayInZone('America/Chicago', '2026-11-07T02:25:31+00:00'), '2026-11-06');
  assert.equal(dayInZone('UTC', '2026-11-07T02:25:31Z'), '2026-11-07', 'CONTROL: the zone is what moved it');
  assert.equal(dayInZone('America/Chicago', '2026-11-07T02:25:31'), '2026-11-07', 'no zone on the value: nothing to convert from');
  assert.equal(localDay('not a date'), '');
  assert.equal(localDay(null), '');
});
