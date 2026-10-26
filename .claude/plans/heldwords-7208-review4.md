# heldwords-7208 review, round 4 (blind CTO lens)

Branch heldwords-7208 at 63a9902e85, against origin/main. Counts: 0 BLOCKER, 1 WARNING, 2 NIT.

The round 3 fixes hold: dmHeldAgent now reads the polled card, a card that knows decides, and the held send is heard
once for the right agent. The one new problem is the line round 3 added under the box for a search.

## [WARNING] 1. "Clear the search to see it." is said when the row is in sight, and stays after the search is cleared
web/index.html:43216 (`line = TALK_QUERY.trim() ? 'Your message is kept to send later. Clear the search to see it.' : '';`)

The line is chosen from "a search is active", not from "the row is hidden", and nothing clears it when the search
changes. The page already has the precedent for both halves: the search input handler (76893-76895) clears "That
message is hidden by your search." the moment the query changes, and jumpToOwnSend/talkFilterRows know whether the
row is drawn.

Measured (scratch probe, the branch page over file:// with fetch stubbed so a held send is appended to the thread,
driving the real sendTalk and the real search input event):
- search "zzz" (no match), held send "alpha note": line "Your message is kept to send later. Clear the search to see
  it.", held rows visible: none. Correct.
- then clear the search box (input event): the row "alpha note ... April is out of usage until 3:44 PM CDT." is now
  visible AND the line under the box still says "Clear the search to see it."
- search "bravo", held send "bravo note" (the message matches): the row is visible with its words, and the line under
  the box says "Clear the search to see it."

Failure: Josh searches his chat with April for "invoice", types "send the invoice tonight" and presses Send while she
is out of usage. The row appears right there under his search, with its reason, and the line under the box tells him
to clear the search to see a message he is looking at. If he clears the search, the instruction stays under the box
beside the row until his next send. This is the "said again under the composer" shape kosmos#7208 removed, now in
the alert region (role=alert, so it is also read out as an instruction that is not true).

Fix: (a) decide on the drawn row, not the query: after paintTalk, or from `talkFilterRows([kept row], name,
TALK_QUERY).length === 0`, say the line only when the kept row is filtered out; (b) in the search input handler, clear
it as the #4256 line is cleared: `if (said && said.textContent === 'Your message is kept to send later. Clear the
search to see it.') said.textContent = '';`. Browser cases: a matching search draws no line; clearing a non-matching
search empties the line. (dmNotSentWhere at 42984 has the same "query, not row" shape, but it is pre-existing and
out of this card.)

## [NIT] 2. A sign-in hold to a card now out of usage names the sign-in's one-minute relook as the reset time
web/index.html:78174 (`const until = soon(cardAt > now ? cardAt : heldAt);`)

Round 3 sends a sign-in hold on a `rate_limited` card to the "out of usage" line. When that card has no future
limitUntil, the time comes from d.heldUntil, and for a sign-in hold heldUntil is not a reset: signinHeldVerdict sets
it to send time + LIMIT_RELOOK_MS (engine/chat.js:2920), and the thread record copies it once (chat.js:4397).

Measured (dmHeldWords on the branch page): `{ heldFor: 'signin', heldUntil: now+50s }` with card `{ state:
'rate_limited' }` reads "April is out of usage until 12:44 PM CDT. This delivers when April is back.", a time under a
minute away that is not when she is back. It drops to "out of usage." once that minute passes. The usage-hold relook
arm (limitHeldVerdict after the printed reset, heldUntil = now + a minute, card limitUntil past) gives the same
"until 12:44 PM" (measured too), but that one is pre-existing on main ("Held: ... until 12:44").

Fix: for a sign-in hold never take a time from heldUntil: `const until = soon(cardAt > now ? cardAt : (d.heldFor ===
'signin' ? NaN : heldAt));`. One unit case. (The usage relook arm would need the record to carry limitReset; not this
card.)

## [NIT] 3. The "unsure" list names two states the board never emits and treats one it does emit as unknowing
web/index.html:78161 (`['unknown', 'stale', 'connection_lost', 'error', 'restarting']`)

engine/status.js STATE (247-306) is: working, needs_you, rate_limited, auth_failed, connection_lost, idle, stopped,
restarting, blocked, unknown. 'stale' and 'error' are not card states (grep of status.js: no `stale:` state, no
STATE.ERROR; the page's other 'stale'/'error' are a sync record's and the ask-devices state, unrelated), so they are
dead entries that read as coverage. connection_lost is a confident screen reading (status.js rule 3b, "its screen
shows it lost its connection"), and on it the server has released both holds: signinHeldVerdict needs auth_failed,
limitHeldVerdict needs rate_limited, so limitQueueReleased is true.

Measured: signin hold + `{ state: 'connection_lost' }` reads "April is signed out. This delivers once April is signed in
again."; usage hold (heldUntil past) + connection_lost reads "April is out of usage. This delivers when April is back."
Reasoned: neither signing in nor a reset is what delivers it; the connection coming back (the #3410 self-heal) is.
Short-lived and rare, so NIT.

Fix: drop 'stale' and 'error'; either move connection_lost out of `unsure` (it then reads the neutral "X is back. This
goes through when Kosmos can type it.") or give it its own line ("X lost its connection. This delivers when it is
back."). Keep restarting in `unsure`: a restart is one of the two ways the server releases a sign-in hold, and the
state is transient.

## Checked and found clean

- Measured: web.inputkeep-6774.test.js + web.limitdm-5805.test.js: 11 tests, 11 pass, 0 fail, rc=0.
- Measured: docs/browser-checks/render-dm-held-5805.js, HEADED=0: rc=0, 18 PASS, "all passed" (includes round 3's
  stale-CURRENT case, the quiet-region announce, and the no-match search line).
- Round 3 BLOCKER fix, reasoned from source: dmHeldAgent returns `list.find(is) || (is(cur) ? cur : null)`, so the poll's
  card wins whenever LAST has the session; setThread compares the whole html shape (threadShape strips only time words
  and rings), so a held row whose words changed with the card is rewritten on the next paint. Callers: dmRow (by
  DM_ROWS_OF), pjVerdict via pjMsg (by body.agent.sessionName), sendTalk (by sentName). All pass the session.
- "unsure" against the server, reasoned from engine/chat.js 2858-2958: limitHeldVerdict holds only a limitable card in
  rate_limited; signinHeldVerdict only a non-Claude card in REPORTED auth_failed; limitReleased is idle, or blocked with
  screenState idle, never on a remembered screen (stateIsRemembered is exactly `screenRead === 'remembered'`, which is
  what the page tests). So for any card outside unsure the server has released the hold, and the page now says the
  neutral or "not running" line there. The one mismatch is connection_lost (NIT 3).
- Blocked with screenState rate_limited (a StopFailure limit report while the limit is on screen), reasoned: not a real
  card. status.js rule 3b keeps a scraped rate_limited over providerLimitReport (`!providerLimitReport(reported)`), so
  the card reads rate_limited and the page says out of usage.
- The announce, reasoned from sendTalk (43005 on): it runs only in the held arm, once per send, behind
  `!flightMoved()` (CURRENT.sessionName === sentName), with the card looked up by sentName, so it cannot speak for
  another agent and the poll does not repeat it (the thread #d-dmthread is not a live region; only #d-reply-say
  role=status and #d-say-msg role=alert are). The finally's 40 ms timer clears #d-reply-say only while it reads
  "Sending…", so it does not wipe the held words; a POST faster than 30 ms still ends on the held words (both
  dmReplyAnnounce timers fire in order).
- Measured: em dash sweep over added lines (literal, &mdash;, &#8212;, &#x2014;, —, \u{2014}): 0 hits; a planted
  control line hits 1.
- Measured: `git merge-tree --write-tree origin/main HEAD` rc=0 (origin/main is 20 commits ahead); none of those
  commits touch dmHeldWords, the sendTalk held arm, TALK_QUERY, #d-reply-say, or the chat.js/limitqueue.js verdicts
  (grep of the merge-base..origin/main diff: 0 hits).
