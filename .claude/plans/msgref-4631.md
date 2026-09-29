# msgref-4631: agents talk about messages naturally; Copy message reference

Card: kosmos#4631 (Josh, 2026-09-29 14:42; Splinter's calls on the card).

> all the agents reference message IDs like "m530" but it doesnt really make sense for a white collar user.
> Maybe we have them say instead "Message 530", or even better yet they just make some natural language
> reference to it.. would be even cooler if i could like ctrl + click and get a message ID from any message
> to then reference it to an agent later on

## Done looks like

- An agent's instructions tell it to point at a message by who said it and what it was about, and to write
  "message 530" at most, never the bare id. Existing agents get it (new doctrine heading).
- Every input that takes a message id (post --in-reply-to, react, the room's reply) also takes "530",
  "#530", "message 530" and "message 530 in <room>", so a person can paste a copied reference.
- Any message on the page: right-click (ctrl-click on a Mac), ctrl-click on Windows, or a button in the hover
  bar copies a reference a person can paste to an agent, with a toast saying what was copied.

## Decisions

- **One normaliser, `messages.messageIdOf`,** applied at each input point, returning the input unchanged
  when it is not an id shape so every caller's own refusal still names what was wrong. Ids are one
  sequence for the whole Kosmos (one log), so the number alone finds the message and "in <room>" is a
  courtesy; each caller still checks the room.
- **The reference always names the room** ("message 530 in Kosmos Growth"). The card said "when it isn't the
  current one", but the page cannot know where it will be pasted, and the words are harmless when redundant.
- **A DM row has no number today** (the person's thread is keyed by time), so it copies "April's message to me
  at 2:31 PM on Sep 29" / "my message to April at ...": the natural-language form Josh preferred. The page
  still handles a DM row that carries an id ("message N in my conversation with April"), because dmRow already
  passes m.id to the bar; that path is pinned by R6b rather than left to go wrong silently.
- **Ctrl-click:** on a Mac the system turns ctrl-click into a right-click, so the page handles `contextmenu`
  and leaves the Mac ctrl-click alone (else two menus). On Windows ctrl-click on message text does nothing
  today (checked: no handler in the page uses it on a message), so the page opens the menu from it.
- **A menu, not an instant copy,** so the click says what it will do first.
- **Links, fields, pictures and selected text keep the browser's own menu** (its Copy is what a person
  wants there).
- **Hover bar:** the button goes FIRST, showing the number faintly, so the emoji stay together and Reply
  stays last (#4358). On a touchscreen it is the icon alone at --room-tap, and the open bar is shifted back
  inside the thread (rxnKeepInsideX), because the wider bar ran off a phone thread's edge.
- **The envelope agents read still carries the id** (it needs it for commands). Not reworded here.

## Accepted risk

- **A bare number now names a message.** "530" resolving is what the card asks for; the cost is that a stray number
  (a year, a count) reaches a real post. Bounded: every caller still checks the post is in the room it expects, so
  it can only land on a post in the same room. "#530" is NOT accepted, because "#4631" is how a card is written.

## Rejected

- Renaming ids to "message-530" or plain numbers: breaks every stored row, the CLI and the parity tests,
  for a problem that is about what agents SAY.
- Showing the number on every message always: the card says hover only.

## Weakest premise

That one instruction outweighs every delivered line carrying `mN`. If agents keep saying "m530", the next
step is the envelope's wording, which is the agents' own command syntax and so riskier to change.

## Checks

- engine/defaults.test.js: the section exists, and no prose line in the block uses a bare id (ids only
  inside backticks), with a control that the scan sees the block's own `[m3]`.
- engine/messages.test.js: messageIdOf's accepted and refused shapes.
- engine/reactions-2255.test.js: react takes "12" and "message 12 in <room>" (red without the change).
- docs/browser-checks/render-msgref-4631.js (new, gated): R1 to R8 plus controls, run as Windows and Mac.
- render-room-reply-3745, render-dm-reply-4256, render-room-msgbox-2806: the bar's order and button count.
