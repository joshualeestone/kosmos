# cutclaim-5134: the cut's machine claim is renewed during long steps

Card: joshualeestone/kosmos#5134 (Baron's measurement; Splinter assigned to Renet 2026-10-03 05:15, day-one infra,
to merge before Saturday's 0.7.21 cut under the CI-starved rule).

## Problem
`release.sh` renewed the machine claim (#1962) only in `step()`, at step boundaries. The claim lasts 30 min
(`KOSMOS_MACHINE_CLAIM_MINUTES`), and step 3+3b runs about 67 min (4048 s in 0.7.19). So the claim lapsed mid-step,
the next consult deleted it (`_kosmos_machine_claim_active`), and a queued suite started beside the 0.7.20 cut on
Mortals (Splinter, 05:10).

## Decision
Option 1 from the card. Each `step()` stops the previous background renewer, renews once (as before), and starts a
new renewer that re-claims every `KOSMOS_CUT_RENEW_SECS` (default 600). This is the pattern queued-heavy.sh uses for
its turn. The renewer:
- renews with `KOSMOS_CLAIM_KEEP_LABEL=1`, so the claim keeps the cut's cookie, pid (`$$` is the cut's in a subshell)
  and label;
- checks `kill -0` on the cut's pid before every renewal, so a cut that dies without its traps (kill -9) stops it;
- stops after `KOSMOS_CUT_RENEW_MAX` renewals in one step (default 12, about 2 h), so a hung step still frees the
  fleet one claim length later;
- is stopped and reaped at the top of `cut_record_done`, which both EXIT traps call BEFORE `kosmos_release_machine`,
  so a renewal in flight cannot re-create the claim after the release.

Every call is `|| true` under release.sh's `set -euo pipefail`. release.sh only `wait`s on named pids (line 849), so
a background job cannot stall a bare `wait`.

Rejected: raising the cut's claim to 90 min (option 2). A hung cut would then hold the fleet for 90 min with no
renewal to stop, the trade #1962 chose against.

Weakest premise: the 2-hour per-step cap. If a healthy step ever ran longer than 12 renewals plus one claim length
(about 2.5 h), the claim would lapse inside it again. Step 3+3b is about 67 min today.

## Tests
`tools/test-cut-claim-renew-5134.sh` (in `test:shell`) lifts the real step/record block from release.sh and drives it
against the real `tools/lib/cut-guard.sh` in a sandboxed marker dir, with a 1 s renew interval. Arms:
1. the claim's expiry moves forward DURING one long step;
2. the renewal is the cut's own claim (same cookie and pid);
3. each step replaces the renewer;
4. after the cut ends and releases, nothing re-creates the claim, and cut_record_done clears the renewer;
5. renewals stop at the cap;
6. a cut killed with -9 stops its renewer, and the renewer process is gone.

Mutations, each red then restored: no renewer start (arms 1, 3, 6); no stop at exit (arm 4); no parent check (arm 6);
no cap (arm 5); no stop at step (arm 3). Sibling suites green: test-cut-step-record, test-machine-claim-1962 (22
arms), test-cut-parallel-region, and the 11 node test files that read release.sh (200 pass, 0 fail).

## Status
- [x] fix + test + wiring (fb26f7828, 8e57e9fa2)
- [ ] blind review loop
- [ ] full validation (Agent1s, free of the cut), proof, PR, merge under the CI-starved rule

## Review 1 (blind, opus, 05:2x) and what changed
- [WARNING] The renewer could write over a FOREIGN claim (ours lapsed across a Mac sleep, a queued run took the box,
  the next renewal replaced theirs). FIXED: each renewal reads `_kosmos_machine_claim_active` and renews only our own
  cookie or an empty slot. On a foreign cookie it says so on stderr and stops. Arm 7: the foreign claim survives
  three renew intervals and the cut's release, and the renewer is gone. Mutation (no check): 3 red.
- [WARNING] Arm 4 passed without the stop at exit (the cut exited, so the renewer's own cut-alive check hid it), and
  nothing pinned the `wait` in `_cut_renew_stop`. FIXED: arm 4 keeps the cut alive 3 s after its release. New arm 8
  models a renewal the stop cannot cut short (a TERM-ignoring subshell inside the claim), caught in flight. Without
  the `wait` it lands after the release and arm 8 reds. A first version used a plain slow stub and stayed green with
  no wait, because bash runs the TERM trap at the next command boundary; I measured that and rewrote it.
- [NIT] A killed cut's renewer lived up to 600 s, carrying release.sh's command line, which the cut-live guard reads.
  FIXED: the renewer sleeps in slices of at most 30 s and checks the cut after each.
- [NIT] The interval was not tied to the claim's length. FIXED: capped at a third of KOSMOS_MACHINE_CLAIM_MINUTES.
- [NIT] The temp file name is shared with the cut (same `$$`). Explained in a comment: safe because the renewer is
  reaped before the cut claims or releases.
- Kept: a hung step now holds the box up to about 2.5 h (12 renewals, then one claim length), against 30 min before.
  That is the queued-heavy.sh bound, and the weakest premise above.
Re-mutated on the new code, each red with the unmutated control at 0: no start (4), no cap (1), no cut-alive check
(2), no stop at step (1), no stop at exit (3), no wait (1), no foreign check (3). The test now has 12 checks.

## Review 2 (blind, sonnet, 05:3x): NO NEW ISSUES, converged
No BLOCKER or WARNING. Checked: no step() in a subshell, the renewer's `trap - EXIT`, `10#` on odd env values
(CLAIM_MINUTES=0 clamps to a 1 s interval; RENEW_MAX=0 exits at once), `_kosmos_machine_claim_active`'s delete
branches (unreachable on our own live claim; the marker dir is machine-local), and the slice arithmetic.
NITs: (1) after a kill -9 the renewer holds the cut's stdout up to 30 s; accepted, bounded. (2) a read-then-write
window between the foreign check and the claim; milliseconds, the claim is advisory; accepted. (3) two positive arms
used fixed sleeps with 1 s intervals and could red spuriously under load. TAKEN, because this test runs inside full
suites and cuts: arm 1 needs one renewal, not two; arm 5 waits (bounded, 20 s) for the renewer to exit on its own and
asserts it did. Re-mutated: no cap 1 red, no renewer 4 red, control 0. (A first edit put a comment mid-line and broke
the script's syntax; caught by bash -n before commit.)
