---
pre_challenge: true
method: challenge-loop
branch: addcomputer-6314
diff_hash: 10a1a8bb8558251968c05bdb7843b60a4656f8a38074b39ec7cf7a18cf1dfd43
validation: passed
subdir_audit: passed
timestamp: 2026-10-16T21:28:29Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10: both findings were duplicates of DEFERRED entries)
**Total findings:** 45 (0 BLOCKERs, 34 WARNINGs, 0 CONVENTIONs, 11 NITs taken or noted)
**Fixed:** 29 | **Deferred:** 5 | **Asked (awaiting user):** 0

Disclosed deviations: the 6.0 baseline validation ran in a frozen copy alongside iteration 1 rather than before it
(it failed only on the browser-check surface gate, resolved with per-check trailers after each of the seven mapped
checks was run alone and passed). After convergence the branch was rebased onto main for a one-line conflict with
#6313 (plusSiRequestCode: both sides kept); every affected check was re-run on the rebased head and passed, and the
final validation above ran on the rebased head (an earlier queued run was stopped before it could test a tree that
no longer merged).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 7 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html plusSiSession: PLUS_SI_AUTO_READ leaked on non-pick paths --> FIXED (taken once in the click handler, passed down)
- [WARNING] web/index.html: a re-shown stale list could auto-take --> FIXED (opts.reshow)
- [WARNING] web/index.html: plus-joining hid devices on an allowed-unconfirmed computer --> FIXED (held only)
- [WARNING] web/index.html: "notices by itself" false after 20 min --> FIXED (focus re-arms)
- [WARNING] web/index.html: own-pending/unread got the Add heading and a false line --> FIXED
- [WARNING] render-plus-bought-4756.js: no single-address auto-then-fail scenario --> FIXED (auto-offline)
- [WARNING] web/index.html: the 10 s tick made read counts timing-dependent --> FIXED (test seam)
- [NIT] Too-many-tries line; aria-expanded on Change (taken); waitingKey rescroll; PRICE_SHAPE width (not taken)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html paintAsk: shownKey not reset on early returns --> FIXED
- [WARNING] web/index.html: auto-take of one free address (product risk) --> DEFERRED: Josh asked for it ("it should have just pushed me through"); recorded in the plan
- [WARNING] web/index.html: auto read cleared a message being read --> FIXED
- [WARNING] web/index.html: "Your plan covers one computer" not established --> FIXED (claim dropped)
- [WARNING] web/index.html: "notices by itself" overclaims --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above (code)
- [WARNING] web/index.html: empty name said "with no name" (engine sends "This computer") --> FIXED
- [WARNING] web/index.html: scroll on any key change --> FIXED (only when a new id appears)
- [WARNING] web/index.html: an auto read that throws left Check again disabled --> FIXED
- [WARNING] render-plus-bought-4756.js: the seam gated only the tick --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (prose, deleted)
- [WARNING] web/index.html: the "checks by itself" hint (third recurrence) --> FIXED (claim deleted)
- [WARNING] web/index.html: "$20 a month" vs a promotion code --> DEFERRED: Stripe's list price; codes apply at checkout (plan Known limits)
- [WARNING] web/index.html: a quiet failure repainted the panel --> FIXED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above (test assertion, deleted)
- [WARNING] web/index.html: disabling the focused Check again dropped the focus every 10 s --> FIXED (busy flag; quiet-keeps-focus, proven red)
- [WARNING] web/index.html: ~120 coordinator reads per waiting window --> FIXED (back-off 10 s then 60 s)
- [WARNING] render-plus-bought-4756.js: a vacuous auto-offline focus assertion --> FIXED (deleted)
- [WARNING] web/index.html: auto-take on the first read --> DEFERRED: duplicate of iteration 2's decision

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html: PLUS_SI_NONE_SINCE not reset after a list --> FIXED
**Duplicates of prior findings (confirmed resolved):** 2

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html: refusal-guard comment overclaimed --> FIXED
- [WARNING] web/index.html: a quiet read to a 2+ list dropped focus --> FIXED (quiet-to-list, proven red)
- [WARNING] web/index.html: rescroll for an old request on each return --> DEFERRED: a waiting request is what Josh missed; iteration 2 made the return-scroll deliberate

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (prose, deleted)
- [WARNING] web/index.html: the auto-take comment (ambiguous) --> FIXED (deleted; the plan states the rule)
- [WARNING] web/index.html: the auto-read flag could stay set if the click reached no handler --> FIXED

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 2 of the above (code)
- [WARNING] web/index.html: a manual Check again moved the focus to the payment link --> FIXED (asserted, proven red)
- [WARNING] web/index.html: the quiet read read the focus after hiding the panel --> FIXED

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (DEFERRED):** 2 (auto-take trade-off; list price vs promotion code)
**Converged** -- no new actionable findings.

### Final Ledger (WARNINGs; NITs listed above)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html plusSiSession | BRANCH | auto-read flag leak | FIXED | 0e18e9fb70 |
| 2 | 1 | WARNING | web/index.html plusSiBoughtPick | BRANCH | stale reshown list auto-taken | FIXED | 0e18e9fb70 |
| 3 | 1 | WARNING | web/index.html paintPlusJoin | BRANCH | devices hidden after allowed | FIXED | 0e18e9fb70 |
| 4 | 1 | WARNING | web/index.html hint | BRANCH | 20-minute claim | FIXED | 0e18e9fb70 |
| 5 | 1 | WARNING | web/index.html none panel | BRANCH | wrong heading on pending/unread | FIXED | 0e18e9fb70 |
| 6 | 1 | WARNING | render-plus-bought-4756.js | BRANCH | no auto-then-fail scenario | FIXED | 0e18e9fb70 |
| 7 | 1 | WARNING | render-plus-bought-4756.js | BRANCH | timing-dependent read counts | FIXED | 0e18e9fb70 |
| 8 | 2 | WARNING | web/index.html paintAsk | BRANCH | shownKey reset | FIXED | 1c6a60b7c9 |
| 9 | 2 | WARNING | web/index.html auto-take | BRANCH | product risk | DEFERRED | Josh's ask; plan |
| 10 | 2 | WARNING | web/index.html check handler | BRANCH | message cleared by auto read | FIXED | 1c6a60b7c9 |
| 11 | 2 | WARNING | web/index.html none lead | BRANCH | plan-coverage claim | FIXED | 1c6a60b7c9 |
| 12 | 2 | WARNING | web/index.html hint | BRANCH | "notices by itself" | FIXED | 1c6a60b7c9 |
| 13 | 3 | WARNING | web/index.html plusSiComputerSay | BRANCH | empty name wording | FIXED | 673892f831 |
| 14 | 3 | WARNING | web/index.html paintAsk | BRANCH | scroll on any key change | FIXED | 673892f831 |
| 15 | 3 | WARNING | web/index.html check catch | SELF | controls stuck after a throw | FIXED | 673892f831 |
| 16 | 3 | WARNING | render-plus-bought-4756.js | SELF | seam gated only the tick | FIXED | 673892f831 |
| 17 | 4 | WARNING | web/index.html hint | SELF | "checks by itself" | FIXED | 7edd49429a |
| 18 | 4 | WARNING | web/index.html cost line | BRANCH | list price vs promotion code | DEFERRED | plan Known limits |
| 19 | 4 | WARNING | web/index.html quiet failure | BRANCH | panel repainted | FIXED | 7edd49429a |
| 20 | 5 | WARNING | web/index.html plusSiSession | BRANCH | focus dropped by disabling | FIXED | 462e188a2e |
| 21 | 5 | WARNING | web/index.html auto check | BRANCH | coordinator load | FIXED | 462e188a2e |
| 22 | 5 | WARNING | render-plus-bought-4756.js | SELF | vacuous assertion | FIXED | 462e188a2e |
| 23 | 5 | WARNING | web/index.html auto-take | BRANCH | first-read auto-take | DEFERRED | duplicate of 9 |
| 24 | 6 | WARNING | web/index.html none panel | BRANCH | NONE_SINCE after a list | FIXED | f0ac56b8d6 |
| 25 | 7 | WARNING | web/index.html auto-take comment | BRANCH | overclaim | FIXED | ee33d4cb90 |
| 26 | 7 | WARNING | web/index.html plusSiBoughtPick | BRANCH | focus to body on quiet 2+ list | FIXED | ee33d4cb90 |
| 27 | 7 | WARNING | web/index.html paintAsk | BRANCH | rescroll on return | DEFERRED | deliberate (Josh's miss) |
| 28 | 8 | WARNING | web/index.html auto-take comment | SELF | ambiguous comment | FIXED | 2c8c247d64 |
| 29 | 8 | WARNING | web/index.html auto check | BRANCH | flag set with no handler | FIXED | 2c8c247d64 |
| 30 | 9 | WARNING | web/index.html plusSiBoughtPick | SELF | Check again focus to the payment link | FIXED | 7d7423e03c |
| 31 | 9 | WARNING | web/index.html plusSiSession | SELF | focus read after hide | FIXED | 7d7423e03c |

(Shas are the pre-rebase loop commits; the rebase onto main rewrote them. The same changes are in the rebased
branch, head cf6e034f18.)

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] waitingKey rescroll when one of two is answered (iteration 1, not taken)
- [NIT] PRICE_SHAPE wider than a currency mark (iteration 1, not taken; written via textContent)
- [NIT] $0 display; dot colour token (iterations 2 and 10, not taken)
- [NIT] "does not trust <name> yet" line; Change tap size inline (iteration 5, not taken)
- [NIT] scroll key from rows vs live (iteration 9, not taken)

### Strengths (across all iterations)
- The price is Stripe's own (price.display through PRICE_SHAPE), never written into the page (iteration 1)
- #5995's privacy control kept one press away; the name is written as text only (iteration 1)
- Auto-take bounded (one free address, no refusal standing, each address once) and proven by scenarios (iterations 5, 7)
- New checks assert their preconditions and were each proven red against the code before their fix (iterations 5, 7, 9)
