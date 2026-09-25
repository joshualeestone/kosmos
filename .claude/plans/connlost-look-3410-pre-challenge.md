---
pre_challenge: true
method: challenge-loop
branch: connlost-look-3410
diff_hash: 87909a57846216b679dad0021676c57191c826d5d7556b4810a05ea9b108720a
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T11:43:51Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 1 BLOCKER, 6 WARNINGs, 0 CONVENTIONs, 9 NITs
**Fixed:** 1 BLOCKER, 5 WARNINGs, most NITs | **Deferred:** 1 WARNING (asked of the design owner, not a loop ASKED: it is her call and does not block this change) | **Asked:** 0

Validation: full run on HEAD 109ac863, 9220 tests, 0 failures; subdir audit passed. Every change was
also checked on the live page with the browser check render-connlost-reconnect-3410 (headless via
pw-runtime), with red controls for the card look, the border colour and the members row.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html pjMember — the members row read cardStOf(m) (no reconnect), so it stayed grey beside a red card --> FIXED (77c3a0a9, cardStOf(liveM); browser check asserts pjm-attn per phase; red control bit)
- [WARNING] docs/browser-checks/render-connlost-reconnect-3410.js — the members check compared only the label --> FIXED (77c3a0a9)
- [WARNING] web/index.html data-attn — a given-up card is red but not counted under the Issue filter/tile --> DEFERRED: that filter keys on needs_you (#3423), needs_trust already works this way, and widening it changes another card's feature; recorded in the plan and put to Mona Lisa (design owner)
- [WARNING] web/index.html stateCopyOf comment said the look never changes --> FIXED (77c3a0a9)
- [WARNING] web/index.html CARD_ST.connection_lost comment said the louder look was undecided --> FIXED (77c3a0a9)
- [NIT] check-in verb for given up --> FIXED (77c3a0a9, "Restart it, or is it done?")
- [NIT] bgOf held a border colour --> FIXED (77c3a0a9, borderOf)
- [NIT] README row did not mention the look --> FIXED (77c3a0a9)
- [NIT] cardStOf readability --> FIXED in 77c3a0a9 by splitting it, which iteration 2 found broke two tests; reverted in ef7c84c1

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 0 CONVENTIONs, 0 NITs
**Self-generated:** 1 of the above (the BLOCKER was the iteration-1 NIT fix)
- [BLOCKER] web/index.html cardStOf — splitting it across lines broke web.needsyou-dealarm-2808.test.js and server.test.js, which slice it to the newline --> FIXED (ef7c84c1, back on one line with a comment naming both tests; both files pass)
- [WARNING] org chart and detail panel also take the needs-you look via cardStOf, unstated --> FIXED (ef7c84c1, plan states it as intended)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 new WARNINGs (its one WARNING was the deferred Issue-filter item), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [NIT] pjMember comment named only two routes to the red row --> FIXED (109ac863)
- [NIT] org-chart #3423 comment listed divergences incompletely --> FIXED (109ac863)
- [NIT] a substring count stands in for a stylesheet check (same shape as its sibling) --> left; the browser check's computed border proves the look

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [NIT] an inline `cardStOf(m)` mention in the pjMember comment; the same comment's last sentence names liveM
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html pjMember | BRANCH | members row grey beside red card | FIXED | 77c3a0a9 |
| 2 | 1 | WARNING | render-connlost-reconnect-3410.js | BRANCH | members check label-only | FIXED | 77c3a0a9 |
| 3 | 1 | WARNING | web/index.html data-attn | BRANCH | Issue filter omits given up | DEFERRED | design owner's call; plan |
| 4 | 1 | WARNING | web/index.html stateCopyOf | BRANCH | stale look comment | FIXED | 77c3a0a9 |
| 5 | 1 | WARNING | web/index.html CARD_ST | BRANCH | stale design-call comment | FIXED | 77c3a0a9 |
| 6 | 2 | BLOCKER | web/index.html cardStOf | SELF | multi-line broke slicing tests | FIXED | ef7c84c1 |
| 7 | 2 | WARNING | .claude/plans/connlost-look-3410.md | BRANCH | org chart/detail unstated | FIXED | ef7c84c1 |

### NITs (non-blocking, across all iterations)
- [NIT] substring count as a stylesheet check (iteration 3, left: browser check measures the border)
- [NIT] inline `cardStOf(m)` in a comment (iteration 4)

### Strengths (across all iterations)
- [STRENGTH] — One derivation (cardStOf) drives the card, row, org node, detail and members row, so they cannot disagree (iterations 1-4)
- [STRENGTH] — The browser check measures what the person sees (computed border colour) with red controls, not only class names (iterations 1, 3, 4)
- [STRENGTH] — Mona Lisa's weakest premise was checked against every launch line before keeping her clause (iterations 1, 4)
