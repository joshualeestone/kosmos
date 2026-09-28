# tunnelreport-4277: the board reports its remote-access status to the coordinator

kosmos#4277, board half. The coordinator half is kosmos-relay `macremote-4277`: it stores the latest report per Mac, read on the box with `deploy/mac-remote-report.sh`.

## Why
On 2026-09-27 a board went offline across an update. The coordinator and relay logs said only that its tunnel never asked for a relay ticket. The reason lived in this board's `remote.status()` and nowhere we could read.

## Call
- **`engine/remote-report.js`** (new) builds the report: `on`; `tunnel` (status() mapped to running, starting, crashed, stopped or off); `error` (status()'s own sentence, with the home directory written as `~` in any letter case, every email written as `<email>` because status() names the sign-in email while the code is awaited (review 1), control characters dropped, cut to 300 characters); `stateDir` (default, custom or missing); `macId` and `macKey` (the files exist); `app` (the version); `heal`. It never sends a path, an address, an email or a key, and it never throws (null means nothing is sent).
- **`engine/mac-standing.js`** sends `{ remote: <report> }` as the standing body, where it sent `{}`. A coordinator without #4277 ignores the body. The call is already signed through the tunnel's `mac-request` verb.
- **`engine/remote.js`:**
  - (a) A board whose switch is ON and which holds a key but believes it is NOT enrolled skipped the standing call entirely. It now sends the report alone (`reportNotEnrolledIfDue`), signed with the key files only (`macRequest(..., { keyOnly: true })`, which refuses every route but `POST /v1/mac/standing`, review 1; the key check is one helper, `holdsKey()`, which `halfRegistered()` now uses too), at most every 5 minutes, and ignores the answer. That is exactly the state that never asks for a relay ticket.
  - (b) `restarts` counts the supervisor's relaunches, so `heal` can say relaunched or relaunch-failed.
- **Self-heal is the existing supervisor.** `ensure()` runs every 15 s and relaunches a dead tunnel with backoff, and a board restart (the update) starts it again. A new acceptance test pins both: a SIGKILLed tunnel comes back as a new process, counted, and a board restart brings it back.

Rejected:
- **A second "relaunch once after an update" path.** It would race the supervisor. The supervisor already relaunches; what was missing was knowing when it could NOT start (not enrolled, busy) and why, which is what the report now says.
- **Relaxing `enrolled()` to start the tunnel on a half-enrolled state dir.** A tunnel without its certificate cannot serve. The fix is to report the half state, not to paper over it.

## Evidence
- `node --test engine/remote-report.test.js`: 10 of 10, including the email and letter-case cases (a mutant dropping the email scrub fails here and end to end).
- `engine/mac-standing.test.js`: 12 of 12, including key-only signing refusing every other route and the not-enrolled report never carrying the settings email. This includes the body carrying the report and no home path, the not-enrolled report going signed with the key alone and throttled, and no report when off or keyless.
- `engine/remote.test.js`: all pass, plus the new #4277 self-heal acceptance test.

## Weakest premise
A Mac whose key file is gone cannot report at all (nothing can sign for it). The coordinator's admin read shows how long ago each Mac was last seen next to its last report, so a Mac that stops reporting still stands out.
