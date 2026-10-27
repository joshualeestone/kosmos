# noticelog-6487 blind review, round 1 (CTO lens)

Reviewed: e3e27cc6cb6bd508b984971e82fff065cec4a57b
Counts: 0 BLOCKER, 2 WARNING, 3 NIT

## Findings

### [WARNING] engine/phonenotify.js:540: the sent line judges the id the board meant to send, not the id it actually sent

`askable` and `idKind` read `event.id`, but the push carries `payload().id`, which is `cap(id, CAPS.id)`: cut to 120
UTF-8 bytes. A `report:<at>:<session>` id spends 32 bytes before the session, so any session over 88 bytes (or about
30 characters of a 3-byte script) is cut.

Failure scenario (measured): a 95-character session gives a 127-byte id; the payload carries 120 bytes;
`parseId` of the cut id still succeeds with a shortened session. The phone asks, the board answers
`no-report-words`, and the sent line says "the phone can ask for its words". The log points the reader at "no report
at that time" when the real cause is the truncated id, which is exactly the kind of misattribution this change exists
to remove. Weakest premise: whether session names that long occur in practice; the byte cap makes non-ASCII names the
likely route.

Fix: build the payload first and compute `askable` / `idKind` from `JSON.parse(body).id` (or keep the capped id from
`payload`), and when the capped id differs from `event.id` say so in the line (for example "; its id was cut, so the
phone cannot find its words"). Better still, a separate card for the truncation itself, since it makes such notices
plain regardless of logging.

### [WARNING] docs/phone-notifications.md:132: "a sent line with no ask after it means the phone never reached the computer" over-claims

The sent line is written before `defaultSend` runs, and the send can still fail afterwards: `defaultSend` then logs
`phonenotify: could not reach Kosmos+: ...` or `phonenotify: Kosmos+ answered <status> to a notification`. In that
case the push never reached the phone at all, yet the doc tells the reader the phone failed to reach the computer.
A missing ask also follows a phone build without the extension, an Android phone or the browser (which never ask,
per the paragraph just above), and a notice the person never received.

Failure scenario: the coordinator returns 403; board.log shows the sent line, then the 403 line, then no ask. A
reader following the doc concludes "the phone could not reach my computer over Kosmos+ remote" and debugs the wrong
link.

Fix: in the doc, say a sent line followed by a `could not reach Kosmos+` or `answered <status>` line means the push
itself failed; otherwise no ask means the phone did not ask or could not reach the computer (Android and the browser
never ask). Optionally soften the code wording from "sent" to "sending" so the line does not claim delivery.

### [NIT] engine/phonenotice.js:115: `unaskable` conflates "a kind the board never answers" with "a malformed id of an askable kind"

`explain` returns `unaskable` whenever `parseId` fails, so `post:abc`, an over-300-character id, or `report:` with an
unparseable time is logged as "asked about a post (or report) notice; answered nothing (unaskable)". Seen in the 7032
test run: four lines reading "asked about a post notice; answered nothing (unaskable)". The doc defines `unaskable` by
example as `crashloop:`, so a reader sees a contradiction (a post is askable).

Fix: return `malformed-id` when `idKind(id)` is `report`, `reply` or `post` but `parseId` fails, `unaskable` otherwise;
add it to the doc's list.

### [NIT] engine/phonenotify.js:541: "for <agent>" prints the session, and nothing when there is none

The line prints `event.session`; a room post's session is `postSender.card.sessionName || null` (server.js:18475), so
a card without one logs "sent posted (post) for ; the phone ...". The doc calls the field `<agent>`.

Fix: fall back to `event.agent` (same control-character blanking), or print "for an unnamed agent"; make the doc say
which name it is.

### [NIT] engine/phonenotify.js:466: `setLog` is exported but nothing uses it

The new seam has no caller in any test (the tests capture stderr in a child or by patching `process.stderr.write`).
Either use it in a test or drop it and call `process.stderr.write` directly, as `defaultSend` does.

## Checked and found clean

- Words never reach either log line: the sent line carries `event.kind` (one of four fixed KINDS), `idKind` (1 to 20
  lowercase letters) and the session; the ask line carries `idKind` of the query id and `got.session`. Read, and
  measured by the tests' "words not in log" assertions (both pass and both can fail: the event and report carry the
  words in reach).
- The id's time does not reach the log: `idKind` stops at the first colon. Read; 4163 test asserts `2026-09-27` absent
  and the id contains it, so the assertion can fail.
- Log injection: session blanked of `\x00-\x1f\x7f` in both lines; `idKind` is `[a-z]{1,20}`; `why` is one of a fixed
  set; `event.kind` is gated by KINDS. logstamp splits only on `\n`, so U+2028/U+0085 cannot forge a stamped line.
  Read; the `le\no` test measures the blanking.
- `wordsFor` behaviour unchanged: it is exactly `explain(...).got`, every former `return null` maps to `got: null`.
  Read, and the existing phonenotice / 7032 / 7017 route tests pass unchanged.
- Route responses unchanged: same 404 condition (`!got || borrowedName(got.session)`), borrowedName only called when
  got is non-null, as before. Read and measured (route tests pass).
- No sent line when nothing is sent by gating: the line is after every gate, the cooldown, and the test-context
  refusal. Read. (It is before the async send outcome, see the WARNING on the doc.)
- `log`'s default resolves `process.stderr.write` at call time, so the existing stderr-patching test in
  server.phonenotify-718.test.js still works. Read.
- The phone only asks for `report:` / `reply:` / `post:` prefixes (ios/KosmosNotice/NoticeLogic.swift:95), which
  matches `parseId`'s set, so "the phone cannot ask" on crashloop/stuckterminal/ownbounds/built ids is true. Read.
- Targeted tests: engine/phonenotice.test.js, engine.phonenotify-send-4163.test.js, server.phonenotice-6487.test.js,
  server.phonenotice-post-7032.test.js, server.phonenotice-permission-7017.test.js: 33 pass, 0 fail, rc 0. Measured.
- Truncation scenario in the first WARNING: measured with `payload()` and `parseId` in node (127-byte id cut to 120,
  still parses).
