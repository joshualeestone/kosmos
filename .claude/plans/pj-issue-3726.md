# #3726: the project Issue pill counts members that need the person

## What
- engine/projects.js: summary.needsYou applies the board's own rule, status.needsPerson (needs_you,
  needs_trust, a connection Kosmos gave up on), required lazily (status loads create lazily and could
  reach projects). A needs_you keeps #763's attribution (counts only for the project its question
  named). A trust wait or a given-up connection is the agent's own condition, about no project: it
  counts on every project the agent is a member of, where its member row is red too.
- The member projection carries `reconnect` (tied-gated like state; `in`-guarded because a raw
  snapshot() roster has no such field).
- server.js safeRoster attaches `reconnect` to connection_lost agents with the SAME expression the
  /api/status rows use (connlostHeal.reconnectPhase over CONNLOST_BOOK and connlostHealEnabled), so
  every project route sees what the board sees.
- The page needs no change: its Issue pill (pjPillOf) and projects-needing-you count both read
  summary.needsYou.

## Decisions
- Server, not page: the count is the server's, and the page reads it in two places; fixing it at the
  source keeps one derivation.
- needsYouElsewhere / needsYouUnattributed stay needs_you only: they describe which project a
  QUESTION is about, and a trust wait or given-up connection is about none.

## Weakest premise
- A trust-wait agent is built offline by /api/status and is never on the snapshot roster, so as a
  project member it is not `present` and cannot count today (its member row is not red either). The
  rule counts it the moment such a row reaches the roster; the unit test covers that with a card copy.

## Tests
- engine/projects.test.js: needsPerson counted (gave_up + trust), retrying not counted, the agent's
  condition lights every project it is on, an untied pane counts nothing. Red with the old count.
- server.connlost-reconnect-3410.test.js: /api/projects member carries the board's reconnect; waiting
  counts 0, gave_up counts 1, from the same CONNLOST_BOOK. Red without safeRoster's attach.
