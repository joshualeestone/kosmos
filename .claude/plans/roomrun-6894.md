# roomrun-6894: a recurring task's changed result in the project room (#6894, split from #6893)

## Finished looks like
When a repeating task's run finds something new (a note that is a change, or a reading that differs), the project
room gets one line from Kosmos naming the task, how often it runs and what changed. Unchanged runs and duplicates
put nothing there, so a task every 30 minutes does not fill the room.

## Steps
1. engine/taskrepeat.js roomRunLine(before, after): pure, the rule and the words.
2. server.js ran route: read the task before recordRun (best effort), then roomNote the line if any.
3. Test through the real route: new note, repeated note, --unchanged, first reading, changed reading, same reading,
   duplicate inside the minute; control: setting a rule and a one-off run say nothing.

## Decisions
- Only changes, never every run (48 lines a day for a 30-minute task).
- Kosmos's own voice (roomNote), so it never reads as the agent speaking.
- Not in this slice: a line when a run is MISSED. The miss sweep tells only a named reviewer and keeps "told once"
  per task; a room line needs its own once-only record. Left for a follow-up if the room still looks stale.

## Weakest premise
That agents send a note or a reading for runs worth relaying. A run with neither is never relayed.
