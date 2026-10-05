# fedscreens-c-4649: slice C of the federation screens (#4649)

Card: joshualeestone/kosmos#4649. Spec: ~/work/workers/pigeonpete/Files/federation-screens-4649-spec.md (section 0,
screens 03 and 04, gap G3, section 3 slice C; Mona Lisa's design, her Q-M5 answer on the card). Stacked on slice B
(fedscreens-b-4649, PR #5284), which is stacked on slice A (merged as 999d9ed96b). Merges after slice B.

## What it adds
- "Copy the invitation" on the invite sheet's code step: shot 04's text exactly. The owner is named per Q-M5 (You name
  with the account's Kosmos+ address in brackets, the address alone, the name alone, or "Someone"); the address comes
  only from owner_name on the members answer, never this computer's own address.
- The shot 03 lines: "You can withdraw it from Members until <name> joins." and the Easier box.
- fedCopyText, one copy routine for both buttons: select-and-copy first (synchronous inside the press), then the
  clipboard with a 3 s limit; a record of what this sheet put on the clipboard; late writes said honestly.
- copyTextViaExec shared with the Plus address copy; copy keys named per platform (copyKeysWord/copyKeysGlyph) at
  every "copy it yourself" line, pinned by a static unit test.
- The sheet's message line is cleared and said again, so a repeated press is spoken.

## Decisions
- First names only for a person (fedFirstName, shared with slice B's Remove dialog): an agent's or a computer's label
  reads "they".
- The two older copy screens (pjCopyInvite, pjsOwnCopy) keep their own order; only their keys are unified here. Their
  order is #5275 (Mona Lisa).

## Weakest premise
That `owner_name` arrives on the members answer as Kitty agreed (a follow-up after #5266); without it the invitation
names the owner without an address, which is correct but less than shot 04.

## Ledger
Review: 27 rounds before slice B's latest head was merged in (converged at 27), then one round on the merged branch
(converged, nits only). Details in fedscreens-c-4649-pre-challenge.md and the commit messages.
Validation: clean at 2f73d11d02 (15036 pass, 0 fail). Browser check render-federation-invite-4649.js at 2f73d11d02:
149 PASS, control on main rc 1; render-plus-panel-3829 passes.
