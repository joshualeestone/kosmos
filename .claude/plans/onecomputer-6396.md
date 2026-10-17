# onecomputer-6396: no top-left "This computer" when the account has one computer

Card: joshualeestone/kosmos#6396. Josh, 2026-10-17 11:09: "If there is only 1 computer lets not show "This computer"
in the top left - it makes no sense". Assigned by Splinter 11:11, ahead of the audit.

## Finished looks like
With one computer on the account (or not signed in to Kosmos+, or before the computers answer arrives) nothing shows
top-left; with two or more it shows this computer's name and opens Your computers, as today. Screenshots of both.

## Call
Hidden whenever the menu cannot open (COMPUTERS_OPENABLE false), not only for exactly one computer: not signed in is
also "only this computer", and showing "This computer" for the boot instant then removing it would flash. Rejected:
showing it until the first answer (it would say "This computer" on every one-computer board for a moment). Weakest
premise: that nobody relies on the top-left label to know which computer they are on when they have one; with one,
there is nothing to tell apart, which is Josh's point.

## Steps
1. web/index.html worldswOneKosmos: sw.hidden = !COMPUTERS_OPENABLE (the MULTI_KOSMOS path is untouched).
2. render-onekosmos-4815.js: one computer, not signed in, boot-not-answering and hidden-tab arms expect nothing shown;
   four computers is the control; assertion floor 56 -> 52 (two one-computer asserts merged, x4 runs).
3. render-dm-chatfirst-718.js: its top-left-name size arm gets two computers so it still measures the name.
4. Mutant (sw.hidden = false): 16 of 52 red. Both checks green; six node tests touching the switcher green.
