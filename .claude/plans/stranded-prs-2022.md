# Plan: stranded-prs-2022

Addresses **kosmos#2022**: a merge-ready PR with no active owner is invisible work.
Nothing on the fleet counts "green, non-draft, unblocked PRs that nobody will merge",
so a PR that is done except for the merge is indistinguishable from finished work and
sits (two found by accident on 2026-09-03; #1875 sat 18 hours).

## Split (Splinter, 2026-09-03)

#2022 has two genuinely different halves. **This is the DETECTOR half (mine).** The
HOLD-REASON AUDIT (does a hold cite a rule that does not exist) was Kitty's; a detector
can tell you a PR is sitting but cannot tell you the hold cites a nonexistent rule.

## The dominant mode is a CLOCK, not a language model

Kitty measured the failure rates across ~120 recent merges plus the open set: false-rule
holds are **n=1** (only #1983). The DOMINANT mode is the plain sitter: #1875 (18h),
#1975, #1978, #1863, #1865, #1871 all sat with NO hold reason at all, unowned or
context-limited. So the detector's payoff is **AGE + GREEN + NON-DRAFT, said loudly** --
not prose parsing. Per Splinter: "build a clock, not a language model for holds."

## What it does (`tools/stranded-prs.sh`, one fast command, read-only)

Lists OPEN, non-draft PRs idle longer than a threshold (default 2h) and, per PR, the
fields a PM needs to route it -- WITHOUT auto-merging (a naive "merge every green unowned
PR" lands a CONFLICTING PR as a stale merge and an overruled alternative as a regression,
the two 2026-09-03 damage cases):

- **CI** rollup collapsed to PASS / FAIL / PENDING / NONE.
- **MERGE** = `mergeStateStatus`. CONFLICTING/DIRTY is flagged SEPARATELY (`green CI` can
  be stale on a conflicting PR -- it needs a rebase owner, not a merge).
- **ISSUE** resolved from the branch or an "Addresses #N", with an **ISSUE-CLOSED** flag
  (the overruled-alternative smell: a closed issue on an open PR means another PR may have
  settled it the opposite way -- a human must confirm the approach is still live).
- A low-frequency **FALSE-HOLD-SUSPECT** backstop (Kitty's signature): on an otherwise-
  clean PR, a comment that defers merge to a PERSON (`held for Josh|eyeball|on his nod|
  per the ... rule|awaiting/waiting for Josh`) AND ALSO claims the author's own
  verification passed (`browser-check|screenshot|#1720|verified ... render/tile/page`).
  The two-part AND is load-bearing: person-phrasing ALONE would false-positive a genuine
  product-decision hold (#2041), which cites a person but claims no verification. This
  ROUTES to a human read (does the cited rule actually gate merge -- the irreducible half),
  it never merges.

## Design constraints honored (Splinter)

- **Keyed on OPEN PRs, never assignees.** Assignees are empty fleet-wide, so a detector
  keyed on them reports every card unowned and is useless in the reassuring direction.
- **Fast.** "A detector slower than the wrong answer will lose to the wrong answer." One
  command; the comment-scan is scoped to otherwise-clean PRs only, so the common case is
  one `gh pr list`.
- **Known gap, documented not hidden:** a stranded PR by definition has a pushed branch, so
  `gh pr list` sees it. But an UNPUSHED local branch (a claim made only locally) is
  invisible to this and to GitHub -- that is exactly why Splinter could not see
  stranded-prs-2022 and routed Kitty into this card. Card-ownership-by-branch is a
  separate view (`~/.claude/bin/who-is-on-what.sh`); this tool is about merge-ready PRs,
  which are always pushed.

## Testability

The gh binary and the clock are injectable (`KOSMOS_GH_CMD`, `KOSMOS_NOW_EPOCH`,
`STRANDED_PRS_REPO`) so the test feeds canned JSON and a fixed "now" with no network.

## Test (`tools/test-stranded-prs.sh`, wired into `test:shell`)

18 assertions via a stub gh + fixed clock: the done row flagged clean; CONFLICTING
flagged and NOT called safe (stale green); ISSUE-CLOSED overruled smell; draft excluded;
fresh PR filtered by the age cutoff (and surfacing when the cutoff is 0); CI FAIL / NO-CI
flags; the FALSE-HOLD-SUSPECT signature flagged; the genuine-decision-hold control NOT
false-flagged (proving the two-part AND); unparseable age surfaced with `?` not dropped;
and negative controls proving the assertions discriminate.

## Validation

- `bash -n` clean on both files; test passes.
- No `web/` change (no #1720 gate). No node engine change (a shell tool + a shell test).
- Full suite via GitHub CI.
