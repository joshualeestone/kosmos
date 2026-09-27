---
pre_challenge: true
method: challenge-loop
branch: phone-offline-718
diff_hash: 6a8b5d0b846f3291735e6e9f75cff46e754d5fa6df3b462d87f9b98233695c92
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T13:07:03Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes, iteration 4 raised only a deferred naming convention.
**Total findings:** 7 (0 BLOCKERs, 6 WARNINGs, 1 CONVENTION), plus NITs below
**Fixed:** 6 | **Deferred:** 1 | **Asked (awaiting user):** 0

Final validation (6j): `yarn test` passed on 1f95dd1d9, rebased onto main 8765158 with the #4159
flake fix (validation-log hash 6a8b5d0b846f, the diff this proof hashes); subdir audit passed; behind
`tools/heavy-gate.sh --twice`. Browser checks on the same commit: `render-consolidated-projects-3052`,
`render-phone-offline-718` and `render-device-signed-out-401-718` all PASS (39 passing lines). The
consolidated-projects check was flagged by the surface gate; it was run rather than only excused
(Liu Kang m1540). Earlier full runs went red only on the #4159 flake (fixed by #4168) and once on
#3126's source-shape check (fixed in b69e56786).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html paintAddAgents / paintFreeAgentPicker -- still blamed the Mac on an offline phone --> FIXED (3efa215ff), with tests and controls
- [WARNING] render-phone-offline-718.js -- the back-online check could pass on a scheduled poll --> FIXED: it waits for a poll to go out before going online; a unit test pins the online listener (control: dropping loadProjects() from it goes red)
- [NIT] OFFLINE_SENTENCE promised the board "comes back" --> FIXED ("tries again by itself")

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0
**Self-generated:** 0
Then the full suite went red on web.consolidated-774.test.js (#3126's check that paintPjNone follows PJ_READ_FAILED within four lines) --> FIXED (b69e56786): the offline reset shares the sign-in flags' line.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html staleReadMsg -- an open project kept "offline" (and state 3's "signed out") after a good read --> FIXED (602e4bee5), with a test (control: the old staleReadMsg goes red)
- [WARNING] web.offline-note.test.js -- nothing pinned tick's offline reset on a good read --> FIXED: pinned in tick's source (the success path runs more painters than the harness can drive; control: deleting the line goes red)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0
- [CONVENTION] .claude/plans/phone-offline-718.md -- no timestamp in the name --> DEFERRED: most plans on main are `<branch>.md`, as for state 3
**Converged** -- no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html paintAddAgents | BRANCH | picker and hint blamed the Mac | FIXED | 3efa215ff |
| 2 | 1 | WARNING | render-phone-offline-718.js | BRANCH | back-online check could pass by luck | FIXED | 3efa215ff |
| 3 | 2 | BLOCKER (synthetic) | final validation | BRANCH | #3126 shape check red | FIXED | b69e56786 |
| 4 | 3 | WARNING | web/index.html staleReadMsg | BRANCH | stale offline line in an open project | FIXED | 602e4bee5 |
| 5 | 3 | WARNING | web.offline-note.test.js | BRANCH | tick's good-read reset unpinned | FIXED | 602e4bee5 |
| 6 | 4 | CONVENTION | .claude/plans | BRANCH | plan name has no timestamp | DEFERRED | main precedent |

(Shas are from before the rebase onto main; the commits keep their subjects.)

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- the online listener reloads projects even from the Agents tab (harmless, generation-guarded) (3)
- the picker's short reason paraphrases OFFLINE_SENTENCE, like its siblings (4)
- "not connected to the internet" is loose for a LAN host; with onLine false there is no network at all (3)

### Strengths (across all iterations)
- The flag keys on "no answer at all" and navigator.onLine === false through Kosmos+ only, so an answered 5xx and the Mac's own loopback window keep their copy.
- paintOfflineNote keys its re-announce guard on which end is down.
- Both pollers are driven through signed-out, offline, 500 and good reads in fast tests, each shown able to fail.
