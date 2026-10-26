# heldwords-7208 review, round 2 (blind CTO lens)

Branch heldwords-7208 at ea929002a2, against origin/main. Counts: 0 BLOCKER, 3 WARNING, 4 NIT.

The round 1 fixes hold where they were aimed (measured, see the bottom). The findings below are in the new "back" arm,
in where "not running" sits in the new order, and in the new name-based card lookup.

## [WARNING] 1. "X is back. This goes through in a minute or so." is said when nothing will go through in a minute
web/index.html:78158 (`back`) and 78178 (the final `else`)

`back` is true for any card that is not out, stopped, restarting or signed out, whatever its state. The server only
types a held message when no menu is on screen (chat.deliverAutomatic, engine/chat.js:2958-2960, holds on
menuHeldVerdict), and when the sweep fails it records `stuck` (engine/limitqueue.js:251-255).

Measured (scratch probe lifting dmHeldWords from the branch page, usage hold with heldUntil past or null):
- card `{ state: 'needs_you', running: true }`: "Dario is back. This goes through in a minute or so." The card beside
  it says Dario is waiting on an answer, and the sweep keeps holding the message until the person answers.
- the same row with `stuck: { because: 'its screen waits on a question.' }` and card idle: "Dario is back. This goes
  through in a minute or so. Kosmos tried to send it and could not: its screen waits on a question." The row
  contradicts itself, and keeps promising a minute every minute it fails.
- cards `unknown`, `error`, `connection_lost`, `stale`: the same "in a minute or so" promise from a card that says it
  does not know.

Failure: Josh's limited agent comes back, then asks a question before the sweep runs. His row says it goes through in a
minute; it does not, for as long as the question stays up.

Fix: make `back` mirror the server's release (chat.limitReleased, engine/chat.js:2935): only `a.state === 'idle'` (or
`blocked` with `screenState === 'idle'`), and never when `stuck` is set. For needs_you say why ("Dario is waiting on an
answer from you. This delivers once that is answered."), and for the rest fall back to a neutral line without a time
promise ("Dario is back. This goes through when Kosmos can type it."). One unit case for needs_you, one for stuck.

## [WARNING] 2. A usage hold to an agent that is now stopped still says "out of usage"
web/index.html:78160 (`out = ... (usageHold && !back)`), order at 78164-78172

`stopped` forces `back` false, and `out` then wins for any usage hold, so the "not running" arm is reachable only for a
box-kept or queued row. Measured (probe): usage hold, heldUntil past or null, card `{ state: 'stopped', running: false }`:
"Dario is out of usage. This delivers when Dario is back." With heldUntil in the future: "Dario is out of usage until
3:00 PM. This delivers when Dario is back." The same card with a box-kept row says "Dario is not running.", so one
agent's two held rows give two different reasons.

Failure: Dario hits his limit, Josh's message is held, then Dario is stopped (or crashes). The card says stopped; the
row says out of usage, and at the reset nothing is delivered because nothing is running. This is the round 1 finding 3
class (the card holds the real state and is not read), on the stopped side.

Fix: let a stopped card outrank a usage hold the card no longer shows: `out = !signedOut && (cardOut || (usageHold &&
!back && !stopped))`. Then a stopped agent reads "Dario is not running. This delivers when Dario is running again."
for every kind of hold. One unit case.

## [WARNING] 3. dmHeldAgent picks the wrong agent when two agents answer to the same name
web/index.html:78183-78191

The lookup is by name only: CURRENT if it answers to the name, else the first of LAST that does, and "answers" includes
`sessionName`. The project member panel (pjMsg, 78585) passes the member's display name (pjNameOf, 77930) and has the
session name in hand (`body.agent.sessionName`), but it is not passed down. Measured (probe lifting dmHeldAgent):
- two cards named "Gemini" (gemini rate_limited, gemini-2 idle), the panel for gemini-2, CURRENT null: returns
  `gemini`. With the open chat being gemini: returns `gemini` too (the CURRENT arm).
- card A `{ sessionName: 'raph', name: 'raph-old' }`, card B `{ sessionName: 'raph-2', name: 'raph' }`, the panel for
  B: returns A (A's session name equals B's display name).
- CONTROL, unique names: returns the right card.

Reachability (reasoned): #5957 refuses a NEW display name that clashes with another agent's display name or session
name (engine/agentnames.js), but nothing in this branch shows existing clashes were renamed; the case #5957 was filed on
was two live agents both shown as "Gemini". Names of one Latin letter are never refused (tooShort).

Failure: the box-kept row for gemini-2 says "Gemini is out of usage until 3:00 PM", borrowed from the other Gemini.

Fix: pass the session name down (pjVerdict(m, name, session): `thread.__lastSession` in paintTalkThread, and
`body.agent.sessionName` in pjMsg's caller) and match `a.sessionName === session` first; fall back to the name only
when no session is known, and drop `sessionName === name` from the name match when a session was given.

## [NIT] 4. A usage hold whose reset is still ahead ignores a card that is back
web/index.html:78158 (`!(heldAt > now)`)

The server releases a usage hold on the card, not on heldUntil (limitReleased: card idle). Measured: heldUntil one hour
ahead, card `{ state: 'idle', running: true }`: "Dario is out of usage until 3:00 PM." while the sweep types it within
the minute. The same shape for a signin hold: card idle and running after a fresh sign-in still says "signed out" until
the sweep sends it (limitQueueReleased clears on signinHeldVerdict, engine/chat.js:2948). Both last one sweep at most,
so NIT. Fix with finding 1: decide `back` by the card's release state, not by heldAt.

## [NIT] 5. The plan's "Built" section and the card's design shots describe the old words
.claude/plans/heldwords-7208.md:14-16; card comment "Design shots for review" (commit 07654428f2)

"Built" still says "Queued behind your earlier message to X." and "by the message's `to`". The card's design-shot
comment quotes the same old queued line, and the shots were taken at 07654428f2, before round 1. A design reviewer
reading them sees words that no longer ship. Fix: update "Built" in place, and re-take the shots (/design-shots) once
the loop converges.

## [NIT] 6. The browser check's last CONTROL tests a constant
docs/browser-checks/render-dm-held-5805.js (section 4, `chk(!/Held:|input box/.test(BOX + w), ...)`)

`BOX` is a fixed string and `w` is only the last (signin) row, so this cannot see an old word in the four rows before
it. Fix: collect every `w` into an array and test each. The check also only paints the DM thread (CURRENT); the project
panel path, where finding 3 lives, has no browser coverage.

## [NIT] 7. A literal em dash in a committed plan file
.claude/plans/heldwords-7208-review1.md:104 ("entities, — escape")

Fix: write it as "the u2014 escape".

## Checked and found clean

- Measured: unit files touching dmHeldWords, pjVerdict and the under-box line (web.inputkeep-6774, web.limitdm-5805,
  web.agent-answers, web.dmchoices-5406, web.links-everywhere, web.stuckinput-6717, web.voice-4409,
  web.thread-shape-3966): 89 tests, 89 pass, rc=0. web.task-say-outcome-5842 and web.wake-hello-automatic-4959 (also
  reference the held words): 19 tests, 19 pass, rc=0.
- Measured: docs/browser-checks/render-dm-held-5805.js, HEADED=0: rc=0, 15 PASS, "all passed".
- Measured: scratch probe of dmHeldWords over 9 deliveries (usage hold future/null/past, input, signin, behind,
  behind+input, usage+stuck, input+stuck) x 15 cards (none, idle, working, needs_you, rate_limited, rate_limited
  scraped, auth_failed, restarting, stopped, unknown, error, connection_lost, stale, idle+limitUntil,
  auth_failed+stopped). Round 1 fixes hold:
  - queued rows say "Queued behind earlier messages to Dario." with no card or a card that gives no reason, and lead
    with out of usage / signed out / not running when the card says so (round 1 finding 1).
  - box-kept to a rate_limited card: "... once Dario is back and its message box is clear." (finding 2).
  - usage hold past reset, card idle: no longer "out of usage" (finding 3; see finding 1 above for the new arm).
  - restarting never reads "not running" (finding 4); auth_failed beats the box and a signin hold beats a scraped
    limit (finding 5); a scraped limit borrowed for a box or queued row is hedged (finding 7).
- Reasoned: the idle+limitUntil combination cannot occur: status.claudeLimitUntilIso (engine/status.js:3239) sets
  limitUntil only on a rate_limited card, so `cardAt > now` adds nothing wrong.
- Reasoned: signin and behind cannot both be set on a row (server.js:19544 computes behind only when there is no
  hold), so "signed out ... after the messages ahead of it" needs a card auth_failed, where it is true.
- Reasoned: a stuck write merges into the existing delivery (engine/chat.js:5143), so heldFor, behind and heldUntil
  survive onStuck and the reason arms still see them.
- Reasoned: in the DM thread, dmHeldAgent's CURRENT arm returns the open agent (the thread's name is
  agentName || sessionName of CURRENT, 42423), so finding 3 is limited to the project member panel and to a stale
  CURRENT during a switch.
- Measured: em dash sweep on added lines (literal, the three entities, the two source escapes): 1 hit, the plan-file
  line in finding 7; a planted control line hits 1.
- Reasoned: the inputkeep test now anchors on `if (d.state === 'held' && inThread) {` with a not-found CONTROL, and
  doesNotMatch `line = dmHeldWords(` still guards against the row being repeated under the box (round 1 finding 8).
