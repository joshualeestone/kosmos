---
pre_challenge: true
method: challenge-loop
branch: mention-4642
diff_hash: 99895e4430bd55a038fce02af6ad203e0b5a1e4e23040ab94039bafc90761026
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T21:30:14Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6, blind, reviewer model alternating opus and sonnet.
**Converged:** Yes. Iteration 6 raised no new BLOCKER, WARNING or CONVENTION: its three warnings repeat ledger rows 8, 9 and 11, each already resolved or deferred with reasons.
**Total findings:** 12 actionable (0 BLOCKERs, 12 WARNINGs, 0 CONVENTIONs), NITs listed per iteration
**Fixed:** 9 | **Deferred:** 3 | **Asked (awaiting user):** 0

**Validation, stated because it departs from the skill:** this account has no pre-challenge hook, so the loop was run by hand and says so. Per-iteration validation was the focused files (engine/messages*.test.js, web.mention-*.test.js, server.projects.test.js, server.test.js, the web files that render room bodies), because the full suite is a heavy run allowed only on Liu Kang's "Scorpion go" (m3616). The full validation ran once, on the converged HEAD, under heavy-gate --twice --quiet-box with who-has-the-box clear, with the agent identity cleared (see run 2 below): `tools/run-tests.sh` directly, NOT the validation-log helper (the helper would have run the same suite a second time on a shared box). Result: run 2 (21:12:58Z to 21:29:47Z, KOSMOS_AGENT_SESSION, KOSMOS_AGENT_TOKEN and TMUX_PANE unset, printed unset in the run record): exit 0; node 12153 tests, 11937 pass, 0 fail, 0 cancelled, 216 skipped; the shell chain ran to its last stage (test-tunnel-handshake-gate 57 passed); board-watchdog-2955 0 failures; subdir audit clean; tree clean after. Run 1 (21:04Z) is not counted: I unset the wrong variables, so board-watchdog-2955 went red (#4619, also red on clean main) and stopped the shell chain; its node tally was the same (0 fail). Browser check render-mention-blue-2922: 177/177 passed (21:11Z, the page loaded from disk, so run 1 variables do not reach it). render-room-reply-3745 (changed here: one case) was not in the go and has not run: it is named in the PR for the reviewer's run or a second go.

**Mutations (by hand, each restored and the file compared after):** engine: ambiguity to first match, dropping the roster room filter, dropping the two-character floor, prefix matching, optional @; page: ambiguity, the charset limit, the floor, prefix matching, filtering before resolving, no addressed filter; parity: ambiguity, a truncated key; server: the served `mentioned` removed. Each turned its control red.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:54574, 56902, 55742 - the page's three matchers still exact-case; blue and Reply disagree with the engine --> FIXED (94dc681e6: pjMentionResolve shared, pjMentionKeys a Map)
- [WARNING] engine/messages.js:1575 - stale "Names match exactly" comment --> FIXED (94dc681e6)
- [WARNING] engine/messages.js:1593 - collision promoted both members, called "safe" wrongly --> FIXED (94dc681e6: exact wins, otherwise unique only; ambiguous addresses nobody)
- [WARNING] engine/messages.mention-4642.test.js - out-of-room roster alias and collision untested --> FIXED (94dc681e6)
- [NIT] accents stripped as letters --> FIXED (NFKD) ; [NIT] "All"-style names --> FIXED (comment) ; [NIT] plan's hand-run mutations --> FIXED (plan says by hand)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above (both about code written in 94dc681e6)
- [WARNING] engine/messages.js:1323 / web/index.html:56935 - display-name sources could differ --> FIXED (ed0f07eca: traced, both are safeRoster() card `name`; named at both sites)
- [WARNING] engine/messages.js:1335 - an ambiguous mention demotes silently --> FIXED in part (ed0f07eca: `ambiguousMentions` on the post row); the sender notice is row 11
- [NIT] per-post alias map cost --> DEFERRED (room sizes) ; [NIT] stale "Set" wording --> FIXED ; [NIT] duplicated normalisation --> DEFERRED (the page must stay liftable; the parity test guards it)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] web/index.html:55909 - old posts repaint blue under the wider rule --> FIXED (7e68eddf4: the room API serves the recorded `mentioned`; the page paints from it)
- [WARNING] engine vs page ambiguity populations differ (gone agents) --> DEFERRED: safe direction (composer plain, engine delivers; the posted message then paints from the record); documented in the plan
- [NIT] test comment named `resolveMention` --> FIXED ; [NIT] old #2922 comment --> FIXED ; [NIT] duplicate roster cards --> documented in plan ; [NIT] hard-coded browser-check floor --> FIXED (derived from positives)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
**Duplicates of prior findings (confirmed resolved):** 1 (ambiguity not surfaced to the sender, row 6)
- [WARNING] web/index.html:55915 - a pre-#185 row reads `[]` and loses its blue --> DEFERRED: the engine omits the field when empty, so an old row and a nobody row cannot be told apart; plain is the safe direction; measured 0 of 221 posts on a real board (detector control 12 of 12); documented in server.js and the plan (c5935ea95)
- [NIT] sender's own display name --> FIXED (test, c5935ea95) ; [NIT] memoise norm --> DEFERRED ; [NIT] wordy comments --> DEFERRED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above (both about 7e68eddf4)
- [WARNING] web/index.html:55920 - filtering the keys before resolving let an ambiguous token paint blue --> FIXED (b0a869f24: pjMentionAddressed filters after resolving)
- [WARNING] web.mention-parity-4642.test.js - the posted path's ambiguity case untested --> FIXED (b0a869f24: unit case plus browser-check case)
- [NIT] tier-2 guard redundant --> no change ; [NIT] per-token norm cost --> DEFERRED ; [NIT] exact-case protection gone --> FIXED (comment)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 3 (rows 11, 9, 8) plus 1 NIT (alias-map cost)
- [NIT] tier list documented twice --> no change ; [NIT] pjReplyMention resolves without `addressed` on purpose --> no change
**Converged** - no new actionable findings.

### Final Ledger
| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:54574 | BRANCH | page matchers exact-case | FIXED | 94dc681e6 |
| 2 | 1 | WARNING | engine/messages.js:1575 | BRANCH | stale comment | FIXED | 94dc681e6 |
| 3 | 1 | WARNING | engine/messages.js:1593 | BRANCH | collision promoted both | FIXED | 94dc681e6 |
| 4 | 1 | WARNING | engine/messages.mention-4642.test.js | BRANCH | roster and collision untested | FIXED | 94dc681e6 |
| 5 | 2 | WARNING | engine/messages.js:1323 | SELF | display-name sources | FIXED | ed0f07eca |
| 6 | 2 | WARNING | engine/messages.js:1335 | SELF | ambiguity silent | FIXED (logged) | ed0f07eca |
| 7 | 3 | WARNING | web/index.html:55909 | BRANCH | old posts repaint | FIXED | 7e68eddf4 |
| 8 | 3,6 | WARNING | engine vs page populations | SELF | gone agents skew ambiguity | DEFERRED | safe direction, documented |
| 9 | 4 | WARNING | web/index.html:55915 | SELF | pre-#185 rows plain | DEFERRED | indistinguishable; 0 of 221 measured |
| 10 | 5 | WARNING | web/index.html:55920 | SELF | filter before resolve | FIXED | b0a869f24 |
| 11 | 2,4,6 | WARNING | engine/messages.js:1338 | SELF | sender not told of ambiguity | DEFERRED | follow-up named in the plan |
| 12 | 5 | WARNING | web.mention-parity-4642.test.js | SELF | posted path untested | FIXED | b0a869f24 |
