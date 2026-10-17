# statuspill-6398 (kosmos#6398 + #6400)

Josh 2026-10-17 11:09 (#6398, verbatim): "Lets reduce all that to a \"Rate Limit\" and put it where the \"Paused\" status is."
Josh 2026-10-17 11:14 (#6400, verbatim): "when it says \"Issue...... Answer>\" it only needs to say \"Issue\""
Splinter 11:15 and 11:17: do both on one branch; they gate the 0.7.56 staging cut.

## What changes (web/index.html)
- STATE_COPY.rate_limited.label: 'Paused' -> 'Rate Limit' (his words, his capitals). Only this state's pill; the
  swarm, project and task "Paused" words are other things and are untouched.
- stateReason(a, { card: true }) returns '' for a rate_limited agent, so a card and a list row carry no sentence.
  rateLimitTitle(a) puts the page sentence (how long, what to do) on the pill as its hover text, and the agent's own
  page (taskLine without card) keeps the sentence.
- #6400: answerBtn is gone. answerAttrs(a) puts data-answer / data-answer-name on the card and list row root for an
  answerable agent (same gate: tied, not a failed restart), so a click anywhere on it, or Enter on its name button,
  runs pjAnswerFrom (the agent's page with the reply box focused), as the link did. The .ansgo CSS goes with it.

## Decided
- The list row follows the card for both (one status pill, one word); Josh named the cards, the row is the same pill.
- Detail behind the pill = hover text plus the agent's own page. Rejected: a click-to-expand pill (a new control,
  more UI while Josh asked for less) and keeping the time on the card (his words cut it).
- pjAnswerFrom is kept, reached by the card, rather than left uncalled: it is what focuses the reply box.

## Weakest premise
That hover text is enough "behind the pill" on a phone, where there is no hover. A phone reader gets the sentence on
the agent's own page, one tap away.

## Tests
server.test.js, web.consolidated-980, web.agypoolcard-4588, web.agyquota-4588, web.rulesbehind-5957,
web.community-card-5314 (stub), web.brace-anchor-guard-1469.lib (the .ansgo pin removed, total 27 -> 26), and the
browser checks render-thread, render-phone-taps-5218, render-home-phone-718, render-waiting-phone-718 (new Rate Limit
arm) now assert the new pill and the card as the answer route.
