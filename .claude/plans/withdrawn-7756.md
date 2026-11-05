# #7756 part 2: a question taken back stays on record

Addresses #7756.

## What finished looks like
An agent that runs `kosmos report clear "why"` over a question leaves a line in its chat with the person, saying what it no longer asks and why. It lasts as the chat does.

## Decided (Splinter asked for the call; Josh can override)
- Where: the agent's direct chat with the person. That is where they read an agent, and a chat row lasts. Rejected a new history page or a report log: another place nobody opens.
- Trigger: only `report clear` with words, over a standing needs_you. A plain working report does not count: it may simply mean they were answered. Rejected recording every clear: a bare clear has nothing to say.
- Marked as Kosmos's own words, so it reads as nothing owed. No phone buzz: a question going away should not interrupt anyone.
- Part 1, superseded messages: not built. Messages are typed into a session at once, so there is no queue to mark. Needs its own card if it comes back.

## Weakest premise
An agent will write a reason. A bare clear still leaves no trace, and an agent whose question was answered may write one too, giving a harmless "no longer asking" line.
Would change my mind: a person finding the line noisy, or a bare clear hiding a question they wanted.

## Review 1 (blind, sonnet)
Fixed: a hook's permission wait was copied into the chat, command and all; it now writes no line. A clear that does not say working writes no line.
