# #2215: cut-guard marker liveness is fooled by PID reuse

## What "done" looks like
The three run guards (harness / cut / browser) stop false-refusing on a stale marker whose PID has
been recycled to an unrelated process. A marker counts as a live marking run only when the PID is
alive AND its command still matches the one recorded when the marker was written.

## Root cause
`tools/lib/cut-guard.sh` `_kosmos_marker_other_live` treated `kill -0 <pid>` success as "the marking
run is alive." A marker file (`<type>.<pid>`) outlives the process that wrote it, and the OS reuses
PIDs, so `kill -0` succeeds against whatever unrelated process later inherited that PID (a macOS
daemon aborted the 6.32 staging cut: "a marked harness run (pid 15337)" when 15337 was
`generativeexperiencesd`). The auto-cleanup could never remove it, because it only unlinked markers
whose `kill -0` FAILED. Markers accumulate in `~/.cache/kosmos-run-markers/` and each is a latent
false-positive once its PID is reused.

## The fix (card's preferred option 1 -- command match, mirroring the name arm)
- `kosmos_mark_run`: record the marking process's command (`ps -o command= -p $$`) as line 2 of the
  marker, alongside the cookie on line 1 (line 1 unchanged, so the self-exclusion read is unaffected).
- `_kosmos_marker_other_live`: after `kill -0` succeeds, require the live PID's current
  `ps -o command= -p <pid>` to equal the recorded command. A mismatch (recycled PID), OR a marker with
  no recorded command (written before this fix), is treated as stale and unlinked. This also clears
  the accumulated latent markers the old check could never remove.

### Why unlinking a command-less / mismatched marker is safe
Each guard's refusal is `{ pgrep NAME arm } || { marker arm }` (harness: test-install.sh, cut:
release.sh, browser: browser-checks.sh -- each filtered to a real `bash tools/<script>` command and
self-excluded). A genuine FOREIGN run is caught by the name arm independently, so unlinking a marker
we cannot verify loses no real detection; it only removes a false-positive the marker arm would
otherwise raise. The fix tightens the marker arm in the safe direction (fewer false-refuses) and never
loosens what the guard really protects against (a real concurrent run still trips the name arm, and a
verified live+matching-command marker still trips the marker arm).

## Rejected / weakest premise
- Rejected option 2 (compare start-time via `ps -o lstart=`): the command match is the card's preferred
  robust fix and mirrors the existing name-arm discipline; `lstart` formatting is more fragile.
- Weakest premise: the residual case of a recycled PID running the byte-identical command
  (`bash tools/release.sh`) would still read as live. It is astronomically unlikely (a recycled PID
  landing on the exact same command line) and is the residual the card names for option 2; not worth
  the fragility here. Documented rather than closed.

## Tests (tools/test-cut-guard.sh)
- Updated the existing hand-written live-marker fixtures (M1 foreign-live, M2 own-cookie) to the new
  two-line format so a genuine live run is still detected/excluded.
- New: a live PID whose recorded command does NOT match (recycled PID) does not refuse and the marker
  is cleaned -- the control that returns the dangerous answer (the old kill-0-only check refused here).
- New: a command-less (pre-fix) marker on a live PID does not refuse and is cleaned.
- Unchanged and still green: foreign-live-with-matching-command refuses; own-cookie excluded; dead-pid
  cleaned; no-marker does not refuse; self-mark-then-check does not refuse; end-to-end kosmos_mark_run
  detectable (now via the two-line format). Sibling guard suites (browser-run-guard, machine-claim)
  green.

## Verification
- `bash tools/test-cut-guard.sh` (0 failures), `test-browser-run-guard.sh`, `test-machine-claim-1962.sh`
  all green. Full suite + challenge-loop before PR. No em dashes.
- Safe to build/merge without disrupting active cuts: a merge affects only runs that use the updated
  cut-guard after deploy; the fix direction is fewer false-refuses.
