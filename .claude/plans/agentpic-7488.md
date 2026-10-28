# agentpic-7488: TestFlight build 14 (Mona Lisa's list on #7488, after build 13)

## Finished looks like

- **A new agent has a picture, the desktop's way.** Set up your agent has the desktop's Identity row: the mark drawn from the name as it is typed, or a photo the person chose with Change picture. Once the board can see the agent, the app sets its picture: the chosen photo, else (for a ready-made team's member) the catalogue's portrait, else the mark. The mark is the desktop's own scatter for the same name, so the phone and the Mac draw the same picture apart from the letter's font.
- **Editable team names look editable**: a pencil beside each name that can be changed.
- **Model shows once**: the heading says Model; the row shows only the choice.
- Shots include the team screen scrolled to the bottom (Project and Model), closing Mona's item 1.

## Decided

- The mark is ported number for number (the desktop's FNV and generator, including JavaScript's double arithmetic, which rounds above 2^53), tested against web/index.html's own dotGlyph run in node for five names. Only the letter's outline comes from the phone's system font (the desktop draws it with the browser's).
- A chosen photo is read already shrunk and upright from its file, cut to the centred square the desktop's crop editor opens on (the phone has no crop editor in this build), and redrawn as a JPEG on white, 512 px down to 128, until it fits the board's 60,000-byte limit (the desktop's fitPicture for a picture with no transparency). All of it off the main thread. One that cannot be read or fitted is refused with a sentence; the mark stays.
- A catalogue portrait that is a still PNG within the limits is kept as it came; anything else is redrawn the phone's way (a centred square, JPEG on white). The desktop keeps its shape and transparency, so a transparent portrait too large to keep shows on white on the phone.
- The picture is set by the app with the project tells (ContentView), when the board sees the agent, so leaving the sheet early loses neither. Two tries two seconds apart, as the desktop; a failed photo falls back to the mark.
- Weakest premise: a photo with transparency loses it (JPEG on white); the desktop keeps PNG or WebP for those.
- When a chosen photo cannot be set, the phone falls back to the mark silently (the desktop says "That picture did not load. The mark drawn from the name is still there." on its made screen; the phone may have closed the sheet by then).
- "Number for number" holds for the arithmetic; the trig functions are the platform's, so a last-bit difference could in principle move a dot. The five reference names match. The reference numbers are frozen from one node run of the desktop's dotGlyph: a later change to the desktop's constants (240 dots, R 118, the clearance) would not fail the test, though a change to its colours would.

## Not verified

- Not run on a device and not sent against a real board; shown through simulator shots.
- The drawing half (the letter's mask, its orientation and centring, the photo fitting) has no unit test: the scatter is tested against the desktop's code, and the letter was checked by eye in the shots ("Finch": an upright, centred F).
