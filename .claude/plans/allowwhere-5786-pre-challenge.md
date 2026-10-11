---
pre_challenge: true
method: challenge-loop
branch: allowwhere-5786
diff_hash: bffbb334c95126e442d45d3ccabb64fc3543eb42784322c98098232ed32202f3
validation: passed
subdir_audit: passed
timestamp: 2026-10-10T21:15:31Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 12 actionable (1 BLOCKER, 10 WARNINGs, 1 CONVENTION) plus NITs
**Fixed:** 9 | **Deferred:** 3 | **Asked (awaiting user):** 0

Validation: the full kosmos validation ran on Mortals (mortals-validate.sh) at the final head e3a3278d (Agent1s was in use
for a live sign-in): PASSED, 18662 tests / 0 fail, the #5786 test among them, hash bffbb334c951, recorded locally. Browser check render-plus-asks-signin-4610.js at e3a3278d: 20 PASS / 0 FAIL (1400 and 390).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html - the browser part `(.+)` let a self-named device write free text into the security sentence --> FIXED (f3b33340: closed list of deviceNameFor browsers; attacker name a tested refusal; mutation reds it)
- [WARNING] web/index.html - "showing ... on the Kosmos+ page" not true in every state --> FIXED (f3b33340, softened; superseded in iterations 3 and 5)
- [CONVENTION] no plan file --> FIXED (f3b33340)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] web/index.html - "reload it if the code is not there yet" not strictly true --> FIXED by deleting the clause (684cd634)
- [WARNING] web/index.html - named browser vs the one the person looks at --> DEFERRED: not an issue (the name is the asking browser's own UA)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [BLOCKER] web/index.html - TWO pages ask and name alike (relay signin.html; tunnel gate.html on the person's own address), each shows its own code, so naming login.kosmosplus.com sends people to the wrong page --> FIXED (edf713c7: no host)
- [WARNING] comments said only signin.html names devices --> FIXED (edf713c7: both producers named)
- [WARNING] signin.html shows the code only on its signed-in home, not during payment --> DEFERRED to the relay web half of #5786
- [WARNING] browser check not yet run on the wording --> FIXED (re-run, PASS)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 (1 duplicate: the payment gap, deferred in iteration 3)
**Self-generated:** 0

#### Iteration 5 (after a post-convergence label fix, e567b6e8)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 3 of the above
- [WARNING] a CONTROL clause aimed at the old wording could never fail --> FIXED (e3a3278d: aimed at the current wording)
- [WARNING] test title/comment and browser-check comment said "the Kosmos+ page" --> FIXED (e3a3278d)
- [WARNING] signin.html can move the same tab to the gate, so "the page where you signed in" misleads --> FIXED (e3a3278d: "in the tab where you signed in")
- [WARNING] plan status stale --> FIXED (e3a3278d)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 (duplicates: the payment gap; an exact forged name is harmless, not an issue)
**Converged** - no new actionable findings.

### Outstanding questions
None.

### Strengths
- The test runs the page's own regex literal; 4 recognised names, 11 refused including an attacker's; mutations ("Windows" for "Windows PC"; a free-text capture) each red their own case.
- The browser check has an iPhone · Safari CONTROL aimed at the arm the pattern must refuse.
