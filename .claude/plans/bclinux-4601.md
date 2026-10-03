# bclinux-4601: the per-PR browser-checks job runs on ubuntu-latest

Card: #4601 (the hosted macOS pool queues about an hour; the CI-starved merge rule exists because of it).
Decision and weakest premise: #4601 comment 5956923938 (PigeonPete, 11:45 CDT 2026-10-02).

## Why
Baron measured (on #4601) that the macOS pool is 96% busy with real work, so no workflow tuning helps.
The two levers are a bigger allowance (money, Josh's) or fewer macOS minutes per PR. browser-checks.yml is
30% of macOS minutes, and it runs only the DOM-state allowlist plus the checks the diff selects, never
paint or timing checks. Its macOS pin was a consistency choice, not a measured need. Linux and Windows
jobs start at once.

> **SUPERSEDED in part (read "Design change" and the sections after it).** The "Change", "Not changed" and
> "Verification" sections below describe the FIRST design: the whole job on Linux with the same checks. The built
> design routes the checks in tools/bc-macos-only.txt to a browser-checks-macos job instead, so "the same checks
> running on Linux" is no longer the acceptance test; "every check runs on Linux or on macOS, none dropped" is.

## Change
1. .github/workflows/browser-checks.yml, job `browser-checks`: runs-on ubuntu-latest; after provision-pw,
   `sudo <pinned playwright> install-deps chromium webkit`; tmux from apt (after an apt-get update).
2. tools/test-browser-checks-workflow.sh: the pins follow (runs-on ubuntu-latest; tmux from apt before
   the checks; system libraries installed after provisioning and before the checks).
   browser-checks-full.yml (nightly, full set) stays pinned to macos-latest.

## Not changed
- test.yml stays on macOS (about 40 tests fail on Linux for correct macOS-only reasons, recorded there).
- The cut's 3b and browser-checks-full.yml stay on macOS: the OS-family gate is where shipping is decided.
- No self-hosted runner (public repo; every fleet Mac holds agent credentials).

## Verification
- tools/test-browser-checks-workflow.sh green; a mutant putting macos-latest back fails it.
- The PR's own browser-checks run on ubuntu-latest (a pull_request uses the PR's workflow) must be green
  with the same checks running. Any check that cannot run on Linux is named on the PR and either fixed or
  the job goes back to macOS (the card's "what would change my mind").
- Rule for the full-set measurement (Splinter, 11:59, tightening my own condition): a check red ONLY on
  Linux is NOT added to KNOWN_RED by default; that would be weakening the check. Each one is listed on
  #4601 with its cause, and the job moves only if every one is a runner difference I can explain (font,
  WebKit port, a macOS path in a fixture), never a product bug the Mac happens to hide. "Linux-only"
  means red on the Linux run and green on the latest macOS nightly for the same check.

## Iterations
(filled in by the review loop)

### Iteration 1 (opus, blind): 0 blockers, 4 warnings. All taken.
1. Only the allowlisted checks would be measured on Linux. Fixed: the FULL set is measured once on ubuntu
   by dispatching browser-checks-full.yml on this branch with a temporary MEASUREMENT ONLY commit
   (run 37036328772); reverted before the PR, and the workflow test fails while it is in place.
2. False and stale macOS comments. Rewritten (what the job runs, a fourth way its green differs from 3b).
3. Linux WebKit is not Safari's. Named in the comment as a cost.
4. sudo ran the pinned playwright under the image's system node. Removed (install-deps elevates apt itself).
NITs taken: one apt-get update. Left: click-first-run.js's historical "macos-latest runner" wording.

### Iteration 2 (sonnet, blind): 0 blockers, 1 conditional warning, nits.
1. WARNING (conditional): the comment promising KNOWN_RED entries. Resolved by the measurement and
   Splinter's rule: Linux-only reds are explained on #4601 one by one, not added to KNOWN_RED, and KNOWN_RED
   only suppresses a SELECTED check, so an allowlisted Linux-only red would red every PR. The comment is
   rewritten with the results.
NITs taken: the pgrep claim is now "not verified on Linux"; the 2026-09-07 run is "on the macOS runner".

## Design change (13:20 to 13:45): route by platform, drop nothing
The full set on Linux (run 37036328772): 12 Linux-only reds, none in the allowlist. Rerun with system-ui pinned
to Liberation Sans (run 37045524112): six passed (font width, proven); five did not. Under Splinter's rule the job
does not move whole. Measured on the last 40 page commits: the selector picks extra checks on 85%, so "selected on
macOS" pays nothing; the six Linux-sensitive checks appear in 11 of 40. Built: a route step, tools/bc-macos-only.txt
(each entry with its measured cause and a card), and a browser-checks-macos job that runs only when something is
routed. The three unexplained checks are filed as #5052 and posted on #4916 (the Linux port).

### Iteration 3 (opus, blind, on the routed design): 0 blockers, 3 warnings. All taken.
1. always() spent a macOS runner on a superseded (cancelled) run. Now `!cancelled()`; the test pins it.
2. tools/bc-macos-only.txt was not in the paths filter, so a routing change never ran end to end. Added and pinned.
3. The list broke its own entry rule ("NOT EXPLAINED" passed as a cause). The header now says what makes routing
   safe (the check still runs on macOS), and every cause must cite a card (#5052 for the unexplained); pinned.
CONVENTION taken: the route step refuses an empty Linux set (browser-checks.sh reads empty as "run everything").
CONVENTION left: the macOS job starts after the whole Linux job (a parallel route job would save its wait on the
~28% that route something; a design trade, recorded).
NITs taken: stale "run step" comments; the page-gate comment moved back above the checks step.
Mutants: always() restored, the paths entry removed, and a card stripped from one entry each fail their pin.

### Iteration 4 (sonnet, blind): 0 blockers, 0 warnings. CONVERGED.
Verified: word splitting of the folded allowlist under set -eu; prefix-safe membership; no pipefail trap; the empty
Linux-set guard; each name runs on exactly one side; the never-ran guard covers both; !cancelled() gating; outputs
survive a red Linux job; the font heredoc; no em dashes.
NIT taken: the route-step comment now says a step failing before route also skips the macOS set (job red then).
Left: the date in bc-macos-only.txt is right (checked with date); the comma-splitting note; the 60-minute macOS
timeout (headroom for the queue).

## Final blind review (2026-10-02 19:33, Sonnet) and what it changed
- The route step is now RUN on fixtures by tools/test-browser-checks-workflow.sh (overlap, selection-only, prefix names
  in both directions, no selection, all-routed refused). Mutants: swapped case arms red; prefix match red (it was
  green until the reverse-prefix fixture was added, measured).
- Each routed name must be a gated.txt line or a run_one label (what the allowlist matches), not only a file.
- A Linux job that fails before routing now says the macOS checks did not run (pinned in the test; mutant red).
- Comments corrected: seven routed (five Linux reds plus two broken BY the font pin, a trade of six fixed for two
  routed); the macOS job's condition is !cancelled(), not always().
- Left: blank-line and CRLF tokens are inert (whole-token membership); apt update ordering relies on install-deps.

## What this PR's own CI will and will not prove
It runs both workflows' paths filter, so the Linux job runs and proves the font pin took and the allowlist passes
under it. The macOS job runs only if this diff's selection names a routed check, which a workflow-only diff likely
does not, so the macOS job may be SKIPPED and its steps unproven by this PR. The seven routed checks' macOS passes rest
on the nightly full set (macOS), not on this PR.

## Review round 3 (Sonnet, 19:42) and the end-to-end proof of the macOS job
- The macOS job (the mac_set hand-off, its tmux install, the routed run, and the hand-off when the Linux job ends red)
  is not exercised by a workflow-only PR. DECISION: the PR carries one MEASUREMENT commit that touches a routed check
  (a comment line in docs/browser-checks/render-tasks-view-3559.js), so the PR's first CI run selects it and the macOS
  job runs for real. Reverted before merge, paired the same way as the earlier measurement commits; the check before
  the PR is `git log origin/main..HEAD -- docs/browser-checks/render-tasks-view-3559.js` showing the pair and an empty
  diff against main for that file.
- Fixed: the header's caveat 2 names Linux; the all-routed fixture asserts rc=1 and no Linux set written; a nil guard
  in the step-order check; labels matched with grep -F; tmux pinned after install-deps.

