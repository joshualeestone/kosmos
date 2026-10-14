'use strict';
/**
 * #6176 slice 1: Claude's five-hour limit. The statusline already receives rate_limits.five_hour and used to drop it;
 * it now records it in its own file (kosmos-fivehour.json), and allowance.readFiveHour serves it. Driven the way
 * Claude Code drives it: the script's own command with the payload on stdin.
 *
 *   node --test engine/allowance-fivehour-6176.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fivehour-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const test = require('node:test');
const assert = require('node:assert/strict');
const allowance = require('./allowance');
const statusline = require('./kosmos-statusline');

const SCRIPT = allowance.scriptPath();
const NODE = allowance.stableNode();
let n = 0;
const freshDir = () => fs.mkdtempSync(path.join(SANDBOX, 'acct-' + (n++) + '-'));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const NOW_S = Math.floor(Date.now() / 1000);
const payload = (five, week) => JSON.stringify({
  session_id: 's', model: { display_name: 'Opus' },
  rate_limits: { five_hour: five, seven_day: week || { used_percentage: 10, resets_at: NOW_S + 3 * 86400 } },
});
const run = (dir, input) => spawnSync(NODE, [SCRIPT, dir], { input, encoding: 'utf8' });

test('the script records the five-hour reading in its own file, and the weekly file is unchanged in shape', () => {
  const dir = freshDir();
  const r = run(dir, payload({ used_percentage: 37, resets_at: NOW_S + 3600 }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'a statusline that prints shows it in the pane');
  const five = readJson(path.join(dir, statusline.FIVE_HOUR_FILE));
  assert.equal(five.usedPct, 37);
  assert.equal(five.resetsAt, NOW_S + 3600);
  assert.equal(typeof five.at, 'number');
  assert.equal('history' in five, false, 'the five-hour file keeps no history');
  const week = readJson(path.join(dir, statusline.FILE));
  assert.ok(Array.isArray(week.history), 'the weekly file still keeps its history for the calibration');
});

test('within one window a lower figure is stale; a new window replaces it even when lower', () => {
  const dir = freshDir();
  run(dir, payload({ used_percentage: 40, resets_at: NOW_S + 3600 }));
  run(dir, payload({ used_percentage: 30, resets_at: NOW_S + 3600 + 60 }));   // same window, another session's older figure
  assert.equal(readJson(path.join(dir, statusline.FIVE_HOUR_FILE)).usedPct, 40);
  run(dir, payload({ used_percentage: 5, resets_at: NOW_S + 3600 + 5 * 3600 }));   // the next window
  const after = readJson(path.join(dir, statusline.FIVE_HOUR_FILE));
  assert.equal(after.usedPct, 5);
  assert.equal(after.resetsAt, NOW_S + 3600 + 5 * 3600);
});

test('the one-hour tolerance: inside it is the same window, beyond it an older window is refused', () => {
  const dir = freshDir(), R = NOW_S + 4 * 3600;
  run(dir, payload({ used_percentage: 50, resets_at: R }));
  run(dir, payload({ used_percentage: 40, resets_at: R - 3599 }));   // same window, stamped a little earlier: stale
  assert.equal(readJson(path.join(dir, statusline.FIVE_HOUR_FILE)).usedPct, 50);
  run(dir, payload({ used_percentage: 90, resets_at: R - 5 * 3600 }));   // the window before: older, refused even when higher
  const kept = readJson(path.join(dir, statusline.FIVE_HOUR_FILE));
  assert.equal(kept.usedPct, 50);
  assert.equal(kept.resetsAt, R);
});

test('a payload with no five-hour figure, or a wrong-shaped one, writes no five-hour file', () => {
  for (const five of [undefined, null, { used_percentage: 'x', resets_at: NOW_S + 3600 }, { used_percentage: 20 }, { used_percentage: -1, resets_at: NOW_S + 3600 }]) {
    const dir = freshDir();
    run(dir, payload(five));
    assert.equal(fs.existsSync(path.join(dir, statusline.FIVE_HOUR_FILE)), false, JSON.stringify(five));
    assert.equal(fs.existsSync(path.join(dir, statusline.FILE)), true, 'the weekly reading is still recorded');
  }
});

test('readFiveHour serves a current reading and nothing once the window has reset', () => {
  const dir = freshDir();
  run(dir, payload({ used_percentage: 64, resets_at: NOW_S + 1800 }));
  const r = allowance.readFiveHour(dir);
  assert.equal(r.usedPct, 64);
  assert.equal(r.resetsAt, NOW_S + 1800);
  assert.equal(allowance.readFiveHour(dir, (NOW_S + 1801) * 1000), null, 'a reading from a window that has reset is not this window');
});

test('readFiveHour refuses what it cannot trust', () => {
  const dir = freshDir();
  assert.equal(allowance.readFiveHour(dir), null, 'never recorded');
  fs.writeFileSync(path.join(dir, statusline.FIVE_HOUR_FILE), '{not json');
  assert.equal(allowance.readFiveHour(dir), null, 'unreadable');
  fs.writeFileSync(path.join(dir, statusline.FIVE_HOUR_FILE), JSON.stringify({ usedPct: 50, resetsAt: NOW_S + 600 }));
  assert.equal(allowance.readFiveHour(dir), null, 'no time it was seen');
  assert.equal(allowance.readFiveHour(null), null);
});
