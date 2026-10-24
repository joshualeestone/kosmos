# chatask-7016: the native chat answers questions and permission prompts (slice 3b, part 1 of 3)

Card: kosmos#7016, slice 3b of the native iPhone plan (#6838). Design: Mona Lisa's slice 3b spec
(`~/work/workers/monalisa/ios-design-2026-10-19/slice3b/SPEC.md`, on the card), sections 1 and 2. Files (section 3)
and earlier messages (section 4) are parts 2 and 3, each its own PR on this card.
Route contracts: `~/.cache/claude-handoffs/7016-board-routes.md` (from server.js and web/index.html on main).

## Finished looks like
An agent's question in the native chat shows its options as buttons inside its bubble, and a permission prompt shows
as the board's short card (Allow and Deny at equal weight, Show details with the reason, the raw request and the other
choices). Pressing one answers it through the board's own route with the board's own rules: a lasting choice needs a
second press; while a press is in the air every button is off and a typed send waits; "Sent." (or "Allowed." /
"Denied.") after a sure press; the board's not-sure sentence when it may have gone; a refusal says the Mac's own words.
Logic is in BoardLogic.swift under ios/LogicTests; shots of spec states 1 to 4, light and dark, for Mona Lisa.

## Change
- ios/Kosmos/BoardLogic.swift:
  - `ChoiceOption`, `Choices`, parsed from the thread GET (dmChoicesFrom's rule: options, `asking`, `asked`, presence
    not off);
  - `Permission` on a question row;
  - `permissionAsk` (DM_PERM_DOES words);
  - `cardButtons` (Allow then Deny, or no card);
  - `pressRequest`, `pressResult` (dmChoicePress's reading of an answer);
  - `armStep` (the #6172 arm and confirm, with the board's 15 s window and 600 ms same-gesture floor);
  - `sentence` (pjSentence).
- ios/Kosmos/BoardClient.swift: `press`, one in the air per agent, and a typed send refused while it is ("Still sending
  your choice. Try again in a moment."); the answered lock (6 s, the board's), so a quick second press cannot answer
  twice; dropped with the chats.
- ios/Kosmos/ChatView.swift: the options inside the agent's bubble, the permission card, and the notes under them.
- ios/LogicTests/main.swift: sections for parsing, the card, a press's answer, and arm and confirm; the client
  against the fake Mac.

## Decided
- The phone follows the board's code, not a reading of it: every rule above is a port of web/index.html (named in
  comments) so the two say and do the same.

- No thread read, no buttons: a failed read drops them (the board's rule). Every permission prompt asks the same
  question line, so a card kept across failed reads could approve the next command. The server-side gap that remains
  (a press names its question line, not its command) is #7020.
- Refusals and the not-sure line go on the conversation's own line above the composer, which stays when the next read
  draws another question or none (the board's d-say-msg), and goes once its question does.
- A retry, a Send again and a typed send all wait while a press is in the air, with the board's "Still sending your
  choice" line; a retry still reading counts as a send in the air.
- Parsing is as strict as the board's: options are whole numbers, flags are only true, a permission only on a question
  row. A permission prompt the phone cannot read into Allow and Deny keeps its way-through row.

## Weakest premise
That the GET's `asked` stays the question identity the server compares against. It is the same field the board page
sends back, so a change on the Mac breaks both together.

## Validation
- ios/LogicTests pass, with mutants for the arm window, the answered lock and the not-sure reading.
- Debug simulator build with -warn-long-expression-type-checking=100; Release has no sample code.
