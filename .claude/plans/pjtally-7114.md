# pjtally-7114: the provider tally on the iPhone Projects row (a slice 9 gap, #6838)

**Done when:** an iPhone Projects row shows the board's provider tally beside "N agents" (marks and numbers, quiet),
counted and spoken as the board's pjProviderTally; the marks are the board's own; tested and pinned; merged.

## Decisions
- Counting is pjProviderTally's: PJ_TALLY order and words (both Gemini families one "Gemini"), any other provider by
  its own name after those in the order met, members without a provider left out (Board.providerTally, pinned).
- The marks are the board's first-run [data-pmark] SVGs, as vector assets (Assets.xcassets Mark*.imageset, preserved
  vector). Five draw in the text colour (template; their currentColor written as black), Qwen keeps its own blue, as
  on the board. OpenAI's glyph is drawn 1.5x, as the board's CSS does. A provider without a mark gets the board's
  initial-letter chip. Each asset is tested byte for byte against the board's SVG.
- Placement: after "N agents" in the row's faces line, a hairline then the entries, at the caption's size (scaled
  with Dynamic Type). The line stays hidden from VoiceOver as before; the row's spoken line gains ", 2 Claude, 1 GPT".
- Weakest premise: the look (mark sizes, the hairline, wrapping at the largest text) is unverified by a screenshot
  (#7055); the faces line is an HStack, so at large sizes the tally may need to wrap or drop to its own line.

## Steps
1. Assets, logic, view, tests. DONE: room 261/261 (control: a separate word for the subscription Gemini fails 4
   checks); run 1209, actions 99, settings 42, tasks 90, taskpage 108; route check 5/5; Debug (the slow-expression
   warnings are in untouched files, under load) and KOSMOS_STORE_SHOTS Release SUCCEEDED; the asset catalog holds the
   six marks with preserved vectors (assetutil).
2. Review loop. 3. Validation, PR.
