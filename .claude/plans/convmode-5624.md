# convmode-5624: conversation mode, new agent messages read aloud as they arrive (kosmos#5624)

Josh, #admin 2026-10-08 17:22: "conversation mode ... as soon as an agent posts in a project or direct agent message
it plays audio. This low priority."

## Finished looks like
A toggle beside the mic in an agent's Direct Message box and in a project room's box. While it is on for that
conversation, each new message from an agent there is read aloud as it arrives, with an on-device voice; nothing
already on screen is read; the person's own messages are not read; a newer message stops the one being read; turning
it off stops it. The state is visible on the button and remembered per conversation on this computer.

## Built
- web/index.html: .convbtn CSS (shown where the page can speak, html.has-speak); #d-conv and #pj-conv beside the mics;
  the conversation-mode block after #4409's read-aloud (convFollow, convSpeak, convStop, convPaint, the pure
  convNewMids and convOpening); convFollow called after paintTalk's and paintRoom's unread-edge step.
- docs/browser-checks/render-convmode-5624.js (C1 to C9), registered in gated.txt, the README and SITE_COUNTS.

## Decided (the card's reversible calls)
- On-device voices only (the #4409 voice picker); provider voices later. Weakest premise: some computers have only
  network voices, and then nothing is read (the per-message button already says why when pressed).
- Interruption: the newest message wins; two at once read only the newest. The person speaking is not yet detected as
  an interruption (the mic and this are independent); turning the mode off stops it.
- Long messages: the opening up to 600 characters, cut at a sentence end, not a summary (no model call).
- Code blocks: announced as "Code block", not spelled (#4409's tidy).
- Remembered per conversation in localStorage (kosmos.convmode); a hidden window does not talk.
- Phone later (the card says so).

## Review log
