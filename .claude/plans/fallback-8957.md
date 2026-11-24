# fallback-8957: every iPhone fallback that opens the computer's board says so (kosmos#8957, #8952 part 2)

## Done when
Each fallback tap listed on #8957 (and #8954's two) says, before it is tapped, that it opens on your computer's board,
in one wording with one icon. "Back to Kosmos" no longer appears on the phone's own tabs when the computer or Kosmos+
is not answering (Try again is already there). Checked in the simulator (KosmosUITests) with a screenshot per screen;
the words and the rule for when the note shows are covered in ios/LogicTests.

## Decided (card comment 7121836312)
- Build the card's Ask, not its first "Done when" line (which said none opens the board): replacing these with native
  screens is #6838 and the part-2 cards.
- One wording: "on your computer's board". One icon: SF Symbol arrow.up.forward.square, replacing the chevron.
  - Link pills read "Open this chat on your computer's board" + icon (ChatView refusal / not-answering, file, draft).
  - Action buttons keep their word (Sign in, Make an agent, Answer, a member's name) and get the note
    "Opens on your computer's board" + icon beside or under them, only when that tap really goes to the board
    (Answer / member / needs-you only when the agents list lacks the agent).
  - The "+" icons with no computer letting the phone in yet: a confirmation, "Add an agent on your computer's board?"
    Open / Cancel (an icon cannot carry the words; the person keeps an out).
- Back to Kosmos: LoadFailureView's onBack becomes optional; the native tabs (AgentsView .unreachable,
  .kosmosPlusDown) pass none. The web page's own failure keeps it (it means the board's Today there).

- Notification fallbacks N2/N4 have no control to label (the tap on the notice is the whole act): left as they are
  here; a native place for them belongs to the part-2 cards (card comment 7123676687).
- Review 1: a sign-in fallback names where it goes. Signed out (the Agents tab's two Sign in buttons, the sign-in
  screen's company link and Continue) it is "Opens the Kosmos+ sign-in page"; the fresh sign-in sheet (already signed
  in) says the board; New Agent and New Project's sheets open nothing, so no note (SignInView useWebNote, from the
  caller). The + alert says why: "Your computer has not let this iPhone in yet, so it is made there."
- The "only when the agents list lacks the agent" rule is Board.opensBoardFor (tested); the room and project info apply
  the same rule to their own lists.

## Weakest premise
That announcing the board is enough. If Josh wants none of these to open the board at all, each needs a native
screen (part-2 cards).
