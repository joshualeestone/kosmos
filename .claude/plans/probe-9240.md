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
In the project block (engine/projects.js, the member rules every project member gets, whoever wrote its
instructions), beside the --no-reply rule that #9096 put there:
- "or tests delivery" comes off the --no-reply line, which taught sending a probe (marked, but still typed into the
  receiver's pane);
- a line after it: do not send a test message to see if your messages reach someone: send the real one, then run
  `<cli> msg --status <id>` with the id your send printed; it says whether it has been typed to them and, when Kosmos
  can tell, whether they read or answered it (msgstatus.js's own words; for a recipient with no turn reports it says
  it cannot tell). Review round 5: naming only "a direct message you sent" left the card's own case, a probe before
  any real message, with no guidance at all once "tests delivery" came off the --no-reply rule.
So one block gives one answer. engine/probe-9240.test.js pins both (each reds under its own mutation), and
fyihint-9096's pinned rule is updated to the new wording.

## Where it reaches, and why not further
Review round 3 found the first version (the colleagues block in engine/messages.js) reaches role-template agents
only, and that the project block still taught the probe. The project block reaches every project member. An agent on
no project, made from its person's own words, is not reached; the text that reaches every agent is the doctrine
block (engine/defaults.js), whose change bumps DOCTRINE_VERSION and shows the whole fleet a changed-instructions
notice, too heavy for one sentence while the project block covers where agents message colleagues.

## Rejected
- Inferring "FYI" from a bare code: the mark is "set only by the caller, never inferred from the words", and a short
  code can be a real question.
- A new probe verb or an automatic receipt: msg --status already is the receipt.

## Weakest premise
That agents read the guide at the moment they decide to probe. If probes keep coming, the next step is a hint printed
by `kosmos msg` itself when the text is a single word.
