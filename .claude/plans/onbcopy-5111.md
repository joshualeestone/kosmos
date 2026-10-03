# onbcopy-5111: two first-run lines that confuse a first-timer (#5111 day-one walkthrough)

Splinter 06:33: walk the onboarding on main as Monday's newcomer, fix what confuses. Shots of every step at 1280x800:
~/work/design-shots/dayone-onboarding-0703/ (main 4188be830, sandboxed board via mobile-shots --keep).

## Finished looks like
- About you (step 8): the screen-reader instruction names the button that is there ("before Next"; it said Continue).
- Never sleeps (step 3): the hint beside Check again says "Click to check" (a desktop screen; it said Tap).

## Left as is, on purpose
- Step 7 "applications folder ... your dock" and step 9 "Head to your dashboard": Josh's verbatim copy (#2345, #3659).
- Step 8's grey "Josh" placeholder: Josh's explicit call (2026-09-08), recorded in the code.

## Weakest premise
That "click" is right everywhere this screen shows: the first-run wizard runs on the computer, not the phone app.
On Windows step 3 shows only the sleep row (Accessibility is Mac-only); the hint still reads right there.

## Checks
web.firstrun-a11y-1214.test.js and the browser check render-frnav-2647.js pin the new hint. A new test reads the
spoken About-you instruction and the step's button label from the same painter and requires them to match (red on
main, measured).
