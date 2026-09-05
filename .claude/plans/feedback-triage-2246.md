# #2246: receive + smart-triage process for daily agent feedback

Receive side of the self-learning loop (#2037 is the send side). Josh, 2026-09-05:
capture the daily write-ups from agents about bugs and improvements, and have a
SMART process to review them "so that it's not detrimental: we're not just
automatically getting it and blindly implementing it or adding cards from it."

## What already exists (recon)

- `engine/feedback.js` writes one report per local day to
  `<store.ROOT>/feedback/YYYY-MM-DD.md`: frontmatter (`date`, `install`,
  `generated_at`) + agent-authored markdown body. Always-on, local, NOT
  anonymised on disk. Read API: `list()` (dates newest-first), `readBody(date)`,
  `read`, `has`.
- The pm role (`engine/roles.js`) is told once a day to write "what did not work
  about Kosmos and what would make it better" via `kosmos feedback write`.
- The SEND layer (transmit off-machine, scrub, gated seam) is Slice 3 and is
  explicitly HELD for design review. There is no central inbox yet.
- #561 is a DIFFERENT hook (agent STATE -> board), not product feedback. Not
  conflated here.
- No ingest or triage exists today. This card is greenfield.

## Scope decision (what this card builds, and what it deliberately does not)

BUILDS: the triage PROCESS - what happens to feedback once we have it. A pure
engine module + a `kosmos feedback triage` verb that reads the feedback reports
already on disk, groups and dedups candidate items, flags likely noise, matches
against open cards, and emits a RANKED DRAFT DIGEST for review. Plus a docs
runbook defining the human review + sign-off step.

DOES NOT BUILD: the transport. No HTTP receive endpoint, no off-machine send.
That is Slice 3, held for Splinter/Josh design review, and my brief forbids
front-running it. When the send layer lands, its received reports drop into a
directory this triage tool already reads (default the local store, `--dir`
override), so the two halves meet without this card guessing the transport.

## Safeguards (Josh's "not detrimental / not blindly implementing")

1. The tool NEVER opens a card and NEVER implements anything. Its only output is
   a digest. Card creation stays a human action, by construction (the tool has
   no write path to GitHub).
2. Adversarial-input safety: parsing is text-only; no eval, no shelling out to
   anything derived from report content; a report body cannot cause an action.
3. Dedup against open cards is READ-only (`gh issue list` titles fed in), so a
   suggestion that duplicates an open card is flagged, not re-carded.
4. Signal/noise classification is advisory and shown with its reasons, so a
   reviewer can override it; nothing is silently dropped.

## Reversible calls on the open questions (Josh's, decided per standing ruling)

- Human vs agent-assisted: agent-assisted triage produces the ranked draft; a
  human makes the final add/discard call. Rejected: fully-automated triage
  (violates the "not blindly" requirement) and fully-manual (does not scale to a
  daily loop). Weakest premise: at 6 testers the volume may be small enough that
  the human reads raw reports directly; the tool still helps by deduping and
  grouping, and it is the same tool that scales.
- Bar for "add to the system" vs discard: a candidate clears the bar when it is
  actionable (names a specific behaviour or a concrete change), is not a
  duplicate of another candidate or an open card, and is not pure sentiment. The
  doc states the bar; the tool scores against it but does not enforce it.
- Draft card for approval vs auto-open: DRAFT for human approval. This is the
  safe, reversible default given Josh's explicit "not blindly ... adding cards";
  auto-open is the risky direction and can be turned on later if the loop proves
  trustworthy. The tool emits copy-ready draft cards; a human opens them.

## Module shape

`engine/feedback-triage.js` (pure, no network, co-located test):
- `parseItems(body)` -> candidate items from a report body (markdown bullets and
  headings; freeform-tolerant).
- `classify(item)` -> { score, reasons } advisory signal/noise.
- `groupDuplicates(items)` -> near-duplicate clusters (normalise + token overlap).
- `matchOpenCards(items, cardTitles)` -> flags items resembling an open card.
- `triage(reports, { openCards })` -> { candidates, noise, clusters, summary }.

`kosmos feedback triage [--since YYYY-MM-DD] [--dir PATH] [--cards FILE]`:
reads reports via feedback.list()/readBody() (or `--dir`), optionally loads open
card titles (from `--cards` or `gh issue list`), prints the digest with a plain
header that no card was opened.

`docs/feedback-triage.md`: the runbook (ingest -> triage -> human review + sign
-off -> draft card). The single source of the process.

## Verification

`engine/feedback-triage.test.js`: parseItems on a real report shape; classify
gives low score to sentiment and high to an actionable specific; groupDuplicates
clusters two phrasings of one issue; matchOpenCards flags a duplicate of an open
card and passes a novel one; triage end-to-end on two reports returns the
expected candidates/noise split. The `*.test.js` glob auto-arms it; a real
caller (the CLI verb) satisfies the reachability guard (#265). `bash -n
install/kosmos` in test:shell covers the verb syntax.
