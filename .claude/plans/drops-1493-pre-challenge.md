---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: drops-1493
diff_hash: ae902abfb94ed6f83317d9738973c37ad19bf81519bb4d76ac1a05061bb56e53
subdir_audit: passed
timestamp: 2026-08-29T17:33:33Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24 push-as-ready). Bracketed markers because the
template's own heading is refused by this gate, my #1458. Routed as item 3 of 4.

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] THIS SHIPS NUMBERS NOBODY RENDERS**, which is a shape I have criticised on
  other cards today. Stated plainly so it is a decision and not an oversight: the render is
  a **product** question (what should a person be told, and which buckets deserve a
  sentence), and the page lives in a file another agent's held branch is in. **If nobody
  wires these, this changes nothing a user sees.**
- **[WARNING]** `skipped` is a new key on `found()`'s return. Every existing caller reads
  `agents`, `unreadable`, `ok` and `because`, so nothing breaks, but a caller that
  spreads the result now carries three more fields.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep 0, planted control 1.
- **[CONVENTION]** No closing keyword: nothing renders yet.

### NITs

- **[NIT]** `noWorkingFolder` reads 0 on this machine, so that arm is unexercised in the
  wild. It is counted for symmetry and because the drop is real in the code.

### Attacked and CLEARED

- **Perturbed each counter separately**, each failing its own test. Restores sha-verified.
- **A control asserts a readable agent moves none of the three**, which is the same control
  #1078 needed: counters that only go up agree with everything on a fixture broken end to
  end.
- **Cross-checked by two separately-written instruments.** A standalone probe I wrote
  BEFORE touching the engine reported **17** for no-CLAUDE.md; the engine now reports
  **17**. Different code, same number.
- **Suite 2951 pass, 0 fail**, all three new tests present by name.

### The measurement that made this worth doing

**17 of 44 folders on a machine where discovery WORKS** vanish through the uncounted door.
That is not a rare shape, and it is what an ordinary folder somebody once ran Claude in
looks like.

### What I am NOT claiming

**I have not proven this is her cause.** Her two folders may be exactly this, or a genuine
parsing failure. The probe that would tell us is with Splinter and Josh. **What is proven is
that four outcomes shared one empty screen and only one of them could ever be reported.**
