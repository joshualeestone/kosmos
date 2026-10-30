# Blind CTO-lens review: noticelog-6487 (plain-notice explanation in board.log)

Reviewed: 90f28d24f69971679a92285259797fb4bc15e004
Counts: 0 BLOCKER, 1 WARNING, 5 NIT

## Findings

### [WARNING] docs/phone-notifications.md:133: the "no ask after a sent line" rule misdiagnoses every unaskable send
The doc says a sent line with no ask after it (and no could-not-reach / answered line) means an iPhone with the
extension never reached the computer. The same doc (lines above) says crash, stuck, helper and the other rows are
never asked about, and the code writes a sent line for those too (`crashloop:`, `stuckterminal:`, `ownbounds:`,
`built:` ids all log `the phone cannot ask for its words, so it shows plain`).
Failure scenario: a person sees `phonenotify: sent needs_you (crashloop) for leo; the phone cannot ask ...` with no
phonenotice line after it, applies the doc's rule, and concludes the iPhone extension or the remote route is broken,
when the phone was never meant to ask. The same misreading applies to an id-cut send if the phone does ask (it then
logs no-report-words, which is fine) but the rule as written covers all sent lines.
Fix: scope the sentence to sent lines ending `the phone can ask for its words`, e.g. "A sent line that says the phone
can ask, with no ask after it ...".

### [NIT] engine/phonenotify.js:543: "sent" is written before the send, so a synchronous throw logs a send that never left
The line is written at 543 and the send at 544; both sit in one try whose catch is silent. `defaultSend` calls
`http.request`, which throws synchronously on an invalid header value. Measured: `http.request({headers:{'x-t':'a\nb'}})`
throws `ERR_INVALID_CHAR`. The token is shape-checked at mint (`TOKEN_SHAPE`), so this needs a hand-edited or
corrupted phone-notify.json, hence NIT. Result: `phonenotify: sent ...; the phone can ask` with no error line and
nothing sent, and the doc's rule then blames the iPhone.
Fix: call the sender first, then write the line (or write it in a `finally` only when the call returned), so a throw
leaves no "sent" line.

### [NIT] engine/phonenotify.js:542 and server.js:7811: the name sanitiser strips C0 and DEL only
`/[\x00-\x1f\x7f]/` leaves C1 controls (U+0080 to U+009F, including CSI U+009B) and U+2028/U+2029 in the name.
Measured: the regex does not match ` ` or `\x9b`. board.log is stamped on `\n` only (engine/logstamp.js), so
this cannot forge a stamped line, but a terminal `tail -f board.log` will interpret CSI sequences from an agent's
session name, and tools that split on U+2028 see a break. Session names are agent-chosen strings on the send side
and query-string-chosen on the ask side (report:/reply: ids put the session straight from the URL into the line).
Fix: widen to `/[\x00-\x1f\x7f-\x9f  ]/g` in one shared helper used by both lines, and cap the length
(the ask side can carry up to ~290 characters of attacker-chosen session).

### [NIT] server.js:7810: "the phone asked about a unknown notice" for any caller, any id
Any GET to /api/phone/notice writes a line beginning "the phone asked", including the board's own screen, a test, or
a request with no id (idKind -> `unknown`, giving "a unknown notice ... (unaskable)"). The article is wrong for
`unknown` (and would be for any vowel kind), and "the phone" asserts a caller the route cannot know. Each request
also adds one log line, so a looping caller grows board.log at request rate.
Fix: "an ask about a <kind> notice" (or "notice asked about: <kind>"), and consider logging only when an id was given.

### [NIT] server.phonenotice-6487.test.js:130 / engine.phonenotify-send-4163.test.js: the borrowed-name and post branches of the new log lines are untested
The server test pins report-with-words, no-report-words and unaskable. Nothing pins the `borrowed-name` branch (the
only branch where the line names an agent AND answers nothing) or a `post` ask (where the name comes from the room
log, not the id). A regression that printed `why` (null) instead of `borrowed-name` would read
`answered nothing (null)` and pass every test.
Fix: add one borrowed-name ask and one post ask to the exact-lines assertion.

### [NIT] docs/phone-notifications.md:130: `for <agent>` is the session name, not the agent's shown name
The sent line prints `event.session` (the tmux/session name), and after a rename the ask line prints `got.session`
from the id. A reader looking for the shown name (what the lock screen says) may not find it.
Fix: write `for <session>` in the doc, or say "the agent's session name".

## Checked and found clean

- Words never reach the log: read. Both lines are built only from `event.kind` (gated by KINDS), `idKind()` (lowercase
  `[a-z]{1,20}` prefix or `unknown`), the session name, fixed phrases and the `why` enum. Measured by the touched tests:
  the 4163 test asserts the report words and the id's time are absent; the 6487 server test asserts the words are absent.
- Secrets/token in the log: read. The token is only in the headers object; nothing in the new lines references `s.token`
  or `body`.
- Newline log injection: measured via the `le\no` test (passes, renders `le o`) and read for the ask side (same regex on
  `got.session`). idKind cannot carry a newline by construction. See NIT above for C1/U+2028.
- wordsFor behaviour unchanged: read (`explain` returns null in exactly the old null paths; wordsFor returns `.got`), and
  measured: engine/phonenotice.test.js including the new control asserting wordsFor equals explain().got.
- Route responses unchanged: read (404 on `!got || borrowed`, same body; 200 path untouched), and measured:
  server.phonenotice-6487.test.js and server.phonenotice-permission-7017.test.js pass.
- No line written when nothing is sent, for the gating paths: read. The line sits after every early return (gate,
  kinds, switch, plusLive, cooldown). The one exception is a synchronous throw from the sender (NIT above).
- Cut-id detection: read and measured. `cap(event.id, CAPS.id)` is the same expression `payload()` uses, so `sentId` is
  the id the phone receives; the 4163 test's control confirms the id really is cut. A cut always shortens the trailing
  session, so the ask cannot match words; the claim in the line holds.
- `explain` reasons: measured, every `why` value is asserted in engine/phonenotice.test.js; the malformed-id vs
  unaskable split keys on idKind, which is correct for over-300-character ids too (read).
- Other tests that drive phonenotify.happened (send-gate, 718, rename-push 4421, stuckterminal, installid-senders,
  reachable): measured, 121 tests across 10 files pass, exit 0. None asserted an empty stderr from a send.
- Doc vs code reason list: read; the seven reasons in the doc match the enum plus `borrowed-name`.
