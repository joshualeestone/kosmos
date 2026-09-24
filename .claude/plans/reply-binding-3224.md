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
  target project DIFFERS, REFUSE -- the misroute caught, not landed. The refusal does NOT name the
  answered project (the answering agent already holds it in the envelope it is replying to; naming it
  would leak a project name to a caller who may not be a member of that room -- the id-enumeration
  tell react() avoids). The guard runs AFTER the sender-validity check, for the same reason. If it
  matches, or `in_reply_to` is absent, behave exactly as today.
- If `in_reply_to` is given but does not resolve (a citation aged out of the record): treat as
  absent and proceed with the explicit project -- never block a legitimate reply over a stale id.
- BOTH CLIs gain `--in-reply-to <id>` (a leading flag, like `--no-reply`): the bash
  `install/kosmos` AND the parallel Windows/non-Claude runner `tools/windows/kosmos-cli.js`.
  Keeping the second in parity is load-bearing: the envelope now emits the flag, so a Windows-runner
  agent copying the command would otherwise read `--in-reply-to` as the project id and misroute.
- The room-arrival envelope's answer command becomes `kosmos post --in-reply-to <id> <projectId>`
  (flag BEFORE the project: both CLIs parse --in-reply-to as leading-only, so a flag after the
  project is swept into message text and the reply posts unbound -- a round-trip test guards this)
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

Residual id-enumeration tell (iter2, accepted; scope widened iter4): with the answered project's
NAME removed from the refusal, a caller can still observe that a mismatched-vs-matched/absent
`in_reply_to` behaves differently (a weak existence/location tell), but learns no project name.
The residual is wider than "membership of the answered project", and the guard-site code comment
states the full shape: the guard also runs BEFORE the caller's membership of the TARGET project is
checked (membership is enforced later, in messages.sendPost), so even a non-member of the target
room can distinguish "this id belongs to some other room" (the new "different room" refusal) from
"unknown / belongs to no room" (falls through, then a differently-worded membership refusal from
sendPost). No project name leaks either way. This is bounded by the loopback/single-user threat
model (the board-token gate blocks /api/post entirely when enforcement is on) and is a large
reduction from the pre-fix name disclosure. Fully closing it would require gating the guard on
membership of BOTH the answered and the target project; not done, because a legitimate reply
implies both memberships and the nameless residual is loopback-only.

## Tests
(Counts current as of the challenge-loop hardening; the original brief listed 4/5/5 before the
iter4/iter5 edge-case tests below were added.)
- server.post-inreplyto-3224.test.js (7): mismatch refused + both rooms named, match posts,
  no-in_reply_to unchanged, aged-out falls through; a non-string is a 400 request-shape refusal;
  an explicit `in_reply_to:null` is tolerated as absent (the one deliberate divergence from
  reply_expected); an unreadable record FAILS CLOSED (could_not, never a blind post or a 500).
  A CONTROL (poster is a member of BOTH rooms) proves the refusal is the guard, not membership.
- cli.post-inreplyto-3224.test.js (7): flag -> body, `=` form, omitted -> no field, combines with
  --no-reply (both orders), leading-only, and an empty citation in BOTH spellings (`--in-reply-to=`
  and `--in-reply-to ""`) refused rather than silently posted unbound.
- engine/messages.projectofpost-3224.test.js (6): resolves a post's project, null for
  unknown/message/empty, trims a padded id, and THROWS on an unreadable record (so the caller can
  fail closed rather than conflate "could not read" with "no such post").
- tools.windows-kosmos-cli-570.test.js: parity for the Windows/non-Claude runner across every flag
  shape (pair, `=`, both empty spellings, both orders, leading-only), so the two CLIs cannot drift.
- Updated shared assertions in engine/messages.test.js and server.test.js for the new answer
  command. Full suite green via tools/run-tests.sh.
