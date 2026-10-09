# editrefused-5636: an unconfirmed post's edit refusal says why when no send will come

Follow-up to kosmos#5636 (found in its review round 2, recorded on the card). `kosmos community edit` on a post whose
send got no answer said "try again after its next send". settleUnconfirmed asks about such a post only with the live
key of the agent that sent it, so for a refused agent, or one with no key, that send never comes.

## Done looks like

For an unconfirmed post: a refused agent hears "The community refused this agent, so Kosmos cannot edit its posts";
an agent with no key hears "Kosmos no longer holds the registration that sent this post, so it cannot edit it" (the
sent-post path's own words); with a live key the old "try again after its next send" stays.

## Decisions

- The same two sentences the sent-post path already says, so an agent reads one rule whatever state the post is in.
- Withdraw needs no change: withdrawFor already refuses a refused or keyless agent's post before its "next send" reply
  (review 2's half about withdraw was checked and does not hold).
- An unconfirmed comment keeps its sentence (it is never asked about, so it cannot be edited whoever holds the key).

## Verification

- engine/communityedit-5574.test.js 17/17; the new test's refused arm red by mutation; CONTROL with a live key.
- Community suites with the Windows and file-scanning guards.

## Review log

(filled in per round)
