# #4845: a remote token is never issued under the key of an agent created on this computer

Card: joshualeestone/kosmos#4845 (claimed:angel, night shift; filed from #4792's residuals). Branch createdclash-4845
off main (independent of #4841).

## Measured first (what the card asked), and how it changed the fix
- The board keys an agent's identity by its safeKey on purpose: an agent created as "Casey" runs as "casey" for the
  session, the launchd job and the folder, and "Casey" is its display name (engine/status.js readIdentity, ~5971).
  Its reports (selfreport), heartbeat (liveness), profile and tokens are all filed by that key.
- So remote "Kip" and a Mac agent "kip" are not two spellings the board fails to tell apart: they are ONE identity
  by design. Re-keying every record by a "real name" (the card's first idea) fights that design.
- The real gap is how two agents come to share a key at all. POST /api/agent-token (loopback-only; how an operator
  adds a remote agent) refused a clash only with a RUNNING pane row. A stopped or never-run agent created here was
  not checked, so issuing for its key merged a second agent into it.

## What finished looks like
The token route refuses (409, nothing written) any name whose key belongs to an agent created on this computer,
running or not, whatever the spelling.

## The change
- engine/status.js: createdKeys(), the created agents' keys from the same source the board's created rows use
  (createdroster on a Mac; [] on Windows or when none is set).
- server.js POST /api/agent-token: after the running-pane check, refuse when createdKeys() holds the key.

## Decisions
1. Prevent the merge at issuance, rather than re-key records. Rejected: a paneless row carrying a separate real
   name (would need every key-keyed record migrated, against the board's identity model).
2. Refuse every spelling, including the created agent's own: a remote token under a local agent's key is two
   runtimes behind one identity either way. The running-pane check's same-spelling exemption is left as it was.
WEAKEST PREMISE: the created list reads launchd plists and answers [] when it cannot read them, so this check fails
OPEN then (the running-pane check still stands). Also not covered: a clash that already exists (issued before this),
and a Windows board (no created source there).

## Tests (server.remote-bind-1112.test.js)
- A created agent "kip4845": both "Kip4845" and "kip4845" are refused 409 with the reason, and nothing is written.
- Control: with no created agent under the key, a name is issued (200).
- Mutant: the check removed turns the test red. With server.test.js, createdroster and sendertoken tests: 414/414.
