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

/* Tool integration: exercise the launchctl-parsing + wiring via the
 * AUDIT_LOADED_CMD seam (a PATH launchctl stub cannot inject a controlled set),
 * spawning the real script exactly as an operator would run it. */
const TOOL = path.join(__dirname, '..', 'tools', 'fleet-monitor-audit.js');

function runTool(args, loadedCmd) {
  try {
    const out = execFileSync('node', [TOOL, ...args], {
      encoding: 'utf8',
      env: { ...process.env, AUDIT_LOADED_CMD: loadedCmd },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

test('tool: all declared monitors loaded -> exit 0, ok:true (parses launchctl-shaped output)', () => {
  // Emit a launchctl-list-shaped table (PID Status Label) with every declared label present.
  const lines = ['PID\tStatus\tLabel', ...FLEET_MONITORS.map((m) => `-\t0\t${m.label}`)];
  const r = runTool(['--json'], `printf '%s\\n' ${lines.map((l) => `'${l}'`).join(' ')}`);
  assert.equal(r.code, 0, 'all present -> exit 0');
  const v = JSON.parse(r.out);
  assert.equal(v.ok, true);
  assert.equal(v.missing.length, 0);
});

test('tool: one declared monitor absent from launchctl -> exit 1 and it is named missing', () => {
  const dropped = FLEET_MONITORS[0].label;
  const lines = ['PID\tStatus\tLabel', ...FLEET_MONITORS.slice(1).map((m) => `-\t0\t${m.label}`)];
  const r = runTool(['--json'], `printf '%s\\n' ${lines.map((l) => `'${l}'`).join(' ')}`);
  assert.equal(r.code, 1, 'a missing monitor -> exit 1');
  const v = JSON.parse(r.out);
  assert.equal(v.ok, false);
  assert.ok(v.missing.some((m) => m.label === dropped), `${dropped} must be reported missing`);
});
