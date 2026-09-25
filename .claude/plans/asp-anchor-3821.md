# #3821: the open guide chat sits where the bubble was (Josh 2026-09-25 16:25, Windows)

Josh, verbatim: "also can we make it that when you pop up the chat thing it is down i the bottom right where the
assistnt avatar was". At 1520x858 the open chat sat just under the header.

## Cause
asbLift lifted the open panel above any control reaching into the bottom 160px of the window (the "band" rule). On his
Settings page, "+ Add a provider" reaches into that band beside the bubble, so the chat was lifted about 160px.

## Finished looks like
The open chat's bottom-right is the bubble's (same bottom and right, lifted or not), it grows upward, and its height is
capped below the header (the thread scrolls inside), at every window size. On an agent's page the bubble still lifts
over Send (B15), and the chat follows the bubble there.

## Decided
- The open chat no longer lifts over page controls. An open chat covering the page is what an open chat does, and
  Josh asked for it to stay down. Rejected: keeping the band rule for some controls. That is what put it under the header.
- On a window too short for the bubble's own lift, the chat's bottom comes down so at least 160px of chat fits below
  the header (B17).

## Weakest premise
Covering a control in the bottom band while the chat is open is now accepted. B17's tall control in the very corner
is still clear, because the bubble lifts over it. A wide control just left of the corner is covered while the chat is
open, and folding the chat uncovers it.

## Verification
render-assistant-bubble-3034 B31: at 1520x858, 1280x720 and 1280x1200 on Settings, with a wide control in the band
(his "Add a provider"), the chat's bottom-right is the bubble's and its top is below the header. CONTROL: the bubble
keeps one corner, 16px from the bottom. Negative: with the old lift, the chat sits 174px up and B31 fails. B15 and B17
still pass. 77 pass.
