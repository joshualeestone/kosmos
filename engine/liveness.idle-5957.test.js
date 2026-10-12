'use strict';
/**
 * kosmos#5957 slice 3: idleDays, how long an agent has gone without running, said only from two weeks.
 *
 *   node --test engine/liveness.idle-5957.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-liveness-idle-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const liveness = require('./liveness');
const DAY = 86400000;
const NOW = Date.parse('2026-10-12T19:00:00Z');

function beatAt(name, ms) {
  const file = liveness.fileFor(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ at: new Date(ms).toISOString() }));
}

test('two weeks or more: the whole number of days', () => {
  beatAt('old', NOW - 23 * DAY - 3600000);
  assert.equal(liveness.idleDays('old', NOW), 23);
  beatAt('edge', NOW - liveness.IDLE_DAYS * DAY);
  assert.equal(liveness.idleDays('edge', NOW), liveness.IDLE_DAYS);
});

test('under two weeks: null', () => {
  beatAt('recent', NOW - liveness.IDLE_DAYS * DAY + 1000);
  assert.equal(liveness.idleDays('recent', NOW), null);
});

test('never seen is null, not "seen long ago"', () => {
  assert.equal(liveness.idleDays('never-beat', NOW), null);
});

test('an unreadable record is null', () => {
  const file = liveness.fileFor('garbled');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not json');
  assert.equal(liveness.idleDays('garbled', NOW), null);
});

test('a beat written by seen() reads as not idle', () => {
  liveness.seen('fresh');
  assert.equal(liveness.idleDays('fresh'), null);
});
