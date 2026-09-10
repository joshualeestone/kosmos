# Plan: a reported needs_you shows its reported question (kosmos#2456)

## Problem

Josh's 0.6.47 re-test: a ton of agents read "Needs you", and on the detail view three
surfaces disagree at once. The pill says needs-you, the header quotes a clear question
("what should this project produce?"), and the in-conversation banner says "we cannot find
the question on its screen right now." That disagreement reads as "it does not really know
why it needs me."

## Root cause

The banner re-captures the LIVE tmux pane (`chat.viewport` -> `chat.questionIn`) and finds
nothing once the TUI has redrawn past the marker. But these needs_you are REPORTED, not
scraped: the agent handed us its question in the card's own `because` (the same sentence the
header quotes). The banner ignored that record and insisted on the pane, so it denied a
question the board was quoting one line up. This is distinct from the already-merged #2465,
which suppressed a SCRAPED prose false-positive; here the flag is arguably correct and the
defect is claiming the question cannot be found.

## Approach (honouring the repo's "the record wins over the live pane" rule)

- Both thread routes (`server.js`, `/api/agent/:name/thread` and
  `/api/project/:id/thread/:agent`): when `asking` and the live pane yields no question but
  the card is a REPORTED needs_you with a real (non-generic) `because`, serve that reported
  sentence as the question, tagged `reported: true`. The live pane WINS whenever it has a
  question; the reported words are the fallback. `options` is gated to pane-source only.
- `engine/status.js`: export `ASKING_GENERIC` (the "it is asking you something" placeholder)
  as one derivation, replacing the four literals, so a route can tell a real reported
  question from the board's generic asking and never offer the placeholder as a question.
- `web/index.html`: source-aware labels on both the agent page and the project room ("This
  is what it told us it needs:" for a reported question vs "This is the part of its screen
  that asked:" for a live one), and the numbered-answer hint hidden for a reported prose
  question with no menu.

## Decisions

- Show the reported question rather than only fixing the banner sentence: Josh asked for
  "something I can act on", and Splinter ratified "fall back to the already-known question".
- The gate keys on `stateReported === true`, so a scraped needs_you and a live trust dialog
  (reconcile returns reported:false, screen leads) never trigger the fallback. The
  `!== ASKING_GENERIC` check is documented belt-and-suspenders.
- The project route reads the full roster card via `ourCardByName(roster, name)` for the
  reported decision, because the reduced project-membership projection lacks `stateReported`.
- Vocabulary stays inside the existing `needs_you` / `because` / `question` words;
  `notify.js` deliberately carries no question text, so no phone-seam translation is added.

## Weakest premise

That a reported needs_you standing while the live pane shows other output is still waiting
on its reported question. It is: a reported needs_you does not decay (reconcile rule 6), the
doctrine is raise-needs_you-and-keep-working, and the source-aware label frames the words as
reported rather than as the live screen. The live pane wins whenever it has an extractable
question, so a real new on-screen prompt is never hidden behind stale reported words.

## Tests

`server.projects.test.js`, both routes: reported question shown; scraped-no-fallback still
says cannot-find; generic placeholder not offered; live pane menu wins over the report; and
a reported + live-trust-dialog seam shows the dialog, never the reported words.
