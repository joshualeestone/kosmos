# #1633: a behavioural arm for `canRunClaude`

**Branch:** `becomestuck-arm-1633` · **April, 2026-08-31**

## The problem, in one line

`becomeStuck` computes `canRunClaude` and writes it into the STUCK state; `web/index.html` gates the stuck screen's only way out on it (#1595). It is a user-facing decision made from a filesystem check, and nothing asserted it from a **driven** flow.

⚠️ **The gap is narrower than "nothing drives `becomeStuck`", and I originally wrote the wider claim by repeating the card without checking it.** Measured, with the command rather than the bare figure, **because this plan argues two sections below that a changing number belongs beside the way to reproduce it and this one had neither treatment**:

```
git grep -lil stuck origin/main -- '*.test.js' | wc -l   ->  30
git grep -lil stuck HEAD        -- '*.test.js' | wc -l   ->  31   (this branch adds exactly one file)
```

⚠️ **The original figure here was 29 and is not reproducible today**; it was true when written against an older main. **An earlier draft of this very correction guessed "29 before this file and one other landed" -- also unmeasured, and wrong: the delta is one file, not two.** That is the third round in which a fix to a counting claim introduced a fresh counting claim, so the command is given and the figure is left to move. Roughly thirty test files mention the stuck phase, and `engine/connect.test.js` drives real flows into it in roughly a dozen places (17 `PHASE.STUCK` references), as does `engine/connect.nobinary-1580.test.js`. What none of them does is assert `canRunClaude` **from a driven flow**.

🛑 **THE CENSUS IN THIS PARAGRAPH WAS WRONG UNTIL ITERATION 8 AND SAID "the two files".** There are **three**, and the one it omitted has the most references of any of them:

| file | references | how it asserts |
|---|---|---|
| `server.connect.test.js` | 3 | builds the state object by hand |
| `engine.publicview-canrun-1595.test.js` | 10 | builds the state object by hand |
| `engine.runnable-not-directory.test.js` | **38** | **asserts it as SOURCE TEXT**, reading `connect.js` off disk and matching the `writeState` line |

⭐ **I cite that third file by name later in this very plan as the comparison case, so I described it and never counted it.** That is the same defect as the 300-commit one below, one layer in: not a stale reading, an *uncounted* one. 🛑 **AND THE SENTENCE ITERATION 8 PUT HERE TO REPLACE THE MISCOUNT WAS ITSELF FALSE.** It read *"none of the three calls `connect.start()`"*. `server.connect.test.js` **does** call it, at its `:251` and `:749`. The true and narrower claim is that **none of the three asserts `canRunClaude` DOWNSTREAM of a `start()`** -- its three sites there are a source grep (`:797`) and two hand-built harness states (`:1146`, `:1170`), none of them reached by the flow. Driving `start()` and reading the settled STUCK record is what this file adds, and the only thing it claims.

⭐ **A false sentence introduced BY a fix is the shape to watch on this branch.** Iteration 8 corrected a census and, in the same edit, wrote a new claim it had not measured. The table above was already right; only the prose beside it was wrong.

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

**All THREE arms proven red by mutation**, because no single constant satisfies the set:

```
baseline                            3 arms pass
force canRunClaude = false          PRESENT goes red
force canRunClaude = true           ABSENT goes red
drop isFile() gate (runners.js)     DIRECTORY goes red, other two STAY GREEN
```

🛑 **THE THIRD ROW WAS MISSING UNTIL ITERATION 9, AND IT IS THE ARM THIS PLAN CALLS "the one carrying the argument for the branch".** Iteration 8 corrected the identical undercount in *What is built* and left this section untouched, so the strongest arm sat with **no recorded proof at all** while the section above it advertised three. **Fixing one instance of a miscount is not fixing the miscount.**

⭐ **The DIRECTORY mutation is the discriminating one, which is why it is worth its own row.** Replacing `if (!st.isFile()) return false` in `engine/runners.js:194` with `if (false)` restores the pre-#1592 behaviour, where `accessSync(X_OK)` succeeds on a directory. Measured: **only the DIRECTORY arm reddens; PRESENT and ABSENT both stay green.** That is what establishes the arm guards the #1592 fix specifically rather than restating the other two.

`engine/connect.js` and `engine/runners.js` both restored clean after each mutation (`git status --porcelain` empty, and a `grep -c 'if (false)'` returning 0 as a negative control).

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

Covers the **install-failure** path into `becomeStuck`: `installClaudeCode` (`connect.js:1378`) returns a failure via `fail('Claude downloaded but did not finish setting itself up', ...)` at **`connect.js:1549`**, which is surfaced by `if (!res.ok) { becomeStuck(owner, res.message, res.detail); return; }` at **`connect.js:1708`**.

🛑 **BOTH NUMBERS IN THIS PARAGRAPH WERE WRONG UNTIL ITERATION 9**, in the section whose entire job is pinning the exercised path. It cited `:1376`, which is a comment line inside the preceding docblock, and `:1458`, which is inside an unrelated `.part` sweep loop. **A maintainer following either one lands on a different mechanism and concludes the arms exercise something they do not.**

🛑 **I first named this the `runFlow` catch-all, and that was wrong.** (The catch-all is `becomeStuck(owner, 'something went wrong that we did not plan for', ...)` at **`connect.js:1283`**. This retraction cited `:1137` until iteration 9, which is a `publicView(writeState(...))` line -- **a retraction that names the wrong location cannot be checked by the next reader**, which is most of what a retraction is for.) The catch-all fires only on an unexpected throw and carries a different message. The arms now assert on `because` so the trigger is pinned rather than assumed, which is also what would have caught the missing release server on the first run. The other trigger sites are **not** separately exercised and this does not claim they are. The card asked for the field to have *a* behavioural arm; it now has one, on a path that reaches it.

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

## Findings from challenge-loop iteration 9

**Zero BLOCKERs, ten WARNINGs, three NITs.** Every WARNING was again a false or stale sentence in
prose rather than a defect in a test, and **four of them were sentences iteration 8 wrote or left
standing.**

### The pattern that iteration 9 actually exposed

🛑 **A FIX TO A COUNTING CLAIM KEEPS INTRODUCING A FRESH COUNTING CLAIM. Three rounds now:**

| round | the fix | what it introduced |
|---|---|---|
| 8 | corrected "the two files reference `canRunClaude`" to three | wrote **"none of the three calls `connect.start()`"**, which is false: `server.connect.test.js` calls it at `:251` and `:749` |
| 8 | corrected "Two arms" in *What is built* | left the **identical undercount** in *Verification*, where it mattered more |
| 9 | corrected the unreproducible "29 test files" | first draft guessed **"29 before this file and one other landed"** -- also unmeasured, and wrong: the delta is one file |

⭐ **The reusable half: the danger is not the stale sentence, it is the CONFIDENCE of the edit that
replaces it.** Correcting a miscount feels like the moment you are most careful about counting, and
it is measurably the moment a new miscount gets written. **Measure the replacement, not just the
thing being replaced.**

⭐ **And fixing ONE instance of a miscount is not fixing the miscount.** *What is built* and
*Verification* carried the same wrong number; iteration 8 fixed the first, read the section as
closed, and left the second. **Grep for the claim, do not fix the line you were shown.**

### The substantive finding, and it was not prose

**The DIRECTORY arm had no recorded mutation proof.** The *Verification* table still described a
two-arm branch, so the arm this plan calls "the one carrying the argument for the branch" was the
one arm with nothing behind it. **Now proven, and it is the discriminating mutation:**

```
drop `if (!st.isFile()) return false` in engine/runners.js:194
  -> DIRECTORY arm REDDENS
  -> PRESENT and ABSENT both STAY GREEN
```

That is what establishes the arm guards the #1592 fix specifically rather than restating the other
two. `engine/runners.js` restored clean afterwards, verified by `git status --porcelain` empty and
`grep -c 'if (false)'` returning 0 as a negative control.

### The rest, in one line each

- **"None of the three calls `connect.start()`"** -- false in the test file and the plan. The true,
  narrower claim: none asserts `canRunClaude` **downstream of** a `start()`. Corrected in both.
  📌 The plan's own comparison table was already right and annotated only the two files it could
  vouch for; **the prose beside it overreached. The table and the prose disagreed and the prose was
  wrong.**
- **The closing docblock still said "THE PAIR IS THE POINT"** and pointed at "the card" for a
  mutation transcript that lives in this plan and covered two arms. Rewritten for three.
- **"Two of the sibling copies take a checksum"** -- all three do
  (`connect.nobinary-1580.test.js:42`, `connect.test.js:147`, `connect.install-997.test.js:44`).
  ⚠️ **This recurred in the same comment that documents having got this exact count wrong before**,
  and in the test docblock that repeats it.
- **The `serveRelease` census table understated its OWN signature by one field**, omitting
  `checksum` -- which is a known option, is honoured rather than overridden, has its own guard and
  has two arms. A table whose entire job is telling a migrator what each shape accepts.
- **"Its siblings each have a test"** -- false; three of the six helpers in `test-support/` have
  none. Replaced with the measured table.
- **Four wrong `connect.js` line numbers**, two of them in *Scope*, the section whose whole job is
  pinning the exercised path. `:1376` is a comment line and `:1458` is an unrelated `.part` sweep
  loop; the real path is `installClaudeCode` at `:1378` -> `fail(...)` at `:1549` -> `becomeStuck`
  at `:1708`. The retraction below it cited `:1137` for a catch-all that lives at `:1283`.
  🛑 **A retraction that names the wrong location cannot be checked by the next reader, which is
  most of what a retraction is for.**

### Two NITs worth keeping

- **The arms are macOS-only and nothing said so.** On Linux `download()` throws on the platform
  gate, `installClaudeCode` converts that to "we could not download Claude", and all three arms red
  on the `because` match **with a message that reads as a product fault**. CI is `macos-latest` so
  it is not live; it is recorded because the reader who eventually sees that red would go hunting in
  `becomeStuck`.
- **A comment abbreviated production's version regex** to `^\d+\.\d+\.\d+` where the guard below
  copies `^\d+\.\d+\.\d+[A-Za-z0-9.-]*$` exactly. The code was right and only the comment was loose,
  but it would read as the fixture being more permissive than the production it mirrors.
