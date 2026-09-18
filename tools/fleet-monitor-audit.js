#!/usr/bin/env node
'use strict';

/* #3239: the loud half of the fleet-monitor audit (see engine/fleet-monitor-audit.js
 * for the pure verdict and engine/fleet-monitors.js for the declared set, which is
 * where the logic + tests live).
 *
 * It flags fleet MONITORS that are MISSING (not loaded) from this box - the
 * card's core risk: a box rebuild / migration silently drops a monitor and
 * nothing notices (a monitor that never installed reads identical to one that
 * silently stopped). On-demand today; scheduling it periodically is the #3239
 * provisioning follow-up.
 *
 * 🛑 REPORT, NEVER ACT. `launchctl list` is read-only; this NEVER installs,
 * loads, unloads, or modifies a monitor, and NEVER touches ~/.claude/settings.json
 * (the "one settings.json serves all 18 agents" hazard). Additive + reversible by
 * construction - it only reads and reports.
 *
 * 🛑 THREE ANSWERS, NEVER TWO (the fleet's own liveness discipline). "could not
 * read launchctl" must be distinguishable from "every monitor is missing": a
 * launchctl exec failure (not on PATH, permission, a stripped launchd env) is a
 * re-run/fix-the-environment signal, while all-missing is a rebuild-the-monitors
 * signal - opposite operator actions. Folding the exec failure into "all missing"
 * (the naive fail-to-empty) would raise a false fleet-wide-rebuild alarm on a
 * transient read error. So a read failure is its own verdict + exit code.
 *
 * Usage / exit codes:
 *   node tools/fleet-monitor-audit.js            human-readable
 *   node tools/fleet-monitor-audit.js --json     the verdict as JSON (also --check)
 *   exit 0 = all present, 1 = one or more missing, 2 = could not read launchctl
 *
 * 🛑 NO ENV SEAMS. Test injection is by PARAMETER, never environment: `loadedLabels`
 * takes an optional `inject` and `run` takes an optional `loader`. This box shares
 * one env across ~18 agents (the "one settings.json serves all 18 agents" hazard);
 * an env-controlled seam in a SHIPPED tool means an inherited AUDIT_* var could
 * silently make the audit read injected text instead of real launchctl and report a
 * confident wrong verdict. A parameter cannot be inherited, so the shipped code path
 * has no seam at all - the tests reach the seam by calling the functions directly.
 */

const { execFileSync } = require('child_process');
const { FLEET_MONITORS } = require('../engine/fleet-monitors');
const { auditVerdict } = require('../engine/fleet-monitor-audit');

// Exit codes are contract (documented above; tools/CI key on them) - name them.
const EXIT_ALL_PRESENT = 0;
const EXIT_MISSING = 1;
const EXIT_COULD_NOT_READ = 2;

/* The launchd labels loaded on this box, as { ok:true, labels:[...] }, or
 * { ok:false, error } when launchctl could not be read at all. `launchctl list`
 * prints `PID<tab>Status<tab>Label`; the label is the last field. Blank lines are
 * dropped by the .filter(Boolean) before the label-mapping; the header row does
 * yield one token ("Label"), which is harmless (it cannot equal a declared label).
 * A read FAILURE is reported as such, NOT as an empty set, so the caller can tell
 * it apart from a genuine all-missing (three-answers).
 *
 * `inject` is the test seam and is NEVER passed by the shipped CLI path (see run):
 *   inject.fail === true      -> force the could-not-read branch (exercises exit 2)
 *   typeof inject.rawText     -> parse this launchctl-shaped text in place of exec
 * A missing/empty `inject` runs the real `launchctl list`. `rawText` is checked with
 * `typeof === 'string'`, not truthiness, so an empty string is a successful empty
 * read (all-missing), distinct from no injection (call launchctl) and from fail. */
function loadedLabels(inject) {
  const seam = inject || {};
  if (seam.fail) {
    return { ok: false, error: 'forced read failure (loadedLabels inject.fail test seam)' };
  }
  let out;
  if (typeof seam.rawText === 'string') {
    out = seam.rawText; // injected launchctl-shaped text (tests)
  } else {
    try {
      out = execFileSync('launchctl', ['list'], { encoding: 'utf8' });
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }
  const labels = out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/).pop());
  return { ok: true, labels };
}

/* `loader` defaults to the real `loadedLabels` (no injection). Tests pass their own
 * loader (or `(inject) => loadedLabels(inject)`); the shipped CLI path never does, so
 * the running tool always reads real launchctl. */
function run(argv, loader = loadedLabels) {
  const asJson = argv.includes('--json') || argv.includes('--check');
  const read = loader();
  if (!read.ok) {
    /* could-not-read: distinct from all-missing. Cannot tell present from
       missing, so do NOT claim a rebuild is needed - point at the environment. */
    if (asJson) {
      console.log(JSON.stringify({ ok: false, readable: false, error: read.error, expectedCount: FLEET_MONITORS.length }, null, 2));
    } else {
      console.error(`fleet-monitor-audit: could NOT read launchctl (${read.error}) - cannot tell present from missing; re-run or check the environment (this is NOT a signal that monitors were lost)`);
    }
    return EXIT_COULD_NOT_READ;
  }
  const v = auditVerdict(FLEET_MONITORS, read.labels);
  if (asJson) {
    console.log(JSON.stringify({ ...v, readable: true }, null, 2));
  } else if (v.ok) {
    /* "loaded", not "healthy": this keys on label presence in `launchctl list`, NOT
       the Status column, so a loaded-but-crash-looping monitor still reads present.
       The card's scope is DROPPED monitors (label absent); surfacing Status is the
       #3243 refinement. Word it so an operator does not over-read this as all-healthy. */
    console.log(`fleet-monitor-audit: all ${v.expectedCount} declared fleet monitors are loaded (presence only; health/status not checked)`);
  } else {
    console.error(`fleet-monitor-audit: ${v.missing.length} of ${v.expectedCount} declared fleet monitors MISSING from this box:`);
    for (const m of v.missing) {
      console.error(`  MISSING  ${m.label}  -- ${m.purpose}`);
      console.error(`           reinstall from: ${m.source}`);
    }
  }
  return v.ok ? EXIT_ALL_PRESENT : EXIT_MISSING;
}

if (require.main === module) {
  process.exit(run(process.argv.slice(2)));
}

module.exports = { run, loadedLabels, EXIT_ALL_PRESENT, EXIT_MISSING, EXIT_COULD_NOT_READ };
