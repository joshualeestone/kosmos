'use strict';

/* #3239: the DECLARED set of fleet launchd MONITORS - the health/observability
 * watchers whose ABSENCE means the fleet has silently stopped watching for a
 * failure. This is the single source of truth the audit reads
 * (tools/fleet-monitor-audit.js), so a monitor lost on a box rebuild becomes a
 * CAUGHT signal instead of a silent gap.
 *
 * 🛑 WHY A DECLARED LIST AND NOT "whatever is currently loaded". The whole point
 * is to catch a MISSING monitor - so the expected set must be recorded
 * independently of the box being checked. Auditing a box against its own loaded
 * set is circular and can never report a loss.
 *
 * 📌 SCOPE (bounded first step of #3239). This declares the monitors and audits
 * their presence. It does NOT install them: these 7 monitors have no common
 * source (measured 2026-09-17 - see the `source` field: four relay monitors under
 * ~/.local/libexec/kosmos-relay/, one committed here, one in Josh-Brain, one in
 * ~/.claude/bin), so a unified installer needs a cross-repo source consolidation
 * first. That consolidation + an idempotent installer are the #3239 follow-up
 * (#3243).
 *
 * ⚠️ PER-HOST APPLICABILITY is a documented refinement, not yet modelled. These
 * are the monitors observed on the fleet box (where agents + the board run). A
 * host that legitimately should not run a given monitor would see it reported
 * "missing"; adding a per-host `scope` field is deferred to the follow-up. For
 * the fleet box (the box this audit is for), all of these are expected.
 *
 * `source` is the program the installed plist runs, recorded so a "missing"
 * finding points straight at what to reinstall.
 */
const FLEET_MONITORS = Object.freeze([
  Object.freeze({
    label: 'com.kosmos.selfreport-silence-monitor',
    purpose: 'the fleet self-report / liveness path went silent (#2522, the #2509 blind spot)',
    source: 'agent-workforce/tools/selfreport-silence-monitor.js',
  }),
  Object.freeze({
    label: 'com.kosmos.coordinator-monitor',
    purpose: 'kosmos-relay coordinator health',
    source: '~/.local/libexec/kosmos-relay/coordinator-monitor.sh',
  }),
  Object.freeze({
    label: 'com.kosmos.relay-cert-monitor',
    purpose: 'relay TLS certificate expiry',
    source: '~/.local/libexec/kosmos-relay/relay-cert-monitor.sh',
  }),
  Object.freeze({
    label: 'com.kosmos.expiry-watchtower',
    purpose: 'owned-domain lapse monitoring',
    source: '~/.local/libexec/kosmos-relay/expiry-watchtower.sh',
  }),
  Object.freeze({
    label: 'com.kosmos.kosmosplus-drift-monitor',
    purpose: 'Kosmos+ drift',
    source: '~/.local/libexec/kosmos-relay/kosmosplus-drift-monitor.sh',
  }),
  Object.freeze({
    label: 'com.stonesyndicate.fleet-liveness',
    purpose: 'fleet liveness (agent processes alive)',
    source: '~/.claude/bin/fleet-liveness-check.sh',
  }),
  Object.freeze({
    label: 'com.stonesyndicate.fleet-drift-check',
    purpose: 'fleet sync drift',
    source: 'Josh-Brain/Tools/fleet/sync-drift-alert.sh',
  }),
]);

module.exports = { FLEET_MONITORS };
