# agentpic-7488: TestFlight build 14 (Mona Lisa's list on #7488, after build 13)

## Finished looks like

- **A new agent has a picture, the desktop's way.** Set up your agent has the desktop's Identity row: the mark drawn from the name as it is typed, or a photo the person chose with Change picture. Once the board can see the agent, the app sets its picture: the chosen photo, else (for a ready-made team's member) the catalogue's portrait, else the mark. The mark is the desktop's own scatter for the same name, so the phone and the Mac draw the same picture apart from the letter's font.
- **Editable team names look editable**: a pencil beside each name that can be changed.
- **Model shows once**: the heading says Model; the row shows only the choice.
- Shots include the team screen scrolled to the bottom (Project and Model), closing Mona's item 1.

## Decided

- The mark is ported number for number (the desktop's FNV and generator, including JavaScript's double arithmetic, which rounds above 2^53), tested against web/index.html's own dotGlyph run in node for five names. Only the letter's outline comes from the phone's system font (the desktop draws it with the browser's).
- A chosen photo is redrawn as a JPEG on white, largest side 512 down to 128, until it fits the board's 60,000-byte limit (the desktop's fitPicture for a picture with no transparency). One that will not fit is refused with a sentence; the mark stays.
- The picture is set by the app with the project tells (ContentView), when the board sees the agent, so leaving the sheet early loses neither. Two tries two seconds apart, as the desktop; a failed photo falls back to the mark.
- Weakest premise: a photo with transparency loses it (JPEG on white); the desktop keeps PNG or WebP for those.

## Not verified

- Not run on a device and not sent against a real board; shown through simulator shots.
