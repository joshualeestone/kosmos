---
pre_challenge: true
method: challenge-loop
branch: guidemask-4733
diff_hash: 46ece14622d33819e34c7cc70656af5d94320af05035786814210c446c624842
validation: PASSED (CI-starved rule, path D3 plus C). Full suite on Mortals of 3ddc94593 ran to the end: FAILS: 0, Done in 6300.67s (its validation-log entry was not recorded: I stopped the local wrapper at 15:41 before the run could record; the suite itself was not stopped). 443953c72 and c4cca2214 on top: focused 63 files 1733 of 1733. Main moved into server.js since the base: merge-tree clean, and on the merged tree (fc006ce1e + this branch) the 64 focused files pass, 1750 of 1750.
subdir_audit: not run (the diff changes no subdirectory CLAUDE.md)
timestamp: 2026-09-30T20:47:13Z
iterations: 11
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 11 reviewer passes (opus, sonnet, opus, sonnet, opus, sonnet, fable, sonnet, fable, opus, opus). 1 to 9 were before the rebase onto main; 10 and 11 review what the rebase brought (main's new report field `final`)
**Converged:** Yes, twice: at iteration 7, and again at iteration 9 after main moved under the branch and one comment had to change
**Total findings:** 1 BLOCKER, 16 WARNINGs, 0 CONVENTIONs, about 25 NITs
**Fixed:** 15 | **Deferred:** 2 | **Asked (awaiting user):** 0

Spawn failures, not counted as iterations: three opus spawns died on HTTP 529 (two in a row at iteration 7,
one at iteration 9). Never three in a row: the next spawn went to another model (fable), which is why
iterations 7 and 9 are fable and not opus.

The commit ids below are the branch's ids AFTER its rebase onto origin/main 6ea3ebf56 (the rebase came between
iterations 7 and 8, when #4491 slice 4, #4739, landed). Iterations 1 to 7 reviewed the same commits under their
earlier ids.

Origin column: every finding through iteration 6 cited lines the branch itself had written, in the first
commit or in a fix. I did not run the blame lookup on them; the SELF marks below are my reading of which
commit wrote the line.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [BLOCKER] server.js:12922 - a report field that is not a string skipped the mask (guideMasked returns a non-string as it came) and the store then made text of it, key and all --> FIXED (e797fbc29): the guide's value is made text before it is masked
- [WARNING] server.js:12919 - `project` is a fourth free-text field of a report and was not masked --> FIXED (e797fbc29)
- [WARNING] plan:41 - "a status report is replaced by the guide's next one" is false for what is stored (the file is appended to), and the post route writes the carried fields again unmasked --> FIXED (e797fbc29): the plan says what is on disk, and the carried fields are masked
- [WARNING] server.guide-mask-4733.test.js:144 - the fourth test's title claimed a non-string arm it never sent --> FIXED (e797fbc29): it now sends lists, with a control

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js:17085 - the mask runs before the message limit, so a text the mask lengthens could be refused --> DEFERRED in this round on a false claim of mine ("masking never makes a text longer"); corrected in iteration 3
- [WARNING] server.js:12930 - the mask-before-cap order had no test --> FIXED (29df5a425): a key straddling the 1000-character cap, with a control that shows the store cuts another agent's report inside the key

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the plan sentence, written in iteration 2's fix)
- [WARNING] plan:55 - "masking never makes a text longer" is false (a short password in a link; the whole-message sentence) --> FIXED (05b3ad40d): the plan says so, and records the decision to leave the refusal
- [WARNING] server.js:16984 - the limits are now judged on the masked text, with no test at the limit --> FIXED (05b3ad40d): a note and a message exactly at their limits, with a control
- [WARNING] server.guide-mask-4733.test.js:148 - no assertion for a list-valued `project` --> FIXED (05b3ad40d)
- [WARNING] server.js:17088 - the pane-named arm of both task routes had no test --> FIXED (05b3ad40d)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js:17088 - a caller that claims the screen is taken as the person and is not masked, with no test --> FIXED (3206b506d): a test pins that the person's own words are never changed; the plan names the limit
- [WARNING] server.js:15346 - the bulk close route writes a free-text note unmasked (screen only today) --> FIXED (3206b506d): named under the plan's weakest premise

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the plan sentence)
- [WARNING] plan:68 - "the old line is no longer shown" is wrong for `project`, which the reader carries forward --> FIXED (1f30db857)
- [WARNING] server.js:12933 - the mask scans the whole text before any length bound, on the board's one thread --> DEFERRED, on a measurement: 6 MB scans in 235 to 421 ms in four shapes. (A ceiling was built in 1f30db857 and taken out in 06df282b4 once the numbers were in.)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the ceiling's own test)
- [WARNING] server.guide-mask-4733.test.js:296 - the ceiling test pinned a process-wide stub's whole call list and could flake --> FIXED by removing the ceiling and its test (06df282b4)

#### Iteration 7
**Reviewer model:** fable (two opus spawns failed first, HTTP 529)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings. Then main moved: #4739 landed, the branch was rebased (clean), and one
sentence of #4739's new comment, which said these three writes are NOT masked and named this card, was changed
to say they are (79a706937). That is a change after convergence, so the loop ran on.

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the task message comment)
- [WARNING] server.js:17179 - the site's comment named only the unidentified caller as unmasked, not the one that claims the screen --> FIXED (e68692a95)
- [WARNING] server.js:17179 - a paneless token caller's card carries the safeKey spelling of its name; if that differed from the guide's the mask could be skipped --> DEFERRED: `isSetupGuide` resolves any spelling through `instructions.fileFor`, which applies `store.safeKey`, so both spellings reach the same folder and marker; an agent name is one `safeKey` does not change. Read, not tested with such a name

#### Iteration 9
**Reviewer model:** fable (one opus spawn failed first, HTTP 529)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

#### Iteration 10 (after the rebase onto main, which added the report field `final`, #4612)
**Reviewer model:** opus (blind, fresh; scoped to the post-rebase delta)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (both are about main's new field meeting this branch)
- [WARNING] server.js /api/report - `final.text` masked before the store removes control characters, so a key split by one kept part of itself in the clear and the store joined it back --> FIXED (443953c72): selfreport exports `finalTextClean`, masked after it; test with `\u0007` (mutation fails)
- [WARNING] server.js owes.unsent - the thread served the guide's stored answer unmasked (one stored before this merges) --> FIXED (443953c72): masked as read; test through the thread route with a control (mutation fails)
- [NIT] project-create `done`/`description` stored unmasked --> recorded in the plan's Not covered (the guide cannot reach that route)

#### Iteration 11
**Reviewer model:** opus (blind, fresh; scoped to 443953c72)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- [NIT] test cleanup ran only when the test passed, so a failure leaked into the next test --> FIXED (c4cca2214): cleanup in `finally`; with the read fix removed, exactly one test fails
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | server.js:12922 | BRANCH | non-string report field stored unmasked | FIXED | e797fbc29 |
| 2 | 1 | WARNING | server.js:12919 | BRANCH | report `project` not masked | FIXED | e797fbc29 |
| 3 | 1 | WARNING | plan:41 | BRANCH | false about what stays on disk; carried fields re-written unmasked | FIXED | e797fbc29 |
| 4 | 1 | WARNING | test:144 | BRANCH | test title claimed an arm it did not send | FIXED | e797fbc29 |
| 5 | 2 | WARNING | server.js:17085 | BRANCH | a masked text can exceed the limit | FIXED | decided and pinned, 05b3ad40d |
| 6 | 2 | WARNING | server.js:12930 | BRANCH | mask-before-cap order untested | FIXED | 29df5a425 |
| 7 | 3 | WARNING | plan:55 | SELF | "never longer" is false | FIXED | 05b3ad40d |
| 8 | 3 | WARNING | server.js:16984 | BRANCH | no test at the limits | FIXED | 05b3ad40d |
| 9 | 3 | WARNING | test:148 | BRANCH | list-valued project not asserted | FIXED | 05b3ad40d |
| 10 | 3 | WARNING | server.js:17088 | BRANCH | pane arm untested | FIXED | 05b3ad40d |
| 11 | 4 | WARNING | server.js:17088 | BRANCH | screen-claiming caller unmasked, untested | FIXED | 3206b506d |
| 12 | 4 | WARNING | server.js:15346 | BRANCH | bulk close note unmasked (screen only) | FIXED | named in the plan, 3206b506d |
| 13 | 5 | WARNING | plan:68 | SELF | wrong for a carried `project` | FIXED | 1f30db857 |
| 14 | 5 | WARNING | server.js:12933 | BRANCH | scan before any length bound | DEFERRED | measured: under 0.5 s for 6 MB |
| 15 | 6 | WARNING | test:296 | SELF | ceiling test could flake | FIXED | removed with the ceiling, 06df282b4 |
| 16 | 8 | WARNING | server.js:17179 | SELF | comment understated who is unmasked | FIXED | e68692a95 |
| 17 | 8 | WARNING | server.js:17179 | BRANCH | safeKey spelling of the sender's name | DEFERRED | both spellings reach the same folder (read) |

### Deferred, so they can be overridden
- #14: the mask scans before the length limit. Left on a measurement; the plan says what would change the call.
- #17: a differently spelled sender name. Left on a reading of `isSetupGuide`; not tested with such a name.
- Not a ledger entry but the same kind of call: a guide text exactly at a length limit can be refused after
  masking (the mask can add characters). Left as a refusal, pinned by a test.

### NITs (non-blocking, the ones not taken)
- [NIT] server.js:2992 - for the guide, the guide check runs again for each field inside guideMasked (iterations 4, 7, 8, 9)
- [NIT] server.js:12975 - the report route now does the guide-folder check on every agent's heartbeat (iterations 5, 9)
- [NIT] server.js:12973 - "each field selfreport stores as text" is slightly wider than the code: `instance` is text too and comes from the token, not the body (iteration 9)
- [NIT] test:223 - a token that resolves with no roster row (the paneless shape) has no masked case (iterations 5, 7)
- [NIT] CLAUDE.md:93 - the "work on the setup guide" row does not mention the mask (iteration 7)
- [NIT] plan:101 - the community post and comment routes also authenticate by agent token but sit behind the board token, and are not named (iteration 9)
- [NIT] server.js:12931 - a guide report whose project is masked lights no project (iterations 3, 4); accepted in the plan

### Strengths (across all iterations)
- No path in the three handlers lets the unmasked text out: every reviewer traced them and found none (all iterations)
- The mask runs before the store caps a field, and the test's control proves the cut it guards against really happens (iterations 3, 5, 7, 9)
- Every masked arm has a control from another agent that can return the dangerous answer (iterations 1 to 9)
- The second write of the same report (the post route's carry) was found and masked, with a test that proves the second write happened (iterations 2, 3, 5, 7)
- The plan names its own limits and records the claim it got wrong (iterations 3, 5, 7, 8, 9)
