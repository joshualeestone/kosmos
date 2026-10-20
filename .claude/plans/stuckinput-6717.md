# stuckinput-6717: Kosmos clears text stuck unsent in an agent's input box itself

Card: #6717 (Josh, 2026-10-20: "i dont want you to manually clear all these, i want cards to fix them for everyone").
Calls posted on the card before building: issuecomment-6292327812.

## Finished means

1. An idle Claude Code agent whose box has held the same text for 10 minutes hears the next message without a person
   touching it: the board's own line is pressed; anything else is saved as a draft and the box cleared.
2. A saved draft is never sent by anything, and the person sees it in the agent's conversation with Dismiss.
3. Ghost (dim) text is never treated as text. A test covers both kinds, ghost text, and a mutant that leaves the
   agent deaf.

## What was already there (main 261f9c7105)

- #6249 detection: `status.unsentInputOf` sets `card.unsentInput.since` after the same text sits 3 minutes (Claude Code
  cards only); dim runs dropped by `status.composerText`.
- #6436: a line the board typed and saw left unsent is remembered (`unsent-lines.json`) and pressed again at 30 s, 2 min,
  5 min, then every 10 min for a day. Retries are not rescheduled after a board restart.

## Decisions

1. Ours = the #6436 memory says the board typed this line into this pane and the box shows only that line
   (`rememberedShows(text, kept, true)`). Everything else is not ours and is drafted, never submitted (the card's
   fallback for the weakest premise). Rejected: judging by the text's shape, which a person can type.
2. 10 minutes (`chat.STUCK_INPUT_MS`) from `unsentInput.since`, card idle, Claude Code only, on its own one-minute
   sweep (`engine/stuckinput.js`), gated by live execution like every sweep.
3. Drafts live in their own file per agent (`engine/unsentdrafts.js`), drawn into the conversation route as a derived
   `kind: 'kosmos', draft: true` row (`chat.withDraftRows`), like #3723's account line. Not a stored thread row: every
   thread reader takes a row with a string `from` as the agent's and a null one as the person's, so a stored Kosmos row
   would mark the conversation unread or make the agent owe a reply.
4. Save before clear: the box is cleared only after the draft file is written. The clearing stops as soon as the box
   shows anything that is not left of the saved text (someone typing meanwhile), and the box counts as empty only when
   two reads a look apart agree. The same text is never kept twice, and a full record refuses rather than drops.
   Operator brake: AGENT_WORKFORCE_STUCK_INPUT_OFF=1.
5. Clearing keys: rounds of C-e, C-u, C-k, a read after each, bounded. Measured on Claude Code 2.1.303 (private tmux
   socket): empties one line, a wrapped line, multi-line text, a mid-line cursor; nothing on an empty box. Rejected
   C-c (arms "press Ctrl-C again to exit") and Escape twice (rewind menu on an empty box).
6. A box holding a folded paste ("[Pasted text #N]", "[Image #N]") is left in place and logged once: its words are not
   on screen, so they cannot be saved, and clearing them would lose them. Measured: a 2,000-character paste, and fast
   send-keys typing, both fold.
6b. A box drawing 7 rows or more is left in place too: measured on 2.1.304, a line pasted the way Kosmos pastes scrolls
   inside the box, which then shows its last 7 rows at every pane height tried (15, 24, 40, 60) with nothing marking the
   start as hidden, so only a fragment could be saved. Six rows (about 450 characters at 80 columns) or fewer is read whole.
6c. An agent whose terminal window someone has open (tmux `session_attached` > 0) is left alone: the text is in front of
   them, and clearing it there would make words vanish under their hands.
7. The page offers "Put in the message box" (fills the page's own box after anything typed, sends nothing) and Dismiss
   (POST /api/agent/:name/unsent-draft/dismiss, an agent token refused).
8. Holds for the draft path: roster read now, menu/account/quota holds, addressable, QMENU_BUSY, idle on the fresh card,
   pane unchanged, box unchanged since the decision, verifyAtSend. Not quiet hours, the usage cap or a paused swarm:
   those stop new work being typed, and clearing a box types no work.

## Residuals (named, not fixed here)

- Before every round of keys the box is read again and must show exactly what the last read showed, and after it what
  is left must be that text with a run taken out (`stuckShrunk`). What remains open is the moment between that read
  and tmux delivering the keys (one send-keys call): a key typed in it is cleared with the row.
- Someone typing while the box is cleared stops the clearing; the rest of the old text plus their new words is a new
  text, so ten minutes later it is saved again, repeating part of the first draft.
- A box the keys do not empty (Claude Code's vim mode, or keys rebound by a later version) is saved once and then not
  touched again while the same text sits there; it stays stuck, logged once.
- At MAX_KEPT (20) undismissed drafts for one agent, no draft is dropped: the box is left and logged.
- In the setup guide's thread, a draft is served masked like every row there (#3769), so "Put in the message box" offers
  the masked words; the file on disk (mode 600) holds them as typed, as the person's own stored messages do.
- Drafts are kept by session name. An agent renamed or moved keeps its drafts behind, and a new agent later given the
  same name would be shown them.
- A folded paste, a box of 7 rows or more, and an agent with its terminal window open stay stuck (decisions 6, 6b, 6c),
  each logged once. The tile sentence (#6249) still says it, until #6716 changes tiles.
- Text with line breaks is saved with its rows joined by spaces (the box reader squashes whitespace); the words survive,
  the breaks do not. A word longer than a row gets a space where it wrapped.
- A line Kosmos typed whose memory is gone (older than a day, or never remembered) is drafted, not sent. Safe direction.
- The tile sentence "Open it to send it with Enter" is unchanged (#6716 owns tile sentences).
- A draft older than the conversation's latest 200 rows is drawn at the top of those 200; with earlier messages opened
  it sits after older rows it predates. Cosmetic.
- The board's own line with the person's words added is drafted whole, envelope included (what the box held), and the
  line is then forgotten. Its message row keeps saying Kosmos will press Enter on it; nothing updates that row.
- A new text of at least 20 characters that is the start and end of a draft kept within the hour, with its middle
  different, is taken for a leftover of that draft and cleared; its characters are all in that draft.
- Codex, Gemini, Grok, Antigravity, Muse: no detection exists for them, so no recovery either.
