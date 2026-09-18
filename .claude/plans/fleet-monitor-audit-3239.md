# Plan: #3239 step 1 - fleet-monitor manifest + audit (catch silent monitor-loss)

Branch: fleet-monitor-audit-3239
Card: joshualeestone/kosmos#3239 (fleet launchd monitors have no fresh-install provisioning)
Owner: PigeonPete (reporting-interface / fleet observability lane)
Scope decided with Splinter: build the BOUNDED first step (manifest + audit); steps 2-3 (cross-repo
source consolidation + idempotent installer) spun to the #3243 follow-up.

## The gap
The ~8 fleet launchd monitors have no fresh-install provisioning and no common source (measured:
only selfreport-silence-monitor has committed source; the rest are hand-created across
~/.local/libexec/kosmos-relay, Josh-Brain, ~/.claude/bin). So a box rebuild silently drops a
monitor and nothing notices - a monitor that never installed reads identical to one that silently
stopped (the exact class the at-rest builder-check itself suffers from).

## This step (bounded, additive, reversible)
Turn silent monitor-loss into a CAUGHT signal, without touching the running monitors or shared config.

- engine/fleet-monitors.js: the DECLARED set of expected fleet monitors (label + purpose + source).
  Single source of truth, recorded independently of any box so a loss is detectable (auditing a box
  against its own loaded set is circular).
- engine/fleet-monitor-audit.js: pure verdict auditVerdict(expected, loadedLabels) -> {ok, missing,
  present, expectedCount}. No I/O; deterministically testable. Directional: reports only
  expected-but-not-loaded (an extra unrelated LaunchAgent is ignored).
- tools/fleet-monitor-audit.js: the loud half - reads the manifest, runs `launchctl list`
  (read-only), computes the verdict, reports. `--json`/`--check` prints JSON; default is a human
  report. THREE-STATE exit code: 0 all present, 1 one or more missing, 2 could-not-read launchctl.
  Test seams are NON-SHELL (no arbitrary command runs from env in the shipped tool):
  AUDIT_LOADED_RAW injects launchctl-shaped text, AUDIT_LOADED_FAIL forces the could-not-read path.
- engine/fleet-monitor-audit.test.js: pure-verdict tests (every present arm paired with a missing
  control on the same set - a verdict that can only say ok is worthless), the box-rebuild empty case,
  extra-label-ignored, fail-safe shapes, manifest well-formedness; plus tool-integration tests via
  the non-shell seams exercising launchctl parsing, all three exit codes (present/missing/
  could-not-read), the empty-vs-unset-vs-failed distinction, and the human-output path.

## Guardrails (shared-infra, per Splinter)
- ADDITIVE only: new files, no change to any running monitor's behavior.
- Does NOT touch ~/.claude/settings.json (one-settings-json-serves-all-18 hazard).
- REPORT, NEVER ACT: launchctl list is read-only; never installs/loads/unloads/modifies a monitor.
- Reversible by construction (only reads + reports).

## Verification
- node --test engine/fleet-monitor-audit.test.js: all green (pure verdict with non-vacuous
  missing controls, the three-state tool integration incl. could-not-read exit 2, the
  empty-vs-unset-vs-failed distinction, and the human-output path). Count intentionally not
  cited here to avoid prose-vs-artifact drift.
- Real-box smoke: `node tools/fleet-monitor-audit.js` reports all 7 declared monitors present, exit 0
  (confirms the real launchctl path, not just the stub).

## Not in this step (the #3243 follow-up)
- Step 2: consolidate the scattered/hand-created monitor sources into manifest-referenced locations
  (cross-repo; the SEAM decision is shared-infra, parked needs-decision on #3243).
- Step 3: an idempotent installer that provisions all manifest monitors on a fresh box.
- Per-host `scope` on the manifest (a host that legitimately lacks a monitor); documented as a
  refinement, deferred.

## Weakest premise
The manifest declares the monitors observed on THIS fleet box as the expected set for the fleet box.
If a fleet box legitimately should not run one of them, the audit would report it "missing" until a
per-host scope field (deferred to #3243) is added. For the box this audit is for, all 7 are expected;
the audit is on-demand today (scheduling it is #3243), so a false "missing" is a report a human reads,
never an action.
