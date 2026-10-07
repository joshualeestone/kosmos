# #5495: a request Kosmos's own hook allows reports working, not needs-you

Card: joshualeestone/kosmos#5495 (follow-up to #5406 Part 1, PR #5498, merged 2026-10-07).

## Finished looks like
With Kosmos's agent settings file in effect, a PermissionRequest that Kosmos's allow hook answers leaves the
agent's card "working". A request the allow hook leaves alone (AskUserQuestion, a protected place, unreadable
input) still reports "needs you". An agent launched without that settings file reports exactly as before.

## Approach (decided)
- engine/agentpermission.js: the settings file Kosmos passes with --settings also sets `env`:
  KOSMOS_PERMISSION_ALLOW_NODE (node) and KOSMOS_PERMISSION_ALLOW_SCRIPT (the allow hook). Measured on Claude
  Code 2.1.293: a --settings file's env reaches hook processes (scratchpad probe, parent env cleared first).
- install/kosmos-report-hook.sh (macOS, Linux): on PermissionRequest, when both names are set and point at an
  executable and a file, pipe the same input through the allow hook; output with "behavior":"allow" means
  report `working --auto "running <tool>"`; otherwise needs_you as before.
- engine/kosmos-report-hook.js (Windows): same, asking this install's own decide() in-process (never a path
  from env), gated on the env name being set.
- Test: report-hook-allowed-5495.test.js drives the real shell hook (jq and no-jq), the real node hook and the
  real allow hook, each allowed case with a no-env control; perturbation (fix disabled) turns 6 tests red.
  Added to tools/windows-tests.js ALSO_ROOT so its node half runs on Windows CI.

## Rejected
- Skip the report entirely for an allowed request: leaves whatever state was there; "working" is the truth
  and also clears a stale auto needs_you.
- A Kosmos env var exported by the supervisor: two launch paths (sh + win32) to keep in step; the settings
  file is already the single thing that means "this agent has the allow hook", so the env rides with it.
- Re-implementing decide() in bash: two copies of the protected-place rule would drift.
- Having the allow hook itself report: the two hooks run in parallel, so the reports would race.

## Weakest premise
That the allow hook really answered whenever decide() says allow. If the allow hook fails to run (timeout,
crash) while the report hook's own run of it succeeds, a real prompt would show with the card "working". Both
run the same file with the same node on the same input, so this needs a failure in one run only.
Also: the env propagation was measured on 2.1.293 on macOS only, not on Windows or Linux.

## Validation
- node --test on report-hook-allowed-5495, agentpermission-5406, the report-hook tests, reporthook, the
  file-scanning guards, windows-tests-1777, tools.build-windows-570 (from repo root): all pass.
- tools/test-report-hook-{resolver,loud,source}.sh: rc 0.
