# freeprofile-7819: delete what is left takes the agent's profile and picture

Card: joshualeestone/kosmos#7819 (claimed by Renet Tilley, given by Splinter 11-02). Follow-up to #7755.

## Why
`engine/delete-leftover.js` frees a name but left `<data root>/profiles/<key>.json`. `store.writeProfile` keeps a stored
`id` (#170) and every field a patch does not write, so a new agent under the freed name inherited the old `id`, `dir`,
accounts and provider. The picture (`avatars/<key>.<ext>`) is keyed the same way, so it carried over too. And two readers
treat any `profiles/*.json` as live: `register.known()` and `discover.folderHolders` (its `dir` stays held).

## The call
Move the profile and the picture with the files: to the Trash where the folder goes there, deleted for good where not.
- Rejected, retire in place like #4994: a community account is remote and public; a profile is a local file that live
  readers enumerate, so a retired copy left in `profiles/` keeps the agent half alive.
- Rejected, clearing in `create`: worldstarts writes `policyHeld`/`provider` before a held create retries, so create
  cannot tell a stale profile from a deliberate one.
- Order: LAST of the files, after the folder and the job (review round 1 overturned "first"): `create.workerDir` finds
  a recorded folder through the profile's `dir`, and an agent whose job could not be removed must keep its settings.
  The cost, accepted: a record that will not move after the files went cannot be retried through `plan()` (it finds
  nothing left), so that PARTIAL says a new agent would start with it instead of inviting a retry.
- By the name asked for only (review round 1, BLOCKER): a folder's basename can be another agent's name (a connected
  agent records another's freed folder), and a case variant already shares the key.
- The plan says where they go: the Trash only if the folder goes there AND the Trash can take them (another volume),
  otherwise deleted for good, and then the name must be typed, a job-only leftover included.
- Never another agent's file: keyed by `store.safeKey`, so a live session or an existing folder with the same key keeps
  it, and the step says so.
- `plan()` names it in `loses` ("Its settings[ and picture]: a new agent with this name starts without them").

## Weakest premise
Profiles already stranded with no folder or job (the Windows box's `b55-1.json`) are not reachable: `plan()` refuses a
name with nothing but a profile. Not built here: filed as kosmos#7825 (it needs a rule that leaves worldstarts' held
profiles alone).

## Tests
engine/delete-leftover.test.js, seventeen #7819 tests: the card's done-when (create, remove, delete, create again; new id,
no old field); every picture file and its kept originals; a shared stored name kept and said; a folder recorded under
another name never taken; the for-good path asking for the name; a stuck job keeping the settings; settings stuck after
the files went (PARTIAL, saying a new agent would start with them); unreadable folders refusing the plan.
Mutation: no move reds three; no shared-name guard reds the fourth. All 13 test files that use delete-leftover: 570 pass.

## Review round 1 (fixed)
BLOCKER: the folder basename could take another agent's profile; dropped. Records moved last (folder found through the
profile; a stuck job keeps them). Trash asked of the records themselves. A job-only leftover losing settings asks for the
name. Every picture extension. Each fix mutation-checked; the typing guard needed a job-only test to go red.

## Review round 2 (fixed)
A failed look at what is stored now refuses the plan (it read as "nothing stored" and promised a free name). The
shared-name guard's comment now says what it does not see (a stopped agent connected outside the workers folder).
Deferred: originals of a picture are deleted, not moved (never shown); profile-only leftovers (#7825).

## Review round 3 (fixed)
The shared-name guard skips this leftover's own folder by realpath (a Mac leftover recorded as Miles, asked as miles,
was keeping its own profile and saying the name was free). The picture's kept originals (avatar-originals, the picture
as the person set it) move with it instead of being deleted, through a new store.pictureFiles so the picture-file rule
stays in one place. Settings kept for another agent are said in the plan and in the result. Plural wording; the stuck
verb follows the records' own mode; a Linux unit keeps "its startup job is removed" in the rewritten sentence.
Removed again: a check for "a profile recording another existing folder", which could not fire (workerDir makes the
recorded folder the plan's folder), so it was an unarmed guard. That same fact is a pre-existing hazard outside this
card: a profile shared by key can make the plan treat another agent's recorded folder as the leftover's own.

## Review round 4 (fixed)
"Settings and picture stay" is said only when something is stored to keep. Deferred: a PARTIAL with stuck records after
the community retire (the known gap, #7825); Trash stamps to the second (pre-existing, as for the folder).

## Review round 5 (fixed)
An unreadable pictures folder, workers folder or profile now throws, so plan() refuses instead of reading "could not look"
as "nothing there" (the workers case would hide a folder sharing the key). Outcomes pinned in the shared-key tests. The
kept sentence names only what is kept, and the reassurance no longer says "Everything goes" when settings stay.
