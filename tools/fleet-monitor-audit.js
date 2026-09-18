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
 * Usage:
 *   node tools/fleet-monitor-audit.js            human-readable; exit 0 all present, 1 any missing
 *   node tools/fleet-monitor-audit.js --json     the verdict as JSON; same exit code (also --check)
 *
 * SEAM (a PATH-based launchctl stub cannot inject a controlled loaded-set):
 *   AUDIT_LOADED_CMD   a shell command whose stdout replaces `launchctl list` (tests)
 */

const { execFileSync } = require('child_process');
const { FLEET_MONITORS } = require('../engine/fleet-monitors');
const { auditVerdict } = require('../engine/fleet-monitor-audit');

/* The launchd labels loaded on this box. `launchctl list` prints
 * `PID<tab>Status<tab>Label`; the label is the last field. A header row and
 * blank lines yield non-matching tokens, which is harmless (they cannot equal a
 * declared label). Fails to the EMPTY set on any error, which makes every
 * expected monitor read as missing - the loud direction, correct for a monitor
 * whose whole job is to not fail quiet. */
function loadedLabels() {
  let out = '';
  try {
    const cmd = process.env.AUDIT_LOADED_CMD;
    out = cmd
      ? execFileSync('/bin/sh', ['-c', cmd], { encoding: 'utf8' })
      : execFileSync('launchctl', ['list'], { encoding: 'utf8' });
  } catch { out = ''; }
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/).pop());
}

function run(argv) {
  const asJson = argv.includes('--json') || argv.includes('--check');
  const v = auditVerdict(FLEET_MONITORS, loadedLabels());
  if (asJson) {
    console.log(JSON.stringify(v, null, 2));
  } else if (v.ok) {
    console.log(`fleet-monitor-audit: all ${v.expectedCount} declared fleet monitors are present`);
  } else {
    console.error(`fleet-monitor-audit: ${v.missing.length} of ${v.expectedCount} declared fleet monitors MISSING from this box:`);
    for (const m of v.missing) {
      console.error(`  MISSING  ${m.label}  -- ${m.purpose}`);
      console.error(`           reinstall from: ${m.source}`);
    }
  }
  return v.ok ? 0 : 1;
}

if (require.main === module) {
  process.exit(run(process.argv.slice(2)));
}

module.exports = { run, loadedLabels };
