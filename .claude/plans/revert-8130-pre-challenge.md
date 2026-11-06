---
pre_challenge: true
method: challenge-loop
branch: revert-8130
diff_hash: 88f46932189237011a95ff9d8d9dfb919cb875219eddc82657e499547e44d006
validation: passed (a pure revert: the three code files are byte-identical to main before #8130, which passed CI 8 of 8 with #8126)
subdir_audit: not run (revert)
timestamp: 2026-11-06T21:23:19Z
iterations: 0
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
