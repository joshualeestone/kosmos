---
pre_challenge: true
method: challenge-loop
branch: hookpin-1569
diff_hash: d32afba4e1307ffda7ea1819d75435739688327027c87c5d2026891ec0e9c17b
validation: passed
subdir_audit: passed
timestamp: 2026-08-30T14:50:56Z
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** No (stopped at user request after iteration 1)
**Stopped by:** Splinter, 2026-08-30: the bar is zero BLOCKERs, and an honest `converged: false` ships. Iteration 1 returned no BLOCKER.
**Total findings:** 9 (0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 3 NITs)
**Fixed:** 8 | **Deferred:** 0 | **Asked:** 0 | **Satisfied by this file:** 1

### 🛑 Read this before the table: the review disproved the branch's own scope claim

**The single most valuable finding was that this branch's plan was WRONG about what could
be measured, and the reviewer proved it using the fixture already sitting in my own test
file.** I had written that `onProgress` could not be pinned from outside the module.
It can: `connect.state().progress` reports its output verbatim while a download is parked
mid-stream, which is exactly what `serveHeldRelease` was built to do. About eight lines.

⭐ **The shape, and it is why this sits at the top rather than in a row:** I asserted a
NEGATIVE about what could be measured, without running the measurement. It read as rigour
precisely because it was self-deprecating and unfalsifiable as written. **A negative claim
about observability needs a probe exactly as much as a positive one does.**

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 3 NITs

- [WARNING] .claude/plans/hookpin-1569.md:51 - the "cannot be pinned" report is wrong three ways. `onProgress` IS observable (now pinned; the mutation `onProgress(total, got)` leaves the whole 3120-test suite green and reds this test). `wantsProgress` is observable too, and only its collapse direction is unpinned. `maySweepDownloads` was already pinned by the existing `#458` test --> FIXED (plan rewritten; the honestly-unpinned set is now `cancelled` and one direction of `wantsProgress`)
- [WARNING] engine/connect.hookwiring-1569.test.js:14 - the header said the `cancelled` scenario "is the scenario built here". It is not, and the account 200 lines below says so. Two paragraphs of one file contradicting each other is worse than either alone --> FIXED
- [WARNING] engine/connect.hookwiring-1569.test.js:54 - the held-open download was INERT for the shipped assertion: `onPhase(DOWNLOADING)` fires before the binary is requested. Measured, serving in one shot instead of parking failed 0 times in 10, so the hold, the release plumbing and the socket teardown existed to manage a hazard only the unused apparatus created --> FIXED (it now carries the `onProgress` assertion it was the right harness for)
- [WARNING] engine/connect.hookwiring-1569.test.js:164 - the control could not return the dangerous answer. `hasOwnProperty(st, 'phase')` is invariantly true because `publicView` is an object literal always containing `phase:`. Its comment was also about `progress` while the assertion was about `phase` --> FIXED (replaced with one that watches the field move 0 to 1024, which is what makes the zero mean anything)
- [WARNING] engine/connect.hookwiring-1569.test.js:161 - the assertion's message claimed a previous flow's numbers survive, which this one-flow fixture never constructs. Under both realistic mutations the line ABOVE fires, never that one --> FIXED (scoped to what it tests)
- [CONVENTION] no `.claude/plans/hookpin-1569-pre-challenge.md` --> FIXED (this file)
- [NIT] engine/connect.hookwiring-1569.test.js:85 - a quoted suite total that no longer reconciles (3105, now 14 off) --> FIXED (figure dropped; what matters is that the leak was real and the three-step teardown fixed it)
- [NIT] engine/connect.hookwiring-1569.test.js:88 - `try { release() } catch` describes a condition that cannot occur; resolving twice is a documented no-op and is the normal path --> FIXED
- [NIT] engine/connect.hookwiring-1569.test.js:157 - env vars set but not torn down, unlike the sibling `connect.install-997.test.js:129` --> FIXED

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | .claude/plans/hookpin-1569.md:51 | "Cannot be pinned" false for three hooks | FIXED | onProgress pinned; plan rewritten |
| 2 | 1 | WARNING | connect.hookwiring-1569.test.js:14 | Header claims a scenario the file does not build | FIXED | corrected, with the reason |
| 3 | 1 | WARNING | connect.hookwiring-1569.test.js:54 | Held-open apparatus inert for the shipped assertion | FIXED | now carries the onProgress pin |
| 4 | 1 | WARNING | connect.hookwiring-1569.test.js:164 | Control invariantly true | FIXED | watches the field move |
| 5 | 1 | WARNING | connect.hookwiring-1569.test.js:161 | Message claims more than the fixture constructs | FIXED | scoped |
| 6 | 1 | CONVENTION | .claude/plans/ | No proof file | FIXED | this file |
| 7 | 1 | NIT | connect.hookwiring-1569.test.js:85 | Stale suite total | FIXED | figure dropped |
| 8 | 1 | NIT | connect.hookwiring-1569.test.js:88 | Impossible catch | FIXED | removed |
| 9 | 1 | NIT | connect.hookwiring-1569.test.js:157 | Env vars not torn down | FIXED | deleted in t.after |

### Outstanding questions (ASKED, still unresolved)

None.

### 🛑 The weakest premise, named by me

**Two of five hooks are pinned by this branch** (`onPhase`, `onProgress`); a third
(`maySweepDownloads`) was already pinned by `#458`; `wantsProgress` is pinned in one
direction and not the other. **`cancelled` is genuinely unpinnable from outside**, and
that one IS measured rather than asserted: the mutation `cancelled: () => false` leaves
the suite at 3120/3120, and the reason is in the source (`engine/connect.js:1061` blocks
driver replacement by a second `start()`, and `cancel()` destroys the request directly).

⇒ **The card's headline, "4 of 5 can be wrong with the suite green", is reduced but NOT
closed by this branch, and anyone reading the card as closed would be wrong.** The card
comment says so.

### Strengths recorded by the blind reviewer

- The shipped assertion is uniquely load-bearing: dropping the zeroed progress leaves **3119 of 3120 passing, and the one failure is this test**. Nothing else in the suite catches it. That is the strongest form of the claim, not merely "the test reds" but "nothing else does".
- The "not delivered" section is accurate and was reproduced independently. Publishing a measured negative result, and deleting a test that passed with the mutation wired in rather than shipping it, is the right call and the right way to record it.
- The 17-contract-test claim checks out independently: every one enters through `installClaudeCode(stubs(over))` with a locally supplied hook set, which is exactly why the card's mutations went unnoticed and the right reason for this file to exist.
- Sandboxing every env root **above** the `require` line, with a comment naming the two modules that fix state at load, and the `clearClaudeConfig` note explaining that a signed-in machine short-circuits before the binary check. Neither is guessable from the code.
- No production edit: two new files, zero deletions, while `engine/connect.js` was being actively rewritten on main. That boundary was pre-committed and it held.
