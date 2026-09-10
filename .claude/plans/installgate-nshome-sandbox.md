# installgate-nshome-sandbox -- step-4b install gate cut blocker

## Problem

Every 0.6.55 cut on **mortals** (the live cut box) aborts at step 4b, the sandboxed
install gate (`tools/test-install.sh`, #624):

```
FAIL  launcher passes its own account and starts the board
```

The gate passes on a clean laptop (Agent1s) and fails on mortals. That box-dependence
is the defect: a cut gate must return the same verdict on any box.

## Root cause (directly confirmed, not inferred)

The gate's three launcher arms each boot the freshly built `Kosmos.app` and wait for it
to run `kosmos start` (or to refuse). But `applicationDidFinishLaunching` runs the #2124
single-instance guard **first**: `otherRunningInstance()` (native-app/main.swift:909)
enumerates `NSRunningApplication.runningApplications(withBundleIdentifier:)` for this
bundle id, and if any is found `shouldDeferToExistingInstance()` (:923) returns true, so
the app activates the survivor and `NSApp.terminate`s **before** `startBoard`
(decision at :1004).

mortals runs the live fleet, so `/Applications/Kosmos.app` is **always running**
(confirmed: pid 90171, owner mortalkombat). The sandbox copy shares its bundle id, defers
to it, and exits before `startBoard` -- so `launcher.log` / `refuse-app.log` /
`own-open.log` are never written and each arm fails. A clean laptop has no instance up, so
the guard never fires and the arms pass.

This is the same recurring class as the block-delivery harness env-dependency (#2259):
a cut gate read live machine state (here, "is a Kosmos app running") that differs between
a clean box and the box that runs the fleet.

(Note: an earlier diagnosis blamed the NSHomeDirectory/own-Kosmos lookup and the
`KOSMOS_APP_TEST_HOME` seam. That was wrong -- an explicit `KOSMOS_HOME` is honored first
and unconditionally (main.swift:159), so the own-Kosmos lookup never runs in the positive
arm. The direct instrument -- a running instance plus the dedup path -- is the real cause.)

## Fix (harness only)

Set `KOSMOS_RELAUNCH_HANDOFF=1` on all three launcher invocations in
`tools/test-install.sh`. That env var is the #2094 self-update relaunch signal ("this
fresh copy is intended, do not dedup it"); `consumeFreshRelaunchHandoff()` returns true and
`shouldDeferToExistingInstance(handoff: true, ...)` returns false, so the launch path runs
on any box.

- On a **clean** box the fix is a **no-op**: with no other instance, the dedup would not
  have fired anyway. So it cannot regress the existing green.
- No product change. The #2124 dedup itself is correct product behavior; only the harness
  needs to opt out of it, exactly as the block-delivery fix opted out of live content state.

## Verification

- Failure reproduced on mortals: the re-cut's step-4b log shows the exact FAIL with
  `launcher.log: No such file or directory`, while a real Kosmos.app was running.
- Fix run on mortals (the box that fails) against a freshly built ad-hoc bundle: the three
  launcher arms pass. [to be filled from the on-box gate run]
- Clean-box green preserved (fix is a no-op with no instance up).

## Files

- `tools/test-install.sh` -- add `KOSMOS_RELAUNCH_HANDOFF=1` to the three launcher-arm
  app invocations (positive / refusal / own-copy), with an explanatory comment.
