# uninstall-dataroot-leaf-2439 -- #931 uninstall fallback uses the stale store leaf

## Problem

0.6.55's step-4b install gate fails on mortals at the #931 checks:

```
FAIL  the job naming the sandboxed install's supervisor is removed
FAIL  the removed job is named in the log as removed
FAIL  control: the job naming the real supervisor IS removed, as before #931
```

Reproduced in ISOLATION (no app build, no signing -- pure `install/setup.sh --uninstall`
over seeded plists), so it is box-independent and a genuine bug, not an artifact of the cut
environment. It was latent until now only because every recent cut aborted at the earlier
launcher-arm blocker (#2124 single-instance dedup) before reaching #931.

## Root cause

#2439 renamed the store dir `AgentWorkforce` -> `Kosmos` (engine/store.js `APP='Kosmos'`,
`LEGACY_APP='AgentWorkforce'`, migrated by `maybeMigrateLegacyStore()`). It updated the
write-side data-root derivation (setup.sh:3522, which is legacy-aware: the legacy leaf only
when it exists and the new one does not, else the new leaf) but MISSED the uninstall's
`_kosmos_data_root()` FALLBACK at setup.sh:1106, which still hardcoded `/AgentWorkforce`.

`_kosmos_data_root()` consults the installed `store.js` `dataRootFor()` when a runtime is
present (returns the correct `/Kosmos`), and only takes the fallback when it cannot (no
installed runtime -- a partial install, or the #931 test's synthetic empty KOSMOS_HOME). On
that path it resolved `.../data/AgentWorkforce/bin/agent-supervisor.sh`, while a post-rename
install's agent jobs name `.../data/Kosmos/bin/agent-supervisor.sh` -- so the ownership grep
never matched and the uninstall LEFT its own agent jobs behind (orphaned launchd jobs on a
partial uninstall). The #931 test seeds `/Kosmos`-named plists (matching real create.js
output) and so caught it.

## Fix

Match the fallback to setup.sh's own write-side pattern at :3522: the legacy leaf only when
`$base/AgentWorkforce` exists and `$base/Kosmos` does not, else `/Kosmos`. A fresh or
sandboxed home (neither leaf present) resolves to `/Kosmos`, agreeing with what the consult
path (dataRootFor's `APP` default) returns. Legacy unmigrated installs (AgentWorkforce
present, Kosmos absent) still resolve to `/AgentWorkforce`, so a pre-migration partial
uninstall still finds its data.

Single file: `install/setup.sh`, the `_kosmos_data_root()` fallback branch. The result still
ends in `/AgentWorkforce` or `/Kosmos`, which the five downstream delete-bounding refusals
already accept (setup.sh:1168).

## Verification

- #931 failure reproduced in isolation on mortals against origin/main's setup.sh.
- With the fix, both the sandbox arm and the control arm pass (d931own removed + logged;
  d931foreign survives; control removes the real-supervisor job). [on-box run]
- Full step-4b gate green after this + the launcher-arm harness fix.

## Follow-up (after 0.6.55, per Splinter)

Grep setup.sh (and the rest of the tree) for other hardcoded `AgentWorkforce` leaves left by
#2439; this is the second one found.
