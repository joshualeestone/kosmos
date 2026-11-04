# #7976: a Grok agent keeps its report hooks

Addresses #7976.

## What finished looks like
A grok agent launched on a Mac or Linux board has its report hooks in place, whatever happened to its home since it was made, so `kosmos handoff`'s live state is not stale for want of a hook file.

## Measured, 11-04
- The pinned grok (1.0.41) with the hook file, against a fake model and a stub board: started, working, idle, stopped, all auto. Control, no file: no report. So option 1 on the card (make Grok report) is already built for lifecycle events.
- This Mac's real file, written 09-27, has no PreToolUse, though the code has added it since. So a hook file never updates after birth.
- `create.js` wrote it at birth only and said so ("a WIPED ~/.grok loses the hook file until the agent is remade").

## Change
The supervisor runs `engine/groksettings.js` before every grok launch, on `$_GROK_ACCT` (the home grok reads), as it does for agy (#4043). Same writer as birth. Our own file, so the person's other hooks stay. Never blocks a launch; why not goes to the agent log.

## Decided
- Rejected the card's tool-use hook for now: a report every prompt and every stop is enough for a day-old line, and a new hook on a missing file would be silent too.
- Rejected falling back to the board's state in handoff: it breaks handoff's local-only rule and answers a different question.
- Weakest premise: nobody has read the five-family seat. This fixes the file being missing or old. **It does not fix the other way a line goes stale:** a deliberate `blocked` or `needs_you` is by design not overwritten by automatic reports (#900, #1949), so a diagnostic filed that way stays until the agent clears it. If that seat's line was that, this changes nothing, and the age already says so honestly. What would settle it: that seat's file `selfreports/<name>.jsonl` (the last row's `by` and `state`) and whether its hook file exists.
- Not changed: Windows (per-turn runs, its hook file written at birth only, not measured here) and Gemini's same residual (#3136). The first report after an upgrade needs a restart of the agent, since this runs at launch.

## Review 1 (blind, opus)
No blocker or major. Fixed: comments left saying "at birth" only; a comment false on Windows; a skip that logged nothing (the very silence this ends); a test that compared the writer with itself, replaced by one in the installed layout; the test's temp root.

## Tests
`supervisor.grokhook-7976.test.js` executes the shipped supervisor. With the launch step made a no-op, 6 of 7 fail and the other-runner control passes.
