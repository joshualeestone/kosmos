# onbcopy-5111: the About-you step names the button that is there (#5111 day-one walkthrough)

Splinter 06:33: walk the onboarding on main as Monday's newcomer, fix what confuses. Shots of every step at 1280x800:
~/work/design-shots/dayone-onboarding-0703/ (main 4188be830, sandboxed board via mobile-shots --keep).

## Finished looks like
- About you (step 8): the screen-reader instruction names the button that is there ("before Next"; it said Continue).

## Left as is, on purpose
- Step 3's hint "Turned it on? Tap to check." ("Tap" on a desktop screen): Josh's verbatim copy, item 4 of his
  #2647 report. First changed to "Click" here, then reverted when review found his wording (iteration 2). Raised to him
  on #5111 instead.
- Step 7 "applications folder ... your dock" and step 9 "Head to your dashboard": Josh's verbatim copy (#2345, #3659).
- Step 8's grey "Josh" placeholder: Josh's explicit call (2026-09-08), recorded in the code.

## Weakest premise
That a screen-reader user is told about the button at all only through this hidden line (the fields also carry
aria-required).

## Checks
A new test reads the
spoken About-you instruction and the step's button label from the same painter and requires them to match (red on
main, measured).
