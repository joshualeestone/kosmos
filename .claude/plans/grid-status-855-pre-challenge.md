---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: grid-status-855
diff_hash: 9508e541ec00ba57d4b2d80fcb5770d77e9d9954c44cdb465fd1b295ccf83589
timestamp: 2026-08-25T16:26:00Z
iterations: 1
converged: true
---

# Pre-Challenge Proof: grid-status-855

**Single pass, explicit override, labelled honestly.** /code-review has
been unavailable in this session all night. Self-reviewed instead.

## Iteration 1 (single pass, self)

[STRENGTH] **Checked the shared derivation is really shared, not
duplicated, before touching the card.** `saidLine()` backs three call
sites (card, list row, detail panel); the comment above it says so
explicitly. Confirmed the removal was scoped to ONE render site (the
card's template), not the function itself, so the list row and detail
panel are provably unaffected -- their own tests (unchanged) still pass.

[BLOCKER] (found and fixed before this proof) **An existing test locked
in the exact behaviour this card asks to remove.**
`web.said-line.test.js`'s "the three surfaces all read the shared
derivations" test asserted `cardFn.includes('saidLine(')` -- reading the
suite before editing the implementation would have shown this test
failing the moment the change landed, so it was rewritten deliberately
(the card's own new test asserts the OPPOSITE: it does NOT call
`saidLine`) rather than left to fail or silently loosened.

[STRENGTH] **A stale comment was corrected in place, not left to
mislead.** Two comments (one on the now-deleted `.asaid` CSS rule, one
on the list row's markup) asserted "the card and the list row cannot
disagree about the said line" -- true only while both rendered it. Left
uncorrected, either comment would have told the next reader something
false about a decision that had already changed. Both rewritten to state
what actually holds now (the LIST row and DETAIL panel cannot disagree
with each other; the card made an independent choice to drop the line
entirely).

[WARNING] (checked, not assumed) **`.acard` has no fixed height**,
confirmed by reading its base CSS rule before claiming "reduce the
overall height... follows automatically" in the plan -- a fixed
min-height would have needed its own edit; there wasn't one.

## Verification

- `node --test web.said-line.test.js web.not-running.test.js`: 23/23
  pass (8 + 15), post-rebase.
- `npm test` (full suite): 0 failures, exit 0, run twice (pre- and
  post-rebase onto main, which picked up an unrelated cut-blocking fix
  from earlier this hour, not caused by this branch).
- `bash tools/browser-checks.sh` (full suite, post-rebase): all page
  checks passed.

### Final Ledger

1 BLOCKER found and fixed before this proof (an existing test pinning
the retired behaviour, rewritten to assert the new invariant rather than
left to fail). 1 WARNING checked and confirmed safe (no fixed card
height to separately adjust). 0 findings remain open.
