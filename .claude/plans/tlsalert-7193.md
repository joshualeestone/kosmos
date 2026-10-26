# tlsalert-7193: one certificate alert at a time, and why the check failed (kosmos#7193)

Owner: Mona Lisa. Routed by Splinter 2026-10-26 07:53, from Josh's report (Mac app 0.7.63, 07:4x to 07:51 CDT).

## Finished looks like
1. A failed open shows at most one alert. No second one is queued while one is on screen, and the next waits a minute
   after the person dismissed the last.
2. The alert says what to do if it keeps happening.
3. The card records why the check failed then, from what the machines recorded, and says plainly what is unknown.

## Why seven alerts (measured from the code, 0.7.63 = 3a5ed822d3)
- 0.7.63 already had the once-a-minute rule (tlsPinToldAt, in since fd9ab0b940).
- But the rule counted from when an alert was SHOWN, and `beginSheetModal` on a window that already has a sheet up
  queues the new sheet behind it. A page that kept retrying through a several-minute failure therefore added one sheet
  per minute behind the first, and each OK revealed the next.

## Change
native-app/main.swift `tlsPinRefused`:
- `tlsPinAlertShowing` (one Bool, every computer) returns early while a refusal alert is on screen;
- both ways the alert is shown (sheet and runModal) clear the mark and restart the minute when it is dismissed;
- the could-not-check wording adds "If it keeps happening, check that the other computer is on and connected to the
  internet." The other computer's statement is what could not be fetched.
The unified-log line still comes first, so every refusal is recorded even when no alert is shown (pinlog-6589).

- engine/remote.js (added after Kitty's relay reading): a "required" tls-pin answer says why in the board log,
  `remote: tls-pin answered required for another computer: <the tunnel's reason>`, once a minute per address at most, no
  computer name, the home folder as ~. On Josh's Mac nothing recorded the reason past "could not be checked"; next time
  it is in board.log on the Mac where it happens.

## Why the check failed then (what the machines recorded)
- The computer Josh opened, tmnt.kosmosplus.com, is this Mac (remote-status.json address).
- CORRECTED (Kitty, from the relay log): the 07:49:40 write was the tunnel's planned hourly retire and reconnect
  (12:49:38 retire, 12:49:40 authenticated): two seconds, not an outage. What failed for the six-plus minutes seven
  alerts need is not recorded on this Mac or at the relay; on Josh's Mac only the app's split (board did not answer vs
  answered required) is. Hence the board-log line above.
- Its tunnel's status file was last written at 07:49:40 CDT with state "up". The tunnel writes that file only on a
  state change (engine/remote.js, kosmos#6669 review 3), so the tunnel came back up at 07:49:40 after being down or
  reconnecting. Its board (pid 25889) and tunnel (pid 30187) had both run since 00:49, so this was a reconnect, not a
  restart.
- While the tunnel is down, Josh's board cannot fetch its signed statement, so its tls-pin answers "required".
- Not recorded on this Mac: why the tunnel dropped (board.log keeps no tunnel lines). On Josh's Mac, its unified log
  holds "tls-pin: refused a computer: its certificate could not be checked" for each refusal; not read (not this
  machine). The relay side is asked of its owner.

## Decided
- One mark for all computers, not per computer: Josh's ask is one alert on screen, and two different computers
  failing at once is the same outage.

## Weakest premise
That the sheets were queued, not several windows each raising one. One window per app is the normal case; the fix
covers both, since the mark is app-wide.

## Checks
- native-app.tlspin-6589.test.js: a new test pins the early return, its place before the minute, the mark set before
  the alert, both dismiss paths, and the wording. Against main's main.swift it goes red (1 of 4).
- All native-app tests 151/151; swiftc -typecheck clean (no warnings in the changed lines).

## Review
- Round 1: 0 blockers, 1 warning, 3 nits.
  - [WARNING] a sheet dropped without its completion (#2807, macOS 26) would leave the showing mark set for good: the
    mark now holds an alert back only while the window really has a sheet attached (or a runModal one is up), and a
    held-back refusal is logged.
  - Nits taken: "check that both computers are on and connected to the internet" (several causes, not one); one minute
    after the last dismissal for every computer (tlsPinDismissedAt), so two failing computers do not take turns; the
    test strips block comments before matching.
