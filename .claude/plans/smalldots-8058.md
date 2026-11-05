# smalldots-8058: small waits show the simple dots

Josh 11-05: an attachment loading in a chat showed the KOSMOS orb; small actions like it take the very simple
circular dots, as a file uploading does. Read as `SweepDots` (his "simple dots that go in a circle", 11-04,
#7954); on main the upload row drew the orb too, so both change and still match.

## Change

Small inline waits: `KosmosOrb` becomes `SweepDots`. VoiceOver hears the same as before: a label only where nothing
else says what is loading (a room's earlier posts); hidden where the words beside it, or the row's own label, do:
- `ChatFiles` attachment loading
- `ChatView`: Adding a file, Loading earlier messages
- `RoomView`: Adding a file, earlier posts loading (live and archive)
- `ComposerExtras`: dictation finishing, at a fixed size (the icon it stands in for does not grow with text)
- `ShellViews.DownloadLine`: Getting a file (drawn over the whole app, for any board file)

One behaviour change beyond the look: the dots grow with the person's text size, as the words beside them do,
where the 16 pt orb kept its size. Dictation's dots are the exception, fixed at the icon's size, so the composer row
never grows.

Kept as the orb: whole-screen waits (Loading the conversation in an empty chat), and the waits outside chats and
rooms (sign-in, New agent, Settings, task and project pages), which this card does not ask about.

## Checks

- All iOS logic suites.
- Simulator shots of the changed rows, light and dark, before the PR.
- No merge while the 0.7.92 hold is on. Done only when seen on a real iPhone.
