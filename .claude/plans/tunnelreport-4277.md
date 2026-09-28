# tunnelreport-4277: the board reports its remote-access status to the coordinator

kosmos#4277, board half. The coordinator half is kosmos-relay `macremote-4277`: it stores the latest report per Mac, read on the box with `deploy/mac-remote-report.sh`.

## Why
On 2026-09-27 a board went offline across an update. The coordinator and relay logs said only that its tunnel never asked for a relay ticket. The reason lived in this board's `remote.status()` and nowhere we could read.

## Call
- **`engine/remote-report.js`** (new) builds the report: `on`; `tunnel` (status() mapped to running, starting, crashed, stopped or off); `error` (**a code, never text**: review 4 showed that a scrubber keeps missing identifying text, such as hostnames, device names, LAN addresses, phone numbers and file:// or relative paths, while it destroys the diagnosis and can run quadratically on a long line. So the board CLASSIFIES status()'s own sentence into one code from a fixed list (`CODES`, checked in order, with the board's own healthy dialling sentences FIRST, matched exactly, so they can never read as a failure (review 7): starting, coordinator-unreachable, coordinator-refused, coordinator-bad-answer, status-unreadable, binary-missing, state-file-unreadable, ticket-expired, ticket-mismatch, cert-renewal, local-cert-unreadable, relay-certificate, relay-unreachable, relay-refused, relay-dropped, reconnecting, crashed, not-started, other; this is the order in CODES, first match wins). The input is capped at 2000 characters and only short literal patterns are used. A board with its switch on and a key in hand that is not enrolled instead sends `not-enrolled; missing: <files>`, with the enrolment files named by their fixed names, which is the actual reason, where status()'s sign-in sentence would blame the person); `stateDir` (default, custom or missing); `macId` and `macKey` (the files exist); `app` (the version); `heal`. It sends only fixed values, never free text, and it never throws (null means nothing is sent).
- **`server.js`** (review 8) starts `remote.startReportTimer()` (review 15) beside the ensure tick: a ten-minute unref'd timer that runs the refresh on its own, so a report does not wait for a browser tab to poll `/api/status` (the only other caller). A board nobody watches is the one whose status matters. The refresh is single-flighted and TTL-gated, so an open tab adds nothing.
- **`engine/mac-standing.js`** sends `{ remote: <report> }` as the standing body, where it sent `{}`. A coordinator without #4277 ignores the body. The call is already signed through the tunnel's `mac-request` verb.
- **`engine/remote.js`:**
  - (a) A board whose switch is ON and which holds a key but believes it is NOT enrolled skipped the standing call entirely. It now sends the report alone (`reportNotEnrolledIfDue`), signed with the key files only (`macRequest(..., { keyOnly: true })`, which refuses every route but `POST /v1/mac/standing`, review 1; the key check is one helper, `holdsKey()`, which `halfRegistered()` now uses too), at most every 5 minutes, and ignores the answer. That is exactly the state that never asks for a relay ticket.
  - (b) `restarts` counts the supervisor's relaunches, so `heal` can say relaunched or relaunch-failed. It is committed only after a report is SENT (`commitHeal(report)`, tied to that report object, review 3), so a failed send does not swallow a relaunch, and a tunnel still starting is not called a failure (review 2). The baseline starts at 0 (restarts counts from process start) and only moves forward, so a slow send committing late never rolls it back (review 5), so relaunches before the first send are not lost (review 4). A relaunch is counted only when the supervisor really starts a tunnel again, not when its timer fires into a board that is off or not enrolled (review 6), and a deliberate stop clears a pending relaunch (review 7). Both are pinned by a remote.test.js test in which a restart timer fires into a board that is no longer enrolled, and a mutant on either rule fails it (review 8). Since review 10, whether a relaunch held is read from the supervisor's process (remote.supervisorState), not status(). The not-enrolled send logs one line per distinct failure reason, not one every five minutes (review 4).
- **Self-heal is the existing supervisor.** `ensure()` runs every 15 s and relaunches a dead tunnel with backoff, and a board restart (the update) starts it again. A new acceptance test pins both: a SIGKILLed tunnel comes back as a new process, counted, and a board restart brings it back.

Rejected:
- **A second "relaunch once after an update" path.** It would race the supervisor. The supervisor already relaunches; what was missing was knowing when it could NOT start (not enrolled, busy) and why, which is what the report now says.
- **Relaxing `enrolled()` to start the tunnel on a half-enrolled state dir.** A tunnel without its certificate cannot serve. The fix is to report the half state, not to paper over it.

## Evidence
- `node --test engine/remote-report.test.js`: 13 of 13 (with real tunnel sentences: relay dial, TLS, 5xx vs 4xx): codes for every known failure kind, unknown text reads `other`, a 100k-character line classifies in under 200 ms, not-enrolled names the missing files, heal semantics.
- `engine/mac-standing.test.js`: 18 of 18, including a 20-minute clock step back that still sends and a repeated failure logged once (mutants on both fail), including the not-enrolled report (missing files named, no email), the test-runner guard (spied, with a control), the heal commit at BOTH call sites, the in-flight guard, and key-only signing needing the key on disk and refusing every other route.
- `engine/remote-standing-refresh.test.js`: 9 of 9, including a future standing_at (a clock stepped back) read as stale.
- `engine/remote.test.js`: 110 of 110, including nine #4277 tests: a killed tunnel relaunched and counted; a restart timer firing into an unwanted board counts nothing; a restart timer firing during a register does not count the register's start, through setup and through the in-app sign-in; the report's enrolment list equals enrolled()'s; the report timer fires early after boot, then on its own, and survives a throw; a sign-in over a half-registered Mac waits for its report already out. Mutants on the counting rules and the list each fail one.

## Deferred (review 2), since resolved
- Resolved in review 17: clearHalfIdentity waits for signed calls already out (as Forget does) before it retires and wipes; the key-only report fires exactly when a person is likely to sign in again, so the race was no longer rare. Tested; a mutant without the wait fails.

## Accepted (review 5)
- The coordinator bounds `error` but does not restrict it to known codes, so its privacy rests on the board's classify() discipline. The board sends only fixed tokens or fixed file names.

## Review 23
- A relaunch timer from before a same-identity register (rename or re-sign-in, which keeps the Mac id, so nothing stops the tunnel) survived the register: the register's ensure() returned early on it, the tunnel stayed down until the old backoff fired (up to 60 s), and that start was counted as a relaunch. A successful register now calls registerTakesOver(), which drops the pending flag AND the timer, then starts the tunnel itself. Test: a register that returns while a relaunch is pending leaves the process alive at once and counts nothing; a mutant that keeps the timer fails it.
- The ensure tick's status() call also resets a healthy board's backoff every tick; said at the code.
- Observed once, not this diff: the pre-existing #3827 "cut off mid-certificate" test flaked under a full remote.test.js run and passed on re-run.

## Review 22
- A stuck tunnel read as one coming up: the tunnel rewrites its status to connecting (no reason) at every retry (lib.rs run_forever), so the report mostly said `starting`/`starting`. remote.js now keeps the last failure sentence the CURRENT tunnel process wrote (sampled by status(), which the 15 s ensure tick now calls while a child runs; cleared when that process is up or a new one starts), and remote-report.js classifies it while the tunnel dials again. Memory only, never sent as text. Tests: remote-report (a stuck tunnel reads its failure code, a fresh one reads starting, a live reason wins) and remote.test.js (a fake tunnel in `retry-loop` writes a failure then retries with no reason; the tick keeps it; the report names it). Mutants removing the memory or the tick's sampling fail.
- server.remote-tick.test.js pins that the real boot starts the report timer, once (removing the call fails it).
- mac-standing.test.js pins KEY_ONLY_ROUTE equal to mac-standing's ROUTE (one fact, two modules).
- The timer comment had the tab case backwards: with a tab open /api/status refreshes on its own shorter TTL and the timer adds nothing; with none, the timer is the only caller.
- A test seam restore that could write the string "undefined" now deletes the variable instead.
- Deferred: a tunnel that hangs with no timeout (relay TLS handshake, AUTH write) never writes a failure, so it reads `starting`; the fix is in the tunnel, filed as #4315.
- Deferred, by design: relaunches counted before a board loses its enrolment are not reported by the first not-enrolled report (no process, nothing scheduled: not a result).

## Review 21
- The ship-order gate is MET: kosmos-relay #190 merged (07ab09d) and was deployed by Kitty; verified from here 2026-09-28 01:50 CDT: /v1/meta build 07ab09d, and an unsigned POST /v1/mac/standing answers 401 missing signature headers.
- The two register-race tests give each wait 15 s under load (`until()` takes an optional timeout; the default stays 5 s). Each wait was already separate, but a loaded CI box spawns slowly.
- mac-standing.test.js's first test title says the body is the remote report, not `{}`.

## Review 20
- An enrolled board's refresh read a standing_at in the FUTURE (a wrong Mac clock being corrected) as fresh, which silenced the report, the early tick's TTL 0 included, until the clock caught up. The freshness check is now `Math.abs`, like the not-enrolled throttle; remote-standing-refresh.test.js pins it (a mutant without it fails). That suite's null-backoff test had asked with a synthetic `now` near 1000 against a real Date.now() stamp; it now asks on the real clock, as production does.
- The module header says `starting` with an error code means stuck, not coming up.
- Deferred: an early EOF or a write error during the relay's AUTH carries no `relay` context in session.rs and reads `other`. The fix belongs in the tunnel's wording; nothing leaks.

## Review 19
- Kept, stated at the code: the not-enrolled report's test-runner guard is NODE_TEST_CONTEXT, not live-execution.js's execArgv. Convention 3's execArgv exists so a server a test spawns may still ACT; this guard exists so nothing a test spawns phones the production coordinator, which wants the inheritance (as createdbeacon.js and feedbacksend.js, and create.js's launch guard).
- errorCode() says why it re-reads mac_key (a Forget between the sender's check and build() falls back to classify(), losing detail, never leaking text).
- Deferred: the coordinator's HEAL_RESULTS accepts `not-needed`, which the board never sends. Harmless tolerance, in kosmos-relay; not worth a relay change.

## Review 18
- The early tick after boot asks with a TTL of 0: the last report's time lives in remote.json and survives the restart, so under the 9-minute TTL the early tick sent nothing about four restarts in five. Tested (the early tick's ttlMs is 0; a mutant passing the TTL fails).
- The early timer rides on the returned interval as `.first`, is unref'd, and its unref is tested (a mutant dropping it fails). server.js wraps the call in try, like its neighbours.
- 408 and 429 from Kosmos+ read coordinator-unreachable (not now), as RETIRE_TRANSIENT reads them, not coordinator-refused.
- New code ticket-expired (`ticket expired`, the tunnel's own clock check): usually a wrong Mac clock, which ticket-mismatch misdiagnosed as a bad key.

## Review 17
- clearHalfIdentity waits on signedInFlight before retiring and wiping a half identity (see Deferred (review 2)). New remote.test.js test: a key-only report hung for 700 ms finishes before the sign-in's retire.
- The coordinator half is two PRs: kosmos-relay #187 (macremote-4277, merged and deployed: stores the report) and #190 (reportonly-4277: a not-enrolled report does not refresh last_seen), which must be deployed before this merges.

## Review 16
- The `Kosmos+` coordinator patterns now come straight after the healthy sentences, before every other pattern: a gateway page inside a coordinator answer (`error reading body from upstream`, `certificate renewal in progress`) read as a local Mac fault. status-unreadable, binary-missing, cert-renewal and coordinator-bad-answer are anchored to their sentence starts (the tunnel writes `{e:#}` of run_session's error, so each starts the line). Tests use gateway bodies.
- state-dir-invalid and awaiting-sign-in removed: the tunnel refuses a state dir only without mac_id, which enrolled() requires, and only a not-enrolled board waits for a code, which sends `not-enrolled; missing: ...` instead. Both sentences now read `other`, still tested for no leak.
- New code local-cert-unreadable for session.rs's local TLS setup (opening/parsing the certificate or key): a corrupt tls.crt/tls.key after an update read `other`.
- The report timer has an early tick a minute after boot, so a board an update just restarted reports without waiting ten minutes; tested, and a mutant without it fails.
- The two register tests reset the supervisor before the crash, so the restart timer is on its 1 s backoff and fires well inside the 3 s register even under load.

## Review 15
- The ten-minute report timer moved from server.js into engine/remote.js `startReportTimer()` (server.js calls it), and has a test: it fires on its own, passes a TTL under its interval, keeps firing after a throw and a rejection, and is unref'd. Mutants dropping the unref, dropping the rejection catch, or setting the TTL equal to the interval each fail it.

## Review 14
- switch-off, settings-unreadable and no-relay-address removed from CODES: nothing is sent while the switch is off or the settings are unreadable (fetchStanding returns first; the not-enrolled report needs `ok && on`), and RELAY() always has a default. `tunnel: off` stays in the vocabulary the coordinator accepts but is not sent today.
- New code coordinator-bad-answer for coordinator.rs's `the Kosmos+ answer is not JSON` / `has no ticket field` / `reading the Kosmos+ answer` (a captive portal or proxy on the ticket path), which read `other`.
- signinRegister's register-start clear is pinned by its own test, with a fake register that keeps the Mac's identity (the ordinary fake mints a new id, whose stopChild would hide the line); removing the line fails it.
- The unwanted-board test waits until the restart timer has fired (supervisorState `none`), not a fixed 2.5 s.
- The not-enrolled test's failure message names kosmos-relay macremote.rs says_not_enrolled(), which matches that prefix.
- **Ship order, decided:** the kosmos-relay reportonly-4277 PR merges and Kitty deploys it BEFORE this PR merges; stated as a hard gate in this PR's body and on the card. I merge both and own the Mac cut. Rejected: a mechanical gate (a coordinator capability signal the board waits for): a new protocol field for a window that ends at one deploy. Weakest premise: that the order is kept by the person merging; the cost if not is half-enrolled Macs reading as seen until the deploy.
- **Deferred, a follow-up:** a board whose settings file is corrupt sends nothing at all, so that way of going dark is invisible from our side. Reporting it needs a send path while `on` is unknown; filed as #4308.

## Review 13
- settings-unreadable, no-relay-address and cert-renewal now each have a verbatim test sentence (remote.js status() and session.rs).
- `said no` dropped from coordinator-refused: `Kosmos+ said no` comes only from the setup/signin CLI (setup.rs), never a status() sentence.
- remote.js notes that `restarts` is never reset (since process start), so tests read it as a delta.

## Review 12
- A board holding a key but not enrolled signs a standing call to report why, and the coordinator's standing handler refreshed `last_seen` for every signed call, so a Mac nobody can reach would read "Answering now" on the account page and count as seen in the admin summary. The coordinator now skips touch_mac when the report's error is `not-enrolled` (kosmos-relay branch reportonly-4277, a separate PR, with a test and a control). **Ship order: that coordinator change must be deployed before a Mac cut carries this board change.**
- `tunnel` no longer reads `crashed` for the tunnel's own in-process reconnects (graceful close, renewal): `restarting` is `crashed` only when the supervisor's process is not up, else `starting`. A board ON but not enrolled reads `stopped`, not `starting`, since it will never start.
- The register's start is uncounted by clearing restartPending at the register's own success, not in ensure(): a register that fails leaves the pending relaunch for the next tick, which counts it.
- binary-missing matches only status()'s spawn sentence (`could not be started`); the dead ENOENT/EACCES/subcommand alternatives are gone.
- (This line said switch-off and awaiting-sign-in were reachable; neither is: corrected in reviews 14 and 16.)
- The CODES order in this plan now follows the code.

## Review 11
- The three later coordinator patterns were dead: every coordinator sentence starts with `Kosmos+` and is taken by the anchored pair first. Removed; 
- The enrolment file list is one list: remote.js ENROL_FILES, which enrolled() reads; remote-report.js keeps its copy (so it loads without remote.js) and a remote.test.js test asserts the two are equal (an added-file mutant fails it).
- The register-overlap fix now has a test: a rename re-runs setup on an enrolled Mac while a crashed tunnel's restart timer fires inside it; reverting the fix makes it fail.
- A second stray stderr line in a mac-standing test silenced.

## Review 10
- heal is judged by the supervisor's PROCESS (remote.supervisorState: alive, waiting, none), not status(): status() reads `restarting` for the tunnel's own in-process reconnects too, so a routine reconnect after any relaunch read `relaunch-failed`, and a relaunched tunnel stuck dialling read `none` forever.
- A restart timer firing while a register is out no longer leaves the register's own start counted as a relaunch.
- `relay did not answer AUTH` (session.rs AUTH read timeout) is relay-unreachable, not relay-refused.
- `relay TLS handshake: invalid peer certificate` is its own code, relay-certificate.
- The coordinator's `Kosmos+` sentences are classified before the relay patterns, so a gateway page in a 5xx body cannot read as relay-dropped.
- The server report timer's TTL is 9 minutes under its 10-minute interval; with equal values every other tick was skipped (the refresh stamps its time after the fetch).

## Review 9
- A 5xx whose body parses as a refusal (coordinator.rs writes `Kosmos+ refused this Mac: ... (HTTP 503 on ...)`) read coordinator-refused; a 5xx is now taken out first as coordinator-unreachable, with a test.
- CODES order no longer carries the healthy sentences: a test asserts each healthy dialling sentence matches `starting` and no other pattern (a loosened relay-unreachable mutant fails it).
- mac-standing's home-directory assertion could not fail (the fixtures live under tmpdir); it now asserts the state dir path and its basename are absent (a path-leak mutant fails it).
- Nits: the unused `home` test parameter removed, a backwards assertion message fixed, a stray stderr line in one test silenced.

## Deferred (review 8), since resolved
- Resolved in review 15: the report timer is engine/remote.js startReportTimer(), which server.js calls, and remote.test.js tests it.

## Deferred (review 7)
- build() reads the settings once for `on`, and status() reads them again. Both are synchronous with no yield between, so they can only disagree if another process rewrites the file in that instant, and the cost is one report with a mismatched `on`.

## Deferred (review 6), since resolved
- Resolved in review 12: an in-process reconnect reads `starting` while the supervisor's process is up, and a half-enrolled board reads `stopped`.

## Weakest premise
A Mac whose key file is gone cannot report at all (nothing can sign for it). The coordinator's admin read shows how long ago each Mac was last seen next to its last report, so a Mac that stops reporting still stands out.
