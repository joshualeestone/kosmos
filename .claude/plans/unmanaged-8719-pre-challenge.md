---
pre_challenge: true
method: challenge-loop
branch: unmanaged-8719
diff_hash: f15c8a2d2bf598c87867d60bba4e271d66b8aa33ea4f769646ff5a0949f89c3d
validation: passed
subdir_audit: passed
timestamp: 2026-11-19T01:37:19Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round cap with no BLOCKER open (Splinter's standing rule of 2026-10-31: "cap 8
rounds unless a BLOCKER is open; leftovers go on a card"). Round 8's leftovers ride on kosmos#8719 part 2 / #8724.
**Total findings:** 2 BLOCKERs, 18 WARNINGs (several re-raised), 2 CONVENTIONs, many NITs
**Fixed:** 2 BLOCKERs, 14 WARNINGs, 2 CONVENTIONs | **Deferred:** 4 WARNINGs | **Asked:** 0

Validation: final run passed (29258 pass, 0 fail, hash f15c8a2d2bf5). An earlier run had two reds, both this branch's:
the mobile-shots service-worker reader could not see three screens built with a .map spread (rewritten as literal
entries), and the browser-check surface gate named seven checks whose tokens the changed lines mention; all seven were
RUN alone on 6f9db3242b (queued-heavy, 18:43 to 18:48 CST) and passed, and are recorded as per-check
Browser-check-surface trailers. Design shots: ~/work/design-shots/kosmos-8719 (tile, list row and page; desktop and
iPhone 15; light and dark), all 12 taken and looked at; the first run caught the list label clipped at desktop (fixed).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] server.projects.test.js:2307 - pinned the old 404 for an untied send --> FIXED (b0e058bd7e)
- [WARNING] server.js GET thread - the iPhone still read "no agent by that name" on open --> FIXED (b0e058bd7e): untiedReadWords
- [WARNING] web/index.html - reason shown twice on the agent page --> FIXED (b0e058bd7e)
- [WARNING] remedy promised a route the window blocks --> FIXED in wording (b0e058bd7e), finally removed in iteration 6
- [CONVENTION] no design shots --> FIXED: three mobile-shots screens, shots taken and looked at

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING new (1 duplicate), 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] web/index.html #d-untied - "For the same reason" does not stand alone (picture button reads it alone; #d-task hides on a question) --> FIXED (67587c20e1)
- [NIT] fixed: controls for needs_you/auth_failed/rate_limited; render-talk fixture sends the server's words

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING new, 1 CONVENTION, 7 NITs
**Self-generated:** 0 of the above
- [WARNING] wording claimed where the window came from; a renamed Kosmos session fails the same check --> FIXED (14e5e933f0): "Kosmos cannot confirm it started this window", label "Not linked to Kosmos"
- [CONVENTION] plan out of date --> FIXED (14e5e933f0)
- [NIT] fixed: read words cover writes too; helper names; stale comment; list label wraps (the design-shot check caught it clipped)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING new (1 deferred), 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (iteration 1's lead ordering)
- [WARNING] the untied lead hid a sign-in or limit reason --> FIXED (fe484b1451), refined in iterations 5 and 7
- [WARNING] milliseconds between a launch's new-session and its mark --> DEFERRED: known, stated in the plan, the card was anonymous then before this change too

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 2 of the above
- [WARNING] a borrowed reason promised a Kosmos action (reconnect retry) --> FIXED (3b285862c9)
- [WARNING] render-thread guard could not fail on the new words --> FIXED (3b285862c9)
- [WARNING] the waiting-line test was vacuous ({kind:'x'}) --> FIXED (3b285862c9): a real count, with a premise

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING new (1 duplicate), 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] read and send used different tests for one condition --> FIXED (183026339f): the send uses nameRefusal's
- [WARNING] the remedy clause again (third time) --> FIXED (183026339f): no sentence promises a route; part 2 is the remedy

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [BLOCKER] web.machinecost-7978.test.js:97 - pinned the tile's model row the label joined --> FIXED (bd714ffbca); every other test swept for strings of changed lines, none
- [WARNING] the recursion could borrow a crash loop's "Kosmos will keep trying" --> FIXED (bd714ffbca): no borrowing, one plain clause for a sign-in or a limit

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs (2 near-duplicates), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] the read refusal echoes the request's spelling --> DEFERRED: harmless text, carried to part 2
- [WARNING] two near-identical lines on the agent page --> DEFERRED: both seen in the phone shot, readable; each must stand alone
- [WARNING] source pins prove wiring only --> DEFERRED: the design-shot screens cover rendering
**Stopped at the cap.**

### Final Ledger (deferred)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 4 | WARNING | server.js thread route | BRANCH | ms gap between a launch's new-session and its mark | DEFERRED | in the plan; pre-existing |
| 2 | 8 | WARNING | server.js nameRefusalBody | SELF | read refusal echoes the request's spelling | DEFERRED | harmless; carried to part 2 |
| 3 | 8 | WARNING | web/index.html #d-untied | SELF | two near-identical lines on the page | DEFERRED | seen in shots, each must stand alone |
| 4 | 8 | WARNING | web.untied-8719.test.js | SELF | source pins prove wiring only | DEFERRED | design-shot screens render it |

### Strengths (across all iterations)
- Nothing relaxes what Kosmos types into or shows; only the status code and words of an existing refusal changed
- Words state what is checked, not where a window came from, and promise no route Kosmos does not offer
- Tests pair each case with a control; the 404 control returns once the stranger window is gone
