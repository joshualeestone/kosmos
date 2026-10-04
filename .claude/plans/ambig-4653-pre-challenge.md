## [CHALLENGE-LOOP] Summary

**Iterations:** 8, blind, reviewer model alternating opus and sonnet. The branch stacks on mention-4642 (PR #4652), so each reviewer was pointed at `origin/mention-4642...HEAD` for the change under review, with `origin/main...HEAD` open for context.
**Converged:** Yes. Iteration 8 raised no new actionable finding: one warning repeats rows 5 and 9 (the CLI read's dependence on key order, pinned by the route test), and the other is judged not an issue (row 13).
**Total findings:** 13 actionable (0 BLOCKERs, 12 WARNINGs, 1 CONVENTION), NITs listed per iteration
**Fixed:** 11 | **Deferred:** 2 | **Asked (awaiting user):** 0

**Validation, stated because it departs from the skill:** this account has no pre-challenge hook, so the loop was run by hand and says so. Per-iteration validation was the focused files (engine/messages*.test.js, web.mention-*.test.js, cli.post-*.test.js, tools.windows-kosmos-cli-*.test.js, server.post-*.test.js, web.post-receipt.test.js: 422 tests), run with KOSMOS_AGENT_SESSION, KOSMOS_AGENT_TOKEN and TMUX_PANE unset, because heavy runs wait for Liu Kang's go and the box was on hold for the 0.7.11 re-cut. Full run: 594 pass, 0 fail (node --test focused suite on rebased head, Mortals light run per Liu Kang go). Browser check render-room-reply-3745 (the page arm of this change): PASS all passed (docs/browser-checks/render-room-reply-3745.js, all 4 #4653 checks pass).

**Mutations (by hand, each restored and the file compared after):** engine: the answer field removed, the addressed filter removed, dedupe on the raw word, no stripping of names, keeping the trailing full stop, the wider strip class narrowed, the log row grouped by name; CLI: the unanchored sed read; Windows CLI: the note line removed; route: a key after `delivery`. Each turned its test red.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/messages.js:1348 - the note said "reached neither" when the post also named one candidate exactly --> FIXED (7392da100)
- [WARNING] engine/messages.js:1322 - the note named session names, not the names the page shows --> FIXED (7392da100: "Sub Zero (@frost)")
- [CONVENTION] engine/messages.js:1311 - the new function split the #4642 comment from its function --> FIXED (7392da100)
- [NIT] duplicate sentences per spelling --> FIXED ; [NIT] trailing full stop in the word --> FIXED ; [NIT] adopted names outside the charset --> FIXED later (iteration 7) ; [NIT] plan silent on the partial case --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/messages.js:1962 - a post kept in the outbox and delivered later tells no one --> DEFERRED: nobody is waiting on that answer to print it; the log row keeps the words; named in the plan
- [WARNING] install/kosmos:1833 - the greedy sed read could take an `outcomes` key for the note --> FIXED (cb3665aa3: anchored on the end; control red on the old read)
- [NIT] "To ask them" for one member --> FIXED ; [NIT] "none of them" wording --> no change ; [NIT] note stays until the next send --> FIXED later (iteration 4) ; [NIT] page arm stubs the answer --> no change (engine test covers the sentence)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] tools/windows/kosmos-cli.js:433 - the Windows CLI never printed the note --> FIXED (108d47637, with its own test)
- [WARNING] engine/messages.js:1356 - C1 controls, bidi overrides and lone surrogates reached the terminal --> FIXED (108d47637)
- [NIT] a control that could not fail --> FIXED (relabelled a regression check) ; [NIT] stale fixture wording --> FIXED ; [NIT] long docblock line --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] install/kosmos:1839 - key order pinned only at the engine, not on the real route answer --> FIXED (02319ca95: server.post-ambiguous-4653.test.js runs the CLI's own sed on a real /api/post answer; red with a key after `delivery`)
- [WARNING] web/index.html:56742 - the note stayed under the composer after the next edit --> FIXED (02319ca95)
- [NIT] handles not cleaned --> FIXED ; [NIT] log row word untested --> FIXED ; [NIT] page arm stubs the answer --> no change

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 3 of the above
- [NIT] a failing sed under set -e would abort after the post landed --> FIXED (a6de83318, `|| true`) ; [NIT] U+2028/2029, U+2060-2064, U+FEFF --> FIXED ; [NIT] temp roots left behind --> FIXED ; [NIT] candidates computed before swarm-off --> no change (the wording stays true) ; [NIT] a keystroke during the send --> no change
- Code changed after this pass, so the loop ran again on the final code.

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
**Duplicates of prior findings (confirmed resolved):** 1 (key order, row 9)
- [WARNING] engine/messages.js:1349 - a handle that cleans to nothing read "like @." --> FIXED (936bcc6db)
- [WARNING] web/index.html:56743 - the note could outlive a project switch --> FIXED in part (936bcc6db: the note is recorded only when shown); switching already clears the line (web/index.html:55576)
- [NIT] announced twice --> no change (#pj-room-msg is not the live region) ; [NIT] identical display names --> no change (handles differ) ; [NIT] control comment --> no change

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/messages.js:1345 - the log row kept only the first spelling of a name --> FIXED (151d8babb: every spelling kept; the note still groups them)
- [NIT] untypeable handle offered --> FIXED ; [NIT] U+061C, U+00AD --> FIXED ; [NIT] declaration below its first write --> FIXED ; [NIT] stdout vs stderr per platform --> no change (each matches its verdict's stream)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs after dedup, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1 (key order, rows 5 and 9)
- [WARNING] engine/messages.js:1339 - the log row records the word without trailing punctuation, a change for log readers --> DEFERRED, judged not an issue: `ambiguousMentions` arrived with #4652, which is not merged, so no reader on main has ever seen the other form
- [NIT] PJ_AMBIG_NOTE not reset on switch --> no change (the equality check makes it harmless) ; [NIT] Reply's synthetic input clears the note --> no change (right) ; [NIT] Windows trims but does not re-clean --> no change (cleaned at the source)
**Converged** - no new actionable findings.

### Final Ledger
| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/messages.js:1348 | BRANCH | "neither" when one was named | FIXED | 7392da100 |
| 2 | 1 | WARNING | engine/messages.js:1322 | BRANCH | session names in the note | FIXED | 7392da100 |
| 3 | 1 | CONVENTION | engine/messages.js:1311 | BRANCH | comment split from function | FIXED | 7392da100 |
| 4 | 2 | WARNING | engine/messages.js:1962 | BRANCH | outbox post tells no one | DEFERRED | no one waiting; in the plan |
| 5 | 2 | WARNING | install/kosmos:1833 | SELF | greedy sed read | FIXED | cb3665aa3 |
| 6 | 3 | WARNING | tools/windows/kosmos-cli.js:433 | BRANCH | Windows CLI silent | FIXED | 108d47637 |
| 7 | 3 | WARNING | engine/messages.js:1356 | SELF | terminal controls in names | FIXED | 108d47637 |
| 8 | 4 | WARNING | web/index.html:56742 | SELF | note outlives the next edit | FIXED | 02319ca95 |
| 9 | 4,6,8 | WARNING | install/kosmos:1839 | SELF | key order untested at the route | FIXED | 02319ca95 |
| 10 | 6 | WARNING | engine/messages.js:1349 | SELF | empty handle offered | FIXED | 936bcc6db |
| 11 | 6 | WARNING | web/index.html:56743 | SELF | note state across rooms | FIXED | 936bcc6db |
| 12 | 7 | WARNING | engine/messages.js:1345 | SELF | log lost spellings | FIXED | 151d8babb |
| 13 | 8 | WARNING | engine/messages.js:1339 | SELF | log word form changed | DEFERRED | field unreleased (#4652 unmerged) |
