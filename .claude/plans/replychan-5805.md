# replychan-5805: a room ask answered on the person's direct thread is answered (kosmos#5805 part 2)

## The defect
The room's reply reminder (#185: messages.unanswered, the room's "has not answered" line, and sweepUnanswered's one
nudge) counts an agent's answer to the person's @-mention only when the agent posts in that room. An agent that
answers the person on their direct thread (`kosmos reply`) is still shown as not answering, and is nudged.

## The change
engine/messages.js answeredDirectly(name, askAt): the agent's own row on the person's direct thread (not Kosmos's own
words in its name), within an hour after the ask, with no newer message from the person between the ask and it.
unanswered() (the room line and, through it, sweepUnanswered's nudge) and owedElsewhere() (the which-room question)
both use it. Parsed threads are cached by file mtime and size. suspectedMisrouteCount (the daily "suspected" figure)
does not read threads, on purpose, and says so.

## Decided (PigeonPete took this over at 34aedd9ef; the call changed, reasons below)
- **The agent declares it, as the report asked: `kosmos reply-channel "<where>"`** (empty, or "kosmos", clears it), on
  the Mac and Windows CLIs, POST /api/agent/reply-channel, stored as `replyChannel` on the agent's profile
  (engine/replychannel.js). With one declared, neither reminder speaks for that agent: the first-reply nudge
  (firstreply-nudge.js) and the room's #185 reminder, its "has not answered" line and the which-room question
  (messages.answeredOffRoom, shared by unanswered and owedElsewhere).
- **Why the call changed.** The collected 10-10 report, read at the source, says the agent's instructions told it to
  answer through a different channel, it answered there, and a reminder then said *nothing had reached the person*.
  That wording is the first-reply nudge, and the channel is one Kosmos cannot see. Automatic counting cannot see an
  answer that never touches a Kosmos thread, so on its own it does not fix the reported case.
- **Kept: Baron's automatic counting** (a `kosmos reply` to the person inside the hour, before they speak again,
  answers a room ask). A real false reminder of the same family; it needs no declaration.
- Only the person's direct thread counts automatically. A `kosmos msg` to a colleague is not an answer to the person.
- Bounded to an hour after the ask, and to before the person speaks again on that thread (review 1).
- An unreadable thread or profile counts as no answer and no declaration (today's behaviour).
- The route is in AGENT_TOKEN_ROUTES (every Windows agent holds a token and no board token). Its handler names the
  caller with processCaller and sets only that agent's own channel; a token-presenting caller is never the screen.
  The screen must name an agent on the roster, so a typed name never writes a stray profile.

## Rejected
- Automatic only (34aedd9ef's call): blind to the reported case.
- Reading the channel out of the agent's instructions: free text, guessed.
- Rewording the operator envelope's "to answer, run: kosmos reply" hint (the report calls it wrong for such an agent):
  engine/musefront.js recognises that envelope by its exact text, so a change breaks a parser silently. Follow-up.

## Weakest premise
A declared agent that does not answer on its channel is never reminded: the declaration removes the safety net and
nothing checks the claim. What would change it: a missed message from an agent that declared a channel; then show the
declared channel where the reminder would have been, rather than staying silent.

Also: a reply inside the hour may still be about an earlier direct message (Baron's premise, unchanged).

## Incidental fixes
- Windows help padded verbs to 13 columns, so `reply-channel` ran into its words; now the Mac's 14, widened for a
  longer verb.
- cli.help-lines-4785 and the CLI parity test read verbs with `[a-z]+`, which can never match a hyphenated verb;
  widened, with the two internal Mac arms (board-run, keep-copy) excluded by name and asserted present.

## Tests
- engine/messages.test.js: Baron's direct-thread test (controls included), and a declared-channel test (control: the
  same ask undeclared is owed, nudged and asked about; declared it is none of those; cleared, it is back).
- engine/firstreply-nudge.test.js: the real store, the sweep's own default reader, the card's own case nudged
  undeclared and not declared; an injected reader honoured, a throwing one no declaration.
- engine/replychannel.test.js: normalize, of (a hand-edited value the command would refuse is no declaration), set.
- server.reply-channel-5805.test.js: over HTTP, an agent sets only its own; refusals; the screen names a real agent.
- cli.reply-channel-5805.test.js: Mac against a stub board, Windows with fetch captured: set, --clear, bare, --help.
- Mutations (13, each restored and byte-compared): every one went red. Skip in the nudge; ignore the declaration in
  the room; old predicate in owedElsewhere; old predicate in unanswered; screen accepts any name; agent names
  another; of() unvalidated; "kosmos" not clearing; Mac --clear; Windows --clear; Mac help guard; token set; Windows
  help column.

## Review 1 (opus)
- FIXED (WARNING): unbounded window; see Decided.
- FIXED (WARNING): owedElsewhere's "owed" disagreed with unanswered; both use answeredDirectly now.
- FIXED (WARNING, by comment): suspectedMisrouteCount keeps the room-only test on purpose and says so.
- FIXED (WARNING): a thread was parsed on every render and every sweep per project; cached by mtime and size.
- FIXED (NIT): the nudge is asserted, with a control that it fires for an owed ask.
