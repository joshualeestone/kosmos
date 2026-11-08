# noticewait-8235: say when a file-owner notice reaches its owner (kosmos#8235)

## Problem
A file-owner notice (#7989, Windows #8014) is fetched by the report hook at most once every 5 minutes per agent
(FILE_NOTICE_EVERY = 300 in engine/kosmos-report-hook.js and install/kosmos-report-hook.sh), because the fetch holds up
the person's turn for up to 1 s. A check made just after the change sees no notice and reads as the feature broken.

## The call: keep the throttle, say so where a checker reads
- The room's copy of the notice (agents' audience) gets one sentence: if the owner runs in Claude Code, Kosmos also hands
  it the notice at a prompt of its own, looking at most once every five minutes (from its last look). Other runners keep
  only the room note (engine/filenotices.js), hence the condition. The owner's own queued copy is unchanged.
- `kosmos file-notices` usage, on both CLIs in the same words, says the hook asks at most once every five minutes.

## Rejected
Fetch at once: the cheap form (the board's answer to the prompt's working report says a notice waits) works only on
Windows, where the JS hook awaits that report; the Mac hook detaches it. A flag file the hook checks would need the
board to write into the agent's temp folder, which on the Mac can differ from the board's.

## Tests
engine/filewriters-noticewait-8235.test.js: the room copy is the owner's text plus the sentence, the owner's copy lacks
it, the room note and the queue use the right one, "five minutes" equals both hooks' 300 s, and both CLIs carry the
same usage sentence. engine/filewriters-owner-7989.test.js updated for the room copy.

## Weakest premise
That a checker reads the room note or the usage text. If one-off checks still read as broken, the Windows-only fetch is
the next step, on its own card.
