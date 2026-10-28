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
