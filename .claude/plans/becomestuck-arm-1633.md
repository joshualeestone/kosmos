# #1633: a behavioural arm for `canRunClaude`

**Branch:** `becomestuck-arm-1633` · **April, 2026-08-31**

## Read this first, then skip to what you need

**What ships:** three arms in `engine/connect.becomestuck-arm-1633.test.js` driving the real
`start()` into an install failure and reading `canRunClaude` off the settled STUCK record, plus a
shared `test-support/release-fixture.js` and its own test. **Zero production change.**

**Why it is not redundant, in one sentence:** these are the only assertions in the repo that ASSERT
`canRunClaude` downstream of a real `start()`. (**The verb and the phrase are load-bearing** -- other
files call `start()`, other files reference the field, none does both on one path. Every looser
wording of this claim has been false, twice.)

**Where to look:**

| you want | section |
|---|---|
| the design decision and what it rejected | *The decision* |
| why the branch is worth keeping, with the mutation table | *What actually justifies the branch* |
| the traps that cost an hour each | *One trap*, and the docblocks in the test file |
| **what this branch got wrong and how** | the ten `Findings from challenge-loop iteration N` sections |

🛑 **THE ITERATION LOG IS ROUGHLY TWO THIRDS OF THIS FILE AND THAT IS DELIBERATE, NOT NEGLECT.** An
accepted review finding required stripping process history from the three CODE files precisely so it
would live here instead. **This is where it was sent.** It is skippable by design: nothing above it
depends on it. ⭐ It is also the most reusable part of the branch -- seventeen rounds in which the
recurring defect was never the tests but the sentences about them, including four rounds where the
sentence justifying the branch's own existence was false.

## The problem, in one line

`becomeStuck` computes `canRunClaude` and writes it into the STUCK state; `web/index.html` gates the stuck screen's only way out on it (#1595). It is a user-facing decision made from a filesystem check, and nothing asserted it from a **driven** flow.

⚠️ **The gap is narrower than "nothing drives `becomeStuck`", and I originally wrote the wider claim by repeating the card without checking it.** Measured, with the command rather than the bare figure, **because this plan argues two sections below that a changing number belongs beside the way to reproduce it and this one had neither treatment**:

```
git grep -lil stuck origin/main -- '*.test.js' | wc -l   ->  30
git grep -lil stuck HEAD        -- '*.test.js' | wc -l   ->  31   (this branch adds exactly one file)
```

⚠️ **The original figure here was 29 and is not reproducible today**; it was true when written against an older main. **An earlier draft of this very correction guessed "29 before this file and one other landed" -- also unmeasured, and wrong: the delta is one file, not two.** That is the third round in which a fix to a counting claim introduced a fresh counting claim, so the command is given and the figure is left to move. Roughly thirty test files mention the stuck phase, and `engine/connect.test.js` drives real flows into it in roughly a dozen places (17 `PHASE.STUCK` references), and `engine/connect.nobinary-1580.test.js` in a handful more (4 stuck references in total, not the same order of magnitude). What none of them does is assert `canRunClaude` **from a driven flow**.

🛑 **THE CENSUS IN THIS PARAGRAPH WAS WRONG UNTIL ITERATION 8 AND SAID "the two files".** There are **three**, and the one it omitted has the most references of any of them:

**Reproduce the census** (the test file points here for exactly this, so the command belongs here):

```
git grep -c canRunClaude -- '*.test.js'
```

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

`engine/connect.becomestuck-arm-1633.test.js`. **Three** arms whose only *behavioural* variable is what sits at the bin path, which is the exact question `becomeStuck` asks the disk. (The bin path itself also differs per arm, for isolation; the test file records why at the call site.)

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
force canRunClaude = true           ABSENT and DIRECTORY both go red
drop isFile() gate (runners.js)     DIRECTORY goes red, other two STAY GREEN
```

🛑 **THE THIRD ROW WAS MISSING UNTIL ITERATION 9, AND IT IS THE ARM THIS PLAN CALLS "the one carrying the argument for the branch".** Iteration 8 corrected the identical undercount in *What is built* and left this section untouched, so the strongest arm sat with **no recorded proof at all** while the section above it advertised three. **Fixing one instance of a miscount is not fixing the miscount.**

⭐ **The DIRECTORY mutation is the discriminating one, which is why it is worth its own row.** Replacing `if (!st.isFile()) return false` in `engine/runners.js:194` with `if (false)` restores the pre-#1592 behaviour, where `accessSync(X_OK)` succeeds on a directory. Measured: **only the DIRECTORY arm reddens; PRESENT and ABSENT both stay green.** That is what establishes the arm guards the #1592 fix specifically rather than restating the other two.

`engine/connect.js` and `engine/runners.js` both restored clean after each mutation, verified by `git status --porcelain` being empty. (A `grep -c 'if (false)'` returning 0 agrees with that but is a confirmation, not a control: see the note in the iteration 9 section.)

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

**It was true only on this branch, which was 300 commits behind `origin/main`.** `#1592` replaced the bare `accessSync` with `claudeHatchAvailable()` -> `runners.isRunnable()` (which does `statSync().isFile()` first). Current `connect.js` says so in as many words: *"There are NO bare-`accessSync` sites left in this file."*

🛑 **THE DATE IN THIS PARAGRAPH WAS BACKWARDS UNTIL ITERATION 10, AND IT SAID "2026-09-01, a day before I wrote the arm" WHILE THIS PLAN'S OWN HEADER DATES THE WORK 2026-08-31.** It contradicted the document it sits in, in the section this plan calls the most important thing in it. Measured from git rather than remembered:

```
2026-08-30 08:45   #1592 fix AUTHORED (c16c9f23, "directory can never pass again")
2026-08-31 09:29   this arm written              <- fix existed, but NOT on main
2026-09-01 02:38   #1592 reaches origin/main
2026-09-02 10:46   kosmos#1859 filed             <- fix on main for ~32 hours
2026-09-02 11:07   closed as already-fixed
```

📌 The sha above was `fed47fc5` until iteration 11. That commit is the later extraction into `claudeHatchAvailable()` and **its own before-state already used `isRunnable`**; `c16c9f23` is the one that replaced the bare `accessSync`. Both carry committer date 2026-09-01 02:38, so every date and the whole conclusion are unaffected -- only the citation was wrong.

⭐ **AND THE CORRECTED TIMELINE SHARPENS THE LESSON RATHER THAN SOFTENING IT.** Writing the arm on 08-31 was defensible: the fix was authored but had not reached main, so **a `git fetch` that morning would not have shown it**. **Filing the card on 09-02 was the defect** -- by then it had been on main for 32 hours and one fetch would have settled it. ⇒ **The failure was not "my worktree was stale". It was "my worktree was stale AT THE MOMENT I MADE THE CLAIM"**, which is the only version of the rule that discriminates, since the same worktree was innocent a day earlier.

⚠️ **`git log` shows two dates and they disagree by up to two days here.** Author date is when the work was done; committer date is when it landed after a rebase-merge. **Say which one you mean**, or the ordering you publish is a coin flip.

⇒ **I also filed `kosmos#1859` for the defect. Somebody closed it the same day as already fixed.** The arm, the card and three of my comments all pointed at a defect that did not exist.

⭐ **The mistake was reading a subject that had moved, not reading it wrongly.** Every measurement I took was accurate about the bytes in front of me. This is `a-control-assumes-a-stable-subject`, and the cheap check I skipped was `git fetch` before treating a file as production.

✅ **Rebased onto current main, and the arm is FLIPPED rather than deleted.** It now asserts `canRunClaude === false` for a directory, from the driven flow. That is not redundant with `engine.runnable-not-directory.test.js`:

```
engine.runnable-not-directory.test.js   calls the helper directly, 0 start() calls
server.connect.test.js                  greps page source; builds state by hand
engine.publicview-canrun-1595.test.js   builds state by hand, 0 start() calls
this file                               drives the real start(), reads the STUCK record
```

🛑 **THAT SENTENCE USED TO READ "The unit guard stays green if `becomeStuck` stops calling the helper. This arm does not." IT WAS EXACTLY BACKWARDS, AND IT WAS THE STATED JUSTIFICATION FOR THE BRANCH.** Iteration 11 caught it; the measurement below settles it.

🛑 **THE TABLE BELOW REPLACES ONE BUILT FROM A HAND-PICKED COLUMN SET, AND THE SET IS WHAT MADE IT WRONG.** I chose columns by *which files mention `canRunClaude`*. `engine/connect.test.js` does not mention it, was therefore excluded, and **is one of the tests that falsifies the old claim.** ⇒ **Choosing the column set is choosing the answer.** Every row below is measured by running the **entire suite** under the mutation and reading which tests redden.

| mutation | tests that redden, whole suite | unique here? |
|---|---|---|
| control (none) | none (3765 pass) | n/a |
| **M1** behaviour-preserving refactor of the writeState line | `runnable-not-directory` only | no, and these arms correctly stay GREEN |
| **M2** drop the `isFile()` gate | `runnable-not-directory` + the DIRECTORY arm | no |
| **M3** `publicView` drops the field | `publicview-canrun-1595` + the PRESENT arm | no |
| **M4** install failure never reaches `becomeStuck` (`connect.js:1708`) | **5 tests**: all three arms here, `connect.test.js` "a stuck install does not strand the 281MB download", `nobinary-1580` "#1580: a DIRECTORY at the binary path" | **NO** |
| **M5** `writeState` loses the field in transit | **1 test: the PRESENT arm here** | **YES** |

### What actually justifies the branch, stated so it does not need a mutation to hold

🛑 **THE JUSTIFICATION IS A STRUCTURAL FACT, NOT A MUTATION RESULT, AND THIS IS THE FOURTH VERSION OF IT.** The first three each leaned on a chosen mutation and each was wrong or overstated.

⭐ **These are the only assertions in the repo that read `canRunClaude` downstream of a real `start()`.** Reproducible in one command (`git grep -c canRunClaude -- '*.test.js'`): four files reference the field, and the other three reach it by three different instruments, none of them a driven flow: **build the state object by hand** (`publicview-canrun-1595`, and two of `server.connect.test.js`'s three sites), **match the PAGE source** (`server.connect.test.js:797` slices `web/index.html`, **not** `connect.js`), or **match `connect.js` as source text** (`runnable-not-directory`). **That is true by inspection and needs no mutation to establish.**

📌 That sentence said "match `connect.js` as source text" for all of them until iteration 14. The conclusion is unaffected -- a page grep is no more downstream of a `start()` than a `connect.js` grep -- but it named the wrong file **in the sentence carrying the branch**, while this plan's own comparison table twenty lines up said "greps page source" correctly. **The plan disagreed with itself, and the prose was the wrong half. Again.**

**M5 then confirms it is not redundant**, rather than being the argument itself: make `writeState` drop the field while leaving both the pinned source line and `claudeHatchAvailable()` untouched, and across the **entire js suite (3765 tests) plus the shell portion**, exactly one test reddens and it is here.

⚠️ **AND M5 IS SYNTHETIC IN FORM, WHICH THE PREVIOUS FRAMING HID.** `writeState` is a blind spread with no per-field handling, so "lose `canRunClaude` in transit" requires inserting a `delete` naming that identifier -- **no natural refactor produces it.** A uniqueness claim resting on an implausible mutation is weaker than it reads, and leaning on M5 alone was doing exactly that.

📌 **The honest limit, stated rather than left for a reviewer to find.** The class is real and has shipped in this repo three times -- `connect.js:572-577` names all three: `#1595` (this very field, never in the serving contract, so the page read `undefined` and the hatch never rendered) opens the block at `:572`, and `#1585` (`tail`) and `#1556` close it at `:577`. **But the REALISTIC instance of it is M3 (`publicView` drops the field), and that is already caught by `engine.publicview-canrun-1595.test.js`, the test written for #1595.** ⇒ So the arms are not the guard against the likely bug; they are the only thing asserting this field from a driven flow, which is a narrower and more defensible claim.

🛑 **M4 WAS THE JUSTIFICATION FOR ONE ITERATION AND IT WAS FALSE.** Two other tests catch it. **The reviewer found one; the whole-suite run found a second the reviewer had also missed.** That is an argument for the method, not for either analyst.

⚠️ **AND "WHOLE SUITE" NEARLY LIED THE SAME WAY.** `tools/run-tests.sh:105-108` runs the shell portion **only if node passed**, so a failing js run silently skips ~700 lines of shell checks. The first M5 log looked complete and was not. The shell portion was then run separately under M5 (`EXIT_CODE=0`, 0 red), so the claim covers both halves. **A suite that stops early still prints a plausible tally.**

⚠️ **M1 is the other half and runs the OTHER way.** The unit guard pins the exact source text of the writeState line, so a refactor changing **no** behaviour reddens it while these arms correctly stay green. It asserts **the shape of a line**; these assert **the value that reaches the screen**. Neither is a superset of the other.

📌 **How I nearly got this wrong twice.** My first compressed harness reported M1 and M2 as all-green, contradicting per-file runs I had done minutes earlier. The harness was the defect: `$?` inside a second command substitution does not capture `node`'s exit code. **When two of your own instruments disagree, the newer one is the suspect** -- and a control row that must come back all-green is what makes the table readable at all.

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

**One BLOCKER, and it was real.** The first version of the test never set `AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE`, so both arms drove the real `download()` against `https://downloads.claude.ai` on every suite run. `download()` uses plain node http/https -- specifically `url.startsWith('http:') ? http : https` at `connect.js:602`, **not** `https.get`, since the fixture is served over plain `http://127.0.0.1` -- and it sits outside the injected runner seam, so a runner stub never touches it.

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
and a flake is the one failure shape people retry instead of investigate.

🛑 **ITERATION 9 CLOSED THIS SECTION WITH "Both comments now state the measured shape." THAT WAS
FALSE WHEN WRITTEN.** Only the helper had been corrected. The test docblock still said the throw
"kills the process" **directly above an annotation claiming it had been corrected rather than
annotated**. Iteration 10 found it. Both are now genuinely fixed, and this time the false sentence
is deleted rather than annotated.

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
two. `engine/runners.js` restored clean afterwards, verified by `git status --porcelain` being empty.

📌 **A `grep -c 'if (false)'` returning 0 afterwards is a CONFIRMATION, not a control**, and earlier
versions of this plan called it one in two places. It was never shown returning non-zero while the
mutation was in place, so a silent instrument and a real restore look identical through it.
**`git status --porcelain` is the load-bearing half**; the grep only agrees with it.

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
  ⚠️ **This recurred in the same comment that documents having got this exact count wrong before.**
  🛑 **AND THE TEST DOCBLOCK REPEATING IT WAS NOT ACTUALLY FIXED, THOUGH THIS ENTRY CLAIMED IT WAS.**
  Iteration 10 found it still reading "two". See *The mechanism* below: the phrase spans a line wrap,
  so the replacement could never match, and the edit helper reported success anyway.
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

## Findings from challenge-loop iteration 10

**Zero BLOCKERs, eight WARNINGs, one CONVENTION, four NITs.** The reviewer re-ran every count and
citation rather than trusting the ones this plan presents as already-measured, which is what made
two of these findable at all.

### The mechanism: an edit helper that certified its own no-ops

🛑 **TWO OF THE EIGHT WARNINGS WERE "YOU SAID YOU FIXED THIS AND YOU DID NOT."** Not a judgement
call, not a disagreement: the plan asserted a correction that had never landed. Both had the same
cause, and it is worth more than either finding.

**The phrase spanned a line wrap.** `two` at the end of one line, `sibling copies take a checksum`
at the start of the next. A single-line replacement can never match it, and the same shape hit again
twice in this round's own edits.

⚠️ **AND THE EDIT HELPER REPORTED SUCCESS.** It asserted the anchor was FOUND and never that the
file CHANGED, so a replacement that resolved to the identical string wrote the file untouched and
printed `ok`. **A guard that cannot fail is worse than no guard: it converted an open question into
a settled one, and the plan then recorded the settlement.** Fixed by asserting `out != s`, which is
one line and would have caught both.

⭐ **The general shape, and it is not about this helper.** Every check in this loop asks "did I find
the thing?" The check that matters is **"did the state actually change?"** Those are different
questions and only the second one can catch a no-op.

### The other unmade correction, which is the same defect one layer up

**The test docblock still said the throw "kills the process" -- directly above an annotation
claiming the sentence had been "corrected rather than annotated".** The annotation was true about
the intent and false about the file. ⇒ **A retraction is a claim about a file's current contents,
so it is checkable, and it should be checked like any other claim.** Deleted this time, and the
process note went with it.

### The timeline was backwards in the section this plan calls its most important

The stale-worktree story said `#1592` landed "on 2026-09-01, a day before I wrote the arm", **while
this plan's own header dates the work 2026-08-31**. It contradicted the document it sits in and no
git archaeology was needed to see it. The measured timeline is in that section now.

⭐ **Correcting it made the lesson stronger.** A fetch on the morning I wrote the arm would NOT have
shown the fix, because it had not reached main yet. **The defect was filing the card a day later**,
when it had been on main for 32 hours. ⇒ **"My worktree was stale" does not discriminate; "my
worktree was stale at the moment I made the claim" does**, because the same worktree was innocent
the day before.

⚠️ **And `git log` publishes two dates that disagree by up to two days here.** Author date is when
the work was done, committer date when it landed after a rebase-merge. **Say which you mean.**

### The CONVENTION finding, accepted, and half-fixed honestly

The reviewer said the commentary is now the majority of both test files and that much of it
documents the review process rather than the code: *"a maintainer reading these tests in six months
needs the mechanism, not the iteration log."* **Correct, and it is the branch's own stated rule
turned back on it.**

**Fixed decisively:** every "WAS WRONG UNTIL ITERATION 8", "an earlier version of this comment",
"Iteration 8 wrote..." is gone from the three code files. What survives is forward-looking only, and
each survivor stops a specific re-introduction:

| kept | what it prevents |
|---|---|
| **DO NOT "FIX" THIS ARM BACK TO ASSERTING `true`** | someone restoring the pre-#1592 characterisation |
| **DO NOT TIGHTEN THIS TO `[a-f0-9]`** | re-refusing uppercase, which production accepts |
| **COUNT THESE, DO NOT REMEMBER THEM** (with the command) | the copy-count miscount recurring a third time |
| the measured guard-order rejection | the reordering being re-proposed |

**NOT fixed, and stated plainly rather than claimed:** at the time of this round the main test file
was **65% comment** (295 lines, 192 of them comment). Iteration 11 later brought it to 61%; no
section quotes a current figure any more, only the command to reproduce one. The strip removed
process history and the timeline table replaced much of it, so the volume is roughly flat. **The content is now defensible; the volume is a judgement
call I am leaving to the reviewer of this PR rather than papering over.**

### The rest

- **"So both walk the real `download()`"** and the whole `stuckWith` docblock still described a
  two-arm, one-input helper. It has two inputs and three states; both rewritten.
- **`download()` is "plain `https.get`"** -- it is `url.startsWith('http:') ? http : https`
  (`connect.js:602`). The test file and helper had already retracted this; **the plan had not.**
  ⇒ **Third time a correction landed in some sites and not all. Grep the claim, do not fix the line
  you were shown.**
- **"A `grep -c 'if (false)'` returning 0 as a negative control"** -- it is a confirmation, not a
  control. It was never shown returning non-zero while the mutation was live, so a silent instrument
  and a real restore look identical through it. `git status --porcelain` is the load-bearing half.
  Corrected at both sites.
- **The sibling census said "six helpers"** while `ls test-support/` returns seven; the JS-only
  filter was unstated, so the number was not reproducible by the command a reader would run.
- **"as does `connect.nobinary-1580.test.js`"** implied the same order of magnitude. It is 17
  `PHASE.STUCK` in `connect.test.js` against **1** in `nobinary-1580` (whose 4 is its total
  case-insensitive `stuck` count). ⚠️ **Those are two different instruments and this line compared
  them as one** -- a reader running the named command on the named file gets 1.

### One finding recorded and NOT fixed, with reasoning

**~17 line-number citations point into files this branch does not change** (`connect.js`,
`runners.js`, `run-tests.sh`, three sibling test files). Every one is correct today; the reviewer
re-ran them all. Nothing guards any of them, and a single edit to `connect.js` silently falsifies
the *Scope* section -- **the exact class iteration 9 spent four findings on.**

📌 **Not fixed, deliberately.** Replacing them with symbol names would survive edits but lose the
precision that made iteration 9's four wrong citations findable at all: *"`installClaudeCode` returns
a failure"* is unfalsifiable prose, while *"`connect.js:1549`"* is a claim a reviewer can check in
one command. **The fragility and the checkability are the same property.** *Changes my mind:* a
guard that resolves symbol -> line at test time, which would give both and does not exist here.

### Postscript to iteration 10, found by my own sweep rather than a reviewer

After applying every fix above I ran a grep for each corrected claim across all four files, because
this round's own lesson is *grep the claim, do not fix the line you were shown*. **It found one I had
just missed: "as does `engine/connect.nobinary-1580.test.js`" was corrected in the test file and left
standing in the plan.** Fourth instance on this branch of a one-site fix, committed in the round that
names the pattern three times.

⭐ **The point is not that I missed it. It is that a mechanical sweep caught it and rereading would
not have**, because the plan reads fluently and the sentence is only wrong against a measurement.
**Write the sweep as part of the fix, not as a review step afterwards.**

## Findings from challenge-loop iteration 11

**Zero BLOCKERs, three WARNINGs, one CONVENTION, nine NITs** -- and one of the WARNINGs is the most
important finding of the entire loop, because it was false in the sentence that justified the branch
existing.

### 🛑 THE JUSTIFICATION FOR THIS BRANCH WAS BACKWARDS FOR ELEVEN ITERATIONS

For ten rounds this plan and the test file both said:

> *"The unit guard stays green if `becomeStuck` stops calling the helper. This arm does not."*

**It is the exact inverse.** Measured by running that mutation (hoisting the call to a local, which
changes no behaviour): **the unit guard goes RED and these arms stay GREEN.**
`engine.runnable-not-directory.test.js` pins the EXACT SOURCE TEXT of the writeState line, so it
reddens on any edit to that line, including a behaviour-preserving one.

⚠️ **Ten reviewers read that sentence. It sat in the section headed "why the branch still has a
reason to exist", and it was the one claim nobody thought to run** -- precisely because it was the
conclusion rather than a supporting detail. **The load-bearing sentence is the one that gets
checked last.**

### What the branch is actually worth, established by mutation rather than argument

**The matrix this round produced is NOT reproduced here** -- iteration 12 found it wrong (its M4 row
claimed a uniqueness two other tests also have) and replaced it with a whole-suite version. **The
canonical table lives once, above.** Keeping a second copy here is what let five earlier claims drift
between sites.

⚠️ **What survives from this round is the correction it made, not the table it produced:** the
subsumption claim was false in the M1 direction, the unit guard reddens on a behaviour-preserving
refactor while these arms correctly stay green, and neither file is a superset of the other.

📌 **I nearly published a wrong matrix.** My first compressed harness reported M1 and M2 as
all-green, contradicting per-file runs from minutes earlier. **The harness was the defect:** `$?`
inside a second command substitution does not capture `node`'s exit status. Caught because a control
row must come back all-green and because two of my own instruments disagreed. **When they do, the
newer one is the suspect.**

### The CONVENTION finding, accepted with a causal argument I had not made myself

The reviewer's case was not aesthetic: **keeping the same paragraph in two files is the mechanism
that produced every one-site-fix failure on this branch**, and it found a fifth instance sitting at
exactly such a pair. That is a better argument than "it is long".

**Acted on.** Moved to the plan and left as a pointer in the test file: the benchmarking history, the
throwing-runner retelling, the dated kosmos#1859 timeline, the three-file census (counts have drifted
five times and belong in one place), and the four-mutation table itself -- **which I had just
duplicated into both files while writing the fix above, committing the very defect in the act of
documenting it.**

**Kept in the test file:** every mechanism a maintainer needs at the code -- the identity-guard
rationale, the runner-must-return-not-throw trap, the two-inputs/three-states table, the
distinct-bin-path rationale, the macOS-only warning, and the DO NOT FIX BACK guard.

**Measured outcome at the time of this round:** 295 -> 271 lines, 65% -> 61% comment.

🛑 **NO CURRENT FIGURE IS QUOTED HERE ANY MORE, AND THE REASON IS THE THIRD FAILURE TO STATE ONE.**
Iteration 12 left a stale ratio; iteration 13 retracted it and published a replacement; **that
replacement was ALREADY FALSE at the commit that wrote it** -- 280/177/63% was the state at the
*previous* commit, because the same commit went on to add lines to the test file. ⇒ **A measurement
taken mid-edit describes a state that no longer exists when you publish it.** Measure last, or do not
quote. This section now does not quote.

```
f=engine/connect.becomestuck-arm-1633.test.js
tot=$(wc -l < $f); cm=$(grep -cE '^\s*(\*|/\*|//)' $f); echo "$tot lines, $cm comment, $((cm*100/tot))%"
```

**For comparison, siblings, with the same command** (the range is wide and the sample is small, so
read the files rather than the range): `tmpdir.test.js` 6%, `test-support.code-only.test.js` 25%,
`engine/connect.nobinary-1580.test.js` 35%, `test-support.release-fixture.test.js` 43%,
`engine.publicview-canrun-1595.test.js` 48%. **This file sits above all of them**, and the residue is the head docblock
explaining why the file drives `start()` instead of taking a seam. I judged that load-bearing for
anyone editing the test and stopped there rather than trimming into mechanism.

### The rest

- **"Fixed decisively: every backward-looking annotation is gone"** was itself incomplete -- one
  survived at the closing docblock. **Sixth instance of a claimed-complete fix that was not.**
- **The `#1592` sha was wrong**: `fed47fc5` is the later extraction and its own before-state already
  used `isRunnable`. `c16c9f23` ("directory can never pass again", 2026-08-30 08:45) is the commit
  that replaced the bare `accessSync`. Every date and the conclusion are unaffected.
- **The mutation row "force canRunClaude = true -> ABSENT goes red"** understated it: DIRECTORY
  reddens too, and as written a reader could infer DIRECTORY is insensitive to that constant.
- **`tools/run-tests.sh:103` was quoted verbatim and was not verbatim** (`"$@"` omitted).
- **A sentence broken by iteration 10's strip** ("Nothing exercised this until / in the file...").
- **"Three of the four disagree about the second positional"** read as inverted; three take an
  options object and no two accept the same keys, the fourth takes a Buffer.
- **The `/after/` matcher** was loose enough to match an unrelated TypeError; tightened to
  `/t\.after is not a function/`.
- **A test named for refusal contained an acceptance arm**; renamed to cover both.

## Findings from challenge-loop iteration 12

**One BLOCKER, three WARNINGs, three NITs. The first BLOCKER since iteration 1**, and it landed on
the justification sentence again -- one row over from where iteration 11 found the last one.

### 🛑 THE M4 UNIQUENESS CLAIM WAS FALSE, AND THE COLUMN SET IS WHY

Iteration 11 replaced a backwards justification with a measured matrix. **Iteration 12 found the
replacement wrong too.** M4 (cut the install-failure wiring at `connect.js:1708`) is caught by
**five** tests, not three:

```
✖ #1633: a stuck flow WITH claude on disk records canRunClaude true     <- mine
✖ #1633: a stuck flow with NO claude on disk records canRunClaude false <- mine
✖ #1633: a DIRECTORY at the bin path is not runnable, via the driven flow <- mine
✖ a stuck install does not strand the 281MB download in app data        <- connect.test.js
✖ #1580: a DIRECTORY at the binary path is not "something to run"       <- nobinary-1580
```

🛑 **THE METHOD WAS THE DEFECT, NOT THE CELL.** I built that matrix by choosing columns: *the files
that mention `canRunClaude`*. **`engine/connect.test.js` never mentions the field, so it was excluded
by the very criterion used to build the set -- and it is one of the two tests that falsify the
claim.** ⇒ **A matrix built from a hand-picked column set is a claim about the columns. I wrote it as
a claim about the repo.** Choosing the column set is choosing the answer.

⭐ **AND THE FIX IS NOT "PICK BETTER COLUMNS".** The reviewer found one of the two missing tests by
reading; the **whole-suite run found a second one the reviewer also missed.** Running everything and
reading what reddens has no freedom to exclude, which is the entire argument.

### What the branch is actually worth, re-measured with no column set

**M5: make `writeState` lose `canRunClaude` in transit**, leaving both the pinned source line and
`claudeHatchAvailable()` untouched.

```
entire js suite   3765 tests -> exactly ONE red, the PRESENT arm here
shell portion     run separately under M5 -> EXIT_CODE=0, zero red
```

⭐ **That is a true uniqueness claim and it is narrower than the one it replaces.** The field can
vanish between the writer and the screen and nothing else in the repo notices, because every other
test builds state by hand, matches source text, or asserts only `phase` and `because`.

⚠️ **"WHOLE SUITE" NEARLY LIED THE SAME WAY, ONE LAYER DOWN.** `tools/run-tests.sh:105-108` runs the
shell portion **only if node passed**, so a failing js run silently skips ~700 lines of shell checks.
**The first M5 log looked complete and was not**; the shell half was then measured separately. **A
suite that stops early still prints a plausible tally**, and the tell was a log 700 lines shorter
than baseline, not anything in the tally itself.

### The best small finding of the round: an instruction that counted itself

A comment I added in iteration 10 told the next maintainer:

> *COUNT THESE, DO NOT REMEMBER THEM: `git grep -n 'function serveRelease'`*

**That command returned FIVE when the reviewer ran it. There are four definitions.** The extra hit was
the comment itself, because the instruction contains the string it searches for. ⇒ **A maintainer
following it literally would have "corrected" the table upward.** Anchored (`^function serveRelease`)
it returns 4, stably.

🛑 **AND THE WRONG NUMBER WOULD NOT HOLD STILL WHILE I FIXED IT.** Writing the anchored form into the
comment added another occurrence; writing *this section* added two more. **Measured minutes apart: 4,
then 5, then 8.** ⇒ **A self-referential count is unstable by construction -- every attempt to
document it perturbs it** -- so the comment now states the principle and the anchored command and
quotes no figure for the unanchored one.

⭐ **A counting instruction that counts itself inflates the table it exists to guard**, and it fails in
the direction that looks like diligence.

### The rest

- **"No two of those three accept the same keys"** -- false. `connect.test.js:147` and
  `install-997:44` accept **identical** option keys and differ only in arity. 🛑 **This sentence was
  introduced by iteration 11's own correction: the seventh instance on this branch of a fix planting
  a fresh false claim.**
- **The iteration-10 section stated a comment percentage in the present tense** that iteration 11
  had already changed, three sections apart. Marked historical.
- **The JSDoc for `serveRelease` sat above `KNOWN_OPTIONS`**, documenting the wrong symbol. Moved.
- **Arm 3's `timedOut` message** dropped the "about canRunClaude" tail arms 1 and 2 carry. Restored.
- 📌 **The mutation matrix was duplicated in two plan sections**, which is how five earlier claims
  drifted between sites. **There is now one canonical copy** and the iteration-11 section points at it.

## Findings from challenge-loop iteration 13

**Zero BLOCKERs, four WARNINGs, four NITs -- and for the first time the branch's justification
survived an independent attack.** The reviewer could not run mutations (review is read-only), so it
attacked M5 *by construction*: tracing every pin in `runnable-not-directory` (`:1325`, `:1558`, the
`FORCED` regex at `:1608`), confirming no test anywhere does a whole-state key or deep-equality
assertion on the settled record, and confirming `writeState` is a blind spread. **It held.**

### 🔑 THE MOST VALUABLE THING IN THIS ROUND WAS OFFERED, NOT FILED

The reviewer added a calibration below its findings rather than as one, and it is sharper than any
of them:

> *the branch's uniquely-caught mutation is synthetic, its realistic sibling is covered elsewhere,
> and what the arms genuinely add is the only assertion in the repo that reads this field downstream
> of a real `start()`.*

**Adopted, and it is now the justification.** Three things make it better than what it replaced:

1. **It is a structural fact, not a mutation result.** Four test files reference the field
   (`git grep -c canRunClaude -- '*.test.js'`); the other three build state by hand or match source
   text. **True by inspection, needing no mutation to establish** -- which matters because the
   previous three justifications were each built on a chosen mutation and each was wrong.
2. **It names M5's weakness out loud.** `writeState` is a blind spread, so losing one field takes a
   `delete` naming it. **No natural refactor produces that.** A uniqueness claim resting on an
   implausible mutation is weaker than it reads, and I had been leaning on exactly that.
3. **It concedes the realistic case.** The plausible instance of this class is `publicView` dropping
   the field -- **which is literally #1595, and is already caught** by the test written for it.
   `connect.js:572-577` records the class shipping three times here (`#1595` at `:572`, `#1585`
   `tail` and `#1556` at `:577`).
   ⇒ **These arms are not the guard against the likely bug.** Saying so costs nothing and stops the
   next reviewer discovering it.

⭐ **A justification that concedes its own limits is the first one on this branch that has not needed
correcting the following round.**

### The rest

- **The test file claimed the plan held the per-file counts "with the commands that produce them".
  The plan held the counts and NO command.** 🛑 That sentence is what justifies deleting the counts
  from the test file, so it was load-bearing, and it was a claim about another file made without
  opening it -- **the class this branch has now spent five rounds on.** ✅ Fixed by making it true:
  the census ships `git grep -c canRunClaude -- '*.test.js'`, **and I ran it before publishing it**
  (returns 3 / 10 / 38, matching the table).
- **A superseded method restated four lines above its own retraction.** The canonical table's lead-in
  still read *"Four mutations, each run against every file that touches the field"* -- wrong on the
  count (five plus a control) and describing the per-file column set that the next paragraph exists
  to discredit. Removed.
- **"17 `PHASE.STUCK` references versus 4" compared two different instruments.** `nobinary-1580` has
  **1** `PHASE.STUCK`; its 4 is a case-insensitive total. Plan line 16 states this correctly with
  units and the iteration-10 restatement dropped them, so **a reader running the named command on the
  named file gets 1.** Second site of the same claim, again.
- **The comment ratio was stale in the section the plan explicitly forwards readers to** as current.
  It read 61% and measured 63% **at that round**: iteration 12's own edits had moved it. **A ratio
  changes on every edit**, so no section quotes a current one; the command to reproduce it is in the
  volume section.
- **One line of a quoted failure transcript was not verbatim** (`driven flow` for `via the driven
  flow`) while the other four were, which makes the edited line the hard one to notice.
- **The sentence disclaiming the benchmarks quoted them**; the footer JSDoc attached to no
  declaration now says it is a footer.

📌 **A note on the sweep itself, since it now returns false positives.** Grepping for each corrected
claim across all four files is what caught the missed sites in iterations 10 and 12. It now flags
**quotations inside retractions** -- this section quotes *"Four mutations, each run against..."* and
*"17 `PHASE.STUCK` references versus 4"* precisely so a reader can check that the retraction names a
real prior sentence. ⚠️ **That is a genuine tension, not a fixable one: quoting the false claim is
what makes a retraction checkable, and it is also what makes the sweep noisy.** ⇒ **Read the hits,
do not count them.** A sweep that returns zero after a round of retractions probably means the
retractions do not quote what they retract.

## Findings from challenge-loop iteration 14

**Zero BLOCKERs, two WARNINGs, six NITs.** The justification survived a second independent attack,
this time decomposed into its four separately-falsifiable parts, and **every concession in it checked
out**: `writeState` really is a blind spread (so M5 genuinely is synthetic), and
`engine.publicview-canrun-1595.test.js:24` really does assert `'canRunClaude' in canRun` (so the
realistic instance really is covered elsewhere).

### 🛑 THE STALE RATIO WAS FALSE AT THE COMMIT THAT WROTE IT

Iteration 12 left a stale comment ratio. Iteration 13 retracted it and published a replacement.
**That replacement was already false when it shipped:** `280 / 177 / 63%` was the state at the
*previous* commit, because the same commit went on to add lines to the test file.

⭐ **THE MECHANISM, AND IT IS NOT CARELESSNESS: I MEASURED, THEN EDITED, THEN PUBLISHED THE
PRE-EDIT FIGURE.** A measurement taken mid-edit describes a state that no longer exists by the time
it is committed. **Measure last, or do not quote.**

⇒ **Third failure to state this one number, so the plan now states no figure for it at all** -- only
the command, plus the five sibling percentages (each re-run before publishing this time: 6 / 25 / 35
/ 43 / 48). ⚠️ **And the reviewer found a sixth sibling at 6% that falls outside the "25-48%" range I
had quoted**, which is why the range is gone too and the files are named instead.

### The live justification named the wrong file

*"the other three build the state object by hand or match `connect.js` as source text."*

**`server.connect.test.js:797` slices `web/index.html` and matches the PAGE source, not
`connect.js`.** Three sites carried it, including the sentence that carries the branch.

📌 **The conclusion is unaffected** -- a page grep is no more downstream of a `start()` than a
`connect.js` grep -- **which is exactly why it survived**: nothing downstream of the sentence went
wrong, so there was no pressure on it. ⚠️ **And this plan's own comparison table twenty lines above
said "greps page source" correctly.** The document disagreed with itself and the prose was the wrong
half, for the third time on this branch.

✅ Now stated as three distinct instruments -- hand-built state, page source, `connect.js` source --
**none of them a driven flow**, which is the actual point and is stronger for being specific.

### The rest

- A sentence fragment left by iteration 12's correction (`.) so a call copied` resuming lowercase
  after a full stop).
- The fixture's file header was JSDoc-shaped and therefore documented the `require` beneath it.
  **Iteration 12 fixed this exact class one symbol over**, which is why it is worth naming rather
  than silently fixing: a `/**` on a file header is a recurring shape here, not a one-off.
- `require('node:crypto')` sat inside a test body while every other require was at module top.
- One backward-looking annotation survived the iteration-10 strip in a place the plan claimed was
  clean. Unlike the `DO NOT "FIX" THIS ARM BACK` guard it prevented nothing the sentence above it
  already prevented, so it is gone.
- **Two blocks of commentary named as unearned, and both removed**: one argued against a wider claim
  the file no longer makes, the other was review-process residue about a comparison set. ⭐ **The
  reviewer went line by line and certified the other ten blocks as load-bearing rather than
  gesturing at the percentage**, which is the first time the volume question has been answered with
  a specific list instead of a ratio.

## Findings from challenge-loop iteration 15

**Zero BLOCKERs, two WARNINGs, four NITs.** Every published figure and all ~20 line-number citations
reproduced exactly under an independent instrument, and the four-part justification held on its
third consecutive independent attack.

### The duplication mechanism, now inside a single file

The three-instruments census was stated **twice in the same test file**, about 190 lines apart -- and
**the two copies had already drifted**: the third-arm copy carried the `server.connect.test.js:797`
citation, the explicit "NOT `connect.js`" correction and the reproducing command; the head copy
carried none of the three.

⚠️ **Both were factually correct. That is what makes it worth fixing rather than shrugging at:** the
risk is not today's text, it is that the next correction lands on one copy. **This is the same
one-site-fix mechanism the plan has logged five times across two files, recurring inside one.**
✅ Collapsed to a single site, with the head docblock pointing at it.

### Two defects I introduced in iteration 14 while fixing iteration 14's findings

1. **A broken enumeration in the sentence that carries the branch.** Fixing the wrong-file claim
   dropped a separator: *"builds the state object by hand matches the PAGE source"*. Two of three
   verbs ran together in the branch's load-bearing sentence.
2. **A false intra-document pointer.** I removed the comment-ratio figure and **left the sentence
   pointing at it**, so the plan told readers "the current figure is in that section" while that
   section says in capitals that it deliberately quotes no figure.

⭐ **Both are the same shape and it is the one to carry forward: a fix that changes a thing but not
the sentences ABOUT that thing.** The eight prior instances on this branch were cross-file; these two
are intra-file and intra-document, so **proximity does not protect you.** The sweep is what catches
them, and only if it reads the referent rather than the reference.

### The rest

- A fragment left by the iteration-14 strip that restated the sentence immediately before it.
- The footer block opened `/**` and then spent two lines explaining that it documents no symbol.
  **Iteration 14 fixed this exact class one file over** by changing a `/**` header to `/*`; the same
  one-character change here deletes the need for the apology. Third appearance of the `/**`-on-a-
  non-declaration shape.
- The stale-worktree lesson in the DO-NOT-FIX-BACK guard was review residue: the sentence above it
  (the card was closed as already-fixed) already carries everything a maintainer needs. Cut.

### Volume, assessed independently for the second time

The reviewer went block by block without being told the previous verdict and reached the same list:
**everything except the two cut above is load-bearing** -- mechanism naming, identity-guard
rationale, local-release warning, return-never-throw trap, two-inputs/three-states table,
distinct-bin-path rationale, macOS-only warning, SET-IS-THE-POINT, and the `publicView || false`
concession. **Two independent block-by-block assessments agreeing is worth more than the ratio**,
whose ratio this section deliberately does not quote (see the volume section: every figure any
round has stated for it went stale, including the two written to replace a stale one). Reproduce it
with the command there. **The blocks removed were offset by specificity added elsewhere, so the
ratio has moved very little** -- but "has not moved" was the wording here until iteration 17 and it
was false against this plan's own log: 65 -> 61 -> 63 -> 64 -> 63.
📌 **Recorded rather than presented as an improvement.**

### Postscript to iteration 15: the `/**` class had three more instances nobody named

The reviewer filed one instance (the file footer). **Iteration 14 had filed one instance** (the
`release-fixture.js` header). Each time the named site was fixed and the class was not, so I swept
for it instead:

```
awk '/^\/\*\*/{s=NR} /^ \*\//{if(s){getline nxt; printf "%d -> %s\n", s, nxt; s=0}}' <file>
```

**Three more, all documenting something they are not attached to:** both test files' headers sat
above `const { test } = require('node:test')`, and the deliberately-unarmed-path note sat above a
blank line. All three are now `/*`.

⭐ **THIS IS THE PROSE LESSON IN CODE SHAPE, AND IT IS THE SAME LESSON:** *grep the claim, do not fix
the line you were shown.* Two reviewers and two rounds each fixed the instance in front of them, and
the class survived both. **The instances that remain are all `/**` above a real declaration or above
the `test()` they describe, which is what the syntax is for.**

📌 **And my own sweep for the census collapse returned 0 where I expected 1.** The file was fine; my
pattern said `builds` where the surviving copy says `build`. **Third time on this branch that a
zero from my own grep was my instrument rather than the subject** -- which is exactly why the
positive control matters more than the result.

### A killed suite on this branch, with the exact numbers, because the signature is cleaner than the bulletin's

The iteration-15 verification run was **killed mid-flight**. What its log showed:

```
EXIT_CODE line     ABSENT        <- the only honest tell
pass marks         3765          <- the FULL expected count, identical to a green run
log length         4330 lines    <- 176 short of a complete run's ~4506
```

🛑 **THE TALLY WAS COMPLETE AND THE VERDICT WAS MISSING.** The js portion had finished; the kill
landed during the shell half, which `run-tests.sh:105-108` runs after it. **So the count a reader
checks was right, and the run had not passed.**

⚠️ **The published guidance says the tell is an unaccounted test count. Here there was none** -- 3765
of 3765 accounted for, because the truncation fell between the two halves rather than inside one.
⇒ **Only two things separated it from a green run: the absent `EXIT_CODE` line, and a log 176 lines
short.** Neither is visible in the tally.

✅ **So the rule holds and needs the stronger form: read the exit code, and treat the ABSENCE of an
exit-code line as a failure rather than as something to look past.** A tally cannot tell you a run
finished, and on this branch it did not even hint.

## Findings from challenge-loop iteration 16

**Zero BLOCKERs, one WARNING, one CONVENTION, two NITs.** Every figure and all ~30 line citations
reproduced exactly, and the justification held on its fourth consecutive independent attack.

### 🛑 A COMPRESSION REINTRODUCED A CLAIM RETRACTED FIVE ROUNDS EARLIER

Iteration 15 collapsed a duplicated census and compressed the surviving copy to:

> *"Plenty of tests drive real flows into the stuck phase; three other files reference
> `canRunClaude`; none does both."*

**False.** `server.connect.test.js:749` drives a real `await connect.start()` into an assertion whose
accepted set includes `PHASE.STUCK`, **and** the file references the field three times. It does both.

⚠️ **AND THIS IS THE SAME CLAIM ITERATION 11 RETRACTED, ABOUT THE SAME FILE, CITING THE SAME LINE.**
Iteration 8 wrote *"none of the three calls `connect.start()`"*; iteration 11 caught it and the plan
still carries that retraction at its own iteration-11 section. **Seven rounds later I wrote it again
in different words.**

⭐ **THE MECHANISM IS NEW AND IT IS THE MOST USEFUL THING THIS ROUND PRODUCED: A RETRACTION USUALLY
LIVES IN A QUALIFIER, AND COMPRESSION REMOVES QUALIFIERS.** The true sentence is *"none **asserts**
it **downstream of a `start()`**"*. Drop the verb and the prepositional phrase -- exactly what
tightening prose does -- and you are left with the retracted claim, wearing new words so no grep for
the old wording can find it.

⇒ **A shortening edit is a claim-changing edit.** Treat any compression of a corrected sentence as a
new claim requiring re-verification, not as cosmetic.

✅ Fixed by restoring the verb, and I swept the class rather than the site: the only other
`none`/`no other` construction in the three code files already carries the qualifier.

### The rest

- **Review-process residue in shipped source** -- the iteration-15 drift annotation. ⭐ **The
  reviewer swept the class rather than filing the instance** (`grep -i 'iteration|earlier
  version|previously|first version'` across all three code files): exactly two hits, the other being
  the genuinely forward-looking DO-NOT-FIX-BACK guard, which stays. **That is the sweep I asked for
  and it answered the question in one round instead of three.**
- **My own fix created a duplication while removing one.** Restoring the qualifier left two
  paragraphs twelve lines apart saying substantially the same thing, with two pointers sending the
  reader to different places. Merged into one, with a single pointer that distinguishes what lives
  where (instruments at the third arm; counts and command in the plan).
- A sentence fragment left by iteration 15's own fix (a stray "the" and an unwrapped splice), in the
  paragraph about a figure iteration 15 had removed.

## Findings from challenge-loop iteration 17

**Zero BLOCKERs, two WARNINGs, three NITs.** The justification survived a fifth consecutive
independent attack, with every part re-measured rather than trusted.

### 🛑 A RULE I WROTE IN ONE SECTION DID NOT BIND ME IN ANOTHER

Iteration 14 wrote, in capitals: **"NO CURRENT FIGURE IS QUOTED HERE ANY MORE. This section now does
not quote."** Iteration 15, three sections later in the same file, wrote *"sits at 64% and has not
moved."*

**Both halves wrong.** Measured with this plan's own published command: **63%**, so a reader running
the named command on the named file gets a different number -- the exact failure this plan already
filed against itself for the `PHASE.STUCK` comparison. And *"has not moved"* is false against the
plan's own log: **65 -> 61 -> 63 -> 64 -> 63**.

⭐ **FOURTH FAILURE ON THIS ONE NUMBER, AND THE MECHANISM IS NEW EACH TIME.** Stale (12), false when
written (13), corrected-then-restated (15), and now **a self-imposed rule that did not reach three
sections down**. ⇒ **A prohibition written in one section governs that section.** It is the
intra-document form of fixing the instance rather than the class, and the fix is the same: sweep for
the thing, not for the wording of the ban.

✅ **The figure is gone from that site too**, replaced by a pointer to the command.

### A citation off by five lines, at two sites

`connect.js:577` was cited as naming `#1595`. It names `#1585` and `#1556`; **`#1595` is at `:572`**.
The conclusion (the class shipped three times) is untouched, only the citation. Both sites now cite
the block `:572-577` **because the three ids genuinely span it** -- a single-line citation was the
wrong shape for the claim, not merely the wrong line.

### The compression class again, in a NIT

*"three private `serveRelease` copies take DIFFERENT positional arguments"* is the compressed
neighbour of the claim iteration 12 retracted: two of the three accept **identical option keys** and
differ only in arity. The correcting detail lived only in the helper, so a maintainer reading the
test file alone got the looser version. ⚠️ **Same shape as iteration 16's finding, one file over: the
qualifier lives in one place and the compressed claim travels without it.**

A colon in the same sentence also promised a reason for one thing and delivered the reason for
another, welding two unrelated findings together. Split.

### The plan's own length, settled rather than left open

918 lines, roughly two thirds iteration log. **Decision: it stays, and the file now says why in a
header.** The accepted CONVENTION finding required stripping process history from the three CODE
files *so that it would live in the plan* -- this is where it was sent, and moving it again would
just relocate the same content while losing the reason. What was missing was orientation, so the
plan now opens with what ships, the one-sentence justification, and a table pointing at the section
a reader actually wants. **The log is skippable by design; nothing above it depends on it.**

📌 **Postscript, found by applying this round's own lesson within the round.** After fixing the
iteration-15 site I swept for the THING (any percentage claim about this file) rather than for the
wording I had just banned, and **found a fourth site the fix had missed**: the iteration-13 section
said *"It is 63%, not 61%"* in the present tense. Historical narration, but phrased as current, which
is the same defect wearing a past-tense section as cover. ⇒ **The sweep that catches a class has to
search for the subject, not for the sentence.** Had I grepped for the banned phrasing I would have
returned clean and been wrong for the fifth time on this number.

🔑 **AND THE BAN NEEDS ONE PRECISION, OR IT EATS ITS OWN FINDINGS.** Reading the eight surviving
percentage mentions rather than counting them: seven are historical or retraction quotes, and one is
**this round's finding citing the measurement that falsified the claim**. That last one is
**evidence, not a standing fact**, and forbidding it would make the defect unreportable.

⇒ **The rule, stated so it is satisfiable: no section states the CURRENT ratio as a standing fact; a
finding MAY cite the measurement that contradicted a claim, because that citation is what makes the
finding checkable.** ⚠️ Without that carve-out the ban is unsatisfiable and generates a fresh
correction every round forever, which is its own failure mode rather than rigour.
