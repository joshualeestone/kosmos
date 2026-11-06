# reopen-8118: the Mac app reopens on the computer you were looking at (kosmos#8118)

## Problem (Josh, 11-06 12:21)
Looking at the mini's agents from the laptop's Kosmos app, then quitting or restarting, lands back on the laptop's
own agents, so he switches again every time.

## How it works today (read 11-06)
- The Mac window always starts on its own board (`loadBoard`, native-app/main.swift).
- A switch is page-side: the switcher click (`computersOpenClick`, web/index.html) asks this board for a two-minute,
  single-use ticket (POST /api/remote/open-ticket, #6406, only from this computer's own screen) and navigates the
  window to `https://<name>.kosmosplus.com/#kpt=<ticket>`. The app only sees the URL (`showsAnotherComputer`).
- View > Back to This Computer (#6411) is the way home.

## Plan
1. Remember (app): the kept value means "the computer the window was on at quit" (`quitKeeps`, rounds 3 to 5). Store
   ONLY a host (`<name>.kosmosplus.com`) in the app's defaults: never a ticket, token or full URL. Kept as soon as
   another computer's page loads (so a crash still leaves it). Written at quit: that computer if the window is on
   one; unchanged if no page is on screen or a reopen is still outstanding; otherwise nothing. Forgotten at once by
   Back to This Computer, by connect mode, by a reopen answer that can never succeed or that the person ended
   (gone, home, bad, touched, signed-out), and after REOPEN_MISS_LIMIT (3) launches in a row whose reopen missed.
2. Reopen (app + page): launch loads the local board exactly as today. After that first load finishes, the app asks
   the page to reopen the remembered host (`computersReopen(host)`), so the local board is never held up by a slow
   remote.
3. The page checks the host against /api/remote/computers (the switcher's own list), then:
   - on the account and switchable: the same ticket path and switching screen as a click;
   - signed out of Kosmos+, offline, or unable to take the instant switch: stay home, with one line in the switcher's
     wording (#6585), naming the computer;
   - no longer on the account (or a host under another domain): stay home, say so, and tell the app to forget it.
   - the list does not answer in 30 s (OA_COMPUTERS_LIMIT_MS), or the person clicks, types, scrolls or touches
     meanwhile: stay home (a late switch would take unsent text with it). A toast says at once where it is going
     and how to stay.
   The page's answer reaches the app through `reopenAnswerKeeps` (as of round 6): gone, home, bad, touched and
   signed-out forget at once; offline, updating and not-instant are counted misses (3 in a row forget); slow,
   unknown and error leave it outstanding uncounted; opening leaves it outstanding until the page lands; a page with
   no reopen (a sign-in page) asks again at the next board load, within 120 s of the first ask.
   What the next launch reopens is decided at QUIT (`quitKeeps`, round 3 and 4).
4. Windows and iPhone: say on the card what each does today; Mac first.

## Decided
- Persist always (the card's weakest premise: someone who quits to get home has one extra click).
- The page, not the app, decides reachability: one rule shared with the switcher, no second copy in Swift.

## Weakest premise
That the launch's first finished load is always the local board. A redirect or the sign-in page first would need
the reopen to wait for the board page proper (handled since review 1: a page with no reopen asks again at the next
board load).

## Review round 1 (opus; no BLOCKER)
- WARNING: the host outlived a session spent at home --> FIXED (the kept value is the window's last computer; see 1).
- WARNING: a slow list could pull the window away after the person started working --> FIXED (6 s limit, stops on
  pointerdown or keydown).
- CONVENTION: plan and code disagreed on forgetting --> FIXED (this file).
- NITs fixed: signed-out wording also covers remote access off, with no "switch from the menu"; "is not on your
  account"; a host under another domain is gone; connect forgets; a sign-in page does not spend the launch's reopen;
  a test runs the shared switch with no link.
- NIT kept: a host kept in run mode survives a reset to an unchosen mode, so after the first-screen answer the window
  goes back to that computer. It is still the computer the window was last on.

## Review round 2 (sonnet; no BLOCKER) and Angel's switcher review (read at 27fd49b898)
- WARNING (r2): a reload while the reopen waits could make the torn-down page's failure ask again --> FIXED: every
  finished load is counted (`pageLoadSerial`) and an answer from a page since replaced is ignored.
- WARNING (r2): an automatic own-board reload after the ask counts as going home --> KNOWN LIMIT, kept: no in-app
  trigger found (the #1042 notice does not reload); the cost is one launch opening home.
- WARNING (r2): typing during the ticket wait --> FIXED: the reopen blurs the focused field before switching, and the
  guard also watches wheel and touchstart.
- CONVENTION (r2): source-text tests for a state machine --> FIXED: `reopenStep` is a pure decision with 14 rows in
  the selftest; the wiring test checks each arm does what the step says.
- WARNING (Angel): 6 s was below the route's own worst case (20 s Mac request plus 4 s per off probe) --> FIXED: 30 s,
  OA_COMPUTERS_LIMIT_MS's value and reason; the touch guard protects unsent text meanwhile.
- WARNING (Angel): a passing failure forgot the computer, which brings back the card's complaint --> CHANGED from
  round 1's call: only FINAL answers forget (gone, home, touched, signed-out, bad); slow, unknown, updating, offline
  and not-instant keep it. A later own-board load in the same launch still forgets. Signed-out forgets on purpose,
  against Angel's suggestion: remote access off is usually deliberate, and keeping it repeats the toast every launch.
  Weakest premise (Angel's): a session at home after a failed reopen with no board reload keeps the host, so the next
  launch goes back, one click from home.
- NIT (Angel): the rule was a second copy --> FIXED: `computersOpens(c)` and `computersOlderSaid` shared by the menu
  and the reopen, and the reopen ends on the shared rule.
- NIT (Angel): the menu hides itself under two rows, the reopen does not --> NO CHANGE: the reopen only needs the
  remembered computer's own row.

## Review round 3 (opus; no BLOCKER): QUIT DECIDES
- WARNING: the stale-answer counter counted finished loads, but a reload tears the page down at the NEW page's
  commit, so the stale failure still got through and asked again --> FIXED: `pageCommits` (#5167's, bumped in didCommit).
- WARNING: an `error` retry had no time limit, so a second ask could land hours later --> FIXED: only
  `no-page-support` (a sign-in page) retries; an error keeps the host.
- WARNING: the keep/forget policy depended on reloads the person never sees, and they are common (updateSafeReload,
  engine restart, update finished), so round 2's "no in-app trigger found" was WRONG --> REDESIGNED to Josh's own
  words ("If I quit or restart the app ... persisting ... to the agents I was looking at"): `applicationWillTerminate`
  writes what the window shows at quit (another computer: its host; home: nothing). Page loads only keep (so a crash
  still leaves the last one) and an own-board reload decides nothing. Answers forget only what can never be reopened
  (gone, home, bad). Both walks now end the same: a day at home forgets the computer at quit.
- WARNING: up to 30 s of home with no sign, then a switch; a stray click forgot the computer silently --> FIXED: a
  toast at once ("Going back to mini, the computer you were looking at. Click or type here to stay on this
  computer."), "Staying on this computer." when they do, and a click no longer forgets anything (quit decides).
- NITs fixed: a reopenStep row for another computer before the ask; the 30 s value is pinned against
  OA_COMPUTERS_LIMIT_MS. NIT kept: the offline toast does not promise a retry (quit at home forgets, so it may not).

## Review round 4 (sonnet; no BLOCKER)
- WARNING: quit at home forgot the computer when the person never chose home (a quit during the reopen, the
  update relaunch, or after a passing failure such as the computer asleep) --> FIXED: `reopenOutstanding`, set at
  the ask and cleared when the person chooses home (touched, Back to This Computer), the answer settles it
  (signed-out) or forgets it (gone, home, bad), or the other computer's page loads. `quitKeeps` (6 selftest rows)
  keeps the host while it is outstanding. So a computer asleep for one launch is tried again next launch; a person
  who prefers home clicks once during "Going back to ...", and the quit then forgets it.
- WARNING: a crashed page (committedPageURL nil) read as home at quit --> FIXED: no page decides nothing.
- NIT: the update relaunch's new copy can read the value before the old copy's quit writes it --> COMMENT (same
  host in the common case).
- NIT: the "Going back" toast stayed up on quiet exits --> FIXED ("Staying on this computer.").
- NIT: stale plan text (6 s, "everything else forgets", signed-out) --> FIXED above.

## Review round 5 (opus; no BLOCKER)
- WARNING: choosing to stay was lost if the page crashed before quit (touched only settled) --> FIXED: touched and
  signed-out forget at once.
- WARNING: a computer that stays off (or on an older Kosmos) toasted at every launch with no practical way out -->
  FIXED: misses are counted across launches (UserDefaults) and 3 in a row forget it (`reopenMissesForget`, 3 rows);
  an opening reopen, a new host and Back to This Computer reset the count.
- WARNING: a failed switch left "Going back to ... click to stay" up with nobody listening --> FIXED: "Opening
  <name>..." replaces it as the switch starts.
- CONVENTION: a successful reopen never settled the outstanding reopen (`.nothing` for the same host) --> FIXED:
  another computer's page always settles it; the wiring writes only a change.
- CONVENTION: plan step 1 contradicted the code --> FIXED.
- NITs fixed: a sign-in page's retry only within 120 s of the ask; "Click, type or scroll here"; the quitKeeps doc on
  mid-switch; a row title; the #6585 comment's condition. NIT kept: the first toast uses the host label (the name is
  not known until the list answers).

## Review round 6 (sonnet; no BLOCKER)
- WARNING: misses were reset when a switch STARTED, so a computer whose page never lands never reached the limit
  --> FIXED: only the other computer's page loading resets them (`reopenMissesAfter`, 5 rows; `.keep` resets).
- WARNING: an offline laptop counted its own failures (unknown, slow, error) as misses and forgot the mini after 3
  launches --> FIXED: those are `.notChecked`, kept outstanding and not counted. Only offline, updating and
  not-instant (the other computer's own state) count.
- WARNING: a bare modifier key counted as "stay" --> FIXED: Shift, Control, Alt, Command, Caps Lock, Fn alone do
  not. KEPT: a click that only focuses the window still counts; the toast says "click ... to stay", and the window
  is short (the answer is usually back in a second).
- CONVENTION: the count and retry wiring were source-text tests --> FIXED: `reopenMissesAfter` and
  `reopenRetryAllowed` (3 rows) are pure with selftest rows.
- NIT, documented: quitting during a MANUAL switch's ticket wait forgets the computer (the old page is home and
  nothing is outstanding), so the next launch opens home. The person had not landed there yet.
- NIT kept: the 'busy' answer is nearly unreachable (a click that switches also counts as touched). Harmless.
- NIT fixed: a row title.

## Review round 7 (opus; no BLOCKER)
- WARNING: the 120 s retry bound was checked when the sign-in page's answer came (always within the window), so a
  retry could still ask an hour later --> FIXED: checked in the `.ask` arm, where the second ask happens.
- WARNING: a click to stay was not confirmed until the list answered (up to about 24 s) while the toast still said
  it was going back --> FIXED: "Staying on this computer." at the click, and the list read is aborted.
- CONVENTION: four places described the answers out of date --> FIXED (the page comment, this plan, the kept-host
  comment, the test header).
- NITs fixed: drop and input count as staying (a dropped file, dictation); a quit writing a different computer
  resets the miss count; a test title. NIT commented: a probe failing because of THIS computer's network can read as
  the other computer offline (at most a counted miss).
- NIT kept: another board toast in the first 30 s can replace "Going back ..." (one toast slot per page); the
  switching screen still shows if the switch lands.

## Weakest premise (now)
That every way the app ends reaches applicationWillTerminate (Cmd-Q, the menu, the Dock, the last window, an
update's relaunch). A force quit or crash skips it, and then the last host kept at a page load stands.
