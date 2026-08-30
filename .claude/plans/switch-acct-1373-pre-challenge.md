---
pre_challenge: true
method: challenge-loop
branch: switch-acct-1373
diff_hash: 42104cd97fb45017b1eb64ecb2650e0fe575603b78aebd578798af466f1f4c95
validation: passed
subdir_audit: passed
timestamp: 2026-08-30T14:30:32Z
iterations: 40
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 40
**Converged:** No (stopped at user request after iteration 40)
**Stopped by:** Splinter, 2026-08-30, verbatim: *"fix the plan/criteria contradiction, card the rest, SHIP. No 41. Two people are stacked on you."* The valve had been reported first with its gate line, `PAUSE STOP-ITERATION-VALVE - iteration count = 40`, and this is the answer to it.

### 🛑 The honest state of this record, stated before the numbers

**This proof does not carry a complete 40-row ledger, and I am not going to invent one.**
Detail for the recent iterations is below and is accurate. Detail for the earlier ones
lives in the branch's commit messages, each of which names the findings it fixed, and in
two preserved files (`~/.cache/claude-handoffs/ANGEL-1373-iteration-12-findings.md` and
`ANGEL-handoff-0915.md`). Several iterations ran in sessions whose task output died with
the session.

Writing a plausible-looking 40-row table from memory would be exactly the defect this
branch spent its last ten iterations removing: a record claiming more than its source
supports. The counts below are the ones I can stand behind.

**Total findings across the run:** 60+ recorded, no BLOCKERs at any point.
**Fixed:** all but two. **Carded:** 2 (#1599, #1600). **Asked:** 0.

### Per-Iteration Breakdown (the iterations I hold accurate records for)

#### Iteration 12
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] web/index.html:21855 - "the ENGINE refuses with a remedy" untrue of the empty-list case --> FIXED
- [WARNING] web/index.html:22144 - arm enumeration incomplete (zero-OpenAI-account machine) --> FIXED
- [NIT] docs/browser-checks/render-model-change.js:160 - negative arm does not test the reason its label names --> FIXED (label narrowed)
- [NIT] engine/create.js:1882 - "Both lift when phase 2..." has one referent after an edit --> FIXED
- [NIT] web/index.html:21900 vs :21908 - two comments on the innerHTML guard contradict each other --> FIXED
- [NIT] .claude/plans/switch-acct-1373.md - plan drift, test count and runner total --> FIXED

#### Iteration 39
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] server.js:2622 - the `partial` branch's account sentence had NO EXECUTED ARM. Every route test seeds a fake whose `has-session` reports the window gone, so all four land on the OK branch; the future-tense sentence was guarded only by a source regex, which is the exact mutation the route file exists to catch, left open one branch over --> FIXED (added an executed partial-branch test; both arms proven red)
- [WARNING] web/index.html:22439 - `SWITCH_ACCT_SAID` let-declared below both functions that write it, while the comment above its four siblings claimed the grouping "removes the hazard rather than documenting it" --> FIXED (moved into the group)
- [WARNING] web/index.html:22035 - two `/api/accounts` sequencers cannot see each other; the comment argued one direction and left the symmetric stale-success case unnamed --> FIXED (residual named as a trade)
- [CONVENTION] server.js:2996 - rewriting the caller comment left its tail orphaned, subject deleted, wrong indent --> FIXED
- [NIT] web/index.html:22785 - a 200 with an unparseable body tagged `serverRefused`, firing the live per-account re-read that flag exists to gate --> FIXED (`!res.ok` only)
- [NIT] docs/browser-checks/render-model-change.js:128 - comment at column 0 inside an indented body --> FIXED
- [NIT] engine/create.js:1002 - switching onto the DEFAULT OpenAI row pins its home into the launch job while creating on the same row does not --> CARDED (#1600), named at the call site

#### Iteration 40
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 1 NIT
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] web/index.html:22927 - an enumeration heading said THREE over four labels for an expression with eight arms --> FIXED (count dropped, invariant kept)
- [WARNING] docs/browser-checks/render-model-change.js:178 - "the six-arm sentence", the same count wrong a different way. Two comments named the same expression, disagreed with each other, and neither was right --> FIXED (count dropped)
- [WARNING] .claude/plans/switch-acct-1373.md:25 and :88 - the plan stated two acceptance criteria the branch ships a test AGAINST by name (`an unpicked account the engine cannot use falls back instead of refusing`). Both bullets were unqualified; the refusal is scoped to a PICKED account --> FIXED (both qualified, with the reason)
- [WARNING] web/index.html - the stale announcement is gated on `appearing`, covering appears-while-stale and not becomes-stale-while-visible, while the comment read as covering both --> COMMENT NARROWED, gap CARDED (#1599). No reachable path to the uncovered state was established.
- [NIT] web/index.html:22404 - the declaration heading still said FOUR after the fifth was added --> FIXED

### Final Ledger (the two findings that did not end in a fix)

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 39 | NIT | engine/create.js:1002 | Switch pins the default row's home into the plist; create does not | CARDED | #1600, named at the call site |
| 2 | 40 | WARNING | web/index.html | Stale-list announcement gated on `appearing` only | CARDED | #1599, comment narrowed to state the gap |

### Outstanding questions (ASKED, still unresolved)

None. No finding in this run was blocked on a decision I could not make.

### ✅ The weakest thing about this branch, and it is now CLOSED

**It was: every browser verification of #1373 came from a standalone run, and the check had
never run in the full harness with this code.** That mattered specifically because this
week's geometry failure was a configuration story, failing in the full harness and never
once standalone, so "passes standalone" is demonstrably not "passes in the harness" on this
box, and every green I had was in the arm that has historically been the forgiving one.

**Closed 2026-08-30 10:00 CDT, after 0.6.16 SERVED released the browser.** The FULL
harness, all 54 checks in sequence, not one check run alone:

```
  render-model-change   RAN (line 1230) and PASSED (line 1253)
  whole harness         1034 PASS, 0 FAIL, "all page checks passed"
  control               a check name that does not exist -> 0 hits
```

⚠️ **Run at `2f17ecac`, this branch's head, which is the PR's head.** A harness result at
somebody else's sha is evidence about a different program.

**And the screenshots are captured at that same sha**, by the harness itself rather than by
hand, written from inside `render-model-change` at the moment it asserts the picker is
visible. A stale pair was on disk from before nine iterations, including a change to the
control they show; it was NOT used, because a screenshot is a claim with no date on its
face.

📌 **They honestly show the one thing no automated arm can judge, and it is a real
trade-off Josh should see rather than discover:** with Claude selected the provider
dropdown and **Switch & Restart** sit on one line; with OpenAI selected the account picker
joins that row and the button WRAPS TO A SECOND LINE. The plan measured all three layout
options and kept A on the evidence (option C does not fix the wrap and truncates the label;
option B stretches the picker to 494px). The shift follows a deliberate click. It is
recorded rather than contested, and it is the part of this diff that wants a human eye.

### Strengths recorded by the blind reviewers (across iterations)

- `server.switch-account-1373.test.js` is load-bearing, proven by mutation: deleting `+ landedOn` reds 3 route tests while all 24 source-level assertions stay green.
- The fake runner is installed at the `run()` seam (checked before DRY_RUN) so the account block executes for real while launchctl and tmux are intercepted, and `engine/remove`'s separate runner is intercepted too. It answers `has-session` the way a real tmux does after a kill, so the OK branch is genuinely reached rather than assumed.
- Three page-side guards proven by mutation, including one the file's own header admits WAS decoration before an anchored rewrite fixed it.
- `engine/create.switch-account-1373.test.js` correctly states which mutation it cannot see rather than overstating its reach.
- Splitting `account` (which sign-in) from `picked` (whether a person chose) is a real bug fix, not a style choice: re-selecting the option a `<select>` already holds fires no `change`, and with one account it can never fire.
- The three-state account cache removes a class by construction: there is no longer a way to update one of the three globals without the others.
- `binPaths` was checked rather than assumed when `opts` flipped from `undefined` to an object.
