# Blind CTO-lens review 3: noticelog-6487 (board-log lines for plain phone notices)

Reviewed: 8d622e33c881b16d894a586c91e8461f156027f4
Counts: 0 BLOCKER, 1 WARNING, 4 NIT

## Findings

### [WARNING] docs/phone-notifications.md:131-135: the "never reached the computer" reading overclaims what the log can show

The doc says a `sent ... the phone can ask for its words` line with no ask after it, and no `could not reach Kosmos+` or
`answered <status>` line beside it, "means an iPhone with the extension never reached the computer". The code cannot
support that conclusion:
- engine/phonenotify.js:545 writes the `sent` line synchronously, right after `defaultSend` hands the request to
  `http.request`, before any connection or answer. "sent" means dispatched, not delivered.
- The absence of an error line only means the coordinator answered 2xx. A 2xx says the coordinator took it, not that
  any phone got a push: no iPhone registered for this install, Apple dropping or delaying it, the phone switched off or
  with notifications muted, or the coordinator's own gating all leave exactly the same log.
- The two failure lines in `defaultSend` (phonenotify.js:498, :504) carry no kind, id kind or session, so with two
  sends close together a person cannot tell which `sent` line an `answered 401` belongs to; "beside it" is not
  decidable from the log.

Failure scenario: the person's iPhone was never enrolled for pushes on this install. Every notice logs
`sent ... the phone can ask for its words`, no error, no ask. Following the doc, whoever reads the log goes looking
for a Kosmos+ remote / sign-in fault between phone and computer, when the push never reached a phone at all.

Fix: reword to what the log proves: "the coordinator took the notification, and no phone asked for its words: either
the push did not reach an iPhone with the extension, or that iPhone could not reach this computer". Optionally give the
two `defaultSend` failure lines the same `<kind> (<id kind>) for <session>` tail so they pair with their `sent` line.

### [NIT] engine/phonenotify.js:545 and server.js:7811: no key pairs an ask line with its sent line

Both lines carry only kind, id kind and session (the test at engine.phonenotify-send-4163.test.js asserts the id's time
is absent). Two needs_you notices for the same agent a few seconds apart (or a `replied` storm, which has no cooldown)
give two `sent` lines and one `asked` line, and the reader cannot tell which notice went plain. The log timestamp is
the only correlator and the ask can lag the send by seconds.

Fix: log a non-word correlator, for example the first 8 hex of a hash of the id as sent, on both lines. It names no
words and no time. Alternatively accept and say in the doc that pairing is by time and agent only.

### [NIT] docs/phone-notifications.md:126-127: the paragraph the new text sits under says posts are never asked

"Every other row of Sent today (crash, stuck, helper, posts, work ready) is not asked about" (pre-existing) contradicts
the #7032 paragraph above it and the new log line, which writes `sent posted (post); the phone can ask for its words`
for a room post. A reader using the new paragraph to explain a plain room-post notice reads two answers. Fix: drop
"posts" from that list, or say which kind of post row it means.

### [NIT] server.phonenotice-6487.test.js:130-151: the borrowed-name and malformed-id route lines are not asserted

The new route test asserts four outcomes (answered, no-report-words, unaskable, no-post). `borrowed-name` is the one
reason computed only in server.js (not in `explain`), so no unit test covers its log text; it is only printed, unasserted,
by the existing stranger's-pane test (measured: `answered nothing (borrowed-name), so it shows plain` appears in that
test's output). A refactor that logged `answered them` for a borrowed name would pass every test. `malformed-id` via the
route is likewise unasserted (covered in the unit test only). Fix: capture the line in the stranger's-pane test, and add
`report:not-a-time:irma` to the new test's list.

### [NIT] engine/phonenotice.js:111-113: logName leaves bidi and zero-width controls in

`logName` blanks C0, C1, DEL, U+2028 and U+2029, which covers terminal escapes and line breaks (measured by the 4163
test's `le\no\u009b ` case). It leaves U+202A-U+202E, U+2066-U+2069 and zero-width characters, so a session name
holding a right-to-left override can make a tailed `phonenotify:` line render reordered, for example with the
`can ask` tail visually swapped. Low impact (session names are tmux names a person or agent chose, and nothing acts on
these lines), and no line break or escape gets through. Fix: add `​-‏‪-‮⁦-⁩` to the class.

## Checked and found clean

- Words never reach the log: measured. `explain` result's `text` is never concatenated into either line (read both
  writes); the route test asserts the report's words are absent from the captured lines; the 4163 child-process test
  asserts the report's words and the id's time are absent from stderr. All 21 tests in the three touched engine/route
  files pass, and all 50 in server.phonenotify-718.test.js pass (measured, rc=0).
- No secret reaches the log: read. Neither line touches the token, notifyId, payload or URL; the mask-failed path
  returns before any text is kept.
- Log injection from agent- or caller-controlled strings: read and partly measured. `idKind` admits only `[a-z]{1,20}`
  before the first colon, else `unknown` (unit-tested with uppercase, space, over-length, null, number). `event.kind` is
  gated by `KINDS.has`. The session is logged only through `logName`, and in the route only when `got` is non-null, so a
  caller's arbitrary id never puts its session text in the log. Control-character blanking measured in the 4163 test.
- wordsFor behaviour unchanged: read. Every `return null` in the old body maps to `{ got: null, why }` and the words
  path to `{ got: out }`; `wordsFor` returns `.got`. The existing wordsFor tests pass unchanged (measured).
- Route responses unchanged: read. Same 404 condition (`!got || borrowedName(got.session)`), borrowedName now evaluated
  once instead of inside the condition, same 200 body. The new stderr write uses only strings and cannot throw on these
  inputs.
- A sent line when nothing was sent: read and measured. The line is written after the sender call inside the same try,
  so a throwing sender logs nothing (server.phonenotify-718 test with a throwing then working sender, which can fail).
  Every early return (off, no token, sub-switch off, Kosmos+ not live, cooldown) precedes it. Caveat in the WARNING:
  "sent" means dispatched, not answered.
- The "cut to fit" judgement: read and measured. It judges the id as capped by the same `cap(event.id, CAPS.id)`
  `payload` uses, so it matches what the phone asks with; a report/reply id prefix is about 31 bytes so the 120-byte
  cut always lands in the session, and the cut session finds no report file, as the line says. The test carries a
  control that the id really was cut.
- Doc vs code reason list: read. The seven reasons in the doc (unaskable, malformed-id, no-report-words, no-reply,
  no-post, mask-failed, borrowed-name) are exactly the values `explain` and the route can produce. The doc's line
  shapes match the code's.
- Circular require: read. phonenotice.js requires only `node:fs` at load (selfreport, chat, messages are default
  parameters), so phonenotify requiring it inside `happened` adds no cycle.
- Tests can fail: read. Each new assertion pins exact text or an exact list, and the cut and throwing-sender tests carry
  controls that would fail if the setup did not exercise the path.
