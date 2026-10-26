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
- `tlsPinAlertShowing` (one Bool, every computer) holds a new alert back while one is on screen, judged by the window
  (a sheet really attached, or a runModal one up), so a dropped sheet cannot leave it set; held back is logged;
- both ways the alert is shown (sheet and runModal) clear the mark and restart the minute, for every computer
  (tlsPinDismissedAt), when it is dismissed;
- the could-not-check wording adds "If it keeps happening, check that both computers are on and connected to the
  internet." (either side being offline, or this computer's board not answering, gives this answer).
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
- What I first read (superseded by the line above): the tunnel's status file, written only on a state change, last
  written 07:49:40 "up"; board and tunnel both running since 00:49. That was the planned reconnect.
- On Josh's Mac the app's unified log holds one line per refusal, and which line tells the two causes apart (its own
  board did not answer, or answered required); not readable from this machine, and the fix does not depend on it.

## Decided
- One mark for all computers, not per computer: Josh's ask is one alert on screen, and two different computers
  failing at once is the same outage.

## Weakest premise
That the sheets were queued, not several windows each raising one. One window per app is the normal case; the fix
covers both, since the mark is app-wide.

## Checks
- native-app.tlspin-6589.test.js: a new test pins the early return, its place before the minute, the mark set before
  the alert, both dismiss paths, the window's say, the app-wide minute, and the wording; block comments are stripped
  before matching. Against main's main.swift it goes red (1 of 4).
- engine/remote.tlspin-6589.test.js: the required-answer log line (the tunnel's reason, once a minute per address, no
  computer name; a definite answer logs nothing); without the minute limit it goes red. Remote tests 448/449 (1 skipped).
- All native-app tests 151/151; swiftc -typecheck clean (no warnings in the changed lines).

## Review
- Round 1: 0 blockers, 1 warning, 3 nits.
  - [WARNING] a sheet dropped without its completion (#2807, macOS 26) would leave the showing mark set for good: the
    mark now holds an alert back only while the window really has a sheet attached (or a runModal one is up), and a
    held-back refusal is logged.
  - Nits taken: "check that both computers are on and connected to the internet" (several causes, not one); one minute
    after the last dismissal for every computer (tlsPinDismissedAt), so two failing computers do not take turns; the
    test strips block comments before matching.
- Round 2: 1 blocker, 0 warnings, 1 nit.
  - [BLOCKER] an unreachable computer's reason carries its address (kosmos-relay tlspin.rs fetch(): "could not reach the
    computer: {e}", and ureq 2.12.1's Transport Display prints the URL first), so the "no computer name" line would have
    named it in exactly this card's case. The address is now taken out, in any case, after the home folder; the fake
    tunnel prints the real shape (in capitals) and the test asserts neither the address nor its first label is left.
    Without the strip it goes red.
  - Nit taken: the held-back line goes to the unified log (logToSystem, fixed words), so a held-back refusal is
    recorded on the person's Mac; native-app.applog-5481.test.js counts 5 callers and names it.
- Round 3: 0 blockers, 2 warnings, 2 nits.
  - [WARNING] another computer's address could still reach board.log: a certificate made for another computer is
    named by rustls ("only valid for <name>"), and a redirect carries its host. Now every URL's host and every address
    under the account's domain is taken out (tlsPinScrub); a fixture has that shape behind a redirect.
  - [WARNING] background warming (every 60 s, up to 10 computers) would log once a minute per offline computer:
    only the app's own ask logs (tlsPin's `say`, passed by the /api/remote/tls-pin route); warming never does
    (tested). The reason is kept per address (tlsPinWhy), so it is said even when the app joined a run warming began.
  - Nits taken: both alerts end "If this keeps happening"; the line says "for a computer".
  - Pins moved with the code: server.test.js (the route passes say: true), remote.tlspin-6589.test.js (the forgetting
    check is in tlsPinAnswer).

## Cause (Splinter and Kitty, from the relay log)
The relay retired tmnt's tunnel on its hourly 3600 s schedule at 12:49:38Z, about 5 s after seven of Josh's requests
were placed on it; the next tunnel was up at 12:49:40Z. The certificate check for those requests could not run, and
the app's immediate re-ask landed inside the same two seconds.
- Change (Splinter's suggestion): when the check could not run, the app's one re-ask waits 3 s (a key mismatch still
  re-asks at once). A planned reconnect no longer reaches the person.
- Why SEVEN (confirmed by Splinter from the relay log, table on #7193): the board and tunnel started at 00:49, so the
  hourly retire lands near :49. Each retire 06:49 to 12:49Z (01:49 to 07:49 CDT) had a request placed in the same
  second: seven retires, seven refusals an hour apart, each past the once-a-minute rule, each sheet queued behind the
  one nobody had dismissed overnight. Caveat (Splinter): the relay does not name the requesting computer.
- Round 4: 0 blockers, 1 warning, 2 nits. The 3 s wait checked clean (the handler is called once on every path, the
  worst-case hold is about 43 s at the board's bound, parallel connections join one fresh run).
  - [WARNING] the per-address reason was never cleared, so an answer that never ran the tunnel (the sign-out guard)
    could log an old reason: the reason is now keyed by the answer object itself (a WeakMap), so only the run that
    made an answer can give its reason; the sign-out answer logs its own words.
  - Nit taken: the held-back line is written once per alert on screen (tlsPinHeldSaid, cleared on dismissal).
  - Nit decided against: matching only this alert's own sheet. A dropped sheet with another sheet up then holds back,
    which is the safe side; matching only our own would let this alert queue again behind another sheet, which is the
    bug. The line now says "an alert or another sheet is already on screen", so it is true either way.
- Round 5: 0 blockers, 0 warnings, 2 nits. CONVERGED. The WeakMap is right on every path traced (joining, finally, a
  fresh run behind a plain one; required is never cached). Nits taken: the window check clears the held-back note with
  the mark; the comment says the hold-back applies while this alert's mark is set.
