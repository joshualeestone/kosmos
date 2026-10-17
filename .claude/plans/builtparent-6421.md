# builtparent-6421: the idle prompter says why a parent with built subtasks is still open (#6421)

Agent-seat feedback 2026-10-17: a delivered parent task stayed open because its subtasks were "built" rather than
closed, and the idle prompter nudged the agent about it without saying why. The card asks to fix the rollup and the
prompter's wording rather than add UI (Josh's 2026-10-17 11:16 ruling against new lines on the interface).

## What changes
engine/agentnudge.js only. openParts carries the parent's direct-subtask counts (tasks.treeOf(p).progress, the one
derivation #5956 added for the screen's "every subtask is built") when at least one subtask is built. nudgeText adds one
sentence:
- nothing below unfinished: "Every subtask under it is closed or built (N are built, waiting for the person to check and
  close them), so if your own part of it is done too, mark it built: kosmos task built <id> <n> '<how its checks went>'."
- some unfinished: "B of its T subtasks are built, waiting for the person; L are not finished."
No subtask built: the line is unchanged.

## Decided
- **Wording, not a new action.** The card's "safe close completed children" action is a new button, refused by the
  ruling, and closing is the person's (tasks.js: NOTHING CASCADES, "the person decides; the screen offers it"). The
  prompter tells the agent what it can do itself: finish its part, or mark the parent built, which frees it.
- **Built is named as waiting for the person, not unfinished.** That is the card's "awaiting release vs not finished".
- **Not done: naming which done-when check is unmet.** The board does not know which check is unmet; the agent says so
  in its built note. Naming the checks would lengthen every nudge for a guess.
- Held subtasks count as not finished (isBuilt excludes a held task, as the screen does).

## Weakest premise
That the nudged agent holds the parent's own part, so marking it built is its move. If the parent's part belongs to
someone else, this agent is not nudged about it at all (openParts takes only its own parts), so the sentence cannot
reach the wrong agent.

## Tests
engine/agentnudge.test.js (+3, through the real sweep): all subtasks built names the mark; some built gives the counts
and does not name the mark; control: no built subtask, no subtask sentence. Against main's agentnudge.js the two
behaviour tests fail and the control passes.
