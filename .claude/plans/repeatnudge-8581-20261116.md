# repeatnudge-8581: tell a due repeat to its holder with the Prompter off

Card: #8581. Two daily repeats held by echo went 27 days with no run while echo sat idle.

## Cause (measured, on the card)
The holder nudge for a due repeat runs only inside agentnudge.prompterTick, which runs only with the
Prompter on. This Mac's Prompter is off (heartbeat.json holds ""), and night-shift prompts only builders.

## Call
A minute sweep outside the Prompter tick (engine/repeatdue.js), wired in server.js beside the missed-run tell:
- runs only with the Prompter OFF (prompterTick already nudges due runs when it is on);
- tells one holder once per due slot, stored as repeatDueToldAt on the task;
- missedtell's delivery gates: idle and settled, one line per agent per pass, Agent Communication limit,
  a hold spends no try, MAX_TRIES then recorded as not reached;
- skips paused projects, held/closed tasks, holders switched off in the project;
- history row kind due-told, worded on the page and in the CLI, excluded from last activity.

## Rejected
- Turning the board Prompter on here: double-prompts every builder night-shift already prompts.
- Adding echo to night-shift: night-shift hands builders cards; wrong tool for a daily job.
- Sharing missedtell.sweep's loop: thirteen reviews of tuning for its case; a refactor is not this card.

## Weakest premise
That a repeat schedule counts as the holder asking to be reminded, so it is exempt from holdstale review 5's
"no unprompted lines with the Prompter off".

## Not in this branch
The 48-hour stale-repeat mark in the task list (the card's optional ask).
