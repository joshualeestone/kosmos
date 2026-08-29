---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: cascade-1476
diff_hash: a87bf7325ee106433e372e43467090a603bf99ba83b7780f2328db519b1fe892
subdir_audit: passed
timestamp: 2026-08-29T16:01:50Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24 push-as-ready; kosmos main unprotected). Bracketed
markers because the template's own heading is refused by this gate, my #1458.

**Vivienne's card, taken from "Not started".** I reproduced her measurement before touching
anything rather than working from her description.

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING]** `test-support/cascade.js` is **not a CSS engine** and its header says so
  in those words. It compares declarations of the **same selector text in the same
  conditional scope**. It does not model specificity, so a *different* selector that also
  matches the element is invisible to it, and it reads only single-line rules (1104 of
  them; the form this stylesheet uses). **A green from the guard is not "no assertion is
  blind", it is "no assertion is blind in the one way that bit us."**
- **[WARNING]** The guard fails a test file it does not own. That is deliberate (the point
  is the class, not the two files), but it means a future edit to an unrelated stylesheet
  rule can turn somebody else's test red. The failure message names the file, the property,
  and what governs, and points at `effective()`.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep: 0 across all edited files, planted control 1.
- **[CONVENTION]** `Closes #1476` used deliberately: all four of its done-conditions are
  met and each was verified. No closing keyword before any other number.
- **[CONVENTION]** Condition 4 respected: **no closing brace was re-anchored.**

### NITs

- **[NIT]** `effective()` re-parses the page per call. 194 test files times 30 selectors
  is fast enough that caching would be premature, and the guard is one test.

### Attacked and CLEARED

- **Reproduced the defect first, all three of Vivienne's arms**, before any change.
- **Proved the inversion is fixed in BOTH directions**: the real behaviour change now goes
  RED, the no-op now goes GREEN. Plus two new arms breaking the effective `display` and
  the effective `grid`.
- **The guard is perturbation-verified against main's actual pre-fix file**, not a
  synthetic case, and both population floors fail when broken.
- **Suite 2939 pass, 0 fail**, one more than main's 2938, all three tests present by name.

### The finding that changed the shipped design

**My first sweep was scope-blind and reported TWO defects that are correct code.**
`.pjpill` at `max-width: 56rem` vs `52rem`, and `.dbody` at base vs `60rem` vs
`56rem`, are ordinary responsive overrides. Shipping that would have put a red on two
tests that are right.

⇒ **A guard that misfires on correct code gets deleted**, which is this suite's own stated
reason for pinning conventions rather than parsing. Scope tracking took it to **0 real
findings** while the control still catches the genuine case.

⚠️ **And before that, the sweep failed its own control** and reported 0 on a file I knew
was defective, because a shell-escaping mistake made it match two backslashes instead of
one. **The zero looked exactly like a clean tree.**

### Strengths

- **[STRENGTH]** The 5 raw hits were run down individually rather than reported: 3 benign,
  2 false positives from a limitation I had documented but not yet implemented against.
- **[STRENGTH]** The class ships as a guard, so it cannot silently return.

### What I am NOT claiming

**No browser was involved and none of this was rendered.** These are text assertions about
which rule wins, verified by planting changes and watching the tests. **Whether the rail
actually looks right on screen is unverified by me**, and the browser is queued to three
other agents.
