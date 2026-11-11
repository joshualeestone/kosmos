# holdsuggest-8395: a suggested answer beside a for-you hold's question

Card: joshualeestone/kosmos#8395 (part 2 of #8389, split to Angel by Ice Cream Kitty). Built on her part 1 branch
(askedcount-8389, PR #8398) and rebased onto main after it merged (15:05 CST 11-11).

## Finished looks like

An agent that holds a task for the person can add `--suggest "<answer>"` (both CLIs). The person sees "Suggested:
<answer>." right after the question on the project's column card, the Tasks row and the task page, and `task show`
prints it under "Suggested answer:". It goes when the question does, and agents are told it exists.

## Decided (Kitty's points on the card, plus Angel's comment there)

- Stored as `onHoldSuggest` beside `onHoldBecause`: one line, at most 200 characters (holdSuggestOf, the reason's
  shape). Not given keeps it; empty clears it.
- Belongs to the question: dropped where the told marks drop (the for-you mark off or newly on, or the reason changed),
  and when the hold comes off or the task closes. Not added to HOLD_TOLD_FIELDS. A suggestion sent in the call that
  changes the question is kept (it answers the new one).
- Only an agent's for-you hold carries one: refused (400) on a hold not for the person or on the person's own screen
  hold, and (403) when an agent sends one for the person's hold.
- Shown with a single page helper, tskHoldSuggestWords (plain text, escaped by every caller). Agents learn of it in
  their project instructions, after the --for-you line.
- Both CLIs take --suggest anywhere after the task number (the Mac parser lifts it with its value before the
  positional options), refuse it without --for-you or with no words, echo it only when the board's answer carries it,
  and exit 1 when an older board drops it (as --for-you does).

Rejected: a field outside the hold (it would outlive the question).

Weakest premise: that 200 characters is enough for a suggested answer (sized for the one-word answers in the
feedback). Correction to my card comment: marking a task built does not touch a hold, so nothing is dropped there.

## Change

- engine/tasks.js: holdSuggestOf, setOnHold's suggest, the drops (close x2, unhold, the question changing).
- server.js: the hold route passes body.suggest.
- engine/tasklist.js: task show's "Suggested answer:".
- web/index.html: tskHoldSuggestWords; the column card, the Tasks row, the task page.
- engine/projects.js: one sentence in the agent instructions.
- install/kosmos, tools/windows/kosmos-cli.js: --suggest, help and usage.
- Tests: engine/holdsuggest-8395.test.js (7), cli.task-hold-4771.test.js (+3), tools.windows-kosmos-cli-570.test.js
  (+1), docs/browser-checks/render-onhold-4771.js (+3 checks, and tskHoldSuggestWords on its surface line).

## Results

- Engine and hold tests 54 of 54; Mac CLI hold 15 of 15; Windows CLI 65 of 65.

## Challenge loop

- Iteration 1 (opus): 1 WARNING: the iPhone app also shows the for-you question (ios/Kosmos/TasksLogic.swift) and
  does not show the suggestion: DEFERRED to its own card (an iOS change needs its own Swift checks and LogicTests run).
  NITs FIXED: a suggestion of only spaces is refused by both CLIs (it would have cleared a stored one and claimed an
  older board); the help lines align; a test replaces one suggestion with another; this plan's base. NITs noted: the
  CLI echoes the raw words, not the tidied ones (as --because does); no hostile-value escape check on the page (every
  caller escapes); an agent's null suggest on the person's hold is refused (the CLIs never send one).
