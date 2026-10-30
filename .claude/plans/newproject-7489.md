# newproject-7489: ui-signin --new-project (kosmos#7489)

Josh, 10-28: + on Projects hung on build 11. The fix (native New project form, #7507) had never been run against a real
board. This adds the measurement, not a product change.

## Finished looks like
- `ios/tools/ui-signin.sh --new-project` signs in as before, then taps + on Projects, checks the native "New project"
  form opened (its title and Name field), types "UI test <seconds>", taps Create, and passes only when the new project's
  room opens (the room's own "Add a file to this conversation" + and the project's name) within 60 s.
- Without the flag nothing changes: the test returns right after the board step, as today.
- Measured 10-30 02:01 CDT on a Kosmos Cloud test account with a machine started for it: PASS, room "UI test
  1793343694" opened (screenshot taken). The first run (01:2x) failed at the board step, correctly: that account's
  machine had been retired, and the test said "no computer connected".

## Decided
- Opt-in, because it makes a real project on the account it runs against; named "UI test <seconds>" so it is plainly a
  test. Rejected: deleting the project afterwards (the iPhone has no delete; a test box is ended whole).
- The flag rides on the existing sign-in test rather than a new class, since it needs the signed-in board that test
  already reaches. Weakest premise: a failure in the new step reads as a sign-in test failure; the step name ("new
  project") in the FAIL line says which.

## Not in scope
- The code fetcher's stale anchor (kosmos-signin-code reads a Gmail search result that lags minutes, then returns the
  oldest code since it). Passed to Vivienne via Ice Cream Kitty, 10-30 01:5x; this run used --code-cmd with a shim.
