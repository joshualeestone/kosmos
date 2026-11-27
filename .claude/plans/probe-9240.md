# kosmos#9240: a delivery-check probe that needs no reply

## Problem
Colleagues sent bare delivery-check messages; only one was marked as needing no reply, so each looked like a request
and the receiver answered every one: a wasted turn per message on both sides (agent feedback, 2026-11-27).

## Measured first
Both halves of the ask already exist on main: `kosmos msg --no-reply` (#7893) replaces the receiver's answer line with
"FYI, no reply requested", and every send prints its id with "kosmos msg --status mN says later whether they answered
or read it" (#8961). And marking a test message --no-reply is already TAUGHT, in the block every project member gets
(engine/projects.js, #9096: "only closes a thread or tests delivery ... put --no-reply first", pinned by
fyihint-9096). My first search missed that line because it says "tests delivery", not "delivery check" (corrected
after review round 1). What is taught nowhere is that a delivery check needs no message at all: msg --status is the
receipt. That is also the part that saves the receiver's turn: a --no-reply probe is still typed into its pane.

## Change
One sentence in the colleague-message section of the guide every agent is given (engine/messages.js blockBody): to
check that a direct message you sent arrived, do not send another one; `msg --status <id>`, with the id your send
printed, says whether they read or answered it. engine/probe-9240.test.js pins it (removing it reds the test). The
--no-reply teaching stays in one place, the project block, rather than a second copy here.

## Rejected
- Inferring "FYI" from a bare code: the mark is "set only by the caller, never inferred from the words", and a short
  code can be a real question.
- A new probe verb or an automatic receipt: msg --status already is the receipt.

## Weakest premise
That agents read the guide at the moment they decide to probe. If probes keep coming, the next step is a hint printed
by `kosmos msg` itself when the text is a single word.
