# smalldots-8058: small waits show the simple dots

Josh 11-05: an attachment loading in a chat showed the KOSMOS orb; small actions like it take the very simple
circular dots, as a file uploading does. Read as `SweepDots` (his "simple dots that go in a circle", 11-04,
#7954); on main the upload row drew the orb too, so both change and still match.

## Change

Small inline waits: `KosmosOrb` becomes `SweepDots`. VoiceOver hears the same as before: a label only where nothing
else says what is loading (a room's earlier posts); hidden where the words beside it, or the row's own label, do:
- `ChatFiles` attachment loading (fixed 16 pt, as the orb was, so a loading card is never taller than its neighbours)
- `FilesView`: a file opening in the Files list, so a file opened there matches one opened in a chat
- `ChatView`: Adding a file, Loading earlier messages
- `RoomView`: Adding a file, earlier posts loading (live and archive)
- `ComposerExtras`: dictation finishing, at a fixed size (the icon it stands in for does not grow with text)
- `ShellViews.DownloadLine`: Getting a file (drawn over the whole app, for any board file)

One behaviour change beyond the look: the dots grow with the person's text size, as the words beside them do,
where the 16 pt orb kept its size. Dictation's dots are the exception, fixed at the icon's size, so the composer row
never grows.

Inside a lazy scrolling thread (an attachment loading in a message, a room's earlier posts) the dots draw at 15 frames
a second, the orb's rate there (Loading earlier messages in a chat floats over the thread and keeps 30): a clock-drawn view at 30 in the thread kept it from following new messages (#7427).
With Reduce Motion the dots pulse together rather than hold still (SweepDots' own rule, #4591), where the orb held one
still frame; where the dots carry a label (a room's earlier posts, the Files row), VoiceOver also hears them as
updating then. The Files row's dots grow with text size from 20 pt, as its name and date do.

Where the line is: a wait beside the thing it is for (a file, a row, a line of text) takes the dots; a wait that is the
whole screen or a whole page keeps the orb. Changed beyond chats and rooms for that reason: the Files list row and the
Getting a file bar. Left as the orb, outside this card's ask: the Trying button on the not-answering page and
Settings' saving mark; the same rule would cover them if Josh wants.

Kept as the orb: whole-screen waits (Loading the conversation in an empty chat), and the waits outside chats and
rooms (sign-in, New agent, Settings, task and project pages), which this card does not ask about.

## Checks

- All iOS logic suites.
- Simulator shots of the changed rows, light and dark, before the PR.
- No merge while the 0.7.92 hold is on. Done only when seen on a real iPhone.
