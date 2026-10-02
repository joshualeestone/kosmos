# hellogate-4959: the automatic wake hello goes through the shared-quota gate (kosmos#4959)

Written 2026-10-01 23:01 CDT, night shift. Base origin/main a7cae2b3e.

## Cause (measured, source)
The restart wake ('hello' after a restart, model switch, provider switch) is sent by the page's sendWakeHello as
POST /api/agent/:name/thread {text:'hello'}, the person's own route, which calls chat.deliverAsync. Automatic
senders are meant to use chat.deliverAutomatic(Async) (#4588), which holds a Gemini (Google subscription) agent
while this machine's shared Google quota is out. So the wake was typed into an agent whose pool is empty.

## Change
- server.js, the DM thread POST: an optional body flag, automatic. Exactly true or absent: any other value is
  refused 400 (the #4889 lesson: a flag read loosely is a flag nobody can trust). Only on plain text: with chose,
  reply_to or an attachment it is refused 400, since those are always the person's own act. With the flag, delivery
  is chat.deliverAutomaticAsync. A HELD verdict typed nothing, so the route answers it as it is (held, heldUntil)
  with recorded:false and does NOT file a 'hello' row in the thread.
- web/index.html, sendWakeHello: posts {text:'hello', automatic:true}. A held answer is not placed, so the site's
  existing manual line shows ("Send them a message to wake them"); nothing new is claimed.

## Decided, and rejected
- Rejected: a new page line "Kosmos will say hello when the Google quota is back" (the card's suggestion). Nothing
  re-sends the wake after the reset, so that sentence would be false. The manual line is true: the person's own
  message is never held (#4588 by design).
- Rejected: filing a held hello in the thread. A bubble for a hello the agent never got is the false record.
- The team hello (#4936, April, branch teamhello-4936, no PR yet) refactors this fetch into postWakeHello. Whichever
  lands second carries { automatic: true } into postWakeHello; told on both cards.

## Weakest premise
That a held wake leaves the person no worse off: they see the manual line and their own message goes through
unheld, into the same empty pool. If Josh wants the wake RETRIED after the reset, that is a timer like the room's
quota-held retry (#4588), its own card.

## Validation
- server.automatic-hello-4959.test.js (real route, both deliver paths recorded): 4/4. Against origin/main's
  server.js: 3 red, the person's-message CONTROL green.
- web.wake-hello-automatic-4959.test.js: 2/2. Against origin/main's page: the body test red; the held-reads-manual
  test is green on main too (it pins existing behaviour: only placed reads as said).
- Siblings run: web.handoff-restart-3492, server.agyhold-4588 (its source pins): green, 33/33 with the new files.
- docs/browser-checks/render-autohello-2686.js: asserts the hello is sent as automatic, and a new arm 5b (held ->
  manual line). Syntax-checked; RUN queued on Agent1s.
- Full suite before merge.

## Review 1 (23:06 CDT): 0 BLOCKER, 1 SHOULD-FIX, 3 NITs
- SHOULD-FIX taken: the handoff-restart PICKUP (POST /api/agent/:name/handoff-restart/pickup) is the wake hello's twin,
  the board's own line after a restart, and was still on chat.deliverAsync. Now chat.deliverAutomaticAsync; a held
  verdict is COULD_NOT, which the route already answers 409, and the page's deliverPickup reads that as the manual
  line (no page change). Test arm added; red with the old line, green now.
- Considered and left plain: /handoff-restart/ask and /compact, /clear. Each follows the person's own click, and
  #4588's rule is that a person's act is never held.
- NIT left: attachment refusal uses truthiness, matching how resolveForMessage reads attachment ('' attaches nothing).
- NIT left: a pending reaction note can ride the wake hello. That predates this change; when the hello is held,
  the note is not marked told, so nothing is lost.
- NIT agreed: browser arm 5b is a read-side pin (passes on main too); arm 1's automatic === true is the send-side
  proof. Already stated in Validation.

## Review 2 (23:08 CDT): 0 BLOCKER, 1 SHOULD-FIX, 2 NITs
- SHOULD-FIX taken: a held wake told the person nothing, though the verdict carries heldUntil. New wakeHeldLine: the
  site's own manual line, then "This computer's shared Google quota is out until <#4588's quotaResetWords>, so Kosmos
  sent nothing." It states the fact and promises nothing (nothing re-sends the wake). No usable time: "...is out, so
  Kosmos sent nothing." deliverPickup now passes a HELD 409 verdict through, so the handoff restart says it too.
  Tests: 3 new page arms (red on the previous commit) incl. a CONTROL that a non-quota refusal stays the bare line;
  browser arm 5b now asserts the sentence. Page script compile-checked.
- NIT taken: the server test installs its stubs inside the try.
- NIT taken: a route comment says the thread route answers a hold 200 and the pickup 409; read delivery.held.

## Review 3 (23:12 CDT): 0 BLOCKER, 0 SHOULD-FIX = CONVERGED
- It checked every site the held line lands in (each manualText ends in a full stop; nothing compares a report to
  manualText exactly; the change dialog's finish() adds the Ready check only on saidLine) and the merge with
  switchdone-4963 (#4963): no textual overlap (that branch edits autoHelloOnSwitchRestart only), and the behaviours
  compose (read, not executed; worth one combined arm after both merge).
- NIT taken: wakeHeldLine had landed between sendWakeHello and its doc comment. Moved above the older comment block,
  so main's comment order is untouched and the diff is one added block.
