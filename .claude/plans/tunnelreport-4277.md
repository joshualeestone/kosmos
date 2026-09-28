# tunnelreport-4277: the board reports its remote-access status to the coordinator

kosmos#4277, board half. The coordinator half is kosmos-relay `macremote-4277`: it stores the latest report per Mac, read on the box with `deploy/mac-remote-report.sh`.

## Why
On 2026-09-27 a board went offline across an update. The coordinator and relay logs said only that its tunnel never asked for a relay ticket. The reason lived in this board's `remote.status()` and nowhere we could read.

## Call
- **`engine/remote-report.js`** (new) builds the report: `on`; `tunnel` (status() mapped to running, starting, crashed, stopped or off); `error` (**a code, never text**: review 4 showed that a scrubber keeps missing identifying text, such as hostnames, device names, LAN addresses, phone numbers and file:// or relative paths, while it destroys the diagnosis and can run quadratically on a long line. So the board CLASSIFIES status()'s own sentence into one code from a fixed list (`CODES`: switch-off, binary-missing, state-dir-invalid, state-file-unreadable, relay-refused, relay-dropped, coordinator-refused, coordinator-unreachable, crashed, awaiting-sign-in, not-started, starting, other). The input is capped at 2000 characters and only short literal patterns are used. A board with its switch on and a key in hand that is not enrolled instead sends `not-enrolled; missing: <files>`, with the enrolment files named by their fixed names, which is the actual reason, where status()'s sign-in sentence would blame the person); `stateDir` (default, custom or missing); `macId` and `macKey` (the files exist); `app` (the version); `heal`. It sends only fixed values, never free text, and it never throws (null means nothing is sent).
- **`engine/mac-standing.js`** sends `{ remote: <report> }` as the standing body, where it sent `{}`. A coordinator without #4277 ignores the body. The call is already signed through the tunnel's `mac-request` verb.
- **`engine/remote.js`:**
  - (a) A board whose switch is ON and which holds a key but believes it is NOT enrolled skipped the standing call entirely. It now sends the report alone (`reportNotEnrolledIfDue`), signed with the key files only (`macRequest(..., { keyOnly: true })`, which refuses every route but `POST /v1/mac/standing`, review 1; the key check is one helper, `holdsKey()`, which `halfRegistered()` now uses too), at most every 5 minutes, and ignores the answer. That is exactly the state that never asks for a relay ticket.
  - (b) `restarts` counts the supervisor's relaunches, so `heal` can say relaunched or relaunch-failed. It is committed only after a report is SENT (`commitHeal(report)`, tied to that report object, review 3), so a failed send does not swallow a relaunch, and a tunnel still starting is not called a failure (review 2). The baseline starts at 0 (restarts counts from process start), so relaunches before the first send are not lost (review 4). The not-enrolled send logs one line per distinct failure reason, not one every five minutes (review 4).
- **Self-heal is the existing supervisor.** `ensure()` runs every 15 s and relaunches a dead tunnel with backoff, and a board restart (the update) starts it again. A new acceptance test pins both: a SIGKILLed tunnel comes back as a new process, counted, and a board restart brings it back.

Rejected:
- **A second "relaunch once after an update" path.** It would race the supervisor. The supervisor already relaunches; what was missing was knowing when it could NOT start (not enrolled, busy) and why, which is what the report now says.
- **Relaxing `enrolled()` to start the tunnel on a half-enrolled state dir.** A tunnel without its certificate cannot serve. The fix is to report the half state, not to paper over it.

## Evidence
- `node --test engine/remote-report.test.js`: 10 of 10: codes for every known failure kind, unknown text reads `other`, a 100k-character line classifies in under 200 ms, not-enrolled names the missing files, heal semantics.
- `engine/mac-standing.test.js`: 16 of 16, including the not-enrolled report (missing files named, no email), the test-runner guard (spied, with a control), the heal commit at BOTH call sites, the in-flight guard, and key-only signing needing the key on disk and refusing every other route.
- `engine/remote.test.js`: all pass, plus the new #4277 self-heal acceptance test.

## Deferred (review 2)
- A register does not wait for an in-flight key-only report (only Forget waits on signedInFlight), so clearHalfIdentity can race one. The class is pre-existing for enrolled renames, and the worst outcome is a stray file or a 401.

## Weakest premise
A Mac whose key file is gone cannot report at all (nothing can sign for it). The coordinator's admin read shows how long ago each Mac was last seen next to its last report, so a Mac that stops reporting still stands out.
