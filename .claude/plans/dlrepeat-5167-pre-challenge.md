---
pre_challenge: true
method: challenge-loop
branch: dlrepeat-5167
diff_hash: 47ba7945dacf574f2ce99804f379da9b25056be381b003585dd4289b9114b2a9
validation: passed with one stated exception (see Validation)
subdir_audit: passed (b3889adf31 run)
timestamp: 2026-11-06T19:49:46Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, sonnet; one reviewer at a time)
**Converged:** Yes. Neither round raised a BLOCKER; both rounds' warnings fixed and re-measured.
**Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- Verified: no address, file name or token reaches the alert or the unified log; strerror is fixed words; the cancel branch is unchanged.
- [WARNING] the selftest arm restored the folder on a fixed 2s wait (a slow machine could land the file late) --> FIXED (restored once the failure is said, cap 5s)
- [NIT] only one level of underlying error unwrapped --> FIXED (three levels); ASCII-only domain filter --> FIXED; stale pin test title --> FIXED
- [NIT] the log line fires for told cancels too; strerror is English --> accepted (codes only; pre-existing)

#### Iteration 2
**Reviewer model:** sonnet
- Verified: the unwrap reaches three levels, cannot loop, and the arm's folder is restored before every later arm.
- [WARNING] `settled()` waited for 3 failures and the new one counts toward them --> FIXED (4)
- [NIT] the log codes stopped at one level --> FIXED (the same three levels as the alert, with a row)

### Validation
- **Full validation on b3889adf31** (detached-validate.sh, finished 13:03 CST): 27611 tests, 27179 pass, **1 fail**, 431
  skipped (platform); the one failure was native-app.computer-mode-4356.test.js's pin of the mode selftest's row count (226,
  now 234). Subdir audit clean.
- **fd53a8db77 changes only that one test file** (`git diff --stat b3889adf31 fd53a8db77`: 1 file, 1 line). It passes alone,
  with the other two pins: native-app.computer-mode-4356 + download-5167 + applog-5481, 66/66.
- **A full validation on fd53a8db77 could not finish on this Mac:** it hung for 30+ minutes on engine/restoresink.test.js, the
  hang Splinter announced at 11:41 CST (a stuck external drive on this Mac; "that is this drive, not your change"). Stopped;
  nothing restarted or unmounted. PR CI runs the full suite on its own runners.
- The app's own selftests, built here from this head: mode 234/234, real-WKWebView download 39/39. Mutant (the old alert
  words) fails the new download row and the failure tally.

### Strengths
- The next "Cannot create file" names its cause on screen, with nothing private in it.
- The failure reaches the unified log on a person's Mac in codes only.
