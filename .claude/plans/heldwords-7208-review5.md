# heldwords-7208 review, round 5 (blind CTO lens)

Branch heldwords-7208 at 66111a1d49, against origin/main. Counts: 0 BLOCKER, 1 WARNING, 2 NIT.

The round 4 fixes are in and mostly right: the sign-in hold no longer takes a time from heldUntil, "unsure" is the
board's own unknowing states, connection_lost has its own line, and the search input clears the kept line. The one
new problem is in how the search fix decides "hidden": it tests a made-up row whose sender is not the real row's.

## [WARNING] 1. The "is the kept row hidden" probe uses `from: 'you'`, but a person's row has no sender, so a search for "you" hides the row and says nothing
web/index.html:43218 (`talkFilterRows([{ from: 'you', text }], name, TALK_QUERY)`)

talkFilterRows matches a row by `dmWho(m.from, name)` or by its text. The person's own thread rows carry `from: null`
(engine/chat.js:4329-4330: "ABSENT MEANS THE OPERATOR"; only an agent's row has a session name there). For `from:
null`, dmWho falls to tskAgentName(null), which returns '', so the real row matches by text only. The probe row has
`from: 'you'`, so tskAgentName('you') returns 'you' and the probe ALSO matches any query that is a substring of
"you". The probe then says "visible" for a row the thread actually filters out.

Measured (scratch probe lifting the branch's dmWho, tskAgentName and talkFilterRows, CURRENT = april/April, text "send
the invoice tonight"):
- query "you": probe visible true, real row (`from: null`) visible false, line under the box: none
- query "yo": probe true, real row false, line: none
- query "zzz": both false, line: DM_KEPT_HIDDEN (correct)
- query "send": both true, line: none (correct)

Failure: Josh searches his chat with April for "you" (or "yo", "ou"), types "send the invoice tonight" and presses
Send while she is out of usage. The kept row is filtered out of the thread, the line under the box stays empty, and
the only trace is the one quiet-region announcement. That is the exact round 3 case (the row out of sight and nothing
on screen saying it is kept) the line exists for, now silently missed for any query inside the word "you". Also a
session literally named "you" would resolve to that agent's display name, a second, rarer miss.

Fix: probe with the record's own shape, `[{ from: null, text }]` (or omit `from`), so the probe and the painted row go
through the same dmWho path. Sturdier: decide from the drawn thread (after the poll paints, whether `#d-dmthread`
holds the kept row), as jumpToOwnSend does. Add a browser case: search "you", held send whose text lacks "you", the
line says DM_KEPT_HIDDEN; it goes red on 66111a1d49.

## [NIT] 2. "X lost its connection. This delivers when X is connected again." drops the message box when the box is also why it waits
web/index.html:78185

The `out` arm (78176-78181) adds "and its message box is clear" when the hold is for the box (`box`), but the new
connection_lost arm (and the older `stopped` arm, 78182) does not. For a row kept for the box (heldFor 'input', or
behind one) on a card that lost its connection, the sweep still waits for the box to read empty after reconnecting
(engine/chat.js inputHold, 2976-2980: text in the box is a hold on its own), so "delivers when X is connected again"
over-promises. Reasoned from source, not measured; short-lived state, so NIT.

Fix: reuse the out arm's shape: `after(box ? 'once ' + name + ' is connected again and its message box is clear' :
'when ' + name + ' is connected again')`, and the same for the stopped arm if wanted. One unit case.

## [NIT] 3. A literal em dash is committed in review4.md
.claude/plans/heldwords-7208-review4.md:98 (the spelling list "literal, &mdash;, &#8212;, &#x2014;, <the character>,
\u{2014}")

Round 2 and round 3 each removed an em dash quoted in an earlier review file; round 4's list of spellings carries the
character itself. Measured: a sweep of added lines in `git diff origin/main...HEAD` for the six spellings returns 1
hit, this line (a planted control line returned 1). Fix: write it as "the literal character" instead of pasting it.

## Checked and found clean

- Measured: `node --test web.inputkeep-6774.test.js web.limitdm-5805.test.js` (cwd the worktree): 11 tests, 11 pass,
  0 fail, rc=0.
- Measured: docs/browser-checks/render-dm-held-5805.js, HEADED=0: rc=0, 20 PASS lines, "all passed", "no page errors".
- Reasoned: sign-in hold time. `soon(cardAt > now ? cardAt : (d.heldFor === 'signin' ? NaN : heldAt))`; soon(NaN) is ''
  because `NaN > now` is false, so a sign-in hold on an out-of-usage card says a time only from a future card
  limitUntil. Correct.
- Reasoned: `unsure` is now no card, no state, a remembered screen, unknown or restarting, which matches engine/status.js
  STATE's unknowing states; no card field named `stale` exists in status.js (grep: 0 `stale:`), so dropping it loses
  nothing. connection_lost no longer falls into signedOut/out (both need unsure or a confident card state), and its
  arm sits before `behind`, so a queued row reads "This delivers after the messages ahead of it, when X is connected
  again." which is right.
- Reasoned: the search input handler (76894-76897) now clears DM_KEPT_HIDDEN as it clears #4256's line. It clears on
  any change of query, even one that still hides the row (search "zzz" then "zzzz"); that is the #4256 precedent and
  under-says rather than mis-says, so not raised.
- Reasoned: the held arm writes the line only behind `!flightMoved()` (line 43260), and TALK_QUERY is read after the
  await, so a search changed during the flight is the one judged; a later change is cleared by the handler.
- Measured: `git merge-tree --write-tree origin/main HEAD` rc=0.
- Not re-raised: rounds 1 to 4 findings, all taken, and the fixes read correctly apart from WARNING 1.
