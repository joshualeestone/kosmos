# heavygate-testinstall-4410: heavy-gate sees the install harness, and a suite and a harness refuse to overlap

## Finished means (the card's "Done when", plus Liu Kang m2580)
- `tools/heavy-gate.sh` reports BUSY while a real `tools/test-install.sh` runs (by path, bare from
  tools/, or through `yarn test:install`). A mention, a node --test fixture and a kt<digits>
  sandbox fixture do not count (the #4259 fixture rule in tools/lib/process-fixture.sh).
- The cut guard reads the harness the same way: `kosmos_refuse_if_harness_live` drops proven
  unit-test fixtures, like the cut and browser guards beside it.
- `tools/run-tests.sh` refuses to start beside a live harness (`KOSMOS_TESTS_IGNORE_HARNESS=1` runs
  anyway), and `tools/test-install.sh` refuses to start beside a live suite
  (`kosmos_refuse_if_suite_live`, `KOSMOS_HARNESS_IGNORE_SUITE=1` runs anyway). Both stand down
  only for the run holding the live machine claim (a cut's own suite and gate:
  `kosmos_holds_machine_claim`), not for `KOSMOS_INSTALL_GATE=1` alone, which
  `yarn test:install-gate` also sets outside any cut.
- A test for each, red on main: tools.heavy-gate-3805.test.js (two #4410 tests, both red against
  main's gate, measured) and tools/test-cut-guard.sh (the fixture drop, the suite guard, the wiring).
- The port-range question answered with evidence (below).

## Evidence
- Kano, 2026-09-28 about 20:04 UTC (the card).
- Reproduced live 2026-09-28 20:08 UTC: Raiden's `bash tools/test-install.sh` (the #4342 worktree)
  ran beside Sonya's `yarn test` (the #4354 worktree). Main's gate said CLEAR; this branch's gate
  said BUSY and counted the harness. Raiden (m2587): that harness had 3 board-port FAILs
  (stranger-board and belt sections) while the suite ran; its own #4342 arm was 25/25.

## Do they share a port range? No, by reading and by the OS setting (not by a measured bind)
- test-install.sh probes a free port from 4460 up to 4499 (tools/test-install.sh, "4460-4499 IS
  DELIBERATELY NOWHERE NEAR THE DEFAULT").
- The node suite binds port 0 (run-tests.sh header), which macOS assigns from
  net.inet.ip.portrange.first..last = 49152..65535 on this Mac (sysctl, read 2026-09-28).
- No *.test.js or test-support file names a port in 4460-4499 (git grep; the only 44[6-9]x hits are a
  GUID and the harness's own files). The fixed numbers tests do use (16180, 16245, 17000, 17777,
  18731, 7777) are strings handed to code, and none is in the harness range.
- So no separate ranges are needed, and none were added. The collision is therefore most likely
  LOAD (a suite's CPU and process churn slowing the harness's board starts and port releases past
  its waits) or the product DEFAULT port the harness also checks, not a shared range. Kano's and
  Raiden's reds are consistent with either; neither is proven, and refusing the overlap removes
  both causes, which is why the fix is the refusal and not a port change.

## Decided, and why
- heavy-gate counts the harness in DEFAULT mode, not only under --quiet-box: it boots real boards,
  like browser-checks, and the card's failure was two runs behind a clear default gate.
- Both new checks stand down for the claim holder (review 1, W2/W3). A cut's own suite (step 3) and
  its own install gate (step 4b) never overlap, so a refusal there could only abort a cut. KOSMOS_INSTALL_GATE=1 was the first scope and was wrong:
  `yarn test:install-gate` sets it with no cut and no claim.
  Standing down loses no protection because two OLDER mechanisms cover the cut's whole life (review
  2): a harness starting during a cut is refused by its own kosmos_refuse_if_cut_live (it sees the
  cut's `cut` run marker), and a suite starting during a cut is refused by
  kosmos_refuse_if_machine_claimed. The comment on kosmos_holds_machine_claim says so, so an edit to
  either one knows it is load-bearing here.
- test-install.sh's older cut check was skipped for KOSMOS_INSTALL_GATE=1, so `yarn test:install-gate`
  outside a cut skipped it too, and the stand-down above leaned on it (review 3, W1). It is now skipped
  only for the claim holder. The cut's own gate passes it anyway (it inherits the cut's marker cookie,
  and pgrep does not list its release.sh ancestor), so no cut can refuse itself here.
- The stand-in is started by its absolute path, so its script path proves the sandbox to other
  guards (its cwd is the test's, never in the sandbox, so the path is the only proof); it lives 8 s, and its two guard arms count only if it is
  still alive after both (else SKIP), so the "dropped" arm cannot pass on an empty table (review 3).
- heavy-gate's --except-cwd never rules out an install harness (review 7): your own harness still
  collides with your own suite, and run-tests.sh refuses beside it, so a CLEAR there would be one the
  scripts overrule. Before test-install.sh the read to use is --quiet-box, which counts suites.
- The suite guard's real name arm is tested through _kosmos_suite_candidates (pgrep plus the filter)
  against its own stand-in's pid, because a refusal on a busy Mac cannot say whose suite it saw.
  Breaking the filter turns that arm red (measured).
  The guard's logic after the source (rc, self drop, fixture drop, refusal) is shared by the seam
  and the live read, so the seam arms cover it; inverting its found/none test turns an arm red
  (review 8, measured).
- tools/test-install-gate-control.sh (run by hand) calls test-install.sh with KOSMOS_INSTALL_GATE=1
  outside any cut, so it is now refused on a busy box (review 9). It checks heavy-gate --quiet-box
  first, and a refusal in any of its three runs is reported as a SKIP with exit 3 (review 11), never
  scored as the gate's green (0) or red (1).
- heavy-gate's live candidate filter (the awk in live_snapshot) is covered by the fake-ps live test
  with a real harness row; dropping test-install from it turns that test red (review 9, measured).
- No run marker for the suite: markers exist for callers that self-match their own script (#1796);
  nothing that asks the suite question is a run-tests.sh. The harness keeps its existing marker.
- The harness guard's override text is now the caller's (second argument). The cut's default
  wording is unchanged (a control pins it), and run-tests.sh names KOSMOS_TESTS_IGNORE_HARNESS.
- The harness guard's refusal no longer says "the install gate's fixed port": outside a cut the
  port is probed from 4460 up, and the reason that holds for both callers is the real boards on
  test ports.
- tools/test-cut-guard.sh's end-to-end stand-in (a real `bash tools/test-install.sh` for 8 s in every
  suite run) now sits in a T/kt<digits> folder, so the shared fixture rule drops it in every guard on
  the Mac (review 1, W1: outside it, heavy-gate and other agents' run-tests.sh would read it as a live
  harness; #3619 measured the same stand-in reddening release-gate arms). Its own detection arm keeps
  it visible with KOSMOS_HARNESS_KEEP_FIXTURES=1, a test seam that can only refuse more; a second arm
  shows the same stand-in dropped without the seam.

## Weakest part
- A suite ALREADY running when a cut starts is not refused by the cut (release.sh never asked about
  suites, before or after this change), and the cut's own gate stands down, so a long suite can
  overlap step 4b. Making a cut refuse on any agent's suite is release policy, not this card; named
  in the code and raised on the PR for Liu Kang (review 5, W1).
- A suite and a harness starting within milliseconds of each other can both pass (each asks before
  the other shows in pgrep), or both refuse (the harness marks itself before it asks). Both-refuse
  is the safe direction.
- On a busy Mac a suite is live much of the time, so a harness outside a cut will often refuse and
  have to wait; there is no built-in wait (review 7). The refusal names `heavy-gate --twice
  --quiet-box` as the way to see when the box is quiet and says to expect waiting rather than
  overriding, because the override brings the #4410 collision back. A bounded wait-and-retry is a
  possible follow-up if agents start overriding.
- Two install harnesses at once are not refused by each other; only a cut refuses a harness. Each
  probes its own free port from 4460 up, and the card is about a suite beside a harness, so it is
  left out of scope (review 12 caught a comment that claimed otherwise).
- The new guard's test seams (KOSMOS_SUITE_PROBE, KOSMOS_SUITE_SELF_PID) could weaken it if left set,
  as the older guards' seams can. Only KOSMOS_HARNESS_KEEP_FIXTURES is one-directional (it only refuses
  more).
- The cause of the reds (load vs the default port) is not proven; the fix does not depend on it.
- A harness started under an override, or a nested run-tests.sh fixture that runs past the guard
  while a real harness is live, would still refuse; that is the refuse-rather-than-guess side.
- The suite guard's name arm uses pgrep, which on macOS never lists its own ancestors (#1391). So a
  run-tests.sh that is an ANCESTOR of a test-install.sh is invisible to it and does not refuse,
  which is the right answer for one run but rests on pgrep's behaviour, not on this code. Nothing
  does that today: no suite test runs the real harness (tools/test-cut-guard.sh's stand-in is a
  fake script).
