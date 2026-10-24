# chatlinks-7014: test the bubble link rule; VoiceOver's default action only where it acts

Card: kosmos#7014, a follow-up to #7008 (PR #7011): two items #7008's review round 8 raised and I deferred at merge.

## Finished looks like
A message's links (what a bubble draws and what VoiceOver offers as actions) are worked out in BoardLogic.swift and
tested in ios/LogicTests, including the one-link-in-several-runs rule and links that are not web pages. A bubble's
VoiceOver double-tap action exists only where it does something. CI's iPhone job is green.

## Change
- ios/Kosmos/BoardLogic.swift: `messageText` (moved from ChatView's `BubbleText.formatted`, unchanged), `messageLinks`,
  and `links(in:)` (moved from `BubbleText.links(in:)`, unchanged).
- ios/Kosmos/ChatView.swift: `BubbleText.formatted` calls `Board.messageText`; the link actions use
  `Board.messageLinks`; `DefaultActionWhen` registers the default accessibility action only when it acts (the same
  shape as `TapWhen`).
- ios/LogicTests/main.swift: a section for a message's links.

## Decided
- Measured: Foundation's inline Markdown never styles link words or addresses today (`[the **full** report](...)`
  reads as one unstyled run), so no message text can split one link into runs. The once-per-link rule is tested on a
  hand-built split link, with a control that shows the input really is in three runs. Rejected: a test from message text
  claiming to split a link, which passed without exercising the rule.

## Weakest premise
That the default action registered only when enabled has no effect on VoiceOver beyond removing an empty double-tap.
It is SwiftUI, so ios/LogicTests cannot see it; the device list on #6838 already covers VoiceOver on the chat.

## Validation
- ios/LogicTests pass; mutants for the dedupe rule and for each non-web-link filter go red.
- Debug simulator build with -warn-long-expression-type-checking=100: no warnings (CI runs an older Xcode).
