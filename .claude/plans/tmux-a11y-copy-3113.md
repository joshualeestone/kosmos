# tmux #3113 native half: honest shared NSAppleEventsUsageDescription

## Problem (Josh 0.6.78 fresh-box)
Clicking the tmux accessibility "Turn On" fired a confusing macOS Automation prompt ("Kosmos wants
to control System Events... opens a Terminal window... Open Terminal") instead of the Accessibility
pane. That copy is the app's single NSAppleEventsUsageDescription (macOS allows ONE per bundle), and
it was worded only for the Open-Terminal feature - but the SAME string is also shown for the
tmux-a11y register (spawnTmuxAutomationPrompt runs osascript UNDER tmux to control System Events so
tmux gets its own Accessibility row). So a user granting tmux accessibility saw Open-Terminal copy.

## The joint fix (this is the NATIVE half)
- NATIVE (this branch): reword the shared NSAppleEventsUsageDescription (install/setup.sh:3102) to be
  honest for BOTH uses and to say WHY (allow tmux in Accessibility), which is exactly Josh's confusion.
  Add a #3113 comment so it is not re-narrowed to Open-Terminal only.
- CLIENT (ICK #3221, separate): fire the register up front at the Access step (not on the Turn-On
  click) + tmux Turn On -> trigger:null -> deep-link to Privacy & Security > Accessibility (Josh's
  drawn spec). The two halves MUST land together (trigger:null alone regresses the listing).

## Scope
One file, one hunk: the NSAppleEventsUsageDescription string + its comment. No mechanism change (the
native register spawnTmuxAutomationPrompt already fires when the request arrives; timing is client).

## Weakest premise (fresh-box, non-blocking)
The copy says "so you can allow it in Accessibility" (purpose/outcome). Whether the read-only System
Events probe raises the Accessibility vs Automation TCC category is an OPEN fresh-box residual (Josh's
next run confirms). The copy describes intent, not the OS dialog category, so it stays honest either way.

## Josh finalizes the wording
User-facing permission copy; Josh is copy-sensitive. Splinter is offering him the string. This honest
default ships if he does not reword.
