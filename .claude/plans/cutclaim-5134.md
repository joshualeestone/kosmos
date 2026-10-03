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
