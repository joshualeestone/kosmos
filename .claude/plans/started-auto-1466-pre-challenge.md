---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: started-auto-1466
diff_hash: eb240c30e711c1e711106be9380acfd80925c73e54c07db502b87f3dca39745e
subdir_audit: passed
timestamp: 2026-08-29T15:45:03Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24 push-as-ready; kosmos main unprotected). Bracketed
markers because the template's own heading is refused by this gate, my #1458.

**This fixes a defect in my own merged work**, found by Renet Tilley.

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING]** `--auto` is now on the **synchronous delivery check**, which is the one
  report the hook fires and then reads the verdict of. Verified inert: #900's guard is
  scoped to `auto === true && state === 'idle'` and this is `started`, and the delivery
  check reads the CLI's exit status and message, neither of which the flag changes.
- **[WARNING]** The classifier's `probe` rule keys on a redirection token following
  `report`. A future probe written as `report >/dev/null` is covered; one written with
  no argument at all is not matched by `OCCUR` and so is invisible. **Named rather than
  fixed**: it is not a call site, so its absence costs nothing today.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep: 0 across all three edited files, planted control 1.
- **[CONVENTION]** `Closes #1466` used deliberately: every item on that card is done and
  its one open question is answered below. No closing keyword before any other number.

### NITs

- **[NIT]** `STATES` duplicates the vocabulary the CLI owns. Deliberate: the point of the
  vocabulary arm is that it keys on something **different** from the separator arm, and
  importing one list would collapse them back into one mechanism.

### Attacked and CLEARED

- **Five perturbations, each failing the right test:** the #1466 defect itself, an inline
  case-arm call, a variable state, a NEW call inside a command substitution, and a wholly
  novel shape (which prints its own token). Restores sha-verified.
- **Renet's open question measured, not assumed:** nothing branches on `selfreport`'s
  `by`. Written `selfreport.js:161`, read `:260`, no consumer. `tasks.js` and
  `projects.js` carry unrelated `by` fields.
- **Suite 2938 pass, 0 fail**, new tests present by name.

### Three defects this found in my own work while fixing it

1. **My replacement span deleted the `calls()` helper**, and all five tests failed with
   `ReferenceError`. Loud, caught immediately.
2. **My string stripper erased `"$STATE"` to `""`**, deleting the exact signal the
   control needed. **The perturbation caught it: planting a variable-state call left the
   suite GREEN.**
3. **The stripper's class allowed newlines**, so it matched from one string's closing quote
   to the next string's opening quote **across lines**, collapsing the file and losing four
   real calls.

⇒ **All three were in the control, not the subject.** A guard is not verified by passing.

### Strengths

- **[STRENGTH]** The invariant changed shape rather than getting a better regex. Three
  looser patterns failed the same way first, which is what argued for abandoning the count.
- **[STRENGTH]** A shape nobody anticipated now fails **by default** instead of needing a
  pattern to have predicted it.

### What I am NOT claiming

**I have not run the hook against a live agent.** The verification is static: the flag is
present at all seven sites, and `selfreport` records `by: 'auto'` for that shape. Whether
a real SessionStart now writes `by: 'auto'` on this machine depends on the deployment
still pending in card #1467.
