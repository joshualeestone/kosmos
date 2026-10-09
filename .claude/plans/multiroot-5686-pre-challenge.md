---
pre_challenge: true
method: challenge-loop
branch: multiroot-5686
diff_hash: d784142743d33914064ee61f8262300fcf2944b4de259e863be0880f187d3a78
validation: passed
subdir_audit: passed
timestamp: 2026-10-09T17:24:14Z
iterations: 17
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 17, opus and sonnet alternating (opus on odd rounds). **Converged:** round 17, NITs only (recorded in the
plan). Rounds 1 to 5 reviewed the multi-root snapshot alone and converged; backupsessions.js was then added and
reviewed in rounds 6 to 17.
**Fixed:** every BLOCKER (rounds 1, 10) and every WARNING of rounds 1 to 16, each in its own commit "(#5686 review N)",
each with mutants recorded in the plan.
**Validation, stated so it is not over-read:** on the head rebased onto main (after the walker #5693 merged), the
backup tests pass together: backupsnapshot, backupsessions, backupscan, backuprestore, backupupload and
engine.reachable, 269 pass, 0 fail. The full suite was NOT run on Mortals (the 0.7.35 cut needs the box); the PR's
CI runs it.

### Per-Iteration Breakdown
1 opus: BLOCKER, root names restore refuses (con, aux); nesting by spelling; skipped cap per root: FIXED.
2 sonnet: stored order depended on the caller's root order: FIXED.
3 opus: data/data-old order; parent-anchored deny rules lost when a root IS .claude/.gemini/.ssh: FIXED (nearOf).
4 sonnet: nearOf changed the single-root form; secret-shaped root names: FIXED.
5 opus: NITs only (converged for the snapshot slice).
6 opus: session folders via links; unstable names; vanished roots fatal; stored-path check untested: FIXED.
7 sonnet: Claude checked against the config root, not projects/; the unresolved path returned: FIXED.
8 opus: Claude ownership by flattened folder (many-to-one): FIXED (only, by transcript cwd); ids judged as names.
9 sonnet: only applied after the walk (foreign files counted); Gemini tmp/ link: FIXED.
10 opus: BLOCKER, two agents' Codex roots are one folder (whole snapshot failed): FIXED (disjoint only); Claude by session, memory rule; ids one segment.
11 sonnet: memory with an unattributable transcript; oversize optional roots fatal; stale excuse: FIXED.
12 opus: optional roots fatal on conflict; changed after checked; linked folders silent: FIXED (leave(), refused roots).
13 sonnet: a third claimant kept a shared file: FIXED.
14 opus: budgets shared across roots (optional could cost the world its data); same folder by spelling: FIXED.
15 sonnet: optional roots fatal on count and names: FIXED.
16 opus: the fit test did not charge skips; re-summing per root: FIXED (running totals).
17 sonnet: NITs only: converged.

## Final Ledger

### Round 17 (sonnet), the converging round, as reported
[NIT] engine/backupsessions.js:96 - claudeRoots canonicalises agentDir without path.resolve; callers pass a normalised workerDir. Recorded.
[NIT] engine/backupsnapshot.js - the only real-path check runs once at the start of listRoots; a later swap is walked (listed names only; deny-list, scan, inode checks apply). Recorded.
[NIT] engine/backupsnapshot.js - nearOf uses bare pathDecision (review 5). Recorded.
[NIT] plan - test counts taken over different file sets. Recorded.
[STRENGTH] - Two roots cannot write one restored path; each file is read from its own root; nesting by identity; budgets with optional roots never fatal.
[STRENGTH] - backupsessions matches status.js, geminisession.forWorkdir and codexsession, and is stricter where it says so.

### Round 16 (opus)
[WARNING] engine/backupsnapshot.js:655 - the fit test left out skip entries' manifest charge. FIXED (cost() charges skips; test with 300 skipped files).
[WARNING] engine/backupsnapshot.js:471 - re-summing the growing list per optional root on the event loop. FIXED (running totals, yields).
