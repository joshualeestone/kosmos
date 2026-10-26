---
pre_challenge: true
method: challenge-loop
branch: usageread-7152
diff_hash: 8e666b744ad629e3e5d607248172db0776d5a70886e0a632cda89a3d36cac366
validation: passed
subdir_audit: passed
timestamp: 2026-10-26T01:52:36Z
iterations: 26
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 26
**Converged:** Yes (iteration 26: no new BLOCKER, WARNING or CONVENTION findings)
**Total findings:** 59 (1 BLOCKERs, 56 WARNINGs, 2 CONVENTIONs, 26 NIT lines)
**Fixed:** 55 | **Deferred or accepted with a stated reason:** 4 | **Asked (awaiting user):** 0

The CRITICAL in iteration 7 is recorded as a BLOCKER. Every CODE fix was checked by at least one mutant that turned its own test red (the ledger rows say "test + mutant"); fixes to comments and the plan were not, and say so. Iterations 1 to 6 ran before a session restart; their findings are recorded in the ledger, and their commit shas are on the branch.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 0 of the above
- [WARNING] engine/usagepoll.js:110: resets_at null on an unused window -> whole account unreadable --> FIXED (3725800a (kept with resetsAt null; accountsweekly skips it))
- [WARNING] engine/usagepoll.js:131: a failed read overwrites a fresh good reading --> FIXED (3725800a (measuredAt; the last good figures are kept))
- [WARNING] engine/usagepoll.js:75: socket timeout only, no overall deadline --> FIXED (3725800a (hard deadline; timeoutMs seam))

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 0 of the above
- [WARNING] engine/usagepoll.js:75: idle accounts are often token-expired; limit not stated --> FIXED (d51ac79f (plan: weakest premise; slice 2 treats it as unknown))
- [WARNING] engine/usagepoll.js:125: five-hour missing vs out of range are indistinguishable --> DEFERRED (slice 1's consumer is the display; slice 2's rule reads weekly only; stated in the plan)
- [WARNING] engine/usagepoll.js:26: units reasoned, not measured --> FIXED (d51ac79f (plan: a real response's shape; percent confirmed by the page and `limits.percent`))

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 2 of the above
- [WARNING] engine/accountsweekly.js:24: a fresh endpoint reading shown under "it will not update" and "Set up usage reading" --> FIXED (weeklyBlockedOf null while a fresh polled reading exists; test + mutant)
- [WARNING] engine/accountsweekly.js:24: polled `at` = last read, page says "last saw it change" --> FIXED (changedAt per window; test + mutant)
- [WARNING] engine/accountsweekly.js:24: newer() compared last-change with last-read --> FIXED (same fix as #8)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTIONs, 1 NIT lines
**Self-generated:** 3 of the above
- [WARNING] engine/usagepoll.js:177: changedAt compared resets exactly; the reset fraction moves between reads (MEASURED: 14:00:00.447 then 13:59:59.569) --> FIXED (60 s tolerance; test + mutant)
- [WARNING] engine/accountsweekly.js:28: a lagging endpoint figure could beat a higher status-line one --> FIXED (same window: the higher figure wins; test + mutant)
- [CONVENTION] plan:53: test count typed, not measured --> FIXED (counted from a run (17))

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 1 of the above
- [WARNING] server.js:25902: a test-spawned server would read real logins and write real folders --> FIXED (usagepoll.liveAllowed() (NODE_TEST_CONTEXT, brake); test + mutant)
- [WARNING] engine/accountsweekly.js:36: cross-window branch untested, and dated by change not measurement --> FIXED (measuredAt across windows; test + mutant)
- [WARNING] engine/usagepoll.js:84: no User-Agent; the real path was not measured --> FIXED (a run of the real path from a script was REFUSED by the permission system; confirmation is the first live sweep's log line)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 2 of the above
- [WARNING] engine/usagepoll.js:55: nothing checks the token belongs to the account (wrong login shown) --> FIXED (profile email checked; other-account state; test + mutant)
- [WARNING] engine/accountsweekly.js:36: a wrong-high endpoint reading wins the higher-figure rule --> FIXED (closed by #16 (no reading from another login))
- [WARNING] engine/accountsweekly.js:78: the blocked reason stays hidden for 30 min after the endpoint fails --> FIXED (cleared only while the last read is ok; test + mutant)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 2 of the above
- [BLOCKER] engine/usagepoll.js:58: a harness board (bash-started, no NODE_TEST_CONTEXT, sandbox .claude as default) reads the operator's real bare Keychain token and sends it --> FIXED (DRY_RUN refuses; bare entry only for the real home's .claude (os.userInfo); test + 3 mutants)
- [WARNING] engine/usagepoll.js:165: profile check fails open: a 429/5xx on profile lets another login's figure in --> FIXED (profile-unreadable state, last good kept; test + mutant)
- [WARNING] engine/usagepoll-7152.test.js: the liveAllowed test passes in exactly the CRITICAL's case --> FIXED (DRY_RUN arm + sandbox-shape readCredFor test)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 1 of the above
- [WARNING] server.js:25914: the server's liveAllowed gate has no test that can fail --> FIXED (source check on usagePollTick; 2 mutants red (one survived a loose regex first, tightened))
- [WARNING] engine/usagepoll.js:167: an account with no email gets no identity check --> FIXED (identity-unknown, no request; test + mutant)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 2 of the above
- [WARNING] engine/usagepoll.js:174: identity by email only; same email in two orgs passes --> FIXED (organizationUuid compared; 2 tests + 2 mutants (one survived an injected seam first; real-file test added))
- [WARNING] engine/usagepoll.js:226: kept figures never checked against the current login --> FIXED (record carries email; carried only for the same login; test + 2 mutants)
- [WARNING] engine/usagepoll.js:54: guard comment overclaims "holds for all" --> FIXED (scope stated)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 3 of the above
- [WARNING] engine/usagepoll.js:238: failed read does not carry email; 2nd failure in a row drops fresh figures --> FIXED (email carried; test + mutant)
- [WARNING] engine/usagepoll.js:185: org check passes when the profile names no org --> FIXED (profile-unreadable; test arm + mutant)
- [WARNING] engine/accountsweekly.js:37: higher-wins pins a figure revised down within a window --> ACCEPTED (premise stated in the plan)

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 2 of the above
- [WARNING] engine/usagepoll.js:174: profile field names never measured --> FIXED (measured by the fleet reader (types only): email string + org uuid on 4 of 4 readable accounts; in the plan)
- [WARNING] engine/usagepoll.js:229: records keep email, not org, so the same email in another org keeps old figures --> FIXED (rec.org; sameLogin(); test + 2 mutants)

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 1 of the above
- [WARNING] engine/usagepoll.js:80: real-home guard is darwin-only --> ACCEPTED (off macOS a sandbox reads only its own folder files)
- [WARNING] engine/usagepoll.js:171: profile asked every read, no cache --> DEFERRED (slice 2, only if live sweeps show profile failures; in the plan)
- [WARNING] server.js usagePollTick: a never-settling sweep stops the poll for good --> FIXED (stale after 3 periods; source check + mutant)

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 1 of the above
- [WARNING] engine/accountsweekly.js:37: equal-figure branch unreached; misnamed test --> FIXED (test + 2 mutants; renamed)

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 1 of the above
- [WARNING] engine/usagepoll.js:116: the subscription token on an undocumented endpoint, no backoff on refusal --> FIXED (1 h after 401/403/429; test + 3 mutants)
- [WARNING] engine/usagepoll.js:80: real-home rule only for the macOS default --> FIXED (every folder must be under the real home, all platforms; test + 2 mutants)

#### Iteration 15
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 2 of the above
- [WARNING] engine/usagepoll.js:179: a refused profile request never backs off --> FIXED (profile-http-* states in the backoff; test + 2 mutants)
- [WARNING] engine/usagepoll.js:77: the real-home default is never tested (os.homedir swap stays green) --> FIXED (sandboxed-HOME test + mutant)

#### Iteration 16
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 2 of the above
- [WARNING] engine/usagepoll.js:247: backoff keyed to email, not token: a renewed token waits --> FIXED (refusedExpiresAt; test + mutant)
- [WARNING] engine/usagepoll.js:54: backoff outlasts freshness, so the record (and its reason) vanishes --> FIXED (at moves on while waiting; figures still age out (intended, in the plan); test + mutant)
- [WARNING] engine/usagepoll.js:166: other-account sends another login's token every 10 min forever --> FIXED (other-account in the backoff; test + mutant)

#### Iteration 17
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 1 of the above
- [WARNING] engine/accountsweekly.js:48: the display never checks whose login a record is for --> FIXED (polledOf requires sameLogin; test + 2 mutants)
- [WARNING] engine/usagepoll.js:288: refusedExpiresAt from a second read, not the sent token --> FIXED (one read per sweep, passed to readOne; test + 2 mutants)

#### Iteration 18
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 2 of the above
- [WARNING] engine/accountsweekly.js polledOf: a 571 KB .claude.json parsed per call on request paths --> FIXED (cached by size+mtime; test + 2 mutants)
- [WARNING] engine/usagepoll.js:257: a future refusedAt holds the account back --> FIXED (0 <= age; test + mutant)

#### Iteration 19
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 0 of the above
- [WARNING] engine/usagepoll.js:40: ships the subscription token to an undocumented endpoint for every user; account-level risk not a refusal --> FIXED (OFF unless AGENT_WORKFORCE_USAGE_POLL=1; plan withdraws "a refusal"; test + mutant)

#### Iteration 20
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 2 of the above
- [WARNING] engine/accountsweekly.js polledOf: switched off, earlier records still shown for 30 min --> FIXED (polledOf requires enabled(); test + mutant)
- [WARNING] engine/usagepoll.js:262: a 429 resets on every token renewal --> FIXED (429 keyed to login only; test + 2 mutants)

#### Iteration 21
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 1 of the above
- [WARNING] engine/usagepoll.js:266: a sweep with no usable token erases the refusal's hour --> FIXED (refusedState carried through no-send sweeps; test + 2 mutants)

#### Iteration 22
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 0 NIT lines
**Self-generated:** 3 of the above
- [WARNING] engine/usagepoll.js:277: backoff only in the file; a write failure voids it --> FIXED (in-memory copy, newer wins; test + mutant)
- [WARNING] engine/usagepoll.js:54: only 401/403/429 back off --> FIXED (any 4xx, profile-unreadable; 5xx is profile-unreachable; test + 3 mutants)
- [WARNING] engine/usagepoll.js:269: a clock stepped back under an hour resends --> FIXED (within an hour either way holds; test + 2 mutants)

#### Iteration 23
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 2 of the above
- [WARNING] engine/usagepoll.js isRefusal: a 3xx and an unreadable 200 are not refusals --> FIXED (refusal by exclusion (all but reading/5xx/none); test + 3 mutants)
- [WARNING] engine/usagepoll-7152.test.js: two tests pass through the hold, not their code --> FIXED (failures are 5xx now; 2 mutants red)

#### Iteration 24
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 2 of the above
- [WARNING] engine/usagepoll.js:230: seven_day null (no weekly limit) became a refusal --> FIXED (explicit null is a reading, missing field still refused; test + 2 mutants)
- [WARNING] engine/usagepoll-7152.test.js: "a restart keeps it" unproven for a usable token --> FIXED (fresh-module restart test; ok keeps a live refusal in the file; 2 mutants)

#### Iteration 25
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 1 NIT lines
**Self-generated:** 1 of the above
- [WARNING] engine/usagepoll.js:51: stale three-code backoff comment contradicts the rule --> FIXED (comment cut to the reason)

#### Iteration 26
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs (listed below)
**Self-generated:** 0 of the above
**Converged**: no new actionable findings.

#### Final validation (6j, after convergence)
**Source:** full validation on the merged tree (24119 node tests, shell part, type-check, lint, build)
**First run:** 1 failure, recorded as a synthetic finding:
- [CONVENTION] final-validation: tools/windows-tests.js: engine/windows-tests-1777 refused my test file (a win32 host branch, not run on Windows nor excluded) --> FIXED (added to HOST_BRANCH_EXCLUDED with its reason; validation re-run)
**Second run:** PASSED, 0 failed, hash 8e666b744ad6 (the diff this proof covers).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/usagepoll.js:110 | BRANCH | resets_at null on an unused window -> whole account unreadable | FIXED | 3725800a (kept with resetsAt null; accountsweekly skips it) |
| 2 | 1 | WARNING | engine/usagepoll.js:131 | BRANCH | a failed read overwrites a fresh good reading | FIXED | 3725800a (measuredAt; the last good figures are kept) |
| 3 | 1 | WARNING | engine/usagepoll.js:75 | BRANCH | socket timeout only, no overall deadline | FIXED | 3725800a (hard deadline; timeoutMs seam) |
| 4 | 2 | WARNING | engine/usagepoll.js:75 | BRANCH | idle accounts are often token-expired; limit not stated | FIXED | d51ac79f (plan: weakest premise; slice 2 treats it as unknown) |
| 5 | 2 | WARNING | engine/usagepoll.js:125 | BRANCH | five-hour missing vs out of range are indistinguishable | DEFERRED | slice 1's consumer is the display; slice 2's rule reads weekly only; stated in the plan |
| 6 | 2 | WARNING | engine/usagepoll.js:26 | BRANCH | units reasoned, not measured | FIXED | d51ac79f (plan: a real response's shape; percent confirmed by the page and `limits.percent`) |
| 7 | 3 | WARNING | engine/accountsweekly.js:24 | BRANCH | a fresh endpoint reading shown under "it will not update" and "Set up usage reading" | FIXED | weeklyBlockedOf null while a fresh polled reading exists; test + mutant |
| 8 | 3 | WARNING | engine/accountsweekly.js:24 | SELF | polled `at` = last read, page says "last saw it change" | FIXED | changedAt per window; test + mutant |
| 9 | 3 | WARNING | engine/accountsweekly.js:24 | SELF | newer() compared last-change with last-read | FIXED | same fix as #8 |
| 10 | 4 | WARNING | engine/usagepoll.js:177 | SELF | changedAt compared resets exactly; the reset fraction moves between reads (MEASURED: 14:00:00.447 then 13:59:59.569) | FIXED | 60 s tolerance; test + mutant |
| 11 | 4 | WARNING | engine/accountsweekly.js:28 | SELF | a lagging endpoint figure could beat a higher status-line one | FIXED | same window: the higher figure wins; test + mutant |
| 12 | 4 | CONVENTION | plan:53 | SELF | test count typed, not measured | FIXED | counted from a run (17) |
| 13 | 5 | WARNING | server.js:25902 | BRANCH | a test-spawned server would read real logins and write real folders | FIXED | usagepoll.liveAllowed() (NODE_TEST_CONTEXT, brake); test + mutant |
| 14 | 5 | WARNING | engine/accountsweekly.js:36 | SELF | cross-window branch untested, and dated by change not measurement | FIXED | measuredAt across windows; test + mutant |
| 15 | 5 | WARNING | engine/usagepoll.js:84 | BRANCH | no User-Agent; the real path was not measured | FIXED | a run of the real path from a script was REFUSED by the permission system; confirmation is the first live sweep's log line |
| 16 | 6 | WARNING | engine/usagepoll.js:55 | BRANCH | nothing checks the token belongs to the account (wrong login shown) | FIXED | profile email checked; other-account state; test + mutant |
| 17 | 6 | WARNING | engine/accountsweekly.js:36 | SELF | a wrong-high endpoint reading wins the higher-figure rule | FIXED | closed by #16 (no reading from another login) |
| 18 | 6 | WARNING | engine/accountsweekly.js:78 | SELF | the blocked reason stays hidden for 30 min after the endpoint fails | FIXED | cleared only while the last read is ok; test + mutant |
| 19 | 7 | BLOCKER | engine/usagepoll.js:58 | BRANCH | a harness board (bash-started, no NODE_TEST_CONTEXT, sandbox .claude as default) reads the operator's real bare Keychain token and sends it | FIXED | DRY_RUN refuses; bare entry only for the real home's .claude (os.userInfo); test + 3 mutants |
| 20 | 7 | WARNING | engine/usagepoll.js:165 | SELF | profile check fails open: a 429/5xx on profile lets another login's figure in | FIXED | profile-unreadable state, last good kept; test + mutant |
| 21 | 7 | WARNING | engine/usagepoll-7152.test.js | SELF | the liveAllowed test passes in exactly the CRITICAL's case | FIXED | DRY_RUN arm + sandbox-shape readCredFor test |
| 22 | 8 | WARNING | server.js:25914 | BRANCH | the server's liveAllowed gate has no test that can fail | FIXED | source check on usagePollTick; 2 mutants red (one survived a loose regex first, tightened) |
| 23 | 8 | WARNING | engine/usagepoll.js:167 | SELF | an account with no email gets no identity check | FIXED | identity-unknown, no request; test + mutant |
| 24 | 9 | WARNING | engine/usagepoll.js:174 | SELF | identity by email only; same email in two orgs passes | FIXED | organizationUuid compared; 2 tests + 2 mutants (one survived an injected seam first; real-file test added) |
| 25 | 9 | WARNING | engine/usagepoll.js:226 | BRANCH | kept figures never checked against the current login | FIXED | record carries email; carried only for the same login; test + 2 mutants |
| 26 | 9 | WARNING | engine/usagepoll.js:54 | SELF | guard comment overclaims "holds for all" | FIXED | scope stated |
| 27 | 10 | WARNING | engine/usagepoll.js:238 | SELF | failed read does not carry email; 2nd failure in a row drops fresh figures | FIXED | email carried; test + mutant |
| 28 | 10 | WARNING | engine/usagepoll.js:185 | SELF | org check passes when the profile names no org | FIXED | profile-unreadable; test arm + mutant |
| 29 | 10 | WARNING | engine/accountsweekly.js:37 | SELF | higher-wins pins a figure revised down within a window | ACCEPTED | premise stated in the plan |
| 30 | 11 | WARNING | engine/usagepoll.js:174 | SELF | profile field names never measured | FIXED | measured by the fleet reader (types only): email string + org uuid on 4 of 4 readable accounts; in the plan |
| 31 | 11 | WARNING | engine/usagepoll.js:229 | SELF | records keep email, not org, so the same email in another org keeps old figures | FIXED | rec.org; sameLogin(); test + 2 mutants |
| 32 | 12 | WARNING | engine/usagepoll.js:80 | SELF | real-home guard is darwin-only | ACCEPTED | off macOS a sandbox reads only its own folder files |
| 33 | 12 | WARNING | engine/usagepoll.js:171 | BRANCH | profile asked every read, no cache | DEFERRED | slice 2, only if live sweeps show profile failures; in the plan |
| 34 | 12 | WARNING | server.js usagePollTick | BRANCH | a never-settling sweep stops the poll for good | FIXED | stale after 3 periods; source check + mutant |
| 35 | 13 | WARNING | engine/accountsweekly.js:37 | SELF | equal-figure branch unreached; misnamed test | FIXED | test + 2 mutants; renamed |
| 36 | 14 | WARNING | engine/usagepoll.js:116 | BRANCH | the subscription token on an undocumented endpoint, no backoff on refusal | FIXED | 1 h after 401/403/429; test + 3 mutants |
| 37 | 14 | WARNING | engine/usagepoll.js:80 | SELF | real-home rule only for the macOS default | FIXED | every folder must be under the real home, all platforms; test + 2 mutants |
| 38 | 15 | WARNING | engine/usagepoll.js:179 | SELF | a refused profile request never backs off | FIXED | profile-http-* states in the backoff; test + 2 mutants |
| 39 | 15 | WARNING | engine/usagepoll.js:77 | SELF | the real-home default is never tested (os.homedir swap stays green) | FIXED | sandboxed-HOME test + mutant |
| 40 | 16 | WARNING | engine/usagepoll.js:247 | SELF | backoff keyed to email, not token: a renewed token waits | FIXED | refusedExpiresAt; test + mutant |
| 41 | 16 | WARNING | engine/usagepoll.js:54 | SELF | backoff outlasts freshness, so the record (and its reason) vanishes | FIXED | at moves on while waiting; figures still age out (intended, in the plan); test + mutant |
| 42 | 16 | WARNING | engine/usagepoll.js:166 | BRANCH | other-account sends another login's token every 10 min forever | FIXED | other-account in the backoff; test + mutant |
| 43 | 17 | WARNING | engine/accountsweekly.js:48 | BRANCH | the display never checks whose login a record is for | FIXED | polledOf requires sameLogin; test + 2 mutants |
| 44 | 17 | WARNING | engine/usagepoll.js:288 | SELF | refusedExpiresAt from a second read, not the sent token | FIXED | one read per sweep, passed to readOne; test + 2 mutants |
| 45 | 18 | WARNING | engine/accountsweekly.js polledOf | SELF | a 571 KB .claude.json parsed per call on request paths | FIXED | cached by size+mtime; test + 2 mutants |
| 46 | 18 | WARNING | engine/usagepoll.js:257 | SELF | a future refusedAt holds the account back | FIXED | 0 <= age; test + mutant |
| 47 | 19 | WARNING | engine/usagepoll.js:40 | BRANCH | ships the subscription token to an undocumented endpoint for every user; account-level risk not a refusal | FIXED | OFF unless AGENT_WORKFORCE_USAGE_POLL=1; plan withdraws "a refusal"; test + mutant |
| 48 | 20 | WARNING | engine/accountsweekly.js polledOf | SELF | switched off, earlier records still shown for 30 min | FIXED | polledOf requires enabled(); test + mutant |
| 49 | 20 | WARNING | engine/usagepoll.js:262 | SELF | a 429 resets on every token renewal | FIXED | 429 keyed to login only; test + 2 mutants |
| 50 | 21 | WARNING | engine/usagepoll.js:266 | SELF | a sweep with no usable token erases the refusal's hour | FIXED | refusedState carried through no-send sweeps; test + 2 mutants |
| 51 | 22 | WARNING | engine/usagepoll.js:277 | SELF | backoff only in the file; a write failure voids it | FIXED | in-memory copy, newer wins; test + mutant |
| 52 | 22 | WARNING | engine/usagepoll.js:54 | SELF | only 401/403/429 back off | FIXED | any 4xx, profile-unreadable; 5xx is profile-unreachable; test + 3 mutants |
| 53 | 22 | WARNING | engine/usagepoll.js:269 | SELF | a clock stepped back under an hour resends | FIXED | within an hour either way holds; test + 2 mutants |
| 54 | 23 | WARNING | engine/usagepoll.js isRefusal | SELF | a 3xx and an unreadable 200 are not refusals | FIXED | refusal by exclusion (all but reading/5xx/none); test + 3 mutants |
| 55 | 23 | WARNING | engine/usagepoll-7152.test.js | SELF | two tests pass through the hold, not their code | FIXED | failures are 5xx now; 2 mutants red |
| 56 | 24 | WARNING | engine/usagepoll.js:230 | SELF | seven_day null (no weekly limit) became a refusal | FIXED | explicit null is a reading, missing field still refused; test + 2 mutants |
| 57 | 24 | WARNING | engine/usagepoll-7152.test.js | SELF | "a restart keeps it" unproven for a usable token | FIXED | fresh-module restart test; ok keeps a live refusal in the file; 2 mutants |
| 58 | 25 | WARNING | engine/usagepoll.js:51 | SELF | stale three-code backoff comment contradicts the rule | FIXED | comment cut to the reason |
| 59 | 26 (6j) | CONVENTION | tools/windows-tests.js | BRANCH | full validation: engine/windows-tests-1777 refused my test file (a win32 host branch, not run on Windows nor excluded) | FIXED | added to HOST_BRANCH_EXCLUDED with its reason; validation re-run |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- [NIT] iteration 1: five-hour max-ahead, log counts measured only, first tick at 30 s, header, blank line, secret wording
- [NIT] iteration 2: newer() tie untested; two file reads per account; reachable claim (fine).
- [NIT] iteration 3: log total counted API-key rows (FIXED); no-op token clears (FIXED, removed); windowOf comment overclaimed (FIXED).
- [NIT] iteration 4: expiry margin (FIXED, 60 s); weekly cap (FIXED, 8 days); 64 KB comment (FIXED).
- [NIT] iteration 5: summary passes nowMs (FIXED); readUsage re-checks bounds, write() flush, stale comments in web/index.html:28548 and server.js:12560, log line counts (NOT taken this round).
- [NIT] iteration 6: equal figures prefer the later change (FIXED); state history, require placement, "signed-in" wording (NOT taken).
- [NIT] iteration 7: weeklyBlockedOf reads the file twice (NOT taken: summary cached 15 s); two same-Mac boards double the rate (NOT taken: writes atomic).
- [NIT] iteration 8: Keychain prompt per sweep (first live log shows); other-account over a good record untested; weeklyBlockedOf double read; SAME_WINDOW_MS after newer(); body cap overshoot by one chunk (all NOT taken).
- [NIT] iteration 9: profile request host untested (FIXED); higher figure beats a login-checked one in a window; usedPct unbounded; token test vacuous; double read; stdout line per sweep; Keychain frequency (NOT taken).
- [NIT] iteration 10: changedAt across a re-login (FIXED; my first test was vacuous, a mutant caught it); profile per poll; two boards; usedPct cap; source-text gate; liveAllowed() runner (NOT taken).
- [NIT] iteration 11: future measuredAt (FIXED, test + mutant); plan's 21-test claim (FIXED, 32); double read, nowMs on /api/accounts, tmp symlink (NOT taken).
- [NIT] iteration 12: realpath home compare; null vs number reset; source-text gate (NOT taken).
- [NIT] iteration 13: profile org recorded (FIXED, test + mutant); 200 profile with no email (FIXED, test arm); null realHome arm non-discriminating, double read, tmp mode (NOT taken).
- [NIT] iteration 14: liveAllowed() runner, source-text gate, higher-wins negative direction, hung profile cycle length (NOT taken). My first backoff test failed for a fixture token that expired at 60 min, not for the code.
- [NIT] iteration 15: backoff per login (FIXED, test + mutant); duplicate realHome keys (FIXED, 5); two boards per user, double read (NOT taken).
- [NIT] iteration 16: HOME restore when unset (FIXED); liveAllowed() runner; stale busy overlap (NOT taken).
- [NIT] iteration 17: backoff bypass by a failed Keychain read (FIXED, same change); changedAt with the profile's org (FIXED, test + mutant); outside-home state word (NOT taken).
- [NIT] iteration 18: profile first, 5xx label, rounding flip, tmp name (NOT taken; reasons in the plan for two).
- [NIT] iteration 19: backoff email case (FIXED, test arm + mutant); restart sweep, realpath home, unwritable backoff (NOT taken, reasons in plan).
- [NIT] iteration 20: org in backoff key, profile first, orgCache growth, busy backstop (NOT taken).
- [NIT] iteration 21: brake also hides records (FIXED, test + mutant); guard inside pollAll, org in backoff key (NOT taken).
- [NIT] iteration 23: hold shows the refusal (FIXED, test + mutant); live copy beats newer expired (FIXED, test + mutant); profile no-org comment (FIXED in the comment).
- [NIT] iteration 24: ok record carries the refusal (FIXED, same change); liveAllowed() runner, three reads per account per call (NOT taken).
- [NIT] iteration 25: "newer" wording x3, copy rule, header count, misplaced docs x2, plan states line (all FIXED, prose); null expiry over-holds (stated in the rule); polledOf could cost the status line (FIXED, test + mutant); one refusal per folder (NOT taken).
- [NIT] iteration 26: (see the proof; no new BLOCKER/WARNING/CONVENTION).
- [NIT] iteration 26: liveAllowed comment sits above enabled; a redundant p.code === 200 test; backoff keyed to email not organization (accepted in the plan); per-request file reads on /api/accounts while on (NOT taken: the reviewed diff is kept as reviewed)

### Strengths (across all iterations)
- Every reviewer pass found no way for the token to leave the Authorization header (iterations 13 to 26).
- Off by default, and while off the board is exactly as on main (confirmed by iterations 21, 24, 25, 26).
