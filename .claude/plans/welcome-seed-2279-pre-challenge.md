---
pre_challenge: true
method: challenge-loop
branch: welcome-seed-2279
diff_hash: 7efde21efd960c65a734d3f3915687b15ee64162554eb0a3dc839770462ad299
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T21:51:00Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iterations 4, 5, 6 each returned zero NEW actionable findings; iteration 3 was the last with a real finding)
**Total findings:** 11 (0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 10 NITs)
**Fixed:** 8 | **Deferred:** 3 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] server.js:3041 -- `seeded:true` reported in the adopt case too --> FIXED (9fff6d7b): gated on `homeCreated`, so it fires only on a real creation.
- [NIT] server.projects.test.js -- no over-the-wire test for the connect route's adopt path --> DEFERRED: structurally covered (both routes call the one `homeForFirstAgent` helper, which has direct unit tests; the create route's adopt path is tested over the wire).

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- [NIT] first-run seed -- first-run home gets the note but not the 3 starter tasks --> DEFERRED (documented in the plan): the tasks presuppose an agent, and none exists at first-run.
- [NIT] projects.test.js -- the `made.via === 'kosmos'` adopt discriminator was not pinned by a test --> FIXED (2821b614): added a test seeding a user-made same-named project and asserting it is not adopted.
- [NIT] server.js:4778 -- connect-route flag write omitted the `project` field the other sites record --> FIXED (2821b614).

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 0 NITs
- [CONVENTION] server.js:4998 -- the room-note literal was duplicated (create route + new first-run route): the same "two copies of one fact" the consolidation targets, reintroduced by this PR --> FIXED (21c51ecf): exported a shared `WELCOME_ROOM_NOTE` constant; both sites read it; zero literal copies remain.

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs (one earlier `[CONVENTION]`-tagged item explicitly said "No violation" and is recorded as a strength, not a finding)
- [NIT] server.js:4741 -- connect/import route seeded a note-less welcome home --> FIXED (3e315bc8): now furnishes the shared `WELCOME_ROOM_NOTE`, so the first thing a new person reads no longer depends on which door the first agent came through.
- [NIT] server.projects.test.js -- no assertion that the create-route response omits `seeded:true` on an adopt --> FIXED (3e315bc8): added `notEqual(homeRow.seeded, true)`. (Connect-route over-the-wire adopt test: DEFERRED, structurally covered.)

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- [NIT] server.projects.test.js:2816 -- the first-run room-note assertion (`.some(...)` presence) could false-pass: the welcome id is deterministic and the messages LOG is not reset between tests, so a sibling test's note to the same id would satisfy it even if first-run wrote nothing --> FIXED (this commit): the test now zeroes `messages.LOG` and asserts an exact `notes.length === 1`, so it can fail on the thing it tests.

#### Iteration 6
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- [NIT] server.js:4782 -- the import route furnishes the note but not the 3 starter tasks the create route adds (import has an agent name available, so parity is possible) --> DEFERRED: pre-existing (the import route never added tasks; this PR only added the note, a net improvement) and outside #2279's scope (the card is the project appearing on fresh install, not task-furnishing parity). A trivial follow-up if task parity across doors is wanted.
- **Converged** -- no new actionable findings; three consecutive zero-actionable passes (4, 5, 6).

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | server.js:3041 | seeded:true on adopt | FIXED | 9fff6d7b (gate on homeCreated) |
| 2 | 1 | NIT | server.projects.test.js | no connect over-wire adopt test | DEFERRED | helper unit-tested + create adopt tested over wire |
| 3 | 2 | NIT | server.js first-run | first-run home lacks 3 starter tasks | DEFERRED | tasks presuppose an agent; documented in plan |
| 4 | 2 | NIT | engine/projects.test.js | made.via discriminator untested | FIXED | 2821b614 |
| 5 | 2 | NIT | server.js:4778 | import flag omits project field | FIXED | 2821b614 |
| 6 | 3 | CONVENTION | server.js:4998 | room-note literal duplicated (2 copies) | FIXED | 21c51ecf (WELCOME_ROOM_NOTE) |
| 7 | 4 | NIT | server.js:4741 | connect route lacked room note | FIXED | 3e315bc8 |
| 8 | 4 | NIT | server.projects.test.js | no seeded-omitted-on-adopt assertion | FIXED | 3e315bc8 |
| 9 | 5 | NIT | server.projects.test.js:2816 | room-note assertion vacuous | FIXED | this commit (reset LOG, exact count) |
| 10 | 6 | NIT | server.js:4782 | import route lacks starter tasks | DEFERRED | pre-existing + out of #2279 scope |

### NITs (non-blocking, across all iterations)
Covered in the per-iteration breakdown and ledger above; the three DEFERRED items are each a documented judgment (structural test coverage, first-run has no agent, import task-parity is a pre-existing out-of-scope follow-up).

### Strengths (across all iterations)
- Once-ever composition proven against both "two homes" and "zero homes": `seedWelcomeHome` gates on flag AND emptiness, so no interleaving of the three sites doubles or drops the home (iterations 1, 2, 4, 5, 6).
- `homeCreated` threaded correctly through rollback, flag-write, furniture, and the `seeded:true` response gate in both agent routes (every iteration).
- The adopt discriminator keys on `made.via === 'kosmos'`, which `create()` never lets a user-supplied project claim, so a coincidentally-named project cannot be adopted; pinned by a direct test.
- The consolidation genuinely resolves the kosmos#253 two-copies drift (2 inline copies -> 1 helper) and, as a side benefit, closed the pre-existing note-less-import gap.
- Tests can fail on the thing they test (the vacuous room-note assertion was closed in iteration 5).
- No em dashes introduced anywhere, including the plan.
