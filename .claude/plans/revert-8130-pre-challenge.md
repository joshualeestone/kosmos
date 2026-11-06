---
pre_challenge: true
method: challenge-loop
branch: revert-8130
diff_hash: 88f46932189237011a95ff9d8d9dfb919cb875219eddc82657e499547e44d006
validation: passed (a pure revert: the three code files are byte-identical to main before #8130, which passed CI 8 of 8 with #8126)
subdir_audit: not run (revert)
timestamp: 2026-11-06T21:23:19Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**A revert, not new code.** No review loop: the change restores native-app/main.swift, native-app.download-5167.test.js and
tools/build-kosmos-bundle.sh byte for byte to main before #8130 (checked with cmp against d0df706832^), and removes #8130's two
plan files. That tree passed the full CI (8 of 8) on #8126.

**Why:** a remembered Always Allow (kosmos#8121) was keyed by computer name, and a retired name frees for any account after
24 h (relay signin.rs, RETIRED_NAME_GRACE_SECS), so the allow could pass to a stranger's computer. Splinter, 15:22 CST: must
not reach 0.7.95.

**Checks here:** the app builds; --kosmos-app-mode-selftest 234/234; pins (download-5167, applog-5481, computer-mode-4356)
66/66; no "Always Allow" or keptDownloadHosts left in main.swift.

### Iteration 1 (a quick blind check of the revert)
**Reviewer model:** sonnet
- OK: no trace of the feature left in main.swift, build-kosmos-bundle.sh or native-app.download-5167.test.js (keptDownloadHosts,
  alwaysAllowed, Always Allow, keptStoreForSelftest, forgetAlwaysAllowedComputers, alwaysAnswerForSelftest all absent); the
  test's expected count is back to 39.
- OK: the three files are cmp byte-identical to d0df706832^.
- OK: nothing else on main touched those files after #8130 (cb848d591e..origin/main is empty for them), so the revert undoes only
  #8130's own six commits.
- [NIT] a Mac that ran a build with #8130 keeps the preference `kosmos.downloads.alwaysAllowedComputers`; nothing reads it now, so
  it is inert. --> carried to #8121: the re-land must ignore or wipe those old name-keyed values (or use a new key).
- [NIT] iterations/converged shape for a pure revert --> stated as such here.
