# #8036: a permission prompt that passes by itself says so

Addresses #8036.

## What finished looks like
A permission wait whose push went out, and which ended before the person opened the chat, leaves one line in the chat saying nothing is needed, and its email does not go. Someone who opened it gets no line.

## Decided
- The trigger is the store from #8024: the push went out and was not opened. Rejected a line on every permission prompt that ends: most are answered in the terminal or on the page, and that is noise.
- Matched to that one push by id. A stuck-terminal or an earlier question's push on the same agent is left alone.
- Kosmos's own words, not the hook's, which can hold a command or a path (#7756 review 1). So the line does not say what asked. The card asked for "what asked": rejected for that reason.
- Says "has passed", not "timed out": the board cannot tell a time-out from an answer typed in the terminal, and either way nothing is needed.
- Also closes, for this kind of wait, the gap #8024 named for #2336: a question ending unopened would still email.

## Question 1, the live prompt: read, not run
`chat.permissionCard` reads a box with a reason above the question, and a dangerous-rm safety prompt is a fixture in chat.permcard-6727.test.js. This exact prompt's screen is unseen, and no simulator run was made: Claude Code's prompts do not appear on the sample board. The list's word and the card use separate readers, so a gap for another wording stays possible. Not closed by this.

## Weakest premise
That the hook's next automatic report is what ends the wait. If a prompt times out and nothing reports for a while, the line waits for it, and the list's word goes first since it reads the screen.

## Review 1 (blind, sonnet)
Fixed: a hook firing twice changed the wait's time while sending no second push, so the id never matched and the whole feature did nothing in the common case; pushes are now marked as a wait when they go out. An ack that could not go was dropped; it is now kept for the next open, with the line said once.
Known and accepted: someone who answers at the terminal without opening the chat gets the line beneath their answer. It is true, if unneeded. An agent that asks often gets up to one line per held push, at most 5 while unopened. Would change my mind: a person finding it noisy.
