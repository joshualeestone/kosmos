# #3733: the setup assistant shows it is working on a reply

Josh 2026-09-25 08:23: "In the assistant pop-up let's show a working status, like our animated thing we show when
working when the agent is working ... It seems like my message just went off into space."

## Finished looks like
While the assistant works on a reply, the open chat shows the app's own working row: busyRow, the agent page's face,
.act dots and "Josh is working...". The folded bubble shows the same .act dots, and its label says it is working on
a reply. Both clear when it stops.
- A guide is working when the board says its card is working.
- The hosted assistant (#3660) is working while a question is out. Its "Thinking..." line is replaced by the same
  row, so both look alike.

## Decided
- Reuse busyRow and .act, not a new indicator, since Josh asked for "our animated thing". Rejected: the Sweep
  spinner, which is the app's save/loading glyph, not the agent-working one.
- A guide's working state comes from the board (its card), so a reply started by a message sent from anywhere shows.

## Weakest premise
That a guide working means working on the person's reply. The guide is the person's own setup assistant, so any
work is theirs to see.

## Verification
- render-assistant-bubble-3034 B20: guide working shows the chat row and the folded dots with their label.
  CONTROL: idle hides both.
- render-assistant-hosted-3660 H3: the working row while a question is out, and gone after.
- Screenshots: asb-working-open.png and asb-working-folded.png.

## #3738 (Josh 08:51), the same panel, built together

Josh, verbatim: lose the "JOSH'S AI" gold pill and vertically centre the name, which reads "Josh, Kosmos Guide";
kill "Hi, I built Kosmos..." and "An AI that knows Kosmos..."; one opening message, "Hi, I'm Josh's AI guide. Ask me
anything about setting up Kosmos."; placeholder "Ask about Kosmos…"; user bubbles the DM blue and agent bubbles the
DM cream, the same tokens.

### Finished looks like
The panel header is the picture and "Josh, Kosmos Guide", centred, with no pill and no footer line for a local guide.
The thread always opens with that one message. The box says "Ask about Kosmos…". The person's bubbles paint
--usermsg-tint and the guide's --agent-msg, in every look.

### Decided
- The opening message is drawn by the page, not sent by the guide, so it is there before any reply and costs nothing.
  Rejected: seeding it into the thread, which would put it in the guide's context and in the DM.
- The hosted note (online AI until you connect your own) and "This chat has ended." stay: they are facts the person
  needs, not the intro lines Josh cut. The local guide's note is empty and hidden.
- The .asp-tag and .asp-empty styles are removed with their markup.

### Weakest premise
That "kill" covers the hosted note too is read as no: it tells the person where their words go.

### Verification
render-assistant-bubble-3034 B3 (header, no pill, no footer, opening message first, placeholder, agent cream by
token) and B5 (person's bubble is the DM blue by token). Controls: with a pill, a changed opening line and both
bubbles on --k-sunk, all four arms fail. H2 checks the hosted opening message; B6 and H6 count the thread without it.
