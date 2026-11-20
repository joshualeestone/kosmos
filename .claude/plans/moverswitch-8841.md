# moverswitch-8841: a restart does not silently undo the usage poll and the mover

Card: #8841, part 2 (Liu Kang, 2026-11-20: build it now, keep the default unchanged, do not change the setting on
Mortals' board; part 1, switching the poll back on there, stays with Josh).

## What happened (from Mortals' board.log)
- Every start from 2026-11-06T09:17Z to 2026-11-10T21:36Z logged `autobalance-sweep: ... running; the mover is on`
  (10 starts), so both AGENT_WORKFORCE_USAGE_POLL=1 and AGENT_WORKFORCE_AUTOMOVE=1 reached the board then.
- The start at 2026-11-11T19:40Z and the 11 after it logged `not running now: the usage poll is off; the mover is
  off`. The board's launch job (`com.kosmos.board`) carries neither variable, and `launchctl getenv` has neither now.
- Inferred, not measured: they were set in the login session's launchd environment, which outlives a board restart
  and is lost when that session's environment is reset.
- On 2026-11-20 two agents sat on an account at 100% of its weekly limit until they were moved by hand.

## Fix
`engine/keptswitch.js`, called once as the board starts, before the usage poll and the mover are wired:
- a start that has `NAME=1` records it (`kept-switches.json` in the board's data folder, saved through
  `store.saveFlushed`);
- a later start with the variable UNSET sets it from that record, and says so in the board log, with the date it was
  first switched on and how to switch it off;
- `NAME=0` at a start removes the record (off for good);
- the brake (`NAME_OFF=1`) is unchanged: off while set, and the record is left alone;
- under a test or a dry run nothing is read, written or changed.

The default does not change: a board nobody switched on has no record, writes none, and stays off.

## Decided, and what would change my mind
- **The choice sticks from one `=1` start.** The alternative was a separate command or file to make it durable. The
  card's case is an operator who switched it on and expected it to stay; a second step they did not know about would
  reproduce the failure. What would change it: if `=1` is used for one-off trial starts that must not stick.
- **The screen is not changed.** With the poll off the page already says "Kosmos is not keeping a record of what it
  would move on this computer", and with the mover off "Kosmos does not move agents on its own yet" or "Kosmos is not
  moving agents on this computer now" (pinned in `docs/browser-checks/render-autobalance-7152.js`). The silent case
  was a restart undoing the switch, which this removes. What would change it: wanting the page to say that the switch
  was kept from an earlier start, or to offer the off switch there.
- **No reset of an unreadable record.** It keeps nothing and says so, as `storecheck` leaves torn stores alone.

## Weakest part
The usage poll is off by default on purpose (usagepoll.js, review 19: it sends each account's subscription token to an
endpoint that is not documented). This change makes one deliberate `=1` last across restarts. That is what the card
asks for, but it widens a switch that was written to be said again at every start. The off switch (`=0`) is new and is
named in the log line every time a kept switch is applied.

Second: the call in `server.js` is pinned by reading the source (it runs before the poll and the mover are wired, and
never live under a test), not by starting a board, because a board under test must not apply it.

## Checks
- `engine/keptswitch.test.js` (8): nothing kept by default (control); on at one start, on at the next with the
  variables unset, with the exact log line; `=0` off for good; the brake; no effect under a test; an unreadable record;
  an unwritable record; the call site.
- Neighbours, all green: usagepoll, automove and autobalance-sweep tests (151), and the guards for raw writes, flushed
  setting saves, reachable engine modules and fixture discipline (47 with the new file).
