# plusmenu-7596: the + menu restyled, with Camera (kosmos#7596)

Josh, 2026-10-29 21:27 CDT, with a screenshot of ChatGPT's iOS + menu: "We should fasten up our attachment buttons and
add these other options that ChatGPT does". 21:28: "Plugins and think harder don't really make sense". So the menu is
Camera, Photos, Files.

## Finished looks like
- Tapping + in a chat or a project room opens a larger panel (a popover kept as a popover on a phone, the system
  material behind it), each row a 44 pt round tile with its symbol and the choice's name: Camera, Photos, Files.
- Camera opens the phone's camera for one photo; the photo goes up as a picked photo does, JPEG, named
  "Photo <date> at <time>.jpg" (Board.photoName).
- Photos and Files open what they opened before (the photo picker, the file picker).
- At the ten-file limit every row is dimmed and disabled, as the old menu items were; the + keeps its label and hint.
- A phone with no camera shows Camera dimmed with its reason read out, not missing.
- One shared view (AttachMenu.swift) for the chat and the room, so the two cannot drift.
- A LogicTests source check holds the menu to exactly Camera, Photos and Files.

## Decided
- A popover panel, not a bottom sheet: it is what Josh pointed at (a panel over the keyboard) and keeps the chat in
  view. Rejected: a SwiftUI Menu, which cannot draw tiles. Weakest premise: before iOS 16.4 the popover becomes a short
  sheet (presentationDetents 220 pt); the app targets iOS 16, so that path exists but is rare.
- Camera dimmed rather than hidden on a phone without one, so the menu is the same everywhere and says why.
- "Photo Library" is now "Photos", the word in Josh's screenshot and Apple's own app name.

## Not in scope
- Video from the camera (photos only; the usage text already allows video for a later card).
- Plugins and Think harder (Josh, 21:28).
