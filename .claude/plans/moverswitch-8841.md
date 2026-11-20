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
`engine/keptswitch.js`, called once as the board starts (`atBoardStart`):
- a start that has `NAME=1` records it (`kept-switches.json` in the board's data folder, saved through
  `store.saveFlushed`);
- a later start with the variable unset keeps it on, and says so in the board log, with the date it was first
  switched on and how to switch it off;
- `NAME=0` at a start removes the record (off for good);
- the brake (`NAME_OFF=1`) is unchanged: off while set, the record is left alone, and the log line says it is held off;
- under a test or a dry run nothing is read, written or kept.

`usagepoll.enabled()` and `automove.movesOn()` ask `keptswitch.on()`. The kept choice lives in that module, for the
environment object the board started with. It is not written into the environment, so nothing the board starts (an
agent's shell, a test run from one) inherits a switch.

Settings, AI Models says when usage readings or moves are on only because an earlier start switched them on, and since
which day (`autobalance.kept` on the accounts read).

The default does not change: a board nobody switched on has no record, writes none, and stays off.

## Decided, and what would change my mind
- **The choice sticks from one `=1` start.** The alternative was a separate command or file to make it durable. The
  card's case is an operator who switched it on and expected it to stay; a second step they did not know about would
  reproduce the failure. What would change it: if `=1` is used for one-off trial starts that must not stick.
- **Not in the environment.** The first version set `process.env`, so every shell and test run the board started
  would have inherited the switch for good (review round 1). Kept in the module instead.
- **A record that cannot be read is never written over**, even to record what this start was told: it may hold the
  other switch. This start still does what its own environment says, and the log says the keeping was lost.
- **The page says "kept", and offers no off switch.** Off stays where on is: the start environment (`=0`). What
  would change it: a ruling that this should be a Settings control.

## Weakest part
The usage poll is off by default on purpose (usagepoll.js, review 19: it sends each account's subscription token to an
endpoint that is not documented). This change makes one deliberate `=1` last across restarts. That is what the card
asks for, but it widens a switch that was written to be said again at every start. Anything that can write the
board's data folder can also write this record; the same is true of the launchd environment the switch lived in
before. What is new against that: the page now says when a switch is kept and since when, and the log names the off
switch each time.

## Checks
- `engine/keptswitch.test.js` (10): nothing kept by default (control); on at one start, kept at the next, with the
  exact log lines; the environment is not changed and no other environment reads as on; `=0` off for good; odd and
  empty values; the brake and its wording; no effect under a test, a dry run or without live execution (with a live
  control); an unreadable record never written over; an unwritable record; the board's one call.
- `docs/browser-checks/render-autobalance-7152.js`: two kept cases and a control. NOT RUN locally (the machine was
  reserved for a release); CI runs it.
- Run locally: every test file that reads the two switches or the page's painter, and the guards for raw writes,
  flushed setting saves, reachable engine modules and fixture discipline: 200 of 200.
