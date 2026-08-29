---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: acctpath-1486
diff_hash: b55b7093f5ab484e0113c6f5a348ef503b0ddf99c3bfa12829c5203c4450f2be
subdir_audit: passed
timestamp: 2026-08-29T16:20:56Z
---

## [PRE-CHALLENGE] Self-Check Results

### DISCLOSURE

**No spawned fresh agent** (Josh 09:24 push-as-ready; kosmos main unprotected). Bracketed
markers because the template's own heading is refused by this gate, my #1458.

**Angel's card, taken from unclaimed.** She separated it from #1373 deliberately and said so
on the card; taking it is what she asked for, not a land-grab.

### BLOCKERs

**[BLOCKER] none.**

### WARNINGs

- **[WARNING] COLLISION, disclosed rather than discovered.** Angel's `switch-acct-1373` is
  **unmerged and has no PR**, and edits `engine/create.js` in the same region. Two lines
  will conflict on her rebase; the resolution is to take mine. **Her branch also carries a
  COMMENT describing this exact defect, which my change makes stale.** She is being told
  directly, not left to find it.
- **[WARNING]** `path.resolve` on a relative path resolves against `process.cwd()`. Safe
  here because both call sites are already guarded by `String(wantAccountDir) !== ''`, and
  an account path is always absolute in practice. **A relative input would now resolve
  against the server's cwd rather than failing to match**, which is a behaviour change I am
  naming rather than burying.

### CONVENTIONs

- **[CONVENTION]** Em dash sweep: 0 on both edited files, planted control 1.
- **[CONVENTION]** `Closes #1486` deliberate: both items of its stated scope are done.

### NITs

- **[NIT]** The OpenAI arm resolves into a named local; the Anthropic arm inlines it. Kept
  asymmetric because the OpenAI site carries the long explanatory comment and a named local
  reads better under it.

### Attacked and CLEARED

- **Reproduced on a REAL account before touching anything**, not from the card's wording.
- **Perturbed each site separately**: revert OpenAI -> 1 failure, revert Anthropic -> 1
  failure, revert both -> 2. Restores sha-verified.
- **Suite 2941 pass, 0 fail**, both new tests present by name.

### The defect the perturbation found in my own work

**My first version guarded ONE of the two sites.** Reverting the Anthropic resolve left the
entire suite **green**. I would have shipped half a fix and reported it whole, and nothing
in a passing run would have said so.

⇒ **Perturb every site you changed, separately.** Confirming "the fix works" exercises one
path and tells you nothing about the other.

### The control I care about most

**Resolving must not make every path match.** Both arms assert an unknown directory is still
**refused in words**. A fix that turned a refusal into a silent acceptance would be worse
than the defect, and nothing else in the suite would have caught it.

### What I am NOT claiming

**No agent was actually created on a non-canonical path outside the sandbox.** The tests run
against `AGENT_WORKFORCE_HOME` fixtures with `setDryRun(false)` and the recorder, which is
how this file drives creation. **I did not verify the resulting plist on a real machine.**
