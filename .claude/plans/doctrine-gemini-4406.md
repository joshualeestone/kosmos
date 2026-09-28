# #4406: an Instructions box that looks empty, and a way back to the previous version

Branch doctrine-gemini-4406, off origin/main 32511002f. Angel, 2026-09-28 (Josh's Gemini-Test2, priority).

## Finished looks like
- While an agent's Instructions box is loading (for example during a restart, when the board may be slow to
  answer), the box says it is loading. It never looks like an empty file.
- When the previous version of an agent's instructions is kept, the Instructions tab offers "Put the previous
  version in the box". It fills the box with that text and writes nothing. The person's own Save keeps it,
  through the same version check, and that Save keeps today's text as the new previous version, so it can be
  undone the same way.
- Josh can bring back his text without a Terminal if it was ever lost.
- (Splinter 14:58, on the card, after Josh's instructions were confirmed there on reopen: not wiped.) While loading:
  the loading mark and "Loading instructions..." in the box, never an empty editable box; a failed read says so
  with Try again; Save stays off until the content has loaded (already true: the loader holds the box and Save
  until the answer lands, and the server refuses a save under 20 characters; now asserted).

## What was measured first (sandbox, engine on origin/main)
- The Add ("Add Instructions & Restart") on a Gemini agent keeps the person's words, writes GEMINI.md.previous,
  and clears the notice. The restart's one writer (communityblock.tellAgent, #4289) keeps them too. The box and
  the notice read the same file. So no wipe was reproduced; the fix is the two gaps the case exposed.

## Changes
1. engine/instructions.js readPrevious(agent): the `.previous` beside the agent's file, read through
   workerfile.readWorkerFile (the same symlink, containment and size refusals as read), UTF-8 checked like
   inspect. { exists, text, because }.
2. server.js GET /api/agent/<name>/instructions/previous: knownAgent gate, as the instructions GET.
3. web/index.html: the box's placeholder says "Loading these instructions..." while a load is in flight (and
   is cleared when it lands); a button in the d-instr-prev line fills the box from the previous version and
   says nothing is saved until Save.

## Decided
- Fill the box, never write on the press: a restore that writes would be a second write path with its own
  version rules; Save already has them. Rejected: a one-click restore route.
- Not changed: the Add and the restart writers (measured correct).

## Tests
- engine/instructions test: readPrevious returns the kept text; missing -> exists false; a symlink is refused.
- server test for the route (known agent, unknown agent 404).
- browser check: loading placeholder shows while the load is held; the button fills the box with the previous
  text, saves nothing (no PUT), and Save then sends that text with the current version.

## Weakest premise
That Josh's box was empty because its load had not landed. If his file really is empty, this branch still gives
him the way back (the previous version), which is the part that matters.

## Status
- 15:07: built. Engine readPrevious (tests: kept text, none kept, symlink refused); route GET
  /instructions/previous (server.test: kept text, writes nothing, unknown and malformed names 404); page:
  loading line with the Sweep mark + placeholder, Try again on a failed load, a button that fills the box from
  the previous version and writes nothing. Browser check render-detail-header-1841.js gains the #4406 arms,
  with the page's requests answered by the check (the sandbox's stand-in agent is not one the route knows).
- Measured by the check while building: the load is keyed by session name ("beatrix-discord"), not the
  display name; a load that lands after another agent opened now clears the placeholder as well as the line.
