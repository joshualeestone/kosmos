# coordfloor-5037: a cut refuses a connector the coordinator serving traffic is not ready for (kosmos#5037)

Asked by Splinter for the 0.7.18 cut (2026-10-02 11:03): kosmos-relay#260 (#4869, 534f36980) must reach
the coordinator before any connector carrying it ships, and the coordinator must never roll back below it.
Measured: the coordinator served build 592c8dc1 (no #4869) while relay main was 534f36980, and step 1d makes
the connector match relay main.

## Change
- tools/coordinator-floor: the relay commits a connector may carry only once the coordinator has them.
  Today one line, 534f36980f2f364b178193eb54958329d3daf6d5 (#4869).
- tools/lib/coordinator-floor.sh `coordinator_floor_check <connector> <relay> <floor>`: for each floor
  commit the connector's .commit contains, the coordinator's /v1/meta "build" must contain it (ancestry in
  the relay checkout, which step 1d has just fetched). Unreadable meta, no build, a build or floor commit
  the checkout lacks: refused. KOSMOS_ALLOW_COORDINATOR_BEHIND=1 ships anyway and says what it skips.
  KOSMOS_COORDINATOR_URL, default https://login.kosmosplus.com (engine/remote.js DEFAULT_COORDINATOR).
- tools/release.sh step 1d2, right after 1d and before the version bump.

## Tests (tools/test-coordinator-floor-5037.sh, in test:shell)
Throwaway relay history OLD < FLOOR < NEWER, a stand-in connector with sidecars, /v1/meta from file://.
Below-floor connector passes without asking (control: meta absent); a connector from a pre-squash branch
(off the floor's line) is asked about and refused beside an older coordinator (control: passes beside an
at-floor one); a dirty build refuses as dirty; a branch-deployed build refuses naming that case; floor-carrying connector with an older
coordinator refuses (the #4869 shape) and names the change; at-floor (short id) and above (full id) pass;
a connector built exactly at the floor is checked; no meta / no build / unknown build / unknown floor
commit refuse; the override works and only for exactly 1; the committed floor holds full shas incl.
534f36980; release.sh runs the step before the bump.

## Rejected
- Building the connector below 534f36980 (Splinter's alternative): ships 0.7.18 without #4869.
- Comparing by content, as 1d does: the coordinator reports a commit, so ancestry is the question. A coordinator
  deployed from a branch ahead of main (deploy-coordinator.sh allows it) reports a sha the checkout may lack;
  that is refused (fail closed), and the refusal says to fetch the branch or redeploy from main (review 3).

## Weakest premise
That /v1/meta's "build" is the relay commit the serving coordinator was built from. True on 10-02 (it
reported 592c8dc1, a relay main commit); if a deploy ever stamps something else, the gate refuses (unknown
build), it does not pass.

## Residual
- The ambiguous-short-id refusal is untested (a fixture needs two objects sharing a 7-hex prefix); it only words a refusal.
- Mac cut only: the Windows lane (build-kosmos-windows.sh stages kosmos-tunnel.exe with a .commit) does not
  run release.sh and does not ask the coordinator. Step 1d has the same gap.
- Checks the coordinator at cut time only. A coordinator rolled back below the floor AFTER a cut, or a connector
  reaching users by a later promote of an earlier staging cut, is not caught here; #4869 step 2 (never roll
  back below 534f36980, rename the rollback binary) is the rule for that. A deploy-side refusal would belong
  in kosmos-relay's deploy-coordinator.sh.
- The override covers a coordinator known to be behind, never an unknown one (stated in the lib and in the
  refusal text).
- /v1/meta is read with two retries of any failure (--retry-all-errors, DNS and refused connections included)
  and parsed as JSON. A failure lasting past the retries still refuses (fail closed; rerun the cut).
- A coordinator deployed from the pre-squash branch carries #4869 by content but is refused even with that branch
  fetched (the squash commit is never its ancestor); it needs the override. Intended, by the by-ancestry choice.
