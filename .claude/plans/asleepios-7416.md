# asleepios-7416: #7416 slice 2, the iPhone and iPad

Card #7416, plan comment 6460778817. Slice 1 (the board, branch asleepnote-7416) is separate; this slice needs
nothing from it.

## What it does
- `Shell.macUnreachableMessage(_:lastSeen:)`: Mona Lisa's first sentence "It may be asleep, off or offline."
  (was "It may be asleep or turned off."), then "We last heard from it ..." when Kosmos+ has a time.
- `Shell.heardWhen` / `Shell.lastHeardSentence`: the board's lastHeardSentence rules (web/index.html, slice 1):
  "at 8:12 PM" today, "yesterday at", "on Tuesday at" within the week, "on Oct 21" before. Calendar days. nil for
  no time (0 or missing) and for a time more than 60 s ahead of now.
- `Board.lastSeen(_:address:name:)`: the time from the account's list, by address (case-insensitive), else by a
  name only one computer has.
- `BoardClient.lastSeen(of:)`, AgentsView's not-answering screen, ContentView's web shell (`ShellState.failureAddress`
  from the failed host), `LoadFailureView.lastSeen`.
- Switcher: `SwitcherRow.seen`; an offline row reads "Offline, last seen at 8:12 PM".
- ios/README.md wording.

## Decided
- last_seen is unix seconds: coordinator/src/util.rs `now()` "The coordinator speaks only unix seconds", stored by
  touch_mac.
- Two computers of one name with no address: no time rather than possibly the other one's.
- "Wake it, then try again." kept after the new sentences.

## Verified
- ios/LogicTests/run.sh: VERDICT PASS 1476/1476 at 9091dfbe98.
- Mutations, each one red check: future guard removed; hours instead of calendar days; twins take the first;
  switcher never shows seen. (A first switcher mutation, `nil ??`, was equivalent and stayed green; replaced.)
- iOS simulator build: queued through queued-heavy (scratchpad iosbuild.log).

## Review ledger
### Round 1 (1 B, 2 W, 1 C, 2 N), all B/W/C applied
- [BLOCKER] the list's last_seen is as old as the list's one read, so a Mac read every 5 s all day said "at 7:58 AM"
  at night. FIXED: `heardFrom` (the app's last good read per address) and `Board.lastHeard` (the later of the two),
  as the board uses its own last good status read. Client test in the not-answering section; mutation (never keep
  the read) red.
- [WARNING] the screen's day words did not refresh over midnight. FIXED: `TimelineView(.everyMinute)` around the
  message.
- [WARNING] the fall-back DST test could not fail (25 h still rounds to 1 day). FIXED: a spring-forward case on the
  23 h day (8 to 9 March); my first try used 7 to 8 March (24 h) and the reviewer's hours mutant stayed green, so I
  moved it; the mutant is now red.
- [CONCERN] two Macs of one name: the time could be the shown Mac's. FIXED: `failingAddress` set with each
  `.unreachable`, and the lookup is by that address.
- [NIT] a DateFormatter per call. Not changed: the switcher has a handful of rows and redraws every 5 s; caching by
  locale, zone and template adds state for no visible gain.
- [NIT] weekday and month names follow the phone's language inside an English sentence. Not changed: the board does
  the same (formats with []); changing it is a change to both together.

### Round 2 (1 B, 2 W, 2 C, 2 N), all B/W/C applied
- [BLOCKER] the list is read once a launch, a switch or a second Try again, and the app reads a Mac only while its
  loop runs, so after a night in the background the screen could say "yesterday at 11:00 PM" for a Mac Kosmos+ saw at
  7:58 AM; worst on the web view for a Mac the loop never read. FIXED: `refreshLastSeen()` reads the list again when
  either not-answering screen appears, at most once a minute. Measured: the Mac's standing report touches last_seen
  (coordinator macs.rs, touch_mac), so a fresh list has a fresh time. Tests: the fresher time is said, and not read
  again within the minute; mutation (no throttle) red.
- [WARNING] the switcher used only the list's time and could disagree with the screen. FIXED: `switcherRows(heard:)`
  takes `heardFrom`, says `Board.lastHeard`, and a Mac read in the last 15 s is online. Mutation red.
- [WARNING] the web-view path had no test. FIXED by the client test above: Laptop, a Mac the loop never read, by its
  address through `lastHeard(address:name:)`, the same call ContentView makes with the failed host.
- [CONCERN] read times survived sign-out and account change. FIXED in both `forget()` and start's signed-out branch,
  with a test for each; the forget test is the one that reds when forget keeps them (the sign-out test goes through
  start, so my first test did not cover forget).
- [CONCERN] openSession's failingAddress was untested. FIXED: the switch-to-offline-Laptop test checks it; mutation red.
- [NIT] failingAddress written by a stale run. FIXED: only when `gen == generation`.
- [NIT] the switcher's time does not redraw on its own while the loop is stopped. Not changed: the menu is rebuilt
  when opened, and that is when it is read.

### Round 3 (1 B, 1 C, 4 N), all applied
- [BLOCKER] the web view's re-read ran on onAppear, but that screen stays up across Try again, a change of failure in
  place and a return from the background, so the overnight case still said last night's time. FIXED:
  `.task(id: failure)` and a re-read on `scenePhase == .active` while the failure is macUnreachable (ContentView).
  View code: no LogicTest reaches it; the iOS build compiles it. The native screen was fine (start() tears it down).
- [CONCERN] refreshLastSeen read with the stored session, not the one the client runs under. FIXED: `admitted?.session`
  first, and no read when the shown owner differs. Not covered by a test (the fake world does not record which session
  a list read carried); reasoned from run(), which reads with `held` the same way.
- [NIT] the switch's own list read did not count for the throttle. FIXED: chooseMac and readMacs stamp
  `lastSeenReadAt`. The test first stayed green under the mutant (Studio's earlier read was still under a minute
  old); it now ages that read by 120 s, and the mutant is red.
- [NIT] two list reads could land out of order. FIXED: `macsTicket`, only the last-started read is shown. No test (the
  reviewer called it harmless today).
- [NIT] the account-change test's `failingAddress == nil` half could not fail. Removed. [NIT] the signed-out test had no
  control. Added (`readBefore`).

### Round 4 (2 W, 2 C, 1 N), all applied
- [WARNING] refreshLastSeen stamped the throttle before reading and tied the read to the run, so on a return the
  agents tab's own start() (a new generation) could drop it and block a retry for a minute. FIXED: the stamp is set
  only when a list lands; an in-flight flag stops doubles; the refresh read is not tied to a run but lands only while
  the signed-in account is the one it asked for (and the shown list's owner). Test: a slow read that lands after
  another account signed in is not shown, with a CONTROL for the same account; mutation (no account check) red. The
  "dropped read leaves no stamp" half is reasoned, not tested.
- [WARNING] `.task(id: failure)` did not run on a Try again (same failure) or a second Mac failing. FIXED: id is the
  failure, the address and the Try again count; comment corrected (my round 3 note claimed this was covered; it was not).
- [CONCERN] round 3's "last started wins" ticket could throw away a good list when the newer read failed, leaving the
  switcher empty for the run. FIXED: `macsLanded`, an answer is dropped only when a newer one already landed (chooseMac
  records its landing too). Tests: out of order (newer stays), newer fails (older lands). Mutations: no ordering, no
  chooseMac landing, and round 3's ticket each red.
- [CONCERN] the ticket and owner guards had no test. FIXED: the review 4 section above.
- [NIT] the .task comment's claim. FIXED with the id.

### Round 5 (0 B, 0 W, 1 C, 1 N), both applied
- Reviewer re-ran four mutations of round 4's guards; all red. Late refresh reads after stop/forget/sign-out, a stuck
  in-flight flag and the .task id were checked and found sound.
- [CONCERN] a last_seen from Kosmos+'s clock more than a minute ahead of the phone's won the max and was then refused as a
  future time, hiding the phone's own fresh read. FIXED: `Board.lastHeard(now:)` ignores such a last_seen. Test with a
  CONTROL inside the allowance; mutation (no clamp) red.
- [NIT] chooseMac assigned its list without the ordering check. FIXED: shown only when `ticket > macsLanded`; the pick
  uses the run's own answer either way. Not separately tested (reasoned; the ordering tests cover readMacs).

### Round 6 (0 B, 1 W, 1 C, 3 N), W and C applied
- [WARNING] round 5's chooseMac ordering guard was untested (`if true` stayed green). FIXED: a switch's slow list read
  landing after a newer refresh; the newer list stays and the switch still opens its computer. Mutation red.
- [CONCERN] comments still said "Kosmos+'s last_seen" where the value is Board.lastHeard. FIXED in ShellLogic,
  ShellViews (the parameter is now `lastHeard`), BoardLogic, README.
- [NIT] the 60 s rule written twice. FIXED: `Shell.clockAllowance`, used by both.
- [NIT] `Board.lastSeen` is a one-line wrapper. Kept: the tests read it and the name says what it returns.
- [NIT] the switcher's words have no minute timer. Kept: the reviewer measured that something redraws it every few
  seconds while a Mac is shown or failing.

### Round 7 (0 B, 0 W, 0 C, 3 N), all applied
- Reviewer confirmed every LoadFailureView call compiles against `lastHeard:` (and the iOS build at 5a9da5c241 is
  BUILD SUCCEEDED), and re-ran four guard mutations, all red.
- [NIT] the round 6 test's "opens its computer from its own answer" could not fail (Laptop was in both lists). FIXED:
  the newer list leaves Laptop out; mutation (pick from the shown list) red.
- [NIT] the in-flight flag had no test and survived an account change. FIXED: a test that two refreshes send one read
  (mutation red), and the flag is cleared in forget and the signed-out branch.
- [NIT] the heardWhen comment sat above clockAllowance. FIXED: moved.

### Round 8 (0 B, 0 W, 0 C, 1 N)
- [NIT] after an account change, an old refresh finishing clears the new account's in-flight flag, letting one duplicate
  list read through. DEFERRED: harmless (one extra read, ordered by the ticket).

### After round 8: two defects I found myself, both fixed
1. **The wording was not Mona Lisa's.** I built from my plan comment (6460778817), not from her approved wording on the
   card (6458409943), which says: the switcher reads "Not answering since 8:12 PM" where it said Offline; the list's
   line reads "last heard 8:12 PM"; the bare time words are "8:12 PM", "yesterday at 8:12 PM", "Tuesday at 8:12 PM",
   "Oct 21". FIXED: `Board.heardWhen` returns both the bare words and the in-sentence form ("We last heard from it at
   8:12 PM", "on Tuesday at", "on Oct 21", as the board). Decided: the list's line keeps #7197's name ("Not updating.
   Studio isn't answering, last heard 8:12 PM."); where it carries the time, Today's and the chat's "Last checked" is
   dropped (the same moment, said twice otherwise). With no time, both lines are as before.
2. **Three LogicTests runners did not compile.** agentinfo, newtask and tasks build BoardLogic.swift without
   ShellLogic.swift, and switcherRows called Shell.heardWhen, so `ios.board-parity-7084.test.js` was red from my first
   commit. None of the eight rounds ran those runners, and I had only ever run run.sh. FIXED: the time words live in
   BoardLogic.swift. All nine runners pass and the five node tests that read the Swift sources pass (37/37, 2/2).
