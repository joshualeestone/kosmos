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

## Cases the sentence leaves alone (review 1)
- **Another open part on the task** (someone else's, or nobody's): "mark it built" would mark the WHOLE task, declaring
  the colleague's unfinished part built. The sentence then says the other parts are still open and names no command.
  The first version of this plan claimed the sentence could not reach the wrong agent; that held only for a one-part
  task, and review 1 showed it. Not counted as another's: the agent's own second part (review 2), and the part of a
  colleague who has already marked the task built (review 3: marking never closes a part, and agents cannot close one,
  so it read open and held back the very command that frees this agent).
- **The note placeholder** is offered only when the parent has done-when checks, as setBuilt only asks for one then.
- **A repeating parent**: never marked built (setBuilt refuses it), so it carries no subtask sentence at all.

## Weakest premise
That an agent holding the only open part may mark the parent built when its subtasks are built. If the parent's own
done-when checks are unmet, the built note says so (setBuilt asks for it), so the person sees it rather than a clean
mark.

## Tests
engine/agentnudge.test.js (+9, through the real sweep unless noted): all subtasks built names the mark (no checks, no
note placeholder); one built plus one closed says "it"; some built gives the counts and names no mark; plural counts
with a held built subtask counted as not finished, and an unassigned open part as another's; a colleague's open part
names no mark; the agent's own second part does not hold it back; a colleague who already marked it is done, and with
checks the placeholder is asked for; a repeating parent carries no counts (hand-built records; control: not repeating,
it does); control: no built subtask, no sentence. Against main's agentnudge.js the behaviour tests fail; one-line
mutants of the repeat, other-part, own-part and already-marked guards each fail exactly their test.
