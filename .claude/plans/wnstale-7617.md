# wnstale-7617: the cut refuses a What's New list that is no longer what the pool builds

Card kosmos#7617, found in review of #7616 (#7615 item 5: each cut builds its own list first).

Change: tools/release.sh whats_new_gate (used by the early #7349 run and step 1b-ii) runs a third check,
_whats_new_fresh_check: `whats-new-pool.js build $V --offline --out=<tmp>` and compare with web/whats-new.json,
ignoring "also" (Windows adds it by hand, #4928) and key order. A difference refuses with the rebuild instruction.
Offline is right: it runs after prod-check has compared prod with the pool. KOSMOS_CUT_NO_WHATS_NEW=1 skips it with
the rest of the gate.

Tests (tools.release-gate.test.js): the sandbox pool now holds the highlight its file carries (every existing arm is
the control that a matching list passes); new arm adds a pool item merged after the build (must refuse at the early
check, with neither older check refusing); opt-out arm.

Measured: release-gate 69/69 rc 0; mutant (main's release.sh) -> the refusal arm fails, opt-out passes (2 tests ran);
What's New tests 52/52; main today (0.7.76 list, 150f1cfa6) matches a fresh build.

Consequence: a branch adding a pool item must rebuild web/whats-new.json in the same branch, or the next cut stops
(which is the point). Told PigeonPete (wnroom-7246) and Renet (musequota-7615).

Rejected: a CI check on every PR. It would red unrelated PRs whenever the pool moved; the cut is the one moment the
list must be right.
