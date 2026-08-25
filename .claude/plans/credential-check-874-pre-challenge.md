---
pre_challenge: true
method: challenge-loop
branch: credential-check-874
diff_hash: 7b53cd40bc838ba662032db7e392454d89ce560228b0ada5e238fda14b13f813
subdir_audit: passed
timestamp: 2026-08-25T17:47:45Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 5 (1 BLOCKER-equivalent BUG, 4 NITs)
**Fixed:** 5 | **Deferred:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 3 (0 BUGs, 3 NITs)
- [NIT] `test-support/fleet.js` — no `auth_failed` entry in the `SCREEN` map, so a fixture-built `auth_failed` agent could not be routed through the real classifier, only hand-built as a card. --> FIXED (commit `61abdee`): added the SCREEN entry, updated the `opts.state` JSDoc list, and added a new proof test in `engine/chat.test.js` (`#874: test-support/fleet arranges an auth_failed agent for real, not just a hand-built card`) exercising it via `withFleet`.
- [NIT] `web/index.html` `busyRow`/`stateReason` — HTML-entity punctuation in `busyRow` vs. plain ASCII apostrophes in `stateReason` looked like an unintentional inconsistency. --> INVESTIGATED, not a bug: traced `esc()`'s exact source and all 3 call sites of `taskLine()`/`stateReason()`. `busyRow`'s return value goes straight to `innerHTML` (entities render as intended); `stateReason()`'s goes through both `esc()`+`innerHTML` (entities would show as literal escaped text) and a bare `.textContent` assignment (entities never interpreted at all). Each function's choice is correct for its own sink; unifying them would introduce a real regression in one direction. Documented with a code comment instead of changing behavior.
- [NIT] Visual-language split (loud `.haz` chat glyph vs. quiet `paused`-style card badge) flagged for confirmation. --> CONFIRMED as already-deliberate scope, documented in the plan file's Design section; no action needed.

#### Iteration 2
**New findings:** 2 (1 BUG, 1 NIT)
- [BUG] `web/index.html` `busyRow`'s `auth_failed` branch used `&mdash;` (a real rendered em dash) in the evidence line — violates this repo's hard, consistently-enforced no-em-dash house rule. --> FIXED (commit `248296c`): replaced with a comma (`', last seen: &ldquo;...&rdquo;'`); "last seen" already does the connecting work the dash was doing. Comment updated to stop describing `&mdash;` as one of the intentional entities used.
- [NIT] `web/index.html` — a second copy of the "only rate_limited has one" comment (near `d-task`, ~line 13862) was not updated for `auth_failed`, while a nearly identical comment near `taskLine` (~line 7943) had been. --> FIXED (commit `248296c`): updated to "rate_limited, and since #874, auth_failed".
- **Confirmed clean, no findings:** marker regex scoping vs. `RATE_LIMIT_MARKERS`/`NEEDS_YOU_MARKERS`/Codex branch, `classify()` state ordering, XSS/escaping correctness, `GLYPH`/`CARD_ST` wiring, non-vacuous test coverage (including the iteration-1 fleet.js fixture fix), and the `subscription.js` out-of-scope boundary (empty diff on that file, no UI copy overclaiming Settings accuracy).

#### Iteration 3
**New findings:** 0 BUGs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** — no new BLOCKER/WARNING/CONVENTION-equivalent findings.
- [NIT] `engine/chat.js` — the new `AUTH_FAILED` case in `waitingNote()`'s switch used double-quoted strings while every sibling case uses single quotes. --> FIXED (commit `5d37966`): switched to single quotes.
- [NIT] `web.reply-where.test.js` — the two new `#874` assertion failure-messages were worded backwards from what the assertions actually check (read as guarding against the feature being removed, while confirming the feature is present). --> FIXED (commit `5d37966`): reworded to state what each assertion actually guards.
- Also noted (not tagged, informational): the plan file's verification section had stale test-count arithmetic (claimed 106/106 for `chat.test.js`, actually 107/107 once the iteration-1 fleet.js proof test is counted; claimed the full-suite delta was +8 against a stale baseline, measured delta against actual `main` is +5, matching the 5 new `test()` blocks the diff adds). --> FIXED (commit `5d37966`): corrected the plan file to the measured numbers.
- **Confirmed clean, no findings:** full em-dash sweep across the entire diff (zero hits), Codex/Claude branch separation re-verified by reading `classify()` directly, marker ordering, XSS/escaping (including the apostrophe-heavy strings on both the `esc()`+`innerHTML` path and the bare `.textContent` path), the `subscription.js` boundary (zero changes, no UI overclaiming), and non-vacuous test coverage (2100/2100 on the branch vs. 2095/2095 on `main`, a net +5 matching the diff's new `test()` blocks).

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | `test-support/fleet.js` | Missing `auth_failed` SCREEN entry, fixture couldn't route through real classifier | FIXED | `61abdee` |
| 2 | 1 | NIT | `web/index.html` `busyRow`/`stateReason` | Apparent entity-vs-plain-apostrophe inconsistency | INVESTIGATED, not a bug (comment added) | `61abdee` |
| 3 | 1 | NIT | `web/index.html` | Visual-language split confirmation | No action, already deliberate | n/a |
| 4 | 2 | BUG | `web/index.html` `busyRow` | `&mdash;` em dash in rendered UI copy, violates house rule | FIXED | `248296c` |
| 5 | 2 | NIT | `web/index.html` ~13862 | Stale "only rate_limited has one" comment | FIXED | `248296c` |
| 6 | 3 | NIT | `engine/chat.js:606-608` | Double vs. single quote inconsistency | FIXED | `5d37966` |
| 7 | 3 | NIT | `web.reply-where.test.js:166-172` | Assertion messages worded backwards | FIXED | `5d37966` |

### NITs (non-blocking, across all iterations)
- [NIT] `test-support/fleet.js` — missing `auth_failed` SCREEN entry (iteration 1)
- [NIT] `web/index.html` `busyRow`/`stateReason` — apparent punctuation inconsistency, investigated and confirmed correct (iteration 1)
- [NIT] `web/index.html` ~13862 — stale comment not updated for `auth_failed` (iteration 2)
- [NIT] `engine/chat.js:606-608` — quote-style inconsistency (iteration 3)
- [NIT] `web.reply-where.test.js:166-172` — backwards assertion messages (iteration 3)

### Strengths (across all iterations)
- New `AUTH_FAILED_MARKERS` captured directly from the real live pane text (not guessed), matching this file's own "observed half by observing" discipline (iteration 1, 2, 3 reviewers all independently verified this).
- Codex/Claude branch separation in `classify()` re-verified by direct code reading (not just trusting the existing pinned test) in both iteration 2 and iteration 3 — the two branches genuinely cannot collide by construction.
- Escaping/XSS correctness verified end-to-end (raw pane evidence text through `esc()` before `innerHTML`) in both iteration 2 and iteration 3.
- `subscription.js` out-of-scope boundary held cleanly across all three iterations: zero changes to that file, no UI copy anywhere overclaims that Settings > Accounts is now live-verified.
- Non-vacuous test coverage: every new test asserts specific state/confidence/evidence values with explicit negative controls (a healthy pane, and the pre-existing Codex-401 fixture), not just "no crash."

## Validation

- Full local test suite: `node --test engine/*.test.js *.test.js` — 2100 passed, 0 failed (final commit `5d37966`).
- Canonical validation helper (`validation_log_run_or_skip`): PASSED for stack=typescript, hash `7b53cd40bc838ba6...` (matches this proof's `diff_hash`).
- Subdir CLAUDE.md audit: passed (no subdir CLAUDE.md files touched by this branch's diff).
