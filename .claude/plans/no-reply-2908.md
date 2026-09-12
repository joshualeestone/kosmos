# #2908: acknowledgement messages force an endless reply loop

## Problem (fresh-install QA, deterministic)
Every valid colleague @mention is delivered with a mandatory "to answer, run: kosmos post <p>"
clause, and the system carries no structured distinction between a request and an acknowledgement.
So when agent A acknowledges agent B by name, B is instructed to answer, and it repeats forever
(demonstrated live, room messages m35-m50). Adding "no reply needed" to the body does NOT stop it,
because reply intent is ignored (never inferred from prose).

Root cause: engine/messages.js builds the addressed "answer" clause whenever a recipient is
mentioned (or the sender is the operator); sendPost / the /api/post route / the kosmos post CLI
carry no reply-intent field; the room record stores no reply_expected.

## Fix (structured reply-intent, never inferred)
Add an OPTIONAL strict boolean `reply_expected`, threaded end to end:
- **CLI** (`install/kosmos` + `tools/windows/kosmos-cli.js`): `kosmos post --no-reply <project>
  <text>` (leading flag) sends `reply_expected:false`; omitted sends no field.
- **/api/post route** (server.js): validate `reply_expected` as a strict boolean up front (refuse a
  non-boolean with 400, never coerce); pass it as `replyExpected` to the shared
  `sendRoomPostAsAgent`, which passes it to `sendPost`. Omitted = undefined = current behavior.
- **engine/messages.js sendPost**: when `replyExpected === false`, an ADDRESSED arrival's answer
  clause becomes " · FYI, no reply requested" instead of the "run: kosmos post" command. The
  envelope and the words are unchanged (still foreground) - only the answer clause changes, which
  is what breaks the ack-of-an-ack loop. Persist `replyExpected: false` on the room record (omitted
  for the default/true case, so an ordinary post's record is byte-unchanged).

Ordinary mentions stay reply-required by default; background (unmentioned) arrivals are unaffected
(they already carry no answer clause). Reply-intent is set ONLY by the caller, never inferred from
message text.

## Tests (10, all mutation-verified non-vacuous)
- engine/messages.test.js (6): the clause swaps to the no-reply note for a mentioned recipient
  while keeping the envelope; omitted and explicit-true keep the answer clause; the intent is
  persisted (false) and absent otherwise; a background recipient is unaffected; no-reply is never
  inferred from prose ("no reply needed" in the body still gets the answer clause).
- cli.post-noreply-2908.test.js (3): --no-reply puts reply_expected:false on the body; without it
  no field is sent; the flag is leading-only (mid-args it is message text).
- server.test.js (1): /api/post refuses a non-boolean reply_expected with 400; a boolean/omitted
  passes validation.
- Mutation checks run by hand: disabling the clause swap reds the swap test; dropping the
  persistence spread reds the persistence test.

## Rejected alternatives
- Infer no-reply from prose ("no reply needed"): explicitly refused by the card - it is the exact
  workaround that does NOT work, and prose is ambiguous. The intent must be structured.
- Coerce a non-boolean reply_expected: a truthy "false" string would silently read as
  reply-required, the opposite of intent; refuse instead.
- Suppress the envelope entirely for no-reply: the card wants the foreground arrival KEPT (an
  addressed ack should still be seen), only the answer instruction removed.

## Weakest premise
That "mentioned recipient with reply-not-expected" is the only arrival whose clause should change.
The operator-post branch also honors replyExpected for symmetry, but the operator has its own route
(never /api/post) that does not set the field, so in practice only the agent path exercises it;
harmless and consistent.
