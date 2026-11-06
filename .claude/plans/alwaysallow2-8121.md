# kosmos#8121 re-land: Always Allow, honoured only while on this Kosmos+ account

Card: kosmos#8121. First landing: #8130, reverted by #8133 before the 0.7.95 cut.

## Why the first landing was reverted
Ice Cream Kitty (relay owner, on #8121): a retired computer's name frees for ANY account after 24 h
(coordinator signin.rs:1244 and :2852, RETIRED_NAME_GRACE_SECS = 24 h in config.rs:1089). A kept answer keyed
by name alone could then let a stranger's computer save files unasked.

## The call
- Reapply #8130 (git revert of #8133's 0caac862f6), then gate the kept path on this computer's own board:
  GET http://127.0.0.1:<port>/api/remote/computers (the list #4648's menu and #8118's reopen read), with the
  board token, 15 s timeout.
- accountVerdict (pure): onAccount only when ok == true, a domain, a computers array, the host under that
  domain, and an entry whose address equals the host (case-insensitive). ok:false, signed out, no answer,
  odd shapes: unknown. A list that reads but lacks the host: notOnAccount.
- notOnAccount: the name is forgotten and the person is asked. unknown: the person is asked, the name kept.
  Either way the host is not re-checked for the rest of the run (one wait per run, not per download).
- A page that changed during the check saves nothing (the same rule as the question's void Allow).
- Always Allow is offered only when the board lists this host on the account at the moment of the question
  (review 1), so no board, signed out, an unread list or a name elsewhere never shows a button that cannot
  hold. The alert says "while it is on your Kosmos+ account".
- A confirmation lasts one hour (keptConfirmedAt), not the run (review 1: the app runs for days).
- Forget pressed during a check wins: a late onAccount grants nothing once the name is gone (review 1).
- Reload clears the run's unconfirmed set; the button mapping is the pure downloadAnswer (review 1).
- New preference key kosmos.downloads.alwaysAllowedOnAccount; the #8130 key is removed on first read.

## Rejected
- Keying on a computer id: the app does not see ids, only hosts; adding one needs relay and page work.
- Asking the remote computer's own page for the list: a stranger's computer would list its own name.
- A pass on a slow list: fails open, which is the hole being closed.

## Weakest premise
That the local board's list is this account's current list. It is fetched live through the tunnel
(engine/account-computers.js), not cached, so a moved name drops off it; not measured end to end with two
accounts here (no second account on this box). A name retired and re-claimed inside the hour
after a confirmation is still trusted for that remainder; the relay holds a retired name 24 h, so this needs
the hour to straddle the end of that grace.

## What would change my mind
A relay change that keeps retired names reserved forever (then the check is redundant but harmless), or a
measurement that /api/remote/computers can answer from a stale cache.

## Verification
- mode selftest 312/312 (+10 accountVerdict, +4 downloadAnswer); download selftest 55/55 (+3: on account
  not asked, moved account asked and forgotten, unread list asked and kept; +5 after review 1: a joined
  check, a page change mid-check, Forget mid-check, the hour, not offered when unconfirmed).
- Mutants: askAccount stand-in ignored -> 3 rows FAIL; ok check dropped -> 1 mode row FAIL; review 1's four
  (stillKept dropped, page guard dropped, hour ignored, offer always on) -> each fails its own row.
- node: the 49 test files that read main.swift or the bundle script, 585 tests: 1 fail (applog pin 6 -> 8,
  raised with both new lines named in fixed words), then 66/66 on the three pinning files.
- Windows not touched or claimed.
