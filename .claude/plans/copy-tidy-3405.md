# copy-tidy-3405 -- remove the persistence line from the talk composer (#3404)

## What Josh asked
Josh, 2026-09-22 in #chaoskosmos-design: "lets also kill this line of text
'This stays here after a restart. Alexandra will not remember it. Anything that
needs to last belongs in their instructions.'"

Straight content removal, decided and built directly (no parking). Rides the
next design build (0.6.89) per Splinter's framing; 0.6.88 stays the minimal
trust-fix launch build.

## The line and where it lived
The sentence was the `#d-persist` paragraph under the talk composer (the box for
messaging an agent from the agent's page). It was set once (with the agent's
name interpolated) and hidden in two states (a standing refusal, and
`historyUnfilable`).

## Changes
- `web/index.html`
  - Remove the `<p id="d-persist">` element (and its preceding comment).
  - Remove the `textContent` setter that built the sentence.
  - Remove both `.hidden` toggles (the success-path hide and the
    `historyUnfilable` hide), each with its explanatory comment.
  - Rewrite the instructions-box lede comment that cited the now-removed
    talk-box sentence as a live "closes a split across two boxes" rationale, to
    past tense, so no comment asserts a surface that is gone.
- `web.reply-where.test.js`
  - Drop the persistence assertion from "the box still says the two things"
    (kept as the between-you sentence only; test renamed).
  - Re-anchor the comment-stripper control from `getElementById('d-persist')`
    (gone) to `getElementById('d-say')`, which is still real code no comment
    stands in for.
- `web.instructions-copy.test.js`
  - Drop the cross-box agreement assertion (no second box to agree with now);
    the lede's own consequence wording is still checked.
- `docs/browser-checks/render-talk.js`
  - Remove the `persistVisible` capture, the `keepsNothing` check, and the
    section 8 / 8b persistence control blocks.
- `docs/browser-checks/render-thread.js`
  - Remove the "does not promise the conversation is kept" absence check, whose
    subject can no longer appear anywhere.

## Verification
- Full node suite green (fail 0, cancelled 0; 7923 pass, 147 skipped).
- The 4 directly-affected test files pass in isolation.
- `render-talk` browser-check run locally (pinned Playwright, HEADED=0):
  problems none across every state and both themes; the persistence text no
  longer appears in any composer state.

## Scope guard
Pure removal of one user-facing sentence plus the code and checks that only
existed to render/guard it. No behaviour change beyond the sentence's absence.
Not a money-moving change; not public under Josh's name.
