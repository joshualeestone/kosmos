---
pre_challenge: true
method: challenge-loop
branch: heldcert-4737
diff_hash: 86e821eaeb218a9f97364ea3518b6570db68af2eb21a06c6a45e47f99d3dca54
validation: focused, on b4810eed3 (the converged head before the rebase onto f939828c4): node --test engine/enrolment.test.js engine/remote-report.test.js engine/remote.test.js, 158 run, 158 passed, 0 failed, every #4737 arm and both controls among them (Agent1s, queued-heavy, 09:22 to 09:24 CDT); the rebase was clean, and main's own changes since then to engine/remote.test.js (15 lines) and web/index.html are NOT covered by that run, they are covered by this PR's CI (the full node suite), and the PR merges only on its green
subdir_audit: passed
timestamp: 2026-10-01T14:25:23Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind reviews of both halves together (this app branch and kosmos-relay `heldcert-4737`), recorded in
`.claude/plans/heldcert-4737.md` here and in the relay plan.
**Converged:** Yes. Review 1: 0 BLOCKER, 1 WARNING (relay side), 7 NITs, the applicable ones taken. Review 2: CONVERGED,
4 NITs, all taken (one of them added the two `halfRegistered()` arms here). Review 3 (the delta after review 2):
CONVERGED, 2 test-hygiene NITs, recorded and not taken.
**Fixed:** every WARNING and the taken NITs, one commit per review. **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (fable-class blind reviewer, both repos)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 7 NITs
- [WARNING] kosmos-relay crates/tunnel/src/setup.rs - nothing in the relay pinned the literal name `held` the app reads --> FIXED (relay test asserts the literal)
- [NIT] engine/remote.js halfRegistered() - the held clause adds only the no-address case --> FIXED (comment says so)
- [NIT] engine/remote.test.js - the same-name sign-in takes the #1010 shortcut and never reaches clearHalfIdentity() --> FIXED (arms register under another name)
- [NIT] kosmos-relay renew.rs - cert_asked_at survived a new registration --> FIXED (forgotten on register)
- [NIT] engine/remote-report.js - the first-certificate failure reported `other` --> FIXED (`cert-first-fetch`)
- [NIT] kosmos-relay session.rs - a slow first order can outlive the ticket --> FIXED (comment; heals on the next session)
- [NIT] web/index.html - stale comment on enrolled() --> FIXED
- [NIT] kosmos-relay certificate_survives trusts the address file, not the name in the certificate (older than this card) --> DEFERRED as kosmos#4876

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
- [NIT] an in-flight first fetch racing a rename can write the old name's certificate --> DEFERRED (added to kosmos#4876, same fix)
- [NIT] engine/remote.test.js - halfRegistered()'s held clause had no arm that could fail --> FIXED (held with no address: not retired; control: retired)
- [NIT] kosmos-relay session.rs - the "no certificate yet" sentence was pinned in the app only --> FIXED (const + literal test)
- [NIT] kosmos-relay setup.rs - the mark outlived a certificate if writing ca.crt failed --> FIXED (removed right after tls.crt)
**Converged** - no BLOCKER or WARNING.

#### Iteration 3
**Reviewer model:** opus (the delta after iteration 2)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] engine/remote.test.js - the held no-address arm does not positively assert the register ran --> accepted (no held-specific early return exists)
- [NIT] engine/remote.test.js - the no-address control does not assert enrolled() false --> accepted (paired control by design)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | WARNING | relay setup.rs | literal `held` unpinned | FIXED |
| 2 | 1 | NIT | engine/remote.test.js | arms on the #1010 shortcut | FIXED |
| 3 | 1 | NIT | engine/remote-report.js | first-fetch reported `other` | FIXED |
| 4 | 1 | NIT | relay certificate_survives | address file, not cert name | DEFERRED kosmos#4876 |
| 5 | 2 | NIT | engine/remote.test.js | held clause untested | FIXED |
| 6 | 2 | NIT | relay session.rs | sentence unpinned in relay | FIXED |
| 7 | 3 | NIT | engine/remote.test.js | two hygiene items | ACCEPTED |

Mutation evidence: a scratch copy with the mark's name changed turns exactly the #4737 report arm red (16 pass, 1
fail by name); a scratch copy without the new `cert-first-fetch` pattern turns exactly its classify case red.

Inert alone: nothing writes the `held` mark until the relay half (kosmos-relay `heldcert-4737`) ships, and that half
reaches people only in an app cut, which by then carries this one. Merge order: this branch first.

**Rebased 2026-10-01 15:50 CDT onto main 0c6290975** (clean). The diff hash changed only because main moved
the context lines around the change; the change itself is the same. The first PR run's only failure was the
browser-check gate: the one web/index.html change is two lines inside an existing block comment, so the branch
carries the gate's `Browser-check:` override with that reason. Its node suite was otherwise 13565 pass, 0 fail.
