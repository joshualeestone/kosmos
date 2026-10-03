# intping-5151: test, check, cut and fleet installs mark their pings internal (kosmos#5151, day-one)

## Why
From Monday's public beta Josh reads install numbers from installkosmos.com's install-ping records. Measured 10:20
2026-10-03: 35,876 records, 0 under internal/; 2,036 versioned installs in 7 days, 2,035 US and ONE outside user;
11 installs on 0.7.21, a version never served. Almost all of it is our own boards.

## What existed (#4253 rule C)
App: engine/createdbeacon.js isInternal() adds internal:true when the data root holds internal.json={"internal":true}.
Site: api/_createdcore.js files internal pings under internal/ (and moves a record when the flag changes);
api/_admincore.js counts installs/ only. Nothing wrote the marker.

## Change
- isInternal() also honours KOSMOS_INTERNAL_RUN=1 (exact '1'); run-tests.sh, browser-checks.sh, release.sh export it.
- docs/browser-checks/lib-no-phone-home.js: a check run ON ITS OWN (node docs/browser-checks/<x>.js) bypassed
  browser-checks.sh's dead-port export and pinged installkosmos.com; the lib sets the dead-port URLs and the mark.
  lib-sandbox-home loads it; the 27 board-booting checks without lib-sandbox-home load it directly. README entry.
- install/setup.sh: the sandbox-only plist block carries KOSMOS_INTERNAL_RUN=1 when the install ran with it (review 1:
  a launchd-supervised walk-shape board gets only plist keys). A real install's plist is byte-identical.
- tools/fed-own-e2e.js boardEnv (hand-built) names the dead-port URLs and the mark (review 1).

## Tests
createdbeacon-3038.test.js: clears the flag at file top (run-tests exports it); '1' marks, '', '0', 'true', ' 1' etc.
do not; payload otherwise identical; reaches the wire. tools.no-phone-home-4253.test.js: every board-booting check
loads the lib (>=100 guard), the lib's defaults (subprocess, env cleared), harness exports, fed-own-e2e's env pinned
directly (the tools/*.js boot scan cannot see its spawn shape: red control proved it). test-install.sh: the walk-shape
plist carries the key exactly when the install ran with it. Every new guard was shown red with its protection removed.

## Done by hand (ops, reversible)
- internal.json written to the board data root on Agent1s and Mortals; the installed apps' own code confirms
  store.ROOT and isInternal() true (0.7.19, 0.7.20). Released builds honour the file: fleet pings flagged now.
- Backfill: the 11 records on 0.7.21 moved installs/ -> internal/ (dry run first); admin: 0.7.21 = 0, internal = 11.

## Rejected
- setup.sh writing internal.json into the data root: needs _kosmos_data_root, whose single call site is pinned.
- Backfilling by country/timing: "ours" is inferred, not provable, for anything but the unserved version.

## Weakest premise
"Ours" today is inferred from country plus timing; the cause of the 11 is consistent with direct check runs and the
cut's sandboxes, not proven (a ping carries no source). Hence marking every harness path, not just one.

## Reviews
Round 1 (opus, blind): 0 blockers, 2 WARNINGs (walk-shape launchd boards; fed-own-e2e), 1 CONVENTION (release.sh
comment), 2 NITs (test title taken; require-position left). All taken. Round 2 (sonnet): CONVERGED; NIT left (a long
comment line).
