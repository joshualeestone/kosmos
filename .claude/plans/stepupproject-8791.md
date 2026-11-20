# stepupproject-8791: Sign in again on the iPhone New Project sheet (kosmos#8791 slice 4)

Card: kosmos#8791 (native sheets show a step-up refusal as text with no Sign in again). Slices 1 to 3 (New Agent,
New Team, the cloud Open of #8795, and the fresh sign-in itself) merged as #8809 (022964f8c8).

## Finished means
The New Project sheet, refused with 403 step_up_required, shows Mona Lisa's line "This needs a fresh sign-in. We
will send a code to <email>." with Send code and Not now, runs the app's fresh sign-in (the old session kept until
the new one is issued), and retries the create once. A second refusal says so; no loop. Closing the sheet ends a fresh
sign-in still showing. Same behaviour as New Agent on main.

## What changed
- BoardRoom.swift: NewProject.result returns .signInAgain on 403 + step_up_required (other 403s stay a refusal).
- NewProjectView.swift: the inline step, retry once after a finished sign-in on the same computer and form.
- ContentView.swift: closing New Project ends its fresh sign-in; another account or computer closes the sheet.
- NewAgentView.swift: the team path handles the new .signInAgain case.
- LogicTests: the three 403 cases, with a control.

## Rejected
- A separate sign-in screen for New Project: the shared FreshSignInCenter already keeps the old session safe.

## Weakest premise
That no path changes the tab while a New Project fresh sign-in shows (review 2's unconfirmed warning): a tab change
closes the sheet and the one retry is lost, which is safe (nothing sent twice) but would need the person to retry.

## Verify
Simulator build clean; ios/LogicTests run.sh 2181/2181 and run-room.sh 904/904 on the rebased branch. CI runs the rest.
