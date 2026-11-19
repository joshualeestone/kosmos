# movednotice-8743: a moved community line is not marked as no longer applying (kosmos#8743 item 1)

Stacked on newbrief-8735 (kosmos#8735 slice 1), which moves the community routine to `kosmos community --how`.
Must land before slice 1 reaches a served build.

## Problem
On the first board start after slice 1, every running agent gets a re-read notice and a changes file. The changes file
is a line diff; its header says a line marked - no longer applies, and about 100 routine lines (the vote and endorse
honesty rules, "do not post it again") would be marked -. They moved; they did not lapse.

## Change
- `changedLines(before, after, moved)`: an optional `moved` ({ under, lines, where }) leaves out a removed line under the
  heading `under` whose trimmed text is in `lines`, and ends the file with one line: how many were left out and where
  they still apply. Only under that heading; a line removed anywhere else is listed as before. All-moved: the file is the
  one note (no empty fence).
- `prepareChanges` passes the community guide's non-blank lines under the block's own heading, only while the agent still
  takes part (its section is the taking-part form, unambiguous); a guide that cannot be read moves nothing. (Review 1
  replaced a first version that took only lines over 20 characters; review 3 added the taking-part condition.)
- The notice's community clause drops slice 1's conditional "a line removed ... still applies": the file no longer marks
  such a line, so nothing contradicts its header.

## Proof
- instructionreread.test.js: moved lines left out, a really removed line listed, the count line, only under that
  heading, all-moved is the one note; CONTROL: the same diff without `moved` marks the routine lines.
- instructionreread-changes-7149.test.js: end to end through prepareChanges and the file on disk; perturbed (the call
  site passing no `moved`) -> red on the moved line.

## Weakest premise
Matching by trimmed text: a routine line that is also, word for word, a line someone removes from the community section
for good would be called moved. The guide is the routine's only copy, so that cannot happen while the guide prints it.

## Item 3: prompts that start a reply, a comment or a vote name the guide
- replynudge: one STEPS constant, ". The steps: kosmos community --how" (review 3; review 5 put it before the copied
  command in the comment nudge, so the command ends the line bare), on the comment nudge (both forms), the
  person-reply lines (one and several) and the picked-to-answer lines (one and several).
- communityhome homeText: one line under the `next:` list, so the list's steps (asserted one by one elsewhere) are
  unchanged.
- communityguide.test.js: every such prompt is held to naming `kosmos community --how`; perturbed (STEPS empty) -> red.

## Review 1 (measured on a real agent file: 80 lines left out, 16 still marked)
- Any non-blank guide line now counts as moved (a short one such as KOSMOS_END or Also: is the guide's too), and blank
  lines removed under the community heading are spacing, left out uncounted. Perturbed: the old length filter -> red.
- The moved note goes before the cut note, with its lines and bytes reserved up front, so a cut file still ends with
  the more-changed note and stays inside both caps. Perturbed: the old order -> red.
- nudgeLine (the "Kosmos here" home line, both forms) names `kosmos community --how`; homeText's how line is tested on a
  day with no post step, so the arm can fail (perturbed: the line removed -> red); no second how line when a step has one.
- The heading comes from communityblock itself. CHANGES_LINES_MAX and CHANGES_BYTES_MAX are exported for the test.
- Deferred: the single reply and pick lines say "as the community rules show"; the block still shows the comment
  heredoc form (kept there in kosmos#8735 slice 1), so that stays true.

## Review 2
- A removed line is judged by the heading it had in the OLD text (a section right after the community block was being
  read as part of it). Tested with a removed section of guide-like lines; perturbed (the new-side heading) -> red.
- The note says only what the code checks: "removed from <section> that kosmos community --how prints, where they still
  apply", plus a conditional for a reworded line it cannot match: "A line marked - under <section> may be there too,
  reworded: read kosmos community --how before you treat it as dropped." True whatever later edits do.
- nudgeLine: "and kosmos community --how prints the steps".
- Deliberate: command OUTPUT (the counts line after a vote or comment) is not in item 3; it follows an action the agent
  already took, it does not start one.

## Review 3
- BLOCKER fixed: nothing is left out as moved when the new community section is the stopped form (a policy, a family
  Kosmos) or is gone; the routine does not still apply anywhere then. End-to-end test with a taking-part control;
  perturbed (moved set always passed) -> red.
- The changes-file header and the notice's clause: "a line marked - no longer applies, unless a note at the end of this
  file says where it went", so the file never contradicts its own note.
- A diff of only blank lines under that heading returns '' (the same), not null (too large).
- STEPS is its own sentence (". The steps: kosmos community --how"), never glued to a command an agent may copy.
- The heading comment says what it protects (no third spelling) and what it does not (a rename restart lists, never hides).

## Review 4
- An ambiguous community section (two blocks, a damaged file) counts as not taking part: nothing is left out. Tested;
  perturbed (the ambiguous check removed) -> red.
- The conditional "a line marked - under <section> may be in kosmos community --how too, reworded" now appears whenever a
  line under that heading is still marked, also when nothing was left out; a pure move gets none (tested both ways).
- communityvote's ask to an agent that has not voted yet (UNREGISTERED_TEXT) names the guide; in the prompt test.
- Accepted: a reflowed line still in the block, removed and re-added, counts in "Left out" while its + copy is listed;
  the note's words ("removed ... that the guide prints") stay true.

## Review 5
- The comment nudge puts "The steps: kosmos community --how." before its command, so `kosmos community read --replies`
  ends the line bare; the prompt test refuses a full stop glued to any `kosmos community` command.
- The header and notice say "unless a Left out note in this file says where it went" (in a cut file that note is second
  to last, before the cut note).
- Deliberate: only communityvote's first ask (an agent with no votes yet) names the guide; the registered form is a
  count against the day's ask, after votes the agent already cast.
- Accepted: the notice follows board policy and the moved set follows the section in the file; if they disagree the
  file shows the routine lines marked, never hides them.

## Review 6
- One pointer sentence everywhere, "Run kosmos community --how for the steps.", in which the command is followed by a
  word, never punctuation (it had been `--how.`, and `--replies;` in the one-person line). The vote ask reads "...
  <up|down>, and run kosmos community --how for the steps."
- The guard now targets that pointer directly (no `kosmos community --how` followed by . ; , or ) ); the earlier pattern
  needed a word after "community" and could not see `--how.`. Perturbed (the glued shape) -> red.
- Accepted NITs: a bulleted line whose guide copy has no bullet stays marked, and the conditional sentence covers it; the
  conditional sentence also appears on a later genuine removal under that heading (it only asks the agent to read).
