# smalldots-8058: small waits show the simple dots

Josh 11-05: an attachment loading in a chat showed the KOSMOS orb; small actions like it take the very simple
circular dots, as a file uploading does. Read as `SweepDots` (his "simple dots that go in a circle", 11-04,
#7954); on main the upload row drew the orb too, so both change and still match.

## Change

Small inline waits in chats and rooms: `KosmosOrb` becomes `SweepDots`, keeping each site's VoiceOver label
(a label where it had one, hidden where the words beside it say what is loading):
- `ChatFiles` attachment loading
- `ChatView`: Adding a file, Loading earlier messages
- `RoomView`: Adding a file, earlier posts loading (live and archive)
- `ComposerExtras`: dictation finishing
- `ShellViews.DownloadLine`: Getting a file

Kept as the orb: whole-screen waits (Loading the conversation in an empty chat) and everything outside chats
and rooms.

## Checks

- All iOS logic suites.
- Simulator shots of the changed rows, light and dark, before the PR.
- No merge while the 0.7.92 hold is on. Done only when seen on a real iPhone.
