# reply-binding-3224 -- bind a room reply to the message it answers (#3224)

## The bug (Josh-reported)
An agent on multiple projects sometimes posts a reply into the WRONG project's room. The engine
already routes by an explicit project id (no inference), shows the project name + id + command in
the room-arrival envelope, and guards membership -- so the wrong room is the agent supplying the
wrong explicit id among the several rooms it is in.

## Why the earlier "no clean engine fix" call is superseded
On 09-17 I rejected a server-side refuse-on-mismatch because the only oracle I had found for "where
the agent is acting" (stateProject, #2837) is CIRCULAR -- it is produced BY posts, so it cannot
catch the first misroute -- and a blanket refuse would break legitimate multi-project posting. Both
still hold for stateProject. Splinter re-routed this under Josh's 08-31 decide-yourself ruling, and
the reconsideration surfaced a NON-circular oracle I had not used: the project of the MESSAGE BEING
ANSWERED, a fact recorded when that message was posted, independent of the reply now being sent.

## The rule (built)
- `POST /api/post` (and the shared `sendRoomPostAsAgent`, so the outbox drain agrees) accepts an
  optional `in_reply_to` (a post id).
- When it resolves to a known post: the answered post's project is the binding. If the request's
  target project DIFFERS, REFUSE and name both rooms -- the misroute caught, not landed. If it
  matches, or `in_reply_to` is absent, behave exactly as today.
- If `in_reply_to` is given but does not resolve (a citation aged out of the record): treat as
  absent and proceed with the explicit project -- never block a legitimate reply over a stale id.
- CLI `kosmos post` gains `--in-reply-to <id>` (a leading flag, like `--no-reply`).
- The room-arrival envelope's answer command becomes `kosmos post <projectId> --in-reply-to <id>`
  (the id already appears in the envelope), so an addressed reply carries the binding by
  construction and a wrong project id is caught. The nudge line carries it too.
- `messages.projectOfPost(id)` is the oracle: the project of a post by id, or null (null for a
  direct message, an unknown/aged-out id, or an empty id).

## What I rejected / did NOT do
- A refuse against stateProject (circular, cannot catch the first misroute).
- Silently DERIVING/redirecting the room from `in_reply_to` (a silent redirect can surprise;
  refuse-and-tell is transparent, and it is what Splinter's "refuse when ambiguous" asks for).
- Blocking a proactive post (no `in_reply_to` -> unchanged behavior) or a reply over a stale
  citation (falls through).
- No web/ change: the envelope command is engine mechanism; the surrounding prose is Mona's lane
  (heads-up sent), kept unchanged.

## Reproduced-as-test
The intermittent LLM id-choice is not deterministic, but the VECTOR and the fix are: a reply whose
`in_reply_to` is in a different room than its target is refused (naming both), a matching one posts,
an absent one is unchanged, and an aged-out one falls through. The poster is a member of BOTH rooms
so the refusal is the guard, not a membership refusal (pinned by a CONTROL arm).

## Weakest premise
This catches a misroute only when `in_reply_to` is supplied, which the envelope now always emits for
addressed replies. A PROACTIVE wrong-project post (not a reply) is still not caught server-side --
that remains the harness-level forcing-fix residual documented in the closed #185 (auto-relay the
turn / fail a turn that answers without sending), out of Kosmos-fleet build scope. Josh can override
the refuse-vs-derive call.

## Tests
- server.post-inreplyto-3224.test.js (4): mismatch refused + both rooms named, match posts,
  no-in_reply_to unchanged, aged-out falls through; CONTROL proves membership is not the refusal.
- cli.post-inreplyto-3224.test.js (5): flag -> body, `=` form, omitted -> no field, combines with
  --no-reply, leading-only.
- engine/messages.projectofpost-3224.test.js (5): resolves a post's project, null for
  unknown/message/empty, trims a padded id.
- Updated shared assertions in engine/messages.test.js and server.test.js for the new answer
  command. Full targeted run green; server.test.js 304/304; messages suite green.
