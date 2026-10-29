---
pre_challenge: true
method: challenge-loop
branch: parentclose-7514
diff_hash: b2286fd04c15e0c18dee27e3e176554b211a7714d46d15c78a4a21baca05ebd4
validation: passed
subdir_audit: passed
timestamp: 2026-10-29T03:00:46Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8, each a fresh blind reviewer, models varied (opus, sonnet, fable). Round 8 reviewed the whole branch with nothing settled and found nothing above NIT.

- **Round 1 (opus):** the first build was a silent cascade, which overrode #3951 and #6421. Redesigned as an opt-in `--with-built` (5f7d8a5370). Also: one raw read, one roster, the telling tested.
- **Round 2 (sonnet):** a partial failure hid the parent close; every close paid a read; a repeat was not re-checked; test gaps (flag order, zero-pad, grandchild). Fixed in 143872f038.
- **Round 3 (fable):** the via line was not rendered; the hint re-closed the parent; two rosters; older-board message; a silent catch; a duplicated predicate. Fixed in c610e8e447.
- **Round 4 (opus):** BLOCKER, the page's tkActPhrase copy was not updated. Also a stale plan, a multi-close hint naming a subtask closed later, failure-after-write counted left. Fixed in 2186ce7a0f.
- **Round 5 (sonnet):** 0 new, NITs only.
- **Validation -e then failed** on the #4273 leak check alone (every test passed): the new engine test lacked tmpscope. Fixed in 0e0bd781f8. That failure reopened the loop.
- **Round 6 (fable):** an older board silently ignored `--with-built`; the phone's Swift phrase copy was not updated. Fixed in 61cd05c1c0 (`closedWith` is always answered under withBuilt; Swift arm pinned in the iOS logic tests).
- **Round 7 (opus):** a held child's built subtree still closed; the route's lookup after the close could answer "could not close"; a partial close exited 0; the older-board match caught today's catch-all. Fixed in b9c5a16ea8.
- **Round 8 (sonnet):** nothing above NIT.

### Per-Iteration Breakdown

#### Iteration 1 (blind agent, opus)
- [WARNING] engine/tasks.js close -- built subtasks closed as a silent cascade, overriding #3951 and #6421 --> FIXED (redesigned opt-in --with-built, 5f7d8a5370)
- [WARNING] page and phone Mark as done changed silently --> FIXED (resolved by opt-in)
- [WARNING] a projects.get per close --> FIXED (one raw readAll)
- [WARNING] a roster per subtask --> FIXED (one roster)
- [WARNING] telling the subtasks' agents untested --> FIXED (syncAgent spy test)
- [NIT] re-check inside the write, via line, doctrine comment --> FIXED

#### Iteration 2 (blind agent, sonnet)
- [WARNING] a partial failure hid the parent close --> FIXED (catch + builtLeft)
- [WARNING] every close paid a read --> FIXED (wantLeft opt-in)
- [WARNING] a repeat was not re-checked --> FIXED (one predicate)
- [WARNING] test gaps: flag order, zero-pad, grandchild --> FIXED (143872f038)

#### Iteration 3 (blind agent, fable)
- [WARNING] via line not rendered --> FIXED (phrase arm)
- [WARNING] the hint re-closed the parent, moving closedAt --> FIXED (hint names subtasks)
- [WARNING] two rosters --> FIXED (one)
- [WARNING] older-board message missing in both CLIs --> FIXED
- [WARNING] a silent catch --> FIXED (builtLeftWhy)
- [CONVENTION] duplicated predicate --> FIXED (isBuiltOpen shared with treeOf; c610e8e447)

#### Iteration 4 (blind agent, opus)
- [BLOCKER] web/index.html tkActPhrase copy not updated, parity fixture missing --> FIXED
- [WARNING] plan's hint text stale --> FIXED
- [WARNING] a multi-close hint named a subtask closed later in the same command --> FIXED (both CLIs filter)
- [WARNING] a failure after the write counted as left --> FIXED (re-check; 2186ce7a0f)

#### Iteration 5 (blind agent, sonnet)
- [NIT] grandchild race under a child that stops being built --> documented (snapshot comment)
- [NIT] wantLeft cost on the task route --> documented
- [NIT] zero-pad regex untested for builtLeft --> deferred (engine never emits it)

Validation parentclose-7514-e then failed on the #4273 leak check alone (every test passed): the new engine test lacked tmpscope --> FIXED (0e0bd781f8). That failure reopened the loop.

#### Iteration 6 (blind agent, fable)
- [WARNING] install/kosmos, kosmos-cli.js -- a board older than #6923 ignores the body, so --with-built closed the parent as done and took nothing, silently --> FIXED (closedWith always answered under withBuilt; both CLIs exit 1; 61cd05c1c0)
- [WARNING] ios/Kosmos/TaskPageLogic.swift -- the phone's phrase copy still said "Marked done" --> FIXED (Swift arm, pinned in ios/LogicTests/taskpage)
- [NIT] wantLeft read on every route close --> documented
- [NIT] roster fetched twice on failure --> deferred
- [NIT] older-board match too loose --> FIXED in iteration 7
- [NIT] builtLeftWhy carries a raw error in a 200 --> deferred (same class as the route's 4xx)

#### Iteration 7 (blind agent, opus)
- [WARNING] engine/tasks.js -- a child held after the read kept itself open but its built grandchild closed --> FIXED (subtree skipped by walk order)
- [WARNING] server.js -- the lookup after the close could throw and answer "could not close" --> FIXED (non-gating)
- [WARNING] both CLIs -- a partial --with-built close exited 0 --> FIXED (exit 1, one and several)
- [NIT] older-board match caught today's "could not read that request" --> FIXED (exact old sentences; b9c5a16ea8)
- [NIT] extra read per plain close --> documented
- [NIT] hint quoting differs between CLIs --> deferred

#### Iteration 8 (blind agent, sonnet, whole branch, nothing settled)
No issues above NIT found.
- [NIT] a "still open" hint can be missed when two failures land in one command --> deferred
- [NIT] the Mac command cuts builtLeftWhy at an escaped quote (exit code still 1) --> deferred
- [NIT] wantLeft read on every plain close --> documented

**Deferred, NIT only:** a "still open" hint can be missed when two failures land in one command; the Mac command cuts a `builtLeftWhy` at an escaped quote (exit code still 1); every plain close reads the store once more (documented).

**Mutation:** 37 perturbations, each turned a test red (17 + 3 + 10 + 2 + parity, then 10 in round 6, 9 in round 7, Swift included).

**Validation:** parentclose-7514-g on b9c5a16ea8 passed (25579 node tests, 0 failed; shell shards green; build ok; no leak), 2026-10-28 21:59 CDT. A merge with kosmos main (39 commits on) was clean, and 42 affected and source-scanning files passed 401/401 on the merged tree.
