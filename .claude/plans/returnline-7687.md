# returnline-7687: return makes a new line on the iPhone, and a send button appears once there is something to send

Card: kosmos#7687 (Josh 10-31 11:57, Discord's composer). Reverses #7346's no-arrow on purpose; the floating box stays.

## Finished looks like
- Chat and project room: the keyboard's key reads return and puts in a new line; it never sends (ComposerExtras.typedReturn
  and its use are gone, so a typed or pasted new line stays in the message).
- Empty box: plus, placeholder, emoji, mic. Once there are words (not only spaces or new lines) or files, the mic gives way
  to ComposerSendButton (paper plane on a filled rounded square, 44 pt tap, label "Send" / "Post"), which runs the same
  send-or-say-why as before. While dictating or while its last words land, the mic stays (it is the stop button).
- VoiceOver keeps Send/Post as an action on the box.
- LogicTests: ComposerExtras.showsSend on each side; typedReturn's checks removed with it.

## Decided
- Send replaces the mic while there is something to send (card's call). Dictation running keeps the mic (else the person
  could not stop it).
- Room: with the @name list open, return used to pick its first name; now it is a new line and names are picked by tap.
- Weakest premise: Palette.link as the button's fill reads well in both themes; to be checked in the design shots.

## To do
- Simulator shots light/dark (empty box, typed text, dictating), a UI check that return adds a line and the button sends,
  review loop (bound 4), validation, PR. Kitty is on RoomView.swift for #7679 (different region).

## Review round 1 (10-31): no BLOCKER, 3 warnings, all fixed
- W1: a room reply's @name alone counted as words, so Post replaced the microphone. Now Board.isOnlyMention counts it as
  none (the mic stays until the person writes something).
- W2: white on Palette.link in dark mode was about 2:1 (needs 3:1 for a control). Dark glyph there (about 11:1); light
  mode unchanged (about 6.5:1).
- W3: the button appears where the microphone was, so a quick second tap on Stop could send unread dictated words. A tap
  in the button's first 0.4 s is not taken.
- NITs taken: Cmd-Return sends from a hardware keyboard; one dictation flag (busy already covers finishing); tests for
  dictating alone, and source checks of both composers' wiring (composer 57/57, room 743/743, main 1766/1766).
- NITs left, by design: Return no longer picks the first @name from the open list (a tap does); the in-app mic cannot add
  to typed words (once there are words the mic is the send button; the keyboard's own dictation key still works).
- Weakest premise: 0.4 s is a guess at a second tap's spacing; a slower double tap could still land after it.
