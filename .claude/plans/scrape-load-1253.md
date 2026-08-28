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
records                26,227
  needs_you                22
    7  written by the PermissionRequest hook on an agent's behalf
   14  belonging to two walkthrough FIXTURE agents
    1  ever typed by a working agent (PigeonPete, 2026-08-24)
```

`#1255` shipped the instruction telling agents to report the state. 4,700
reports later the count has not moved by one.

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
   - prints both controls (a state no writer can produce, which must read 0;
     the most common state, which must read non-zero), the cutoff it uses,
     and a per-agent table so the reader judges which agents are real
   - asserts its conclusion against its own numbers, and prints the OPPOSITE
     conclusion when agents have started reporting the state themselves

2. `tools/test-needs-you-source.sh`, six arms.
   **Arm 3 is the load-bearing one:** the tool must be able to print the
   uncomfortable answer. A measuring tool that can only ever return
   "load-bearing on the scrape" is decoration on that sentence, not evidence
   for it.

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
(`selfreport.js:109`) and is not persisted. An agent typing those exact words
is therefore counted as a hook. That biases the count in the SAFE direction
for this argument, since it can only make agent-typed look smaller than it is,
never larger. Filed as its own card.

## What would change my mind

`node tools/needs-you-source.js` printing "agents ARE reporting this state
themselves". The tool is built so that this is a possible output and arm 3
proves it.
