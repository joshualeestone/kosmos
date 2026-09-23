# #3419 engine seam -- the needs_you question as a thread MESSAGE

Branch: `needsyou-question-3419` · Repo: joshualeestone/kosmos · Card: kosmos#3419
(the engine half of part b). Split by Splinter 2026-09-22 ~23:30: I own the ENGINE
(route the agent's question into the dialog as a message + retire the banner's data
path + strip delivery-status noise); Mona owns the banner-removal UI in
web/index.html. Part (a) -- the send-truncation -- already shipped: PR #3452, merged.

## The problem
The agent Talk page (`GET /api/agent/:name/thread`, server.js ~10585) surfaces an
agent's `needs_you` question only through the interruptive "waiting on an answer"
banner (`#d-qask`, web/index.html ~25283), driven by the payload's `asking` +
`question` fields. Josh wants that banner gone and the question shown as a normal
message in the dialog (card #3419; PigeonPete's #3417-categoryB pointer: "render
that same question as a thread message + drop the separate banner-prompt widget").

## This change (engine, step 1 -- additive)
`engine/chat.js` `withQuestionRow(messages, agentName, question)` -- pure,
exported, unit-tested. Given the messages the route already read and the question
it already derived (live `questionIn`, or the #2456 reported fallback), it returns
the messages with a synthetic question row appended:
`{ id: 'needs-you-question:<agent>', at: null, text, from: <agent>, delivery: null, kind: 'question', reported }`.
- STABLE `id` + null `at` (a standing question is a state, not a dated event): the
  fixed id keeps `dmRow`'s `midOf = id || at` repaint key from churning each poll,
  and null `at` makes the `DM_SPOKE_AT` "just spoke" loop skip the row (it guards
  `!m.at`) and `pjWhen(null)` render no timestamp. Stored messages carry no `id`,
  so no collision. The route passes `card.sessionName` (canonical, not the raw
  case-tolerant URL name) as `<agent>`.
- `from: <agent>` + `delivery: null` matches `keepAgentReply`'s agent-authored
  shape, so an UNMODIFIED `dmRow` renders it as a normal "theirs" bubble -- the
  `kind: 'question'` marker is OPTIONAL styling metadata, not required to render.
- Deduped against a trailing real row (the agent typed its own question → not
  doubled); a no-op when not asking.
- NOT persisted: derived live each poll from the same `question` the banner uses,
  so it appears while the question stands and clears with the state -- the
  state-keyed lifecycle the card asks for, not a stored history entry.
The route (`server.js` ~10794) wires it in additively: it still emits
`asking`/`question`/`questionBecause`, so this injection and Mona's banner removal
compose in either order without breaking each other.

## Sequencing (why this is additive-first, and the merge co-lands)
- Step 1 (this PR): inject the question as a message (additive/non-breaking), AND
  strip the now-redundant `needs_you` delivery note (see "Delivery-note strip"
  below). Both co-land with step 2.
- Step 2 (Mona, web/index.html): render the message + remove the `#d-qask` banner.
- Step 3 (me, follow-up): drop the then-unused banner-only payload fields
  (`asking`/`question`/`questionBecause`).

### Web-side render mechanics (kept here, not in the engine docstring)
Per repo convention #5, the engine (`withQuestionRow`) must not carry by-name
assertions about `web/index.html` internals, because Mona's step 2 reworks that
exact render path. Recorded here instead, true as of step 1 and expected to move
with step 2: an unmodified `dmRow` renders a `from`-truthy, `delivery: null` row
as a "theirs" bubble; the repaint key is `midOf = id || at`; the `DM_SPOKE_AT`
"just spoke" loop guards `!m.at`; `pjWhen(null)` renders no timestamp; the thread
renders rows in array order with no `at`-sort, so the appended dateless row lands
last. The engine relies only on the CONTRACT these imply (a stable per-agent `id`
and a null `at`), not on the function names.
⚠️ MERGE TIMING: merging step 1 ALONE would briefly show the question twice (banner
+ bubble) until Mona's step 2 lands. So this PR is built/reviewed/green to be READY,
and its merge co-lands with (or just before) Mona's UI half -- coordinated with
Mona, not merged in isolation.

## Delivery-note strip (Mona confirmed 2026-09-23; done in this PR)
Mona confirmed which `delivery.paneNote` lines are noise: strip the `needs_you`
"it was waiting on an answer when this was sent" note, KEEP "it was mid-task, so
it will not read this until it finishes". So this PR now strips the `needs_you`
case engine-side (`waitingNote` returns `null` for `status.STATE.NEEDS_YOU`), so
Mona's readers have nothing dangling. It is stripped because the question now
renders as its own dialog bubble, making that note a duplicate of the visible
question; the "mid-task" note stands (a WORKING agent shows no bubble, so it is
the only signal a person gets that the send landed and will be read later).

## Still deferred to Mona/Josh (flagged, not assumed)
- The overview "which agents are stuck" signal the banner doubled as (Josh
  default: remove; quiet-badge optional). Orthogonal to the question-as-message.

## Tests
`withQuestionRow` unit tests (append shape, reported flag, dedup, no-op/non-array).
chat.test.js green, server.test.js green (306/0 -- the additive injection breaks no
existing thread-payload assertion). Weakest premise: that rendering the question as
an ordinary bubble (plus Mona removing the banner) is the UX Josh wants over a
quiet badge -- a Mona/Josh confirm; the engine injection stands either way.
