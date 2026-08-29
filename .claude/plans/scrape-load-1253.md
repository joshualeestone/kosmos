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

2. `tools/test-needs-you-source.sh`, 21 named arms and 47 passing assertions.
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
  opposite at line ~1191:** an option-less prompt classifies `idle` on any pane
  narrower than the question, where before #1155 it read `needs_you`. That IS a
  legitimate red lost to #1155 - latent rather than live, and neutralised by
  adding `-J`. Both corrections now stand, in opposite directions, and I
  shipped each of them wrong once.
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

## What this deliberately does NOT do

- **No behaviour change.** Comments, one read-only tool, one test, one line of
  `package.json`. Nothing a user sees moves.
- **Does not close #1253.** PigeonPete's arm A/B experiment is the half that
  settles the card. Taken next, by me.
- **Does not widen or narrow the classifier.** #1155 argues that separately
  and I would push back on widening the markers.

## Weakest premise, named

The provenance split is a STRING MATCH on the hook's own sentence
(`install/kosmos-report-hook.sh:218`), because the record does not store who
wrote a line: `report --auto` is a write-time discriminator
(`selfreport.js`, the `entry.auto === true` branch) and is not persisted. Filed as its own card, #1453.

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
verdict has TWO cutoffs and I checked the one that let it pass.** Those seven
records are spread across six agents, so the worst case breaks the
distinct-agent clause. Measured by building that exact fixture and running the
tool: it prints `observed: 0.0307% and 6 agent(s)` and then the OPPOSITE
verdict. Found by challenge-loop iteration 3, reproduced by me.

✅ **What stands instead is an ARGUMENT, labelled as one because it is not a
measurement:** those seven records each carry the hook's generated shape, a
tool name plus a verbatim command, which a person does not type by hand; and
`hookPrefixIsLive` guards the marker against drift and now REFUSES rather than
warning. Read the per-agent table and judge.

## What would change my mind

`node tools/needs-you-source.js` printing "agents ARE reporting this state
themselves". The tool is built so that this is a possible output and arm 3
proves it.
