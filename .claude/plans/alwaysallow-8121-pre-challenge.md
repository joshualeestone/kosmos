---
pre_challenge: true
method: challenge-loop
branch: alwaysallow-8121
diff_hash: 892ab09b822d7bbf606483304867fb034b50fbc6863921e182bc5e34f80d2f1b
validation: passed (3fd3e8be11: 27624 tests, 27194 pass, 0 fail, 430 skipped; subdir audit clean)
subdir_audit: passed
timestamp: 2026-11-06T20:58:16Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, sonnet; one reviewer at a time)
**Converged:** Yes. Neither round raised a BLOCKER; every warning fixed and re-measured.
**Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- Verified: only the person's own Always Allow click can add a computer; `askAboutHostForSelftest` is nil in a normal run; odd hosts (port, userinfo, trailing dot, IDN, suffix tricks, case) are refused or lowercased; Return answers Don't Allow and Always Allow has no key.
- [WARNING] no row pressed Always Allow on a page that changed --> FIXED (a row in modalArm; a mutant keeping it first fails)
- [WARNING] the Forget row could not see that this run's Allows are cleared --> FIXED (asked again without a quit)
- [WARNING] Always Allow was offered for the sign-in host, which is never kept --> FIXED (not offered there)
- [WARNING] a kept name stays allowed until Forget; name reuse unknown --> posted on #8121 for the relay owner (product question)
- [CONVENTION] a doc comment displaced --> FIXED; [NIT] the Forget alert's wording and alertsOnScreen --> FIXED; the selftest read the binary's own defaults --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- Verified: with no third button, `.alertThirdButtonReturn` cannot occur and `keep` is false on every path; the text is right for both cases.
- [WARNING] the selftest left an empty .plist in ~/Library/Preferences per run --> FIXED, and re-fixed when measured: deleting the file after removePersistentDomain loses a race with the preferences daemon, so the selftest now keeps the kept list in memory (keptStoreForSelftest); a full run leaves no new file.
- [NIT] early exits skipped the cleanup --> moot (nothing is written to disk now)

### Validation
Full validation on 3fd3e8be11 (detached-validate.sh, finished 14:48 CST): 27624 tests, 0 failed, 430 skipped (platform);
subdir audit clean. Built here from this head: download selftest 47/47 (8 new rows), mode 234/234, menu table == expected;
pins 66/66. Mutants: the kept check removed fails "NOT ASKED AGAIN AFTER A QUIT"; keeping before the page-changed check
fails the void row.

### Strengths
- Per computer only; never a blanket allow; a Don't Allow is never kept; the undo is named in the question itself.
- A hand-edited preference cannot widen the list (every read goes through keptDownloadHosts).
