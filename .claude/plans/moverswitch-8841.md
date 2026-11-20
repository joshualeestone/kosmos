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

Settings, AI Models says, under the accounts, when usage readings or moves are switched on only because an earlier
start switched them on, each on its own line with its own day (`kept` on the accounts read, beside the decision). It
is outside the auto-balance row, because the usage poll also runs with one account and with auto-balance switched off.
The line says the switch has stayed on, not that anything is being read or moved now. A switch the brake is holding
off is not listed.

The default does not change: a board nobody switched on has no record, writes none, and stays off.

## Decided, and what would change my mind
- **The choice sticks from one `=1` start.** The alternative was a separate command or file to make it durable. The
  card's case is an operator who switched it on and expected it to stay; a second step they did not know about would
  reproduce the failure. What would change it: if `=1` is used for one-off trial starts that must not stick.
  Liu Kang's direction for this part (2026-11-20): "a restart should not silently undo the poll setting". Review round
  2 raised the trial-start risk again; it stays as decided, and is the first thing named for the reviewer.
- **Not in the environment.** The first version set `process.env`, so every shell and test run the board started
  would have inherited the switch for good (review round 1). Kept in the module instead.
- **A record that cannot be read is never written over**, even to record what this start was told: it may hold the
  other switch. This start still does what its own environment says, and the log says the keeping was lost.
- **The record belongs to the computer that wrote it, by name.** A backup takes the board's data folder, so the file
  can arrive on another computer with a restore (review round 4). The record carries a short hash of the computer's
  name, lower-cased and without the suffix a network adds, so the same Mac on another network is the same computer
  and the name itself is not in the file (rounds 5 and 7). Under any other name it keeps nothing, the log says so and
  names the fix, and Settings says a record was found and not applied.
  **An explicit off (`=0`) is honoured whatever name the record was written under** (round 7's blocker: an off given
  while the name differed did not touch the record, so the switch came back when the name did).
  Rejected: the hardware id (engine/computerprint.js). Its rule 1 forbids storing the id, or anything a copied folder
  could replay, under a data root, and that rule was settled over many review rounds on #5532; a kept-switch record is
  not a reason to reopen it. Rejected: keeping the file outside the data root; there is no per-install state folder
  with a helper today, and inventing one is a larger change than this card.
  Known limits, both toward ON, which is the wrong side for a switch that sends subscription tokens: a Mac set up
  from another with Migration Assistant often keeps the name, and two computers can share a generic name
  ("Mac-mini"), so a backup restored onto either would keep the switch (review round 8). The install id
  (`ping.json`) does not help: it lives in the same data folder and travels with the same backup. Closing this needs
  an identity a copied folder cannot carry, which is the computerprint question above. Named for the reviewer and for
  Josh as the open risk of this change.
- **The wording on the page describes the present** ("That switch is still on."), not the time between, since a start
  under the brake or with an odd value was off in between. Later wording-only objections to these two lines are
  treated as settled here.
- **The board's one call is pinned by source text and position**, as well as by the route test. Raised in rounds 1, 3
  and 5. A test that starts a real board live would have to apply a real record, which a test must never do; the
  module's behaviour is tested directly, and the call site has nothing of its own to decide.
- **Where the board may not act for real, nothing is kept**, so the page line cannot show there (review round 4 asked;
  `atBoardStart` is not live there, and `keptNow()` is then empty).
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
- `engine/keptswitch.test.js` (14, with an off that sticks across names, the same computer on another network, with a record from another computer keeping nothing and being reported, a computer whose name cannot be read, an odd value's log line, and controls): nothing kept by default (control); on at one start, kept at the next, with the
  exact log lines; the environment is not changed and no other environment reads as on; `=0` off for good; odd and
  empty values; the brake, its wording, and that a braked switch is not reported as kept; no effect under a test, a
  dry run or without live execution (with a live control); an unreadable record never written over; an unwritable
  record; a time no date can say; the board's one call, placed before the start decides whether to make the mover.
- `server.autobalance-7152.test.js`: `kept` reaches the Settings read after a start keeps a switch, is empty before
  (control), and is not sent to other readers.
- `web.kept-switch-8841.test.js` (6): `paintKept` lifted from the page and run: nothing kept (control), each switch
  with its own day, a time no date can say, a record not applied, no place to draw, and the read's three calls.
- `docs/browser-checks/render-autobalance-7152.js`: the same lines in a real page, with one account, with
  auto-balance off, and a failed read taking them away. NOT RUN: the machine was reserved for a release, and this
  check is not in the set a pull request runs (`KOSMOS_BC_CI_ALLOWLIST`), which is why the unit test above exists.
  It is owed a run on a free machine before the merge.
- Run locally: every test file that reads the two switches or lifts the page's accounts painter (333 of 333 at round
  3), and at the final code the unit, route and neighbour tests with the guards for Windows coupling, raw writes,
  reachable engine modules and fixture discipline (213 of 213).
