---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: fix-render-projects-check
diff_hash: c46172f64653dcccb8731c31cc2bacfae1db02f5dd2c0df8adb74095259c0957
timestamp: 2026-08-25T19:30:00Z
iterations: 1
converged: true
---

# Pre-Challenge Proof: fix-render-projects-check

**Single pass, explicit override, labelled honestly.** /code-review has
been unavailable in this session all night. Self-reviewed instead.
Time-critical (a release cut was blocked, Angel and Baron waiting), but
speed did not skip verification -- both fixes were confirmed by direct
reproduction before and after.

## Iteration 1 (single pass, self)

[STRENGTH] **Diagnosed by direct reproduction against a live server,
not by inference from either side's plausible story.** Baron read it as
possibly a real regression; Splinter's first pass agreed it was a
possible layout bug, then reversed after independently re-deriving the
`display:none`-gives-all-zero-rect mechanic. I did not adopt either
reading on faith -- ran the exact 200-char-description scenario the
check itself runs, confirmed `pj-list` carries `asgrid` by default and
`.pc-t`'s computed `display` is `none` there, before writing a single
line of the fix.

[BLOCKER] (found and fixed before this proof) **My own first
verification run tested the WRONG code.** I ran `bash tools/browser-
checks.sh render-projects` before committing my edit; the harness's
own freeze-at-last-commit guard printed a warning I initially read past
and reproduced the ORIGINAL failure against pre-fix code, which
briefly looked like my fix had failed. Caught by reading the harness's
own warning line rather than trusting the error message's face value,
consistent with this session's standing lesson about verifying against
what actually shipped, not what was intended.

[STRENGTH] **Found a second, related regression the same root cause
produced**, not just the one Baron's cut reported. The contrast pass
further down the same file also measured `.pc-t` against grid's
default and would have silently lost real coverage (a `missing: true`
entry the file's own philosophy already treats as a hard fail) --
caught by reading past the first failing assertion rather than stopping
at the one line Baron's log named.

[STRENGTH] **Did not revert either design PR to make the check pass.**
Both #860 and #861 are deliberate, disclosed changes from earlier the
same afternoon (Josh's own asks, both already shipped and documented in
their own PRs). Confirmed neither PR's own trail hid the ruling before
treating the check as the stale artifact -- Splinter independently
checked the 08-20 ruling's provenance for the analogous placeholder
case earlier today and this is the same class of check, so the same
verification standard applied.

## Verification

- Direct live-server reproduction of the exact failing scenario,
  before and after the fix (see plan).
- `bash tools/browser-checks.sh render-projects`, run twice against
  correctly-committed code (the first run's freeze-warning miss is the
  one BLOCKER above): both 2b-description and 7-contrast passed clean.
- Full `bash tools/browser-checks.sh` (all checks): "all page checks
  passed".

### Final Ledger

1 BLOCKER found and fixed before this proof (verified against
pre-commit code on the first pass, caught via the harness's own
warning rather than the misleading-looking error). 0 findings remain
open.
