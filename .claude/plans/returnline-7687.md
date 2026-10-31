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
