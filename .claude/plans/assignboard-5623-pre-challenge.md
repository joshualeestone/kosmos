---
pre_challenge: true
method: challenge-loop
branch: assignboard-5623
diff_hash: 00009eaa925ed603120e97245fa2400573a6688c7165d5c26734ad7f315d7a89
validation: passed
subdir_audit: passed
timestamp: 2026-10-09T06:40:50Z
iterations: 19
converged: true
---

## [CHALLENGE-LOOP] Summary

Rebase note (2026-10-09 02:55 CDT): rebased from base df34da6b4 onto main 8445eb829 (208 commits) with no conflicts.
The added and removed lines are byte-identical before and after (sha256 of the -U0 +/- lines, 7454fa5fb4d4b778, both
sides); only context in server.js and engine.reachable.test.js moved. diff_hash updated to the rebased diff; was
832804c90e79. CI re-runs the full suite on the rebased tree before merge.

**Iterations:** 19
**Converged:** Yes (iteration 19 had nothing new above NIT)
**Total findings:** 57 (1 BLOCKERs, 24 WARNINGs, 3 CONVENTIONs, 29 NITs)
**Fixed:** 36 | **Deferred (stated or left, with reasons):** 21 | **Asked (awaiting user):** 0

Counting note: each row is one plan bullet per category it names; a bullet that groups several NITs counts once. The
full wording of every finding and its resolution is in .claude/plans/assignboard-5623.md (the review log), which this proof summarises.
Self-generated: not recorded per iteration (no blame lookup was run); later reviews did find defects in my own
earlier fixes and comments, and the plan says so where it happened.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 1 BLOCKERs, 2 WARNINGs, 1 CONVENTIONs, 1 NITs
**Self-generated:** not recorded
- [BLOCKER] the single-post line typed the person's post title into the trusted "Kosmos here" line; a title is the person's own words and could read as the board's (slice A refused the person's name for the same reason). The line names the post id only; the agent reads... --> FIXED
- [WARNING] a 404 read as "nothing assigned" and would have dropped every open assignment and its told history on a rolled-back service, a proxy or a wrong address. A 404 is now unreadable: nothing settles, the board is inert until the route answers. Test through sweep... --> FIXED
- [WARNING] /sent's `kind` is in unansweredFor's doc and pinned for Rule 1 rows too; the header doc names Rule 2's record keys; the require sits after node:'s; the plural line says "for each id in"; ASSIGNMENTS_MAX's oldest-first reliance is commented; the plan's reque... --> FIXED
- [CONVENTION] /sent's `kind` is in unansweredFor's doc and pinned for Rule 1 rows too; the header doc names Rule 2's record keys; the require sits after node:'s; the plural line says "for each id in"; ASSIGNMENTS_MAX's oldest-first reliance is commented; the plan's reque... --> FIXED
- [NIT] /sent's `kind` is in unansweredFor's doc and pinned for Rule 1 rows too; the header doc names Rule 2's record keys; the require sits after node:'s; the plural line says "for each id in"; ASSIGNMENTS_MAX's oldest-first reliance is commented; the plan's reque... --> FIXED

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 1 NITs
**Self-generated:** not recorded
- [WARNING] , with a matching change in the service half (review 18 there): - an expired assignment left the record and so vanished from /sent at the moment it was known unanswered. The service now returns `settled: [{post_id, reason}]` (the agent's closures in the las... --> FIXED
- [NIT] assignments stay out of the regular comment-told record (P30); the assignment read counts toward the pacing gap. --> FIXED

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not recorded
- [WARNING] the stale "the list is the record / leaving it settles / 404 is nothing assigned" wording in the docs and the plan's first half (rewritten as built); an expiry's log line gave "told 3 times" for any count (it now says the window passed and the real count); ... --> FIXED
- [NIT] the pacing gap follows only an assignment read that asked the service; a hostile author name cannot forge the person mark (authorOf strips the brackets; test). --> FIXED
- [NIT] FRAME_OPEN/FRAME_CLOSE still say "other agents' public writing"; the rule inside the frame says a person's post is marked, which governs. --> DEFERRED (left in the plan, with the reason)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not recorded
- [WARNING] the managed block's "picked to answer" sentence sat before the --reply-to rule and read as if covered by it; it now follows it and says "(no --reply-to)". An `answered` closure aged out of the service's 24 h settled window, so an agent idle a day kept an an... --> FIXED
- [NIT] "placed" in the seen docs; /sent's and unansweredFor's docs say an expired post can appear after fewer than three tells; ASSIGNMENTS_MAX reasons from OPEN_MAX; openAssignments' return doc complete; the plural line says "posts by people" (one person can writ... --> FIXED
- [NIT] the seen POST holds the agent's call slot briefly after its line is placed; a community command the agent runs in that moment is told to try again. --> DEFERRED (left in the plan, with the reason)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NITs
**Self-generated:** not recorded
- [WARNING] the plan's Decisions line still said the open list is the record (only `settled` settles); the heading says after which review it is true. An assignment that expired before any tell reached the agent was marked unanswered ("told 0 times") and listed in /sen... --> FIXED
- [WARNING] an UNCONFIRMED line counts as a tell on the board but is not reported seen, so after three unconfirmed tells the board lists an unanswered person the service does not count as that agent's silence. The board's report is the cautious side (a person may be wa... --> DEFERRED (stated in the plan, with the reason)
- [NIT] no test that a busy or local result adds no pacing gap; FRAME_OPEN/CLOSE wording (stated at review 3). --> DEFERRED (left in the plan, with the reason)

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 1 NITs
**Self-generated:** not recorded
- [WARNING] a person's post carried "a person wrote this", which the managed block defines as "always owed an answer" (Rule 1's mark for a person's comment), so every agent reading the feed would take every person's post as owed and pile on the pick. A post now reads "... --> FIXED
- [NIT] the dead 404 branch is gone (any non-200 is unreadable and changes nothing; only `settled` settles); the return doc's `asked` is optional; the header lists every way an assignment leaves the record; the record's docs name assignments; the two long log lines... --> FIXED

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 1 NITs
**Self-generated:** not recorded
- [WARNING] RULE_TAIL typed the post mark as a literal while a comment claimed it was shared; PERSON_POSTED is now defined before RULE_TAIL and built into it, and the managed block takes it from the read (test). The managed block now says a post so marked is owed only ... --> FIXED
- [NIT] the client header's density; the assignment read for every agent with a record (stated cost). --> DEFERRED (left in the plan, with the reason)

#### Iteration 8
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 1 NITs
**Self-generated:** not recorded
- [WARNING] the sweep-level 404 test could not fail once only `settled` settles anything (a misread 404 drops nothing either way); deleted. The client test still pins that a 404 or any non-200 is unreadable. --> FIXED
- [NIT] stale "it would settle every assignment" messages; the client header names the never-told expiry; `asked`'s doc says it may over-report; `isPost` in unansweredFor; the as-built heading. --> FIXED

#### Iteration 9
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not recorded
- [WARNING] the docs said a `kind: 'post'` row means the window passed; an assignment is also marked unanswered after PERSON_TELLS tells, as a comment is (both docs now say both ways). A post answered after it expired stayed unanswered on the board for 14 days: the ser... --> FIXED
- [NIT] the block test renders blockBody() instead of grepping source; the client header and the `asked` doc rewritten and split. --> FIXED
- [NIT] no test for the 3-tell mark on an assignment, more than ASSIGNMENTS_MAX rows, or a thrown read (all go through paths tested for comments or by the unreadable arm); a plain "a person posted this" in a name is cosmetic (the trusted form is parenthesised, whic... --> DEFERRED (left in the plan, with the reason)

#### Iteration 10
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 1 NITs
**Self-generated:** not recorded
- [WARNING] the assignment read and the seen report go through communitysend's chain (shared with the send sweep and every agent's own community command), so during a long send sweep each counted agent's read waited the full AGENT_WAIT_MS (20 s). agentCall now takes `w... --> FIXED
- [NIT] /sent's comment names both unanswered paths; personsUpdate's doc names assignments and the settled reasons; a 'gone' reason test (P46); the assignment read follows freshReplies' last request without its own pace gap (stated: one more request, well under the... --> FIXED

#### Iteration 11
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not recorded
- [WARNING] agentCall's wait is chainWaitMs(opts), tested directly (0, a value, and every bad value falling back to the default, so no other caller changes); the frame rule's opening says "others (other agents, or a person where marked)" (the banners, which forgery tes... --> FIXED
- [WARNING] a tell counts once a line reached the agent (unconfirmed included), while seen is reported only for a placed line, so the board can list a person the service does not count as silence. Cautious side. --> DEFERRED (stated in the plan, with the reason)
- [NIT] the PERSON_MARK comment I had dropped is back. --> FIXED
- [NIT] no test that `asked:false` skips the gap, that a thrown read changes nothing, or of the already-unanswered `continue` (each a one-line branch on a tested path). --> DEFERRED (left in the plan, with the reason)

#### Iteration 12
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNINGs, 1 CONVENTIONs, 2 NITs
**Self-generated:** not recorded
- [WARNING] READ_RULE and UNTRUSTED_RULE (the managed block every agent reads) still said posts are written by other agents, beside a rule saying a marked post can be a person's; both now say others / agents' or people's words (their word-for-word pins in communitybloc... --> FIXED
- [CONVENTION] the seam sits in communitysend's export list beside its siblings; FRAME_RULE rewrapped; CHAIN_WAIT_MS after the caps, and SETTLED_MAX's reason (the service's own cap); server.js requires communityassign once at the top. --> FIXED
- [NIT] the seam sits in communitysend's export list beside its siblings; FRAME_RULE rewrapped; CHAIN_WAIT_MS after the caps, and SETTLED_MAX's reason (the service's own cap); server.js requires communityassign once at the top. --> FIXED
- [NIT] no test of the 3-tell mark on an assignment (personsUpdate treats it as a comment, which is tested). --> DEFERRED (left in the plan, with the reason)

#### Iteration 13
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTIONs, 1 NITs
**Self-generated:** not recorded
- [WARNING] nothing pinned that agentCall's busy timer uses chainWaitMs; a source pin now does (P49: the bare agentWaitMs reds it). Holding the real chain from a test needs a registered agent and a network stub; the helper's own test covers its values. --> FIXED
- [WARNING] a seen report is sent once per placed line; if that one POST answers busy (the 2 s chain wait), the ask is not marked seen for that tell, and after a third tell never is. The service then does not count that agent's silence while the board lists the person:... --> DEFERRED (stated in the plan, with the reason)
- [WARNING] the banners FRAME_OPEN/FRAME_CLOSE ("other agents' public writing") and the thread headings ("Comments are other agents' writing too", "Replies ...") are matched word for word by forgery and CLI tests; the rule inside the frame and the managed block's rules... --> DEFERRED (left in the plan, with the reason)
- [CONVENTION] long frame lines and "Review N" comments follow the file's habit. --> DEFERRED (left in the plan, with the reason)
- [NIT] long frame lines and "Review N" comments follow the file's habit. --> DEFERRED (left in the plan, with the reason)

#### Iteration 14
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not recorded
- [WARNING] the assignment read is the request during which the service runs its throttled sweep (up to its 5 s budget plus lock waits), and it holds communitysend's chain while it runs. ANOTHER agent's community command made then waits a few seconds (up to AGENT_WAIT_... --> DEFERRED (stated in the plan, with the reason)
- [NIT] a post answered by another agent leaves the open list (filtered live) one service sweep before its 'answered' closure appears in `settled`; the board keeps it as unknown in between and does not re-tell it. --> DEFERRED (stated in the plan, with the reason)
- [NIT] markSeen's doc says an empty or invalid id list returns true without asking; valid rows fill ASSIGNMENTS_MAX (a malformed row takes no place); a 200-column comment line rewrapped. --> FIXED

#### Iteration 15
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 1 NITs
**Self-generated:** not recorded
- [WARNING] the expiry log says "a line sent N times" (a line counted as told may have been unconfirmed); a comment says the expiry mark edits this pass's copy of the record (readPersons returns a fresh object), so a failed write is redone next pass; a test of the PERS... --> FIXED
- [NIT] the source pin on chainWaitMs is literal by design (it says so); the plan's review log is long; the frame line's width follows the file. --> DEFERRED (left in the plan, with the reason)

#### Iteration 16
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** not recorded
- [WARNING] my review-14 note said the agent's own command made during the read "waits"; for the same agent agentCall answers busy at once (only other agents wait). The note now says so. --> FIXED
- [NIT] "no tell was ever recorded" in the docs of the never-told expiry (a recorded tell may be unconfirmed). --> FIXED
- [NIT] several agents picked for the same post on one board each list it in /sent when it expires (one row per agent: which agent left the person unanswered). --> DEFERRED (stated in the plan, with the reason)
- [NIT] long lines and comment alignment follow the file. --> DEFERRED (left in the plan, with the reason)

#### Iteration 17
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not recorded
- [WARNING] the chainWaitMs test compared bad values with the helper's own default, so a broken default would pass; it now compares with the exported AGENT_WAIT_MS (and pins that omitting waitMs keeps it). --> FIXED
- [NIT] the managed block's "Read other agents' posts" line says "posts (other agents', or a person's where marked)" (its pin updated); chainWaitMs's doc names agentWaitMs. --> FIXED
- [NIT] the seen POST goes on every placed tell (the service ignores repeats); trimming it to the first tell would save at most two requests per ask. --> DEFERRED (left in the plan, with the reason)

#### Iteration 18
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** not recorded
- [WARNING] the short-wait test compared CHAIN_WAIT_MS with itself; it also asserts it is below AGENT_WAIT_MS. --> FIXED
- [WARNING] the service ran its throttled sweep inside this GET, which could pass the board's 5 s request timeout (the read then aborts and that agent waits a pass); the service now runs that sweep in the background (the service half's review 29), so the GET answers at... --> FIXED
- [NIT] the 3-tell log says "had a line sent 3 times" (as the expiry line); a tautological assert removed (the rule is built from the constant). --> FIXED
- [NIT] the server.js seams are exercised only by reading (every test injects them; signatures checked). --> DEFERRED (left in the plan, with the reason)

#### Iteration 19
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NITs
**Self-generated:** not recorded
- [NIT] one long doc line; `asked` missing counted as asked (stated); a vague `&&` assertion message; a person's reply inside a Following-feed entry's reply list carries no mark (the frame rule says the marked form governs). --> DEFERRED (left in the plan, with the reason)
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | Description | Status |
|---|------|----------|-------------|--------|
| 1 | 1 | BLOCKER | the single-post line typed the person's post title into the trusted "Kosmos here" line; a title is the person' | FIXED |
| 2 | 1 | WARNING | a 404 read as "nothing assigned" and would have dropped every open assignment and its told history on a rolled | FIXED |
| 3 | 1 | WARNING | /sent's `kind` is in unansweredFor's doc and pinned for Rule 1 rows too; the header doc names Rule 2's record  | FIXED |
| 4 | 1 | CONVENTION | /sent's `kind` is in unansweredFor's doc and pinned for Rule 1 rows too; the header doc names Rule 2's record  | FIXED |
| 5 | 1 | NIT | /sent's `kind` is in unansweredFor's doc and pinned for Rule 1 rows too; the header doc names Rule 2's record  | FIXED |
| 6 | 2 | WARNING | , with a matching change in the service half (review 18 there): - an expired assignment left the record and so | FIXED |
| 7 | 2 | NIT | assignments stay out of the regular comment-told record (P30); the assignment read counts toward the pacing ga | FIXED |
| 8 | 3 | WARNING | the stale "the list is the record / leaving it settles / 404 is nothing assigned" wording in the docs and the  | FIXED |
| 9 | 3 | NIT | the pacing gap follows only an assignment read that asked the service; a hostile author name cannot forge the  | FIXED |
| 10 | 3 | NIT | FRAME_OPEN/FRAME_CLOSE still say "other agents' public writing"; the rule inside the frame says a person's pos | DEFERRED |
| 11 | 4 | WARNING | the managed block's "picked to answer" sentence sat before the --reply-to rule and read as if covered by it; i | FIXED |
| 12 | 4 | NIT | "placed" in the seen docs; /sent's and unansweredFor's docs say an expired post can appear after fewer than th | FIXED |
| 13 | 4 | NIT | the seen POST holds the agent's call slot briefly after its line is placed; a community command the agent runs | DEFERRED |
| 14 | 5 | WARNING | the plan's Decisions line still said the open list is the record (only `settled` settles); the heading says af | FIXED |
| 15 | 5 | WARNING | an UNCONFIRMED line counts as a tell on the board but is not reported seen, so after three unconfirmed tells t | DEFERRED |
| 16 | 5 | NIT | no test that a busy or local result adds no pacing gap; FRAME_OPEN/CLOSE wording (stated at review 3). | DEFERRED |
| 17 | 6 | WARNING | a person's post carried "a person wrote this", which the managed block defines as "always owed an answer" (Rul | FIXED |
| 18 | 6 | NIT | the dead 404 branch is gone (any non-200 is unreadable and changes nothing; only `settled` settles); the retur | FIXED |
| 19 | 7 | WARNING | RULE_TAIL typed the post mark as a literal while a comment claimed it was shared; PERSON_POSTED is now defined | FIXED |
| 20 | 7 | NIT | the client header's density; the assignment read for every agent with a record (stated cost). | DEFERRED |
| 21 | 8 | WARNING | the sweep-level 404 test could not fail once only `settled` settles anything (a misread 404 drops nothing eith | FIXED |
| 22 | 8 | NIT | stale "it would settle every assignment" messages; the client header names the never-told expiry; `asked`'s do | FIXED |
| 23 | 9 | WARNING | the docs said a `kind: 'post'` row means the window passed; an assignment is also marked unanswered after PERS | FIXED |
| 24 | 9 | NIT | the block test renders blockBody() instead of grepping source; the client header and the `asked` doc rewritten | FIXED |
| 25 | 9 | NIT | no test for the 3-tell mark on an assignment, more than ASSIGNMENTS_MAX rows, or a thrown read (all go through | DEFERRED |
| 26 | 10 | WARNING | the assignment read and the seen report go through communitysend's chain (shared with the send sweep and every | FIXED |
| 27 | 10 | NIT | /sent's comment names both unanswered paths; personsUpdate's doc names assignments and the settled reasons; a  | FIXED |
| 28 | 11 | WARNING | agentCall's wait is chainWaitMs(opts), tested directly (0, a value, and every bad value falling back to the de | FIXED |
| 29 | 11 | WARNING | a tell counts once a line reached the agent (unconfirmed included), while seen is reported only for a placed l | DEFERRED |
| 30 | 11 | NIT | the PERSON_MARK comment I had dropped is back. | FIXED |
| 31 | 11 | NIT | no test that `asked:false` skips the gap, that a thrown read changes nothing, or of the already-unanswered `co | DEFERRED |
| 32 | 12 | WARNING | READ_RULE and UNTRUSTED_RULE (the managed block every agent reads) still said posts are written by other agent | FIXED |
| 33 | 12 | CONVENTION | the seam sits in communitysend's export list beside its siblings; FRAME_RULE rewrapped; CHAIN_WAIT_MS after th | FIXED |
| 34 | 12 | NIT | the seam sits in communitysend's export list beside its siblings; FRAME_RULE rewrapped; CHAIN_WAIT_MS after th | FIXED |
| 35 | 12 | NIT | no test of the 3-tell mark on an assignment (personsUpdate treats it as a comment, which is tested). | DEFERRED |
| 36 | 13 | WARNING | nothing pinned that agentCall's busy timer uses chainWaitMs; a source pin now does (P49: the bare agentWaitMs  | FIXED |
| 37 | 13 | WARNING | a seen report is sent once per placed line; if that one POST answers busy (the 2 s chain wait), the ask is not | DEFERRED |
| 38 | 13 | WARNING | the banners FRAME_OPEN/FRAME_CLOSE ("other agents' public writing") and the thread headings ("Comments are oth | DEFERRED |
| 39 | 13 | CONVENTION | long frame lines and "Review N" comments follow the file's habit. | DEFERRED |
| 40 | 13 | NIT | long frame lines and "Review N" comments follow the file's habit. | DEFERRED |
| 41 | 14 | WARNING | the assignment read is the request during which the service runs its throttled sweep (up to its 5 s budget plu | DEFERRED |
| 42 | 14 | NIT | a post answered by another agent leaves the open list (filtered live) one service sweep before its 'answered'  | DEFERRED |
| 43 | 14 | NIT | markSeen's doc says an empty or invalid id list returns true without asking; valid rows fill ASSIGNMENTS_MAX ( | FIXED |
| 44 | 15 | WARNING | the expiry log says "a line sent N times" (a line counted as told may have been unconfirmed); a comment says t | FIXED |
| 45 | 15 | NIT | the source pin on chainWaitMs is literal by design (it says so); the plan's review log is long; the frame line | DEFERRED |
| 46 | 16 | WARNING | my review-14 note said the agent's own command made during the read "waits"; for the same agent agentCall answ | FIXED |
| 47 | 16 | NIT | "no tell was ever recorded" in the docs of the never-told expiry (a recorded tell may be unconfirmed). | FIXED |
| 48 | 16 | NIT | several agents picked for the same post on one board each list it in /sent when it expires (one row per agent: | DEFERRED |
| 49 | 16 | NIT | long lines and comment alignment follow the file. | DEFERRED |
| 50 | 17 | WARNING | the chainWaitMs test compared bad values with the helper's own default, so a broken default would pass; it now | FIXED |
| 51 | 17 | NIT | the managed block's "Read other agents' posts" line says "posts (other agents', or a person's where marked)" ( | FIXED |
| 52 | 17 | NIT | the seen POST goes on every placed tell (the service ignores repeats); trimming it to the first tell would sav | DEFERRED |
| 53 | 18 | WARNING | the short-wait test compared CHAIN_WAIT_MS with itself; it also asserts it is below AGENT_WAIT_MS. | FIXED |
| 54 | 18 | WARNING | the service ran its throttled sweep inside this GET, which could pass the board's 5 s request timeout (the rea | FIXED |
| 55 | 18 | NIT | the 3-tell log says "had a line sent 3 times" (as the expiry line); a tautological assert removed (the rule is | FIXED |
| 56 | 18 | NIT | the server.js seams are exercised only by reading (every test injects them; signatures checked). | DEFERRED |
| 57 | 19 | NIT | one long doc line; `asked` missing counted as asked (stated); a vague `&&` assertion message; a person's reply | DEFERRED |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

