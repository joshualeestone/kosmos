# #1633: a behavioural arm for `canRunClaude`

**Branch:** `becomestuck-arm-1633` · **April, 2026-08-31**

## The problem, in one line

`becomeStuck` computes `canRunClaude` and writes it into the STUCK state; `web/index.html` gates the stuck screen's only way out on it (#1595). It is a user-facing decision made from a filesystem check, and nothing asserted it from a **driven** flow.

⚠️ **The gap is narrower than "nothing drives `becomeStuck`", and I originally wrote the wider claim by repeating the card without checking it.** Measured: 29 test files mention the stuck phase, and `engine/connect.test.js` drives real flows into it in roughly a dozen places (17 `PHASE.STUCK` references), as does `engine/connect.nobinary-1580.test.js`. What none of them does is assert `canRunClaude` **from a driven flow**.

🛑 **THE CENSUS IN THIS PARAGRAPH WAS WRONG UNTIL ITERATION 8 AND SAID "the two files".** There are **three**, and the one it omitted has the most references of any of them:

| file | references | how it asserts |
|---|---|---|
| `server.connect.test.js` | 3 | builds the state object by hand |
| `engine.publicview-canrun-1595.test.js` | 10 | builds the state object by hand |
| `engine.runnable-not-directory.test.js` | **38** | **asserts it as SOURCE TEXT**, reading `connect.js` off disk and matching the `writeState` line |

⭐ **I cite that third file by name later in this very plan as the comparison case, so I described it and never counted it.** That is the same defect as the 300-commit one below, one layer in: not a stale reading, an *uncounted* one. **None of the three calls `connect.start()`**, which is what this file adds and the only thing it claims.

## The decision, and why it is not the one I inherited

The card offered two shapes and its author leaned toward (2) without committing, asking whoever took it to **measure how hard (2) actually is first**. So the measurement came before the choice.

1. **Export `becomeStuck` + a `setDriverForTests`.** Smallest-looking change, matches the file's existing seam convention.
2. **Drive `start()` to failure with an injected runner.** No new production surface.

**Chose (2). Measured cost: one test file, zero production change.**

The argument against (1) is not fastidiousness. `becomeStuck` early-returns on `driver !== owner` so a flow the person **cancelled** cannot later write a STUCK record, and a stale flow's failure cannot tear down the healthy flow that replaced it. A seam letting a test set `driver` weakens precisely the mechanism whose job is refusing callers. Driving `start()` keeps that guard fully armed: the test's flow *is* the legitimate owner, which is why it reaches the write at all.

⇒ **The cost estimate in the card ("costs more to write and is more likely to be brittle") did not survive measurement.** `start`, `setRunner`, `setDryRun`, `state` and `resetForTests` are already exported, and `engine/connect.nobinary-1580.test.js` already drives the real `start()` against a sandboxed `store.ROOT`. The harness existed.

## What is built

`engine/connect.becomestuck-arm-1633.test.js`. **Three** arms whose sole variable is what sits at the bin path, which is the exact question `becomeStuck` asks the disk:

```
binary PRESENT   ->  phase=stuck  canRunClaude=true
binary ABSENT    ->  phase=stuck  canRunClaude=false
DIRECTORY there  ->  phase=stuck  canRunClaude=false
```

📌 **This section said "Two arms" and showed two rows until iteration 8**, while the third was introduced 40 lines further down. A reader who stopped at the summary undercounted the deliverable, and the third arm is the one carrying the argument for the branch.

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

🛑 **THE THIRD ARM WAS WRONG FOR TWO DAYS AND A REVIEW CAUGHT IT. THIS IS THE MOST IMPORTANT THING IN THIS PLAN.**

It originally asserted, as a deliberate characterisation, that a **directory** at the bin path reports `canRunClaude: true`, because `fs.accessSync(X_OK)` succeeds on a directory. I measured that and it was true.

**It was true only on this branch, which was 300 commits behind `origin/main`.** `#1592` had already replaced the bare `accessSync` with `claudeHatchAvailable()` -> `runners.isRunnable()` (which does `statSync().isFile()` first) on **2026-09-01**, a day before I wrote the arm. Current `connect.js` says so in as many words: *"There are NO bare-`accessSync` sites left in this file."*

⇒ **I also filed `kosmos#1859` for the defect. Somebody closed it the same day as already fixed.** The arm, the card and three of my comments all pointed at a defect that did not exist.

⭐ **The mistake was reading a subject that had moved, not reading it wrongly.** Every measurement I took was accurate about the bytes in front of me. This is `a-control-assumes-a-stable-subject`, and the cheap check I skipped was `git fetch` before treating a file as production.

✅ **Rebased onto current main, and the arm is FLIPPED rather than deleted.** It now asserts `canRunClaude === false` for a directory, from the driven flow. That is not redundant with `engine.runnable-not-directory.test.js`:

```
engine.runnable-not-directory.test.js   calls the helper directly, 0 start() calls
server.connect.test.js                  greps page source; builds state by hand
engine.publicview-canrun-1595.test.js   builds state by hand, 0 start() calls
this file                               drives the real start(), reads the STUCK record
```

**The unit guard stays green if `becomeStuck` stops calling the helper. This arm does not.** So the gap the card names is still real after the fix, which is why the branch still has a reason to exist.

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

## Findings from challenge-loop iteration 8

**Zero BLOCKERs, four WARNINGs, six NITs.** All four WARNINGs were confirmed against the code before
anything was changed, and one NIT was **measured and rejected**.

**Every WARNING was a false sentence in a comment, not a defect in the test.** That is worth stating
plainly: the arms have been sound since iteration 1; what keeps failing review is my prose about
them.

1. **The opening docblock named a mechanism production stopped using.** It said `canRunClaude` is
   `accessSync(claudeBinPath(), X_OK)`. Production writes `claudeHatchAvailable()` ->
   `resolveBin('claude').present` -> `isRunnable()`, which does `statSync().isFile()` FIRST
   (`connect.js:2446`, `runners.js:191`). `claudeBinPath()` is not on that path.
   🛑 **The third arm's docblock, 180 lines below, already retracted this correctly.** So the file
   contradicted itself and the wrong half was the half read first, which is the exact rule this
   branch states twice and had violated in its own opening paragraph.

2. **The census was wrong, and short by the file with the most references.** "The two files that
   reference the field" -> there are three, and `engine.runnable-not-directory.test.js` has 38
   references, more than the other two combined. It asserts the field as SOURCE TEXT rather than by
   building state. Corrected in both the test docblock and the plan.
   ⭐ **I cite that file by name as the comparison case both here and in the test.** I described it
   and never counted it.

3. **Same false census repeated verbatim in this plan.** Fixed.

4. **Three refusal paths in the shared fixture had no arm**, in the file whose own docblock says it
   "exists mostly for the refusal". Two are now armed; the third is recorded as deliberately unarmed:

   | path | status |
   |---|---|
   | `opts === null` / non-object / array | ✅ armed, and **proven red by mutation** |
   | `t` without `after` | ✅ armed, failure shape measured (below) |
   | pre-`listen` bind error | 📌 **unarmed, recorded** -- `listen(0)` takes an ephemeral port, so the collision cannot be produced through the public surface; arming it would test a stub of `http.createServer`, not the helper |

### The measurement that changed a claim I had already written

**Removing the `t.after` catch does NOT kill the process.** The helper's own comment said it did; I
wrote that comment and never measured it. Deleting the try/catch and running the file:

```
TypeError: t.after is not a function     thrown from the listen callback
10 of 11 arms                            STILL PASS
this arm                                 never settles
the FILE                                 fails after 119866ms with
                                         "Promise resolution is still pending but
                                          the event loop has already resolved"
```

⚠️ **So the failure is a two-minute hang attributed to the FILE, not a red on the arm.** That is
worse than a clean red rather than better: in CI a two-minute hang reads as a timeout or a flake,
and a flake is the one failure shape people retry instead of investigate. Both comments now state
the measured shape.

### The NIT I measured and turned down

Iteration 8 suggested moving the unknown-option guard **above** the `platformKey` guard, so that
`serveRelease(t, {chekcsum: 'x'})` reports the typo rather than the missing platformKey. Plausible,
and I applied it. **It broke an existing arm, and the break is the argument against it:**

`Object.keys()` on a **Buffer** returns its numeric indices. So the sibling positional shape
`serveRelease(t, Buffer.from('x'))` -- `connect.nobinary-1580`'s call, the likeliest migration
mistake there is -- stopped reporting *"needs a platformKey string"* and started reporting
*"unknown option(s): 0, 1, ..."*, which names nothing a caller can act on.

⇒ **Reverted, with the measurement recorded at the guard** so the next reviewer does not re-propose
it. The typo case it would have helped already has its own arm and is answered correctly under
either ordering, so the swap traded a real regression for no gain.

⭐ **The reusable half: the NIT's reasoning was sound and its conclusion was wrong, and only running
it separated the two.** A reordering that "just changes which message you see first" changes it for
every shape, not only the shape you had in mind.
