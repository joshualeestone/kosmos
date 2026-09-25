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
