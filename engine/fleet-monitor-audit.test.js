'use strict';
/* #3239: the fleet-monitor audit - which DECLARED monitors are MISSING (not
 * loaded) on a box. The load-bearing property: it must actually REPORT a loss
 * (that is the whole point), so every "present" arm is paired with a "missing"
 * control on the same set - a verdict that can only ever say ok is worthless.
 *
 *   node --test engine/fleet-monitor-audit.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const { auditVerdict } = require('./fleet-monitor-audit');
const { FLEET_MONITORS } = require('./fleet-monitors');

const EXP = [
  { label: 'com.x.alpha', purpose: 'a', source: 's-a' },
  { label: 'com.x.beta', purpose: 'b', source: 's-b' },
];

test('all declared monitors loaded -> ok, nothing missing', () => {
  const v = auditVerdict(EXP, ['com.x.alpha', 'com.x.beta']);
  assert.equal(v.ok, true);
  assert.equal(v.missing.length, 0);
  assert.equal(v.present.length, 2);
  assert.equal(v.expectedCount, 2);
});

test('a missing monitor is REPORTED (and the SAME set all-loaded is ok - non-vacuous)', () => {
  const missingOne = auditVerdict(EXP, ['com.x.alpha']);
  assert.equal(missingOne.ok, false, 'a loaded set without beta must report beta missing');
  assert.deepEqual(missingOne.missing.map((m) => m.label), ['com.x.beta']);
  // CONTROL on the identical expected set: with beta loaded too, it is ok.
  const allLoaded = auditVerdict(EXP, ['com.x.alpha', 'com.x.beta']);
  assert.equal(allLoaded.ok, true, 'the same set fully loaded must be ok - proves the miss was real');
});

test('empty loaded set (the box-rebuild case) -> every monitor missing', () => {
  const v = auditVerdict(EXP, []);
  assert.equal(v.ok, false);
  assert.equal(v.missing.length, EXP.length);
});

test('a loaded label NOT in the expected set is ignored (only expected-but-missing matters)', () => {
  const v = auditVerdict(EXP, ['com.x.alpha', 'com.x.beta', 'com.unrelated.job']);
  assert.equal(v.ok, true, 'an extra unrelated LaunchAgent must not affect the verdict');
  assert.equal(v.present.length, 2);
});

test('missing/undefined args do not throw (fail-safe shapes)', () => {
  assert.equal(auditVerdict(undefined, undefined).ok, true);   // nothing expected -> nothing missing
  assert.equal(auditVerdict(EXP, undefined).ok, false);        // expected but nothing loaded -> all missing
});

test('the declared manifest is well-formed: non-empty, each has label/purpose/source, labels unique', () => {
  assert.ok(FLEET_MONITORS.length > 0, 'the manifest must declare at least one monitor');
  for (const m of FLEET_MONITORS) {
    assert.equal(typeof m.label, 'string');
    assert.ok(m.label.length > 0, 'every monitor needs a label');
    assert.ok(typeof m.purpose === 'string' && m.purpose.length > 0, `${m.label} needs a purpose`);
    assert.ok(typeof m.source === 'string' && m.source.length > 0, `${m.label} needs a source (what to reinstall)`);
  }
  const labels = FLEET_MONITORS.map((m) => m.label);
  assert.equal(new Set(labels).size, labels.length, 'monitor labels must be unique');
});

/* Tool integration: exercise the launchctl-parsing + three-state wiring via the
 * non-shell seams (AUDIT_LOADED_RAW injects launchctl-shaped text; AUDIT_LOADED_FAIL
 * forces the could-not-read branch), spawning the real script as an operator would.
 * No shell command runs from env - the earlier AUDIT_LOADED_CMD seam was removed. */
const TOOL = path.join(__dirname, '..', 'tools', 'fleet-monitor-audit.js');

function launchctlText(monitors) {
  // launchctl-list shape: header then `PID<tab>Status<tab>Label` rows.
  return ['PID\tStatus\tLabel', ...monitors.map((m) => `-\t0\t${m.label}`)].join('\n');
}

function runTool(args, env) {
  try {
    const out = execFileSync('node', [TOOL, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

test('tool: all declared monitors loaded -> exit 0, ok:true (parses launchctl-shaped output)', () => {
  const r = runTool(['--json'], { AUDIT_LOADED_RAW: launchctlText(FLEET_MONITORS) });
  assert.equal(r.code, 0, 'all present -> exit 0');
  const v = JSON.parse(r.out);
  assert.equal(v.ok, true);
  assert.equal(v.readable, true);
  assert.equal(v.missing.length, 0);
});

test('tool: one declared monitor absent from launchctl -> exit 1 and it is named missing', () => {
  const dropped = FLEET_MONITORS[0].label;
  const r = runTool(['--json'], { AUDIT_LOADED_RAW: launchctlText(FLEET_MONITORS.slice(1)) });
  assert.equal(r.code, 1, 'a missing monitor -> exit 1');
  const v = JSON.parse(r.out);
  assert.equal(v.ok, false);
  assert.ok(v.missing.some((m) => m.label === dropped), `${dropped} must be reported missing`);
});

test('tool: launchctl unreadable -> exit 2 and could-not-read, NOT reported as all-missing (three answers)', () => {
  const r = runTool(['--json'], { AUDIT_LOADED_FAIL: '1' });
  assert.equal(r.code, 2, 'a read failure -> exit 2, distinct from missing (1) and present (0)');
  const v = JSON.parse(r.out);
  assert.equal(v.ok, false);
  assert.equal(v.readable, false, 'must report it could not READ, not that monitors are missing');
  assert.ok(!('missing' in v) || v.missing === undefined, 'a read failure must NOT emit a missing list (would read as a rebuild signal)');
});

test('tool: empty-but-SUCCESSFUL read (AUDIT_LOADED_RAW="") -> readable:true, all missing, exit 1 (empty != unset != failed)', () => {
  // An empty string is a successful read that saw nothing, NOT a failure. This pins
  // the `AUDIT_LOADED_RAW != null` check: a future refactor to a truthiness test
  // (`if (process.env.AUDIT_LOADED_RAW)`) would silently fold '' into the call-real-
  // launchctl branch, and only this test would catch it.
  const r = runTool(['--json'], { AUDIT_LOADED_RAW: '' });
  assert.equal(r.code, 1, 'an empty successful read is all-missing (exit 1), NOT could-not-read (exit 2)');
  const v = JSON.parse(r.out);
  assert.equal(v.readable, true, 'an empty string is a successful read (readable:true), distinct from AUDIT_LOADED_FAIL');
  assert.equal(v.missing.length, v.expectedCount, 'nothing loaded -> every declared monitor missing');
});

test('tool: human-readable output NAMES a missing monitor + its reinstall source (the mode an operator runs)', () => {
  const dropped = FLEET_MONITORS[0];
  const r = runTool([], { AUDIT_LOADED_RAW: launchctlText(FLEET_MONITORS.slice(1)) });
  assert.equal(r.code, 1);
  assert.match(r.out, new RegExp('MISSING'), 'human output must flag MISSING');
  assert.ok(r.out.includes(dropped.label), 'human output must name the missing label');
  assert.ok(r.out.includes(dropped.source), 'human output must name where to reinstall from');
});

test('tool: human-readable all-present output says so (control for the missing arm)', () => {
  const r = runTool([], { AUDIT_LOADED_RAW: launchctlText(FLEET_MONITORS) });
  assert.equal(r.code, 0);
  assert.match(r.out, /all \d+ declared fleet monitors are present/);
});
