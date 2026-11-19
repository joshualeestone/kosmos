# clipipefu-8603: follow-ups to #8599's closed-reader guard (kosmos#8603)

Card: kosmos#8603 (left at #8599's 8-round review cap). Was parked needs-event until #8599 merged; it merged as #8609
(and #8715 since), so it was unparked 14:0x CST 11-19.

## Finished means
1. A test fails if install/kosmos ever gains a line (outside a comment) that could start a tmux server or an agent,
   because the wrapper's NODE_OPTIONS preload would ride into that pane.
2. engine/clipipe.js says only what is true about a stream error that is not a closed reader, and a test pins it in a
   real process.
3. The NITs that still apply are done or recorded.

## How
- cli.no-tmux-server-8603.test.js: reads install/kosmos and refuses any non-comment line matching new-session,
  start-server, `tmux`/`$AGENT_WORKFORCE_TMUX_BIN` (with flags, each with or without an argument) followed by new or
  start, or `exec claude`. Presence first (the script does call tmux, to read); a control proves the matcher fires on
  each way of starting one and not on the reads the script makes.
- engine/clipipe.js header: "still fails as loudly as before" becomes what was measured on 11-19: the same non-zero
  exit and the message on stderr; only the trace differs (it points at the guard's rethrow, not Node's own line).
- engine/clipipe.test.js: a real child process raises EIO on stdout, guarded and alone: the same exit code, not 141,
  the message on stderr.
- tools/test-cli-epipe-8599.sh arm 4b: with the guard off (KOSMOS_CLIPIPE_SET=1 before the wrapper), a child of the
  CLI's node sees the person's NODE_OPTIONS exactly. Perturbed: a wrong expected value fails it.

## Decided
- Item 2 by rewording plus a test of the real behaviour, not by changing the rethrow: a crash with a different trace is
  the intended design; only the comment overclaimed.
- Item 3: the 156-column line no longer exists (gone since #8715). Moving the preload epilogue and isBoard above
  module.exports was not done: it works by hoisting today, and moving runtime code for order alone is a change with no
  behaviour to test. Recorded, not worked.

## Weakest premise
The tmux guard is a text tripwire: a verb built at run time, or a tmux call hidden inside a node -e program, is not seen.
The node programs in install/kosmos call engine/status.js, which only reads tmux.

## Tests
- cli.no-tmux-server-8603.test.js (2), engine/clipipe.test.js (9, one new), tools/test-cli-epipe-8599.sh (PASS, arm 4b new).
