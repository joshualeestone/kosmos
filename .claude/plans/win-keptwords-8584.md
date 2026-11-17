# win-keptwords-8584: #8510 round 8 follow-ups (two sentences that rest on a live read) (kosmos#8584)

**Posture:** production

## Finished means
- "changed" with a retired model: the model advice is its own sentence, true whichever account the agent lands on
  (it used to sit only after "Otherwise ... main account").
- accountOk on an account FOLDER: the account is said with "if that account is
  still signed in there at Start at login" and an "Otherwise ... main account; choose its account again" sentence,
  because register.repair reads the folder
  again, live, at Start at login. On the main account (no folder) the flat sentence stays: it is always there.
- engine/delete-leftover.win32-accountkeep-8478.test.js: the two "also could not confirm" pins end in `\.`, not `.`;
  the stale title about the later retry is reworded.
- Every sentence stays at 30 words or fewer (the #8510 matrix caps it).

## Decisions
- Review 1: the folder's main-account fallback is where it stays (Start at login is not offered again), so it gets
  the advice every other main-account outcome has, as its own sentence: "It starts on the model it was set to, and on
  the account it was set to if that account is still signed in there at Start at login. Otherwise it starts on your
  main account; choose its account again if it should use another." (retired model: the account sentences, then the
  model sentence and its advice). An end-to-end test signs the folder out before Start at login and checks the main
  account is written and Start at login is not offered again.
- Main-account accountOk keeps the flat sentence: nothing a person can do before Start at login removes the main
  account, and adding "if" there would be a hedge with no case behind it.
- Review 2: "only if Kosmos finds that same account in its account folder at Start at login", never a plain "if ...
  still signed in there": with the same account signed in, a folder out of reach or mid-write still goes on the main
  account (end-to-end tests for both). The model gets its own first sentence to keep each under the cap.
- First draft (superseded by review 1): one sentence, "... before if that account is still signed in there at Start
  at login; otherwise on your main account." It left out the advice to choose its account again, and adding that would
  pass the 30-word cap, hence the split above.

## Weakest premise
"still signed in there" stands for repair's two checks (the folder is reachable AND holds the same account). A folder
that is reachable but unreadable at that moment is kept for a later try and the agent goes on the main account; the
"otherwise" covers it.

## Tests
- #8510 matrix: the folder case expects the "if ...; otherwise on your main account" form and no "because"; "changed"
  with a retired model ends "... Choose its model again if it used another."
- 8478 pins moved to the new folder sentences; the stale-record case (task on the main account) pins the FLAT sentence
  and that no "still signed in there" appears. Against origin/main's delete-leftover.js the updated pins fail (7).
- delete-leftover*, create.win32-samaccount-8489, remove*, register* and the policy tests: 540 tests, 4 failures, all the
  known Mac-only ones (#7409 launchd, #7835 /bin/cat), the same on main.
