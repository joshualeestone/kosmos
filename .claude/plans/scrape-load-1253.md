# #1253 option 3: say plainly that the board's red state runs on the pane reader

Branch: `scrape-load-1253`
Card: joshualeestone/kosmos#1253
Agent: RenetTilley

## The problem

`needs_you` is the board's one red state. The code reads as though three
sources produce it: the `PermissionRequest` hook, an agent running
`kosmos report needs_you`, and the pane reader. In practice one of them does.

Measured over the whole self-report record on this machine (2026-08-28):

```
2026-08-28 18:58 CDT, one snapshot with its clock time, because the record is
append-only and any total quoted without one is a different number by morning:

records                26,392
  needs_you                22
    7  written by the PermissionRequest hook on an agent's behalf
   14  belonging to two walkthrough FIXTURE agents
    1  ever typed by a working agent (PigeonPete, 2026-08-24)
```

`#1255` shipped the instruction telling agents to report the state. Thousands of
reports since, and the count has not moved by one. (No figure pinned here: the
record is append-only and the delta grows every minute. `status.js` rule 3
carries the one snapshot, with its clock time.)

Two people concluded independently on the card that option 3 should be adopted
regardless of what else happens (me on the measurement, PigeonPete twice on
his own). Nobody had written it.

## The decision

**Write the sentence, and write it as a CHECK rather than as a number.**

A measurement in a comment is true on the day it is written and unfalsifiable
afterwards. This repo has been bitten repeatedly this week by exactly that
shape. So the deliverable is a command anyone can re-run, and a comment that
points at it and tells the reader not to trust its own numbers.

## What is built

1. `tools/needs-you-source.js` (read-only, changes nothing)
   - parses the append-only self-report record
   - splits `needs_you` by provenance: hook-written vs agent-typed
   - prints its impossible-state control (a state no writer can produce, which
     must read 0, and which the tool asserts against `selfreport.STATES` so it
     cannot quietly stop being impossible), a scale line deliberately NOT
     called a control because it cannot fail, the cutoffs it uses, and a
     per-agent table so the reader judges which agents are real
   - asserts its conclusion against its own numbers, and prints the OPPOSITE
     conclusion when agents have started reporting the state themselves

2. `tools/test-needs-you-source.sh`, 23 named arms and 62 passing assertions.
   **Arm 3 is the load-bearing one:** the tool must be able to print the
   uncomfortable answer. A measuring tool that can only ever return
   "load-bearing on the scrape" is decoration on that sentence, not evidence
   for it. Arms 3b, 3c, 5b, 5c, 7 and 8 were all added at challenge-loop
   iteration 1 and each one has a matching perturbation that turns it red.

### Amended at iteration 1, because the first version was weaker than it read

- **The verdict no longer rests on a share alone.** 77% of the record is
  `working` heartbeats, so a share-only threshold gets harder to trip every
  day for reasons unrelated to whether agents use the verb. It now also
  requires DISTINCT WORKING AGENTS to stay at or below two, which does not
  drift with heartbeat volume.
- **Walkthrough fixtures are separated, not counted as colleagues.** 14 of the
  15 agent-typed records are `walk-*`. One more walkthrough run at that volume
  would have printed "agents ARE reporting this state themselves" on the
  strength of test traffic, telling a reader that correct shipped
  documentation was stale.
- **The string match is now CHECKED against the hook's source at run time.**
  The first version said a constant made a reworded hook "fail loudly". It did
  not: nothing linked them, so a reworded hook would have read zero hook
  records, reclassified all 22 as agent-typed, and printed the same verdict
  with an inverted split.
- **An empty-but-existing record refuses.** It used to print the tool's
  STRONGEST conclusion from zero data.
- **`--dir` with an empty value is an error**, not a silent fall back to the
  live record.
- **Unreadable is distinguished from absent**, because they have different
  fixes.

3. The sentence itself, ONCE, at `engine/status.js` rule 3, where the scrape
   is given precedence over a self-report. That is where a reader forms the
   belief that rule 3 arbitrates between two witnesses; it arbitrates between
   a witness and, in practice, a silence.

4. Pointers carrying no numbers of their own, so they cannot drift:
   - `engine/selfreport.js`: a closed list of six words, one of which has
     almost no writer.
   - `engine/notify.js`: a phone ping wired to this `kind` would today be a
     ping about what a SCREEN looked like.

5. `package.json`: wire the new shell test into `test:shell`, which
   `tools.every-test-runs.test.js` requires.

### Amended at iteration 2, and one of these was a false claim I was shipping

- 🛑 **The paragraph blamed #1155 for making a prose question invisible. That is
  false.** Measured against the PRE-#1155 marker set, lifted verbatim from
  `git show ca46bacf^:engine/status.js`: `"May I merge the PR?"` classified
  `unknown` BEFORE #1155 too, with two positive controls returning true and a
  negative control returning false. And #1155's own measured effect was removing
  four FALSE reds, which does not narrow the legitimate red path at all. The
  markers are a **closed vocabulary that never covered arbitrary prose**, before
  or after. The attribution is gone and the mechanism is stated instead.
- **The fixture prefix is no longer called "sound".** `walk-` is an UNLINKED
  convention: nothing in the repo reserves it, so a real agent could take it,
  and the misclassification would shrink `typedReal` -- the flattering
  direction, which the header itself says a caveat must not be wrong in. The
  hook marker got a run-time drift check and three arms; the fixture marker got
  neither and was the one called sound.
- **"can only make agent-typed look SMALLER" was unqualified and self-
  contradictory**, since the same file describes a reworded hook moving records
  the other way. Scoped.
- **An unrecognised argument now errors.** `--dirr <fixture>` and a bare
  positional path both read the LIVE record while the caller believed otherwise.
  Arm 7's failure through a second door.
- **An unreadable FILE is counted and named**, where an unreadable LINE always
  was. An EACCES removed one agent's reds from every number, silently.
- **A JSON array or a state-less object no longer counts as a record**; both
  padded the share denominator in the flattering direction.
- **One record total, with its clock time.** Three different totals appeared
  across the changeset because the record is append-only and I measured three
  times.
- `notify.js` said the pane reader **writes**; it writes nothing. It also
  claimed the weaker half is **the majority**, which the tool cannot support --
  by its own header it cannot see the pane reader at all -- and which pointed in
  the direction that flatters the thesis. Both gone, along with a count that was
  a second copy of a number the plan says lives in exactly one place.

### Amended at iteration 3

- 🛑 **The "survives its own worst case" bound was false in all three copies.**
  See the corrected weakest-premise section below.
- **A drifted hook marker now REFUSES and exits 1.** It used to print "the
  verdict cannot be trusted" and then print the verdict anyway, exiting 0 --
  the editorialising-past-your-own-data defect, committed by the line written
  to prevent it. `HOOK_SOURCE` is overridable so arm 9 can drive that path from
  both sides; without an injection point the refusal could not be tested, which
  is how it shipped broken.
- **An arm now asserts exit 0 on success.** Codes 1 and 2 were covered; 0 was
  not, and the script runs without `set -e`, so a regression on the good path
  would have left every other assertion green.
- **`notify.js` no longer states an absolute** with a known counterexample: an
  agent has typed the verb once, ever. It also said the scraped verdict is
  composed in `reconcileReport`; it is composed in `classify`, and
  `reconcileReport` is where it is given precedence.
- **`status.js` now says the instruction was MERGED AND NOT DELIVERED.**
  Measured: 0 of 17 worker instruction files carry `kosmos report needs_you`,
  control 17 of 17 mention `kosmos`. `defaults.js`'s own version log says the
  same thing, and two engine files disagreeing about one number is how a reader
  ends up trusting neither.
- **The tool header no longer carries derived counts**, which were a second
  copy of numbers the plan says live in exactly one place.

### Amended at iteration 4

- 🛑 **The delivery clause named the FIX as part of the problem.** I wrote that
  #1255 and #1296 both landed inside the old heading. #1296's own title is
  *"the two board verbs move to a section existing agents are actually
  offered"* -- it is the fix. The two that landed inside the old heading are
  **#1255 and #1292**. And the mechanism is not "never re-offered": #1296 moved
  the verbs into a NEW heading that `missingFrom` DOES offer, so it is
  **offered and not yet applied on this machine**, which is one refresh away
  rather than hopeless. Different fact, different remedy.
- **The control is now the interesting half**, and it is the reviewer's, not
  mine: 2 of 17 files carry the old heading, both carry `kosmos msg`, neither
  carries `kosmos report`. That is #1255's mechanism visible in the data rather
  than inferred. 0 of 17 carry the new heading.
- **`FIXTURE_PREFIX` is narrower than the class it names, and that is a real
  limit rather than a hypothetical:** the live record already holds
  `angeltest1315`, `angelcreate1329`, `quiet-quill`, `quiet-reed`, `scoutlive`
  and `msgcodex`. None has typed the verb, so the verdict is unaffected today.
  Mitigated rather than solved: the verdict now NAMES the working agents it
  counted, so a reader sees whether a flip came from a colleague or a test.
- **The exit-code table omitted the drift refusal**, which also exits 1 and is
  none of the three causes listed. A caller branching on 1 would have concluded
  the record was absent when the instrument was drifted.
- **The "most common state" line no longer calls itself a control.** With the
  empty record already refused, the maximum of a non-empty tally is positive by
  construction, so its two outcomes are indistinguishable. It is informative;
  it does not get to wear the word.
- **The last undated derived number is gone** ("77% of the record is
  heartbeats"). The tool prints the proportion every run.
- **Arm 9b** drives the UNVERIFIED path through `main()`, so the decision that
  an unverified marker still prints while a drifted one refuses is tested
  rather than assumed. Perturbed: making them converge turns it red.
- **`defaults.js` quotes 22 of 21,500 for the same split**, an older
  denominator with no snapshot time. Both were true when written; `status.js`
  now says so and says which to prefer.

### Amended at iteration 5

- 🛑 **The BLOCKER is my own "fix the class, not the instance" rule failing.**
  Iteration 3 corrected "the scraped verdict is composed in `reconcileReport`"
  in `notify.js`. **The identical sentence in the tool header was left
  standing.** It is composed in `classify`; `reconcileReport` decides
  precedence. One fix, two sites, and I patched one.
- 🛑 **My delivery evidence was over-determined and I cited it as though it
  were not.** "0 of 17 carry the NEW heading" is the same zero whether #1296
  exists or not, because **0 of 17 carry the Kosmos doctrine block at all**
  (control: 17 of 17 match a common word). These agents have never received
  any block. The heading-placement story is real and explains exactly the TWO
  files that carry the old heading as plain text; for the other fifteen
  `missingFrom` would have offered it, verbs included. The conclusion
  (non-delivery) survives and is simpler; the evidence I gave for the specific
  mechanism did not extend past two files.
- **#1292 did both**: it added `### You do not stop` AND edited inside the old
  heading. Saying only the second reads as though nothing from it could reach
  anybody.
- **"Every other rule arbitrates between two witnesses" was an absolute with
  counterexamples in its own docblock** (rule 1 has one witness; rule 6
  arbitrates against a clock). Now "most".
- **"The tool prints the exact proportion every run" was false.** It printed
  counts and one unrelated percentage. It now prints the heartbeat proportion
  beside the count, so the claim is true rather than aspirational.
- **"Read them and judge; the per-agent table is printed so you can"** - the
  table shows WHO, not WHAT, and the argument is about the `because` strings,
  which the tool deliberately never prints. Reworded to point at the record.
- **The `store` require went dead** when the leaf moved to `selfreport.DIR`,
  leaving a comment explaining a reason that no longer applied. Both removed.
- **A repeated `--dir` now refuses** instead of last-winning, same stance as an
  unrecognised argument.
- **Arm 7c is guarded against root**, where `chmod 000` is a no-op and the arm
  would have passed vacuously.
- **Arms 8b and 7e** cover the two lines `status.js` quotes back by name (the
  distinct-agent count and the last-typed date) and the duplicate-`--dir`
  refusal. Both perturbed, both red on demand.

### Amended at iteration 6

- 🛑 **I retracted a false claim about #1155 and shipped its mirror image.**
  Iteration 2 corrected "#1155 made prose questions invisible". My replacement
  said #1155 "removed four FALSE reds, and removing false positives does not
  narrow the legitimate red path at all". **This same file measures the
  opposite at line ~1191:** on a wrapped pane an option-less prompt can
  classify `idle`, where before #1155 it read `needs_you`. That IS a legitimate
  red lost to #1155 - latent rather than live, and neutralised by adding `-J`.
  Both corrections now stand, in opposite directions, and I shipped each of
  them wrong once.
  ⚠️ **SUPERSEDED IN PART AT ITERATION 8.** This entry originally said "on any
  pane narrower than the question", quoting the neighbouring comment rather
  than measuring it. That quantifier is false: the band is one width for this
  prompt. See the iteration-8 entry.
- 🛑 **"no sync has ever written to them" is false.** 17 of 17 worker files
  carry `kosmos:connections:` and 3 of 17 carry `kosmos:projects:`. The true
  claim is the narrower one: no DOCTRINE sync, the span that carries these
  verbs, at 0 of 17.
- 🛑 **The header promised "only a real reading goes to stdout", and two of the
  four refusal paths printed a partial reading there before exiting.** Fixed
  structurally rather than by rewording: every gate now runs before any
  `console.log`. **No arm caught it because `run()` merges the streams** - arm
  11 now asserts the split on all four refusals, with a fifth assertion that a
  real reading DOES use stdout, so the four zeros mean something.
- **"both controls" survived in `status.js` and here** after iteration 4
  demoted the scale line in the tool only. One fix, two sites, for the second
  time in this branch.
- **The unqualified "BOTH MARKERS ERR"** shipped in `status.js` beside its own
  scoped twin in the tool. Scoped.
- **`notify.js` said "an agent HAS typed it once, ever"** - fifteen agents
  typed it and ONE working agent did. The word doing the work was missing, in
  the flattering direction.
- **The impossible-state control now asserts itself against
  `selfreport.STATES`** rather than resting on a comment saying the list is
  closed. Perturbed: adding the word to `STATES` makes the tool throw.
- **Four exports nothing imported** are gone.

### Amended at iteration 7, and the world moved under the branch

- 🛑 **#1453 shipped mid-loop.** PR #1457 merged 2026-08-29T00:53Z. Two sites
  of this diff asserted "the record does not store who wrote a line" as present
  fact. True when written; false the moment this rebases. Now scoped to the
  historical record, which is what the question is actually about: 0 of 27,047
  lines on disk carry the new field.
- **The tool prefers the record's own word and prints the split.** Not a
  wording fix: `by` where it exists, the hook's sentence where it does not, and
  a printed count of each so the weaker marker's share is visible and can be
  watched falling.
- 🛑 **My first version of arm 12 was decoration and passed under
  perturbation.** The fixture put one record wrong in each direction, so both
  counts read 1 whether `by` was honoured or ignored - only which record sat in
  which bucket changed, and I asserted the counts. **A guard that cannot fail,
  inside the arm written to prevent exactly that.** The fixture is asymmetric
  now: honouring `by` gives 0 hook / 2 typed, ignoring it gives 2 hook / 0
  typed, and five assertions go red on demand.
- **"It prints this exact split" was already stale** - the hook row moved from
  7 to 8 during the session. It now claims the shape, not the numbers.
- **A duplicated `exitCode`/`return` and a mismatched failure-return shape.**
  🛑 I claimed both were fixed at iteration 7 AND NEITHER EDIT LANDED - the
  substitutions silently matched nothing and I committed the claim without
  checking. Iteration 8 found them still there. Both are genuinely fixed now,
  each verified by re-counting the site afterwards rather than by assuming.
- **Rebased onto `origin/main`** so the branch is measured against the world it
  will merge into. ⚠️ That entry said "2,901 tests", which was the count at
  the iteration-7 base and is now stale: the branch was REBASED AGAIN on
  2026-08-29 morning onto a main carrying 15 further commits and +17 tests.
  Verified at the current base: 2,918 tests, 268 of 268 files, 414 shell PASS.

### Amended at iteration 8

- 🛑 **"any pane narrower than the question" is false, and I imported it rather
  than measuring it.** Measured across every width from 6 to 79, both marker
  sets side by side, control at 80 columns where they agree:
  `"Do you want to proceed?"` diverges at **one** width, 22;
  `"Would you like to continue?"` diverges at 17-26. Below the divergence the
  MARKER ITSELF is split, so neither version matches and no red is lost -
  including at the 20 columns the sibling comment's own table uses. The class
  is real, the quantifier was not, and the error flattered this plan's tidy
  "wrong in both directions once" symmetry.
  **The pre-existing comment at `status.js:~1187` carried the same quantifier
  and is corrected too**, rather than cited while known to be wrong.
- 🛑 **Two iteration-7 fixes never landed and I said they had.** The dead
  `exitCode`/`return` pair and the mismatched failure-return shape were both
  claimed fixed in the plan; both substitutions silently matched nothing.
  Fixed now, and each verified by re-counting the site afterwards.
- **A violated control now REFUSES.** The impossible-state line printed
  `<- must be 0` beside a non-zero and went on to print the tool's strongest
  conclusion, exiting 0. By this file's own standard that is a broken
  instrument and gets the drift treatment. **Arm 4 asserted the number MOVED
  and never a consequence**, which is exactly why the gap was invisible: it is
  now three assertions with a perturbation that turns all three red.
- **The plan's arm count and the hook's line number** were both stale again.

### Amended at iteration 9

- 🛑 **My iteration-8 correction left the sentence TWO LINES BELOW IT
  standing, and that sentence was false in both halves.** It read *"Before
  #1155 the same screen read `needs_you`, because the old rule tested the whole
  tail and did not care where the rows fell."* Measured: at the 20 columns that
  comment's own table uses, pre-#1155 reads NOT-RED too, so it is not "the same
  screen"; and the old rule was a regex over a tail CONTAINING NEWLINES, so it
  did care where rows fell. The true statement is now there: the old rule
  tolerated a wrap anywhere outside the marker phrase, the new one additionally
  requires the marker to open the line and the line to close at the question,
  and the divergence band is the widths between those two conditions.
- 🛑 **`notify.js` claimed "no number here on purpose" while carrying three
  derived counts eleven lines above the claim.** Self-refuting, and the counts
  were second copies that drift. Gone; the claim is now true rather than
  asserted.
- 🛑 **The exit-code contract omitted the newest refusal for the second time.**
  Iteration 4 added the drift refusal to it; iteration 8 added a control
  violation and did not. It now enumerates four causes and says the list must
  grow whenever a refusal does.
- **"six agents" was stale within two hours** (it is seven). Both hardcoded
  derived counts are out of the tool header, replaced by the recipe for
  rebuilding the fixture.
- **The hook row's label contradicted the two lines beneath it.** Since #1457 a
  row can be classified by the record's own field rather than the string match,
  so the row now reads "written automatically, not by an agent". And `by:
  'auto'` means MACHINE-WRITTEN, not specifically the permission hook - they
  coincide for `needs_you` today only because the hook is the sole `--auto`
  writer of that state.

### Amended at iteration 10

- 🛑 **THE SAME TWO SENTENCES LIVED IN THREE PLACES AND MY SWEEP FOUND TWO.**
  Iteration 8 corrected them in `status.js` and recorded that the pre-existing
  copy "is corrected too". A third copy sat in `engine/status.test.js:3529` and
  `:3532` - and the second one is false about the very fixture built six lines
  below it, which wraps at 20 columns, where pre-#1155 also reads NOT-RED.
  **Third recurrence of one-fix-two-sites on this branch** (iterations 5, 6,
  and now the sibling TEST file, which I had not thought to sweep at all).
- **"this tool never prints agent-authored text" was broader than true.**
  `because` strings are genuinely never printed, but session NAMES are, and an
  agent chooses its own name. Scoped.
- **An orphaned comment** explaining the empty-record refusal was left sitting
  above `BY STATE` by the gates-before-stdout restructure, reading as though a
  refusal happened there. Moved beside its gate.
- **A citation that does not resolve for a reader who greps:** `defaults.js`'s
  version log names CARDS (#1253, #1272), not the PRs (#1255, #1292) the
  paragraph cited it for. Both are now named.

### Found on origin/main, NOT fixed here, filed instead

Iteration 10 also surfaced a live defect in freshly-merged #1457 work. It is
not in this branch's own surface and folding a hook behaviour change into a
comments-and-one-tool PR would land it under a proof file for a different
change, so it is carded rather than fixed here. **kosmos#1466.**

The short version: #1457's `--auto` sweep missed the SessionStart call (it sits
inside a command substitution), so every machine-written `started` records as
`by: 'agent'` - the exact miscount #1453 exists to remove. And the guard
written to catch that has two patterns which SHARE a separator class, so they
cannot disagree about a command-substitution call: CALL reads 6, LOOSE reads 6,
and there are 7 call sites. Their agreement, which the file treats as proof of
completeness, carries no information about the case that is actually missing.

### Amended at iteration 11

- 🛑 **`selfreport.js` said the measurement lives in ONE copy "deliberately,
  because the number goes stale and three copies go stale separately". There
  are four copies and three of them are stale.** `defaults.js`'s version log
  and `defaults.test.js` twice, all quoting `22 of 21,500`. `status.js`
  acknowledged one of the three. **Fourth recurrence of one-fix-two-sites on
  this branch**, this time inside the sentence written to describe the defect.
  All three are now named where a reader will meet them.
- 🛑 **`"Only what the shell test drives"` was false for four of six exports.**
  The test reads `hookPrefixIsLive` and `HOOK_SOURCE`; nothing in the repo
  requires the module otherwise. Same defect, one line below the sentence
  describing it. Trimmed to two.
- ✅ **A newly created agent DOES carry the verb.** `pete1456pre`, created
  20:49, has `kosmos report needs_you`. That is the other half of the delivery
  story and it landed after my snapshot: **#1296's fix reaches an agent created
  after it**, so the 0-of-17 is about PRE-EXISTING agents holding an unaccepted
  offer, not a fix that does not work. The paragraph now carries the snapshot
  time, the new fact, and the loop to re-derive it.
- **The synthetic-agent list in the tool was stale within hours** (it now also
  holds `pete1456pre`). Replaced by "read the per-agent table", which cannot go
  stale.
- **Arm 12's two failure diagnostics still grepped the old row label**, so a
  failure would have printed an empty tail where the evidence goes.
- **Arm 8b sat exactly ON the `TYPERS_CUTOFF` boundary and asserted only the
  count and the date.** It now pins the verdict too; making the cutoff
  exclusive turns it red.
- 📌 **`node --check` caught me closing a block comment with a glob.**
  `~/work/workers/[star]/CLAUDE.md` inside `/* … */` ends the comment at the
  `[star]/`. One command later, not in review.

### Amended at iteration 12

- 🛑 **FIFTH RECURRENCE, AND THIS PLAN CLAIMED THE OPPOSITE.** Iteration 11
  corrected `selfreport.js`'s "the measurement lives at rule 3, ONE copy", and
  this plan recorded "all three are now named where a reader will meet them".
  The identical sentence was still standing in **two** other places -
  `engine/notify.js` and the tool header - so a reader meeting the claim there
  was told the opposite. Both corrected.
- 🛑 **A citation added at iteration 10 to make a reference resolve now
  misdirects.** It says the version log "does not name" #1255 and #1292.
  `defaults.js` names #1255 in its version-6 entry; only #1292 is absent.
- ✅ **The impossible-state control covered one string, not the class.** Any
  other unrecognised state was counted into `records` - the share DENOMINATOR,
  so it inflated it in the flattering direction - and was PRINTED VERBATIM in
  BY STATE, a second channel for agent-authored text the header's own caveat
  did not name. Every state is now checked against `selfreport.STATES`,
  matching what `selfreport.js`'s reader already does; the refusal names the
  FILE and never echoes the value. Arm 4b covers the class, and all four of its
  assertions go red under perturbation.
- **This plan's weakest-premise section carried a stale present-tense count**
  contradicted by its own iteration-9 entry, well above. No figure there
  now.

### Amended at iteration 13

- 🛑 **SIXTH RECURRENCE, and this one sits four lines from its own pledge.**
  `status.js` says "No count here: it was written as six and was seven within
  two hours" and then, four lines later, "those SEVEN records carry the hook's
  generated shape". The identical passage in the tool had already had its count
  removed. Both are countless now.
- 🛑 **This plan's iteration-12 entry claimed a fix that was not present.** It
  recorded "no figure there now" while the weakest-premise section still pinned
  two, one of which contradicted a "no figure pinned" parenthetical two lines
  above it. Removed for real, and verified by grepping for them afterwards
  rather than by asserting it.
- 🛑 **A count outlived the list it counted.** "Guessing at which of those six
  are tests" kept a number whose antecedent I deleted at iteration 11, and it
  was stale anyway.
- ⭐ **AND MY DELIVERY EVIDENCE MEASURED THE WRONG THING, IN A WAY THAT MAKES
  THE CASE STRONGER.** `0 of 17 carry kosmos:doctrine:` measures the CONSENTED
  REFRESH SPAN, not receipt: the creation path writes the same text with no
  marker. Two of the seventeen carry nine of `defaults.sections()`'s headings
  verbatim as plain text (control: two other agents at 0 of 12). So those two
  DID receive a doctrine block and still lack the verbs, because they were
  created before the verbs existed and the later edits landed inside a heading
  they already held. A marker zero could never have shown that.
- **The `by` field is now being written** (660 of 28,131 lines, none of them
  `needs_you`). "Every line on disk carries no `by`" was true at the snapshot
  and is not now; scoped, with the narrower claim that actually matters.
- **The test title read as the opposite of its assertions** (`is seen on a
  WRAPPED pane` where the test asserts it is MISSED there and seen on the
  joined form).

### Amended at iteration 14, the first pass with NO blockers

- ⭐ **My own iteration-12 fix made a control unfailable, and I had demoted its
  sibling four lines away for exactly that.** Refusing before any output means
  the printed `a state no writer can produce ... must be 0` line can only ever
  read 0: the gate fires first, so there is no third input. Measured both arms.
  The line is no longer called a control and says why it is always 0; the GATE
  is the real protection and arms 4 and 4b fail on demand.
- **An arm asserted something that could not fail.** "Reads zero on a clean
  record" is true by construction for any record that reaches stdout. Removed,
  with the reason recorded in place; what remains is the assertion that a clean
  record still ANSWERS, which a too-broad gate would break.
- **The plan's suite figure was stale after this morning's rebase** (2,901 at
  the old base; 2,918 at the current one).
- **"Four FALSE reds" understates #1155 by one.** Its own docblock says four
  prose sentences plus a fifth case, an agent quoting a prompt: 2 of 7 before,
  7 of 7 after. For once the error ran against my own argument rather than for
  it.
- **A duplicated sentence** about the tool printing a count, said twice in four
  lines.

## What this deliberately does NOT do

- **No behaviour change.** Comments, one read-only tool, one test, one line of
  `package.json`. Nothing a user sees moves.
- **Does not close #1253.** PigeonPete's arm A/B experiment is the half that
  settles the card. Taken next, by me.
- **Does not widen or narrow the classifier.** #1155 argues that separately
  and I would push back on widening the markers.

## Weakest premise, named

The provenance split is a STRING MATCH on the hook's own sentence
(`install/kosmos-report-hook.sh:235`, on current main), because the record does not store who
wrote a line: `report --auto` is a write-time discriminator
(`selfreport.js`, the `entry.auto === true` branch) and was not persisted.
Filed as #1453 - **and fixed by #1457 while this branch was in the challenge
loop.** `selfreport.record` now persists `by: 'auto'|'agent'`. The fix is not
retroactive and this is a question about the historical record, so the string
match became a FALLBACK rather than the only marker: the tool prefers `by`
where it exists and prints how many of each, so a reader can see how much of
the answer still rests on the weaker one.

🛑 **AND I HAD THAT CAVEAT'S DIRECTION BACKWARDS.** I first wrote that the
error "biases the count in the SAFE direction, since it can only make
agent-typed look smaller than it is". That is exactly wrong. **The conclusion
here IS "agent-typed is near zero", so making agent-typed look smaller makes
my own conclusion look STRONGER.** It is the flattering direction, which is
the one direction a caveat must not be wrong in. Splinter's question about
#1453 against this number is what surfaced it; an independent reviewer read
the same sentence and endorsed it.

🛑 **AND THE BOUND I ADDED TO DEFEND THAT CAVEAT WAS ITSELF THE FLATTERING
DIRECTION.** I wrote that the conclusion "survives its own worst case" because
granting every hook record to the agents stays under the share cutoff. **The
verdict has TWO cutoffs and I checked the one that let it pass.** The
hook-classified records are spread across many agents rather than one, so the
worst case breaks the distinct-agent clause. (No figure pinned: it was written
as "seven records across six agents" and was eight across seven within two
hours. The tool prints both live.) Measured by building that exact fixture and running the
tool: it prints the OPPOSITE verdict. (No figures pinned here, and an earlier
version of this section pinned two of them - one of which contradicted a "no
figure pinned" parenthetical two lines above it.) Found by challenge-loop iteration 3, reproduced by me.

✅ **What stands instead is an ARGUMENT, labelled as one because it is not a
measurement:** those records each carry the hook's generated shape, a
tool name plus a verbatim command, which a person does not type by hand; and
`hookPrefixIsLive` guards the marker against drift and now REFUSES rather than
warning. Read the per-agent table and judge.

## What would change my mind

`node tools/needs-you-source.js` printing "agents ARE reporting this state
themselves". The tool is built so that this is a possible output and arm 3
proves it.
