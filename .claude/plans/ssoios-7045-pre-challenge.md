---
pre_challenge: true
method: challenge-loop
branch: ssoios-7045
diff_hash: 0528acccabcd1745648fbc4b6980fa60a286d7967b62618b75b1cbe2afc302e4
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T13:55:41Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind reviewers, each given both repos (this branch and kosmos-relay), the plan and the server's sso.rs.
**Converged:** Yes (iteration 2: nothing real on security; one wording nit fixed)
**Total findings:** 1 BLOCKER (iteration 1: the custom-scheme return let any app receive a grant), fixed by redesign;
2 WARNINGs, 2 NITs, all fixed | **Asked (awaiting user):** 0

The record is in `.claude/plans/ssoios-7045.md` (the STOPPED and RESUMED sections).

#### Iteration 1 (the custom-scheme design)
- [BLOCKER] /v1/sso/begin is a plain link anyone builds; with a kosmos-signin:// return any app registering the scheme receives the grant, and the attacker picked the device --> REDESIGNED: abandoned; kosmos-relay ssoapp-7045 marked DO NOT MERGE, never PR'd
- [WARNING] busy dropped while the company sheet was open --> FIXED
- [NIT] a test compared constants to literals typed in the test --> REMOVED with the redesign
#### Iteration 2 (the https return)
- [STRENGTH] an attacker-built begin link cannot get a grant to anyone but the victim's own browser or the genuine app
- [STRENGTH] nothing outside can hand the app a begin address (no applinks, no URL handler); only the start answer's own address is opened
- [STRENGTH] companyReturn takes only https on the coordinator's host and port, path /signin, a ksso1_ grant and a real email
- [NIT] before iOS 17.4 the email link said only "passkey" --> FIXED
- [NOTE] shipping needs the capability in the profile (Baron, GL45W8GF57) and Apple's cached association file

## Validation
- iOS logic tests: run.sh 939/939, run-actions.sh 97/97, run-settings.sh 41/41. Simulator build clean.
- Both browser-check gates: 0 (no web change). Shots: ~/work/design-shots/kosmos-7045/.
