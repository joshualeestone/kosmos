---
pre_challenge: true
method: challenge-loop
branch: tcclinux-5882
diff_hash: 82a3e69840951091c30c5d21d9e4932889c971528f6036bb62496882df49ea48
validation: passed (Mortals full suite at 5b7f2b67f, 19294 tests, 19051 pass, 0 fail, 0 cancelled, 2026-10-11 23:01 CDT; local helper skipped on that clean entry, hash 82a3e6984095)
subdir_audit: passed
timestamp: 2026-10-12T04:04:56Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 blind reviews: Opus, Sonnet, Opus, Sonnet, Opus, Sonnet.
**Converged:** Yes, at iteration 6 (Sonnet): NO NEW ISSUES. Converged at 6. The full Mortals suite passed on the converged tip.
**Findings:** every review's findings and dispositions are below, from the plan's Review sections.
**Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (blind, on 027b72da; one must-fix, three nits)
1. MUST-FIX, FIXED: off macOS the three folders were walked LAST on the SHARED folder budget, so a deep ~/src spent it
   first and they were never read (measured by the reviewer: maxDirs 30, 40 folders under ~/src, the Downloads agent
   never found). Not "put them first": a large ~/Documents would then starve the curated agent folders (~/work). Instead
   they carry ownBudget off macOS and share ONE budget of their own, as the hatch's walk has on macOS. A spent shared
   budget now skips only shared roots, and says so (hitDirs; my first cut forgot that and the #2414 "never starved"
   test caught it). Reported `visited` is both counts, as the hatch's is added on macOS. Test: the reviewer's scenario
   with a control that the shared budget really was spent; red without the own budget.
2. FIXED: two comments still said the three re-enter only through the TCC hatch.
3. NOTED, out of scope (true before this branch): Windows often redirects Documents and Desktop into OneDrive, and Linux
   desktops can use translated names (~/Dokumente); path.join(home, 'Documents') then does not exist and those agents
   are missed. Real Windows paths are reasoned here (os.homedir reads USERPROFILE there), not run.
4. FIXED: the Tests line said "1 pass, 2 fail" without saying only this file ran: it did (3 tests then).
Mutants after review 1 (20:17 CDT from `date`, all discover tests, 207): B1 no own budget: red. B2 a skipped root not reported: red. B3 the own budget unbounded and B4 its folders not counted: both first SURVIVED (nothing bounded or counted the own walk); a test with both trees over a budget of 5 added (visited above 5, at most 10), and both are now red.

#### Iteration 2
**Reviewer model:** sonnet (blind, on 7c04b570; no must-fix; it found macOS and the auto scan unchanged but for one edge)
1. FIXED: my skip ran before the root's stat, so a MISSING or non-folder root after a budget spent exactly set hitDirs
   where the old `break outer` (inside the while, after stat) did not: a false "there may be more", and importscan's
   isFull then never true. Moved after the stat and isDirectory checks: the old behaviour exactly. Test with a control;
   red on the earlier order (measured 20:18 CDT from `date`, 6 tests: 5 pass 1 fail).
2. ACCEPTED, comment corrected: only the FOLDER budget is separate; the loose-file reads and the importable cap stay
   shared, so many agent files elsewhere can still fill them first. macOS has the same shape at the hatch merge. The
   comment that read as if starvation were solved now says so.

#### Iteration 3
**Reviewer model:** opus (blind, on 14b3e342; no must-fix; it compared the walk loop with main line by line. Two nits, both fixed)
1. FIXED: off macOS Documents (deep) was walked before Downloads and Desktop on the one own budget, so a big Documents
   could starve the two drop folders: review 1's starvation one level down. Off macOS the drop folders now go first
   (cheap, shallow); macOS keeps the hatch's order. Test with a control for the macOS order.
2. FIXED: with the folder budget and the candidate cap both full, the new skip said dirs where main said count. The
   skip now checks the candidate cap first, as the old loop did. Test.
Mutants after review 3 (20:21 CDT from `date`, all discover tests, 211): O1 Documents first everywhere: red. O2 no candidate check in the skip: red (my first pattern matched two identical lines in the file, so it was rerun with its comment line to be unique).

#### Iteration 4
**Reviewer model:** sonnet (blind, on 2634a6cd; no must-fix; no behaviour change on macOS or the auto scan. Nits:)
- FIXED: three comments (the tcc partition in scan, the importScan block, the export note) said the three are always
  hatch-walked; each now says macOS, and ownBudget elsewhere.
- FIXED: the tests shared fixtures made by earlier tests. Each now makes its own (idempotent helpers); every test passes
  ALONE (--test-name-pattern, 1 ran each) as well as in the file.
- NO CHANGE, reasoned: "visited at most twice the budget" does bound the own walk, because in that test the shared
  budget is spent, so the shared count is exactly the budget.

#### Iteration 5
**Reviewer model:** opus (blind, on 315b204d; no must-fix; one nit in a file this branch had not touched, FIXED)
discover.acceptance-1329.test.js claims to prove the hatch ("via grant") merge, but passed no platform: on the Linux
and Windows CI runners this branch would make the engine walk Documents itself, so the hatch path silently stopped
being tested there. Pinned platform: 'darwin' and the comment says why. It re-ran under a forced Linux platform too.

#### Iteration 6
**Reviewer model:** sonnet (blind, on 790297dc; NO NEW ISSUES. Converged at 6.)
It checked every existing test that runs an import scan for the review-5 trap (a test that silently stops testing on a
Linux or Windows runner): none left.
