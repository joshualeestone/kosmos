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

test('the declared manifest is well-formed: non-empty, each has label/purpose/source/repo/plist/installer, labels unique', () => {
  assert.ok(FLEET_MONITORS.length > 0, 'the manifest must declare at least one monitor');
  for (const m of FLEET_MONITORS) {
    assert.equal(typeof m.label, 'string');
    assert.ok(m.label.length > 0, 'every monitor needs a label');
    assert.ok(typeof m.purpose === 'string' && m.purpose.length > 0, `${m.label} needs a purpose`);
    assert.ok(typeof m.source === 'string' && m.source.length > 0, `${m.label} needs a source (what to reinstall)`);
    // #3243 provisioning metadata: repo (deploying-repo checkout under ~/work),
    // plist (committed path relative to that checkout root), installer strategy.
    assert.ok(typeof m.repo === 'string' && m.repo.length > 0, `${m.label} needs a repo (which checkout commits its plist)`);
    assert.ok(typeof m.plist === 'string' && m.plist.length > 0, `${m.label} needs a plist path`);
    assert.ok(['self', 'fleet'].includes(m.installer), `${m.label} installer must be 'self' or 'fleet' (got ${JSON.stringify(m.installer)})`);
  }
  const labels = FLEET_MONITORS.map((m) => m.label);
  assert.equal(new Set(labels).size, labels.length, 'monitor labels must be unique');
});

test('#3243: provisioning metadata is resolvable - every plist basename equals its label + .plist, and no plist path escapes its repo', () => {
  // The registry-driven fresh-box provisioner (the claude-setup fleet installer,
  // its `installer: 'fleet'` path) is intended to resolve a plist at
  // ~/work/<repo>/<plist> and load it. This test guards the registry-internal
  // invariants that provisioner will depend on, computed from data in THIS repo:
  //  - basename(plist) === '<label>.plist'. A launchd job's plist filename must
  //    match its internal <Label>; the internal Label lives in the committed plist
  //    (another repo) and cannot be read from here, so this basename check is a
  //    PROXY for that requirement, not the enforcement. The installer verifies the
  //    real filename==internal-Label match at load time and fails on a mismatch.
  //  - plist is repo-relative and does not climb out with '..' or a leading '/'.
  // A length assertion keeps this from passing vacuously on an empty registry
  // (the well-formedness test also asserts length > 0; repeated here so this test
  // stands on its own).
  assert.ok(FLEET_MONITORS.length > 0, 'the registry must be non-empty for this check to mean anything');
  for (const m of FLEET_MONITORS) {
    const base = m.plist.slice(m.plist.lastIndexOf('/') + 1);
    assert.equal(base, `${m.label}.plist`, `${m.label}: plist basename must be <label>.plist (got ${base})`);
    assert.ok(!m.plist.startsWith('/'), `${m.label}: plist must be repo-relative, not absolute`);
    assert.ok(!m.plist.split('/').includes('..'), `${m.label}: plist must not contain '..'`);
  }
});

test('#3250: board-served-tree-check is registered (a live monitor that was missing from the registry)', () => {
  // A LIVE loaded fleet monitor absent from the registry is a blind spot: the
  // audit reads the registry as its expected set, so its loss would not be
  // caught. This pins the fix red-capable: removing the entry fails this test.
  const m = FLEET_MONITORS.find((x) => x.label === 'com.stonesyndicate.board-served-tree-check');
  assert.ok(m, 'com.stonesyndicate.board-served-tree-check must be declared in the registry');
  assert.equal(
    m.source,
    'Josh-Brain/Tools/fleet/board-served-tree-guard.sh',
    'its source must point at what to reinstall (the deploying-repo-owned guard)',
  );
});

/* Tool integration: exercise the launchctl-parsing + three-state wiring via the
 * PARAMETER seams (loadedLabels(inject), run(argv, loader)) IN-PROCESS - no env, no
 * subprocess. The seam is a parameter precisely because this box shares one env
 * across ~18 agents: an env-controlled seam in the shipped tool could be triggered
 * by an inherited var. Calling the functions directly reaches the seam the only way
 * it can be reached, which is also the proof the shipped CLI path has no env seam.
 * ONE real-subprocess smoke test below runs the tool with NO injection. */
const tool = require('../tools/fleet-monitor-audit');
const { run, loadedLabels, EXIT_ALL_PRESENT, EXIT_MISSING, EXIT_COULD_NOT_READ } = tool;
const TOOL = path.join(__dirname, '..', 'tools', 'fleet-monitor-audit.js');

function launchctlText(monitors) {
  // launchctl-list shape: header then `PID<tab>Status<tab>Label` rows.
  return ['PID\tStatus\tLabel', ...monitors.map((m) => `-\t0\t${m.label}`)].join('\n');
}

// Call run() in-process, capturing everything it writes to stdout/stderr. The
// loader is the parameter seam: a zero-arg function returning the read result,
// built here from loadedLabels(inject) so the launchctl-parsing is exercised too.
function callRun(args, inject) {
  const origLog = console.log;
  const origErr = console.error;
  let out = '';
  console.log = (...a) => { out += a.join(' ') + '\n'; };
  console.error = (...a) => { out += a.join(' ') + '\n'; };
  let code;
  try {
    code = run(args, () => loadedLabels(inject));
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { code, out };
}

test('tool: exit-code constants are the documented contract 0/1/2', () => {
  assert.equal(EXIT_ALL_PRESENT, 0);
  assert.equal(EXIT_MISSING, 1);
  assert.equal(EXIT_COULD_NOT_READ, 2);
});

test('tool: all declared monitors loaded -> exit 0, ok:true (parses launchctl-shaped output)', () => {
  const r = callRun(['--json'], { rawText: launchctlText(FLEET_MONITORS) });
  assert.equal(r.code, EXIT_ALL_PRESENT, 'all present -> exit 0');
  const v = JSON.parse(r.out);
  assert.equal(v.ok, true);
  assert.equal(v.readable, true);
  assert.equal(v.missing.length, 0);
});

test('tool: one declared monitor absent from launchctl -> exit 1 and it is named missing', () => {
  const dropped = FLEET_MONITORS[0].label;
  const r = callRun(['--json'], { rawText: launchctlText(FLEET_MONITORS.slice(1)) });
  assert.equal(r.code, EXIT_MISSING, 'a missing monitor -> exit 1');
  const v = JSON.parse(r.out);
  assert.equal(v.ok, false);
  assert.ok(v.missing.some((m) => m.label === dropped), `${dropped} must be reported missing`);
});

test('tool: launchctl unreadable -> exit 2 and could-not-read, NOT reported as all-missing (three answers)', () => {
  const r = callRun(['--json'], { fail: true });
  assert.equal(r.code, EXIT_COULD_NOT_READ, 'a read failure -> exit 2, distinct from missing (1) and present (0)');
  const v = JSON.parse(r.out);
  assert.equal(v.ok, false);
  assert.equal(v.readable, false, 'must report it could not READ, not that monitors are missing');
  assert.ok(!('missing' in v) || v.missing === undefined, 'a read failure must NOT emit a missing list (would read as a rebuild signal)');
});

test('tool: empty-but-SUCCESSFUL read (rawText="") -> readable:true, all missing, exit 1 (empty != unset != failed)', () => {
  // An empty string is a successful read that saw nothing, NOT a failure. This pins
  // the `typeof seam.rawText === 'string'` check: a future refactor to a truthiness
  // test (`if (seam.rawText)`) would silently fold '' into the call-real-launchctl
  // branch, and only this test would catch it.
  const r = callRun(['--json'], { rawText: '' });
  assert.equal(r.code, EXIT_MISSING, 'an empty successful read is all-missing (exit 1), NOT could-not-read (exit 2)');
  const v = JSON.parse(r.out);
  assert.equal(v.readable, true, 'an empty string is a successful read (readable:true), distinct from inject.fail');
  assert.equal(v.missing.length, v.expectedCount, 'nothing loaded -> every declared monitor missing');
});

test('tool: human-readable output NAMES a missing monitor + its reinstall source (the mode an operator runs)', () => {
  const dropped = FLEET_MONITORS[0];
  const r = callRun([], { rawText: launchctlText(FLEET_MONITORS.slice(1)) });
  assert.equal(r.code, EXIT_MISSING);
  assert.match(r.out, new RegExp('MISSING'), 'human output must flag MISSING');
  assert.ok(r.out.includes(dropped.label), 'human output must name the missing label');
  assert.ok(r.out.includes(dropped.source), 'human output must name where to reinstall from');
});

test('tool: human-readable all-present output says so (control for the missing arm)', () => {
  const r = callRun([], { rawText: launchctlText(FLEET_MONITORS) });
  assert.equal(r.code, EXIT_ALL_PRESENT);
  assert.match(r.out, /all \d+ declared fleet monitors are loaded/);
  // The success line must NOT over-claim health - it checks presence, not Status.
  assert.match(r.out, /presence only; health\/status not checked/);
});

test('tool: default loader (no injection) reads REAL launchctl -> exit in {0,1,2} (in-process, proves the shipped path has no env seam)', () => {
  // No loader passed: run() falls back to the real loadedLabels, which execs
  // launchctl. We can't assert WHICH verdict (depends on the box), only that the
  // no-seam path produces one of the three contract codes. This is the in-process
  // half of the smoke test - it exercises run's default parameter.
  const origLog = console.log;
  const origErr = console.error;
  console.log = () => {};
  console.error = () => {};
  let code;
  try {
    code = run(['--json']);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  assert.ok([EXIT_ALL_PRESENT, EXIT_MISSING, EXIT_COULD_NOT_READ].includes(code), `real-launchctl verdict must be 0/1/2, got ${code}`);
});

test('tool: real-subprocess smoke - spawn the script as an operator would, NO injection, exit in {0,1,2}', () => {
  // The one true end-to-end: a real `node tools/fleet-monitor-audit.js` process,
  // no env seam set anywhere, exercises the shebang/require.main/process.exit
  // wiring the in-process tests bypass. Verdict is box-dependent; the contract is
  // that it exits with one of the three documented codes and never throws.
  let code;
  try {
    execFileSync('node', [TOOL, '--json'], { encoding: 'utf8' });
    code = 0;
  } catch (e) {
    code = e.status;
  }
  assert.ok([0, 1, 2].includes(code), `subprocess must exit 0/1/2, got ${code}`);
});
