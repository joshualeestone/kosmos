---
pre_challenge: true
method: challenge-loop
branch: teamnames-8092
diff_hash: 0acb94209f6d7ba48a8beb69dff3319d92c77afb99c84e3413aee7b3ad82e5b3
validation: full suite on f0ec9ba269 27520 tests, 27109 pass, 1 fail (no-name-refs-3071: a protected name in the short-name list); fixed in 49121db1c1 (one name removed), tree guards rerun (no-name-refs, no-brand-refs, fixture-discipline 28 pass), team check 375 pass; CI's full suite on the exact head is the gate
subdir_audit: not run (no CLAUDE.md under a changed path)
timestamp: 2026-11-06T06:36:29Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (opus and sonnet alternating), the cap. **Converged:** No: round 8, the final whole-branch read, found one WARNING (the code and plan promised an undo that does not exist; FIXED by saying what is true, with the better behaviour carded as a follow-up on #8092) and two NITs (one taken, one deferred: the visible word stays "Another" for width).

**What it is:** #8092, a user's request on the public board. On the team step each member row gets **Another** (a random short name: 3 to 5 plain letters, not on the board by either name, not in the team, not a slip away from either, not its current one), and **Use short names** does every row before the start. A polite line says what happened. Regional bias declined (reasons on the card). The split view lays the rows out as on a phone.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] board names read display names only, never the name an agent is reached by --> FIXED (/api/status, sessionName and name)
- [WARNING] test stub had a field the server never sends --> FIXED (real shape)
- [WARNING] 28px button, unpadded link on touch --> FIXED (44px under coarse pointer)
- [WARNING] icon-only button with no visible words on a phone; nothing announced --> FIXED ("Another" as a word; polite line)
- [NIT] focus restore treated Another as the name box --> FIXED
- [NIT] names with a second meaning --> FIXED (seven dropped)
- [NIT] weak control, loose regex --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] nothing proved Make carries a name from Another --> FIXED (Another alone, then Make)
- [WARNING] Use short names silent to a screen reader --> FIXED
- [WARNING] brand and word names left in --> FIXED (nine dropped; comment no longer promises a perfect list)
- [NIT] live line not cleared per team, display-none hidden button --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [WARNING] awkward spoken line --> FIXED
- [WARNING] no test of Another on a failed row then Try again --> FIXED (arm added)
- [NIT] empty-list pass, repeat not re-announced, near-twin names in one team --> FIXED (count asserted, cleared before set, one-letter rule)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] bulk pass's one-letter rule unproven --> FIXED (pairwise assertion)
- [NIT] untruthful line when none free, rAF race, dead selector, plan wording --> FIXED

#### Iteration 5
**Reviewer model:** opus
- [WARNING] focus test passed without the restore code --> FIXED (repaint arm)
- [WARNING] one letter from a board agent still offered --> FIXED
- [NIT] add/drop pairs, desktop width, layout jump while busy, plan scope --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] width check fragile and causeless; no 390px check before start; partial bulk read as success; focus on a hidden button; board read best effort --> FIXED (relative width, 390 arm, kept-count line, :not([hidden]), plan)
- [NIT] hard-coded names depend on list order --> DEFERRED: commented; the expectation is the point (first free name)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] split view: box narrower than twice Another, seat at its edge --> FIXED (phone layout there; a first try that collapsed the state column moved names at the start and broke #4935's rule, so it was not kept)
- [NIT] swap typos, bulk wording, VoiceOver repeat, link jump --> FIXED
- [NIT] taken set duplicates mates --> DEFERRED: harmless, two readings of one rule

#### Iteration 8 (final whole-branch read)
**Reviewer model:** sonnet
- [WARNING] comment and plan promised an undo --> FIXED (wording true; leaving typed rows alone carded as a follow-up on #8092)
- [NIT] split-view label overstated --> FIXED
- [NIT] visible "Another" without "name" --> DEFERRED: width in the narrow column; the spoken name says "Another name for the ..."

### Controls, both arms
The board-name, one-letter, Make-carries-Another, retry-rename and focus-repaint assertions each fail without the code they cover (shown in rounds 3 to 5); the width check failed at 1.6fr (123 vs 127) before the column changed.
