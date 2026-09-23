---
pre_challenge: true
method: challenge-loop
branch: connlost-autorecover-3410
diff_hash: 507d534b6e194e25a85d6991a73170f85d8ea5279864c5c4073b1f0adb0a5e7e
validation: passed
subdir_audit: passed
timestamp: 2026-09-23T16:25:53Z
iterations: 11
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11 (multi-model: 6 opus + 5 sonnet blind passes, alternating)
**Converged:** Yes (iteration 11 found zero new findings)
**Total findings:** 3 BLOCKERs, 6 WARNINGs, ~10 NITs (1 CONVENTION), several STRENGTHs
**Fixed:** all BLOCKERs/WARNINGs and every NIT except 1 | **Deferred:** 1 (DM busy indicator) | **Asked:** 0

Change: #3410 runtime piece (PR 1, surfacing-only) -- classify a transient network error
(ENOTFOUND / "reach the API server" etc., byte-exact from the installed Claude Code 2.1.280
bundle formatter) as a new `connection_lost` state instead of the opaque `unknown` ("Can't
tell"), surface it on the board (label + human card sentence + chat waiting-note), make it
stand over a stale self-report (reconcileReport rule-3b analog), and ask-on-exit in heartbeat.
The auto-restart self-heal is a documented follow-on PR (PR 2) with captured-retry + freshness
prerequisites recorded in the plan.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT
**Self-generated:** 0 (ITER_COMMITS empty; findings on pre-loop branch commits = BRANCH)
- [BLOCKER] status.js reconcileReport -- scraped connection_lost had no rule and was masked by a
  self-report (fresh working -> WORKING, stale -> UNKNOWN, idle -> IDLE) for the Kosmos-managed
  target population --> FIXED (rule-3b analog: stands over any report + conflict note; 3 tests)
- [BLOCKER] status.js:2029 -- doc comment claimed a conflict that never fired --> FIXED (by the rule above + comment corrected)
- [WARNING] status.js precedence -- retry-chrome premise is a PR-2 restart prerequisite --> documented + plan HARD PREREQUISITE
- [CONVENTION] web attn-count comment stale --> FIXED
- [NIT] version-pinned detector strings --> noted (inherent to classifier)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 2 NITs
- [WARNING] CONNECTION_LOST_MESSAGE missing /i (fleet's most-repeated false-zero class) --> FIXED
- [NIT] hand-rolled row-strip vs shared matchedLine --> FIXED (use matchedLine)
- [NIT] no human card sentence --> FIXED (taskLine "Looks like it lost its internet connection")

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 WARNING, 1 CONVENTION, 2 NITs
- [WARNING] straight-apostrophe fragility (same class as em-dash) --> FIXED (key on "reach the API server"; curly-apostrophe test added)
- [CONVENTION] refreshStartAffordance comment predicted pres:'off'+Reconnect --> FIXED (reconciled to pres:'on')
- [NIT] CONTROL 1 comment inaccurate re glyph strip --> FIXED
- [NIT] plan em dashes --> FIXED (swept prose, kept vendor lines)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 3 NITs
- [WARNING] stateReason "only 2 speak" comment now false --> FIXED
- [NIT] heartbeat classify-states enumeration missing connection_lost --> FIXED
- [NIT] test reused EAI_AGAIN under two shapes --> FIXED (neutral placeholder)
- [NIT] DM busy indicator (paintBusy) silent for connection_lost --> DEFERRED (matches rate_limited; verified NOT a false "is working"; auth_failed's line was #874-bug-driven)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 WARNING, 1 NIT
- [WARNING] no recovery-freshness signal (stale error after recovery reads connection_lost) --> documented; sharpened PR-2 bound (connectivity probe necessary but not sufficient)
- [NIT] Codex network wedge reads UNKNOWN (Claude-only) --> documented as deliberate scope

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs
- [WARNING x2] STATE_COPY + CARD_ST comments described the unbuilt self-heal in present tense --> FIXED (hedged to "follow-on PR, not built here")

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 NIT
- [NIT] "CARD_ST maps only needs_you to st:'attn'" stale (needs_trust too) --> FIXED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs
- [BLOCKER] ERR_PROXY_TUNNEL omitted from the regex, yet the docblock claimed full switch coverage; corporate-proxy wedge stayed "Can't tell" --> FIXED (added "connect through your proxy" + fixture + docblock)
- [WARNING] StreamSuspended ("...asleep") unhandled --> documented as deliberate exclusion (own wake-resume path)
- [WARNING] chat.js waitingNote missing connection_lost case --> FIXED (mirrors rate_limited/auth_failed; test added)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 1 NIT
- [NIT] exclusion doc named StreamSuspended but not StreamNoResponse --> FIXED (documented; correctly left UNKNOWN)

#### Iteration 10
**Reviewer model:** sonnet ("No blockers or warnings found. Well-scoped, thoroughly cross-checked.")
**New findings:** 1 NIT
**Self-generated:** 1 ("what Xwe can emit" was on my iter-9 loop commit)
- [NIT] opaque "Xwe" formatter-symbol reference --> FIXED (references the already-introduced "error formatter")

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0
**Converged** -- "No issues found. The change is sound."

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status |
|---|------|----------|------|--------|-------------|--------|
| 1 | 1 | BLOCKER | status.js reconcileReport | BRANCH | scraped connection_lost masked by self-report | FIXED |
| 2 | 1 | BLOCKER | status.js:2029 | BRANCH | doc comment claims a conflict that never fired | FIXED |
| 3 | 1 | WARNING | status.js precedence | BRANCH | retry-chrome premise (PR-2 restart prereq) | DOCUMENTED |
| 4 | 1 | CONVENTION | web/index.html attn-count | BRANCH | stale "SIX states" count | FIXED |
| 5 | 1 | NIT | status.js | BRANCH | version-pinned strings (inherent) | NOTED |
| 6 | 2 | WARNING | status.js:2035 | BRANCH | regex missing /i | FIXED |
| 7 | 2 | NIT | status.js connectionLost | BRANCH | hand-rolled vs matchedLine | FIXED |
| 8 | 2 | NIT | web taskLine | BRANCH | no human card sentence | FIXED |
| 9 | 3 | WARNING | status.js:2035 | BRANCH | apostrophe Unicode fragility | FIXED |
| 10 | 3 | CONVENTION | web:24114 | BRANCH | pres:'off'+Reconnect prediction | FIXED |
| 11 | 3 | NIT | test | SELF | CONTROL 1 comment re glyph strip | FIXED |
| 12 | 3 | NIT | plan | SELF | em dashes in prose | FIXED |
| 13 | 4 | WARNING | web stateReason | SELF | "only 2 speak" now false | FIXED |
| 14 | 4 | NIT | heartbeat.js:13 | BRANCH | classify-states enumeration | FIXED |
| 15 | 4 | NIT | test | SELF | EAI_AGAIN reused two shapes | FIXED |
| 16 | 4 | NIT | web paintBusy | BRANCH | DM indicator silent | DEFERRED (matches rate_limited) |
| 17 | 5 | WARNING | status.js:3826 | BRANCH | recovery-freshness (PR-2 bound) | DOCUMENTED |
| 18 | 5 | NIT | status.js | BRANCH | Codex scope gap | DOCUMENTED |
| 19 | 6 | WARNING | web STATE_COPY | BRANCH | present-tense self-heal claim | FIXED |
| 20 | 6 | WARNING | web CARD_ST | BRANCH | present-tense self-heal claim | FIXED |
| 21 | 7 | NIT | web:38261 | BRANCH | "only needs_you attn" stale | FIXED |
| 22 | 8 | BLOCKER | status.js:2048 | BRANCH | ERR_PROXY_TUNNEL missing + false coverage claim | FIXED |
| 23 | 8 | WARNING | status.js | BRANCH | StreamSuspended unhandled | DOCUMENTED |
| 24 | 8 | WARNING | chat.js:982 | BRANCH | waitingNote missing connection_lost | FIXED |
| 25 | 9 | NIT | status.js:2043 | BRANCH | StreamNoResponse not in exclusion doc | FIXED |
| 26 | 10 | NIT | status.js:2017 | SELF | opaque "Xwe" reference | FIXED |

### Deferred (with reasoning)
- **#16 DM busy indicator (paintBusy/busyRow) silent for connection_lost.** paintBusy gates the
  "is working..." line to `working`/`auth_failed`, so connection_lost yields nothing rather than a
  false "is working" (verified -- no #874 recurrence). Left silent to MATCH rate_limited
  (connection_lost's actual pack-shape sibling, also silent there); auth_failed's special line was
  driven by the specific #874 report. Adding it would make connection_lost inconsistent with
  rate_limited. One-line follow-up (mirror auth_failed's arm) if a real report shows it is needed.

### PR-2 prerequisites recorded (not this PR)
- The precedence premise (an in-flight retry draws live working chrome) is COSMETIC for PR 1 but
  LOAD-BEARING for the auto-restart: capture a real retry sequence before PR 2 restarts on this state.
- connection_lost has no freshness signal (unlike auth_failed's #1930 liveAuth guard), so a stale
  error line after recovery can read connection_lost; a connectivity probe is necessary but NOT
  sufficient for PR 2 -- it also needs a "still actually wedged" bound.

### Strengths (across iterations)
- Byte-exact detector strings pulled from the installed bundle (not guessed); SSL/cert class
  correctly excluded (colon vs period/paren form); regex Unicode-safe (em-dash + apostrophe free)
  and case-insensitive matching its sibling marker sets.
- Precedence placement is the safety hinge: below every live-working check, above the idle/UNKNOWN
  fallbacks -- an actively-retrying agent stays WORKING; a wedged pane stops reading "Can't tell".
- reconcileReport rule-3b analog correctly stands over a stale report (not the rate-limit
  "fresh wins" exception) -- the fix that made the feature reach its own target population.
- Consistent wiring across every state-coupling site the suite guards; correct exclusion from
  self-report paths; non-vacuous test controls throughout; no em dashes in any shipping string.
</content>
