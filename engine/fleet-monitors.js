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
 * ⚠️ PER-HOST APPLICABILITY is a documented refinement, not yet modelled. These
 * are the monitors observed on the fleet box (where agents + the board run). A
 * host that legitimately should not run a given monitor would see it reported
 * "missing"; adding a per-host `scope` field is deferred to the follow-up. For
 * the fleet box (the box this audit is for), all of these are expected.
 *
 * FIELDS
 * `source`    - the program the installed plist runs, recorded so a "missing"
 *               finding points straight at what to reinstall.
 * `repo`      - the checkout directory under ~/work that COMMITS this monitor's
 *               plist (its deploying repo). It names where the plist lives so a
 *               provisioner can resolve it at `~/work/<repo>/<plist>`.
 * `plist`     - the committed plist path relative to that repo's checkout root.
 * `installer` - HOW a fresh/rebuilt box re-provisions this monitor (#3243):
 *                 'self'  = the deploying repo ships its own install step (e.g.
 *                           kosmos-relay/deploy/install-monitors.sh). The
 *                           claude-setup fleet installer REPORTS it and skips -
 *                           it does not duplicate a working self-installer.
 *                 'fleet' = the four non-self-installing monitors (selfreport,
 *                           fleet-liveness, and Josh-Brain's fleet-drift-check +
 *                           board-served-tree-check), meant to be provisioned by
 *                           the one claude-setup fleet installer rather than a
 *                           per-repo script. NOTE the state of that installer
 *                           today: its first slice (claude-setup#53) installs the
 *                           two whose plist is committed AS ITS OWN TEMPLATE
 *                           (selfreport, fleet-liveness) and only REPORTS the
 *                           Josh-Brain pair; reading `repo`+`plist` to resolve a
 *                           plist from ANOTHER repo's checkout (that pair) is the
 *                           paired follow-up PR that consumes these fields. This
 *                           registry is what makes that follow-up possible.
 *
 * 📌 PROVISIONING SEAM (#3243, resolved 2026-09-18): a monitor's plist SOURCE
 * lives in the repo that deploys it (deploying-repo-owns-source); this registry
 * is the shared index of WHICH monitors exist and, now, WHERE each plist is and
 * WHO installs it. The relay four self-install; the rest are meant to be
 * provisioned by the one claude-setup fleet installer by reference, so there is
 * no per-repo install script to build and maintain per monitor. The installer's
 * cross-repo resolution is the follow-up noted above; the fields are declared
 * here first so it has an authoritative registry to read.
 *
 * ⏳ PENDING MIGRATION (selfreport): selfreport-silence-monitor's PROGRAM lives
 * in this repo (tools/selfreport-silence-monitor.js), but its committed plist is
 * still in claude-setup (templates/fleet-monitors/, from #53's first slice), so
 * `repo` records that for accuracy today. Moving the plist here (agent-workforce)
 * and dropping the claude-setup template is a later reversible slice; until then
 * the fleet installer provisions it from claude-setup, which is correct.
 */
const FLEET_MONITORS = Object.freeze([
  Object.freeze({
    label: 'com.kosmos.selfreport-silence-monitor',
    purpose: 'the fleet self-report / liveness path went silent (#2522, the #2509 blind spot)',
    source: 'agent-workforce/tools/selfreport-silence-monitor.js',
    repo: 'claude-setup',
    plist: 'templates/fleet-monitors/com.kosmos.selfreport-silence-monitor.plist',
    installer: 'fleet',
  }),
  Object.freeze({
    label: 'com.kosmos.coordinator-monitor',
    purpose: 'kosmos-relay coordinator health',
    source: '~/.local/libexec/kosmos-relay/coordinator-monitor.sh',
    repo: 'kosmos-relay',
    plist: 'deploy/com.kosmos.coordinator-monitor.plist',
    installer: 'self',
  }),
  Object.freeze({
    label: 'com.kosmos.relay-cert-monitor',
    purpose: 'relay TLS certificate expiry',
    source: '~/.local/libexec/kosmos-relay/relay-cert-monitor.sh',
    repo: 'kosmos-relay',
    plist: 'deploy/com.kosmos.relay-cert-monitor.plist',
    installer: 'self',
  }),
  Object.freeze({
    label: 'com.kosmos.expiry-watchtower',
    purpose: 'owned-domain lapse monitoring',
    source: '~/.local/libexec/kosmos-relay/expiry-watchtower.sh',
    repo: 'kosmos-relay',
    plist: 'deploy/com.kosmos.expiry-watchtower.plist',
    installer: 'self',
  }),
  Object.freeze({
    label: 'com.kosmos.kosmosplus-drift-monitor',
    purpose: 'Kosmos+ drift',
    source: '~/.local/libexec/kosmos-relay/kosmosplus-drift-monitor.sh',
    repo: 'kosmos-relay',
    plist: 'deploy/com.kosmos.kosmosplus-drift-monitor.plist',
    installer: 'self',
  }),
  Object.freeze({
    label: 'com.stonesyndicate.fleet-liveness',
    purpose: 'fleet liveness (agent processes alive)',
    source: '~/.claude/bin/fleet-liveness-check.sh',
    repo: 'claude-setup',
    plist: 'templates/fleet-monitors/com.stonesyndicate.fleet-liveness.plist',
    installer: 'fleet',
  }),
  Object.freeze({
    label: 'com.stonesyndicate.fleet-drift-check',
    purpose: 'fleet sync drift',
    source: 'Josh-Brain/Tools/fleet/sync-drift-alert.sh',
    repo: 'Josh-Brain',
    plist: 'Tools/fleet/com.stonesyndicate.fleet-drift-check.plist',
    installer: 'fleet',
  }),
  /* #3250: a LIVE loaded fleet monitor that was missing from this registry, so
   * the audit could not have caught its loss. Deploying-repo-owned per the #3243
   * seam (source committed in Josh-Brain/Tools/fleet, like fleet-drift-check). */
  Object.freeze({
    label: 'com.stonesyndicate.board-served-tree-check',
    purpose: 'the board main checkout is serving an unmerged or dirty tree (the #1051 worktree-violation guard)',
    source: 'Josh-Brain/Tools/fleet/board-served-tree-guard.sh',
    repo: 'Josh-Brain',
    plist: 'Tools/fleet/com.stonesyndicate.board-served-tree-check.plist',
    installer: 'fleet',
  }),
]);

module.exports = { FLEET_MONITORS };
