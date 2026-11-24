# fallback-8957: every iPhone fallback that opens the computer's board says so (kosmos#8957, #8952 part 2)

## Done when
Each fallback tap listed on #8957 (and #8954's two) says, before it is tapped, that it opens on your computer's board,
in one wording with one icon. "Back to Kosmos" no longer appears on the phone's own tabs when the computer or Kosmos+
is not answering (Try again is already there). Checked in the simulator (KosmosUITests, review 3: four screens, the not-answering tab, signed out, refused and +, each with a
screenshot; the other sites are checked by build, reading and LogicTests' Board.opensBoardFor);
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
  caller). Review 3: the refused Sign in keeps its web session (403), so it says the board, not a sign-in page. The + alert gives no reason (any one sentence was untrue in some phase); the question and Cancel stay.
- The "only when the agents list lacks the agent" rule is Board.opensBoardFor (tested); the room and project info apply
  the same rule to their own lists.

## Scope, stated (review 2)
The card's rows are the fallbacks. The always-web hand-offs (inventory rows 8, 16, 17, 20, 22: an agent's AI Settings,
a project's members and archiving, a task's board page, the computer's Settings) and web-page files (5, 10, 14, 19)
keep their current words and icons here; their part-2 cards (#8953, #8955, #8956, #8958, #8959) replace them with
native screens. Exception: project info's "Open on your computer's board" row takes the board icon, since a member row
on the same screen now carries it.

## Weakest premise
That announcing the board is enough. If Josh wants none of these to open the board at all, each needs a native
screen (part-2 cards).
