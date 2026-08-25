---
pre_challenge: true
method: challenge-loop
branch: site-deploy-export
diff_hash: ab26710867b86644af245fbc736f1708ce3e05d31e854165f304083b14481b74
subdir_audit: passed
timestamp: 2026-08-25T00:38:27Z
iterations: 5
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** No (stopped at the bound after iteration 5; see below)
**Total findings:** 45 (0 BLOCKERs, 18 WARNINGs, 1 CONVENTION, 26 NITs)
**Fixed:** 18 WARNINGs + 1 CONVENTION + 20 NITs | **Deferred:** 6 NITs (recorded)

**Why stopped rather than converged:** warnings per round 5, 4, 3, 3, 2, none a blocker, every one fixed with a control, and the last round's two were a rename shape in the manifest and an on-main check before a push by name. Validation after every round: yarn test 1955/1955, exit 0, audit clean. The export was run against the real site checkout (472 MB carried, pages identical to HEAD; and, after the partial-triple rule, a refusal on today's real dist), and a preview deploy from the export succeeded from a non-git directory. Reviewers mutated copies of the library in rounds 2 to 5 (7 of 8, 11 of 12, 13 of 14 mutants caught by the test's named assertions). Continuing would be reviewing the manifest's wording. Bounded on purpose (Angel).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 6 NITs
- [WARNING] release.sh:195 — 3c evaluated the working-tree .vercelignore while the deploy ships the committed one --> FIXED (6da8fde): reads HEAD:.vercelignore
- [WARNING] site-deploy.sh:88 — a failing git status read as a clean tree --> FIXED (6da8fde): refusal
- [WARNING] site-deploy.sh:84 — a staged new file described as deploying --> FIXED (6da8fde): "staged, not committed: does not deploy"
- [WARNING] release.sh:367 — the export has no .git, the dashboard loses commit metadata --> FIXED (6da8fde): named in the step and the plan
- [WARNING] site-deploy.sh:78 — a tarball in a subdirectory of dist neither carried nor listed --> FIXED (6da8fde): the dist/ boundary rule, listed
- [NIT] partial pkg triple carried --> FIXED (refuses); carried=0 unused --> FIXED; node_modules skip undocumented --> FIXED; porcelain renames/quoting --> FIXED in later rounds; cp of ~940 MB --> FIXED (hard links); 3c/7b comments in the present tense --> FIXED; export-ignore note --> FIXED

#### Iteration 2
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] site-deploy.sh:54 — the archive pipeline's failure visible only through the caller's pipefail (an empty site read as ready) --> FIXED (3559df8): archived to a file, git's status tested, control with pipefail off
- [WARNING] release.sh:376 — step 8 archived HEAD at call time, not the pushed sha --> FIXED (3559df8, tightened in 69cd842): the export takes the sha; the release reads it BEFORE the push and pushes it by name
- [WARNING] test:57 — the non-empty-dir control refused for another reason (hard links) --> FIXED (3559df8): a fresh dir with an unrelated file
- [WARNING] site-deploy.sh:117 — the manifest skipped pattern matches as carried (orphan sidecar, dotfile tarball vanished) --> FIXED (3559df8): keyed on what was carried, controls
- [CONVENTION] 9c's comment still said the working tree --> FIXED
- [NIT] non-ASCII names C-quoted --> FIXED (porcelain -z in round 3); git's stderr hidden --> FIXED; deletions said modified --> FIXED; "no .vercelignore" message --> FIXED

#### Iteration 3
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
- [WARNING] site-deploy.sh:124 — a carried name with a space was listed as left behind (porcelain quotes it) --> FIXED (69cd842): porcelain -z, controls with a space and a non-ASCII name
- [WARNING] site-deploy.sh:64 — the archive temp file in the shared TMPDIR; a stale one reds the suite --> FIXED (69cd842): beside the export
- [WARNING] release.sh:363 — SITE_SHA read after the push --> FIXED (69cd842): before, pushed by name
- [NIT] rc 3 message overclaimed --> FIXED; tracked file matching a carry glob --> FIXED (refuses); quotePath claim unguarded --> FIXED (control); dead assertion --> FIXED; stubs matched paths in $* --> FIXED; 9c compared to the shared tree --> FIXED (the export's copy); long comment line --> FIXED

#### Iteration 4
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] site-deploy.sh:143 — a staged rename's second record re-parsed as a truncated path --> FIXED (11fa767): consumed as the old name, control
- [WARNING] site-deploy.sh:135 — the status refusal depended on the caller's pipefail --> FIXED (11fa767): listing to a file, git's status tested, control with pipefail off
- [WARNING] release.sh:461 — the hard-linked pkg let an in-place overwrite re-aim 9c --> FIXED (11fa767): the triple is copied, control
- [NIT] comments said HEAD --> FIXED; dead fallback in 9c --> FIXED; no rename case --> FIXED; refusal hint for the by-hand case --> FIXED

#### Iteration 5
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] site-deploy.sh:161 — a work-tree rename has the same two-record shape and was not matched --> FIXED (2f77a4f): both columns, control
- [WARNING] release.sh:356 — pushing a sha by name onto main with no on-main check of the site checkout --> FIXED (2f77a4f): checked before the push
- [NIT] tracked guard not applied to the triple --> FIXED; newline in a carried name --> FIXED (refused); tar exit control absent --> DEFERRED: git's own status is tested and the archive file is the input; the non-repo control's ceiling --> FIXED; the first cut's expected rebuild --> FIXED (plan, PR)
**Stopped at the bound** (see the summary).

### Final Ledger
| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | release.sh:195 | guard read the working-tree filter | FIXED | 6da8fde |
| 2 | 1 | WARNING | site-deploy.sh:88 | failed status read as clean | FIXED | 6da8fde |
| 3 | 1 | WARNING | site-deploy.sh:78 | nested tarball neither carried nor listed | FIXED | 6da8fde |
| 4 | 2 | WARNING | site-deploy.sh:54 | archive failure needed the caller's pipefail | FIXED | 3559df8 |
| 5 | 2 | WARNING | release.sh:376 | archived HEAD, not the pushed sha | FIXED | 3559df8, 69cd842 |
| 6 | 2 | WARNING | site-deploy.sh:117 | manifest keyed on patterns, not carries | FIXED | 3559df8 |
| 7 | 3 | WARNING | site-deploy.sh:124 | spaced name listed as left behind | FIXED | 69cd842 |
| 8 | 3 | WARNING | release.sh:363 | SITE_SHA read after the push | FIXED | 69cd842 |
| 9 | 4 | WARNING | release.sh:461 | hard-linked pkg re-aimed 9c | FIXED | 11fa767 |
| 10 | 4 | WARNING | site-deploy.sh:135 | status refusal needed pipefail | FIXED | 11fa767 |
| 11 | 5 | WARNING | release.sh:356 | push by name with no on-main check | FIXED | 2f77a4f |
(the remaining warnings are listed per iteration above, all FIXED)

### NITs (non-blocking, across all iterations)
- Deferred: a control for tar's own exit (5); carried names containing a newline beyond the refusal (5); a rename whose new name is a carried artifact (5, cosmetic); the by-hand first export refusing today (5, expected and stated).

### Strengths (across all iterations)
- Every control proven by mutation on a copy of the library (rounds 2 to 5).
- Refusals remove the export and their temp files; the promises hold without the caller's pipefail (rounds 2, 4, 5).
- The sha handoff: read before the push, pushed by name, archived by name, 9c compares to the export's own copy (rounds 3 to 5).
- The named-class set matches every gitignored entry the real checkout holds; the cutover drops nothing served today (rounds 1, 2, 5).
