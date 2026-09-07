# Plan: tighten the first-run Notifications cog box (Josh 0.6.45, item 1)

## Goal
On the first-run "Notifications" screen (#fr-pane-4), the gray box behind the cog
(.s4-notif > .s4-gear) hugs the cog instead of being oversized, so the mock reads
like the real macOS notification icon.

## Why
Josh's 0.6.45 notes, item 1: the cog size is right, but the gray box behind it is
too big ("gigantic"). Also asked to bold "App Background Activity" -- but .s4-nt is
ALREADY font:700 (bold), so that half is already satisfied.

## Change
- web/index.html `.s4-gear`: 76x76 / radius 12 / font 44 -> 52x52 / radius 11 /
  font 40. place-items:center keeps the cog centred. CSS-only, one rule.

## Scope / split
BUILD (the box size) is mine. COPY on this screen (and the bold-match wording) is
Mona's per Splinter's routing; the bold is already present in the code.

## Verification
- Rendered #fr-pane-4's .s4-notif to a screenshot (loaded file://index.html,
  unhid pane 4): the 52x52 box hugs the centred cog, the bold title matches the
  real notification. Screenshot in the Discord post.
- #1720 gate: satisfied by a `Browser-check:` commit trailer -- a static mock's
  box dimensions are a visual-tune, not a testable behavioural contract.

## Weakest premise
The exact 52px / 40px numbers are a visual judgement, not a measured ratio against
the real macOS notification. Mitigated: Mona/Josh can fine-tune; the change is a
pure cosmetic CSS value with no behaviour attached.
