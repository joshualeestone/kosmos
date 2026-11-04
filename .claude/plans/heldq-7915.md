# heldq-7915: a question held until the person returns (kosmos#7915, #7886 item 7)

## Goal
`kosmos report needs_you --held '<question>'` keeps the question on the board without anything following it up,
until the person writes to the agent again.

## Decided shape (on the card)
Same `needs_you` state (notify.js's vocabulary does not grow), with `held: true` on the report. While it stands:
no phone buzz, no Recommender, no stale reminder, the card reads "Question held" (calm, the phone's question tone),
and the person's next direct message carries a note that they are back: ask it (re-report without --held), or keep
holding if they say so.

## Pieces (all done)
- [x] engine/selfreport.js: store `held` only on a needs_you that says so; read() gives it back (only on needs_you);
      untilDefers: a held question is never stale; NEEDS_YOU_HELD_NOTE.
- [x] server.js POST /api/report: `held` strict boolean, only with needs_you (400 otherwise); no buzz when held;
      a held prior is not "already needs_you", so asking it for real buzzes; the held note; `report show` says held.
- [x] engine/status.js: reconcileReport carries `held`; both card builders expose `stateHeld`.
- [x] engine/cardlabel.js + web/index.html stateCopyOf: "Question held", calm; toneOf 'asked'.
- [x] engine/recommender.js stuckRow: skips a held question.
- [x] engine/chat.js dmStandingQuestionNote: held variant; server.js passes `held`.
- [x] install/kosmos + tools/windows/kosmos-cli.js: `--held` flag, refused off needs_you, usage + help line.
- [x] engine/defaults.js doctrine v45: one line in the needs_you bullet; pinned; doctrine-past regenerated.
- [x] Tests: engine/heldq-7915.test.js, cli.heldq-7915.test.js, a #7915 case in server.phonenotify-718.test.js;
      server.answeredq-5943.test.js pin updated. Every piece mutated red (20 mutations).

## Accepted residual (challenge-loop round 1)
The project card's pill and the need-you counts still count a held question, and the project pill reads the calm
"Question" (the same calm look as the agent card), not "Question held". The card asked that nothing be lost, and the
counts are where it stays visible; only the agent card's word changes. The phone's Today list shows it the same way:
under the question reason, never pushed. Carrying `stateHeld` into
projects.js summary and the page's project pill is a follow-up if a person finds the count noisy while away.

## Weakest premise
That the person's next direct message means they are back. The note leaves "keep holding" to the agent.

## Rejected
A new top-level state word (`held`): a translation in notify.js and the phone forever. Inferring "hold my questions"
from the person's words: the board never infers a state.
