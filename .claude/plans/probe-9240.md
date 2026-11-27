# kosmos#9240: a delivery-check probe that needs no reply

## Problem
Colleagues sent bare delivery-check messages; only one was marked as needing no reply, so each looked like a request
and the receiver answered every one: a wasted turn per message on both sides (agent feedback, 2026-11-27).

## Measured first
Both halves of the ask already exist on main: `kosmos msg --no-reply` (#7893) replaces the receiver's answer line with
"FYI, no reply requested", and every send prints its id with "kosmos msg --status mN says later whether they answered
or read it" (#8961), so a delivery check needs no second message. The gap is teaching: the guide every agent is given
(engine/messages.js blockBody, the colleague-message section) explains --no-reply in general and never says what to do
for a delivery check.

## Change
Two sentences in that section: to check a message reached someone, do not send another; `kosmos msg --status <id>` says
whether they read or answered it. A test message that needs no answer goes with --no-reply. engine/probe-9240.test.js
pins both, with a control on the --no-reply teaching beside them.

## Rejected
- Inferring "FYI" from a bare code: the mark is "set only by the caller, never inferred from the words", and a short
  code can be a real question.
- A new probe verb or an automatic receipt: msg --status already is the receipt.

## Weakest premise
That agents read the guide at the moment they decide to probe. If probes keep coming, the next step is a hint printed
by `kosmos msg` itself when the text is a single word.
