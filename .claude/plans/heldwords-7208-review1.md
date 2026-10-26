# heldwords-7208 review, round 1 (blind CTO lens)

Branch heldwords-7208 at 45997cb625, against origin/main. Counts: 0 BLOCKER, 3 WARNING, 5 NIT.

## [WARNING] 1. "Queued behind your earlier message" can be untrue, and a queued row never gives the real reason
web/index.html:78150

The DM route sets `behind` when `limitqueue.list(name)` is non-empty (server.js:19545), and that queue is keyed by the
recipient and shared with every sender: other agents' `kosmos msg` (engine/messages.js:1690, and box-kept at 1716 with
`input: true`) and task notices (messages.js:1860, `kind: TASK_KIND`). `behindFor: 'input'` is also set when ANY
queued entry is box-kept, including another agent's (server.js:19577).

Failure: agent Raph's `kosmos msg` to Dario is kept for Dario's box. Josh then DMs Dario. His row reads "Queued behind
your earlier message to Dario." Josh sent no earlier message; there is none in his thread to look at. Same with a
task notice ahead of it.

Second half: the `behind` branch returns before the card is consulted (measured, scratch probe: behind + card
rate_limited, and behind + card stopped, both give "Queued behind your earlier message to Dario."). When the entries
ahead are not the person's, nothing on screen says Dario is out of usage or stopped, which is the card's second ask.

Fix: "Queued behind earlier messages to Dario." (true for every sender), and when `outNow` or `stopped` holds, say
that reason first for a queued row too (for example "Dario is out of usage until 3:00 PM. This delivers after the
messages ahead of it."). Add a unit case for each.

## [WARNING] 2. A box-kept message to an agent out of usage promises delivery on return, but the box still blocks it
web/index.html:78151-78154

For `heldFor: 'input'` with the card rate_limited, the row says "This delivers when Dario is back." The sweep
releases box-kept entries only once `chat.inputBoxEmpty(card)` (engine/limitqueue.js:245). Usage coming back does not
clear the box (that text is exactly what the person was told about before), so on Dario's return the message is still
held and the row has promised something that did not happen, with the row then flipping to "Waiting to deliver: ...
message box" at that moment. This is Josh's own Dario scenario.

Fix: keep usage as the reason said first but do not promise the release: for `heldFor === 'input'` and `outNow`,
"Dario is out of usage until 3:00 PM. This delivers once Dario is back and its message box is clear." (or similar
plain wording). One extra unit assertion.

## [WARNING] 3. A usage-held row ignores the card when the agent is plainly back
web/index.html:78151 (the `d.heldFor !== 'input' && d.heldFor !== 'signin'` arm)

The card is only used to escalate to "out of usage", never to step down. Measured (scratch probe): message held for
usage with `heldUntil` past, card `{ state: 'idle', running: true }` gives "Dario is out of usage. This delivers when
Dario is back." while Dario's card on the same page shows him idle. If the sweep cannot type it (box text, a menu),
this persists, and the row contradicts the card right beside it. The change's own claim is "the REAL reason first";
here the card holds the real state and is not read.

Fix: when `a` is present, not `outNow`, running, and the hold's reset is past, do not say out of usage: fall through
to the box/sweep wording, or a neutral "Dario is back. This goes through in a minute or so." Pick what the sweep
actually does; add a case.

## [NIT] 4. A restarting agent reads as "not running"
web/index.html:78149

`a.running === false` with `state: 'restarting'` gives "Dario is not running. This delivers when Dario is running
again." (measured, probe). The page excludes restarting everywhere else it reads `running === false`
(web/index.html:23168, 23349, 66005). Fix: `&& a.state !== 'restarting'`.

## [NIT] 5. Signed out is not taken from the card, and usage outranks a sign-in hold
web/index.html:78148-78158

Card `state: 'auth_failed'` with a box-kept message gives the box words (measured), though signed out is the real
reason by the card's own logic. And a `heldFor: 'signin'` row with a card reading rate_limited says out of usage
(measured). Both are rare; consider treating `a.state === 'auth_failed'` like `heldFor: 'signin'` and letting a
signin hold win over a scraped rate_limited.

## [NIT] 6. The card lookup's `m.to` path looks dead, and the name compare can miss
web/index.html:78164-78171

Nothing on the page reads `m.to` for a DM row (grep: only 78167), and the browser check's fixtures carry none, so the
lookup is in practice "CURRENT whose name equals the thread's name". It cannot pick the wrong agent (name guard, and
CURRENT is refreshed from LAST each poll at 40291), but it misses: `paintTalk` uses `agentName || sessionName`
(42423), so a card with no `name` yields null (measured, probe), and in the project member panel (pjMsg, 78566) it
finds nothing unless that agent is also the open one. Fix: look up `LAST` by sessionName (paintTalk has it) or by
name, and drop or test the `m.to` arm.

## [NIT] 7. The row asserts usage where the card hedges
web/index.html:78154

A card with `stateConfidence: 'scraped'` says "Looks like a usage limit" (22229-22235); the row says "Dario is out of
usage." The server's own hold already asserts it for usage-held rows, so this is new only for the box-kept arm that
now borrows the card's state.

## [NIT] 8. Small text items
- web/index.html:78184: comment still says "kept while the agent is out of usage", now one of five reasons.
- web.inputkeep-6774.test.js:61 pins the page's comment text ("said ONCE, on the message's own row...") in its
  regex; editing that comment fails a behaviour test. Anchor on the code (`clearSent();\n\s+line = '';` inside the
  `d.state === 'held' && inThread` arm) instead.

## Checked and found clean

- Measured: unit files touching dmHeldWords/pjVerdict/d-say-msg (web.agent-answers, web.dmchoices-5406,
  web.links-everywhere, web.inputkeep-6774, web.limitdm-5805, web.stuckinput-6717, web.voice-4409,
  web.thread-shape-3966): 89 tests, 89 pass, rc=0.
- Measured: docs/browser-checks/render-dm-held-5805.js, HEADED=0: rc=0, all 15 PASS, "all passed"; line under the box
  is "" after a held send.
- Measured: scratch probe of dmHeldWords/dmHeldAgent lifted from the branch page over 10 delivery/card combinations
  (results quoted in findings 1, 3, 4, 5, 6).
- Measured: no em dash in added lines (literal, entities, — escape; 0 hits) with a planted control that hits 1.
- Measured: nothing else reads the removed under-box line. grep for the old strings ("Held: ", "To send it now, use
  Send now anyway", "Kosmos sends it after the reset") in web/index.html and the browser checks: only the new
  explanatory comment at 78139. Remaining hits are server/CLI/room wording (server.js, kosmos-cli, room tests), a
  different surface the card does not name.
- Measured: dmHeldWords has one caller (pjVerdict 78186); pjVerdict has two (dmRow 41372, pjMsg 78237).
- Reasoned: the row repaints when the card changes even with unchanged rows, since setThread compares threadShape of
  the full HTML (77975, 41028), and paintTalk runs on the status tick (25818) after CURRENT is refreshed (40291).
- Reasoned: CURRENT cannot be a different agent with the same display name in the DM thread, and the `name` guard
  stops a stale CURRENT from leaking into the project panel.
- Reasoned: sendTalk's held arm still clears the box via clearSent and the `!inThread` recordedBecause line is
  untouched, so an unkept held send still says why.
- Reasoned: mobile-shots.js screen wraps its route handler in try (#6022 shape), passes non-GET through, and
  touches no board state.
- Copy against the card: plain, no "Held:", one place only. "Waiting to deliver" over Josh's "in the middle of
  typing" is a reasonable documented call (the box text may be the person's own).
