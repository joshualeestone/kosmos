# holdwhy-8958: two text boxes on the iPhone task page lose what is typed, and the sample Mac's dates move (kosmos#8958)

## Problem
CI run 45629568745 (11-25) failed two task page tests; read from its screen recordings:
1. testAHoldSaysWhatItWaitsForAndWhy: "Waiting on prices" was typed and the box kept, and saved, "Waiting on pri"; on the other try
   the caret jumped into the middle and 9 letters of 190 were lost.
2. testDoneWhenAndTheWakeLine: the folded runs open and close by themselves about a second later.

## Cause
1. The hold's Why box (B8) and the repeat's minutes box (B3) read their words back from a value caught when the page was last drawn.
   On a slow phone that is behind, and Return straight after the words puts the box back to it (proof below).
2. The sample Mac computed its dates at each request, so every 5 second read gave every activity row another id. A real Mac's dates
   are fixed.

## Call
- Both boxes read the state live, in two commits (the minutes box alone applies to 9acaafafef, the #7352 fallback).
- The repeat's Save reads the draft live too (review 1): it sent what was last drawn, so a fast Save could send 4 where 45 was
  typed. Reasoned from the code, not seen.
- The sample Mac's dates count back from one moment per launch, and the fold test waits through two reads.

## Not changed
The other boxes of the page (message, title, detail, add a part) are bound straight to their own state. The page's pickers and date
pickers read the caught value too; a choice is one write, so nothing is typed over (not measured).

## Proof
Experiment 1 (words, no Return, 0 and 150 ms a draw): 36 of 36 whole, old and new; it left out what the failing test did.
Experiment 2 (150 and 400 ms a draw, draws counted 221 to 305 an arm, iOS 26.5, iPhone 17e, three tries each):
- the real failing test: old 0 of 6 passed, new 6 of 6;
- words then Return in the Why box: old lost the end in 4 of 6, new in 0 of 6;
- the message box (control): whole 12 of 12, not followed by Return; the minutes box: whole as typed, 12 of 12 (its value after
  Save was not read).
The hold test now draws at 150 ms always, so it does not pass by luck; the fold test waits through two reads.

## Weakest premise
That Return straight after the words is the only trigger. Any end of an edit inside one draw could do the same.
