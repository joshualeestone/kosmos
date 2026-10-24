# chatlinks-7014: test the bubble link rule (and keep VoiceOver's default action)

Card: kosmos#7014, a follow-up to #7008 (PR #7011): two items #7008's review round 8 raised and I deferred at merge.

## Finished looks like
A message's links (what a bubble draws and what VoiceOver offers as actions) are worked out in BoardLogic.swift and
tested in ios/LogicTests, including the one-link-in-several-runs rule and links that are not web pages. CI's iPhone
job is green.

## Change
- ios/Kosmos/BoardLogic.swift: `messageText` (moved from ChatView's `BubbleText.formatted`, unchanged), `messageLinks`,
  and `links(in:)` (moved from `BubbleText.links(in:)`, unchanged).
- ios/Kosmos/ChatView.swift: `BubbleText.formatted` calls `Board.messageText`; the link actions use
  `Board.messageLinks`; a comment on why each bubble keeps a default action that may do nothing.
- ios/LogicTests/main.swift: a section for a message's links.

## Decided
- Measured: Foundation's inline Markdown never styles link words or addresses today (`[the **full** report](...)`
  reads as one unstyled run), so no message text can split one link into runs. The once-per-link rule is tested on a
  hand-built split link, with a control that shows the input really is in three runs. Rejected: a test from message text
  claiming to split a link, which passed without exercising the rule.

- The card's second item (offer the default action only where it acts) is NOT done, on purpose. Review round 1 found
  that a bubble with no default action lets VoiceOver's double-tap fall through as a tap at the bubble's centre, which
  can land on a link in the text and open it. The always-present action that does nothing where there is no retry is
  the safer one. What would change my mind: a device showing that the double-tap does not fall through.

## Weakest premise
That moving the two functions changed nothing: they are copied word for word (review round 1 diffed them).

## Validation
- ios/LogicTests pass; mutants for the dedupe rule and for each non-web-link filter go red.
- The bubbles' accessibility actions are as on main (only a comment is added above the default action).
- Debug simulator build with -warn-long-expression-type-checking=100: no warnings (CI runs an older Xcode).
