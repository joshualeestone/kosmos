# heldwords-7208 review, round 3 (blind CTO lens)

Branch heldwords-7208 at aeb9239a92, against origin/main. Counts: 1 BLOCKER, 2 WARNING, 3 NIT.

The round 2 fixes are right in the function (dmHeldWords now reads the card the way limitReleased does), but the card
it is handed on the agent page is not the one the poll brings. That is finding 1, and it undoes most of round 2 in the
place the person actually reads these rows.

## [BLOCKER] 1. dmHeldAgent returns the card as it was when the agent was opened, not the polled one
web/index.html:78193 (`if (is(cur)) return cur;`)

CURRENT is assigned in openDetail (43986/44002) and refreshAvatar (40291, only after a picture upload or removal). The
5 s poll replaces LAST with fresh cards (25666) and paints the pill, the busy line and the thread from
`fresh = data.agents.find(...)` (25774 on), but never reassigns CURRENT ("openDetail runs only on a real agent open,
never on the poll", 43982). dmHeldAgent checks CURRENT first, and in the DM thread DM_ROWS_OF always equals
CURRENT.sessionName, so the CURRENT arm always wins and the held row reads a card frozen at open time. The project
member panel has the same problem whenever CURRENT is that member (CURRENT survives closing the detail panel).

Measured (scratch probe, real page over file:// with fetch stubbed, driving the real `tick()` and `openDetail`):
- poll serves April idle, openDetail('april'), a usage-held row: "April is back. This goes through in a minute or so."
- next poll serves April `rate_limited` with limitUntil two hours ahead, thread repainted: LAST[0].state is
  `rate_limited`, CURRENT.state is still `idle`, `CURRENT === LAST[0]` is false, and the row still says
  "April is back. This goes through in a minute or so."
- CONTROL, reopen the agent: "April is out of usage until 2:26 PM CDT. This delivers when April is back."

Failure: Josh is mid-conversation with Dario (page open, Dario idle). Dario hits his weekly limit; Josh's next message is
held. The pill beside the thread says Dario is out of usage until Thursday; the row under Josh's message says "Dario is
back. This goes through in a minute or so." for as long as the page stays open. The same staleness makes a stopped,
signed-out or asking agent read as whatever it was at open time. The plan's own weakest premise ("the card is the same
5 s poll the card itself shows") is the false one.

Why the tests miss it: render-dm-held-5805.js sets CURRENT directly (lines 84, 125) and never puts a different card
in LAST; the unit case for dmHeldAgent passes CURRENT and LAST as independent fixtures, so "which one is fresh" is
never asked.

Fix: prefer the poll. `return list.find(is) || (is(cur) ? cur : null);` (or look up `fresh` by session from LAST and
use CURRENT only when LAST has no card for it). Add a browser case: CURRENT a stale idle card, LAST the same session
`rate_limited`, the row must say out of usage; and the reverse (stale `rate_limited`, fresh idle) must say back.

## [WARNING] 2. A held send now tells a screen reader nothing, and a searching person sees nothing at all
web/index.html:43214 (`line = '';` in sendTalk's held arm)

The line under the box (#d-say-msg) is the alert region; the row is not announced. Before this branch the held arm
wrote the reason there. Now it writes nothing and makes no dmReplyAnnounce call, unlike the retryable arm 20 lines
below, which also writes '' but announces "Message failed to deliver.".

Measured (scratch probe, real sendTalk, board answers held):
- no search: line "", box "", quiet announcer heard ["Sending…", ""]; one held row visible. A screen reader user hears
  "Sending…" and then silence for a message that was not delivered.
- with a search active ("ready", which the new message does not match): line "", box "", nothing announced, 0 held rows
  visible. The words left the box and are shown nowhere, and nothing says why.
- CONTROL, origin/main's page, same two runs: the line reads "Held: April is out of usage until 3:28 PM CDT. Kosmos
  sends it after the reset. To send it now, use Send now anyway on the message." in both.

Josh's ask was "said once, not again under the composer" for a sighted reader who can see the row. Neither case above
can see the row.

Fix: in the held arm, `if (!flightMoved()) dmReplyAnnounce(<the row's words>)` (the quiet region, so it is heard once
and not drawn twice); and when TALK_QUERY is non-empty, keep one visible line ("Kept to send later. Clear the search
to see it.", the dmNotSentWhere pattern). One browser case for each.

## [WARNING] 3. A sign-in hold still says "signed out" after the server released it
web/index.html:78157 (`const signedOut = (d.heldFor === 'signin' && !released) || st === 'auth_failed';`)

signinHeldVerdict (engine/chat.js:2911) holds only while the card reads a REPORTED auth_failed, and
limitQueueReleased (2946) releases the queue the moment it does not ("signed in again, or restarted"). The page
treats a sign-in hold as signed out for every card except idle or blocked-with-idle-screen. Measured (probe calling the
page's dmHeldWords): signin hold with card `stopped` reads "April is signed out. This delivers once April is signed in
again."; with `working`, `needs_you`, `rate_limited`, `blocked` the same. Yet `{ state: 'idle', running: false }`
reads "April is not running." So the round 2 fix (a stopped card outranks a usage hold) was not carried to the sign-in
hold, and one agent gives two answers depending on which stopped shape its card has.

Failure (server path reasoned from source): a Codex agent's sign-in lapses, Josh's message is held, then the agent is
stopped. The server releases the queue (card no longer auth_failed), the sweep tries, cannot type into a stopped
agent, and onStuck (engine/limitqueue.js:250-254) records why. The row: "April is signed out. This delivers once April
is signed in again. Kosmos tried to send it and could not: ...". The card says stopped; signing in does nothing;
starting the agent is what delivers it.

Fix: a sign-in hold reads signed out only while the card agrees or cannot say:
`signedOut = st === 'auth_failed' || (d.heldFor === 'signin' && (!a || st === 'unknown' || st === 'restarting' || ...))`,
so a known stopped card falls to "not running", a working one to the neutral "back" line. One unit case for stopped.

## [NIT] 4. "Waiting on an answer from you" is said for a needs_you card the sweep types straight into
web/index.html:78175

The server holds a swept message only for a menu on screen (menuHeldVerdict, engine/chat.js:2847, via
claudeMenuRefusal), not for needs_you as such. A reported question asked in prose (a Stop hook's needs_you with no
menu) gets the held message typed on the next sweep, and that message may well be the answer. For up to a minute the
row says "This delivers once that is answered." Reasoned from source, one sweep at most. Fix: say the asking line only
when the card shows a menu (or say "This delivers once the question on its screen is answered."), else fall through.

## [NIT] 5. A usage hold to a card that reads working still says "out of usage until <time>"
web/index.html:78158-78161 (`out` for any usage hold that is not released, stopped or asking)

Measured: usage hold, card `{ state: 'working' }`: "April is out of usage until 1:27 PM CDT. This delivers when April
is back." limitHeldVerdict holds only a `rate_limited` card, so limitQueueReleased is already true and the sweep types
it within the minute. One sweep at most, so NIT; the neutral line ("April is back. This goes through when Kosmos can
type it.") would be true here.

## [NIT] 6. A literal em dash is still in a committed plan file
.claude/plans/heldwords-7208-review2.md:96 (it quotes review1's old line, "entities, <the u2014 character> escape", with the character itself)

Round 2's NIT 7 removed it from review1, but review2 carries it in its quotation. Fix: write it as "the u2014 escape".

## Checked and found clean

- Measured: web.inputkeep-6774.test.js + web.limitdm-5805.test.js: 11 tests, 11 pass, rc=0.
- Measured: docs/browser-checks/render-dm-held-5805.js, HEADED=0: rc=0, 15 PASS, "all passed".
- Measured: dmHeldWords from the branch page over 8 deliveries (usage future/past, signin, input, behind, behind+input,
  usage+stuck, signin+stuck) x 13 cards (none, idle, working, stopped, needs_you, rate_limited, auth_failed,
  restarting, unknown, idle+remembered, blocked+screenState idle, blocked, idle+running false). Round 2 holds where aimed:
  "in a minute or so" only for idle or blocked-with-idle-screen and never with stuck; needs_you gets its own line;
  stopped outranks a usage hold for every hold kind; a remembered screen keeps the hold's words; unknown, restarting and
  blocked keep them too. Findings 3 and 5 are the only rows I found untrue.
- Reasoned: `released` mirrors limitReleased (engine/chat.js:2935) except limitable() (Claude runner, isNamedOurs).
  No usage hold exists for a non-Claude card (limitHeldVerdict needs limitable), so the gap only touches sign-in holds,
  covered in finding 3. The card does carry screenState (status.js:9465) and screenRead (stateReadFields spread, 9429).
- Reasoned: DM_ROWS_OF is always the thread's own agent when dmRow paints. dmRow's one caller is paintTalkThread
  (42349), which sets DM_ROWS_OF = CURRENT.sessionName first, and every caller of paintTalkThread guards CURRENT ===
  the thread's session: paintTalk (42536), earlierRepaint (42077), talkPaintPending (42971-42977), the search input
  (76895). It is never null when a row paints (CURRENT is checked first). The session is right; the card behind it is
  stale (finding 1).
- Reasoned: pjMsg gets body.agent.sessionName from the project thread route, the same value the panel heading uses
  (paintThread, 78425); a body without `agent` falls back to the name match, as before.
- Measured: em dash sweep on added lines (literal, three entities, two source escapes): 1 hit, finding 6; a planted
  control line hits 1.
