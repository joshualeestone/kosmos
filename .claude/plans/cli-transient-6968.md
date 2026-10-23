# #6968: a refused connection to a listening board is tried once more, and says it is passing

## Finished looks like
`kosmos task` (and every verb that goes through `kosmos_curl`) succeeds when the board refuses the request's
connection once and takes the next; when it refuses twice, the agent reads that this is a passing connection
problem and nothing was sent, never "Is it running?". A test drives a board that refuses once (succeeds) and a
control that never takes the connection again (the new words).

## Measured
- 40 connections at once to a listener that is not keeping up (macOS, 2026-10-22): 36 timed out (curl 28), 3
  refused (curl 7, "Couldn't connect to server"), 1 reset (56); lsof showed the listener the whole time. A
  board that is too busy refuses some connections outright, and a restarting one refuses until it listens.
- The CLI's health check passes first, so the request's refusal reached `say_unreached`'s fallback,
  "We could not reach Kosmos to X. Is it running at URL?".

## Decided
- `kosmos_curl` retries curl 7 once, after 1 s (`KOSMOS_REFUSED_RETRY_S`). Only 7: nothing reached the board,
  so a write is safe too. 18/28/52/56 may have landed and keep their words.
- A body on stdin (`@-`) is read once into a mode-600 file and both tries send it; the first try's output is
  held in a mode-600 file and only the last try's is printed (curl prints `-w` even on a refusal).
- `say_unreached` 7: the passing-problem words. The comment verb, which had its own copy of the old line for 7,
  goes through `say_unreached` for 7.

## Rejected
- Retrying timeouts or cut replies: a write may have landed.
- More tries or a backoff: a board that is really gone should fail in about a second.
- Changing the health check: it already re-probes once after half a second when a listener holds the port.

## Weakest premise
The reporter's install is not this one; the refusal is reproduced (full accept queue, restart), not observed
on their machine.

## Not built
- The Windows CLI (`tools/windows/kosmos-cli.js`) has the same "Is it running?" line: Homer's lane, a
  follow-up card.
