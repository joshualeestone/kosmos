# #1633: a behavioural arm for `canRunClaude`

**Branch:** `becomestuck-arm-1633` · **April, 2026-08-31**

## The problem, in one line

`becomeStuck` computes `canRunClaude` and writes it into the STUCK state; `web/index.html` gates the stuck screen's only way out on it (#1595). It is a user-facing decision made from a filesystem check, and nothing asserted it from a **driven** flow.

⚠️ **The gap is narrower than "nothing drives `becomeStuck`", and I originally wrote the wider claim by repeating the card without checking it.** Measured: 29 test files mention the stuck phase, and `engine/connect.test.js` drives real flows into it in roughly a dozen places (17 `PHASE.STUCK` references), as does `engine/connect.nobinary-1580.test.js`. What none of them does is assert `canRunClaude`: the two files that reference the field (`server.connect.test.js`, `engine.publicview-canrun-1595.test.js`) build the state object by hand. This closes that, and only that.

## The decision, and why it is not the one I inherited

The card offered two shapes and its author leaned toward (2) without committing, asking whoever took it to **measure how hard (2) actually is first**. So the measurement came before the choice.

1. **Export `becomeStuck` + a `setDriverForTests`.** Smallest-looking change, matches the file's existing seam convention.
2. **Drive `start()` to failure with an injected runner.** No new production surface.

**Chose (2). Measured cost: one test file, zero production change.**

The argument against (1) is not fastidiousness. `becomeStuck` early-returns on `driver !== owner` so a flow the person **cancelled** cannot later write a STUCK record, and a stale flow's failure cannot tear down the healthy flow that replaced it. A seam letting a test set `driver` weakens precisely the mechanism whose job is refusing callers. Driving `start()` keeps that guard fully armed: the test's flow *is* the legitimate owner, which is why it reaches the write at all.

⇒ **The cost estimate in the card ("costs more to write and is more likely to be brittle") did not survive measurement.** `start`, `setRunner`, `setDryRun`, `state` and `resetForTests` are already exported, and `engine/connect.nobinary-1580.test.js` already drives the real `start()` against a sandboxed `store.ROOT`. The harness existed.

## What is built

`engine/connect.becomestuck-arm-1633.test.js`. Two arms whose sole variable is whether an executable exists at the bin path, which is the exact question `becomeStuck` asks the disk:

```
binary PRESENT  ->  phase=stuck  canRunClaude=true
binary ABSENT   ->  phase=stuck  canRunClaude=false
```

## Verification

**Both arms proven red by mutation**, because either assertion alone is satisfied by a constant:

```
baseline                       2 arms pass
force canRunClaude = false     1 passes   <- PRESENT arm goes red
force canRunClaude = true      1 passes   <- ABSENT arm goes red
```

`connect.js` restored clean after each mutation (`git status --porcelain` on it empty).

**Full suite, via the repo's own runner rather than a glob** (`bash tools/run-tests.sh`): green, 0 failures.

🛑 **NO TEST TOTAL IS QUOTED HERE, DELIBERATELY, AND THAT IS THE SECOND-ORDER LESSON OF THIS BRANCH.** Two consecutive reviews caught this section quoting a stale count, each time in a paragraph whose whole argument rests on the number. It went 3254 -> 3258 -> 3261 -> 3264 as arms were added, and every quoted figure was true when written and false an hour later. **A number that changes every commit does not belong in a document that does not.** Reproduce it instead:

```
bash tools/run-tests.sh          # the runner the repo defines
node --test engine/*.test.js *.test.js   # what line 103 actually globs
```

⭐ **THE FINDING THE NUMBER WAS EVIDENCE FOR SURVIVES WITHOUT IT, and it is the reusable half.** The fixture's tests were first placed in `test-support/`, which `tools/run-tests.sh:103` does not glob: it takes `engine/` and the repo root and nothing else. **Tests were written and the suite total did not move.** A test that never runs is worse than no test, because it reports coverage it does not provide. It was caught only by reading the count rather than the colour, and it is fixed by placing the file at the root beside `test-support.code-only.test.js`.

⚠️ **On the shell portion, stated precisely because an earlier figure was not:** the run prints two `Results:` lines, and their totals are **not** a count of shell tests. `test:shell` executes far more scripts than that; most do not print a `Results` line. Quoting it as a total would be a number with no defensible meaning.

📌 **One arm here asserts a defect rather than a correctness property, on purpose.** A directory at the bin path passes `fs.accessSync(X_OK)` (measured, with both controls: directory passes, real executable passes, missing path ENOENT), so `canRunClaude` reports `true` and the stuck screen offers a way out that cannot work, which is the #205 harm the field exists to prevent. The arm pins the CURRENT behaviour and says so in its own failure message, because asserting the correct one would redden the suite for a production defect this card is not fixing. When somebody tightens that check, the arm reddens and tells them what to change.

## One trap, recorded because it costs an hour to rediscover

**The injected runner must RETURN a failure, never throw.** `becomeStuck` calls the runner on its way out via `killSession()`, but that call is fire-and-forget through two async frames, so a synchronous throw becomes a **rejected promise** rather than an exception that unwinds the function.

**Measured:** with a throwing runner the STUCK record is still written (`phase=stuck canRunClaude=false`). What reddens the file is the unhandled rejection, reported at process level with a stack through `becomeStuck -> killSession -> tmux -> run` that reads as though the flow never arrived.

`run()` resolving `{ok:false}` and never rejecting is the contract the rest of the file already relies on.

📌 **This section previously stated the opposite mechanism** (that the throw pre-empts the assertion). That sentence is deleted rather than annotated, per the rule `engine/connect.js` states twice in the code under review: a wrong sentence left standing above its own retraction is read first.

## Scope, stated so nobody reads it wider

Covers the **install-failure** path into `becomeStuck`: `installClaudeCode` returns a failure (`connect.js:1376`) which is surfaced by `if (!res.ok) becomeStuck(owner, res.message, res.detail)` at `connect.js:1458`.

🛑 **I first named this the `runFlow` catch-all at `connect.js:1137`, and that was wrong.** The catch-all fires only on an unexpected throw and carries a different message. The arms now assert on `because` so the trigger is pinned rather than assumed, which is also what would have caught the missing release server on the first run. The other trigger sites are **not** separately exercised and this does not claim they are. The card asked for the field to have *a* behavioural arm; it now has one, on a path that reaches it.

## Process note against myself

This plan is written **after** the code, which inverts the convention. The card's explicit instruction was to measure before choosing, and I did that first; the plan should still have been written before the test file rather than after. Recorded rather than papered over.

## Findings from challenge-loop iteration 1, and what they cost

**One BLOCKER, and it was real.** The first version of the test never set `AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE`, so both arms drove the real `download()` against `https://downloads.claude.ai` on every suite run. `download()` is plain `https.get`, so the injected runner never touches it.

Measured, both arms:

```
base UNSET (as first committed)   5483 ms / 5257 ms
base -> dead local port             67 ms /   63 ms
```

⇒ **80x, and it was entirely network.** Both arms passed in **both** configurations, so the green never depended on the fixture and could not have revealed this. `engine/connect.nobinary-1580.test.js` carries a standing warning about exactly this, which I had read and did not apply.

**And the docblock's explanation of the throwing-runner trap was wrong.** The advice ("return, never throw") was right and the mechanism was not, and the wrong mechanism had already been repeated into the card comment and the PR body before it was caught. The corrected version is above; the wrong sentence is deleted rather than kept beside it.
