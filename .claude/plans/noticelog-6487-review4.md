# Blind CTO review, noticelog-6487, round 4

Reviewed: b3b0e87c27106a3325df5327ed02cff2607ced91
Counts: 0 BLOCKER, 0 WARNING, 3 NIT

## Findings

### [NIT] engine/phonenotify.js:498: the refused and unreachable lines carry no ref, so they cannot be paired with the "sent" line they undo

Failure scenario: two notices go out within a second; the coordinator answers 401 to one. board.log shows two `phonenotify: sent ... ref aaaaaa ...; the phone can ask for its words` lines and one `phonenotify: Kosmos+ answered 401 to a notification`. A reader explaining a plain notice cannot tell which ref was refused, which is exactly the question #6487 is meant to answer. The doc (docs/phone-notifications.md, the new paragraph) hedges this correctly ("refused, lost ..."), so nothing overclaims; it is a gap, not a lie. Same for the `could not reach Kosmos+` line at :504.

Fix: pass the ref into the send (or close over it) and append ` ref <ref>` to the 498 and 504 lines. The ref is already a hash, so it adds no time or session to the log.

### [NIT] engine/phonenotice.js:113: logName misses a few invisible and direction characters and can leave a lone surrogate

Measured: `logName('a؜b⁠c')` keeps U+061C (ARABIC LETTER MARK, a bidi mark) and U+2060 (WORD JOINER); `logName('x'.repeat(79) + '\u{1F600}')` ends in a lone `\ud83d`, which stderr writes as U+FFFD. The doc comment promises "the zero-width and direction marks" are blanked. Not exploitable for line injection (C0, C1, U+2028/2029 are all blanked, measured by the existing test), only display reordering, and only for a session name that is an existing row (server route) or the board's own event (send).

Fix: add `؜᠎⁠-⁤` to the class, and cut by code points (`Array.from(s).slice(0, 80).join('')`) rather than UTF-16 units.

### [NIT] server.js:7811: the route's logName call has no test with a hostile name, and "answered them" is written before the 200 is built

Failure scenario 1: someone drops the `pnotice.logName(...)` around `got.session` on the route; every route test uses plain names (`irma`, `vivi`, `guidebot`), so nothing goes red. The send side has the hostile-name test (engine.phonenotify-send-4163.test.js), the route side does not. Reachability is low (a session in a found row), so this is a NIT.

Failure scenario 2: the line says "answered them" before `safeRoster`, `ourCardByName` and `sendJson`; if any of those threw, the log would claim an answer the phone never got. Read only: `phonePermissionNow` and `store.avatarPath` are wrapped, `safeRoster` is a try, so this is theoretical today.

Fix: one route test with a session name holding `\n` and `‮` asserting a single clean line; optionally move the "answered them" write to just after the 200 `sendJson`.

## Checked and found clean

- wordsFor behaviour unchanged: every former `return null` maps to `{ got: null }` and the success path returns the same object. Read; the existing phonenotice and server.phonenotice-6487 suites pass (measured, 22/22).
- Route responses unchanged: same 404 condition (`!got || borrowedName(got.session)`), same body, same 200 shape. Read.
- No words in either log line: the sent line uses kind (gated by KINDS), idKind (lowercase letters only), a 6-hex hash, and logName(session); the asked line uses idKind, idRef, logName(got.session) and a fixed `why` vocabulary. Read; and measured by the tests asserting 'Logged words' and 'the words of the report' are absent.
- The id (time plus session) is never logged, only six characters of its sha256. Read. A 24-bit hash of a guessable id is brute-forceable, but it yields only the time and session the line already shows, so nothing secret leaks.
- Log injection from the caller-controlled `id` query: only idKind ([a-z]{1,20} or 'unknown') and the hash reach the log; the session is logged only when a real row was found. Read; idKind rejects measured in engine/phonenotice.test.js.
- No sent line when nothing was sent: the write is after the sender call inside the same try, so a synchronous throw skips it, and every early return precedes it. Measured by server.phonenotify-718's new test (50/50 pass) with its control arm.
- Pairing: the sent line hashes the id as sent (capped to 120 bytes), and the phone asks with that same id, so the refs match. Read.
- "cut to fit, so the phone's ask finds no words": for report:/reply: ids the fixed prefix is 32 bytes, so a 120-byte cut always lands in the session, never the time; the cut session names no real agent with a row at that exact time. capBytes adds no ellipsis but the claim still holds in practice. Read; the CONTROL in the cut test proves the cut happened (measured, passes).
- crashloop:, stuckterminal:, ownbounds:, built: ids log "cannot ask", matching the doc's statement that only report, reply and post are asked about. Read (server.js call sites 17876 to 26940).
- explain's why values match the doc's list (unaskable, malformed-id, no-report-words, no-reply, no-post, mask-failed, plus the route's borrowed-name). Read.
- Doc removal of "posts" from the never-asked list matches #7032 (posts are asked). Read.
- Tests can fail: each new assertion has a control arm (borrowed vs tied, threw vs sent, cut CONTROL, mask-throw vs no mask). Read; not mutation-tested beyond the reading.
- Full suite not run (out of scope per brief); targeted files only.
