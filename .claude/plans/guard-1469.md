# Mechanically guard the #1430 CSS brace-anchor loosening (#1469)

Branch `guard-1469`. Closes the guard half of #1430; addresses #1469.

## The decision, made on contact (this is the load-bearing part)

#1469 asks for a mechanical guard so nobody re-anchors the 33 CSS assertions #1430
loosened from their rule's closing brace. On starting I found the premise does not
hold on `main`:

- The loosening (commit `571acb49`, "Unpin 29 CSS assertions ... (#1430)") is **not
  an ancestor of `origin/main`**. It lives only on the unmerged branch
  `css-brace-anchor-1430`. No PR was ever opened for it.
- So `main` still carries all 42 brace-anchored assertions in these 8 files (the
  suite is green because the anchored forms still match today's page). **The
  loosened set #1469 wants to guard does not exist on main.**

A guard for a set that is not there cannot be built: it would match nothing and, by
its own floor, must fail. So the two are one deliverable and I landed both here.

**Call:** land Vivienne's completed-but-orphaned loosening AND the new mechanical
guard in one PR.

**Why this was mine to decide, not to park:** the change is test-only and fully
reversible (the reversibility test in the fleet rules ⇒ decide it). #1430 is OPEN,
**unclaimed, unlabelled, zero comments** - the loosening was orphaned when the guard
sub-problem got hard, not deliberately held. #1469 was split OUT of #1430; they are
two halves of one fix. And landing it cannot take main red today: dropping a
closing-brace anchor from a regex that already matches only widens what it matches.

**What I rejected:**
- *Park needs-decision.* Routes a reversible test-only change to a human against the
  night-shift floor, when nothing here needs a ruling only Josh can give.
- *Build the guard against the anchored forms / a blanket anti-anchor guard.* It
  would false-fail the 46 deliberate keeps; #1430's whole premise is that the
  loosen-or-keep call is per assertion, not a regex.

**Weakest premise:** that the loosening was orphaned rather than deliberately held.
Mitigations: #1430 has no ruling or comment against it; the loosening is test-only
and revertable; the loosened forms keep the suite green (40/40); and the
challenge-loop re-scrutinises the whole diff against main.

## What landed

1. **The loosening** (cherry-pick of `571acb49` onto today's main). 7 of its 8 files
   were untouched on main since its fork; the 1 that moved
   (`web.consolidated-980.test.js`) auto-merged cleanly. Suite stays 40/40 green.
   Its per-file policy-header prose and per-assertion residual notes come with it.
2. **`web.brace-anchor-guard-1469.test.js`** - the mechanical guard.
3. **`web.brace-anchor-guard-1469.selftest.test.js`** - the guard's own proof,
   run every suite: it plants each trap and asserts the guard goes red.
4. A one-line pointer to the guard, added before each file's `#1430` policy header.

## The guard, and why this shape

Angel's acceptance criterion on #1469: *a guard that is green ONLY on spellings you
have measured it catches, and loud about the rest.* Both earlier versions failed by
claiming the whole population (*no CSS assertion is re-anchored*) - an unbounded
claim over spellings nobody enumerated, so every unconsidered spelling was a silent
false negative.

This guard makes a **narrow, exact claim**: the 28 specific assertions #1430
unpinned still have their open tail. It pins each assertion's **exact loosened
source string** per file, with the exact occurrence count that file must contain,
and counts exact substring occurrences. It never parses or classifies a regex.

- **No classifier ⇒ no spelling blind spot.** A re-anchor in any spelling
  (`\}`, `}`, `; \}`, `;\s*\}`, a rule with no trailing `;`, or wrapped onto a
  second line) changes the exact bytes, so the pinned string disappears and the
  count drops. This is the v2 blocker (unescaped `}`) closed at the root: escaping
  is irrelevant when you match the loosened bytes rather than detect the anchored ones.
- **Per-assertion counts** solve v1's compensating drift (a class count is blind to
  a swap; a per-assertion count is not) and v3's duplicate-text problem (the `.pc-t`
  rule appears twice ⇒ its expected count is 2; re-anchoring either copy trips it).
- **Multi-line and `/*`-in-string are non-issues**: the file is read as one string,
  never per-line, and no comment stripping happens.
- **Two floors**: a per-file floor (a file contributing zero pins has gone blind and
  must fail, not pass) and a global total floor.

**What a green here does NOT mean** (stated in the guard, its failure message, and
the file headers): it does not detect a newly-added brittle assertion elsewhere, it
does not cover #1430's deferred surfaces, and it does not cover the two robust
replacements #1430 also made (an `effective()` cascade check and a `DUP_RULE`
occurrence-count that legitimately becomes 1 when #1459 lands).

**Trade-off, in the safe direction:** reformatting a pinned assertion also trips the
guard. That is a false positive that draws a review, never a false negative. The
card's priority is no false negatives.

## Proof - by planting, not reading

`web.brace-anchor-guard-1469.selftest.test.js` constructs each of the eight measured
traps in a temp copy and asserts the guard reddens, plus the untouched control stays
green and a benign `/*`-in-string stays green. The planting harness refuses a no-op
perturbation, because a mutation that never applies would let an arm pass while
proving nothing (the first run of this harness hit exactly that: a `.pc-t` re-anchor
silently no-op'd because the pin carries a `/m` flag, and it surfaced as a failure).

13 self-proof tests pass; the 8 loosened files stay 40/40 green.
