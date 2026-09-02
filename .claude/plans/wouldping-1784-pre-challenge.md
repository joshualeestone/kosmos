---
pre_challenge: true
method: challenge-loop
branch: wouldping-1784
diff_hash: 4f2836df8e3a3450ac089d9efa7c723ebd73fc958c92844cf5d44279dbbfed4a
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T02:45:56Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (iteration 1 blind pass found no real defect: "ship it")
**Total findings:** 0 BLOCKERs, 0 WARNINGs; two honest non-defect notes, both acceptable.

> Note on the diff_hash: the shared main checkout's local `main` ref is stale (it sits at
> cbbda1a3 while origin/main has advanced past the #1787 merge), so the hook's
> `git diff main...HEAD` three-dot spans that already-merged work. The hash above is exactly
> what the hook recomputes. The ACTUAL feature diff (vs origin/main) is two files:
> `engine/wouldping.js` and `engine/wouldping.test.js`, plus this plan.

## The feature (a SECURITY fix)

kosmos#1784: `engine/wouldping.js` asked for `0o600` on its log file and passed no mode on its
directory. `mode:` on `mkdirSync`/`appendFileSync` applies on CREATE ONLY, so the directory
landed 0755 (enumerable) and a pre-existing log kept whatever mode it already had. One
best-effort `secureAppend` helper now re-asserts dir 0700 and file 0600 on every write,
matching `engine/remote.js` `secureStateDir`.

## The trap (from the card), and how the tests handle it

A fresh-create arm passes WITHOUT any fix, because create honours the mode. So each arm PLANTS
a pre-existing loose file/dir, asserts the plant took, then drives a real append and asserts it
tightened. Proven by mutation (by the author and independently by the blind pass):
- remove `chmodSync(file, 0o600)` -> "PRE-EXISTING loose log is tightened" RED by name
- remove `chmodSync(dir, 0o700)` -> "PRE-EXISTING world-readable dir is tightened" RED by name
- the fresh-create CONTROL stays green under both, proving the arms test the re-assert, not create.

The 15 pre-existing arms (boot-once, transition logging, never-throws, sandbox) stay green.

## Per-Iteration Breakdown

#### Iteration 1 (converged)
Blind reviewer: baseline 19/19, both guards red-by-name on mutation, no regression to the 15
original arms, never-throws / boot-once / transition contracts intact. Verdict: ship it.
Two honest non-defect notes, both acceptable:
- The create-time `mode:` options are now unguarded (no test reddens on their removal), because
  the two chmods cover create and pre-existing alike. Keeping them is still correct: they
  tighten the microsecond window between create and chmod. Not a defect.
- The best-effort arm cannot force a chmod EPERM in a sandbox we own, so it asserts the weaker
  checkable thing (the write still logs). Disclosed in the arm's own comment.

### Final Ledger

| # | Iter | Category | Where | Description | Status |
|---|------|----------|-------|-------------|--------|
| 1 | 1 | STRENGTH | wouldping.js | both re-asserts red-by-name on mutation; fresh-create control green | VERIFIED |
| 2 | 1 | NIT | wouldping.js | create-time mode: options now unguarded (but correct) | ACCEPTED (in scope) |
| 3 | 1 | NIT | wouldping.test.js | best-effort arm cannot force EPERM | ACCEPTED (disclosed) |

### Strengths
- One helper, matching the merged remote.js precedent; minimal and on the single write path.
- Trap-aware arms proven red-without / green-with by mutation.
- No em dashes in the added engine comment or tests (ASCII throughout).
