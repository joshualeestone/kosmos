# win-keptwords-8584: #8510 round 8 follow-ups (two sentences that rest on a live read) (kosmos#8584)

**Posture:** production

## Finished means
- "changed" with a retired model: the model advice is its own sentence, true whichever account the agent lands on
  (it used to sit only after "Otherwise ... main account").
- accountOk on an account FOLDER (register.repair reads it again, live, at Start at login), in the shipped words:
  - model offered: "It starts on the model it was set to. It starts on the account it was set to only if Kosmos finds
    that same account in its account folder at Start at login. Otherwise it starts on your main account; choose its
    account again if it should use another."
  - model retired: "It starts on the model it last ran, as the model it was set to is not offered now." then the same
    two account sentences, then "Choose its model again if it used another."
  On the main account (no folder) the flat sentence stays: "It starts on the account and model it was set to before."
- engine/delete-leftover.win32-accountkeep-8478.test.js: the two "also could not confirm" pins end in `\.`, not `.`;
  the stale title about the later retry is reworded.
- Every sentence stays at 30 words or fewer (the #8510 matrix caps it).

## Decisions
- "Only if Kosmos finds that same account in its account folder at Start at login" (review 2), never a plain "if ...
  still signed in": with the same account signed in, a folder out of reach (a disk not connected) or mid-write (its
  config being written) still goes on the main account. "Finds that same account in its account folder" covers reach,
  read and match, as the kept outcomes' words do.
- The main-account fallback is where the agent then stays (Start at login is not offered again), so it gets the advice
  every other main-account outcome has (review 1), as its own sentence to keep each under the cap.
- The model is said first in every outcome, the model advice last (review 3), so two agents' words read in one order.
- Main-account accountOk keeps the flat sentence: nothing a person can do before Start at login removes the main
  account, and adding "only if" there would be a hedge with no case behind it.
- Earlier drafts, superseded: one sentence "... before if that account is still signed in there at Start at login;
  otherwise on your main account" (no advice, review 1); then "if that account is still signed in there" (a plain if
  that out of reach and mid-write make false, review 2).

## Weakest premise
"Only if" is a necessary condition, so it is true on every path; it does not tell the person WHY a found-looking
account may still miss (a disk not connected). The out-of-reach outcome, which knows that at the delete, says to
connect it; this one cannot know it until Start at login.

## Tests
- #8510 matrix: the folder case expects the shipped sentences (offered and retired, model first) and no "because";
  "changed" with a retired model ends "... Choose its model again if it used another."
- Three end-to-end Windows tests from a folder that is fine at the delete: signed out (another account in), out of
  reach, and config mid-write before Start at login. Each checks the task is written on the main account with the
  model it was set to, and the first that Start at login is not offered again.
- 8478 pins moved to the new folder sentences; the stale-record case (task on the main account) pins the FLAT sentence
  and that no "only if Kosmos finds" appears; bob's two cases also refuse "only if Kosmos finds" (a live guard).
- delete-leftover*, create.win32-samaccount-8489, remove*, register* and the policy tests: 543 tests, 4 failures, all the
  known Mac-only ones (#7409 launchd, #7835 /bin/cat), the same on main.
