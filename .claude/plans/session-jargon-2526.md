# Plan: #2526 - drop "session" jargon from the agent-dialogue delivery verdicts

Card: joshualeestone/kosmos#2526. Branch: `session-jargon-2526`.

## The problem (main finding, verified live + unattributed)
The project ROOM describes a message reaching agents in plain language ("Placed
with {names}", "could not be reached"). The one-agent THREAD describes the same
delivery states using "session" (the agent's live terminal session), never glossed:
- unconfirmed verdict: "We could not confirm that reached {name}'s session"
- the default failure reason: "we could not put it into its session" (3 render paths:
  the send-guard line, the pjVerdict row `said`, and the live-line render)
"session" is the single most-repeated jargon term in the delivery copy, and it is
UNATTRIBUTED - Josh's #402 ruling was about SILENCE-on-success (the success case is
already silent in sendTalk/sendTerm via placedWords), not about the word "session".
The room RECEIPT (pjReceiptSentence, the multi-agent post) already uses plain language
("Placed with {names}"), which is the plain reference to align to.

⚠️ CORRECTED (challenge-loop iter 1): "session" was NOT only in the one-agent thread.
It rendered in the room's own verdict renderers too - pjVerdict rows (the unconfirmed
"said") and pjSend (the room composer live line: placed, unconfirmed, and lost-contact).
So the de-jargon had to cover ALL of: sendTalk (one-agent thread), pjVerdict (room rows),
and pjSend (room composer), not just the failure reason. All are now covered.

## What changed (surgical; every honesty clause preserved verbatim)
1. Unconfirmed verdict -> "We could not confirm {name} got that" (was "...that reached
   {name}'s session"). The note, the because, and the "Your message is kept above /
   still in the box below" precision are untouched - only the jargon noun changed, and
   agent-level "got that" is what the non-technical user cares about (delivery
   unconfirmed either way).
2. The default failure reason "we could not put it into its session" -> "we could not
   reach them" in all three render paths (them = the agent, named/shown in each
   context). Plain, honest, no jargon.
3. Nit #1: the two empty-send guards ("Say something first." room / "Write something to
   send." thread) unified to the room's "Say something first." (the room composer is
   the primary/canonical surface).

## Deliberately NOT done (documented on card)
- Nit #2 (three verbs: placed / reached / deliver for one event): unifying the delivery
  VERB reaches broadly into the room renderer pjReceiptSentence and is more subjective;
  deferred as a follow-up rather than expanding this jargon fix.
- Nit #3 (WITHDRAWN): "Can't tell" is NOT an outlier - it is the canonical unknown-STATE
  label (CARD_ST, the state pill, everywhere) with its own honesty reasoning. It is
  consistent, so there is nothing to fix.

## What finished looks like
- No user-facing delivery verdict says "session" (the remaining code "session" strings
  are comments explaining the #402 history + internal notes, not rendered copy).
- The three delivery states stay distinct and keep their honest precision.
- Full suite green. No web test pins these exact strings (verified).

## Gate
- #1720: copy-only web/ change, no docs/browser-checks/ file -> Browser-check: trailer.
- #2518: no mapped surface token touched.
