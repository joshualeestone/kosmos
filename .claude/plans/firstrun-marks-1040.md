# Plan: firstrun picker shows the four new providers (kosmos#1040, piece 2a)

## Goal
Add the four #1040 providers (DeepSeek, GLM, Kimi, MiniMax) to the first-run model
picker as `.llm off` "coming soon" rows, each with its real inlined vendor mark, and
update `web.firstrun-model.test.js` from six providers to ten.

## What "done" looks like
- Eight `.llm off` coming-soon rows in the fr-pane-5 model step (was four), the four new
  ones structurally identical to the existing rows, each carrying its `.pmark dim` mark.
- `web.firstrun-model.test.js` asserts ten providers (off/soon/dim counts 4->8, name +
  data-pmark lists extended, STEP-length tripwire raised with recorded headroom).
- Rendered headless in light + dark: all eight marks display consistently dimmed, none
  vanish, the four new ones sit at the same weight as the existing four.

## The decision, and its weakest premise
- **Call:** apply Josh's "show all the models" ruling (2026-08-25) to the new providers as
  they arrived, growing onboarding from six to ten. The sticky footer already removed the
  fold tension six rows once created.
- **Rejected:** freezing onboarding at six; that would make onboarding show fewer models
  than the settings dialogs, backwards for the screen whose point is "see all your options."
- **Weakest premise:** that "show all the models" (said of the six marks in the pack then)
  extends to four coming-soon providers. Josh may prefer onboarding not be ten rows of
  mostly-coming-soon. Reversible in the running app; trivial to trim or reorder. Recorded
  on kosmos#1040 for his override.

## Deferred, tracked on kosmos#1040 (piece 2b-roster) -- NOT this PR
The blind review (correctly) flagged that this widens a cross-surface roster gap: firstrun
now lists DeepSeek/GLM/MiniMax that no `<select>` menu offers, while every select
(`#d-provider`, `#acct-provider-pick`, `#create-provider`) lists xAI Grok that firstrun does
not. `web.provider-menus.test.js` enforces agreement over `<select>` elements only, so it
cannot see this. Full reconciliation is deferred because it is genuinely coupled:
- The selects' roster is a Josh-flagged placeholder (#770: "six is what we ship, not what
  he chose"), awaiting his pass.
- The roster is coupled to the shipped agent instruction block ("those six appear in the
  menu marked coming soon", index.html ~7834) -- a roster change is a two-place edit.
- xAI/Grok has no official mark (xAI 403s; confirmed absent from xai-org GitHub too), so a
  select logo widget needs a no-mark fallback for Grok.
This PR moves the prominent onboarding surface to the desired state; 2b reconciles the
selects (add the three to all three menus + update the instruction block) and converts them
to logo widgets with a Grok fallback. The gap pre-existed (Grok) and is coming-soon-only.

## Note (NIT from review)
The four mark SVGs are inlined byte-for-byte from `docs/provider-marks/` (piece-1 branch
`marks-1040`, PR #2484), not referenced at runtime, so the two PRs are independent. If they
land out of order the inlined copies still render correctly; the `docs/provider-marks/`
"source library" comment is documentation, not a live dependency.

## Out of scope
The select-to-logo-widget conversion and the select roster reconciliation (piece 2b).
