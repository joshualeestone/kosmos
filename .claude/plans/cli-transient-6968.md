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
- `kosmos_curl` retries curl 7 once, after 1 s (`KOSMOS_REFUSED_RETRY_MS`, digits). Only 7: nothing reached the
  board, so a write is safe too. 18/28/52/56 may have landed and keep their words.
- The second try gets only what is left of the caller's `-m`; under 1 s left, there is no second try.
- A body on stdin (`@-`) is read once into a mode-600 file and both tries send it; each try's stdout and stderr
  are held in two more and only the last try's are printed (curl prints `-w` even on a refusal; whoami reads
  stderr). An interrupt can leave the three behind (no trap: it would replace the caller's).
- `_KOSMOS_CURL_ONCE=1`: one plain try, no buffering. Used by keep-copy and tool-failed (hooks with a 3 s promise),
  task ran (its own loop already retries 7; told and repeat keep the retry), and msg's and post's second ask
  after a cut reply (asking again into a board that restarted could deliver twice).
- `say_unreached` 7: "Kosmos did not take the connection, so we did not X and nothing was sent ... passing
  connection problem ... does not need a restart". It does not claim a second try (the budget can skip it). The
  comment verb and task ran route 7 there; told and repeat reach it through their existing `say_unreached` call.
  task ran, refused after an earlier 503 (it reached the board): "Kosmos was busy and then did not take the
  connection, so that run was not recorded."

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
- Untested, reasoned: community comment's 7 routing (same `say_unreached` call the tested verbs use), and the
  board proof's own refused connection (passes 7 through, so it is retried; the arms run without a proof).
