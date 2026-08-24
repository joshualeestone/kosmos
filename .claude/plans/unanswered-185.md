# The answer reaches the room, or the silence says so (#185)

## What finished looks like (spec 2 of Mona Lisa's build-ready spec,
## Josh-Brain/Projects/kosmos-words-and-answers-spec-2026-08-23.md)

A room message the person @-addressed to an agent that has gone ten
minutes with no post from that agent in that room shows a small line in
the room: "<name> has not answered here yet." When it fires, one
follow-up line is typed into that agent's pane, at most once per
message, on the same channel the original arrived on: "the room has not
seen an answer; to answer, run: kosmos post <id>". A later post from
the agent clears the state. Nothing anywhere puts words in an agent's
mouth: auto-relay stays rejected, and every claim derives from the
store.

## The law this build lives under

Kosmos renders only words an agent actually sent through a command. The
pane is a viewport, never a transcript. Silence is measured, never
words.

## Changes

- engine/messages.js sendPost: the tokenizer's verdict rides the row
  (`mentioned: [...]` persisted at post time). One tokenizer, one run;
  the render never re-parses text.
- engine/messages.js unanswered(projectId, now): from the record alone,
  for each operator post with mentions, each mentioned agent whose
  delivery was typed and who has no later post in that project, once the
  named constant (UNANSWERED_AFTER_MS, ten minutes, the spec's starting
  value) has passed. Returns per-post names.
- engine/messages.js sweepUnanswered(roster): for each unanswered pair
  with no nudge row yet, deliver the one follow-up line through
  chat.deliver (the same guards as every delivery) and append a
  `nudge` row (post id, to, at, outcome). The row is the at-most-once;
  no retries. A new kind in the same append-only log, because two
  stores that can disagree are the defect this codebase hunts.
- server.js: the room payload carries `unanswered` (post id to names)
  computed from the engine; a boot interval (sixty seconds, alongside
  remote.ensure's boot site) runs the sweep. The GET stays a read.
- web room renderer: the small muted line under an unanswered post.
  Copy is Mona Lisa's to review at PR time, per the spec's ownership.

## Deliberately not built

- Auto-relay (the card's proposal 1): rejected in the spec; the board
  must never attribute words an agent did not send.
- The report-interface clear (spec step 3): the states here derive from
  the store, so Pete's interface can satisfy them later without rework;
  nothing parses, nothing is thrown away.

## Review bound (stated before the loop)

Up to two blind iterations. The properties that must hold: no code path
writes room content attributed to an agent without command provenance
(pin the existing sendPost pane-identity refusal); the nudge fires at
most once per message and only for addressed, delivered, still-silent
messages; the unanswered line derives from the store alone and clears
on the agent's post. A finding against these is fixed with a pin; a
measured finding in a fix layer continues the loop; anything else is
carded. Full rigor: this is the message machinery.

## Done when (the spec's, verbatim where falsifiable)

- A room @ask answered only in the agent's own window shows the line
  within the constant, and a later kosmos post from that agent clears
  it, both transitions from the store alone.
- The room store refuses an agent-authored row with no command
  provenance, pinned by test.
- The nudge line appears in the pane only after the unanswered state is
  true, at most once per message, never for messages the person did not
  address to that agent.
