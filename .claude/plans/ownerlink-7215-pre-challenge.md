---
pre_challenge: true
method: challenge-loop
branch: ownerlink-7215
diff_hash: 03b95d473cc7d4f103e078f2ede39a19aee468a12ab915cef2420e59c0e3cf82
validation: passed
subdir_audit: passed
timestamp: 2026-10-30T21:58:20Z
iterations: 38
converged: true
---

## Rebases after convergence (2026-10-30)

The branch was rebased twice onto kosmos main with no code change of its own; each resolution was re-checked by Raiden
by content (COMMENT reviews on the PR), and the loop's record below is unchanged.

- **fe33bf74fc** (onto 5680fd51b1, about 850 commits): two conflicts. `engine/phonenotify.js` module.exports: main's
  line with `plusLive` added. `tools/test-connector-verbs.sh` caller list: main's `companycommunity.js` (kosmos#7541)
  and this branch's `communitysend.js`, both reason paragraphs kept, fifteen entries.
- **68a5dcf133** (onto current main, 83 more commits): one conflict, the same caller list: main's
  `personalbackupkey.js` (kosmos#7404) added beside the others, sixteen entries, the count word sixteen. The asserted
  list equals the real `grep -l macRequest(` output.

**Final validation at 68a5dcf133:** a queued heavy turn on the box ending 16:57 CDT 2026-10-30.
`validation_log_run_or_skip` ran the full suite, 25913 tests, 25493 pass, 0 fail, 420 skipped (the platform's own
skips), and PASSED (hash 03b95d473cc7, this file's diff_hash); the subdir CLAUDE.md audit passed. Before it, at the
same head: communityowner-7215 42/42, engine.reachable 8/8, connector-verbs 27/27. This replaces the earlier
"full suite left to CI" line: the suite has now run clean locally.

## [CHALLENGE-LOOP] Summary

**Iterations:** 38 (reviewers alternated opus and sonnet: opus on odd iterations, sonnet on even)
**Converged:** Yes, at iteration 38 on 96fe311ca1 (zero new BLOCKER/WARNING/CONVENTION). It had converged at 22 and 24
too. After the PR opened, CI found a guard the loop had missed (tools/test-connector-verbs.sh), and the fix reopened the
loop for iterations 25-38, which found real defects in most rounds.
**Total findings:** 237 new (1 BLOCKER, 81 WARNINGs, 16 CONVENTIONs, 139 NITs), counting the CI miss as a WARNING
**Fixed:** 117 | **Deferred:** 40 | **Duplicate:** 15 | **No action:** 65 | **Asked (awaiting user):** 0
**Self-generated:** about 45 of 111 in iterations 1-16 (an estimate; rule in that section); not counted after.
**A correction:** iteration 21's WARNING (a coordinator 400 member_key_wrong_epoch is about this computer) rested on a
wrong reading of the coordinator; iteration 37 found that refusal belongs to the backup member-key route only, and the
arm and its test were removed.
**Out of this branch:** iteration 33's WARNING (what owner view covers after a computer leaves Kosmos+) is a site and
coordinator decision; it is tracked on kosmos-relay #602, by number only.

**Tests at 0e61b7047e (rebased on origin/main e40f95e4de):** engine/communityowner-7215.test.js 42/42 and engine.reachable.test.js
pass; the 85 test files that load communitysend or phonenotify or read remote.js: 1852 pass, 15 skipped, 0 fail;
tools/test-connector-verbs.sh 27/27. Earlier related runs in iterations 31, 36 and 37 each had one red outside this
change (remote.test.js #3827 kill-timing x2, remote-typedallow-6590 c3, backupscan #5686 regex timing), each green
alone; recorded per iteration below.

**Negative controls, each red:** the busy check after the mint; the resume at the budget check; the limiter 429 arm;
the limiter skip before the mint; 408 as the service; the deployment rule (both directions); the host rule against an
exact compare and against a trailing dot; the 204-only rule; the k.refused skip after the site call; the 503 with no
Retry-After; the test-runner guard (39 of 40 red without the seam); plus the eight from iterations 1-24 (wrong epoch,
since removed; pre-mint retiring; 429 exclusion; site 404 hour; throw as per-agent; both log-once guards; the finally save).

**Final validation (6j), stated as it is:** the full suite (tools/run-tests.sh) at fac74c0e56 (an older main): 24436
tests, 1 fail outside this diff (engine/fedseats.test.js #5193 timing, 217/217 alone). Two later local runs were
refused by the machine queue's time bound while other agents' suites and relay builds held the box. CI on PR #7294 at
ef81b4a493: node, shell 2/2, macOS, windows, scope and linux-setup passed; shell 1/2 failed on the connector-verbs
guard, fixed in da7ec5185f. The full suite at this head is left to CI, and a local run when the box is quiet.
Rebased twice after the reviews (the last to clear a one-line conflict with #7308's reformatted remote.js exports);
the branch's own diff is otherwise identical to 96fe311ca1's, checked by diffing the two change sets.

**Note on commit ids:** ids below are those at the time each round was written; the branch was rebased after, and each
change is in the current branch under the same subject.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 (first round)
- [WARNING] engine/communitysend.js:1335-1366 — one agent refused for good blocks every agent after it (every failure breaks the pass, next pass restarts at the same agent) --> FIXED (1f4787001c [aef3ee1a]: a 400/403 about one agent skips that agent; service failures pause the pass)
- [WARNING] engine/communitysend.js:1323-1328 — the "unrecognized subcommand" arm of `ownerPassUnknown` can never match (`because` is the last stderr line); the plan claims an hour wait --> FIXED (1f4787001c: arm dropped and plan claim removed)
- [WARNING] engine/communitysend.js:1335 — retired (`retired:`) and being-retired agents are linked; `retireListUnreadable()` ignored --> FIXED (1f4787001c: skipped; fail-closed on an unreadable list)
- [WARNING] engine/communitysend.js:1342-1346 — a mint that was never sent (`notSent`) still pauses 15 min and logs an untrue "did not vouch"; coordinator 429 gets a flat 15 min --> FIXED (1f4787001c: `notSent` returns with no pause; the coordinator 429 stays 15 min, noted in the plan in 1c3649a204)
- [WARNING] engine/communityowner-7215.test.js — no tests for site 429 cap, refused-key path, removed agent, 30 s budget, head-of-line case --> FIXED partly (1f4787001c: "six tests for these paths"; the 429 cap, the 30 s budget and the removed-agent case were still reported untested in later rounds)
- [NIT] engine/communitysend.js:1341 — the new `macRequest` caller has no suite guard against reaching the production coordinator --> no action (not stated; raised again in iteration 7 and declined there)
- [NIT] engine/communitysend.js:1307 — `OWNER_LINK_RETRY_MS` is a mutable `let` while `OWNER_LINK_UNKNOWN_MS` is const; the reason lives only in the tests --> FIXED (1f4787001c; not stated, but the rewrite adds the comment "tests rely on it staying long")
- [NIT] engine/communitysend.js:1361 — a permanently refused agent is logged every 15 minutes with no once-only limit --> FIXED (1f4787001c; not stated, but the rewrite logs per-agent refusals once per reason)
- [CONVENTION] .claude/plans/ownerlink-7215.md — plan matches code except the "older tunnel waits an hour" claim --> FIXED (1f4787001c: claim removed)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1
- [WARNING] engine/communitysend.js:1357-1375 — marker computed before the awaits; a Forget and new sign-in mid-pass sends the old identity's pass (briefly links to the forgotten account) --> FIXED (1c3649a204 [291a6680]: mac id re-read after the mint, nothing sent if it changed; test added)
- [WARNING] engine/communityowner-7215.test.js (503 test) — `R.mints.length >= 2` would pass even if the pause were ignored --> FIXED (1c3649a204: counts mints exactly through the pause)
- [NIT] engine/communitysend.js:1319 — `ownerLinkLive` duplicates phonenotify's check --> no action (not stated at this round; resolved in iteration 4, f5c54e69d1, by reusing `plusLive`)
- [NIT] engine/communitysend.js:1303 — `let` vs `const` asymmetry; reviewer calls it fine --> no action (reviewer called it fine; not stated)
- [NIT] engine/communitysend.js:1365-1366 — the set-and-return-bool contract of `ownerLinkSkipAgent` is implicit (self: iter 1) --> FIXED (1c3649a204; not stated, but the fix adds a comment above `ownerLinkSkipAgent`)
- [CONVENTION] .claude/plans/ownerlink-7215.md — plan exists and matches --> no action (no issue)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 4
- [WARNING] engine/communitysend.js:1365 — every coordinator 400/403 treated as about one agent, but 403s (and `member_key_wrong_epoch`) are about the computer: one refused mint per agent every 15 min (self: iter 1) --> FIXED (223371555e [2ecc242d]: a coordinator 403 pauses the whole pass; only its 400 skips one agent; test added)
- [WARNING] engine/communityowner-7215.test.js — no test for the unreadable retire list or a name being retired; 30 s budget untested (self: iter 1) --> FIXED (223371555e: tests for the unreadable list and a name being retired; the budget was not tested until iteration 12)
- [WARNING] engine/communitysend.js:1349 — Community and Kosmos+ switches checked only at the start of the pass --> FIXED (223371555e: re-read after each mint; test for Community off mid-mint)
- [NIT] engine/communitysend.js:1331 — fixed pass order with no rotation; worth a comment saying why (self: iter 1) --> FIXED (223371555e; not stated, but the doc comment gained "so the order needs no rotation")
- [NIT] engine/communitysend.js:1340, 1380 — waits under a minute log as "0 min" (self: iter 1) --> FIXED (223371555e: `ownerLinkWait` logs seconds)
- [NIT] engine/communitysend.js:1323 — "the marker keeps a digest, never the key" overstates; keys.json holds the key anyway --> FIXED (223371555e; not stated, comment now says the digest only tells a new key from the old one)
- [NIT] engine/communityowner-7215.test.js:144 — odd unique-routes expression for checking mint routes --> FIXED (223371555e; not stated, replaced with `every(...)`)
- [NIT] engine/communityowner-7215.test.js (site 429 test) — Retry-After 99999 sent but the cap is never asserted --> no action (not stated; raised again in iterations 5, 7 and 9)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 CONVENTIONs, 3 NITs
**Self-generated:** 3
- [WARNING] engine/communitysend.js:1402-1406 — any site status not named (409, 410, 422) falls through to a pass-wide pause: head-of-line blocking again (self: iter 1) --> FIXED (f5c54e69d1 [28dcbfad]: any site 4xx other than 401/404/405/429 skips one agent; 422 test)
- [WARNING] engine/communitysend.js:1392 — a lost reply sends a second pass, safe only if the site's owner route is idempotent --> DEFERRED: safe under the agreed site contract (latest pass wins, relinking the same account changes nothing); recorded in the plan
- [CONVENTION] .claude/plans/ownerlink-7215.md — plan filename has no timestamp, as CLAUDE.md requires --> FIXED (f5c54e69d1: renamed to ownerlink-7215-20261026.md)
- [CONVENTION] engine/communitysend.js:1317-1319 — `ownerLinkLive()` copies phonenotify's `plusLive()` (two derivations of one fact) --> FIXED (f5c54e69d1: `plusLive` exported and reused)
- [NIT] engine/communitysend.js:1334-1335 — block comment sits above `ownerLinkWait`, not the function it describes (self: iter 3) --> FIXED (f5c54e69d1; not stated, the comment was moved)
- [NIT] engine/communitysend.js:1389-1390 — the 30 s budget is checked only before each agent; the comment overstates it --> no action (not stated; same point fixed as a reword in iteration 6)
- [NIT] engine/communitysend.js:1394 — a stale `ownerLinkRetrying` can stay on disk; harmless (self: iter 1) --> no action (not stated; the field was moved to memory in iteration 6)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 4
- [WARNING] engine/communitysend.js:1370 — `retiring(agentKey)` not re-checked after the mint; a delete begun during it still gets linked (self: iter 2/3, the post-mint guard) --> FIXED (a6496927af [41c1c241]: retire list and `retiring` re-read after the mint; test added)
- [WARNING] engine/communityowner-7215.test.js:376 — the Kosmos+ half of the post-mint switch guard has no test (self: iter 3) --> FIXED (a6496927af: twin test)
- [WARNING] engine/communitysend.js:1356 — an agent refused for good is re-asked every 15 min forever (about 96 mints a day); cost not stated (self: iter 1) --> DEFERRED: documented as an accepted cost in the doc comment and plan rather than adding a backoff that could not be tested cleanly
- [NIT] engine/communitysend.js:1305 — doc comment line far past the block's width, edited in place (self: iter 4) --> FIXED (a6496927af: re-wrapped)
- [NIT] engine/communityowner-7215.test.js:285 — site 429 cap still untested --> no action (not stated)
- [NIT] engine/communitysend.js:1374 — `ok: true` mint with no `data.pass` arm has no test --> no action (not stated)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 2
- [WARNING] engine/communitysend.js:1364-1366 — the 30 s budget is not a bound on the pass; comment says "share of one sweep" --> FIXED (bb2b21c26e [a89c7068]: comment reworded to "no new agent is started after this long")
- [WARNING] engine/communitysend.js:1372-1373 — persisted `ownerLinkRetrying` log mark is never cleared on a key change, can survive into a new registration (self: iter 1) --> FIXED (bb2b21c26e: mark kept in memory; refusals no longer write keys.json)
- [WARNING] engine/communitysend.js:1368-1376 — minted pass is not checked against the agent; relies on the site's check --> DEFERRED: by design, the site contract does that check
- [NIT] engine/communitysend.js:1370 — `notSent` early return relies on `finally` to save earlier marks; correct as written (self: iter 1) --> no action (reviewer called it correct; not stated)
- [NIT] engine/communitysend.js:1318-1331 — doc comment long and repeats the plan --> no action (not stated)
- [CONVENTION] engine/communitysend.js:1337 — `_ownerLinkRetry` follows the `_installGroupRetry` pattern; consistent --> no action (no issue)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 3
- [WARNING] engine/communitysend.js:1394-1411 — pass-wide failure arms have no rotation, so one agent failing that way starves the rest; header's "needs no rotation" is only true for per-agent arms (self: iter 3 comment, iter 1 design) --> FIXED (c4cbfa1430 [4c320be7]: resume index `ownerLinkFrom` / `stopHere()`, as the install-group pass; test added)
- [WARNING] engine/communitysend.js:1744-1746 — the owner pass runs before new pictures, which are public --> FIXED (c4cbfa1430: moved after `sweepAvatars`; pictures comment corrected)
- [NIT] engine/communitysend.js:1374 — no suite guard on `macRequest` under test --> no action: a guard keyed on the test environment would also block these tests' stubbed calls
- [NIT] engine/communityowner-7215.test.js:285-293 — 429 cap untested; per-agent `ownerLinkLogged` dedupe untested (self: iter 6) --> no action (not stated)
- [NIT] engine/communitysend.js:1380 — `retireListUnreadable() ||` redundant beside `retiring()`; harmless (self: iter 5) --> no action (not stated)
- [NIT] engine/communitysend.js:1313 — mutable `OWNER_LINK_RETRY_MS` left changed after tests; `beforeEach` restores it --> no action (reviewer called it fine; not stated)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 3
- [WARNING] engine/communitysend.js:1383 — `stopHere()` not called on the `notSent` and post-mint early returns, so earlier agents are re-minted (self: iter 7) --> DEFERRED: does not happen, agents ahead are either linked (skipped by marker) or in their own per-agent wait
- [WARNING] engine/communitysend.js:1380 — a key rotated during the mint gets the old key's marker recorded --> FIXED (702aad6473 [ea6c2e50]: marker recorded only if it still matches the current key; this check was removed in iteration 9 as unable to fire)
- [WARNING] engine/communitysend.js:1394-1396 — a persistent site 401 after a successful re-login pauses the whole pass each time --> DEFERRED: the board cannot tell it from a failed re-login; the iteration-7 rotation bounds it; recorded in the plan as accepted
- [NIT] engine/communitysend.js:1292-1316 — doc comment long, repeats the plan --> no action (not stated)
- [NIT] engine/communitysend.js:1323 — "tests rely on it staying long" is a test-coupling note on a production constant; harmless (self: iter 1) --> no action (not stated)
- [CONVENTION] .claude/plans/ownerlink-7215-20261026.md — plan matches; cites "review iteration" numbers, process history inside a plan (self: iter 1 to 7 plan edits) --> no action (not stated)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 3
- [WARNING] engine/communityowner-7215.test.js:250-272 — two (orchestrator found several) tests cannot pass as written: `registered()` sweeps with Kosmos+ on, so agents are linked before the refusal is set (self: iter 1/3 tests) --> FIXED (09ae2bc010 [f4056b8d]: `registered()` keeps Kosmos+ off during its own sweep)
- [WARNING] engine/communitysend.js:1356-1426 — the pass holds the `exclusive()` lock agents' commands wait on; worst case about a minute, worst on first rollout --> FIXED (09ae2bc010: at most 5 mints per sweep)
- [NIT] engine/communitysend.js:1404-1405 — the iteration-8 "key replaced" check cannot fire (self: iter 8) --> FIXED (09ae2bc010: removed, and its plan decision)
- [NIT] engine/communitysend.js:1414-1418 — site 404/405 arm does not call `stopHere()` unlike siblings (self: iter 7) --> FIXED (09ae2bc010: comment says why)
- [NIT] engine/communityowner-7215.test.js — untested arms: 401 surviving re-login, coordinator 429 / malformed mint, 429 cap --> no action at this round (not stated; the 401 arm got a test in iteration 11)
- [NIT] engine/communityowner-7215.test.js:157 — "marker is a digest" check is weak --> FIXED (09ae2bc010: asserts the exact `mac-1:` + sha256 prefix)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 3 NITs
**Self-generated:** 3
- [WARNING] engine/communitysend.js:1331 — the 30 s budget break does not save the resume index, so later agents can starve (self: iter 7) --> FIXED (e29f01156e [id not quoted]: budget stop and the 5-mint cap resume at the agent not yet tried, `resumeHere()`; cap test now checks the sixth mint is the sixth agent)
- [WARNING] engine/communitysend.js:1357 — a coordinator 404 pauses everything for an hour even if about one name --> DEFERRED: by design, the coordinator has no notion of individual agents, so its 404 can only mean the route is missing
- [WARNING] engine/communitysend.js:1380 — a site 429 Retry-After capped at 300 s, so the board may ask before the stated wait --> DEFERRED: by design, matches registration's cap
- [NIT] engine/communitysend.js:1292 — doc comment about 25 lines with review history (self: loop's doc edits) --> no action (not stated)
- [NIT] engine/communitysend.js:1307 — "tests rely on it staying long" is cryptic --> no action (not stated)
- [NIT] engine/communitysend.js:1383 — 401-after-re-login handling correct but subtle --> no action (not stated)
- [CONVENTION] engine/communitysend.js:1292 — doc comment carries mechanics, not intent (self: loop's doc edits) --> no action (not stated)
- [CONVENTION] CLAUDE.md "Where to Find Things" — community row does not name the owner link or its test --> FIXED (e29f01156e: one sentence added)

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 4
- [WARNING] CLAUDE.md:104 — the new owner-link clause was inserted so the next sentence's "there" points at the wrong file (self: iter 10) --> FIXED (b806999da4 [f62af2ec]: clause moved after the mineComments sentence)
- [WARNING] engine/communityowner-7215.test.js — untested: 401 whose re-login gets no answer; the 30 s budget; "a removed agent is linked" --> FIXED for the 401 arm (b806999da4: test added); DEFERRED for the budget (no clock seam in the file; done in iteration 12) and the removed agent (no code path to test: the pass never reads the removed list)
- [NIT] engine/communitysend.js:1389-1391 — one step can hold the `exclusive` lock past `AGENT_WAIT_MS` --> no action (not stated)
- [NIT] engine/communitysend.js:1396-1398 — coordinator "route unknown" arm still advances the resume index, unlike the site arm (self: iter 7) --> FIXED (b806999da4: no `stopHere()` when the route is unknown)
- [NIT] engine/communitysend.js:1398 — the hourly "cannot vouch yet" line will be logged 24 times a day per board until the relay ships --> no action at this round (not stated; fixed in iteration 15)
- [NIT] engine/communitysend.js:1305-1307 — JSDoc implies a restart ends the retries (self: iter 5) --> FIXED (b806999da4: "a board restart only resets the wait")
- [NIT] engine/communitysend.js:1365 — the numeric resume index points at a different agent if the key set changes; harmless (self: iter 7) --> no action (not stated)
- [CONVENTION] .claude/plans/ownerlink-7215-20261026.md — plan present and matches --> no action (no issue)

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 1
- [WARNING] engine/communitysend.js:1320 — the 30 s budget and its resume path never run in any test (no clock seam) --> FIXED (46e7e6dea0 [cc3240ac]: `_ownerLinkBudget` seam and a test)
- [WARNING] engine/communitysend.js:1384-1388 — early returns leave `ownerLinkFrom` unchanged; the no-starvation guarantee covers only the `break` paths (self: iter 7) --> DEFERRED: the reviewer itself calls the behaviour fine
- [NIT] engine/communitysend.js:1303-1318 — long block comment, per-line comments repeat the code --> no action (not stated)
- [NIT] engine/communitysend.js:1417 — an agent whose re-login keeps returning 401 is retried once per cycle, never marked refused; plan accepts this --> no action (not stated; already accepted in iteration 8)
- [CONVENTION] engine/communitysend.js:1321 — test-only mutable `let`, consistent with `INSTALL_GROUP_RETRY_MS` --> no action (no issue)

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 4
- [WARNING] engine/communitysend.js:1388-1394 — every coordinator 400 is per-agent; a board/coordinator contract mismatch would show as per-agent 400s retried forever (self: iter 3) --> FIXED (d7ea296ea1 [df2d7c85]: a coordinator 400 for a second agent in one pass pauses the whole pass; test added)
- [WARNING] engine/communityowner-7215.test.js (whole file) — tests rest on stubs and shapes invented in the file; they prove consistency with the plan, not the real coordinator or site --> FIXED (d7ea296ea1: the test header says what it does not prove; the PR description is to say so)
- [NIT] engine/communitysend.js:1407-1408 — a site 2xx other than 200/204 is never marked linked --> FIXED (d7ea296ea1: any 2xx counts as linked)
- [NIT] engine/communitysend.js:1416 vs 1433 — the explicit 400/403 branch is covered by the later generic 4xx branch (self: iter 4) --> no action at this round (not stated; the two branches were merged in iteration 15)
- [NIT] engine/communitysend.js:1336-1338 — `OWNER_LINK_MINTS_PER_PASS` comment overstates the bound; about 65 s possible (self: iter 9) --> no action (not stated)
- [NIT] engine/communityowner-7215.test.js — untested arms: coordinator and site 405, a site 200, `ok: true` with no pass, `macIdHere()` null --> no action (not stated)
- [NIT] engine/communityowner-7215.test.js — `R.on = false` lines before `registered()` now do nothing (self: iter 9) --> no action (not stated)

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 5
- [WARNING] engine/communitysend.js:671 — the budget is a start-time check; with 5 mints the lock can be held for minutes (self: iter 9) --> DEFERRED: a timeout on either call already pauses the pass after that one agent, so at most one slow agent runs per pass
- [WARNING] engine/communitysend.js:708 — two bad names in one pass stall the rest (accepted in iteration 13), and the second 400's log line ("did not answer as expected (400)") is misleading (self: iter 13) --> FIXED for the log line (d3e5b5b34e [b4c1077e]: says the request itself was refused twice); the trade-off stays accepted
- [WARNING] engine/communityowner-7215.test.js — no integration check against the real coordinator and site routes --> DEFERRED: outside this diff; the PR will say so and the live check after deploy covers it
- [NIT] engine/communitysend.js:700 — two post-mint early returns are silent, unlike every other exit (self: iter 2/3) --> no action (not stated)
- [NIT] engine/communitysend.js:623 — doc comment about 25 lines, repeats the plan --> no action (not stated)
- [NIT] .claude/plans/ownerlink-7215-20261026.md:80-83 — Tests paragraph has uneven wrapping (self: loop's plan edits) --> no action (not stated)
- [CONVENTION] engine/phonenotify.js:539 — adding `plusLive` to exports is fine; lazy require avoids a cycle (self: iter 4) --> no action (no issue)

#### Iteration 15
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2
- [WARNING] engine/communitysend.js:193 — the pass is minted for `k.name` (the sign-in name), not `currentName`; a renamed agent could be refused forever --> DEFERRED: correct by the site contract, which matches on `login_name_key` so a renamed agent still links (Sub-Zero, m6450); reasoning recorded in the plan
- [WARNING] engine/communitysend.js:225, 239 — the site side has no equivalent of the coordinator's second-400 rule, so a site-wide change refuses agents one by one forever (self: iter 13 asymmetry) --> FIXED (2ffdd95fb5 [952f142c]: a second site refusal in one pass pauses the whole pass; test added)
- [WARNING] engine/communitysend.js:183/191 — the 30 s budget is only checked before an agent starts --> DUPLICATE (of iterations 6, 10 and 14, already handled or deferred)
- [NIT] engine/communitysend.js:202 — an empty-string pass is sent to the site --> FIXED (2ffdd95fb5: an empty pass counts as a malformed answer)
- [NIT] engine/communitysend.js:209-214 — every signed-in board logs "cannot vouch yet" hourly until the relay ships --> FIXED (2ffdd95fb5: pass-wide reasons logged once until they change or an agent links)
- [NIT] engine/communityowner-7215.test.js:1 — file name suggests a `communityowner.js` module that does not exist --> no action (not stated)
- [NIT] engine/communitysend.js:2958 — `_ownerLinkRetry` both resets four maps and sets the interval; split it (self: iter 6/7 maps) --> no action (not stated)

#### Iteration 16
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 3
- [WARNING] engine/communitysend.js:717 — `remote.macRequest` awaited with no try/catch; a throw gets no backoff, so every sweep re-mints --> FIXED (be27a250df [id not quoted]: a throw is treated as no answer, 15-minute pause past the agent; test added)
- [WARNING] engine/communitysend.js:723-725 — post-mint re-checks are not repeated after the `asAgent` site call; a link sent after a switch-off or delete cannot be recalled --> DEFERRED: recorded in the plan as an accepted race
- [WARNING] engine/communitysend.js:753/770 — two permanently refused agents can delay healthy agents behind them (self: iter 13/15 counters with the iter 7 resume index) --> DEFERRED: low severity, each pause expires after 15 minutes; recorded in the plan as accepted
- [WARNING] engine/communityowner-7215.test.js:244-257 — the fake site and stub coordinator cannot show the real contract works; the PR body must say so --> DEFERRED: covered by the test header; the PR body will repeat it
- [NIT] engine/communitysend.js:620-641 — doc comment repeats the plan's failure section --> no action (not stated)
- [NIT] engine/communitysend.js:731 — `++coord400 < 2` side effect inside the condition (self: iter 13) --> FIXED (be27a250df: counters incremented on their own line, `siteRefused` too)
- [NIT] engine/communitysend.js:742 — `if (k.refused) continue` deserves an explicit test --> no action (not stated)
- [NIT] .claude/plans/ownerlink-7215-20261026.md:77-89 — Tests section is one dense changelog-like paragraph (self: loop's plan edits) --> no action (not stated)
- [CONVENTION] engine/communityowner-7215.test.js — naming, sandbox and CLAUDE.md row all follow convention --> no action (no issue)

### Totals, iterations 1 to 16

| Category | Count | FIXED | DEFERRED | DUPLICATE | No action |
|---|---|---|---|---|---|
| BLOCKER | 0 | 0 | 0 | 0 | 0 |
| WARNING | 44 | 29 | 14 | 1 | 0 |
| CONVENTION | 12 | 4 | 0 | 0 | 8 |
| NIT | 55 | 18 | 0 | 0 | 37 |
| **All** | **111** | **51** | **14** | **1** | **45** |

How these were counted:
- FIXED includes 7 findings the orchestrator's text never mentioned but its fix code shows were handled in that round (each is marked "not stated, but").
- Three findings were fixed only in part. Each is counted once, as FIXED: iteration 1's missing-tests WARNING (some cases stayed untested), iteration 11's untested-branches WARNING (401 test added; the budget and removed-agent cases deferred), and iteration 14's two-bad-names WARNING (log line fixed; trade-off kept as accepted).
- No action covers three kinds of finding: those with no stated decision, those the reviewer itself called fine or "no issue" (6 of the 8 CONVENTIONs), and NITs left unanswered in their own round but fixed in a later one (iteration 2 NIT 1, iteration 4 NITs 2 and 3, iteration 9 NIT 3, iteration 11 NIT 3, iteration 13 NIT 2). That last group points to the later fix and is not counted again as FIXED.
- Only one NIT got an explicit stated reason for no action: iteration 7's suite-guard NIT.

Self-generated (an estimate, by the rule at the top): 45 of 111.

Could not be determined:
- The transcript quotes no commit id at the time for iterations 10 and 16; the current ids are given.
- Which six tests iteration 1 added is not listed beyond its commit message.


#### Iteration 17 (opus, read-only, release hold): 1 WARNING, 4 NITs
- [WARNING] engine/communitysend.js:1290 — comments/plan/test said a site-rotated key relinks; the board only takes a key at registration --> FIXED 5dbb2c6fe7 (wording in header, plan, test name and comment; PR draft too; relay plan a9d5a937)
- [NIT] communitysend.js:1302 — header missed that a second site refusal is pass-wide --> FIXED 5dbb2c6fe7
- [NIT] communitysend.js:1392 — 30 s budget is soft (~65 s worst case) --> FIXED 5dbb2c6fe7 (said so in the constant's comment and the plan)
- [NIT] communitysend.js:1403 — pass sent to whatever endpoint() is --> DEFERRED: the same request already carries the agent's own key to that endpoint, which is the stronger credential; the endpoint is an operator env override; and the pass is audience-bound (COMMUNITY_AUD) and names the agent, so the real site needs that agent's key as well. Pre-existing trust, not new.
- [NIT] communitysend.js:1386 — resume index shifts when keys change --> DEFERRED: every agent is still visited, cost one small delay; recorded in the plan.

#### Iteration 18 (sonnet, read-only): 3 WARNINGs, 2 NITs, 1 CONVENTION (a confirmation)
- [WARNING] communitysend.js:1391 — a site-cleared link is never restored; suggests a daily relink --> DEFERRED with reasoning recorded in the plan (site clears only on key rotate/revoke, when this key is dead anyway) — plan commit after 5dbb2c6fe7
- [WARNING] communitysend.js:1411 — two bad names pause the pass every 15 min --> DUPLICATE of the iteration-16 decision in the plan
- [WARNING] communitysend.js:1389 — ownerLinkAgentAt never pruned for deleted agents --> DEFERRED: bounded by the agent count, in memory, reset on restart
- [NIT] communitysend.js:1355 — log repeats when a reason flips --> DEFERRED: cosmetic, once per change is the intent
- [NIT] communitysend.js:1318 — comment says tests rely on UNKNOWN_MS staying long --> no action: the reviewer found it consistent
- [CONVENTION] CLAUDE.md — confirmation, no defect

#### Iteration 19 (opus, read-only): 2 WARNINGs, 5 NITs
- [WARNING] test:295 — 429 test cannot tell pass-wide from per-agent --> FIXED ad96de5459 (two agents)
- [WARNING] test:234 — site-404 test cannot tell the hour from 15 min --> FIXED ad96de5459 (reset(0) first)
- [NIT] test:500 — throw test, one agent --> FIXED ad96de5459 (two agents)
- [NIT] communitysend.js:1449 — 503 Retry-After ignored --> FIXED (docblock + plan say deliberate) ad96de5459
- [NIT] plan:53 — restart wording contradicted the code --> FIXED ad96de5459
- [NIT] plan:19 — 204/200 vs any 2xx --> FIXED ad96de5459
- [NIT] communitysend.js:2978 — _ownerLinkRetry name --> FIXED ad96de5459 (renamed _ownerLinkReset)

#### Iteration 20 (sonnet, read-only): 2 WARNINGs, 3 NITs, 1 CONVENTION; no code change
- [WARNING] communitysend.js:1411 — lock hold can exceed 30 s --> DUPLICATE of iteration 17 (soft budget, documented)
- [WARNING] communitysend.js:1458 — marker saved from the sweep's keys snapshot could overwrite a concurrent keys.json write --> DEFERRED, checked: sweepOnce runs inside exclusive() (line 1831), as do the other writers (2221, 2315, 2493); every pass in sweepOnce saves the same shared object, the existing pattern
- [NIT] 1388 silent skip of a nameless agent; [NIT] 1409 mints++ before notSent (returns at once); [NIT] reset seam does not reset PASS_MS (the budget test restores it in finally) --> DEFERRED, harmless
- [CONVENTION] CLAUDE.md not inspected by this reviewer --> no action (iterations 18 and 19 confirmed it accurate)

#### Iteration 21 (opus, read-only): 1 BLOCKER, 1 WARNING, 2 NITs
- [BLOCKER] test:377 retiring test — request older than the registration finishes in the lock before the sweep; would fail as written --> FIXED (fail the store mark so the request stays pending; control asserts the key stays live)
- [WARNING] communitysend.js coordinator 400 handling — member_key_wrong_epoch is about this computer, charged to the name --> FIXED (pass-wide at once; new test, now 31)
- [NIT] pass to endpoint() — DUPLICATE of iteration 17 deferral
- [NIT] refused agents use mints --> recorded in the plan as accepted

#### Iteration 22 (sonnet, read-only; traced all 31 tests as passing): 0 BLOCKER/WARNING/CONVENTION, 4 NITs
- [NIT] ownerLinkAgentAt keyed by name survives a delete+re-register (<=15 min delay); [NIT] spent budget can resume at a no-work agent; [NIT] fake site arm order deserves a comment; [NIT] "removed agent is linked" wording
**Converged** at iteration 22 on 5394e50a20 (read-only). 6g/6j OWED: tests never run since iteration 1.

#### Hold lifted 17:19. Tests run: 31/31; negative controls A-E red (epoch, pre-mint retiring, 429, site 404 hour, throw). Related 52 files: 1090/1092, the one real failure was engine.reachable flagging the two test seams --> FIXED 0b50b1d05a (excused). Rebased on origin/main (5258245fa2).
Validation helper at 5258245fa2: FAILED: cli.refused-retry-6968 (red on main a2b2fe1c52 too, filed kosmos#7258), #5536 collision ratio and #6734 full disk (both green alone), aw-filebrowser temp leak (filebrowser-6724 tests, not this branch). Load 13-33 on 12 cores.

#### Iteration 23 (opus): 1 WARNING, 6 NITs
- [WARNING] test file — log-once and the finally save on an early exit unpinned --> FIXED (3 tests; controls red: pass log guard, agent log guard, finally save)
- [NIT] plan failure bullet "400 or 403" --> FIXED; [NIT] test title "every agent" --> FIXED
- [NIT] lock hold up to ~60 s --> DUPLICATE (iteration 17/20); [NIT] redundant trailing resets --> DEFERRED harmless; [NIT] maps never pruned --> DUPLICATE (18); [NIT] sweep order unpinned --> DEFERRED (order is the call sequence in sweepOnce, commented)

#### Iteration 24 (sonnet): 0 BLOCKER/WARNING, 3 NITs, 1 CONVENTION (confirmation; asks to confirm the reachable guard, which ran green at 5258245fa2)
- [NIT] refused agents take mints --> DUPLICATE (21); [NIT] malformed 2xx mint logs "did not answer as expected" --> DEFERRED (fail-safe, wording fits); [NIT] any 2xx is linked --> DUPLICATE (plan decision)
**Converged** at iteration 24 on fac74c0e56. 6j pending.

#### After PR #7294 opened (ef81b4a493): CI run 40445330427
- suite (node) PASS, shell 2/2 PASS, shell macOS PASS, windows PASS, scope PASS, test-linux-setup PASS.
- suite (shell 1/2) FAIL: tools/test-connector-verbs.sh "the mac-request callers changed" -- communitysend.js is a new macRequest caller; the pinned list (gate-closed rule, #3626) needs a re-decision. A real miss by this loop: no reviewer and no local run covered that shell guard (the 63 related files were node tests only).
  --> FIXED da7ec5185f: decision comment (old connector refuses "mac-request does not sign" -> ownerPassUnknown -> hour wait, nothing sent; pinned by the test at engine/communityowner-7215.test.js:195; communitysend.js line 1398 is its only macRequest, main has none), list 13 -> 14. test-connector-verbs.sh locally: 27 passed, 0 failures.
- Iteration 25 (opus) running on da7ec5185f.

#### Iteration 25 (opus) on da7ec5185f: 0 B, 1 W, 0 C, 5 N
- [WARNING] plan:41 / communitysend.js:1405 -- a Forget pressed during the mint slips through (forget() waits on signedInFlight, so mac id and switches unchanged) --> FIXED fd0e730eae: after the mint, return on remote.busy() (exported read-only); new test (35); control red (busy check removed -> "its pass was not sent"); plan sentence rewritten
- [NIT] communitysend.js:1422/1457 "two agents in a row" vs counted per pass --> FIXED fd0e730eae ("in one pass")
- [NIT] communitysend.js:1450 429 log dedupes on text with the wait --> FIXED fd0e730eae (fixed reason key 'site 429')
- [NIT] test-connector-verbs.sh:214 hour is in memory; test pins only "not the short pause" --> FIXED fd0e730eae (comment says both)
- [NIT] production aud pass handed to a non-default AGENT_WORKFORCE_COMMUNITY_URL --> DUPLICATE of iteration 17 deferral (the same request carries the agent's own key there; operator override)
- [NIT] untested arms (site 405; coordinator 405/429/413/401; ok without pass; site 503 Retry-After) and no log-scrub assertion --> DEFERRED: each maps to an arm already tested by class (405 with 404, 4xx/5xx through statusFor); reviewer confirmed no pass or key is logged
Tests at fd0e730eae: 35/35 + reachable; 85 related files (communitysend/phonenotify loaders + every test reading remote.js) 1845 pass, 15 skipped, 0 fail; test-connector-verbs.sh 27/27 (at da7ec5185f; fd0e730eae changes only its comment).

#### Iteration 26 (sonnet) on fd0e730eae: 0 B, 4 W, 0 C, 3 N
- [WARNING] test:494 budget test cannot fail on resume (both agents at 0/1, default 0) --> FIXED cef10926ea: new test, budget spent during the first agent's mint, first agent relinked (new key) so the start shows in mint order; control (resume dropped at the budget check) red; old test's title/assertion no longer claims resume; plan corrected
- [WARNING] communitysend.js:1417 coordinator 403 logged as "did not answer as expected" --> FIXED cef10926ea (own 403 sentence)
- [WARNING] communitysend.js:1292/1304 "a removed agent is linked too" reads as a guarantee --> FIXED cef10926ea (says the pass does not read the removed list); the plan already states the decision and that it is untested
- [WARNING] communitysend.js:1357 lock hold ~50-65 s worst case --> DUPLICATE of iterations 17/20/23 (soft budget documented in the constant's comment and plan:87)
- [NIT] assert ownerLinked undefined on refused paths --> DEFERRED (refused keys skip before any mint; covered by the refused-key tests' mint counts)
- [NIT] test-connector-verbs.sh long comment line --> FIXED cef10926ea
- [NIT] mints++ before notSent --> DUPLICATE of iteration 20
Tests at cef10926ea: 36/36 + reachable (44); 85 related files 1846 pass, 15 skipped, 0 fail; test-connector-verbs.sh 27/27.

#### Iteration 27 (opus) on cef10926ea: 0 B, 1 W, 0 C, 4 N
- [WARNING] communitysend.js:1449 site 429 pass-wide although the #4953 limiter is per agent; owner call ignores limiterPauseUntil --> FIXED 1f4910bd1e: rate_limit_exceeded pauses only that agent (shared limiter pause); a paused agent is skipped before the mint; other 429s stay pass-wide; new test (37); controls red (arm removed; pre-mint skip removed)
- [NIT] retiring(agentKey) after the mint ends the whole pass --> FIXED 1f4910bd1e (continue for that agent)
- [NIT] pass-wide log drops minted.because --> FIXED 1f4910bd1e (reason appended, cut to 200 chars; it is tunnel/remote text, no pass or key)
- [NIT] 429 cap/floor untested --> DEFERRED, listed under "Not tested" in the plan
- [NIT] untested arms (405s, ok-without-pass, 2xx-not-204, retire list unreadable mid-mint, coordinator 429) --> DEFERRED, listed under "Not tested" in the plan
Tests at 1f4910bd1e: 37/37 + reachable (45); 85 related files 1847 pass, 15 skipped, 0 fail; test-connector-verbs.sh 27/27.

#### Iteration 28 (sonnet) on 1f4910bd1e: 0 B, 3 W, 0 C, 4 N
- [WARNING] lock hold ~65 s vs an agentCall's 20 s wait (AGENT_WAIT_MS) --> FIXED 6696997a74 as a recorded decision: plan states the figure and the consequence (an agent call is answered busy, try again, which #4774 treats as safe; queued posts go next pass) and why the mint stays inside the lock. New angle on the iteration 17/20/23 duplicate (the 20 s comparison)
- [WARNING] 408/413 (and a proxy 403) counted as about one agent --> FIXED 6696997a74: 408 and 413 pass-wide like a 5xx; a site 403 stays per-agent (the site contract's refused pass), recorded in the plan; test (38) with a red control
- [WARNING] coord400/siteRefused reset per sweep, so a systemic refusal never trips pass-wide --> NO ACTION, checked: after the first refusal the loop goes on to the next agent in the same sweep, whose refusal trips the pass-wide pause; with one unlinked agent the per-agent wait costs the same as a pass-wide one (tests: "two bad names" and "second site refusal" in one sweep)
- [NIT] notSent comment names only register/Forget --> FIXED 6696997a74 (all causes; the not-connected one is ruled out first by ownerLinkLive)
- [NIT] log carries minted.because --> NO ACTION: added at iteration 27's request; it is remote's own one-line reason, never a pass or key (iterations 27 and 28 both confirmed), cut to 200 chars
- [NIT] keyName('ava') control cannot fail --> NO ACTION, checked: a finished retire removes ava from keys.json, and keyName then throws, so the line fails exactly when the retire was not pending
- [NIT] 403 and 429 pause lengths unpinned --> DEFERRED (429 listed under Not tested; the 403 shares the generic pass-wide arm whose length the 503 test pins)
- [NIT] resume index shifts with key order --> FIXED 6696997a74 (comment clause)
Tests at 6696997a74: 38/38 + reachable (46); 85 related files 1848 pass, 15 skipped, 0 fail.

#### Iteration 29 (opus) on 6696997a74: 0 B, 2 W, 0 C, 6 N
- [WARNING] route-missing arms (site 404/405, coordinator unknown) do not stopHere: an agent-specific 404 on the first agent starves the rest --> FIXED 1da08b2356 (stopHere in both); NOT TESTED (the reset seam clears the walk), recorded in the plan
- [WARNING] production pass posted to any configured community endpoint; a third party could present it at the real site under a name it registers --> FIXED 1da08b2356: link only when community and coordinator are both defaults or both overridden (staging still works); logged once; test (39) + control red; plan decision. (Earlier raised at 17 and 25 and deferred; this round gave the replay path, which the deferral's reasoning did not cover.)
- [NIT] no NODE_TEST_CONTEXT guard on the real macRequest --> DEFERRED: every communitysend test sandboxes AGENT_WORKFORCE_DATA, and the new deployment rule also stops a loopback test community reaching the default coordinator
- [NIT] header names one 429 arm --> FIXED
- [NIT] #4953 comment out of date --> FIXED
- [NIT] post-mint retiring skip throws away a pass-wide mint failure --> FIXED (skip only on an ok mint)
- [NIT] beforeEach does not reset limiterPauseUntil --> FIXED (cs.resetPauses())
- [NIT] 429 test cannot tell the 429 arm from the generic one --> FIXED (asserts its log line)
Tests at 1da08b2356: 39/39 + reachable (47); 85 related files 1849 pass, 15 skipped, 0 fail; test-connector-verbs.sh 27/27.

#### Iteration 30 (sonnet) on 1da08b2356: 0 B, 1 W, 0 C, 4 N
- [WARNING] plan says "never linked to the account just forgotten", but a Forget during the site call (~15 s) still lands --> FIXED (plan): window named and accepted with the switch-off/delete windows; no code can unsend a pass
- [NIT] deployment rule's reverse arm untested --> DEFERRED, listed under Not tested (a test cannot point the sweep at the real community)
- [NIT] marker lacks the deployment --> DEFERRED, recorded in the plan (staging only)
- [NIT] ownerLinkAgentAt keyed by agent not marker --> DEFERRED (one 15-minute pause after a re-registration)
- [NIT] exact-string default coordinator vs SAME_SERVICE aliasing --> FIXED (plan states the exact terms)
Plan-only change; code identical to 1da08b2356.

#### Iteration 31 (opus) on f795c519fc: 0 B, 1 W, 0 C, 4 N
- [WARNING] deployment rule compares the coordinator as an exact string: the production coordinator spelled differently + another community = "both overridden" -> leak --> FIXED d6d254a9fd: production judged by host (unreadable counts as production); test over three spellings; control (exact compare) red; plan corrected
- [NIT] stubbed remote functions could vanish from the product unnoticed --> FIXED (assert typeof at file top)
- [NIT] coordinator failure log keyed by text incl. because --> FIXED (stable key per kind)
- [NIT] 413 not in Not tested --> FIXED (plan)
- [NIT] "pauses are per endpoint" vs per-agent limiter --> FIXED (comment)
Tests at d6d254a9fd: 40/40 + reachable (48). Related 85 files: 1848 pass, 2 fail, 15 skipped -- both fails engine/remote.test.js #3827 kill-timing fixtures ("the kill landed before the half identity was written (a loaded box: #6140)", 87 s and 43 s, load 24); remote.test.js alone right after: 242/242. Committed before reading the rc (a process slip: the commit was chained after the run); the content stands. test-connector-verbs.sh 27/27.

#### Iteration 32 (sonnet) on d6d254a9fd: 0 B, 4 W, 0 C, 3 N
- [WARNING] "not the same deployment" overclaims; two unrelated overrides pass --> FIXED (log, header comment and plan say production-with-production only; two non-production ones are not checked: staging account only)
- [WARNING] latest-pass-wins rests on a contract not in this repo --> FIXED (plan cites kosmos-relay #602 by number and says nothing here checks it; live end-to-end after the site ships)
- [WARNING] the agent tripping the second-refusal rule gets no own wait --> NO ACTION, checked: its own wait would be the same 15 min as the pass's and end with it; the walk already resumes after it (stopHere), so healthy agents go first
- [WARNING] retiring-test control cannot fail --> DUPLICATE of iteration 28 (no action: a finished retire removes the key and keyName throws); message now says so
- [NIT] require('./remote') repeated --> FIXED (one reference)
- [NIT] 429 cap untested --> DUPLICATE (listed under Not tested)
- [NIT] closures recreated per iteration; stale ownerLinkFrom after a full pass --> NO ACTION (harmless, reviewer's words)
Tests at the new head: 40/40 + reachable (48); 85 related files 1850 pass, 15 skipped, 0 fail (read before committing).

#### Iteration 33 (opus) on a5d74ba05a: 0 B, 1 W, 0 C, 3 N
- [WARNING] a computer leaving Kosmos+ without rejoining leaves every agent linked to the forgotten account, which keeps owner view and Delete over later posts --> a gap in how the site ties agents to a person, so per Liu Kang m6428 it went on the private card: comment on kosmos-relay #602 (ruling asked of Sub-Zero/Liu Kang; the board cannot unlink: no site route, no identity after Forget). Plan cites #602 by number only.
- [NIT] plan says the other deployment arm "cannot" be tested --> FIXED (reworded as a judgement)
- [NIT] 503 note "15 min is longer" stated as always --> FIXED (the site's own 30 s; a longer one is asked once more, accepted)
- [NIT] spelling test has no in-test control --> FIXED (links once overridden again)
Focused tests: 40/40 + reachable (48).

#### Iteration 34 (sonnet) on 8f9a963cfa: 0 B, 2 W, 0 C, 4 N
- [WARNING] re-check busy()/mac right before asAgent --> NO ACTION, checked: the post-mint checks already run synchronously right before asAgent (nothing awaits between); the in-call window is the iteration-30 accepted one (DUPLICATE)
- [WARNING] owner link's limiter 429 sets the shared pause that blocks posts --> NO ACTION, checked: the site counts the agent's requests in one bucket, so its posts would be refused in that window anyway; the link adds at most one request per 15 min
- [NIT] test comment "an hour-long pause would not be touched" false --> FIXED (comment; notes which sweep discriminates)
- [NIT] generic site-failure log keyed by its sentence --> FIXED (stable key per kind)
- [NIT] silent returns (mismatch logged; retire list unreadable not) --> NO ACTION (the retire module logs an unreadable list itself)
- [NIT] no NODE_TEST_CONTEXT guard on the mint (second time, after iteration 29) --> FIXED: guard as mac-standing.js; the 7215 tests set AGENT_WORKFORCE_TUNNEL_BIN to a sandbox path never run; control without it: 39/40 red
Tests: 40/40 + reachable (48); 85 related files 1850 pass, 15 skipped, 0 fail; test-connector-verbs.sh 27/27.

#### Iteration 35 (opus) on 579d61e097: 0 B, 1 W, 0 C, 3 N
- [WARNING] trailing-dot (and IP) spelling of the production coordinator reads as non-production --> FIXED: trailing dots stripped; IP noted (cannot reach: the certificate names the host); spelling added to the test; control red
- [NIT] refused-key test does not pin the post-call k.refused skip --> FIXED (asserts no pass-wide 401 line; control removing the skip red)
- [NIT] budget test 50 ms can flake on a loaded box --> FIXED (1000 ms budget, 1500 ms mint)
- [NIT] duplicate R.on toggles around registered() --> NO ACTION (cosmetic; harmless)
Tests: 40/40 + reachable (48); 85 related files 1850 pass, 15 skipped, 0 fail.

#### Iteration 36 (sonnet) on 515bb55ff1: 0 B, 2 W, 0 C, 4 N
- [WARNING] limiter 429 sets the shared pause that holds posts --> DUPLICATE of iteration 34 (no action: shared site bucket); the coupling is now stated in the comment
- [WARNING] any 2xx records the permanent marker --> FIXED: only 204 (the site route's own status_code=204, checked in kosmos-community-ownerpass-7215 app/routers/agents.py:261); other 2xx = service failure, logged; test (41) + control red; plan updated (was a plan decision at 19/24, reversed with the site's code in hand)
- [NIT] host rule vs remote.js exact compare disagree --> FIXED (comment says why)
- [NIT] site 404 for one agent stalls the pass an hour --> NO ACTION, checked: the site answers an unknown agent 401 (get_current_agent), not 404; recorded in the plan
- [NIT] budget test race --> FIXED (3 s mint vs 1 s budget)
- [NIT] early returns leave ownerLinkFrom --> FIXED (plan says so and why)
Tests: 41/41 + reachable (49). Related 85 files: 1850 pass, 1 fail, 15 skipped: engine/remote-typedallow-6590.test.js c3 "a leaked S was kept" (load 9.9 falling); alone twice: 21/21, 21/21. Not in this diff's reach (remote.js changed by one export).

#### Iteration 37 (opus) on 916ff23bf2: 0 B, 3 W, 1 C, 2 N
- [WARNING] member_key_wrong_epoch arm describes a refusal this route never sends (memberkey.rs only; checked: coordinator/src/memberkey.rs:83, the only with_code) --> FIXED: arm, docblock line, plan bullet and test removed. Iteration 21's WARNING rested on a wrong understanding of the coordinator; this is the correction, recorded in the plan.
- [WARNING] site 503 "not set up" carries no Retry-After and lasts until configured (checked: kosmos-community app/routers/agents.py:283) --> FIXED: a 503 with no positive Retry-After waits the hour (note: a missing header reads as 0 via Number(null), first try used == null and the test caught it); test (42) + control red
- [WARNING] the dangerous direction (real community + stand-in coordinator) untested; "cannot" reason false --> FIXED: test through a sender that answers only the default address from the loopback site and throws for anything else; control (gate removed) red; both directions in docblock and plan
- [CONVENTION] duplicate WRONG_EPOCH_CODE literal --> FIXED by removing the arm
- [NIT] pass-level retire-list check has no test of its own --> recorded under Not tested
- [NIT] "96 mints and site calls" for a coordinator 400 --> FIXED (wording)
Tests: 42/42 + reachable (50). Related 85 files: 1850 pass, 1 fail, 16 skipped: engine/backupscan.test.js #5686 review 7 regex timing (1.77 s, load 12); not touched by this branch; alone twice 44/44. test-connector-verbs.sh 27/27.

#### Iteration 38 (sonnet) on 96fe311ca1: 0 B, 0 W, 0 C, 5 N
- [NIT] a 503 with Retry-After 0, or an infrastructure 503 without the header, also waits the hour --> NO ACTION: accepted (an hour's delay to a link; the header-absent and 0 cases both mean "no time given")
- [NIT] host rule ignores scheme and port on the production host --> NO ACTION: stated design (iteration 31/35); a listener on the production host name needs the operator's own override
- [NIT] untested: unparseable address as production, the NODE_TEST guard's own branch, ownerLinkWait formatting --> DEFERRED (the guard was controlled by hand at iteration 34: 39/40 red without the seam)
- [NIT] tests restore defaults with literals --> DEFERRED (test-only)
- [NIT] plan's test count is prose that drifts --> NO ACTION (kept current each round)
**Converged** at iteration 38 on 96fe311ca1 (zero new BLOCKER/WARNING/CONVENTION).

### Totals, iterations 17 to 24

| Category | Count | FIXED | DEFERRED | DUPLICATE | No action |
|---|---|---|---|---|---|
| BLOCKER | 1 | 1 | 0 | 0 | 0 |
| WARNING | 10 | 5 | 3 | 2 | 0 |
| CONVENTION | 3 | 0 | 0 | 0 | 3 |
| NIT | 29 | 9 | 10 | 5 | 5 |
| **All** | **43** | **15** | **13** | **7** | **8** |

### Totals, iterations 25 to 38 (and the CI miss)

| Category | Count | FIXED | DEFERRED | DUPLICATE | No action |
|---|---|---|---|---|---|
| BLOCKER | 0 | 0 | 0 | 0 | 0 |
| WARNING | 27 | 19 | 1 | 4 | 3 |
| CONVENTION | 1 | 1 | 0 | 0 | 0 |
| NIT | 55 | 31 | 12 | 3 | 9 |
| **All** | **83** | **51** | **13** | **7** | **12** |

### Final Ledger

| Category | Count | FIXED | DEFERRED | DUPLICATE | No action |
|---|---|---|---|---|---|
| BLOCKER | 1 | 1 | 0 | 0 | 0 |
| WARNING | 81 | 53 | 18 | 7 | 3 |
| CONVENTION | 16 | 5 | 0 | 0 | 11 |
| NIT | 139 | 58 | 22 | 8 | 51 |
| **All** | **237** | **117** | **40** | **15** | **65** |
