# Plan: OpenAI model box shows "OpenAI picks its own model for now" (#2140 refinement)

## Context
Josh, 2026-09-04 (#admin, screenshot 4.05.07), refining the merged #2140 create flow (#2162):
when the provider is OpenAI and the account cannot expose a model choice (Codex/ChatGPT sign-in,
no recognised models, unreachable, or no account), the model box must SHOW "OpenAI picks its own
model for now" as its single option -- never a Claude model, never a hidden gap. The bug Josh saw
("Claude Sonnet 5" under an OpenAI agent) was on 0.6.28 (pre-#2162); #2162 already never shows
Claude models under OpenAI, but it HID the box + a note in the not-listable case, and Josh wants
the box present with that single option.

## Change
`web/index.html` `paintOpenaiCreateModel`: the not-listable and no-account branches now SHOW
`#create-model-row` with a single disabled `<option value="" selected>OpenAI picks its own model
for now</option>` (value empty = auto, nothing submitted) instead of hiding it; the keyed reason
note stays below. Satisfies #2098's no-stale-Claude-value invariant via a real OpenAI sentence
rather than a hidden row. The listable API-key picker (real OpenAI models) is unchanged; so is the
loading state and the Claude flows.

## Verification
- Verified LIVE on a ChatGPT-mode (not-listable) board: the box shows the single option, no Claude
  model, row visible.
- Tests + browser check updated (row shown with the single option; assert no Claude model under
  OpenAI). The browser check reds on the pre-refinement #2162 index (box hidden). 15/15 web picker
  tests + both browser checks. Full validation green (hash d4384dafa3fd). Challenge-loop 1
  iteration, converged (only 3 stale-doc NITs, fixed).

## Decisions / rejected
- **Rejected: keep hiding the box + note** (my #2162 behavior): Josh explicitly asked for the box
  present with the single option ("in that box as the only option").
- A disabled single-option box (not an enabled one) because there is no real choice to make; the
  empty value means auto so nothing is submitted.
- **Weakest premise**: the single option's value must stay empty for the submit's `if (model)` gate
  to treat it as auto; asserted in the unit test (value="" + no Claude in the html).
