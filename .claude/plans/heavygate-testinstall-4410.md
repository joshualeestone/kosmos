# heavygate-testinstall-4410: heavy-gate sees the install harness, and a suite and a harness refuse to overlap

## Finished means (the card's "Done when", plus Liu Kang m2580)
- `tools/heavy-gate.sh` reports BUSY while a real `tools/test-install.sh` runs (by path, bare from
  tools/, or through `yarn test:install`). A mention, a node --test fixture and a kt<digits>
  sandbox fixture do not count (the #4259 fixture rule in tools/lib/process-fixture.sh).
- The cut guard reads the harness the same way: `kosmos_refuse_if_harness_live` drops proven
  unit-test fixtures, like the cut and browser guards beside it.
- `tools/run-tests.sh` refuses to start beside a live harness (`KOSMOS_TESTS_IGNORE_HARNESS=1` runs
  anyway), and `tools/test-install.sh` refuses to start beside a live suite
  (`kosmos_refuse_if_suite_live`, `KOSMOS_HARNESS_IGNORE_SUITE=1` runs anyway).
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
- test-install's suite check stands down in a cut's own gate run (KOSMOS_INSTALL_GATE=1), as its
  cut check does: the cut's suite has finished by step 4b, and its machine claim already refuses
  new suites, so a refusal there could only abort a cut.
- No run marker for the suite: markers exist for callers that self-match their own script (#1796);
  nothing that asks the suite question is a run-tests.sh. The harness keeps its existing marker.
- The harness guard's override text is now the caller's (second argument). The cut's default
  wording is unchanged (a control pins it), and run-tests.sh names KOSMOS_TESTS_IGNORE_HARNESS.
- The harness guard's refusal no longer says "the install gate's fixed port": outside a cut the
  port is probed from 4460 up, and the reason that holds for both callers is the real boards on
  test ports.
- tools/test-cut-guard.sh's end-to-end stand-ins moved from $T to a /tmp folder outside the
  kt<digits> sandbox: with the fixture rule, a stand-in under run-tests.sh's sandbox would be dropped
  and the detection arm would fail for the wrong reason. A new arm asserts the folder is outside it.

## Weakest part
- The cause of the reds (load vs the default port) is not proven; the fix does not depend on it.
- A harness started under an override, or a nested run-tests.sh fixture that runs past the guard
  while a real harness is live, would still refuse; that is the refuse-rather-than-guess side.
- The suite guard's name arm uses pgrep, which on macOS never lists its own ancestors (#1391). So a
  run-tests.sh that is an ANCESTOR of a test-install.sh is invisible to it and does not refuse,
  which is the right answer for one run but rests on pgrep's behaviour, not on this code. Nothing
  does that today: no suite test runs the real harness (tools/test-cut-guard.sh's stand-in is a
  fake script).
