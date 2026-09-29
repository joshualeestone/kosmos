---
pre_challenge: true
method: challenge-loop
branch: museq-4569
diff_hash: 30e3f72e4870aa79882b7da312f0b62c526ec09d94f6a09a798e05d6808288e7
subdir_audit: passed
timestamp: 2026-09-29T17:34:59Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9 blind reviews (opus on the odd rounds, sonnet on the even).
**Converged:** Yes. Round 9 returned no BLOCKER, WARNING or CONVENTION. Its NITs were taken in the last code commit, which changed text only.
Every fix was measured red with the fix taken out, except two lines that are documented as unobservable: `STOP_NOTES.clear` in Escape, and `stopTurn = null` after each busy attempt.

## Rounds (findings, then where each was fixed)
- **1 (opus), 2 WARNINGs.** A stop wrapped in Kosmos's framing was missed: a reply quote, or a reactions or catch-up note. A second stop discarded the first note's list of dropped messages. Also a digest size cap. Fixed in acb9596d0.
- **2 (sonnet), 1 CONVENTION.** A comment had moved onto the wrong constant. Also a 32 KB cap and the Escape clean-up. Fixed in d7749e5e7.
- **3 (opus), 1 WARNING.** A message sent between two stops was lost without a trace. It is now named in a follow-up note. "hold" was removed from the stop words. Fixed in 618046c9c.
- **4 (sonnet), 1 WARNING, 1 CONVENTION.** Identical notes collapsed into one tracked entry. The plan was out of date. Fixed in 47b45ea35 and 753345dd5.
- **5 (opus), 1 WARNING.** A stop note could meet a session Muse still holds. It is now retried when the answer is `muserun.BUSY`. A colleague's dropped message is counted. Fixed in e582b6407.
- **6 (sonnet), 1 BLOCKER.** Escape during a retry wait still ran the cancelled note. It now re-checks after the wait. Fixed in 47f8f1499.
- **7 (opus), 1 CONVENTION.** A test tail could not fail. It was replaced with the case it named. Fixed in 3b0981b28.
- **8 (sonnet), 2 WARNINGs.** Test gaps: fake busy turns did not hand over onStop, and the retry limit and the ordinary-busy control were unpinned. Fixed in 118420a20.
- **9 (opus), converged.** NITs only: the digest named a command that fails, the pane wording was wrong, and the plan had stale lines.

## Validation
- engine/musefront.test.js plus engine/muserun.test.js: 46 pass, 0 fail.
- The full suite was NOT run locally. This Mac's queue had been over an hour deep since about 11:20, and this change touches only the Muse front (plus one exported constant). CI runs the full suite, and the PR merges only on CI green.

## Weakest premise
- That Muse frees a killed turn's session within about two seconds (the busy retries). This is measured only against a fake runTurn, because Muse is on no Mac this was built on. If it takes longer, the stop note fails with the busy reason, which is shown in the pane, and the stop itself has still happened.
