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
2. Review loop.
   - Round 1: 0 blockers, 1 warning, 3 nits. Fixed: every table row exercised (word, mark) and the table written as
     the board's PJ_TALLY rows, so any field drifting fails (the reviewer's two mutations now red); the tally drops
     to its own line when it does not fit (ViewThatFits), counts never squeezed; the board's filled chip; Anthropic
     wears Claude's mark. Room 264/264; Debug SUCCEEDED.
   - Round 2: 0 blockers, 2 warnings, 2 nits. Fixed: a third layout for when neither fits (faces, the count allowed
     to wrap, the tally entries wrapping in TallyFlow, the board's flex-wrap), so nothing runs past the row; the
     board's whole PJ_TALLY compared row for row; no hairline on a line of its own; the no-mark test uses names the
     board has no mark for either. Room 264/264; Debug SUCCEEDED.
   - Round 3: 0 blockers, 2 warnings, 1 nit. Fixed: TallyFlow measures and places with one line-breaking rule,
     Board.flowLines (tested: 30/30/30 at 100 is two lines; the measured-vs-placed mismatch was measured by the
     reviewer); unknown providers in arrival order pinned with names out of alphabetical order (that mutation now
     red); the chip's uppercasing pinned with a lowercase name. Room 268/268; Debug and Release SUCCEEDED.
   - Round 4: 0 blockers, 1 warning, 2 nits. Fixed: TallyFlow places at the proposal width it measured at (it placed
     at bounds.width, the reported width, and re-broke lines: measured by fuzz, both directions); flowLines sums as it
     compares; a blank provider's chip is the board's "?"; the phone's pick-to-mark pairs pinned to the board's
     PROVIDER_MARK_KEY. Room 277/277; Debug and Release SUCCEEDED.
   - Round 5: 0 blockers, 1 warning, 1 nit. Fixed: Board.flowLayout returns each line's width summed exactly as it was
     compared, and TallyFlow reports those, so breaking again at the reported width replays the same lines (the
     reviewer's measured fuzz case is a test); the board's PROVIDER_MARK_KEY checked the other way too. Room 287/287.
3. Validation, PR.
