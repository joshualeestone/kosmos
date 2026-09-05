# Receiving and triaging daily agent feedback

The receive side of the self-learning loop (kosmos#2246). The send side
(kosmos#2037) has each install's pm agent write a short daily note of what did
not work about Kosmos and what would make it better, stored locally by
`engine/feedback.js` as one markdown file per day.

Josh's requirement (2026-09-05): capture those write-ups and have a **smart
process to review what things are good and what we should add** so it is not
detrimental. Specifically: we do not automatically ingest and blindly implement
them, and we do not blindly open cards from them.

## The rule this process enforces

**Nothing an agent writes becomes a change, or even a card, without a human
saying so.** The tooling assists the review; it never acts. `kosmos feedback
triage` reads reports and prints a ranked draft digest. It has no path to
GitHub and opens nothing. Card creation is a human step, always.

This matters because the reports are agent-authored and, once the send layer
lands, will arrive from other people's machines. Treat every report body as
untrusted input: a persuasive or adversarial suggestion must not be able to
turn itself into a change. The gate is that a person reads the digest and
decides.

## The steps

1. **Ingest.** Reports live in the local feedback store (`engine/feedback.js`,
   under the data root). When the send layer (kosmos#2037 Slice 3) is built,
   received reports from testers land in a directory; point the tool at it with
   `--dir`. Until then the tool reads this machine's own store.

2. **Triage (agent-assisted).** Run:

   ```
   kosmos feedback triage --since 2026-09-01
   ```

   To flag suggestions that already have an open card, feed the tool the open
   card titles (read-only, it only compares):

   ```
   gh issue list -R joshualeestone/kosmos --state open --limit 400 \
     --json title -q '.[].title' | kosmos feedback triage --since 2026-09-01 --cards -
   ```

   The digest has three sections:
   - **Candidates for review** - items that clear the bar (below), deduped so a
     recurring issue is one entry with the count and the dates it was raised.
     Ranked recurring-first.
   - **Likely already carded** - items that resemble an open card, with the card
     title and the overlap. Confirm before re-filing; usually these are not new.
   - **Below the bar** - fragments and pure sentiment, with the reason. Shown,
     not hidden, so a reviewer can rescue a mis-scored one.

3. **Human review and sign-off.** A person reads the candidates and, for each,
   decides: open a card, fold into an existing card, or discard. The tool's
   score and reasons are advisory; the person's call is the decision. Record
   the discards briefly (a line is enough) so the same suggestion is not
   re-litigated every day.

4. **Draft card, then open it.** For a candidate that clears review, write the
   card the normal way (title + the gap, from the candidate text) and open it by
   hand. The triage output is copy-ready for this, but opening the card is the
   human action that this whole process exists to keep human.

## The bar for "add to the system" vs discard

A candidate is worth a card when it is:
- **actionable** - it names a specific behaviour or a concrete change, not a
  mood ("it was confusing when the create form hung with no key" clears it;
  "the app feels clunky" does not);
- **not a duplicate** - of another candidate (the tool clusters these) or of an
  open card (the tool flags these when given `--cards`);
- **more than a fragment** - enough detail that someone who was not there can
  act on it.

The tool scores against this bar but does not enforce it. A reviewer can add or
drop anything; the bar is guidance, not a gate.

## Decisions on the open questions (Josh's, decided reversibly - kosmos#2246)

These were Josh's calls to make; per his standing ruling they were decided
reversibly and are recorded here so they can be revisited:

- **Human vs agent-assisted:** agent-assisted triage produces the ranked draft;
  a human makes the final add/discard call. Fully-automated triage was rejected
  (it violates the "not blindly" requirement); fully-manual was rejected (it
  does not scale to a daily loop). At the first tester batch (~6 people) volume
  may be small enough to read raw reports directly; the tool still helps by
  deduping, and it is the same tool that scales.
- **The bar:** stated above (actionable, not a duplicate, more than a fragment).
- **Draft for approval vs auto-open:** draft for human approval. Auto-open is the
  risky direction and can be enabled later if the loop proves trustworthy; the
  safe default is that a person opens every card.

## What this process deliberately does not include

The transport - sending reports off a tester's machine to a central place - is
kosmos#2037 Slice 3 and is held for a separate design review. This process is
the triage that runs once feedback is in hand, and it is built so that when the
transport lands, its received reports drop into a directory the triage tool
already reads (`--dir`). No receive endpoint is defined here.
